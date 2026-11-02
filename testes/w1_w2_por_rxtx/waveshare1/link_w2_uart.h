// link_w2_uart.h — transporte W1 <-> W2 POR CABO (UART0), lado da W1. So e compilado com LINK_W1_W2_UART = 1.
// Incluido de DENTRO de controle.h, DEPOIS de g_iomux2 / g_viv2 / g_lat2 / g_hb2 / g_w2_do_real / w2_amostra_home() / w2_gap_atualiza() terem sido
// declarados: o receptor atualiza EXATAMENTE as mesmas variaveis que o callback do ESP-NOW atualizava (mesma secao critica), entao o resto do
// codigo (io2_get_di, modbus_refresh_io2_di, X16/X17 em 100 ms, [LINK], comm_perdida...) nao percebe a troca.
//
// RECEPCAO: roda no callback da UART (tarefa de eventos da UART), NAO no loop(). O loop da W1 chega a travar ~1,1 s no RS-485 e a captura de
// X16/X17 (>= 100 ms) nao pode depender dele — o mesmo motivo de o callback do ESP-NOW ter sido usado antes.
// TRANSMISSAO: do loop (ws2_envia_comando -> link_w2_cmd e o sinal de vida em link_w2_tick). O quadro e montado num buffer local e escrito de
// uma vez so, protegido por um mutex; nao ha espera por confirmacao.
#pragma once
#include "link_frame.h"
#include <HardwareSerial.h>

static HardwareSerial&   LINK = Serial0;              // UART0 (com CDCOnBoot=cdc o USB e o Serial e a UART0 esta livre)
static LfParser          g_lf;
static SemaphoreHandle_t g_lf_mux = nullptr;
static uint16_t          g_lf_seq_tx = 0;
static int32_t           g_lf_seq_rx = -1;
static uint32_t          g_lf_boot_ms = 0, g_lf_keep_ms = 0;
static volatile uint32_t g_lf_hb = 0, g_lf_evt = 0, g_lf_perdidos = 0, g_lf_dup = 0, g_lf_tx_cmd = 0, g_lf_tx_keep = 0;
static volatile uint32_t g_lf_u_brk = 0, g_lf_u_frm = 0, g_lf_u_par = 0, g_lf_u_fifo = 0, g_lf_u_buf = 0;
static volatile uint32_t g_lf_gap_max = 0, g_lf_ult_ms = 0;   // maior intervalo entre quadros validos (janela de 5 s)
static volatile uint8_t  g_w2_rst = 0;                // motivo do ultimo reset da W2 (esp_reset_reason), vindo no heartbeat
static volatile uint32_t g_w2_up_s = 0, g_w2_reinicios = 0;

static void lf_w1_on_frame(uint8_t tipo, uint16_t seq, const uint8_t* pl, uint8_t len) {
    uint32_t agora = millis();
    if (g_lf_seq_rx >= 0) {                           // diagnostico: quadros perdidos / repetidos pela contagem de seq da W2
        int16_t d = (int16_t)(seq - (uint16_t)(g_lf_seq_rx + 1));
        if (d > 0) g_lf_perdidos += d; else if (d < 0) g_lf_dup++;
    }
    g_lf_seq_rx = seq;
    if (g_lf_ult_ms) { uint32_t gp = agora - g_lf_ult_ms; if (gp > g_lf_gap_max) g_lf_gap_max = gp; }
    g_lf_ult_ms = agora;
    if (tipo == LT_EVT && len >= 2) {                 // = antigo MSG_EVENTO
        portENTER_CRITICAL(&g_iomux2);
        g_viv2 = pl[0]; g_lat2 |= (pl[1] & PULSO_W2_MASK); g_hb2 = agora; w2_amostra_home(pl[0], agora); w2_gap_atualiza(agora);
        portEXIT_CRITICAL(&g_iomux2);
        g_lf_evt++;
    } else if (tipo == LT_HB && len >= 2) {           // = antigo MSG_HEARTBEAT
        portENTER_CRITICAL(&g_iomux2);
        g_viv2 = pl[0]; g_hb2 = agora; g_w2_do_real = pl[1]; w2_amostra_home(pl[0], agora); w2_gap_atualiza(agora);
        portEXIT_CRITICAL(&g_iomux2);
        g_lf_hb++;
        if (len >= 7) {                               // diagnostico: motivo do reset e uptime da W2 (uptime que volta = a W2 reiniciou)
            uint32_t up = pl[3] | ((uint32_t)pl[4] << 8) | ((uint32_t)pl[5] << 16) | ((uint32_t)pl[6] << 24);
            if (g_w2_up_s > 5 && up + 2 < g_w2_up_s) {   // a W2 reiniciou: aviso para o registro de reinicios (reset_log_w1.h), como o antigo MSG_W2_BOOT
                g_w2_reinicios++;
                g_w2boot_rx.motivo = pl[2]; g_w2boot_rx.boot_id = (uint16_t)g_w2_reinicios; g_w2boot_rx.up_s = up; g_w2boot_novo = true;
            }
            g_w2_rst = pl[2]; g_w2_up_s = up;
        }
    } else if (tipo == LT_DIARIO && len >= 11) {      // = MSG_W2_DIARIO: bordas de X14/X15 enquanto so a W1 estava fora
        g_w2d_rx.boot_id = (uint16_t)(pl[0] | ((uint16_t)pl[1] << 8)); g_w2d_rx.nivel = pl[2];
        g_w2d_rx.x14_bordas = (uint16_t)(pl[3] | ((uint16_t)pl[4] << 8)); g_w2d_rx.x15_bordas = (uint16_t)(pl[5] | ((uint16_t)pl[6] << 8));
        g_w2d_rx.up_s = pl[7] | ((uint32_t)pl[8] << 8) | ((uint32_t)pl[9] << 16) | ((uint32_t)pl[10] << 24); g_w2d_novo = true;
    }
}
static void lf_w1_rx_cb() {
    while (LINK.available()) g_lf.feed((uint8_t)LINK.read(), millis(), (millis() - g_lf_boot_ms) < 3000UL, lf_w1_on_frame);
}
static void lf_w1_err_cb(hardwareSerial_error_t e) {
    switch (e) {
        case UART_BREAK_ERROR:       g_lf_u_brk++;  break;
        case UART_FRAME_ERROR:       g_lf_u_frm++;  break;
        case UART_PARITY_ERROR:      g_lf_u_par++;  break;
        case UART_FIFO_OVF_ERROR:    g_lf_u_fifo++; break;
        case UART_BUFFER_FULL_ERROR: g_lf_u_buf++;  break;
        default: break;
    }
}

static void link_w2_init() {                          // chamar uma vez, em controle_init(), ANTES de comm_hard_reset_saidas()
    g_lf_mux = xSemaphoreCreateMutex();
    g_lf_boot_ms = millis();
    LINK.setRxBufferSize(512);
    LINK.setTxBufferSize(256);
    LINK.onReceiveError(lf_w1_err_cb);
    LINK.onReceive(lf_w1_rx_cb);
    LINK.begin(LINK_UART_BAUD, SERIAL_8N1, LINK_UART_RX_PIN, LINK_UART_TX_PIN);
    DBG_PRINTF("[W2LINK] link W1<->W2 por CABO: UART0 %lu 8N1 TXD=GPIO%d RXD=GPIO%d (sem Wi-Fi/ESP-NOW para a W2)\n",
               (unsigned long)LINK_UART_BAUD, LINK_UART_TX_PIN, LINK_UART_RX_PIN);
}
static void link_w2_enviar(uint8_t tipo, const uint8_t* pl, uint8_t len) {
    uint8_t b[8 + LF_MAXP];
    if (g_lf_mux && xSemaphoreTake(g_lf_mux, pdMS_TO_TICKS(5)) != pdTRUE) return;   // nunca espera mais que 5 ms
    size_t n = lf_build(b, tipo, g_lf_seq_tx++, pl, len);
    LINK.write(b, n);
    if (g_lf_mux) xSemaphoreGive(g_lf_mux);
}
static void link_w2_cmd(uint8_t canal, uint8_t estado) {   // = antigo MsgComando (substitui o esp_now_send para a W2)
    uint8_t pl[2] = { canal, (uint8_t)(estado ? 1 : 0) };
    link_w2_enviar(LT_CMD, pl, 2);
    g_lf_tx_cmd++;
}
static void link_w2_tick() {                          // chamar a cada volta do loop(): sinal de vida a cada LINK_KEEP_MS
    uint32_t agora = millis();
    if (agora - g_lf_keep_ms >= LINK_KEEP_MS) { g_lf_keep_ms = agora; link_w2_enviar(LT_KEEP, nullptr, 0); g_lf_tx_keep++; }
}
static void link_w2_relatorio() {                     // junto do [LINK] de 5 s
    uint32_t u = g_lf_u_brk + g_lf_u_frm + g_lf_u_par + g_lf_u_fifo + g_lf_u_buf;
    DBG_PRINTF("[W2LINK] ok=%lu (hb=%lu evt=%lu) crc_ruim=%lu trunc=%lu perdidos=%lu dup=%lu | espurios=%lu boot=%lu uart_err=%lu (brk%lu frm%lu par%lu fifo%lu buf%lu) | gap_max=%lums | tx cmd=%lu keep=%lu | W2: ultimo reset=%u up=%lus reinicios=%lu\n",
               (unsigned long)g_lf.ok, (unsigned long)g_lf_hb, (unsigned long)g_lf_evt, (unsigned long)g_lf.crc_ruim, (unsigned long)g_lf.trunc,
               (unsigned long)g_lf_perdidos, (unsigned long)g_lf_dup, (unsigned long)g_lf.espurios, (unsigned long)g_lf.boot_bytes, (unsigned long)u,
               (unsigned long)g_lf_u_brk, (unsigned long)g_lf_u_frm, (unsigned long)g_lf_u_par, (unsigned long)g_lf_u_fifo, (unsigned long)g_lf_u_buf,
               (unsigned long)g_lf_gap_max, (unsigned long)g_lf_tx_cmd, (unsigned long)g_lf_tx_keep,
               (unsigned)g_w2_rst, (unsigned long)g_w2_up_s, (unsigned long)g_w2_reinicios);
    g_lf_gap_max = 0;
}
