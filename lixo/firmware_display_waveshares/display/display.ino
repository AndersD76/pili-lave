/*
  lavadora_display.ino
  Display Waveshare ESP32-S3-Touch-LCD-7 — Lavadora Automática de Carro
  LVGL 8.4.0 + ESP32_Display_Panel

  CONFIGURAÇÕES OBRIGATÓRIAS (Tools no Arduino IDE):
    Board             ESP32S3 Dev Module
    Flash Size        16MB
    Partition Scheme  Default 8MB with spiffs
    PSRAM             OPI PSRAM (8MB)
    CPU Frequency     240MHz
    Flash Mode        QIO 80MHz
    USB CDC On Boot   Disabled

  Arquitetura RS-485 Modbus RTU:
    Display (mestre) → Waveshare #1 (endereço 1) → I/O grupo 1
                    → Waveshare #2 (endereço 2) → I/O grupo 2
                    → Inversor Delta  (endereço 3) → motor

  Pinos RS-485 (internos à placa — NÃO conectar fisicamente):
    GPIO16 = TXD (UART do ESP32)  →  chip RS-485  →  terminal A+
    GPIO15 = RXD (UART do ESP32)  →  chip RS-485  →  terminal B−
    ⚠️ Invertidos em relação ao rótulo do wiki (que é do ponto de vista do
       transceiver). Para a UART do ESP32: TX=16, RX=15. Validado na bancada.
    Controle DE/RE automático pelo chip da placa. Barramento 9600 8E1
    (8E1 porque o inversor Delta MS300 está em 8E1 — Pr.09-04=14).

  Telas:
    TELA_MANUAL      — operação manual (tela inicial)
    TELA_AUTO        — seleção de programa automático
    TELA_CONFIG      — parâmetros do sistema
    TELA_VELOCIDADES — frequências Hz por etapa
    TELA_MODELOS     — sequência de processos por modelo
    TELA_SENHA       — teclado numérico genérico (pagamento/config)
    TELA_SENHAS_CFG  — alterar as senhas (dentro de Config)
*/

#include <Arduino.h>
#include <esp_display_panel.hpp>
#include <lvgl.h>
#include "hard_reset.h"    // hard reset no boot disparado pelo firmware (fase 1/2)
#include "lvgl_v8_port.h"
#include "comm_espnow.h"
#include "nvs_manager.h"
#include "maquina_estados.h"   // FSM automatica (usa modbus/nvs; pull processos.h)
#include "tela_manual.h"
#include "tela_auto.h"
#include "tela_config.h"
#include "tela_velocidades.h"
#include "tela_modelos.h"
#include "tela_senha.h"
#include "tela_senhas_cfg.h"
// --- App / backend / Wi-Fi (depois do maquina_estados.h por dependencia) ---
#include "wifi_manager.h"
#include "backend_client.h"
#include "lampada_app.h"
#include "licenca.h"
#include "tela_wifi.h"

// Label global de status Wi-Fi — a funcao esta definida antes de setup()
static lv_obj_t* lbl_wifi_icon = nullptr;

using namespace esp_panel::drivers;
using namespace esp_panel::board;

// -----------------------------------------------------------------------
// Máquina de estados de tela
// -----------------------------------------------------------------------
typedef enum {
    TELA_NONE        = 0,
    TELA_MANUAL      = 1,  // operação manual
    TELA_AUTO        = 2,  // seleção de programa automático
    TELA_CONFIG      = 3,
    TELA_VELOCIDADES = 4,
    TELA_MODELOS     = 5,
    TELA_SENHA       = 6,  // teclado numérico genérico
    TELA_SENHAS_CFG  = 7,  // alterar senhas (dentro de Config)
    TELA_WIFI        = 8,  // configuração Wi-Fi (dentro de Config)
} TelaAtiva;

static TelaAtiva tela_atual = TELA_NONE;

// -----------------------------------------------------------------------
// Estado global do sistema
// -----------------------------------------------------------------------
EstadoSistema g_estado = {
    .modo_auto     = false,
    .programa_sel  = 1,
    .em_pausa      = false,
    .processo_ativo = PROC_NENHUM,
    .alarme        = false,
    .msg_alarme    = "",
};

ConfigSistema g_config = {
    .atraso_init        = 3,
    .tempo_espuma_a     = 20,
    .tempo_espuma_b     = 20,
    .tempo_cor_magica   = 20,
    .dist_compensacao   = 18,
    .sobrecarga_main    = 15,
    .sobrecarga_rotacao = 12,
    .tempo_sobrecarga   = 75,
    .atraso_espuma_a    = 50,
    .atraso_espuma_b    = 50,
    .atraso_cor_magica  = 100,
    .atraso_spray       = 20,
};

// Velocidades padrão (Hz * 10) por programa e etapa
// [programa 0-3][etapa 0-10]
uint16_t g_velocidades[4][NUM_ETAPAS] = {
    // Prog 1: Pre, Spray, EspA_Desl, EspA_Giro, EspB_Desl, EspB_Giro, CM_Desl, CM_Giro, AltaPres, Sec, Retorno
    { 200, 250, 200, 150, 200, 150, 200, 150, 350, 300, 200 },
    { 200, 250, 200, 150, 200, 150, 200, 150, 350, 300, 200 },
    { 200, 250, 200, 150, 200, 150, 200, 150, 350, 300, 200 },
    { 200, 250, 200, 150, 200, 150, 200, 150, 350, 300, 200 },
};

// Sequência de processos por modelo [modelo 0-3][slot 0-9]
uint8_t g_modelos[4][NUM_SLOTS] = {
    { PROC_PRE_LAVAGEM, PROC_SPRAY, PROC_ESPUMA_A, PROC_ESPUMA_B, PROC_ALTA_PRESSAO, PROC_SECAGEM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
    { PROC_PRE_LAVAGEM, PROC_SPRAY, PROC_ESPUMA_A, PROC_ALTA_PRESSAO, PROC_SECAGEM,   PROC_FIM,     PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
    { PROC_PRE_LAVAGEM, PROC_ESPUMA_A, PROC_ESPUMA_B, PROC_COR_MAGICA, PROC_ALTA_PRESSAO, PROC_SECAGEM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
    { PROC_PRE_LAVAGEM, PROC_SPRAY, PROC_ESPUMA_A, PROC_ESPUMA_B, PROC_COR_MAGICA, PROC_ALTA_PRESSAO, PROC_SECAGEM, PROC_FIM, PROC_FIM, PROC_FIM },
};

// Contadores diários
uint32_t g_contadores[4] = { 0, 0, 0, 0 };

// Horas acumuladas com motor ativo em modo manual — valor real vem do NVS
// (nvs_get_horas_manual()) assim que nvs_init() roda no setup().
float g_horas_manual = 0;

// -----------------------------------------------------------------------
// Navegar entre telas
// -----------------------------------------------------------------------
void navegar_para(TelaAtiva destino) {
    if (destino == tela_atual) return;
    tela_atual = destino;

    lvgl_port_lock(-1);
    switch (destino) {
        case TELA_MANUAL:      tela_manual_ativar();      break;
        case TELA_AUTO:        tela_auto_ativar();        break;
        case TELA_CONFIG:      tela_config_ativar();      break;
        case TELA_VELOCIDADES: tela_velocidades_ativar(); break;
        case TELA_MODELOS:     tela_modelos_ativar();     break;
        case TELA_SENHA:       tela_senha_ativar();       break;
        case TELA_SENHAS_CFG:  tela_senhas_cfg_ativar();  break;
        case TELA_WIFI:        tela_wifi_ativar();        break;
        default: break;
    }
    lvgl_port_unlock();
}

// -----------------------------------------------------------------------
// Callbacks de navegação (chamados pelas telas)
// -----------------------------------------------------------------------
void cb_ir_config()      { navegar_para(TELA_CONFIG); }
void cb_ir_wifi()        { navegar_para(TELA_WIFI); }   // abre a tela de config Wi-Fi (app)
                                                        // (era tela_wifi_ativar() direto, sem passar por
                                                        // navegar_para — tela_atual nunca virava TELA_WIFI,
                                                        // então "Voltar" chamava navegar_para(TELA_CONFIG)
                                                        // que via tela_atual==TELA_CONFIG (não mudou) e
                                                        // dava return sem fazer nada. Botão nunca respondia.)
void cb_ir_velocidades() { navegar_para(TELA_VELOCIDADES); }
void cb_ir_modelos()     { navegar_para(TELA_MODELOS); }
void cb_ir_manual()      { navegar_para(TELA_MANUAL); }
void cb_ir_auto()        { navegar_para(TELA_AUTO); }
void cb_ir_senhas_cfg()  { navegar_para(TELA_SENHAS_CFG); }

// Config agora fica atrás da senha de configuração
void cb_ir_senha_cfg() {
    tela_senha_configurar(SENHA_MODO_CFG, cb_ir_config, cb_ir_manual);
    navegar_para(TELA_SENHA);
}

// "Alterar Senhas" (dentro de Config) exige a senha de pagamento pra autorizar
void cb_ir_alterar_senhas() {
    tela_senha_configurar(SENHA_MODO_PAG, cb_ir_senhas_cfg, cb_ir_config);
    navegar_para(TELA_SENHA);
}

// Pagamento efetuado: exige senha de pagamento, se correta faz o acerto de
// contas e atualiza os contadores na tela manual
void cb_pagamento_sucesso() {
    nvs_fazer_acerto();
    tela_manual_atualizar_contadores();
    navegar_para(TELA_MANUAL);
}
void cb_ir_senha_pag() {
    tela_senha_configurar(SENHA_MODO_PAG, cb_pagamento_sucesso, cb_ir_manual);
    navegar_para(TELA_SENHA);
}

// -----------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------
// Atualiza o icone de status Wi-Fi (Bloco 8.4) — chamado no loop
void ui_atualizar_wifi_icon() {
    if (!lbl_wifi_icon) return;
    if (!lvgl_port_lock(10)) return;
    char buf[8];
    if (!wifi_conectado()) {
        snprintf(buf, sizeof(buf), LV_SYMBOL_WIFI "x");
        lv_obj_set_style_text_color(lbl_wifi_icon, COR_VERMELHO, 0);
    } else {
        int32_t rssi = wifi_rssi();
        if (rssi > -60)       snprintf(buf, sizeof(buf), LV_SYMBOL_WIFI);
        else if (rssi > -75)  snprintf(buf, sizeof(buf), LV_SYMBOL_WIFI "~");
        else                  snprintf(buf, sizeof(buf), LV_SYMBOL_WIFI ".");
        lv_obj_set_style_text_color(lbl_wifi_icon,
            backend_ok() ? COR_VERDE : COR_AMARELO, 0);
    }
    lv_label_set_text(lbl_wifi_icon, buf);
    lvgl_port_unlock();
}

// Opção A: o display só pode VARRER canais (hunt da câmera) com a máquina OCIOSA —
// nunca durante movimento/ciclo (senão perde o I/O das waveshares). Regra de segurança.
bool espnow_pode_varrer() {
    return (g_vfd_mov == 0) && (g_estado_auto == AUTO_IDLE)
        && !home_rodando() && !recuperacao_ativa();
}

void setup() {
    Serial.begin(115200);
    delay(300);

    // HARD RESET (via firmware): ao energizar, reinicia o chip inteiro uma vez
    // com a alimentacao ja estavel; depois sobe com o radio zerado.
    hard_reset_fase1("DISPLAY");
    hard_reset_radio();

    // Inicializa display
    Board* board = new Board();
    board->init();

#if LVGL_PORT_AVOID_TEARING_MODE
    // Com anti-tearing habilitado, o numero de frame buffers precisa ser
    // configurado no driver do LCD ANTES de board->begin().
    auto lcd = board->getLCD();
    lcd->configFrameBufferNumber(LVGL_PORT_DISP_BUFFER_NUM);
#if ESP_PANEL_DRIVERS_BUS_ENABLE_RGB && CONFIG_IDF_TARGET_ESP32S3
    auto lcd_bus = lcd->getBus();
    if (lcd_bus->getBasicAttributes().type == ESP_PANEL_BUS_TYPE_RGB) {
        static_cast<BusRGB *>(lcd_bus)->configRGB_BounceBufferSize(lcd->getFrameWidth() * 10);
    }
#endif
#endif

    board->begin();
    lvgl_port_init(board->getLcd(), board->getTouch());

    // Inicializa Modbus RS-485 (vfd_reset: inversor PARADO e freq zerada) + ESP-NOW
    modbus_init();
    comm_hard_reset_saidas();   // HARD RESET: todas as saidas das duas waveshares em OFF

    // --- App / backend ---
    wifi_init();        // conecta Wi-Fi e sincroniza canal ESP-NOW (apos ESP-NOW pronto)
    backend_init();     // inicializa cliente HTTP

    // Inicializa NVS (senhas, contadores, saldo)
    nvs_init();
    g_horas_manual = nvs_get_horas_manual();
    g_giro_dur_ms    = nvs_get_giro_dur();   // TEMPORARIO (tuning giro): restaura o tempo ajustado
    g_giro_timeout_ms = nvs_get_giro_to();   // TEMPORARIO (tuning giro): restaura o timeout ajustado
    // Programacao dos processos: se houver salvo na NVS, sobrescreve os defaults acima.
    nvs_load_modelos(g_modelos, sizeof(g_modelos));
    nvs_load_velocidades(g_velocidades, sizeof(g_velocidades));

    // Cria telas LVGL
    lvgl_port_lock(-1);
    tela_manual_criar(cb_ir_senha_cfg, cb_ir_auto, cb_ir_senha_pag);
    tela_auto_criar(cb_ir_manual);
    tela_config_criar(cb_ir_manual, cb_ir_velocidades, cb_ir_modelos, cb_ir_alterar_senhas);
    tela_velocidades_criar(cb_ir_config);
    tela_modelos_criar(cb_ir_config);
    tela_senha_criar();
    tela_senhas_cfg_criar(cb_ir_config);
    tela_wifi_criar(cb_ir_config);        // tela de configuracao Wi-Fi (Bloco 8.6)
    tela_config_set_wifi_cb(cb_ir_wifi);  // liga o botao Wi-Fi da tela de config
    lvgl_port_unlock();

    navegar_para(TELA_MANUAL);

    Serial.println("[LAVADORA] Display iniciado");
}

// -----------------------------------------------------------------------
// Loop principal
// -----------------------------------------------------------------------
void loop() {
    // Atualiza Modbus a cada 100ms
    static unsigned long t_modbus = 0;
    if (millis() - t_modbus >= 100) {
        t_modbus = millis();
        modbus_tick();
    }

    // Recuperacao no boot (retorno de energia): auto-home quando for seguro.
    // Roda ANTES do home_tick (e ela quem inicia/aborta o home).
    recuperacao_tick();

    // TEMPORARIO (debug): heartbeat dos sensores/estado a cada 1s, sempre.
    // Remover quando o diagnostico do X17/recuperacao terminar.
    static unsigned long t_dbg = 0;
    if (millis() - t_dbg >= 1000) {
        t_dbg = millis();
        Serial.printf("[DBG] X10=%d X0=%d | Y4=%d Y14=%d vfd=%d | X15=%d X16=%d X17=%d X12=%d | rec=%d auto=%d | wave_ok=%d hb1_ms=%lu hb2_ms=%lu\n",
            (int)X10, (int)io1_get_di(1),
            (int)((g_io1.do_ >> 3) & 1), (int)((g_io2.do_ >> 3) & 1), (int)g_vfd_mov,
            (int)X15, (int)HOME_GIRO, (int)X17, (int)X12,
            (int)recuperacao_ativa(), (int)g_estado_auto,
            (int)!comm_perdida(), (unsigned long)(millis() - g_hb1), (unsigned long)(millis() - g_hb2));
    }

    // Rotina de HOME (referenciamento) — roda sua maquina de estados se estiver
    // ativa; auto-throttled (retorna na hora se nao houver home em andamento).
    home_tick();

    // Vigia o fim de curso durante o movimento manual do carrinho (para
    // sozinho em X12/X13). Auto-throttled; retorna na hora se parado.
    desloc_tick();

    // --- App / backend (roda sempre, mesmo bloqueado por licenca) ---
    comm_espnow_canal_tick();   // Opção A: segue o canal anunciado pela câmera (MSG_CANAL)
    wifi_tick();                // Opção A: no-op (display sem Wi-Fi)
    backend_tick();
    licenca_tick();
    lampada_app_tick();

    // Atualiza icone Wi-Fi a cada 2s
    static uint32_t t_wifi_icon = 0;
    if (millis() - t_wifi_icon >= 2000) {
        t_wifi_icon = millis();
        ui_atualizar_wifi_icon();
    }

    // Maquina de estados automatica — tick a cada 50ms quando em modo AUTO
    static unsigned long t_auto = 0;
    if (g_estado.modo_auto && !recuperacao_ativa() && millis() - t_auto >= 50) {
        t_auto = millis();
        auto_tick();
    }

    // ===== Painel fisico (entradas da waveshare1) — leitura RAPIDA a 60ms =====
    //   X3 (DI4)=manual/auto (pulso/toggle)   X4 (DI5)=pause/retornar
    //   X1(DI2)=modelo1  X2(DI3)=modelo2  X5(DI6)=modelo3  X6(DI7)=modelo4
    // O round-robin normal le a io1 so a cada ~400ms (perde botao de pulso);
    // aqui lemos as 8 entradas do painel a cada 60ms.
    static unsigned long t_painel = 0;
    if (millis() - t_painel >= 60) {   // painel SEMPRE lido (remoto/X1/X3) — o ciclo em si e barrado pelo gate do auto_tick, nao aqui
        t_painel = millis();
        modbus_refresh_io1_di();

        // X3 — botao de pulso: cada toque ALTERNA manual <-> auto
        static bool x3_ant = false;
        bool x3 = io1_get_di(4);
        if (x3 && !x3_ant) {
            if (!g_estado.modo_auto) {
                g_estado.modo_auto = true;
                navegar_para(TELA_AUTO);
            } else {
                if (g_estado_auto != AUTO_IDLE) auto_cancelar();
                g_estado.modo_auto = false;
                navegar_para(TELA_MANUAL);
            }
        }
        x3_ant = x3;

        // Modelos — pode selecionar/trocar enquanto o ciclo ainda NAO comecou
        // (IDLE ou AGUARDA_CARRO). X1=DI2->1  X2=DI3->2  X5=DI6->3  X6=DI7->4
        static const uint8_t _mod_di[4]  = { 2, 3, 6, 7 };
        static bool          _mod_ant[4] = { false, false, false, false };
        for (int i = 0; i < 4; i++) {
            bool m = io1_get_di(_mod_di[i]);
            if (m && !_mod_ant[i] && g_estado.modo_auto &&
                (g_estado_auto == AUTO_IDLE || g_estado_auto == AUTO_AGUARDA_CARRO)) {
                uint8_t modelo = (uint8_t)(i + 1);
                navegar_para(TELA_AUTO);
                lvgl_port_lock(-1);
                tela_auto_marcar_programa(modelo);
                lvgl_port_unlock();
                auto_iniciar(modelo);
            }
            _mod_ant[i] = m;
        }

        // X4 (DI5) = pause/retornar — borda de subida (toggle)
        static bool x4_ant = false;
        bool x4 = io1_get_di(5);
        if (x4 && !x4_ant) {
            Serial.printf("[PAINEL] X4 (estado_auto=%d)\n", (int)g_estado_auto);
            if (g_estado_auto == AUTO_PROCESSO)      auto_pausar();
            else if (g_estado_auto == AUTO_PAUSADO)  auto_retomar();
            lvgl_port_lock(-1);
            tela_auto_atualizar_pausa();
            lvgl_port_unlock();
        }
        x4_ant = x4;
    }

    // Atualiza a tela ativa com o estado atual
    if (tela_atual == TELA_MANUAL) {
        static unsigned long t_ui = 0;
        if (millis() - t_ui >= 200) {
            t_ui = millis();
            // NAO le fresco aqui: durante o HOME isso relia o io2 e dava ACK no
            // latch do X16 ANTES do home_tick ler -> home perdia o sensor e dava
            // voltas. Mostra o CACHE (home_tick/desloc_tick/round-robin ja
            // atualizam g_ioX.di); o home_tick fica como UNICO leitor no home.
            lvgl_port_lock(-1);
            tela_manual_atualizar();
            lvgl_port_unlock();
        }
    } else if (tela_atual == TELA_AUTO) {
        static unsigned long t_ui_auto = 0;
        if (millis() - t_ui_auto >= 200) {
            t_ui_auto = millis();
            lvgl_port_lock(-1);
            tela_auto_atualizar_status();   // andamento do ciclo + erros (ex.: braco fora de posicao)
            tela_auto_atualizar_diag();     // sub-estado + sensores (diagnostico na tela)
            tela_auto_atualizar_pausa();
            lvgl_port_unlock();
        }
    }

    // Acumula horas com motor ativo em modo manual (Y4 giro braço, ou Y14
    // deslocamento carrinho — nunca os dois simultaneamente, ver trava de
    // segurança em modbus_master.h). Grava no NVS só a cada 60s pra não
    // desgastar a flash com escritas a cada segundo.
    static unsigned long t_horas      = 0;
    static unsigned long t_horas_save = 0;
    if (millis() - t_horas >= 1000) {
        unsigned long dt = millis() - t_horas;
        t_horas = millis();
        bool y4_ativo  = (g_io1.do_ >> 3) & 0x01;   // Y4  = W1 DO4
        bool y14_ativo = (g_io2.do_ >> 3) & 0x01;   // Y14 = W2 DO4
        if (!g_estado.modo_auto && (y4_ativo || y14_ativo)) {
            g_horas_manual += dt / 3600000.0f;      // ms -> horas
        }
    }
    if (millis() - t_horas_save >= 60000) {
        t_horas_save = millis();
        nvs_set_horas_manual(g_horas_manual);
    }

    // TODO: a maquina de estados da lavagem automatica ainda nao existe
    // (ver TODO em cb_btn_iniciar, tela_manual.h). Quando ela detectar o
    // fim de um ciclo (processo_ativo voltando a PROC_NENHUM apos rodar o
    // PROC_FIM do modelo), chamar aqui:
    //   nvs_inc_prog(g_estado.programa_sel);
    //   if (tela_atual == TELA_MANUAL) tela_manual_atualizar_contadores();

    delay(5);
}
