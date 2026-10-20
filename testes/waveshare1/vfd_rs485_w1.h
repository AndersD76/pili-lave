#pragma once
#include <Arduino.h>
#include <HardwareSerial.h>

// =======================================================================
// vfd_rs485_w1.h — RS-485 do inversor Delta/SAJ, agora dono E MESTRE
// direto pela Waveshare 1 (antes era o display). Mesmas primitivas Modbus
// RTU do vfd_rs485.h original, só adaptadas pro hardware desta placa:
//   - Pinos TX=17, RX=18, DE/RE=21 (achados no firmware antigo desta
//     placa, de quando ela era escrava Modbus — ver backup_comunicacao_rs485_geral).
//   - DE/RE MANUAL (a Waveshare usa um transceptor sem deteccao automatica
//     de direcao, diferente do chip do display) — precisa togglar o pino
//     antes/depois de cada escrita.
// =======================================================================

#define RS485_TX     17
#define RS485_RX     18
#define RS485_DE_RE  21
#define RS485_BAUD   9600
HardwareSerial RS485_SERIAL(2);

// Estado do inversor (leitura)
float    g_vfd_freq     = 0;
float    g_vfd_corrente = 0;
uint16_t g_vfd_status   = 0;

// Movimento comandado (p/ pause/retomar)
uint8_t  g_vfd_mov      = 0;   // 0=parado 1=fwd 2=rev
uint16_t g_vfd_mov_freq = 0;

static SemaphoreHandle_t g_mb_mutex = nullptr;

// Estatistica do barramento (diagnostico): como as transacoes terminam.
//   ok    = resposta valida (CRC certo)
//   zero  = NENHUM byte de resposta (escravo mudo: endereco, fiacao, baud, DE/RE)
//   curta = 1 a 3 bytes (lixo/ruido, resposta incompleta)
//   crc   = resposta completa mas CRC errado (corrompida: ruido)
uint32_t g_mb_ok = 0, g_mb_zero = 0, g_mb_curta = 0, g_mb_crc = 0;

static uint16_t crc16(const uint8_t* buf, uint16_t len) {
    uint16_t crc = 0xFFFF;
    for (uint16_t i = 0; i < len; i++) {
        crc ^= buf[i];
        for (uint8_t j = 0; j < 8; j++) {
            if (crc & 0x0001) { crc >>= 1; crc ^= 0xA001; }
            else               { crc >>= 1; }
        }
    }
    return crc;
}

// Envia frame com DE/RE manual (liga antes, espera o byte sair de verdade,
// desliga depois) e aguarda resposta. Mesma logica/timings do vfd_rs485.h
// original (espera ativa 5ms + cede CPU depois), só com o toggle do DE/RE
// que o transceptor desta placa exige.
static int mb_transacao(uint8_t* req, uint8_t req_len, uint8_t* resp,
                        uint8_t resp_max, uint32_t timeout_ms = 40) {   // 40ms (era 100): o Delta responde em ~10-15ms; esperar menos nao trava o loop e os sensores sao lidos mais rapido sob ruido
    if (g_mb_mutex) xSemaphoreTake(g_mb_mutex, portMAX_DELAY);

    uint16_t crc = crc16(req, req_len);
    req[req_len++] = crc & 0xFF;
    req[req_len++] = (crc >> 8) & 0xFF;

    while (RS485_SERIAL.available()) RS485_SERIAL.read();
    digitalWrite(RS485_DE_RE, HIGH);
    RS485_SERIAL.write(req, req_len);
    RS485_SERIAL.flush();
    delayMicroseconds(500);   // garante o ultimo bit sair antes de soltar o barramento
    digitalWrite(RS485_DE_RE, LOW);

    uint32_t t0 = millis();
    uint8_t  pos = 0;
    uint32_t t_espera_ini = millis();
    while (millis() - t0 < timeout_ms) {
        if (RS485_SERIAL.available()) {
            resp[pos++] = RS485_SERIAL.read();
            if (pos >= resp_max) break;
            t0 = millis();
            t_espera_ini = millis();
        } else if (millis() - t_espera_ini < 5) {
            taskYIELD();
        } else {
            vTaskDelay(1);
        }
    }

    int resultado;
    if (pos < 4) {
        resultado = -1;
        if (pos == 0) g_mb_zero++; else g_mb_curta++;   // nada recebido x lixo parcial
    } else {
        uint16_t crc_recv = (resp[pos-1] << 8) | resp[pos-2];
        uint16_t crc_calc = crc16(resp, pos - 2);
        if (crc_recv != crc_calc) { resultado = -2; g_mb_crc++; }
        else                      { resultado = pos; g_mb_ok++; }
    }
    delayMicroseconds(4500);   // T3.5 a 9600 8E1
    if (g_mb_mutex) xSemaphoreGive(g_mb_mutex);
    return resultado;
}

static bool mb_read_coils(uint8_t addr, uint16_t start, uint8_t count, uint8_t* out) {
    uint8_t req[8], resp[16];
    req[0] = addr; req[1] = 0x01;
    req[2] = start >> 8; req[3] = start & 0xFF;
    req[4] = 0x00; req[5] = count;
    int n = mb_transacao(req, 6, resp, 6);
    if (n < 4 || resp[1] != 0x01) return false;
    *out = resp[3];
    return true;
}

static bool mb_write_coil(uint8_t addr, uint16_t coil, bool estado) {
    uint8_t req[8], resp[8];
    req[0] = addr; req[1] = 0x05;
    req[2] = coil >> 8; req[3] = coil & 0xFF;
    req[4] = estado ? 0xFF : 0x00; req[5] = 0x00;
    int n = mb_transacao(req, 6, resp, 8);
    return (n >= 6 && resp[1] == 0x05);
}

static bool mb_write_reg(uint8_t addr, uint16_t reg, uint16_t val) {
    uint8_t req[8], resp[8];
    req[0] = addr; req[1] = 0x06;
    req[2] = reg >> 8; req[3] = reg & 0xFF;
    req[4] = val >> 8; req[5] = val & 0xFF;
    int n = mb_transacao(req, 6, resp, 8);
    return (n >= 6 && resp[1] == 0x06);
}

static bool mb_read_regs(uint8_t addr, uint16_t start, uint8_t count, uint16_t* out) {
    uint8_t req[8], resp[32];
    req[0] = addr; req[1] = 0x03;
    req[2] = start >> 8; req[3] = start & 0xFF;
    req[4] = 0x00; req[5] = count;
    int n = mb_transacao(req, 6, resp, 5 + count * 2);
    if (n < 5 || resp[1] != 0x03) return false;
    for (int i = 0; i < count; i++) out[i] = (resp[3 + i*2] << 8) | resp[4 + i*2];
    return true;
}

// Registradores do Delta MS300 (ver tipos.h original no display)
#define MB_ADDR_INVERSOR 3
#define MB_VFD_CMD       0x2000
#define MB_VFD_FREQ      0x2001
#define MB_VFD_FREQ_OUT  0x2100
#define MB_VFD_CORRENTE  0x2101
#define MB_VFD_STATUS    0x2103
#define VFD_FWD          0x0012
#define VFD_REV          0x0022
#define VFD_STOP         0x0001

uint32_t g_vfd_write_falhas = 0;

static void vfd_write_reg_retry(uint16_t reg, uint16_t val) {
    for (uint8_t i = 0; i < 4; i++) {
        if (mb_write_reg(MB_ADDR_INVERSOR, reg, val)) return;
        delay(15);
    }
    g_vfd_write_falhas++;
    Serial.printf("[VFD] FALHA escrita reg=0x%04X val=%u apos 4 tentativas (total falhas=%u)\n",
                  reg, val, (unsigned)g_vfd_write_falhas);
}

void vfd_run_fwd(uint16_t freq_hz10) {
    g_vfd_mov = 1; g_vfd_mov_freq = freq_hz10;
    vfd_write_reg_retry(MB_VFD_FREQ, freq_hz10 * 10);
    delay(10);
    vfd_write_reg_retry(MB_VFD_CMD, VFD_FWD);
}
void vfd_run_rev(uint16_t freq_hz10) {
    g_vfd_mov = 2; g_vfd_mov_freq = freq_hz10;
    vfd_write_reg_retry(MB_VFD_FREQ, freq_hz10 * 10);
    delay(10);
    vfd_write_reg_retry(MB_VFD_CMD, VFD_REV);
}
void vfd_stop() {
    g_vfd_mov = 0;
    vfd_write_reg_retry(MB_VFD_CMD, VFD_STOP);
}
bool vfd_em_falha() { return (g_vfd_status & 0x0008) != 0; }

bool vfd_lendo_rodando() {
    for (uint8_t i = 0; i < 3; i++) {
        uint16_t s[1];
        if (mb_read_regs(MB_ADDR_INVERSOR, MB_VFD_STATUS, 1, s)) {
            g_vfd_status = s[0];
            return (s[0] & 0x0001) != 0;
        }
        delay(10);
    }
    return true;
}

void vfd_poll() {
    uint16_t regs[2];
    if (mb_read_regs(MB_ADDR_INVERSOR, MB_VFD_FREQ_OUT, 2, regs)) {
        g_vfd_freq     = regs[0] / 100.0f;
        g_vfd_corrente = regs[1] / 10.0f;
    }
    uint16_t s[1];
    if (mb_read_regs(MB_ADDR_INVERSOR, MB_VFD_STATUS, 1, s)) g_vfd_status = s[0];
}

void vfd_reset() {
    vfd_write_reg_retry(MB_VFD_CMD,  VFD_STOP);
    vfd_write_reg_retry(MB_VFD_FREQ, 0);
    g_vfd_mov = 0; g_vfd_mov_freq = 0;
}

void vfd_rs485_init() {
    if (!g_mb_mutex) g_mb_mutex = xSemaphoreCreateMutex();
    pinMode(RS485_DE_RE, OUTPUT);
    digitalWrite(RS485_DE_RE, LOW);
    RS485_SERIAL.begin(RS485_BAUD, SERIAL_8E1, RS485_RX, RS485_TX);
    delay(100);
    vfd_reset();
}
