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
    g_lat1 = 0;
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
static QueueHandle_t   g_fila_cmd = nullptr;
static volatile bool   g_parar_pedido = false;
void processa_comandos();   // definida mais abaixo

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
    io1_set_do(4,true); vfd_run_rev(HOME_FREQ_HZ10);
}
void home_tick() {
    if (!home_rodando()) return;
    if (g_home_estado == HOME_FASE_GIRO) {
        bool desac=false; uint32_t t_desac=0, t_ramp=0;
        modbus_refresh_io2_di();
        for (;;) {
            // Achado em campo: essa busca pode legitimamente levar ate
            // HOME_TIMEOUT_MS (25s), mas o loop() principal (onde o TWDT de
            // 15s e alimentado) fica BLOQUEADO aqui dentro o tempo todo —
            // se o giro demorar mais de 15s pra achar a posicao, o watchdog
            // disparava um PANIC e reiniciava a W1 no meio do HOME (motor
            // parava onde estava, sem ler sensor nenhum, e o display via
            // reconexao caia na tela padrao). Alimenta o watchdog aqui
            // tambem pra essa busca longa nao ser confundida com travamento.
            esp_task_wdt_reset();
            processa_comandos();   // PARAR / cancelar HOME chegam por aqui mesmo com o laco preso
            if (g_home_estado != HOME_FASE_GIRO) return;   // cancelado (home_iniciar/home_reset mudou o estado): para de comandar o motor
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

void modbus_tick() {
    if (home_rodando()) return;
    if (g_estado_auto == AUTO_PROCESSO) return;
    vfd_poll();
}
void modbus_init() { vfd_rs485_init(); }

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
    g_canal_atual = ESPNOW_CANAL;
    return ESPNOW_CANAL;
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
extern bool     g_teste_bomba, g_teste_rodando;
extern uint16_t g_teste_ok, g_teste_erro;

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
    s.bomba_on     = g_teste_bomba ? 1 : 0;
    s.rodando      = g_teste_rodando ? 1 : 0;
    s.w2_ok        = ((millis() - g_hb2) <= COMM_TIMEOUT_MS) ? 1 : 0;
    s.io1_di = g_io1.di; s.io2_di = g_io2.di;
    s.vfd_freq_x100 = (uint16_t)(g_vfd_freq * 100);
    s.ciclos_ok = g_teste_ok; s.ciclos_erro = g_teste_erro;
    s.vfd_falhas = g_vfd_write_falhas;
    s.ug_tipo = g_ult_giro.tipo; s.ug_como = g_ult_giro.como; s.ug_fh = g_ult_giro.fh;
    s.ug_pulsos = g_ult_giro.pulsos; s.ug_dt_ms = g_ult_giro.dt_ms;
    s.ug_x16_ms = g_ult_giro.x16_ms; s.ug_x17_ms = g_ult_giro.x17_ms;
    s.up_s = millis() / 1000; s.loop_max_ms = g_loop_max_ms; g_loop_max_ms = 0; s.rst_motivo = g_rst_motivo;
    s.w1_do = do_estado1; s.w2_do_cmd = (uint8_t)g_io2.do_; s.w2_do_real = g_w2_do_real;
    s.vfd_mov = g_vfd_mov; s.vfd_mov_freq = g_vfd_mov_freq;
    const char* m = "";
    if (g_estado_auto == AUTO_ERRO && g_estado.msg_alarme) m = g_estado.msg_alarme;
    else if (home_estado() != 0)                            m = home_mensagem();
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
            g_viv2 = e->di_vivo; g_lat2 |= (e->di_borda & PULSO_W2_MASK); g_hb2 = millis(); w2_amostra_home(e->di_vivo, g_hb2);
            portEXIT_CRITICAL(&g_iomux2);
        } else if (cab->tipo == MSG_HEARTBEAT && len >= (int)sizeof(MsgHeartbeat)) {
            const MsgHeartbeat* h = (const MsgHeartbeat*)data;
            portENTER_CRITICAL(&g_iomux2);
            g_viv2 = h->di_vivo; g_hb2 = millis(); g_w2_do_real = h->do_estado; w2_amostra_home(h->di_vivo, g_hb2);
            portEXIT_CRITICAL(&g_iomux2);
        }
        return;
    }

    // ---- do Display: so o comando do teste (NADA e executado aqui: fila / flag) ----
    if (cab->origem != ORIGEM_DISPLAY) return;
    if (cab->tipo == MSG_TESTE_CMD && len >= (int)sizeof(MsgTesteCmd)) {
        const MsgTesteCmd* m = (const MsgTesteCmd*)data;
        if (m->acao == 2) g_parar_pedido = true;                       // PARAR: prioridade maxima
        else if (g_fila_cmd) { uint8_t a = m->acao; xQueueSend(g_fila_cmd, &a, 0); }
    }
}

// Executa o que o display pediu. Chamar SO do loop()/das esperas do loop — nunca do callback.
void processa_comandos() {
    if (g_parar_pedido) { g_parar_pedido = false; teste_parar(); }
    uint8_t a;
    while (g_fila_cmd && xQueueReceive(g_fila_cmd, &a, 0) == pdTRUE) {
        switch (a) {
            case 0: home_iniciar();        break;   // alterna iniciar/cancelar
            case 1: teste_iniciar();       break;
            case 3: g_teste_bomba = false; break;
            case 4: g_teste_bomba = true;  break;
        }
    }
}

void controle_init() {
    g_fila_cmd = xQueueCreate(8, sizeof(uint8_t));
    pca_init();
    for (uint8_t i=0;i<8;i++) {
        pinMode(DI_PINS[i], INPUT_PULLUP);
        attachInterruptArg(digitalPinToInterrupt(DI_PINS[i]), di1_isr, (void*)(uint32_t)i, FALLING);
    }
    esp_now_register_recv_cb(on_recv_controlador);
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
        uint32_t tot = g_mb_ok + g_mb_zero + g_mb_curta + g_mb_crc;
        DBG_PRINTF("[RS485] ok=%u zero_bytes=%u curta=%u crc=%u | total=%u (%u%% ok) | mov=%d giro=%d home=%d\n",
                   (unsigned)g_mb_ok, (unsigned)g_mb_zero, (unsigned)g_mb_curta, (unsigned)g_mb_crc,
                   (unsigned)tot, (unsigned)(tot ? (100UL * g_mb_ok / tot) : 0),
                   (int)g_vfd_mov, (int)g_giro_ativo, home_estado());
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
