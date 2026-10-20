#pragma once
#include "vfd_rs485_w1.h"   // reaproveita o barramento RS-485 ja existente (mb_write_reg/mb_read_regs/mutex)

// =======================================================================
// saj_rs485_w1.h — Inversor SAJ VM1000B (bomba de alta pressao), endereco 4,
// no MESMO barramento RS-485 do Delta (addr 3) — agora mestre pela Waveshare 1.
// Sem mudanca de logica em relacao ao saj_rs485.h original do display.
// =======================================================================

#define MB_ADDR_SAJ      4
#define SAJ_REG_FREQ     0x1000
#define SAJ_REG_FREQ_OUT 0x1001
#define SAJ_FREQ_MAX_HZ  55.0f

float    g_saj_freq     = 0;
uint16_t g_saj_mov_freq = 0;

static void saj_write_reg_retry(uint16_t reg, uint16_t val) {
    for (uint8_t i = 0; i < 4; i++) {
        if (mb_write_reg(MB_ADDR_SAJ, reg, val)) return;
        delay(15);
    }
}

static inline int16_t saj_freq_para_registrador(float freq_hz) {
    return (int16_t)((freq_hz / SAJ_FREQ_MAX_HZ) * 10000.0f);
}

void saj_set_freq(float freq_hz) {
    g_saj_freq     = freq_hz;
    g_saj_mov_freq = (uint16_t)(freq_hz * 10);
    saj_write_reg_retry(SAJ_REG_FREQ, (uint16_t)saj_freq_para_registrador(freq_hz));
}

bool saj_lendo_parado() {
    for (uint8_t i = 0; i < 3; i++) {
        uint16_t s[1];
        if (mb_read_regs(MB_ADDR_SAJ, SAJ_REG_FREQ_OUT, 1, s)) {
            return s[0] < 20;
        }
        delay(10);
    }
    return false;
}
