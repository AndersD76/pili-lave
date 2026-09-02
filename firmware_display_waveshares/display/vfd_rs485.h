#pragma once
#include <Arduino.h>
#include <HardwareSerial.h>
#include "tipos.h"

// =======================================================================
// vfd_rs485.h — comunicacao Display <-> Inversor Delta MS300 (addr 3).
// CONTINUA em RS-485 Modbus RTU 9600 8E1 (as Waveshares migraram p/ ESP-NOW).
// Extraido do antigo modbus_master.h (so a parte do inversor).
// =======================================================================

// RS-485 — TX=16, RX=15 (invertido em relacao ao rotulo do wiki), DE/RE auto.
#define RS485_TX     16
#define RS485_RX     15
#define RS485_BAUD   9600
HardwareSerial RS485_SERIAL(1);

// Estado do inversor (leitura)
float    g_vfd_freq     = 0;
float    g_vfd_corrente = 0;
uint16_t g_vfd_status   = 0;

// Movimento comandado (p/ pause/retomar)
uint8_t  g_vfd_mov      = 0;   // 0=parado 1=fwd 2=rev
uint16_t g_vfd_mov_freq = 0;

// Mutex que serializa TODO acesso a UART RS485.
static SemaphoreHandle_t g_mb_mutex = nullptr;

// CRC-16 Modbus
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

// Envia frame e aguarda resposta. Valida CRC. Silencio T3.5 (4,5ms) entre frames.
// Retorno: nº de bytes recebidos, ou -1 (curto) / -2 (CRC invalido).
static int mb_transacao(uint8_t* req, uint8_t req_len, uint8_t* resp,
                        uint8_t resp_max, uint32_t timeout_ms = 100) {
    if (g_mb_mutex) xSemaphoreTake(g_mb_mutex, portMAX_DELAY);

    uint16_t crc = crc16(req, req_len);
    req[req_len++] = crc & 0xFF;
    req[req_len++] = (crc >> 8) & 0xFF;

    while (RS485_SERIAL.available()) RS485_SERIAL.read();
    RS485_SERIAL.write(req, req_len);
    RS485_SERIAL.flush();

    uint32_t t0 = millis();
    uint8_t  pos = 0;
    while (millis() - t0 < timeout_ms) {
        if (RS485_SERIAL.available()) {
            resp[pos++] = RS485_SERIAL.read();
            if (pos >= resp_max) break;
            t0 = millis();
        }
    }

    int resultado;
    if (pos < 4) {
        resultado = -1;
    } else {
        uint16_t crc_recv = (resp[pos-1] << 8) | resp[pos-2];
        uint16_t crc_calc = crc16(resp, pos - 2);
        resultado = (crc_recv != crc_calc) ? -2 : pos;
    }
    delayMicroseconds(4500);   // T3.5 a 9600 8E1
    if (g_mb_mutex) xSemaphoreGive(g_mb_mutex);
    return resultado;
}

// FC06 — Escreve registrador unico
static bool mb_write_reg(uint8_t addr, uint16_t reg, uint16_t val) {
    uint8_t req[8], resp[8];
    req[0] = addr; req[1] = 0x06;
    req[2] = reg >> 8; req[3] = reg & 0xFF;
    req[4] = val >> 8; req[5] = val & 0xFF;
    int n = mb_transacao(req, 6, resp, sizeof(resp));
    return (n >= 6 && resp[1] == 0x06);
}

// FC03 — Le registradores
static bool mb_read_regs(uint8_t addr, uint16_t start, uint8_t count, uint16_t* out) {
    uint8_t req[8], resp[32];
    req[0] = addr; req[1] = 0x03;
    req[2] = start >> 8; req[3] = start & 0xFF;
    req[4] = 0x00; req[5] = count;
    int n = mb_transacao(req, 6, resp, sizeof(resp));
    if (n < 5 || resp[1] != 0x03) return false;
    for (int i = 0; i < count; i++) out[i] = (resp[3 + i*2] << 8) | resp[4 + i*2];
    return true;
}

// Escreve registrador do inversor com RETRY (ate 4x). Critico p/ a FREQUENCIA:
// se o write se perde, o VFD fica com a freq velha e o motor arranca errado.
static void vfd_write_reg_retry(uint16_t reg, uint16_t val) {
    for (uint8_t i = 0; i < 4; i++) {
        if (mb_write_reg(MB_ADDR_INVERSOR, reg, val)) return;
        delay(15);
    }
}

void vfd_run_fwd(uint16_t freq_hz10) {
    g_vfd_mov = 1; g_vfd_mov_freq = freq_hz10;
    vfd_write_reg_retry(MB_VFD_FREQ, freq_hz10 * 10);   // 0.1Hz -> 0.01Hz
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
bool vfd_em_falha() { return (g_vfd_status & 0x0008) != 0; }   // bit3 = FALHA

// Le freq/corrente/status do inversor (chamar periodicamente no loop, ~200ms).
void vfd_poll() {
    uint16_t regs[2];
    if (mb_read_regs(MB_ADDR_INVERSOR, MB_VFD_FREQ_OUT, 2, regs)) {
        g_vfd_freq     = regs[0] / 100.0f;
        g_vfd_corrente = regs[1] / 10.0f;
    }
    uint16_t s[1];
    if (mb_read_regs(MB_ADDR_INVERSOR, MB_VFD_STATUS, 1, s)) g_vfd_status = s[0];
}

// RESET do estado do inversor: PARA e ZERA o registrador de frequencia. Chamado
// no boot (cada religada) p/ o VFD NAO herdar a freq antiga (ex.: 5Hz da rampa
// anterior) -> comeca limpo e segue a nova programacao. (Nao mexe nos parametros
// de fabrica/config do inversor — so limpa o comando de velocidade.)
void vfd_reset() {
    vfd_write_reg_retry(MB_VFD_CMD,  VFD_STOP);
    vfd_write_reg_retry(MB_VFD_FREQ, 0);
    g_vfd_mov = 0; g_vfd_mov_freq = 0;
}

// Inicializa a UART do inversor. 8E1 (o MS300 esta fixo em 8E1).
void vfd_rs485_init() {
    if (!g_mb_mutex) g_mb_mutex = xSemaphoreCreateMutex();
    RS485_SERIAL.begin(RS485_BAUD, SERIAL_8E1, RS485_RX, RS485_TX);
    delay(100);
    vfd_reset();   // zera o comando/frequencia do inversor no boot
}
