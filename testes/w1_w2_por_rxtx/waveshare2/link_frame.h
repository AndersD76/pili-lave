// link_frame.h — QUADRO e receptor do link W1<->W2 por cabo. IDENTICO nas pastas waveshare1 e waveshare2 (confira com cmp).
// Mesmo formato validado na Fase 1 (teste_link):  A5 5A | tipo | seq (2 B, little-endian) | len | payload[len] | CRC16 (2 B, little-endian)
// CRC16-CCITT (poly 0x1021, init 0xFFFF) sobre tipo, seq, len e payload (NAO inclui A5 5A).
//
// Tipos de producao:
//   LT_HB   0x10  W2 -> W1  a cada 200 ms:  [di_vivo][do_estado][motivo_do_reset][uptime_s (4 B, little-endian)]   (len >= 2 basta)
//   LT_EVT  0x11  W2 -> W1  na hora de cada borda de entrada:  [di_vivo][di_borda]
//   LT_CMD  0x12  W1 -> W2  a cada ordem de saida:  [canal 0..7][estado 0/1]       (mesma semantica do antigo MsgComando)
//   LT_KEEP 0x13  W1 -> W2  a cada 200 ms, sem payload: sinal de vida (a W2 desliga as saidas se ele sumir por 2 s)
// Sem confirmacao por quadro (igual ao ESP-NOW antigo): o reconciliador da W1 compara o comandado com o do_estado do heartbeat.
//
// Receptor: procura A5 5A; descarta e conta o que nao for quadro (o GPIO43 de cada placa cospe texto de boot do ROM por instantes depois de
// um reset: nos primeiros 3 s esse lixo e contado a parte); len > LF_MAXP e lixo; quadro parado no meio por mais de 20 ms = truncado;
// CRC errado = CRC ruim; nos dois casos ressincroniza no proximo A5 5A. Nenhum laco bloqueante.
#pragma once
#include <Arduino.h>

#define LF_SYNC1       0xA5
#define LF_SYNC2       0x5A
#define LF_MAXP        32
#define LF_TMO_BYTE_MS 20
enum : uint8_t { LT_HB = 0x10, LT_EVT = 0x11, LT_CMD = 0x12, LT_KEEP = 0x13 };

static inline uint16_t lf_crc_upd(uint16_t crc, uint8_t b) {
    crc ^= (uint16_t)b << 8;
    for (uint8_t i = 0; i < 8; i++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    return crc;
}
// Monta um quadro em 'out' (tamanho >= 8 + len). Devolve o numero de bytes.
static inline size_t lf_build(uint8_t* out, uint8_t tipo, uint16_t seq, const uint8_t* pl, uint8_t len) {
    out[0] = LF_SYNC1; out[1] = LF_SYNC2; out[2] = tipo; out[3] = (uint8_t)(seq & 0xFF); out[4] = (uint8_t)(seq >> 8); out[5] = len;
    if (len) memcpy(&out[6], pl, len);
    uint16_t c = 0xFFFF;
    for (uint8_t i = 2; i < 6 + len; i++) c = lf_crc_upd(c, out[i]);
    out[6 + len] = (uint8_t)(c & 0xFF); out[7 + len] = (uint8_t)(c >> 8);
    return (size_t)8 + len;
}

typedef void (*lf_on_frame_t)(uint8_t tipo, uint16_t seq, const uint8_t* pl, uint8_t len);

struct LfParser {
    uint8_t  st = 0, tipo = 0, len = 0, pos = 0;
    uint16_t seq = 0, crc = 0, crc_rx = 0;
    uint8_t  pl[LF_MAXP];
    uint32_t t_ult = 0;
    volatile uint32_t ok = 0, crc_ruim = 0, trunc = 0, espurios = 0, boot_bytes = 0;

    void descarta(uint32_t n, bool em_boot) { if (em_boot) boot_bytes += n; else espurios += n; }

    // Entrega UM byte. 'agora' = millis(); 'em_boot' = ainda dentro dos primeiros 3 s do boot DESTA placa (lixo conta a parte).
    void feed(uint8_t b, uint32_t agora, bool em_boot, lf_on_frame_t cb) {
        if (st > 0 && (agora - t_ult) > LF_TMO_BYTE_MS) { trunc++; st = 0; }       // quadro parado no meio
        t_ult = agora;
        switch (st) {
            case 0: if (b == LF_SYNC1) st = 1; else descarta(1, em_boot); break;
            case 1:
                if (b == LF_SYNC2) { st = 2; crc = 0xFFFF; }
                else { descarta(1, em_boot); st = 0; if (b == LF_SYNC1) st = 1; else descarta(1, em_boot); }
                break;
            case 2: tipo = b; crc = lf_crc_upd(crc, b); st = 3; break;
            case 3: seq = b; crc = lf_crc_upd(crc, b); st = 4; break;
            case 4: seq |= (uint16_t)b << 8; crc = lf_crc_upd(crc, b); st = 5; break;
            case 5:
                if (b > LF_MAXP) { descarta(6, em_boot); st = 0; break; }          // tamanho impossivel: era lixo
                len = b; pos = 0; crc = lf_crc_upd(crc, b); st = b ? 6 : 7; break;
            case 6: pl[pos++] = b; crc = lf_crc_upd(crc, b); if (pos >= len) st = 7; break;
            case 7: crc_rx = b; st = 8; break;
            case 8:
                crc_rx |= (uint16_t)b << 8; st = 0;
                if (crc_rx == crc) { ok++; if (cb) cb(tipo, seq, pl, len); }
                else crc_ruim++;
                break;
        }
    }
};
