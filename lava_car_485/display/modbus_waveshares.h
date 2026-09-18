#pragma once
#include "tipos.h"
#include "vfd_rs485.h"   // barramento RS-485 compartilhado (mb_transacao/mb_read_di/mb_write_coil)

// =======================================================================
// modbus_waveshares.h — Display <-> Waveshares por RS-485 Modbus RTU.
// Substitui o antigo comm_espnow.h (waveshares migraram de rádio pra fio;
// a câmera continua em ESP-NOW à parte, sem mudança).
//
// Fornece a MESMA interface que o código de produção já espera
// (io1_get_di/io2_get_di/io1_set_do/io2_set_do/modbus_refresh_io*_di/
// comm_perdida/alarme_modbus) — só muda COMO os dados chegam: em vez do
// callback assíncrono do ESP-NOW, uma task de fundo faz o POLL contínuo
// das duas waveshares (vivo + latch) e do inversor.
//
// SENSORES:
//   Nivel:  X10,X12,X13,X14,X15,X16(HOME_GIRO)
//   Pulso (latch por interrupção na waveshare, read-and-clear): X0,X7 (W1)
//           · X11,X17 (W2)
// A leitura io*_get_di devolve (vivo | latch), igual a antes.
// =======================================================================

typedef struct { uint8_t di; uint8_t do_; } EstadoIO;
EstadoIO g_io1 = {0,0};    // g_ioX.di = snapshot consumido ; do_ = estado desejado
EstadoIO g_io2 = {0,0};

// Shadow atualizado pela task de poll (outra task) — protegido por spinlock,
// mesmo desenho de antes (só troca quem escreve: poll em vez de callback).
static volatile uint8_t  g_viv1=0, g_viv2=0;   // último estado AO VIVO (poll)
static volatile uint8_t  g_lat1=0, g_lat2=0;   // pulsos ACUMULADOS (latch), consumidos no refresh
static volatile uint32_t g_hb1=0, g_hb2=0;     // millis do último POLL COM SUCESSO de cada waveshare
static portMUX_TYPE      g_iomux = portMUX_INITIALIZER_UNLOCKED;

// Alarme na tela (msg deve ser string literal — g_estado guarda só o ponteiro).
void alarme_modbus(const char* msg) {
    g_estado.msg_alarme = msg;
    g_estado.alarme     = true;
}

// -----------------------------------------------------------------------
// Leitura das entradas (consome o latch dos pulsos, igual ao ACK antigo)
// -----------------------------------------------------------------------
static uint8_t g_pulso1 = 0, g_pulso2 = 0;

void modbus_refresh_io1_di() {
    portENTER_CRITICAL(&g_iomux);
    g_pulso1 = g_lat1;
    g_io1.di = g_viv1 | g_lat1;
    g_lat1 = 0;
    portEXIT_CRITICAL(&g_iomux);
}
void modbus_refresh_io2_di() {
    portENTER_CRITICAL(&g_iomux);
    g_pulso2 = g_lat2;
    g_io2.di = g_viv2 | g_lat2;
    g_lat2 = 0;
    portEXIT_CRITICAL(&g_iomux);
}
bool io1_pulso(uint8_t canal) { return (g_pulso1 >> (canal-1)) & 0x01; }
bool io2_pulso(uint8_t canal) { return (g_pulso2 >> (canal-1)) & 0x01; }

// NIVEL: lê o shadow AO VIVO (sempre fresco pelo poll) -> não depende de
//        refresh em cada estado (ex.: X14/X15).
// PULSO: lê o snapshot CONSUMIDO (g_ioX.di) -> a passagem rápida fica
//        retida até o modbus_refresh consumir o latch (giro/home/carrinho).
bool io1_get_di(uint8_t canal) {
    uint8_t bit = 1 << (canal-1);
    if (bit & PULSO_W1_MASK) return (g_io1.di & bit) != 0;   // X0, X7
    return (g_viv1 & bit) != 0;                              // nível ao vivo
}
bool io2_get_di(uint8_t canal) {
    uint8_t bit = 1 << (canal-1);
    if (bit & PULSO_W2_MASK) return (g_io2.di & bit) != 0;   // X11, X17
    return (g_viv2 & bit) != 0;                              // nível ao vivo
}

// -----------------------------------------------------------------------
// Saidas — grava via Modbus (FC05, com ACK real do escravo). Trava Y4<->Y14
// e Y7 (bomba de espuma), igual à regra de segurança de antes.
// -----------------------------------------------------------------------
void io1_set_do(uint8_t canal, bool estado) {
    if (canal < 1 || canal > 8) return;
    if (canal == 4 && estado && (g_io2.do_ & (1 << 3))) {   // trava: Y14 ativo -> não liga Y4
        alarme_modbus("[SEGURANCA] deslocamento ativo ao ligar giro"); return;
    }
    // Y7 (bomba de espuma "cima"): só liga se algum solenoide de espuma/cera
    // estiver ligado — Y2 (Espuma A), Y3 (Espuma B) ou Y10 (Cera de água).
    if (canal == 7 && estado &&
        !((g_io1.do_ & (1 << 1)) || (g_io1.do_ & (1 << 2)) || (g_io2.do_ & (1 << 0)))) {
        Serial.println("[SEGURANCA] Y7 bloqueado: nenhum solenoide de espuma/cera (Y2/Y3/Y10) ligado");
        return;
    }
    if (!mb_write_coil(MB_ADDR_IO1, canal - 1, estado)) {
        alarme_modbus("[MODBUS] comando W1 nao confirmado (sem resposta)");
        Serial.printf("[MODBUS] FALHA write W1 canal=%d estado=%d\n", canal, estado);
        return;   // não atualiza o espelho local se o escravo não confirmou
    }
    g_hb1 = millis();   // write com ACK também conta como "vivo"
    if (estado) g_io1.do_ |=  (1 << (canal-1));
    else        g_io1.do_ &= ~(1 << (canal-1));
}
void io2_set_do(uint8_t canal, bool estado) {
    if (canal < 1 || canal > 8) return;
    if (canal == 4 && estado && (g_io1.do_ & (1 << 3))) {   // trava: Y4 ativo -> não liga Y14
        alarme_modbus("[SEGURANCA] giro ativo ao ligar deslocamento"); return;
    }
    if (!mb_write_coil(MB_ADDR_IO2, canal - 1, estado)) {
        alarme_modbus("[MODBUS] comando W2 nao confirmado (sem resposta)");
        Serial.printf("[MODBUS] FALHA write W2 canal=%d estado=%d\n", canal, estado);
        return;
    }
    g_hb2 = millis();
    if (estado) g_io2.do_ |=  (1 << (canal-1));
    else        g_io2.do_ &= ~(1 << (canal-1));
}

// -----------------------------------------------------------------------
// Watchdog de comunicação
// -----------------------------------------------------------------------
bool comm_perdida() {
    uint32_t now = millis();
    return (now - g_hb1 > COMM_TIMEOUT_MS) || (now - g_hb2 > COMM_TIMEOUT_MS);
}

// -----------------------------------------------------------------------
// Alarme de comunicação — bem mais simples que a versão ESP-NOW: não existe
// "canal" pra perder num barramento cabeado. Só avisa cedo (60s) se uma
// waveshare parar de responder; some sozinho quando voltar.
// -----------------------------------------------------------------------
#define WAVE_ALARME_MS 60000UL
static bool g_alarme_wave_ativo = false;
extern EstadoAuto g_estado_auto;

static void wave_alarme_tick() {
    uint32_t agora = millis();
    bool perdida1 = (agora - g_hb1 > WAVE_ALARME_MS);
    bool perdida2 = (agora - g_hb2 > WAVE_ALARME_MS);
    if (perdida1 || perdida2) {
        const char* msg = (perdida1 && perdida2) ? "Waveshare 1 e 2 sem contato (RS-485)"
                         : perdida1               ? "Waveshare 1 sem contato (RS-485)"
                                                   : "Waveshare 2 sem contato (RS-485)";
        // Não sobrescreve a mensagem de um erro real já ativo (AUTO_ERRO) —
        // mesma lógica do alarme de câmera (ver comm_espnow.h).
        if (g_estado_auto != AUTO_ERRO) alarme_modbus(msg);
        g_alarme_wave_ativo = true;
    } else if (g_alarme_wave_ativo) {
        g_alarme_wave_ativo = false;
        if (g_estado_auto != AUTO_ERRO) g_estado.alarme = false;
    }
}

// -----------------------------------------------------------------------
// TASK DE POLL — fora da task do LVGL/loop principal. Le vivo+latch das
// duas waveshares em rodízio, mais o inversor, continuamente. Prioridade
// moderada (2, abaixo do que a UI normalmente usa) e SEMPRE cede a CPU
// (mb_transacao já faz vTaskDelay(1) enquanto espera resposta) — não trava
// o toque, mesmo polling sem parar.
// -----------------------------------------------------------------------
// Contadores de diagnóstico — quantas leituras deram certo/errado desde o
// boot, pra medir a taxa de erro real do barramento (não só "tem erro ou
// não", mas QUANTO). Impresso a cada 5s.
static uint32_t g_poll_ok = 0, g_poll_falha = 0;

static void modbus_poll_task(void* arg) {
    static uint32_t t_diag = 0;
    for (;;) {
        uint8_t v = 0, l = 0;
        uint32_t t_med = millis();
        bool ok_v1 = mb_read_di(MB_ADDR_IO1, MB_DI_VIVO, 8, &v);
        uint32_t dur_v1 = millis() - t_med;
        static uint32_t t_log_dur = 0;
        if (millis() - t_log_dur >= 3000) {
            t_log_dur = millis();
            Serial.printf("[MODBUS-TEMPO] leitura W1 vivo: %lums (ok=%d)\n", (unsigned long)dur_v1, (int)ok_v1);
        }
        if (ok_v1) {
            portENTER_CRITICAL(&g_iomux); g_viv1 = v; portEXIT_CRITICAL(&g_iomux);
            g_hb1 = millis(); g_poll_ok++;
        } else g_poll_falha++;
        if (mb_read_di(MB_ADDR_IO1, MB_DI_LATCH, 8, &l)) {
            if (l) { portENTER_CRITICAL(&g_iomux); g_lat1 |= l; portEXIT_CRITICAL(&g_iomux); }
            g_poll_ok++;
        } else g_poll_falha++;
        if (mb_read_di(MB_ADDR_IO2, MB_DI_VIVO, 8, &v)) {
            portENTER_CRITICAL(&g_iomux); g_viv2 = v; portEXIT_CRITICAL(&g_iomux);
            g_hb2 = millis(); g_poll_ok++;
        } else g_poll_falha++;
        if (mb_read_di(MB_ADDR_IO2, MB_DI_LATCH, 8, &l)) {
            if (l) { portENTER_CRITICAL(&g_iomux); g_lat2 |= l; portEXIT_CRITICAL(&g_iomux); }
            g_poll_ok++;
        } else g_poll_falha++;
        wave_alarme_tick();

        if (millis() - t_diag >= 5000) {
            t_diag = millis();
            uint32_t total = g_poll_ok + g_poll_falha;
            Serial.printf("[MODBUS-DIAG] ok=%lu falha=%lu (%.1f%% erro em %lu transacoes)\n",
                          (unsigned long)g_poll_ok, (unsigned long)g_poll_falha,
                          total ? (100.0f * g_poll_falha / total) : 0.0f, (unsigned long)total);
        }
        vTaskDelay(pdMS_TO_TICKS(20));   // ~50Hz de poll — bem acima do que qualquer processo precisa
    }
}

// -----------------------------------------------------------------------
// Inicialização — sobe o barramento RS-485 (display+2 waveshares+inversor)
// e a task de poll. Nome mantido (modbus_init) por compatibilidade com o
// display.ino/setup() já existente.
// -----------------------------------------------------------------------
void modbus_init() {
    vfd_rs485_init();   // UART1 compartilhada -> inversor + waveshares
    // Core 0 (não core 1): no teste isolado que validamos, a tela era simples
    // (1 tela, poucos widgets) e essa task no core 1 ficava rápida. Na
    // produção real são 8 telas LVGL bem mais pesadas rodando no mesmo core —
    // mesmo com prioridade maior, a task de poll ficava espremida nos
    // intervalos entre repaints, e cada leitura (que deveria ser <20ms)
    // media ~100ms+. Tirando pro core 0, sem disputa nenhuma com a UI.
    xTaskCreatePinnedToCore(modbus_poll_task, "mbpoll", 4096, NULL, 2, NULL, 0);
    Serial.println("[MODBUS] display pronto (RS-485: W1=1 W2=2 INV=3)");
}

// HARD RESET das saidas: manda OFF para os 8 canais das DUAS waveshares e zera
// o espelho local. Chamado no boot: mesmo que só o display tenha reiniciado,
// nenhum contator/solenoide fica ligado "herdado".
void comm_hard_reset_saidas() {
    for (uint8_t canal = 0; canal < 8; canal++) {
        mb_write_coil(MB_ADDR_IO1, canal, false); delay(5);
        mb_write_coil(MB_ADDR_IO2, canal, false); delay(5);
    }
    g_io1.do_ = 0; g_io2.do_ = 0;
    Serial.println("[HARD RESET] saidas das waveshares em OFF");
}

// =======================================================================
// HOME — referenciamento (giro anti-horario ate X16 E X17, depois desloca até X12)
//   Desacelera pelo X11 (rampa 15->5Hz). Termina só quando X16 E X17 juntos.
// (Copiado sem mudança de lógica do antigo comm_espnow.h — só o transporte
// dos io*_get_di/io*_set_do por baixo mudou.)
// =======================================================================
#define HOME_FREQ_HZ10   150
#define HOME_TIMEOUT_MS  25000
#define HOME_TIMEOUT_DESLOC_MS 50000
#define HOME_X0_WD_MS    4000
#define HOME_DESAC_FLOOR  50
#define HOME_DESAC_MS   2000

enum { HOME_IDLE=0, HOME_FASE_GIRO, HOME_FASE_PARADA, HOME_FASE_DESLOC, HOME_OK, HOME_FALHA };
static uint8_t     g_home_estado = HOME_IDLE;
static uint32_t    g_home_t0 = 0;
static const char* g_home_msg = "";
static uint32_t    g_home_x0_t   = 0;
static bool        g_home_x0_ant = false;

static inline bool home_sensor_giro() { return (g_io2.di >> 7) & 0x01; }  // X16 (HOME_GIRO)
static inline bool home_sensor_x17()  { return (g_io2.di >> 6) & 0x01; }  // X17
static inline bool home_sensor_x11()  { return (g_io2.di >> 1) & 0x01; }  // X11 (pulso)
static inline bool home_sensor_x12()  { return (g_io2.di >> 2) & 0x01; }  // X12

bool        home_rodando()  { return g_home_estado==HOME_FASE_GIRO || g_home_estado==HOME_FASE_PARADA || g_home_estado==HOME_FASE_DESLOC; }
int         home_estado()   { return (int)g_home_estado; }
const char* home_mensagem() { return g_home_msg; }

static void home_parar_tudo() {
    vfd_stop(); io1_set_do(4,false); io2_set_do(4,false);
}
void home_reset() { home_parar_tudo(); g_home_estado = HOME_IDLE; g_home_msg = ""; }
static void home_iniciar_fase_desloc() {
    modbus_refresh_io2_di();
    if (home_sensor_x12()) { home_parar_tudo(); g_home_estado=HOME_OK; g_home_msg="HOME concluido"; return; }
    g_home_estado = HOME_FASE_DESLOC; g_home_t0 = millis(); g_home_msg = "HOME: recuando ate X12...";
    g_home_x0_t = millis(); g_home_x0_ant = io1_get_di(1);
    io2_set_do(4,true); vfd_run_rev(HOME_FREQ_HZ10);
}
void home_iniciar() {
    if (home_rodando()) { home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME cancelado"; return; }
    home_parar_tudo();
    modbus_refresh_io2_di();
    if (home_sensor_giro() && home_sensor_x17()) { home_iniciar_fase_desloc(); return; }
    g_home_estado = HOME_FASE_GIRO; g_home_t0 = millis(); g_home_msg = "HOME: buscando giro...";
    io1_set_do(4,true); vfd_run_rev(HOME_FREQ_HZ10);
}
void home_tick() {
    if (!home_rodando()) return;

    if (g_home_estado == HOME_FASE_GIRO) {
        bool desac=false; uint32_t t_desac=0, t_ramp=0;
        modbus_refresh_io2_di();
        for (;;) {
            modbus_refresh_io2_di();
            if (home_sensor_giro() && home_sensor_x17()) {
                vfd_stop(); io1_set_do(4,false);
                g_home_estado = HOME_FASE_PARADA; g_home_t0 = millis(); g_home_msg = "HOME: parando...";
                return;
            }
            if (!desac && home_sensor_x11()) { desac=true; t_desac=millis(); }
            if (desac) {
                uint32_t ag = millis();
                if (ag - t_ramp >= 120) {
                    t_ramp = ag; uint32_t dt = ag - t_desac;
                    uint16_t f = (dt >= HOME_DESAC_MS) ? HOME_DESAC_FLOOR
                        : (uint16_t)(HOME_FREQ_HZ10 - (uint32_t)(HOME_FREQ_HZ10 - HOME_DESAC_FLOOR)*dt/HOME_DESAC_MS);
                    vfd_run_rev(f);
                }
            }
            if (millis() - g_home_t0 > HOME_TIMEOUT_MS) {
                home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: giro nao achado"; return;
            }
            if (comm_perdida()) { home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: comunicacao"; return; }
            delay(10);
        }
    }

    static uint32_t t_le = 0;
    if (millis() - t_le < 30) return;
    t_le = millis();
    modbus_refresh_io2_di();
    if (g_home_estado == HOME_FASE_PARADA) {
        vfd_stop();
        if (millis() - g_home_t0 >= 1500) home_iniciar_fase_desloc();
    } else if (g_home_estado == HOME_FASE_DESLOC) {
        if (home_sensor_x12()) { vfd_stop(); io2_set_do(4,false); g_home_estado=HOME_OK; g_home_msg="HOME concluido"; return; }

        modbus_refresh_io1_di();
        if (io1_get_di(4) || io1_get_di(5)) {
            home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME interrompido pelo painel"; return;
        }

        for (uint8_t k = 0; k < 5; k++) {
            bool x0 = io1_get_di(1);
            if (x0 != g_home_x0_ant) { g_home_x0_t = millis(); g_home_x0_ant = x0; }
            if (k < 4) modbus_refresh_io1_di();
        }
        if (millis() - g_home_x0_t > HOME_X0_WD_MS) {
            home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: carro travado (X0)"; return;
        }

        if (millis() - g_home_t0 > HOME_TIMEOUT_DESLOC_MS) { home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: X12 nao achado"; }
    }
}

// =======================================================================
// Deslocamento manual do carrinho (fim de curso X12/X13)
// =======================================================================
enum DeslocDir { DESLOC_PARADO=0, DESLOC_FRENTE=1, DESLOC_TRAS=2 };
static DeslocDir g_desloc_dir = DESLOC_PARADO;
static inline bool desloc_lim_x12() { return (g_io2.di >> 2) & 0x01; }
static inline bool desloc_lim_x13() { return (g_io2.di >> 3) & 0x01; }
bool desloc_movendo() { return g_desloc_dir != DESLOC_PARADO; }
void desloc_parar() { g_desloc_dir=DESLOC_PARADO; vfd_stop(); io2_set_do(4,false); }
bool desloc_frente_iniciar(uint16_t f) { modbus_refresh_io2_di(); if (desloc_lim_x13()) return false; g_desloc_dir=DESLOC_FRENTE; io2_set_do(4,true); vfd_run_fwd(f); return true; }
bool desloc_tras_iniciar(uint16_t f)   { modbus_refresh_io2_di(); if (desloc_lim_x12()) return false; g_desloc_dir=DESLOC_TRAS;   io2_set_do(4,true); vfd_run_rev(f); return true; }
void desloc_tick() {
    if (g_desloc_dir == DESLOC_PARADO) return;
    static uint32_t t = 0;
    if (millis() - t < 30) return;
    t = millis();
    modbus_refresh_io2_di();
    if (g_desloc_dir==DESLOC_FRENTE && desloc_lim_x13()) desloc_parar();
    else if (g_desloc_dir==DESLOC_TRAS && desloc_lim_x12()) desloc_parar();
}

// modbus_tick(): poll do inversor, suspenso durante home/processo — mesmo
// comportamento de antes (evita disputar o barramento com o que é urgente).
void modbus_tick() {
    if (home_rodando()) return;
    if (g_estado_auto == AUTO_PROCESSO) return;
    vfd_poll();
}
