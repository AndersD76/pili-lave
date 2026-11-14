// =======================================================================
// diag_x10x12.h — REGISTRO DO AVANCO E DO RETORNO DO CARRINHO (X10 / X13 / X12) — 2026-11-12, pedido do Giovani
//
//   SO OBSERVA: nada aqui decide movimento. Serve para descobrir (a) por que o X10 "some" logo no comeco do avanco e o carrinho vai e ja volta, e
//   (b) por que, as vezes, o carrinho passa do X12 antes de parar (a confirmacao de 300 ms do X12 recomeca a cada leitura em 0).
//
//   SERIAL: uma linha por evento, "[DX] +<ms desde o inicio do movimento> ...". Ler a COM24 REINICIA a W1 ao fechar: so com a maquina parada.
//   NUVEM: SO anomalias, como ocorrencia tipo 7 (o servidor mostra "ocorrencia 7"; o valor v traz o subtipo nos 4 bits altos e 12 bits de dados):
//     v = (subtipo << 12) | dados          subtipo = v >> 12      dados = v & 4095
//     1  X10 apagou nos primeiros 3 s do avanco (regra G4)   dados = (inicio em passos de 100 ms << 7) | (duracao em passos de 20 ms)   duracao 127 = 2,54 s ou mais
//     2  retorno ao X12 com a confirmacao reiniciada ou parada tardia   dados = (reinicios << 8) | (ms desde a 1a vez que o X12 acendeu até parar / 10)
//     3  a regra de pausa por X10 disparou   dados = deslocamento acumulado (Y14) em ms
//     4  o X13 (fim de curso da frente) encerrou o avanco em carro real   dados = ms de deslocamento
//   Os relatorios ficam numa fila pequena e so saem com o carrinho PARADO (dx_enviar), porque gravar na memoria bloqueia o laco por alguns ms.
// =======================================================================
#pragma once

static uint32_t g_dx_t0 = 0;   // inicio do movimento atual (avanco ou retorno): as linhas da serial mostram o tempo desde aqui
static uint16_t g_dx_fila[4];
static uint8_t  g_dx_n = 0;

static inline void dx_zero() { g_dx_t0 = millis(); }
#define DX_LOG(fmt, ...) DBG_PRINTF("[DX] +%lums " fmt "\n", (unsigned long)(millis() - g_dx_t0), ##__VA_ARGS__)

// Poe um relatorio na fila para a nuvem. 'real' = false (modo SECO, bancada) nao reporta nada.
static void dx_nuvem(bool real, uint8_t sub, uint16_t dados12) {
    if (!real || g_dx_n >= 4) return;
    g_dx_fila[g_dx_n++] = (uint16_t)(((uint16_t)sub << 12) | (dados12 & 0x0FFF));
}
// Subtipo 1: X10 apagado nos primeiros 3 s do avanco. ini_ms = quando apagou (desde a partida), dur_ms = quanto tempo ficou apagado.
static void dx_drop(bool real, uint32_t ini_ms, uint32_t dur_ms) {
    uint32_t a = ini_ms / 100UL; if (a > 31) a = 31;
    uint32_t b = dur_ms / 20UL;  if (b > 127) b = 127;
    dx_nuvem(real, 1, (uint16_t)((a << 7) | b));
}
// Chamar SO com o carrinho parado.
static void dx_enviar() {
    for (uint8_t i = 0; i < g_dx_n; i++) ocr_diag(g_dx_fila[i]);
    g_dx_n = 0;
}
