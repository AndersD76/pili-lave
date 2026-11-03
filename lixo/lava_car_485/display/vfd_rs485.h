#pragma once
#include <Arduino.h>
#include <HardwareSerial.h>
#include "tipos.h"

// =======================================================================
// vfd_rs485.h — BARRAMENTO RS-485 COMPARTILHADO (multi-drop):
//   Display (mestre) -> Waveshare #1 (addr 1) -> I/O grupo 1
//                     -> Waveshare #2 (addr 2) -> I/O grupo 2
//                     -> Inversor Delta MS300  (addr 3) -> motor
// Era só o inversor aqui (as waveshares tinham migrado pra ESP-NOW); agora
// TUDO volta pro fio — ESP-NOW só continua pra CÂMERA (não muda).
// Primitivas Modbus RTU genéricas ficam aqui (mb_transacao/mb_read_di/
// mb_write_coil/mb_read_regs/mb_write_reg); quem as usa pras waveshares é
// modbus_waveshares.h, e pro inversor é este mesmo arquivo (funções
// vfd_run_fwd/rev/stop já existentes, comportamento igual a antes).
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

// Mutex que serializa TODO acesso ao barramento — agora usado pelas 3
// "conversas" (waveshare1, waveshare2, inversor), não só pelo inversor.
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
// A espera CEDE o processador (vTaskDelay(1)) em vez de girar em busy-wait —
// sem isso, essa função rodando numa task de prioridade alta trava a tela/
// toque enquanto espera (bug real encontrado e corrigido no teste isolado
// de RS-485 antes de vir pra produção).
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
    uint32_t t_espera_ini = millis();
    while (millis() - t0 < timeout_ms) {
        if (RS485_SERIAL.available()) {
            resp[pos++] = RS485_SERIAL.read();
            if (pos >= resp_max) break;
            t0 = millis();
            t_espera_ini = millis();   // reinicia a janela de espera ativa a cada byte
        } else if (millis() - t_espera_ini < 5) {
            // Espera ATIVA nos primeiros 5ms — resposta normal (sem falha) chega
            // bem mais rápido que isso a 9600 baud; sem essa janela, o
            // vTaskDelay(1) abaixo arredonda pro tick do FreeRTOS (10ms de
            // verdade, não 1ms), deixando cada transação de sucesso ~10x mais
            // lenta do que precisa (encontrado ao medir: 0% de erro, mas cada
            // ciclo de 4 leituras levando ~500ms em vez de <100ms).
            taskYIELD();
        } else {
            vTaskDelay(1);   // só passa a ceder de verdade se realmente demorar
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

// FC01 — Le coils (saidas) — nao usado hoje, mantido por completude
static bool mb_read_coils(uint8_t addr, uint16_t start, uint8_t count, uint8_t* out) {
    uint8_t req[8], resp[16];
    req[0] = addr; req[1] = 0x01;
    req[2] = start >> 8; req[3] = start & 0xFF;
    req[4] = 0x00; req[5] = count;
    // resp_max = tamanho EXATO da resposta esperada (6 bytes: addr+fc+
    // bytecount+1databyte+2crc) — passar um buffer maior fazia a espera
    // continuar ate o timeout INTEIRO mesmo apos a resposta completa ja
    // ter chegado (achado ao medir: cada leitura levava ~130ms em vez de
    // ~15ms, mesmo com 0% de erro — o timeout de 100ms era sempre esperado
    // por completo, so pra "confirmar" que nao vinha mais nada).
    int n = mb_transacao(req, 6, resp, 6);
    if (n < 4 || resp[1] != 0x01) return false;
    *out = resp[3];
    return true;
}

// FC02 — Le discrete inputs (entradas das waveshares)
static bool mb_read_di(uint8_t addr, uint16_t start, uint8_t count, uint8_t* out) {
    uint8_t req[8], resp[16];
    req[0] = addr; req[1] = 0x02;
    req[2] = start >> 8; req[3] = start & 0xFF;
    req[4] = 0x00; req[5] = count;
    int n = mb_transacao(req, 6, resp, 6);   // resp exata: 6 bytes (ver comentario acima)
    if (n < 4 || resp[1] != 0x02) return false;
    *out = resp[3];
    return true;
}

// FC05 — Escreve coil unico (saidas das waveshares)
static bool mb_write_coil(uint8_t addr, uint16_t coil, bool estado) {
    uint8_t req[8], resp[8];
    req[0] = addr; req[1] = 0x05;
    req[2] = coil >> 8; req[3] = coil & 0xFF;
    req[4] = estado ? 0xFF : 0x00; req[5] = 0x00;
    int n = mb_transacao(req, 6, resp, 8);   // FC05 responde com eco de 8 bytes
    return (n >= 6 && resp[1] == 0x05);
}

// FC06 — Escreve registrador unico (inversor)
static bool mb_write_reg(uint8_t addr, uint16_t reg, uint16_t val) {
    uint8_t req[8], resp[8];
    req[0] = addr; req[1] = 0x06;
    req[2] = reg >> 8; req[3] = reg & 0xFF;
    req[4] = val >> 8; req[5] = val & 0xFF;
    int n = mb_transacao(req, 6, resp, 8);   // FC06 responde com eco de 8 bytes
    return (n >= 6 && resp[1] == 0x06);
}

// FC03 — Le registradores (inversor)
static bool mb_read_regs(uint8_t addr, uint16_t start, uint8_t count, uint16_t* out) {
    uint8_t req[8], resp[32];
    req[0] = addr; req[1] = 0x03;
    req[2] = start >> 8; req[3] = start & 0xFF;
    req[4] = 0x00; req[5] = count;
    int n = mb_transacao(req, 6, resp, 5 + count * 2);   // resp exata: addr+fc+bytecount+dados+crc
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

// Le freq/corrente/status do inversor (chamar periodicamente, ~200ms).
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
// anterior) -> comeca limpo e segue a nova programacao.
void vfd_reset() {
    vfd_write_reg_retry(MB_VFD_CMD,  VFD_STOP);
    vfd_write_reg_retry(MB_VFD_FREQ, 0);
    g_vfd_mov = 0; g_vfd_mov_freq = 0;
}

// Inicializa o barramento RS-485 compartilhado. 8E1 (o MS300 esta fixo em 8E1;
// as waveshares tambem sobem em 8E1 nesse mesmo barramento).
void vfd_rs485_init() {
    if (!g_mb_mutex) g_mb_mutex = xSemaphoreCreateMutex();
    RS485_SERIAL.begin(RS485_BAUD, SERIAL_8E1, RS485_RX, RS485_TX);
    delay(100);
    vfd_reset();   // zera o comando/frequencia do inversor no boot
}
