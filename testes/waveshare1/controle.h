#pragma once
#include <Wire.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include "tipos_w1.h"
#include "protocolo_teste.h"
#include "vfd_rs485_w1.h"
#include "saj_rs485_w1.h"

// =======================================================================
// controle.h — Waveshare 1 como CONTROLADORA. Fornece a MESMA interface
// que maquina_estados.h/processos.h ja esperam (io1/io2_get_di/set_do,
// modbus_refresh_io*_di, comm_perdida, alarme_modbus, home_*, desloc_*,
// modbus_tick/init) — só que:
//   - io1 (X0,X1..X7) = HARDWARE LOCAL desta placa (direto, sem rede)
//   - io2 (X10..X17)  = Waveshare 2, via ESP-NOW (mesmo padrao que o
//     display usava, só que agora o mestre e esta placa)
// =======================================================================

// ---- I2C / PCA9554 (saidas desta placa) ----
#define I2C_SDA 42
#define I2C_SCL 41
#define PCA9554_ADDR 0x20
#define PCA9554_REG_OUTPUT 0x01
#define PCA9554_REG_CONFIG 0x03
#define DO_LOGICA_INVERTIDA 1

#define LED_PIN 38
static inline void led_cor(uint8_t r,uint8_t g,uint8_t b){ rgbLedWrite(LED_PIN,r,g,b); }
static uint32_t led_off_em = 0;
static void led_pisca(uint8_t r,uint8_t g,uint8_t b){ led_cor(r,g,b); led_off_em = millis()+30; }
static void led_tick(){ if (led_off_em && millis()>=led_off_em){ led_cor(0,0,0); led_off_em=0; } }

// ---- DIs locais (X0,X1..X7) ----
#define DI1_PIN 4    // X0 — sensor indutivo deslocamento (pulso)
#define DI2_PIN 5    // X1 — botao modelo 1
#define DI3_PIN 6    // X2 — botao modelo 2
#define DI4_PIN 7    // X3 — manual/automatico
#define DI5_PIN 8    // X4 — pause
#define DI6_PIN 9    // X5 — botao modelo 3
#define DI7_PIN 10   // X6 — botao modelo 4
#define DI8_PIN 11   // X7 — sensor giro braco (pulso)
static const uint8_t DI_PINS[8] = { DI1_PIN,DI2_PIN,DI3_PIN,DI4_PIN,DI5_PIN,DI6_PIN,DI7_PIN,DI8_PIN };

#define DEBOUNCE_US 800
static volatile uint8_t  g_viv1 = 0;   // nivel ao vivo local
static volatile uint8_t  g_lat1 = 0;   // latch acumulado local (ISR seta, refresh consome)
static volatile uint32_t g_ult_us1[8] = {0,0,0,0,0,0,0,0};

void IRAM_ATTR di1_isr(void* arg) {
    uint32_t canal = (uint32_t)arg;
    uint32_t agora = micros();
    if (agora - g_ult_us1[canal] < DEBOUNCE_US) return;
    g_ult_us1[canal] = agora;
    g_lat1 |= (1 << canal);
}
static uint8_t le_entradas_vivo_local() {
    uint8_t v = 0;
    for (uint8_t i=0;i<8;i++) if (digitalRead(DI_PINS[i])==LOW) v |= (1<<i);
    return v;
}

// ---- DOs locais (Y1,Y2,Y3,Y4,Y5,Y6,Y7,Y11) via PCA9554 ----
#define CANAL_TRAVADO 3     // DO4 = Y4 (contator giro): cooldown entre desligar/religar
#define TRAVA_MS      500
static uint8_t       do_estado1 = 0x00;
static unsigned long ult_off_travado1 = 0;
static bool          primeiro_ciclo_trava1 = true;

static void pca_write(uint8_t reg,uint8_t val){ Wire.beginTransmission(PCA9554_ADDR); Wire.write(reg); Wire.write(val); Wire.endTransmission(); }
static void pca_init(){ pca_write(PCA9554_REG_CONFIG,0x00); pca_write(PCA9554_REG_OUTPUT, DO_LOGICA_INVERTIDA?0xFF:0x00); do_estado1=0x00; }
static void pca_aplica(){ pca_write(PCA9554_REG_OUTPUT, DO_LOGICA_INVERTIDA?(uint8_t)~do_estado1:do_estado1); }

static bool escreve_do_local(uint8_t canal, bool ligar) {
    if (canal > 7) return false;
    bool estava = (do_estado1>>canal)&1;
    if (canal == CANAL_TRAVADO) {
        if (ligar) { if (!primeiro_ciclo_trava1 && (millis()-ult_off_travado1) < TRAVA_MS) return false; }
        else if (estava) { ult_off_travado1 = millis(); primeiro_ciclo_trava1 = false; }
    }
    if (ligar) do_estado1 |= (1<<canal); else do_estado1 &= ~(1<<canal);
    pca_aplica();
    return true;
}

void alarme_modbus(const char* msg);   // fwd (definida mais abaixo)

// ---- IO1 = LOCAL — mesma interface que processos.h/maquina_estados.h ja usam ----
typedef struct { uint8_t di; uint8_t do_; } EstadoIO;
EstadoIO g_io1 = {0,0};
EstadoIO g_io2 = {0,0};

static uint8_t g_pulso1 = 0, g_pulso2 = 0;

void modbus_refresh_io1_di() {
    noInterrupts();
    g_pulso1 = g_lat1;
    g_viv1 = le_entradas_vivo_local();
    g_io1.di = g_viv1 | g_lat1;
    g_lat1 &= ~PULSO_W1_MASK;   // so zera os pulsos de X0/X7; os bits do painel (X1..X6) ficam pro painel_tick consumir
    interrupts();
}
bool io1_pulso(uint8_t canal) { return (g_pulso1 >> (canal-1)) & 0x01; }
bool io1_get_di(uint8_t canal) {
    uint8_t bit = 1 << (canal-1);
    if (bit & PULSO_W1_MASK) return (g_io1.di & bit) != 0;
    return (le_entradas_vivo_local() & bit) != 0;
}
void io1_set_do(uint8_t canal, bool estado) {
    if (canal < 1 || canal > 8) return;
    if (canal == 4 && estado && (g_io2.do_ & (1 << 3))) {
        alarme_modbus("[SEGURANCA] deslocamento ativo ao ligar giro"); return;
    }
    if (canal == 7 && estado &&
        !((do_estado1 & (1 << 1)) || (do_estado1 & (1 << 2)) || (g_io2.do_ & (1 << 0)))) {
        DBG_PRINTLN("[SEGURANCA] Y7 bloqueado: nenhum solenoide de espuma/cera (Y2/Y3/Y10) ligado");
        return;
    }
    escreve_do_local(canal - 1, estado);
    if (estado) g_io1.do_ |=  (1 << (canal-1));
    else        g_io1.do_ &= ~(1 << (canal-1));
}

// ---- IO2 = Waveshare 2, via ESP-NOW (mesmo padrao que o display usava) ----
static volatile uint8_t  g_viv2=0, g_lat2=0;

// ---- Captura de X16 (HOME_GIRO, bit7) e X17 (bit6) FEITA NO CALLBACK DO ESP-NOW ----
// Achado em campo: com o RS-485 ruidoso, escritas que falham seguram o loop() por
// centenas de ms e o giro_tick() so amostrava os sensores a cada 0,6-1,9 s — o X16
// acendeu por 0,6 s e apagou entre duas amostras (nunca foi visto). O callback roda
// em outra tarefa e NAO fica preso no RS-485: ele registra aqui quando cada sensor
// ficou ativo e o giro_tick() consulta. Confirmado = visto ativo por >= 100ms
// (mesmo criterio de debounce do giro_tick).
static bool     g_x16_up = false, g_x17_up = false;
static uint32_t g_x16_rise = 0, g_x17_rise = 0;
static bool     g_x16_conf = false, g_x17_conf = false;
static inline void w2_amostra_home(uint8_t di, uint32_t agora) {   // chamar DENTRO da secao critica g_iomux2
    bool b16 = (di & 0x80) != 0, b17 = (di & 0x40) != 0;
    if (b16) { if (!g_x16_up) { g_x16_up = true; g_x16_rise = agora; } if (agora - g_x16_rise >= 100) g_x16_conf = true; }
    else     { g_x16_up = false; }
    if (b17) { if (!g_x17_up) { g_x17_up = true; g_x17_rise = agora; } if (agora - g_x17_rise >= 100) g_x17_conf = true; }
    else     { g_x17_up = false; }
}
static volatile uint32_t g_hb2=0;
// Diagnostico do enlace (resumo [LINK] a cada 5 s no serial):
static uint32_t          g_w2_prev_ms = 0, g_w2_gap_max = 0;      // maior intervalo entre pacotes da W2
static volatile uint32_t g_tx_ok = 0, g_tx_fail = 0;              // entrega dos envios por radio (display e W2)
uint16_t                 g_loop_max_5s = 0;
static uint32_t          g_recon_n = 0;                            // saidas da W2 reenviadas por divergencia (comandado x real)                       // maior pausa do loop() na janela de 5 s
static inline void w2_gap_atualiza(uint32_t agora) {              // chamar dentro da secao critica g_iomux2
    if (g_w2_prev_ms) { uint32_t gp = agora - g_w2_prev_ms; if (gp > g_w2_gap_max) g_w2_gap_max = gp; }
    g_w2_prev_ms = agora;
}
static volatile uint8_t  g_w2_do_real=0;   // do_estado informado pela W2 no ultimo heartbeat (o que ela REALMENTE ligou)
static portMUX_TYPE       g_iomux2 = portMUX_INITIALIZER_UNLOCKED;
static uint8_t            g_ws_seq = 0;

// Limpa a memoria de X16/X17 (chamar quando o braco SAI da posicao 2: so conta o que vier depois).
static void w2_home_limpa() {
    portENTER_CRITICAL(&g_iomux2);
    g_x16_conf = false; g_x17_conf = false;
    if (g_x16_up) g_x16_rise = millis();   // se ja esta ativo, exige >=100ms NOVOS
    if (g_x17_up) g_x17_rise = millis();
    portEXIT_CRITICAL(&g_iomux2);
}
static void w2_home_le(bool* x16, bool* x17) {
    portENTER_CRITICAL(&g_iomux2);
    *x16 = g_x16_conf; *x17 = g_x17_conf;
    portEXIT_CRITICAL(&g_iomux2);
}

void modbus_refresh_io2_di() {
    portENTER_CRITICAL(&g_iomux2);
    g_pulso2 = g_lat2;
    g_io2.di = g_viv2 | g_lat2;
    g_lat2 = 0;
    portEXIT_CRITICAL(&g_iomux2);
}
bool io2_pulso(uint8_t canal) { return (g_pulso2 >> (canal-1)) & 0x01; }
bool io2_get_di(uint8_t canal) {
    uint8_t bit = 1 << (canal-1);
    if (bit & PULSO_W2_MASK) return (g_io2.di & bit) != 0;
    return (g_viv2 & bit) != 0;
}
static void ws2_envia_comando(uint8_t canal, uint8_t estado) {
    MsgComando m;
    m.cab.tipo = MSG_COMANDO; m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem = ORIGEM_WAVE1; m.cab.seq = g_ws_seq++;
    m.canal = canal; m.estado = estado;
    esp_now_send((uint8_t*)MAC_WAVE2, (uint8_t*)&m, sizeof(m));
}
void io2_set_do(uint8_t canal, bool estado) {
    if (canal < 1 || canal > 8) return;
    if (canal == 4 && estado && (g_io1.do_ & (1 << 3))) {
        alarme_modbus("[SEGURANCA] giro ativo ao ligar deslocamento"); return;
    }
    ws2_envia_comando(canal - 1, estado ? 1 : 0);
    if (estado) g_io2.do_ |=  (1 << (canal-1));
    else        g_io2.do_ &= ~(1 << (canal-1));
}

// ---- Alarme ----
void alarme_modbus(const char* msg) {
    g_estado.msg_alarme = msg;
    g_estado.alarme     = true;
}

// ---- Watchdog de comunicacao com a Waveshare 2 ----
bool comm_perdida() {
    return (millis() - g_hb2) > COMM_TIMEOUT_MS;
}
#define WAVE2_ALARME_MS 60000UL
static bool g_alarme_wave2_ativo = false;
static void wave2_alarme_tick() {
    bool perdida = (millis() - g_hb2) > WAVE2_ALARME_MS;
    if (perdida) {
        if (g_estado_auto != AUTO_ERRO) alarme_modbus("Waveshare 2 sem contato (radio)");
        g_alarme_wave2_ativo = true;
    } else if (g_alarme_wave2_ativo) {
        g_alarme_wave2_ativo = false;
        if (g_estado_auto != AUTO_ERRO) g_estado.alarme = false;
    }
}

// ---- Stubs: nuvem/licenca/contadores agora vivem no DISPLAY (ve-los pela
// transicao de estado em MsgStatus) — esta placa so cuida do ciclo fisico. ----
void backend_evt_car_entered() {}
void backend_evt_wash_complete(uint8_t programId, const String& source) { (void)programId; (void)source; }
void backend_evt_fault(const char* errorCode) { (void)errorCode; }
bool licenca_bloqueada() { return false; }   // gate ja acontece no display antes de mandar "iniciar"
String nvs_get_last_res_id() { return String(""); }
void nvs_inc_prog_app(uint8_t p) { (void)p; }
void nvs_inc_prog_pres(uint8_t p) { (void)p; }
void nvs_inc_prog(uint8_t p) { (void)p; }

// =======================================================================
// HOME — referenciamento. SEM MUDANCA DE LOGICA (copiado do que o display
// ja tinha em comm_waveshares_espnow.h).
// =======================================================================
// ---- Fila de comandos do display (item 1 da auditoria) ----
// O callback do ESP-NOW NAO executa nada: so coloca o comando aqui. Quem executa e o loop(),
// que chama processa_comandos() no topo de cada volta e dentro das esperas longas (HOME,
// parada do motor). PARAR e uma flag a parte (g_parar_pedido), checada tambem DENTRO das
// esperas bloqueantes para o motor nao ser religado depois de um PARAR.
typedef struct { uint8_t op, tabela, i1, i2; uint16_t valor; } CfgItem;     // op 0 = gravar, 1 = pedir tabela
static uint8_t  g_data_dia = 0, g_data_mes = 0;  static uint16_t g_data_ano = 0;   // data de hoje (0 = desconhecida; vem de MSG_TESTE_DATA)
static volatile uint8_t g_canal_pedido = 0;   // canal pedido pelo display (MSG_CANAL); o loop executa (canal_tick)
static uint32_t g_tec_ping_ms = 0;      // ultimo "tecnico presente" enviado pelo display (acao 70): luzes da maquina
static uint8_t  g_man_sai = 0;          // saidas MANUAIS ligadas (ver bloco SAIDAS MANUAIS)
static uint32_t g_man_sai_t0 = 0;
static QueueHandle_t   g_fila_cfg = nullptr;   // elementos CfgItem (o callback so enfileira; NVS/envio no loop)
static QueueHandle_t   g_fila_cmd = nullptr;   // elementos uint16_t: acao | (arg << 8)
void processa_comandos();   // definida mais abaixo

// ---- Movimento MANUAL segurando o botao (homem morto) ----
// O callback so anota "estou segurando" (g_manual_cmd/g_manual_ms). Quem move o motor e o loop
// (manual_tick): se nao chegar nenhum pacote de "segurando" por MANUAL_DEADMAN_MS, ele PARA
// (display travado, rádio caiu, dedo fora do botao). Codigos: 10=giro horario 11=giro anti-horario
// 12=carrinho frente 13=carrinho tras; 0=solto.
volatile uint8_t   g_manual_cmd = 0;
volatile uint32_t  g_manual_ms  = 0;
static uint8_t     g_manual_ativo = 0;        // o que esta realmente em movimento
static uint32_t    g_manual_t0 = 0;
static const char* g_manual_msg = "";         // aviso mostrado na tela por alguns segundos
static uint32_t    g_manual_msg_ms = 0;
#define MANUAL_FREQ_HZ10   150                // 15 Hz
#define MANUAL_DEADMAN_MS  500
#define MANUAL_MAX_MS      20000              // teto de seguranca por acionamento

#define HOME_FREQ_HZ10   400
#define HOME_TIMEOUT_MS  25000
#define HOME_TIMEOUT_DESLOC_MS 50000
#define HOME_X0_WD_MS    4000
#define HOME_DESAC_FLOOR  50
#define HOME_DESAC_MS   2000
#define HOME_X12_RAMPA_MS      350
#define HOME_X12_RAMPA_STEP_MS 100

enum { HOME_IDLE=0, HOME_FASE_GIRO, HOME_FASE_PARADA, HOME_FASE_DESLOC, HOME_FASE_X12_RAMPA, HOME_OK, HOME_FALHA };
static uint8_t     g_home_estado = HOME_IDLE;
static uint32_t    g_home_t0 = 0;
static const char* g_home_msg = "";
static uint32_t    g_home_x0_t   = 0;
static bool        g_home_x0_ant = false;
static uint32_t    g_home_x12_t0    = 0;
static uint32_t    g_home_x12_t_ramp= 0;
static bool        _hg_desac = false;     // busca do giro: rampa de desaceleracao ja comecou?
static uint32_t    _hg_t_desac = 0, _hg_t_ramp = 0;

static inline bool home_sensor_giro() { return (g_io2.di >> 7) & 0x01; }
static inline bool home_sensor_x17()  { return (g_io2.di >> 6) & 0x01; }
static inline bool home_sensor_x11()  { return (g_io2.di >> 1) & 0x01; }
static inline bool home_sensor_x12()  { return (g_io2.di >> 2) & 0x01; }

bool        home_rodando()  { return g_home_estado==HOME_FASE_GIRO || g_home_estado==HOME_FASE_PARADA || g_home_estado==HOME_FASE_DESLOC || g_home_estado==HOME_FASE_X12_RAMPA; }
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
    _hg_desac = false; _hg_t_desac = 0; _hg_t_ramp = 0;
    io1_set_do(4,true); vfd_run_rev(HOME_FREQ_HZ10);
}
void home_tick() {
    if (!home_rodando()) return;
    if (g_home_estado == HOME_FASE_GIRO) {
        // UMA passada por chamada — nao bloqueia o loop(): o status segue saindo pro display,
        // os comandos (PARAR/cancelar) sao processados no topo do loop e o watchdog e alimentado
        // normalmente. (Antes era um laco for(;;) de ate 25 s que prendia tudo.)
        modbus_refresh_io2_di();
        {   // diagnostico: registra cada mudanca de X16/X17/X11 durante a busca do giro
            static uint8_t snap_ant = 255;
            uint8_t snap = (uint8_t)home_sensor_giro() | ((uint8_t)home_sensor_x17() << 1) | ((uint8_t)home_sensor_x11() << 2);
            if (snap != snap_ant) {
                snap_ant = snap;
                DBG_PRINTF("[HOME] sensores X16=%d X17=%d X11=%d | t=%ums\n",
                           (int)home_sensor_giro(), (int)home_sensor_x17(), (int)home_sensor_x11(),
                           (unsigned)(millis() - g_home_t0));
            }
        }
        if (home_sensor_giro() && home_sensor_x17()) {
            vfd_stop(); io1_set_do(4,false);
            g_home_estado = HOME_FASE_PARADA; g_home_t0 = millis(); g_home_msg = "HOME: parando...";
            return;
        }
        if (!_hg_desac && home_sensor_x11()) { _hg_desac = true; _hg_t_desac = millis(); }
        if (_hg_desac) {
            uint32_t ag = millis();
            if (ag - _hg_t_ramp >= 120) {
                _hg_t_ramp = ag; uint32_t dt = ag - _hg_t_desac;
                uint16_t f = (dt >= HOME_DESAC_MS) ? HOME_DESAC_FLOOR
                    : (uint16_t)(HOME_FREQ_HZ10 - (uint32_t)(HOME_FREQ_HZ10 - HOME_DESAC_FLOOR)*dt/HOME_DESAC_MS);
                vfd_run_rev(f);
            }
        }
        if (millis() - g_home_t0 > HOME_TIMEOUT_MS) {
            home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: giro nao achado"; return;
        }
        if (comm_perdida()) { home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: comunicacao"; return; }
        return;
    }
    static uint32_t t_le = 0;
    if (millis() - t_le < 30) return;
    t_le = millis();
    modbus_refresh_io2_di();
    if (g_home_estado == HOME_FASE_PARADA) {
        vfd_stop();
        if (millis() - g_home_t0 >= 1500) home_iniciar_fase_desloc();
    } else if (g_home_estado == HOME_FASE_DESLOC) {
        if (home_sensor_x12()) {
            g_home_estado = HOME_FASE_X12_RAMPA;
            g_home_x12_t0 = millis(); g_home_x12_t_ramp = 0;
            return;
        }
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
    } else if (g_home_estado == HOME_FASE_X12_RAMPA) {
        uint32_t dtr = millis() - g_home_x12_t0;
        if (dtr >= HOME_X12_RAMPA_MS) {
            vfd_stop(); io2_set_do(4,false);
            g_home_estado = HOME_OK; g_home_msg = "HOME concluido";
            return;
        }
        if (millis() - g_home_x12_t_ramp >= HOME_X12_RAMPA_STEP_MS) {
            g_home_x12_t_ramp = millis();
            uint16_t f = (uint16_t)(HOME_FREQ_HZ10 - (uint32_t)HOME_FREQ_HZ10 * dtr / HOME_X12_RAMPA_MS);
            if (f < 1) f = 1;
            vfd_run_rev(f);
        }
    }
}

// ---- Deslocamento manual (fim de curso X12/X13) — sem mudanca ----
enum DeslocDir { DESLOC_PARADO=0, DESLOC_FRENTE=1, DESLOC_TRAS=2 };
static DeslocDir g_desloc_dir = DESLOC_PARADO;
static inline bool desloc_lim_x12() { return (g_io2.di >> 2) & 0x01; }
static inline bool desloc_lim_x13() { return (g_io2.di >> 3) & 0x01; }
bool desloc_movendo() { return g_desloc_dir != DESLOC_PARADO; }
void desloc_parar() { g_desloc_dir=DESLOC_PARADO; vfd_stop_garantido(); io2_set_do(4,false); }
bool desloc_frente_iniciar(uint16_t f) { modbus_refresh_io2_di(); if (desloc_lim_x13()) return false; g_desloc_dir=DESLOC_FRENTE; io2_set_do(4,true); if (!vfd_run_garantido(true, f)) { desloc_parar(); return false; } return true; }
bool desloc_tras_iniciar(uint16_t f)   { modbus_refresh_io2_di(); if (desloc_lim_x12()) return false; g_desloc_dir=DESLOC_TRAS;   io2_set_do(4,true); if (!vfd_run_garantido(false, f)) { desloc_parar(); return false; } return true; }
void desloc_tick() {
    if (g_desloc_dir == DESLOC_PARADO) return;
    static uint32_t t = 0;
    if (millis() - t < 30) return;
    t = millis();
    modbus_refresh_io2_di();
    if (g_desloc_dir==DESLOC_FRENTE && desloc_lim_x13()) desloc_parar();
    else if (g_desloc_dir==DESLOC_TRAS && desloc_lim_x12()) desloc_parar();
}

void modbus_tick() {
    if (home_rodando()) return;
    if (g_estado_auto == AUTO_PROCESSO) return;
    vfd_poll();
}
void modbus_init() { vfd_rs485_init(); }

// ---- Tempo de giro por processo na NVS (namespace "giro", chaves g0..g2, ms; ausente = padrao) ----
void giro_cfg_carregar() {
    Preferences p;
    if (!p.begin("giro", true)) return;
    for (int i = 0; i < GIRO_PROC_N; i++) {
        char k[4] = { 'g', (char)('0' + i), 0, 0 };
        uint16_t v = p.getUShort(k, 0);
        if (v >= 3000 && v <= 15000) g_giro_dur_proc[i] = v;
    }
    p.end();
}
static void giro_cfg_salvar(int i) {
    Preferences p;
    if (!p.begin("giro", false)) return;
    char k[4] = { 'g', (char)('0' + i), 0, 0 };
    p.putUShort(k, g_giro_dur_proc[i]);
    p.end();
}

void comm_hard_reset_saidas() {
    for (uint8_t canal = 0; canal < 8; canal++) {
        escreve_do_local(canal, false);
        ws2_envia_comando(canal, 0); delay(5);
    }
    g_io1.do_ = 0; g_io2.do_ = 0; do_estado1 = 0;
    DBG_PRINTLN("[HARD RESET] saidas em OFF (locais + W2)");
}

// =======================================================================
// Canal ESP-NOW — persiste na NVS (religamento normal volta direto pro
// canal certo, sem pareamento de novo). So muda quando o display manda
// MSG_CANAL. NUNCA varre canais sozinha.
// =======================================================================
static Preferences g_prefs;
static uint8_t     g_canal_atual = ESPNOW_CANAL;

static void aplica_canal(uint8_t ch) {
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    g_canal_atual = ch;
}

// Chamar no setup(), ANTES do esp_wifi_set_channel/esp_now_init — le a NVS
// e devolve o canal com que o radio deve subir.
uint8_t controle_canal_boot() {
    // Projeto de testes: canal FIXO em ESPNOW_CANAL (nao le nem grava NVS) —
    // display e W1 sempre no mesmo canal, sem depender de camera/pareamento.
    Preferences p; uint8_t c = ESPNOW_CANAL;
    if (p.begin("rede", true)) { c = p.getUChar("canal", ESPNOW_CANAL); p.end(); }
    if (c < 1 || c > 13) c = ESPNOW_CANAL;
    g_canal_atual = c;
    return c;
}

// =======================================================================
// Protocolo com o DISPLAY (projeto de testes) — 1 comando + 1 status
// =======================================================================
int     proc_estado();          // fwd — definido em processos.h (incluido depois)
uint8_t teste_giro_n();         // fwd — idem
void    teste_iniciar();        // fwd — definidos em maquina_estados.h
void    teste_parar();
typedef struct { uint8_t tipo, como, fh, pulsos; uint16_t dt_ms, x16_ms, x17_ms; } UltGiro;
extern UltGiro g_ult_giro;   // definido em processos.h
extern bool     g_teste_bomba, g_teste_seco, g_teste_rodando, g_ciclo_auto;
extern uint8_t  g_tipo_prox;
extern uint16_t g_teste_ok, g_teste_erro;
extern uint8_t  g_ev_seq, g_ev_tipo, g_ev_modelo;

uint16_t g_loop_max_ms = 0;   // atualizado no loop() (waveshare1.ino); zerado a cada status
uint8_t  g_rst_motivo  = 0;   // preenchido no setup()

static void status_enviar() {
    MsgTesteStatus s;
    memset(&s, 0, sizeof(s));
    s.cab.tipo = MSG_TESTE_STATUS; s.cab.id_maquina = ID_MAQUINA;
    s.cab.origem = ORIGEM_WAVE1; s.cab.seq = g_ws_seq++;
    s.estado_auto  = (uint8_t)g_estado_auto;
    s.sub_estado   = (uint8_t)proc_estado();
    s.giro_n       = teste_giro_n();
    s.home_estado  = (uint8_t)home_estado();
    s.bomba_on     = (g_teste_bomba ? 1 : 0) | (g_teste_seco ? 0 : 2);   // bit0 = bomba ON, bit1 = CARRO REAL
    s.rodando      = g_teste_rodando ? 1 : 0;
    s.w2_ok        = ((millis() - g_hb2) <= COMM_TIMEOUT_MS) ? 1 : 0;
    s.io1_di = g_io1.di; s.io2_di = g_io2.di;
    s.vfd_freq_x100 = (uint16_t)(g_vfd_freq * 100);
    s.ciclos_ok = g_teste_ok; s.ciclos_erro = g_teste_erro;
    s.vfd_falhas = g_vfd_write_falhas;
    s.ug_tipo = g_ult_giro.tipo; s.ug_como = g_ult_giro.como; s.ug_fh = g_ult_giro.fh;
    s.ug_pulsos = g_ult_giro.pulsos; s.ug_dt_ms = g_ult_giro.dt_ms;
    s.ug_x16_ms = g_ult_giro.x16_ms; s.ug_x17_ms = g_ult_giro.x17_ms;
    s.ev_seq = g_ev_seq; s.ev_tipo = g_ev_tipo; s.ev_modelo = g_ev_modelo;
    s.tipo_prox = g_tipo_prox;
    s.man_saidas = g_man_sai;
    s.manual_mov = g_manual_ativo;
    s.giro_ms[0] = (uint16_t)giro_dur_do_proc(PROC_PRE_LAVAGEM);
    s.giro_ms[1] = (uint16_t)giro_dur_do_proc(PROC_ESPUMA_A);
    s.giro_ms[2] = (uint16_t)giro_dur_do_proc(PROC_ALTA_PRESSAO);
    s.proc_ativo = (uint8_t)g_estado.processo_ativo; s.programa_sel = g_estado.programa_sel;
    s.up_s = millis() / 1000; s.loop_max_ms = g_loop_max_ms; g_loop_max_ms = 0; s.rst_motivo = g_rst_motivo;
    s.w1_do = do_estado1; s.w2_do_cmd = (uint8_t)g_io2.do_; s.w2_do_real = g_w2_do_real;
    s.vfd_mov = g_vfd_mov; s.vfd_mov_freq = g_vfd_mov_freq;
    const char* m = "";
    if (g_estado_auto == AUTO_ERRO && g_estado.msg_alarme) m = g_estado.msg_alarme;
    else if (home_estado() != 0)                            m = home_mensagem();
    else if (g_manual_msg[0] && (millis() - g_manual_msg_ms) < 4000) m = g_manual_msg;
    strncpy(s.msg, m, sizeof(s.msg) - 1);
    esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&s, sizeof(s));
}

static void on_recv_controlador(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
    if (info->src_addr[3] != ID_MAQUINA) return;
    if (len < (int)sizeof(CabEspNow)) return;
    const CabEspNow* cab = (const CabEspNow*)data;
    if (cab->id_maquina != ID_MAQUINA) return;

    // ---- da Waveshare 2 ----
    if (cab->origem == ORIGEM_WAVE2) {
        if (cab->tipo == MSG_EVENTO && len >= (int)sizeof(MsgEvento)) {
            const MsgEvento* e = (const MsgEvento*)data;
            portENTER_CRITICAL(&g_iomux2);
            g_viv2 = e->di_vivo; g_lat2 |= (e->di_borda & PULSO_W2_MASK); g_hb2 = millis(); w2_amostra_home(e->di_vivo, g_hb2); w2_gap_atualiza(g_hb2);
            portEXIT_CRITICAL(&g_iomux2);
        } else if (cab->tipo == MSG_HEARTBEAT && len >= (int)sizeof(MsgHeartbeat)) {
            const MsgHeartbeat* h = (const MsgHeartbeat*)data;
            portENTER_CRITICAL(&g_iomux2);
            g_viv2 = h->di_vivo; g_hb2 = millis(); g_w2_do_real = h->do_estado; w2_amostra_home(h->di_vivo, g_hb2); w2_gap_atualiza(g_hb2);
            portEXIT_CRITICAL(&g_iomux2);
        }
        return;
    }

    // ---- do Display: so o comando do teste (NADA e executado aqui: fila / flag) ----
    if (cab->origem != ORIGEM_DISPLAY && !(cab->origem == ORIGEM_CAMERA && cab->tipo == MSG_TESTE_DATA)) return;
    if (cab->tipo == MSG_TESTE_CMD && len >= (int)sizeof(MsgTesteCmd)) {
        const MsgTesteCmd* m = (const MsgTesteCmd*)data;
        if (m->acao == 2) g_parar_pedido = true;                       // PARAR: prioridade maxima
        else if (m->acao >= 10 && m->acao <= 13) { g_manual_cmd = m->acao; g_manual_ms = millis(); }   // segurando
        else if (m->acao == 14) g_manual_cmd = 0;                       // soltou
        else if (g_fila_cmd) { uint16_t a = (uint16_t)m->acao | ((uint16_t)m->arg << 8); xQueueSend(g_fila_cmd, &a, 0); }
    } else if (cab->tipo == MSG_CANAL && len >= (int)sizeof(MsgCanal)) {          // display: "vai para o canal N"
        const MsgCanal* m = (const MsgCanal*)data;
        if (m->canal >= 1 && m->canal <= 13) g_canal_pedido = m->canal;
    } else if (cab->tipo == MSG_TESTE_DATA && len >= (int)sizeof(MsgTesteData)) {
        const MsgTesteData* m = (const MsgTesteData*)data;
        if (m->dia >= 1 && m->dia <= 31 && m->mes >= 1 && m->mes <= 12 && m->ano >= 2024 && m->ano <= 2099) {
            g_data_dia = m->dia; g_data_mes = m->mes; g_data_ano = m->ano;
        }
    } else if (cab->tipo == MSG_TESTE_CFG_SET && len >= (int)sizeof(MsgTesteCfgSet) && g_fila_cfg) {
        const MsgTesteCfgSet* m = (const MsgTesteCfgSet*)data;
        CfgItem it = { 0, m->tabela, m->i1, m->i2, m->valor };
        xQueueSend(g_fila_cfg, &it, 0);
    } else if (cab->tipo == MSG_TESTE_CFG_REQ && len >= (int)sizeof(MsgTesteCfgReq) && g_fila_cfg) {
        const MsgTesteCfgReq* m = (const MsgTesteCfgReq*)data;
        CfgItem it = { 1, m->tabela, m->i1, 0, 0 };
        xQueueSend(g_fila_cfg, &it, 0);
    }
}

// ---- SAIDAS MANUAIS (toggles da tela MANUAL): so com a maquina parada; desligam sozinhas em 60 s ----
//   bit0 valvula (Y6)  bit1 espuma A (Y2+Y7)  bit2 espuma B (Y3+Y7)  bit3 cor magica (Y1+Y0+Y7)  bit4 secagem (Y5)  bit5 cera (Y10+Y7)
// A bomba de espuma (Y7) e o compressor (Y5) so ligam com o botao BOMBA em ON (tela TECNICO), igual aos ciclos.
// A bomba de alta pressao (Y13) NAO e manual aqui: continua so no ciclo/teste.
#define MAN_SAI_TETO_MS 60000
void man_sai_zera() { g_man_sai = 0; }
static void man_sai_aplicar(uint8_t novo) {
    bool bomba = g_teste_bomba;
    bool y7 = (novo & 0x2E) && bomba;                  // espuma A/B, cor magica ou cera
    bool y13 = (novo & 0x40) && bomba;                 // TESTE da bomba de alta pressao (so com BOMBA em ON; teto de 20 s)
    if (!y13) io2_set_do(Y13_CANAL_W2, false);         // desligando: a bomba de alta pressao primeiro
    if (!y7) io1_set_do(7, false);                     // desligando: bomba ANTES dos solenoides
    io1_set_do(6, (novo & 0x01) != 0);
    io1_set_do(2, (novo & 0x02) != 0);
    io1_set_do(3, (novo & 0x04) != 0);
    io1_set_do(1, (novo & 0x08) != 0);
    io2_set_do(6, (novo & 0x08) != 0);                 // Y0 junto com a cor magica
    io2_set_do(1, (novo & 0x20) != 0);
    io1_set_do(5, (novo & 0x10) != 0 && bomba);
    if (y7) io1_set_do(7, true);                       // ligando: solenoides ANTES da bomba
    if (y13) io2_set_do(Y13_CANAL_W2, true);           // Y13 (alta pressao): o contator aciona o SAJ em frequencia fixa
    g_man_sai = novo;
    DBG_PRINTF("[MANUAL] saidas = 0x%02X (bomba %s)\n", (unsigned)novo, bomba ? "ON" : "OFF");
}
static bool man_sai_livre() { return g_estado_auto == AUTO_IDLE && !g_teste_rodando && !home_rodando() && !g_manual_ativo; }
void man_sai_tick() {
    if (!g_man_sai) return;
    if (!man_sai_livre()) { g_man_sai = 0; return; }   // ciclo/HOME/movimento assumiram (eles desligam as saidas no inicio)
    uint32_t teto = (g_man_sai & 0x40) ? 20000UL : MAN_SAI_TETO_MS;     // a bomba de alta pressao desliga em 20 s
    if (millis() - g_man_sai_t0 > teto) {
        man_sai_aplicar(0);
        g_manual_msg = (teto == 20000UL) ? "Teste da bomba desligado (limite de 20 s)" : "Saidas manuais desligadas (limite de 60 s)"; g_manual_msg_ms = millis();
    }
}

// ---- PLANILHA DE LAVAGENS (na NVS da W1, namespace "lav") ----
// Por TIPO (0 presencial, 1 aplicativo, 2 socio/mensalista, 3 bonus/promocao) e por modelo, desde o ultimo acerto,
// + saldo historico de cada tipo + data do ultimo acerto. Ciclos pedidos pelo display/painel contam como o tipo escolhido na
// tela (padrao presencial). A maquina nao tem relogio: a data de hoje so existe quando a camera mandar MSG_TESTE_DATA.
static uint16_t g_lav[4][4] = {};                       // [tipo][modelo-1]
static uint32_t g_lav_saldo[4] = {0, 0, 0, 0};
static uint8_t  g_acerto_dia = 0, g_acerto_mes = 0; static uint16_t g_acerto_ano = 0;      // data do ultimo acerto

static void lav_salvar() {
    Preferences p;
    if (!p.begin("lav", false)) return;
    p.putBytes("t", g_lav, sizeof(g_lav));
    p.putBytes("s", g_lav_saldo, sizeof(g_lav_saldo));
    p.putUShort("ad", (uint16_t)(g_acerto_dia | (g_acerto_mes << 8))); p.putUShort("aa", g_acerto_ano);
    p.end();
}
void lav_carregar() {
    Preferences p;
    if (!p.begin("lav", true)) return;
    if (p.getBytesLength("t") == sizeof(g_lav))         p.getBytes("t", g_lav, sizeof(g_lav));
    if (p.getBytesLength("s") == sizeof(g_lav_saldo))   p.getBytes("s", g_lav_saldo, sizeof(g_lav_saldo));
    uint16_t ad = p.getUShort("ad", 0); g_acerto_dia = ad & 0xFF; g_acerto_mes = ad >> 8; g_acerto_ano = p.getUShort("aa", 0);
    p.end();
}
void lav_contar_ciclo(uint8_t modelo, uint8_t tipo) {
    if (modelo < 1 || modelo > 4 || tipo > 3) return;
    if (g_lav[tipo][modelo - 1] < 65535) g_lav[tipo][modelo - 1]++;
    lav_salvar();
    DBG_PRINTF("[LAV] modelo %u concluido (tipo %u) -> %u\n", (unsigned)modelo, (unsigned)tipo, (unsigned)g_lav[tipo][modelo - 1]);
}
// Acerto (pagamento efetuado): soma os contadores ao saldo historico, zera, grava a data de hoje (se conhecida).
static void lav_acerto() {
    for (int t = 0; t < 4; t++) for (int m = 0; m < 4; m++) { g_lav_saldo[t] += g_lav[t][m]; g_lav[t][m] = 0; }
    g_acerto_dia = g_data_dia; g_acerto_mes = g_data_mes; g_acerto_ano = g_data_ano;
    lav_salvar();
    DBG_PRINTF("[LAV] ACERTO feito (saldos %lu/%lu/%lu/%lu, data %02u/%02u/%u)\n", (unsigned long)g_lav_saldo[0], (unsigned long)g_lav_saldo[1],
               (unsigned long)g_lav_saldo[2], (unsigned long)g_lav_saldo[3], (unsigned)g_acerto_dia, (unsigned)g_acerto_mes, (unsigned)g_acerto_ano);
}

// ---- Configuracao persistente: velocidades (4x14), esperas por slot (4x14), atrasos reais (4), giro (3) ----
uint16_t g_atraso_real[4] = {60, 15, 60, 10};   // espuma A, espuma B, cor magica, secagem (s) — valem em CARRO REAL

static void atrasos_aplicar() {                  // SECO = tudo zerado; CARRO REAL = os valores configurados
    g_config.atraso_espuma_a   = g_teste_seco ? 0 : g_atraso_real[0];
    g_config.atraso_espuma_b   = g_teste_seco ? 0 : g_atraso_real[1];
    g_config.atraso_cor_magica = g_teste_seco ? 0 : g_atraso_real[2];
    g_config.atraso_secagem    = g_teste_seco ? 0 : g_atraso_real[3];
}

// Processos que podem aparecer numa sequencia: pre-lavagem, espumas A/B, cor magica, cera, alta pressao, secagem, enxague, FIM.
// (Spray foi removido: era a mesma coisa que a Cera d'agua.)
static bool seq_proc_valido(uint8_t p) { return p == PROC_PRE_LAVAGEM || p == PROC_ESPUMA_A || p == PROC_ESPUMA_B || p == PROC_COR_MAGICA || p == PROC_CERA_AGUA || p == PROC_ALTA_PRESSAO || p == PROC_SECAGEM || p == PROC_ENXAGUE || p == PROC_FIM; }

void cfg_carregar() {
    Preferences p;
    if (!p.begin("cfg", true)) return;
    uint16_t v[4][NUM_ETAPAS];
    if (p.getBytesLength("vel") == sizeof(v)) {
        p.getBytes("vel", v, sizeof(v));
        for (int m = 0; m < 4; m++) for (int e = 0; e < NUM_ETAPAS; e++) if (v[m][e] >= 50 && v[m][e] <= 600) g_velocidades[m][e] = v[m][e];
    }
    uint16_t w[4][NUM_SLOTS];
    if (p.getBytesLength("esp") == sizeof(w)) {
        p.getBytes("esp", w, sizeof(w));
        for (int m = 0; m < 4; m++) for (int s = 0; s < NUM_SLOTS; s++) if (w[m][s] <= 3600 || w[m][s] == 0xFFFF) g_modelos_espera[m][s] = w[m][s];
    }
    if (!p.getBool("pres2", false)) for (int m = 0; m < 4; m++) g_velocidades[m][13] = 250;   // etapa 13 passou a ser a pressao da Alta Pressao (25 Hz); ignora valor antigo
    uint8_t q[4][NUM_SLOTS];
    if (p.getBytesLength("seq") == sizeof(q)) {
        p.getBytes("seq", q, sizeof(q));
        bool ok = true;
        for (int m = 0; m < 4 && ok; m++) for (int s2 = 0; s2 < NUM_SLOTS; s2++) if (!seq_proc_valido(q[m][s2])) { ok = false; break; }
        if (ok) memcpy(g_modelos, q, sizeof(q));
    }
    uint16_t a[4];
    if (p.getBytesLength("atr") == sizeof(a)) {
        p.getBytes("atr", a, sizeof(a));
        for (int i = 0; i < 4; i++) if (a[i] <= 3600) g_atraso_real[i] = a[i];
    }
    p.end();
    atrasos_aplicar();
}

static void cfg_salvar(uint8_t tabela) {
    Preferences p;
    if (!p.begin("cfg", false)) return;
    if (tabela == 0) { p.putBytes("vel", g_velocidades, sizeof(g_velocidades)); p.putBool("pres2", true); }
    if (tabela == 4) p.putBytes("seq", g_modelos, sizeof(g_modelos));
    if (tabela == 1) p.putBytes("esp", g_modelos_espera, sizeof(g_modelos_espera));
    if (tabela == 2) p.putBytes("atr", g_atraso_real, sizeof(g_atraso_real));
    p.end();
}

static bool cfg_gravar(const CfgItem& it) {
    if (g_estado_auto != AUTO_IDLE || g_teste_rodando || home_rodando() || g_manual_ativo) {
        g_manual_msg = "Configuracao so com a maquina parada"; g_manual_msg_ms = millis(); return false;
    }
    switch (it.tabela) {
        case 0:
            if (it.i1 > 3 || it.i2 >= NUM_ETAPAS || it.valor < 50 || it.valor > 600) return false;
            g_velocidades[it.i1][it.i2] = it.valor; break;
        case 4:                                              // sequencia de processos do modelo (slot -> id do processo)
            if (it.i1 > 3 || it.i2 >= NUM_SLOTS || it.valor > 255 || !seq_proc_valido((uint8_t)it.valor)) return false;
            g_modelos[it.i1][it.i2] = (uint8_t)it.valor; break;
        case 1:
            if (it.i1 > 3 || it.i2 >= NUM_SLOTS || !(it.valor <= 3600 || it.valor == 0xFFFF)) return false;
            g_modelos_espera[it.i1][it.i2] = it.valor; break;
        case 2:
            if (it.i1 > 3 || it.valor > 3600) return false;
            g_atraso_real[it.i1] = it.valor; atrasos_aplicar(); break;
        case 3:
            if (it.i1 >= GIRO_PROC_N || !(it.valor == 0 || (it.valor >= 3000 && it.valor <= 15000))) return false;
            g_giro_dur_proc[it.i1] = it.valor; giro_cfg_salvar(it.i1); return true;
        default: return false;
    }
    cfg_salvar(it.tabela);
    DBG_PRINTF("[CFG] tabela %u [%u][%u] = %u (salvo)\n", (unsigned)it.tabela, (unsigned)it.i1, (unsigned)it.i2, (unsigned)it.valor);
    return true;
}

static void cfg_enviar_tabela(uint8_t tabela, uint8_t i1) {
    MsgTesteCfgDump d = {};
    d.cab.tipo = MSG_TESTE_CFG_DUMP; d.cab.id_maquina = ID_MAQUINA; d.cab.origem = ORIGEM_WAVE1; d.cab.seq = g_ws_seq++;
    d.tabela = tabela; d.i1 = i1;
    if (tabela == 0 && i1 <= 3)      for (int e = 0; e < NUM_ETAPAS; e++) d.v[e] = g_velocidades[i1][e];
    else if (tabela == 1 && i1 <= 3) for (int s = 0; s < NUM_SLOTS; s++)  d.v[s] = g_modelos_espera[i1][s];
    else if (tabela == 5 && i1 == 0) {
        for (int m = 0; m < 4; m++) { d.v[m] = g_lav[0][m]; d.v[4 + m] = g_lav[1][m]; d.v[8 + m] = g_lav[2][m]; }
        d.v[12] = (uint16_t)(g_acerto_dia | (g_acerto_mes << 8)); d.v[13] = g_acerto_ano;
    }
    else if (tabela == 5 && i1 == 1) {
        for (int m = 0; m < 4; m++) d.v[m] = g_lav[3][m];
        for (int t = 0; t < 4; t++) { d.v[4 + 2 * t] = (uint16_t)(g_lav_saldo[t] & 0xFFFF); d.v[5 + 2 * t] = (uint16_t)(g_lav_saldo[t] >> 16); }
    }
    else if (tabela == 4 && i1 <= 3) for (int s = 0; s < NUM_SLOTS; s++)  d.v[s] = g_modelos[i1][s];   // so leitura: ids dos processos
    else if (tabela == 2)            for (int i = 0; i < 4; i++)           d.v[i] = g_atraso_real[i];
    else if (tabela == 3)            { d.v[0] = (uint16_t)giro_dur_do_proc(PROC_PRE_LAVAGEM); d.v[1] = (uint16_t)giro_dur_do_proc(PROC_ESPUMA_A); d.v[2] = (uint16_t)giro_dur_do_proc(PROC_ALTA_PRESSAO); }
    else return;
    esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&d, sizeof(d));
}

static void cfg_processa() {
    CfgItem it;
    while (g_fila_cfg && xQueueReceive(g_fila_cfg, &it, 0) == pdTRUE) {
        if (it.op == 0) cfg_gravar(it);
        else            cfg_enviar_tabela(it.tabela, it.i1);
    }
}

// Executa o que o display pediu. Chamar SO do loop()/das esperas do loop — nunca do callback.
void processa_comandos() {
    if (g_parar_pedido) { g_parar_pedido = false; teste_parar(); }
    cfg_processa();
    uint16_t pacote;
    while (g_fila_cmd && xQueueReceive(g_fila_cmd, &pacote, 0) == pdTRUE) {
        uint8_t a = (uint8_t)(pacote & 0xFF), arg = (uint8_t)(pacote >> 8);
        if (g_man_sai && (a == 0 || a == 1 || a == 20)) man_sai_aplicar(0);   // HOME/teste/automatico: desliga as saidas manuais antes
        switch (a) {
            case 0:                                          // HOME: alterna iniciar/cancelar
                if (home_rodando()) home_iniciar();         // cancelar sempre pode
                else if (g_estado_auto == AUTO_IDLE && !g_teste_rodando && !g_manual_ativo) home_iniciar();
                else { g_manual_msg = "HOME bloqueado: ciclo ou manual em andamento"; g_manual_msg_ms = millis(); }
                break;
            case 1: teste_iniciar();       break;
            case 5: case 6:                                  // 5 = CARRO REAL (X10 real + atrasos originais) / 6 = SECO (simulado)
                if (g_estado_auto != AUTO_IDLE || g_teste_rodando || home_rodando() || g_manual_ativo) {
                    g_manual_msg = "Troca SECO/CARRO REAL so com a maquina parada"; g_manual_msg_ms = millis(); break;
                }
                g_teste_seco = (a == 6);
                atrasos_aplicar();                           // SECO = zerados; CARRO REAL = os atrasos configurados (padrao 60/15/60/10 s)
                DBG_PRINTF("[TESTE] modo %s\n", g_teste_seco ? "SECO (X10 simulado)" : "CARRO REAL (X10 real)");
                break;
            case 40: case 41: case 42:                       // tempo do giro 1->2 por processo; arg = ms/100 (absoluto: repetir e seguro)
                if (g_estado_auto != AUTO_IDLE || g_teste_rodando || home_rodando() || g_manual_ativo) {
                    g_manual_msg = "Ajuste do giro so com a maquina parada"; g_manual_msg_ms = millis(); break;
                }
                if (arg < 30 || arg > 150) break;            // 3,0 s a 15,0 s
                g_giro_dur_proc[a - 40] = (uint16_t)arg * 100;
                giro_cfg_salvar(a - 40);
                DBG_PRINTF("[GIRO] tempo do processo %d = %u ms (salvo)\n", (int)(a - 40), (unsigned)g_giro_dur_proc[a - 40]);
                break;
            case 60: case 61: case 62: case 63: case 64: case 65: case 66: {   // saida manual (arg 1 liga / 0 desliga); 66 = TESTE da bomba de alta pressao (Y13)
                if (!man_sai_livre()) { g_manual_msg = "Saidas manuais so com a maquina parada"; g_manual_msg_ms = millis(); break; }
                if (a == 66 && arg && !g_teste_bomba) { g_manual_msg = "Ligue o BOMBA (ON) na tela TECNICO antes de testar a bomba"; g_manual_msg_ms = millis(); break; }
                uint8_t bit = (uint8_t)(1u << (a - 60));
                uint8_t novo = arg ? (uint8_t)(g_man_sai | bit) : (uint8_t)(g_man_sai & ~bit);
                if (arg) g_man_sai_t0 = millis();
                man_sai_aplicar(novo);
                break; }
            case 70: g_tec_ping_ms = millis() ? millis() : 1; break;   // display nas telas TECNICO/MANUAL/WI-FI: tecnico presente (mantem as luzes acesas)
            case 7: if (arg <= 3) g_tipo_prox = arg; break;  // tipo do proximo ciclo (0 presencial, 1 aplicativo, 2 socio, 3 bonus)
            case 9:                                          // ACERTO (pagamento efetuado)
                if (g_estado_auto != AUTO_IDLE || g_teste_rodando || home_rodando() || g_manual_ativo) {
                    g_manual_msg = "Acerto so com a maquina parada"; g_manual_msg_ms = millis(); break;
                }
                lav_acerto();
                break;
            case 3: g_teste_bomba = false; break;
            case 4: g_teste_bomba = true;  break;
            // ---- AUTOMATICO (fluxo completo: carro X14 -> posicao X15 -> 6 s -> home -> processo) ----
            case 20:                                         // iniciar, arg = modelo 1..4
                if (arg < 1 || arg > 4) { g_manual_msg = "AUTO: modelo invalido"; g_manual_msg_ms = millis(); break; }
                if (g_estado_auto == AUTO_ERRO) teste_parar();   // INICIAR depois de um erro: limpa o erro e recomeca
                if (g_estado_auto != AUTO_IDLE || g_teste_rodando || home_rodando() || g_manual_ativo) {
                    g_manual_msg = "AUTO bloqueado: maquina ocupada"; g_manual_msg_ms = millis(); break;
                }
                g_ciclo_auto = true;
                auto_iniciar(arg);
                break;
            case 21: if (g_estado_auto == AUTO_PROCESSO) auto_pausar();  break;
            case 22: if (g_estado_auto == AUTO_PAUSADO)  auto_retomar(); break;
            case 23: teste_parar(); break;                   // cancelar = parada total
        }
    }
}

// ---- PAINEL FISICO / CONTROLE REMOTO (X1..X6 da W1; o controle remoto e o app usam as mesmas entradas) ----
//   X1 (DI2) = modelo 1   X2 (DI3) = modelo 2   X5 (DI6) = modelo 3   X6 (DI7) = modelo 4   (pulso curto)
//   X4 (DI5) = pausar / continuar (precisa ficar acionado 300 ms; trava de 3 s entre acionamentos)
//   X3 (DI4) = manual/automatico: sem funcao aqui (a maquina ja vive no automatico)
// Um modelo pedido por aqui ARMA o ciclo (luz verde, espera o carro no X14) sem precisar abrir a tela AUTOMATICO.
// Pode trocar de modelo enquanto o carro nao entrou (IDLE ou AGUARDA_CARRO).
#define PAINEL_MASK 0x7E
void painel_tick() {
    uint8_t lat;
    noInterrupts(); lat = g_lat1 & PAINEL_MASK; g_lat1 &= ~PAINEL_MASK; interrupts();
    uint32_t agora = millis();

    static uint32_t t_modelo = 0, t_x4_baixo = 0, t_x4_acao = 0;
    static bool x4_armado = true;

    // ---- X4: pausar / continuar (nivel, nao pulso) ----
    if ((le_entradas_vivo_local() >> 4) & 1) {
        if (!t_x4_baixo) t_x4_baixo = agora ? agora : 1;
        else if (x4_armado && agora - t_x4_baixo >= 300 && (!t_x4_acao || agora - t_x4_acao >= 3000)) {
            x4_armado = false; t_x4_acao = agora;
            if (g_estado_auto == AUTO_PROCESSO)     { DBG_PRINTLN("[PAINEL] X4 -> PAUSAR");    auto_pausar(); }
            else if (g_estado_auto == AUTO_PAUSADO) { DBG_PRINTLN("[PAINEL] X4 -> CONTINUAR"); auto_retomar(); }
        }
    } else { t_x4_baixo = 0; x4_armado = true; }

    // ---- X1/X2/X5/X6: escolhe o modelo ----
    uint8_t modelo = (lat & 0x02) ? 1 : (lat & 0x04) ? 2 : (lat & 0x20) ? 3 : (lat & 0x40) ? 4 : 0;
    if (!modelo) return;
    if (t_modelo && agora - t_modelo < 1500) return;          // trava anti-repique/ruido
    t_modelo = agora ? agora : 1;
    if ((g_estado_auto == AUTO_IDLE || g_estado_auto == AUTO_AGUARDA_CARRO) && !g_teste_rodando && !home_rodando() && !g_manual_ativo) {
        if (g_man_sai) man_sai_aplicar(0);
        DBG_PRINTF("[PAINEL] modelo %u pedido -> AUTO armado\n", (unsigned)modelo);
        g_ciclo_auto = true;
        auto_iniciar(modelo);
    } else {
        DBG_PRINTF("[PAINEL] modelo %u ignorado (estado=%d)\n", (unsigned)modelo, (int)g_estado_auto);
    }
}

// ---- MIGRACAO DE CANAL pedida pelo display (canal_tick, no loop) ----
// Sequencia: manda a W2 ir para o canal N (no canal ANTIGO, onde ela ainda ouve), muda a si mesma, espera o heartbeat da W2 no canal
// novo (ate 3 s). Deu certo: salva o canal na NVS e manda o "oi" (MsgCanal) ao display (que ja esta no canal novo).
// Deu errado: manda a W2 voltar, volta ao canal antigo e NAO salva. So migra com a maquina parada.
static uint8_t g_can_est = 0, g_can_ant = ESPNOW_CANAL, g_can_dest = ESPNOW_CANAL;
static uint32_t g_can_t0 = 0, g_can_hb_antes = 0;
static void canal_envia(const uint8_t* mac, uint8_t canal, int vezes) {
    MsgCanal m = {};
    m.cab.tipo = MSG_CANAL; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_WAVE1; m.cab.seq = g_ws_seq++;
    m.canal = canal;
    for (int i = 0; i < vezes; i++) { esp_now_send((uint8_t*)mac, (uint8_t*)&m, sizeof(m)); delay(30); }
}
static void canal_salvar(uint8_t c) { Preferences p; if (p.begin("rede", false)) { p.putUChar("canal", c); p.end(); } }
void canal_tick() {
    if (g_can_est == 0) {
        uint8_t n = g_canal_pedido; if (!n) return;
        g_canal_pedido = 0;
        if (n == g_canal_atual) { canal_envia(MAC_DISPLAY, n, 3); return; }               // ja estou nele: so confirma
        if (g_estado_auto != AUTO_IDLE || g_teste_rodando || home_rodando() || g_manual_ativo) {
            g_manual_msg = "Canal: maquina ocupada"; g_manual_msg_ms = millis(); return;
        }
        g_can_ant = g_canal_atual; g_can_dest = n;
        canal_envia(MAC_WAVE2, n, 3);                                                       // a W2 vai primeiro (ainda no canal antigo)
        aplica_canal(n);
        g_can_hb_antes = g_hb2; g_can_t0 = millis(); g_can_est = 1;
        DBG_PRINTF("[CANAL] migrando %u -> %u (esperando a W2)\n", (unsigned)g_can_ant, (unsigned)n);
        return;
    }
    if (g_hb2 != g_can_hb_antes && (millis() - g_hb2) < 600) {                              // W2 apareceu no canal novo
        canal_salvar(g_can_dest);
        canal_envia(MAC_DISPLAY, g_can_dest, 4);                                            // "oi" para o display
        DBG_PRINTF("[CANAL] ok: no canal %u (salvo)\n", (unsigned)g_can_dest);
        g_can_est = 0;
    } else if (millis() - g_can_t0 > 3000) {                                                // falhou: volta tudo
        canal_envia(MAC_WAVE2, g_can_ant, 3);                                               // (no canal novo, caso a W2 tenha migrado)
        aplica_canal(g_can_ant);
        DBG_PRINTF("[CANAL] FALHOU: W2 nao respondeu no canal %u; voltei ao %u\n", (unsigned)g_can_dest, (unsigned)g_can_ant);
        g_manual_msg = "Canal: a W2 nao acompanhou; voltei ao canal antigo"; g_manual_msg_ms = millis();
        g_can_est = 0;
    }
}

// Resultado de entrega de cada esp_now_send (so confirma que o destino recebeu o quadro).
static void on_send_cb(const esp_now_send_info_t* info, esp_now_send_status_t st) {
    (void)info;
    if (st == ESP_NOW_SEND_SUCCESS) g_tx_ok++; else g_tx_fail++;
}

// Chamar no loop() logo depois de processa_comandos().
static const char* g_manual_motivo = "solto";   // por que esta parando (so para o log)
static void manual_parar() {
    DBG_PRINTF("[MANUAL] parou cmd=%d motivo=%s dur=%ums\n", (int)g_manual_ativo, g_manual_motivo,
               (unsigned)(millis() - g_manual_t0));
    if (g_manual_ativo == 10 || g_manual_ativo == 11) { vfd_stop_garantido(); io1_set_do(4, false); }
    else if (g_manual_ativo == 12 || g_manual_ativo == 13) { desloc_parar(); }
    g_manual_ativo = 0;
}
static void manual_aviso(const char* m) { g_manual_msg = m; g_manual_msg_ms = millis(); }

void manual_tick() {
    uint8_t cmd = g_manual_cmd;
    bool vivo = cmd && (uint32_t)(millis() - g_manual_ms) < MANUAL_DEADMAN_MS;

    if (g_manual_ativo) {                       // ja esta em movimento: confere se deve continuar
        bool teto = (millis() - g_manual_t0) > MANUAL_MAX_MS;
        if (!vivo || cmd != g_manual_ativo || teto || g_parar_pedido) {
            if (teto) manual_aviso("MANUAL: parou no teto de 20 s");
            g_manual_motivo = teto ? "teto 20s" : (g_parar_pedido ? "PARAR" :
                              (cmd == 0 ? "solto" : (!vivo ? "DEADMAN (sem sinal do display)" : "troca de botao")));
            manual_parar();
            if (!vivo) g_manual_cmd = 0;
        } else if (g_manual_ativo >= 12 && !desloc_movendo()) {   // fim de curso (desloc_tick parou)
            manual_aviso("MANUAL: carrinho no fim de curso");
            DBG_PRINTF("[MANUAL] parou cmd=%d motivo=fim de curso dur=%ums\n", (int)g_manual_ativo,
                       (unsigned)(millis() - g_manual_t0));
            g_manual_ativo = 0; g_manual_cmd = 0;
        }
        return;
    }
    if (!vivo) return;                          // nada pedido

    // Quer comecar um movimento: so com a maquina parada (sem ciclo, sem HOME, sem PARAR pendente)
    if (g_estado_auto != AUTO_IDLE || g_teste_rodando || home_rodando() || g_parar_pedido) {
        g_manual_cmd = 0;
        manual_aviso("MANUAL bloqueado: ciclo ou HOME em andamento");
        return;
    }
    if (cmd == 10 || cmd == 11) {
        io1_set_do(4, true);                    // Y4: contator do giro (trava com Y14)
        if (!vfd_run_garantido(cmd == 10, MANUAL_FREQ_HZ10)) {
            vfd_stop_garantido(); io1_set_do(4, false);
            g_manual_cmd = 0; manual_aviso("MANUAL: Delta nao recebeu o comando do giro");
            return;
        }
    } else if (cmd == 12 || cmd == 13) {
        bool ok = (cmd == 12) ? desloc_frente_iniciar(MANUAL_FREQ_HZ10) : desloc_tras_iniciar(MANUAL_FREQ_HZ10);
        if (!ok) { g_manual_cmd = 0; manual_aviso("MANUAL: carrinho no fim de curso ou comando nao entregue"); return; }
    } else { g_manual_cmd = 0; return; }
    g_manual_ativo = cmd; g_manual_t0 = millis();
    DBG_PRINTF("[MANUAL] inicio cmd=%d\n", (int)cmd);
}

void controle_init() {
    g_fila_cmd = xQueueCreate(8, sizeof(uint16_t));
    g_fila_cfg = xQueueCreate(8, sizeof(CfgItem));
    pca_init();
    for (uint8_t i=0;i<8;i++) {
        pinMode(DI_PINS[i], INPUT_PULLUP);
        attachInterruptArg(digitalPinToInterrupt(DI_PINS[i]), di1_isr, (void*)(uint32_t)i, FALLING);
    }
    esp_now_register_recv_cb(on_recv_controlador);
    esp_now_register_send_cb(on_send_cb);
    esp_now_peer_info_t p = {}; p.channel=0; p.ifidx=WIFI_IF_STA; p.encrypt=true;
    memcpy(p.lmk, ESPNOW_LMK, 16);
    memcpy(p.peer_addr, MAC_DISPLAY, 6); esp_now_add_peer(&p);
    memcpy(p.peer_addr, MAC_WAVE2, 6);   esp_now_add_peer(&p);
}

// Chamar no loop(): manda status periodico e cuida do alarme da W2.
extern bool g_giro_ativo;   // definido em processos.h

void controle_tick() {
    wave2_alarme_tick();

    // Resumo do RS-485 a cada 5 s (serial): como as transacoes terminaram.
    static uint32_t t_rs = 0;
    if (millis() - t_rs >= 5000) {
        t_rs = millis();
        DBG_PRINTF("[LINK] loop_max=%ums w2_gap_max=%ums tx_ok=%u tx_fail=%u recon=%u\n",
                   (unsigned)g_loop_max_5s, (unsigned)g_w2_gap_max, (unsigned)g_tx_ok, (unsigned)g_tx_fail,
                   (unsigned)g_recon_n);
        g_loop_max_5s = 0; g_w2_gap_max = 0;
        uint32_t tot = g_mb_ok + g_mb_zero + g_mb_curta + g_mb_crc;
        DBG_PRINTF("[RS485] ok=%u zero_bytes=%u curta=%u crc=%u | total=%u (%u%% ok) | mov=%d giro=%d home=%d\n",
                   (unsigned)g_mb_ok, (unsigned)g_mb_zero, (unsigned)g_mb_curta, (unsigned)g_mb_crc,
                   (unsigned)tot, (unsigned)(tot ? (100UL * g_mb_ok / tot) : 0),
                   (int)g_vfd_mov, (int)g_giro_ativo, home_estado());
    }
    // Reconciliacao das saidas da W2 (item 6): o comando sai UMA vez por radio, sem confirmacao,
    // e a W2 pode recusar o Y14 se ele foi desligado ha menos de 500 ms. Aqui comparamos o que
    // mandamos ligar (g_io2.do_) com o que a W2 diz ter ligado (heartbeat) e reenviamos a diferenca.
    // O DO5 (Y15) e BLOQUEADO na W2 — nunca conta como divergencia.
    static uint32_t t_rec = 0;
    if (millis() - t_rec >= 400) {
        t_rec = millis();
        if ((millis() - g_hb2) <= COMM_TIMEOUT_MS) {
            uint8_t cmd = (uint8_t)g_io2.do_, real = g_w2_do_real;
            uint8_t dif = (cmd ^ real) & (uint8_t)~(1 << 4);
            for (uint8_t ch = 0; ch < 8; ch++) {
                if (dif & (1 << ch)) { ws2_envia_comando(ch, (cmd >> ch) & 1); g_recon_n++; }
            }
        }
    }

    // Registra no serial cada mudanca de estado do HOME (diagnostico).
    static uint8_t home_ant = 255;
    if (home_estado() != home_ant) {
        home_ant = (uint8_t)home_estado();
        DBG_PRINTF("[HOME] estado=%d %s\n", (int)home_ant, home_mensagem());
    }

    static uint32_t t_status = 0;
    if (millis() - t_status >= 300) {
        t_status = millis();
        // Achado em campo: fora de giro/carrinho em movimento, nada mais
        // chamava o refresh — g_io1.di/g_io2.di ficavam parados no valor do
        // boot, entao o status mandado pro display nunca refletia os botoes
        // do painel (X1-X6) sendo pressionados em repouso.
        modbus_refresh_io1_di();
        modbus_refresh_io2_di();
        status_enviar();
    }
}
