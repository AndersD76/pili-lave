#pragma once
#include "tipos.h"
#include "vfd_rs485.h"   // reaproveita o barramento RS-485 ja existente (mb_write_reg/mb_read_regs/mutex)

// =======================================================================
// saj_rs485.h — Inversor SAJ VM1000B (bomba de alta pressao), endereco 4,
// no MESMO barramento RS-485 do Delta (addr 3) e das Waveshares (addr 1/2).
//
// A PARTIDA (Forward/Stop) do SAJ e feita por fiacao fisica nos terminais
// AI1/DI1 dele — o firmware NAO manda comando de Run/Stop por Modbus. Só
// ajusta a FREQUENCIA (registrador 0x1000) no momento em que cada processo
// liga a bomba (Y13) ou o secador (Y5), pra cada um rodar na velocidade
// certa. Fora desses momentos, o SAJ continua na ultima frequencia que foi
// mandada — nao ha "reset" de frequencia entre processos.
//
// Frequencia (registrador 0x1000) e uma ESCALA, nao Hz direto:
// -10000..10000 representando -100%..100% de F0.10 (frequencia maxima
// configurada no painel do SAJ, hoje 55.00Hz):
//   valor_registrador = (frequencia_hz / SAJ_FREQ_MAX_HZ) * 10000
// NUNCA escrever no endereco "F" (EEPROM) pra controle em tempo real — só
// o 0x1000 (RAM), senão desgasta a EEPROM (~1 milhao de gravacoes de vida).
// =======================================================================

float    g_saj_freq     = 0;   // ultima freq enviada (Hz) — so diagnostico
uint16_t g_saj_mov_freq = 0;   // em 0.1Hz, so diagnostico

static void saj_write_reg_retry(uint16_t reg, uint16_t val) {
    for (uint8_t i = 0; i < 4; i++) {
        if (mb_write_reg(MB_ADDR_SAJ, reg, val)) return;
        delay(15);
    }
}

static inline int16_t saj_freq_para_registrador(float freq_hz) {
    return (int16_t)((freq_hz / SAJ_FREQ_MAX_HZ) * 10000.0f);
}

// Escreve a frequencia (Hz) no registrador 0x1000 (RAM, tempo real).
// Chamar no inicio de cada processo que usa a bomba/secador, com o valor
// certo daquele processo — a partida em si ja acontece por fiacao fisica.
void saj_set_freq(float freq_hz) {
    g_saj_freq     = freq_hz;
    g_saj_mov_freq = (uint16_t)(freq_hz * 10);
    saj_write_reg_retry(SAJ_REG_FREQ, (uint16_t)saj_freq_para_registrador(freq_hz));
}
