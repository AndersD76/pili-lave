/*
  waveshare2.ino — PRODUÇÃO (lava_car_485)
  Waveshare ESP32-S3-POE-ETH-8DI-8DO #2 — escravo Modbus RTU endereco 2
  Pili Tecnologia — migrado do ESP-NOW pro RS-485 cabeado (mesmo mapa de
  pinos/DO/travas do firmware ESP-NOW anterior, só o transporte mudou).

  ========================================================================
  IDENTICO AO teste_giro_ws1.ino, mudando apenas:
    - MB_ADDR = 2
    - Mapa de sensores (comentarios)
    - CANAL_TRAVADO = DO4 = Y14 (contator deslocamento)
    - CANAL_BLOQUEADO = DO5 = Y15 (nunca aciona)

  LATCH POR INTERRUPCAO: cada DI tem attachInterrupt() na borda de descida.
  O pulso e capturado no instante que acontece, retido num latch, e so
  zerado quando o mestre le (read-and-clear). Nenhum pulso se perde.

  ========================================================================
  MAPA MODBUS (FC02 — Read Discrete Inputs)
  ========================================================================
    start = 0, count = 8   -> estado AO VIVO das 8 DIs (compatibilidade)
    start = 8, count = 8   -> LATCH das 8 DIs (read-and-clear)

  ========================================================================
  SENSORES MONITORADOS NESTE TESTE
  ========================================================================
    DI2 (GPIO5)  = X11       — giro braco posicao intermediaria
    DI7 (GPIO10) = X17       — HOME braco (posicao 1 E posicao 2)
    DI8 (GPIO11) = HOME_GIRO — sensor dedicado posicao 1

  ========================================================================
  CONFIGURACOES OBRIGATORIAS (Tools no Arduino IDE)
  ========================================================================
    Board             ESP32S3 Dev Module
    Flash Size        16MB
    Partition Scheme  Default 8MB with spiffs
    PSRAM             OPI PSRAM (8MB)
    CPU Frequency     240MHz
    Flash Mode        QIO 80MHz
    USB CDC On Boot   Enabled
*/

#include <Arduino.h>
#include <Wire.h>

#define MB_ADDR 2

// ── RS485 ───────────────────────────────────────────────────────────────
#define RS485_TX     17
#define RS485_RX     18
#define RS485_DE_RE  21
#define MB_BAUD      9600
HardwareSerial RS485_SERIAL(2);

// ── I2C / PCA9554 ───────────────────────────────────────────────────────
#define I2C_SDA         42
#define I2C_SCL         41
#define PCA9554_ADDR    0x20
#define PCA9554_REG_OUTPUT   0x01
#define PCA9554_REG_CONFIG   0x03
#define DO_LOGICA_INVERTIDA 1

// ── LED RGB de debug ────────────────────────────────────────────────────
#define LED_PIN 38
static inline void led_cor(uint8_t r, uint8_t g, uint8_t b) { rgbLedWrite(LED_PIN, r, g, b); }

// ── Pinos DI — logica NPN: sensor ativo = nivel BAIXO ───────────────────
#define DI1_PIN 4    // X10 — sensor vertical carro sob mesa
#define DI2_PIN 5    // X11 — SENSOR GIRO BRACO       <<< monitorado
#define DI3_PIN 6    // X12 — fim de curso sentido B
#define DI4_PIN 7    // X13 — fim de curso sentido A
#define DI5_PIN 8    // X14 — carro entrando
#define DI6_PIN 9    // X15 — carro na posicao de lavagem
#define DI7_PIN 10   // X17 — HOME braco (pos 1 E 2)  <<< monitorado
#define DI8_PIN 11   // HOME_GIRO — dedicado pos 1    <<< monitorado

static const uint8_t DI_PINS[8] = { DI1_PIN, DI2_PIN, DI3_PIN, DI4_PIN,
                                    DI5_PIN, DI6_PIN, DI7_PIN, DI8_PIN };

// =======================================================================
// LATCH DE PULSOS
// =======================================================================
volatile uint8_t  di_latch       = 0x00;
volatile uint32_t di_contador[8] = {0,0,0,0,0,0,0,0};

#define DEBOUNCE_US  800
volatile uint32_t di_ultimo_us[8] = {0,0,0,0,0,0,0,0};

static void IRAM_ATTR di_isr(void* arg) {
    uint32_t canal = (uint32_t)arg;
    uint32_t agora = micros();
    if (agora - di_ultimo_us[canal] < DEBOUNCE_US) return;
    di_ultimo_us[canal] = agora;
    di_latch |= (1 << canal);
    di_contador[canal]++;
}

static uint8_t le_e_limpa_latch() {
    noInterrupts();
    uint8_t v = di_latch;
    di_latch = 0x00;
    interrupts();
    return v;
}

static uint8_t le_entradas_vivo() {
    uint8_t val = 0;
    for (uint8_t i = 0; i < 8; i++) {
        if (digitalRead(DI_PINS[i]) == LOW) val |= (1 << i);
    }
    return val;
}

// =======================================================================
// Saidas DO via PCA9554
// =======================================================================
#define CANAL_TRAVADO   3       // DO4 = Y14 (contator deslocamento)
#define CANAL_BLOQUEADO 4       // DO5 = Y15 — nunca aciona
#define TRAVA_MS        500

static uint8_t       do_estado = 0x00;
static unsigned long ultimo_off_travado = 0;
static bool          primeiro_ciclo_trava = true;

static void pca9554_write_reg(uint8_t reg, uint8_t val) {
    Wire.beginTransmission(PCA9554_ADDR);
    Wire.write(reg);
    Wire.write(val);
    Wire.endTransmission();
}

static void pca9554_init() {
    pca9554_write_reg(PCA9554_REG_CONFIG, 0x00);
    pca9554_write_reg(PCA9554_REG_OUTPUT, DO_LOGICA_INVERTIDA ? 0xFF : 0x00);
    do_estado = 0x00;
}

static void pca9554_aplica_estado() {
    uint8_t val = DO_LOGICA_INVERTIDA ? (uint8_t)~do_estado : do_estado;
    pca9554_write_reg(PCA9554_REG_OUTPUT, val);
}

static bool escreve_do(uint8_t canal, bool ligar) {
    if (canal > 7) return false;
    if (canal == CANAL_BLOQUEADO) return false;   // Y15 bloqueado

    bool estava_ligado = (do_estado >> canal) & 0x01;

    if (canal == CANAL_TRAVADO) {
        if (ligar) {
            unsigned long desde_off = millis() - ultimo_off_travado;
            if (!primeiro_ciclo_trava && desde_off < TRAVA_MS) return false;
        } else if (estava_ligado) {
            ultimo_off_travado = millis();
            primeiro_ciclo_trava = false;
        }
    }

    if (ligar) do_estado |=  (1 << canal);
    else       do_estado &= ~(1 << canal);
    pca9554_aplica_estado();
    return true;
}

// =======================================================================
// Modbus RTU
// =======================================================================
static uint16_t crc16(const uint8_t* buf, uint8_t len) {
    uint16_t crc = 0xFFFF;
    for (uint8_t i = 0; i < len; i++) {
        crc ^= buf[i];
        for (uint8_t j = 0; j < 8; j++) {
            if (crc & 0x0001) { crc >>= 1; crc ^= 0xA001; }
            else               { crc >>= 1; }
        }
    }
    return crc;
}

static unsigned long led_apagar_em = 0;
static void led_pisca(uint8_t r, uint8_t g, uint8_t b) {
    led_cor(r, g, b);
    led_apagar_em = millis() + 30;
}
static void led_tick() {
    if (led_apagar_em != 0 && millis() >= led_apagar_em) {
        led_cor(0, 0, 0);
        led_apagar_em = 0;
    }
}

static void rs485_enviar(const uint8_t* buf, uint8_t len) {
    digitalWrite(RS485_DE_RE, HIGH);
    RS485_SERIAL.write(buf, len);
    RS485_SERIAL.flush();
    delayMicroseconds(500);
    digitalWrite(RS485_DE_RE, LOW);
}

static void processa_frame(uint8_t* frame, uint8_t len) {
    uint8_t fc = frame[1];

    if (fc == 0x02) {
        if (len != 8) return;
        uint16_t start = (frame[2] << 8) | frame[3];
        uint16_t count = (frame[4] << 8) | frame[5];
        if (count == 0 || count > 8) return;

        uint8_t dado;

        if (start < 8) {
            if ((start + count) > 8) return;
            uint8_t vivo = le_entradas_vivo();
            dado = (vivo >> start) & (0xFF >> (8 - count));

        } else if (start >= 8 && start < 16) {
            uint16_t s = start - 8;
            if ((s + count) > 8) return;
            uint8_t latch = le_e_limpa_latch();
            dado = (latch >> s) & (0xFF >> (8 - count));

        } else {
            return;
        }

        uint8_t resp[6];
        resp[0] = MB_ADDR;
        resp[1] = 0x02;
        resp[2] = 0x01;
        resp[3] = dado;
        uint16_t crc = crc16(resp, 4);
        resp[4] = crc & 0xFF;
        resp[5] = (crc >> 8) & 0xFF;

        rs485_enviar(resp, 6);
        led_pisca(0, 30, 0);

    } else if (fc == 0x05) {
        if (len != 8) return;
        uint16_t coil  = (frame[2] << 8) | frame[3];
        uint16_t value = (frame[4] << 8) | frame[5];
        if (coil > 7) return;
        if (value != 0xFF00 && value != 0x0000) return;

        bool ok = escreve_do((uint8_t)coil, (value == 0xFF00));

        if (ok) {
            rs485_enviar(frame, len);
            led_pisca(0, 0, 30);
        } else {
            uint8_t resp[5];
            resp[0] = MB_ADDR;
            resp[1] = 0x05 | 0x80;
            resp[2] = 0x04;
            uint16_t crc = crc16(resp, 3);
            resp[3] = crc & 0xFF;
            resp[4] = (crc >> 8) & 0xFF;
            rs485_enviar(resp, 5);
            led_pisca(30, 0, 0);
        }
    }
}

#define FRAME_BUF_SIZE 32
static uint8_t       frame_buf[FRAME_BUF_SIZE];
static uint8_t       frame_pos = 0;
static unsigned long ultimo_byte_us = 0;
#define T35_US  4010

static void modbus_rx_tick() {
    while (RS485_SERIAL.available()) {
        if (frame_pos < FRAME_BUF_SIZE) frame_buf[frame_pos++] = RS485_SERIAL.read();
        else                            RS485_SERIAL.read();
        ultimo_byte_us = micros();
    }

    if (frame_pos > 0 && (micros() - ultimo_byte_us) > T35_US) {
        if (frame_pos >= 4 && frame_buf[0] == MB_ADDR) {
            uint16_t crc_calc = crc16(frame_buf, frame_pos - 2);
            uint16_t crc_recv = frame_buf[frame_pos-2] | (frame_buf[frame_pos-1] << 8);
            if (crc_calc == crc_recv) {
                processa_frame(frame_buf, frame_pos);
            } else {
                led_pisca(30, 15, 0);
            }
        }
        frame_pos = 0;
    }
}

// =======================================================================
// Setup
// =======================================================================
void setup() {
    Serial.begin(115200);
    delay(300);
    Serial.println();
    Serial.println("[WS2-TESTE] Escravo Modbus addr 2 — LATCH de pulsos ativo");
    Serial.println("[WS2-TESTE] FC02 start=0  -> estado ao vivo");
    Serial.println("[WS2-TESTE] FC02 start=8  -> latch (read-and-clear)");
    Serial.println("[WS2-TESTE] DI2=X11  DI7=X17  DI8=HOME_GIRO");

    for (uint32_t i = 0; i < 8; i++) {
        pinMode(DI_PINS[i], INPUT_PULLUP);
        attachInterruptArg(digitalPinToInterrupt(DI_PINS[i]),
                           di_isr, (void*)i, FALLING);
    }

    Wire.begin(I2C_SDA, I2C_SCL);
    pca9554_init();

    led_cor(0, 0, 0);

    pinMode(RS485_DE_RE, OUTPUT);
    digitalWrite(RS485_DE_RE, LOW);
    RS485_SERIAL.begin(MB_BAUD, SERIAL_8E1, RS485_RX, RS485_TX);

    Serial.println("[WS2-TESTE] Pronto");
}

// =======================================================================
// Loop
// =======================================================================
void loop() {
    modbus_rx_tick();
    led_tick();

    static unsigned long t_hb = 0;
    if (millis() - t_hb > 3000) {
        t_hb = millis();
        Serial.printf("[HB-WS2] vivo=0x%02X latch=0x%02X | X11=%lu X17=%lu HOME=%lu\n",
                      le_entradas_vivo(), di_latch,
                      (unsigned long)di_contador[1],
                      (unsigned long)di_contador[6],
                      (unsigned long)di_contador[7]);
    }
}
