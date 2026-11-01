/*
  waveshare2.ino — Waveshare ESP32-S3-8DI-8DO #2 — ESP-NOW (volta do RS-485)
  Pili Tecnologia — ver nota no display, comm_waveshares_espnow.h.

  Papel: le 8 DIs (X10,X11,X12,X13,X14,X15,X17,X16) e aciona 8 DOs
  (Y10,Y12,Y13,Y14,Y15,-,-,Aspirador/DO8). Y15 (DO5) fica BLOQUEADO (nunca aciona).
  - Evento imediato na ISR do DI · Heartbeat 200ms · Comando de saida do display.
  MAC logico por funcao + PMK/LMK derivadas do ID_MAQUINA.

  CANAL: mesma lógica do waveshare1.ino (NVS persiste, nunca varre sozinha —
  ver comentário lá / em comm_waveshares_espnow.h no display).

  Config Arduino: ESP32S3 Dev Module, 16MB, PSRAM OPI, 240MHz, QIO, CDC On Boot = Enabled.
*/
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <nvs_flash.h>
#include <Preferences.h>
#include "link_cfg.h"
#if LINK_W1_W2_UART
#include "link_frame.h"
#include <HardwareSerial.h>
#include <esp_task_wdt.h>
#endif

// ===================== HARD RESET no boot (via firmware) =====================
#define HARD_RESET_APAGA_NVS 0
#define HR_MARCA 0x50494C49UL
RTC_NOINIT_ATTR static uint32_t g_hr_marca;
static void hard_reset_fase1(const char* nome) {
    esp_reset_reason_t r = esp_reset_reason();
    bool energizou = (r == ESP_RST_POWERON || r == ESP_RST_BROWNOUT || r == ESP_RST_UNKNOWN);
    if (energizou && g_hr_marca != HR_MARCA) {
        g_hr_marca = HR_MARCA;
#if HARD_RESET_APAGA_NVS
        nvs_flash_erase(); nvs_flash_init();
#endif
        Serial.printf("[%s] HARD RESET: motivo=%d -> reiniciando o chip inteiro (uma vez)\n", nome, (int)r);
        Serial.flush(); delay(100);
        esp_restart();
    }
    Serial.printf("[%s] boot limpo (motivo=%d, hard reset ja feito)\n", nome, (int)r);
}
static void hard_reset_radio() { WiFi.persistent(false); WiFi.mode(WIFI_OFF); delay(50); }
static void i2c_recupera_barramento(int sda, int scl) {
    pinMode(sda, INPUT_PULLUP);
    pinMode(scl, OUTPUT_OPEN_DRAIN); digitalWrite(scl, HIGH); delayMicroseconds(5);
    for (uint8_t i = 0; i < 9 && digitalRead(sda) == LOW; i++) {
        digitalWrite(scl, LOW); delayMicroseconds(5);
        digitalWrite(scl, HIGH); delayMicroseconds(5);
    }
    pinMode(sda, OUTPUT_OPEN_DRAIN); digitalWrite(sda, LOW); delayMicroseconds(5);   // STOP
    digitalWrite(scl, HIGH); delayMicroseconds(5); digitalWrite(sda, HIGH); delayMicroseconds(5);
    pinMode(sda, INPUT_PULLUP); pinMode(scl, INPUT_PULLUP);
}

// ===================== IDENTIDADE / ESP-NOW ==================================
#define ID_MAQUINA 1
static const uint8_t MAC_WAVE1[6]   = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x02};   // agora e o mestre (era MAC_DISPLAY)
static const uint8_t MAC_WAVE2[6]   = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x03};
#define ESPNOW_CANAL   1
#define ORIGEM_WAVE2   2
#define HEARTBEAT_MS   200
static const uint8_t ESPNOW_PMK[16] = {'P','I','L','I','-','p','m','k',ID_MAQUINA,0,0,0,0,0,0,0};
static const uint8_t ESPNOW_LMK[16] = {'P','I','L','I','-','l','m','k',ID_MAQUINA,0,0,0,0,0,0,0};

enum : uint8_t { MSG_EVENTO=1, MSG_HEARTBEAT=2, MSG_COMANDO=3, MSG_CANAL=4 };
typedef struct __attribute__((packed)) { uint8_t tipo,id_maquina,origem,seq; } CabEspNow;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t di_vivo,di_borda; uint32_t t_us; } MsgEvento;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t di_vivo,do_estado; } MsgHeartbeat;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t canal,estado; } MsgComando;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t canal; } MsgCanal;

// ===================== I2C / PCA9554 =========================================
#define I2C_SDA 42
#define I2C_SCL 41
#define PCA9554_ADDR 0x20
#define PCA9554_REG_OUTPUT 0x01
#define PCA9554_REG_CONFIG 0x03
#define DO_LOGICA_INVERTIDA 1

// ===================== LED RGB ===============================================
#define LED_PIN 38
static inline void led_cor(uint8_t r,uint8_t g,uint8_t b){ rgbLedWrite(LED_PIN,r,g,b); }
static uint32_t led_off_em = 0;
static void led_pisca(uint8_t r,uint8_t g,uint8_t b){ led_cor(r,g,b); led_off_em = millis()+30; }
static void led_tick(){ if (led_off_em && millis()>=led_off_em){ led_cor(0,0,0); led_off_em=0; } }

// ===================== DIs ===================================================
#define DI1_PIN 4    // X10 carro sob mesa (nivel)
#define DI2_PIN 5    // X11 giro braco (pulso)
#define DI3_PIN 6    // X12 fim curso tras (nivel)
#define DI4_PIN 7    // X13 fim curso frente (nivel)
#define DI5_PIN 8    // X14 carro entrando (nivel)
#define DI6_PIN 9    // X15 carro na posicao (nivel)
#define DI7_PIN 10   // X17 home braco (nivel, com debounce no display)
#define DI8_PIN 11   // X16 HOME_GIRO pos1 (nivel)
static const uint8_t DI_PINS[8] = { DI1_PIN,DI2_PIN,DI3_PIN,DI4_PIN,DI5_PIN,DI6_PIN,DI7_PIN,DI8_PIN };

#define DEBOUNCE_US 800
volatile uint8_t  g_borda_pend = 0;
volatile bool     g_ev_pend    = false;
volatile uint32_t g_ult_us[8]  = {0,0,0,0,0,0,0,0};

void IRAM_ATTR di_isr(void* arg) {
    uint32_t canal = (uint32_t)arg;
    uint32_t agora = micros();
    if (agora - g_ult_us[canal] < DEBOUNCE_US) return;
    g_ult_us[canal] = agora;
    g_borda_pend |= (1 << canal);
    g_ev_pend = true;
}
static uint8_t le_entradas_vivo() {
    uint8_t v = 0;
    for (uint8_t i=0;i<8;i++) if (digitalRead(DI_PINS[i])==LOW) v |= (1<<i);
    return v;
}

// ===================== Saidas (PCA9554) + trava + Y15 bloqueado ==============
#define CANAL_TRAVADO   3     // DO4 = Y14 (contator deslocamento): cooldown
#define CANAL_BLOQUEADO 4     // DO5 = Y15: nunca aciona
#define TRAVA_MS        500
static uint8_t       do_estado = 0x00;
static unsigned long ult_off_travado = 0;
static bool          primeiro_ciclo_trava = true;

static void pca_write(uint8_t reg,uint8_t val){ Wire.beginTransmission(PCA9554_ADDR); Wire.write(reg); Wire.write(val); Wire.endTransmission(); }
static void pca_init(){ pca_write(PCA9554_REG_CONFIG,0x00); pca_write(PCA9554_REG_OUTPUT, DO_LOGICA_INVERTIDA?0xFF:0x00); do_estado=0x00; }
static void pca_aplica(){ pca_write(PCA9554_REG_OUTPUT, DO_LOGICA_INVERTIDA?(uint8_t)~do_estado:do_estado); }

static bool escreve_do(uint8_t canal, bool ligar) {
    if (canal > 7) return false;
    if (canal == CANAL_BLOQUEADO) return false;   // Y15 bloqueado
    bool estava = (do_estado>>canal)&1;
    if (canal == CANAL_TRAVADO) {
        if (ligar) { if (!primeiro_ciclo_trava && (millis()-ult_off_travado) < TRAVA_MS) return false; }
        else if (estava) { ult_off_travado = millis(); primeiro_ciclo_trava = false; }
    }
    if (ligar) do_estado |= (1<<canal); else do_estado &= ~(1<<canal);
    pca_aplica();
    return true;
}

#if LINK_W1_W2_UART
// ===================== LINK W1<->W2 POR CABO (UART0, GPIO43 TXD / GPIO44 RXD) =================
// A W2 NAO usa Wi-Fi nem ESP-NOW (o radio fica desligado em setup/hard_reset_radio). Fala so com a W1, pelo cabo, com o quadro de link_frame.h:
//   envia LT_HB (a cada 200 ms) e LT_EVT (na hora de cada borda de entrada) — os mesmos dados do antigo MsgHeartbeat/MsgEvento;
//   recebe LT_CMD (ordem de saida, mesma semantica do antigo MsgComando: passa por escreve_do(), com o cooldown de 500 ms do Y14 e o Y15 bloqueado)
//   e LT_KEEP (sinal de vida da W1).
// FAIL-SAFE (NOVO): se a W2 nao receber NENHUM quadro valido da W1 por LINK_FAILSAFE_MS (2 s) — cabo solto, W1 travada ou reiniciando — ela DESLIGA
// as saidas sozinha (bombas, solenoides, contator do carrinho, aspirador...), MENOS as luzes (DO7). Quando a W1 volta, o reconciliador dela
// reenvia o que ela quer ligado. O watchdog de tarefa (8 s) reinicia a W2 se o proprio loop travar (no boot todas as saidas ficam desligadas).
static HardwareSerial& LINK = Serial0;
static LfParser g_lf;
static uint16_t g_lf_seq = 0;
static uint32_t g_lf_boot_ms = 0, g_ult_w1_ms = 0, g_lf_rel_ms = 0;
static bool     g_failsafe_on = false;
static volatile uint32_t g_lf_cmd = 0, g_lf_keep = 0, g_lf_tx = 0, g_lf_failsafes = 0;
static volatile uint32_t g_lf_u_brk = 0, g_lf_u_frm = 0, g_lf_u_par = 0, g_lf_u_fifo = 0, g_lf_u_buf = 0;

static void lf_enviar(uint8_t tipo, const uint8_t* pl, uint8_t len) {
    uint8_t b[8 + LF_MAXP];
    size_t n = lf_build(b, tipo, g_lf_seq++, pl, len);
    LINK.write(b, n); g_lf_tx++;
}
static void lf_on_frame(uint8_t tipo, uint16_t seq, const uint8_t* pl, uint8_t len) {
    (void)seq;
    g_ult_w1_ms = millis();
    if (g_failsafe_on) { g_failsafe_on = false; Serial.println("[WAVE2] a W1 voltou: fail-safe encerrado"); }
    if (tipo == LT_CMD && len >= 2) { escreve_do(pl[0], pl[1] != 0); led_pisca(0,0,30); g_lf_cmd++; }
    else if (tipo == LT_KEEP) g_lf_keep++;
}
static void lf_err_cb(hardwareSerial_error_t e) {
    switch (e) {
        case UART_BREAK_ERROR:       g_lf_u_brk++;  break;
        case UART_FRAME_ERROR:       g_lf_u_frm++;  break;
        case UART_PARITY_ERROR:      g_lf_u_par++;  break;
        case UART_FIFO_OVF_ERROR:    g_lf_u_fifo++; break;
        case UART_BUFFER_FULL_ERROR: g_lf_u_buf++;  break;
        default: break;
    }
}
static void envia_evento(uint8_t borda) {             // mesmo nome e mesmo papel do antigo (o loop() nao muda)
    uint8_t pl[2] = { le_entradas_vivo(), borda };
    lf_enviar(LT_EVT, pl, 2);
    led_pisca(30,0,0);
}
static void envia_heartbeat() {
    uint8_t pl[7]; uint32_t up = millis() / 1000UL;
    pl[0] = le_entradas_vivo(); pl[1] = do_estado; pl[2] = (uint8_t)esp_reset_reason();
    pl[3] = (uint8_t)(up & 0xFF); pl[4] = (uint8_t)((up >> 8) & 0xFF); pl[5] = (uint8_t)((up >> 16) & 0xFF); pl[6] = (uint8_t)((up >> 24) & 0xFF);
    lf_enviar(LT_HB, pl, 7);
    led_pisca(0,30,0);
}
static void link_w2_setup() {
    Serial.setTxTimeoutMs(0);                         // monitor USB fechado nao pode travar a W2
    g_lf_boot_ms = millis();
    LINK.setRxBufferSize(256);
    LINK.onReceiveError(lf_err_cb);
    LINK.begin(LINK_UART_BAUD, SERIAL_8N1, LINK_UART_RX_PIN, LINK_UART_TX_PIN);
    esp_task_wdt_config_t twdt = { .timeout_ms = 8000, .idle_core_mask = 0, .trigger_panic = true };
    esp_task_wdt_reconfigure(&twdt);
    esp_task_wdt_add(NULL);
    Serial.printf("[WAVE2] pronto (link por CABO: UART0 %lu 8N1 TXD=GPIO%d RXD=GPIO%d; sem Wi-Fi/ESP-NOW; fail-safe %lu ms)\n",
                  (unsigned long)LINK_UART_BAUD, LINK_UART_TX_PIN, LINK_UART_RX_PIN, (unsigned long)LINK_FAILSAFE_MS);
}
static void link_w2_loop() {
    esp_task_wdt_reset();
    while (LINK.available()) g_lf.feed((uint8_t)LINK.read(), millis(), (millis() - g_lf_boot_ms) < 3000UL, lf_on_frame);
    uint32_t agora = millis();
    if (g_ult_w1_ms && !g_failsafe_on && (agora - g_ult_w1_ms) > LINK_FAILSAFE_MS) {     // so vale depois do 1o quadro da W1
        g_failsafe_on = true; g_lf_failsafes++;
        for (uint8_t c = 0; c < 8; c++) if (c != LINK_LUZES_IDX && ((do_estado >> c) & 1)) escreve_do(c, false);   // tudo OFF, menos as luzes
        led_pisca(30,0,0);
        Serial.printf("[WAVE2] FAIL-SAFE: sem quadro da W1 ha %lu ms -> saidas desligadas (menos as luzes)\n", (unsigned long)(agora - g_ult_w1_ms));
    }
    if (agora - g_lf_rel_ms >= 30000UL) {             // resumo a cada 30 s (so aparece se o USB estiver aberto)
        g_lf_rel_ms = agora;
        uint32_t u = g_lf_u_brk + g_lf_u_frm + g_lf_u_par + g_lf_u_fifo + g_lf_u_buf;
        Serial.printf("[WAVE2LINK] rx ok=%lu (cmd=%lu keep=%lu) crc_ruim=%lu trunc=%lu espurios=%lu boot=%lu uart_err=%lu | tx=%lu | fail-safes=%lu\n",
                      (unsigned long)g_lf.ok, (unsigned long)g_lf_cmd, (unsigned long)g_lf_keep, (unsigned long)g_lf.crc_ruim, (unsigned long)g_lf.trunc,
                      (unsigned long)g_lf.espurios, (unsigned long)g_lf.boot_bytes, (unsigned long)u, (unsigned long)g_lf_tx, (unsigned long)g_lf_failsafes);
    }
}
#else
// ===================== ESP-NOW ===============================================
static uint8_t g_seq = 0;
static Preferences g_prefs;
static uint8_t     g_canal_atual = ESPNOW_CANAL;

static void aplica_canal(uint8_t ch) {
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    g_canal_atual = ch;
}

static void on_recv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
    if (info->src_addr[3] != ID_MAQUINA) return;
    if (len < (int)sizeof(CabEspNow)) return;
    const CabEspNow* cab = (const CabEspNow*)data;
    if (cab->id_maquina != ID_MAQUINA) return;
    if (cab->tipo == MSG_CANAL && len >= (int)sizeof(MsgCanal)) {
        // So a W1 (mestre) manda a W2 trocar de canal. A CAMERA anuncia o canal do roteador a cada 1 s (MSG_CANAL) e antes isso
        // arrastava a W2 sozinha para o canal da camera (ex.: 6), deixando a W2 muda para a W1/display no canal 1.
        if (memcmp(info->src_addr, MAC_WAVE1, 6) != 0) return;
        const MsgCanal* mc = (const MsgCanal*)data;
        if (mc->canal >= 1 && mc->canal <= 13 && mc->canal != g_canal_atual) {
            aplica_canal(mc->canal);
            g_prefs.putUChar("canal", mc->canal);
            Serial.printf("[WAVE2] migrou pro canal %d (display) -- salvo na NVS\n", mc->canal);
        }
        return;
    }
    if (cab->tipo != MSG_COMANDO || len < (int)sizeof(MsgComando)) return;
    const MsgComando* m = (const MsgComando*)data;
    escreve_do(m->canal, m->estado != 0);
    led_pisca(0,0,30);
}
static void envia_evento(uint8_t borda) {
    MsgEvento e;
    e.cab.tipo=MSG_EVENTO; e.cab.id_maquina=ID_MAQUINA; e.cab.origem=ORIGEM_WAVE2; e.cab.seq=g_seq++;
    e.di_vivo = le_entradas_vivo(); e.di_borda = borda; e.t_us = micros();
    esp_now_send((uint8_t*)MAC_WAVE1, (uint8_t*)&e, sizeof(e));
    led_pisca(30,0,0);
}
static void envia_heartbeat() {
    MsgHeartbeat h;
    h.cab.tipo=MSG_HEARTBEAT; h.cab.id_maquina=ID_MAQUINA; h.cab.origem=ORIGEM_WAVE2; h.cab.seq=g_seq++;
    h.di_vivo = le_entradas_vivo(); h.do_estado = do_estado;
    esp_now_send((uint8_t*)MAC_WAVE1, (uint8_t*)&h, sizeof(h));
    led_pisca(0,30,0);
}
#endif

// A waveshare continua no barramento RS-485 do inversor (mesmos fios A/B,
// que agora so o Delta/SAJ usam). Transceiver em recepcao (alta impedancia)
// pra NAO ocupar o barramento -> DE/RE em LOW.
#define RS485_DE_RE 21

void setup() {
    Serial.begin(115200);
    delay(200);
    hard_reset_fase1("WAVE2");
    hard_reset_radio();
    pinMode(RS485_DE_RE, OUTPUT);
    digitalWrite(RS485_DE_RE, LOW);
    i2c_recupera_barramento(I2C_SDA, I2C_SCL);
    Wire.begin(I2C_SDA, I2C_SCL);
    pca_init();
    for (uint8_t i=0;i<8;i++) {
        pinMode(DI_PINS[i], INPUT_PULLUP);
        attachInterruptArg(digitalPinToInterrupt(DI_PINS[i]), di_isr, (void*)(uint32_t)i, FALLING);
    }

#if LINK_W1_W2_UART
    link_w2_setup();                                  // cabo: UART0 + watchdog; o radio ja foi desligado em hard_reset_radio()
#else
    g_prefs.begin("ws2", false);
    // Recuperacao unica (v2): uma W2 que ja foi arrastada para outro canal pela camera volta ao canal 1 neste primeiro boot.
    if (!g_prefs.getBool("v2", false)) { g_prefs.putUChar("canal", ESPNOW_CANAL); g_prefs.putBool("v2", true); }
    uint8_t canal_salvo = g_prefs.getUChar("canal", ESPNOW_CANAL);
    if (canal_salvo < 1 || canal_salvo > 13) canal_salvo = ESPNOW_CANAL;
    g_canal_atual = canal_salvo;

    WiFi.mode(WIFI_STA); WiFi.disconnect();
    esp_wifi_set_mac(WIFI_IF_STA, (uint8_t*)MAC_WAVE2);
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(g_canal_atual, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    if (esp_now_init()!=ESP_OK){ Serial.println("[ESP-NOW] init FALHOU"); }
    esp_now_set_pmk(ESPNOW_PMK);
    esp_now_register_recv_cb(on_recv);
    esp_now_peer_info_t p = {}; p.channel=0; p.ifidx=WIFI_IF_STA; p.encrypt=true;
    memcpy(p.lmk, ESPNOW_LMK, 16); memcpy(p.peer_addr, MAC_WAVE1, 6); esp_now_add_peer(&p);
    Serial.printf("[WAVE2] pronto (ESP-NOW, canal %d%s)\n", g_canal_atual,
                  (canal_salvo == ESPNOW_CANAL) ? "" : " -- da NVS");
#endif
}

void loop() {
#if LINK_W1_W2_UART
    link_w2_loop();                                   // cabo: recebe quadros da W1, fail-safe e watchdog
#endif
    if (g_ev_pend) {
        noInterrupts();
        uint8_t borda = g_borda_pend; g_borda_pend = 0; g_ev_pend = false;
        interrupts();
        envia_evento(borda);
    }
    static uint32_t t_hb = 0;
    if (millis() - t_hb >= HEARTBEAT_MS) { t_hb = millis(); envia_heartbeat(); }
    led_tick();
}
