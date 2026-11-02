// =======================================================================
// reset_log_w1.h — REGISTRO PERMANENTE DOS REINICIOS (2026-11-02, pedido do Giovani)
//
//   Objetivo: saber QUANTAS vezes a W1 (e a W2) reiniciam, POR QUE e EM QUE ESTADO a maquina estava (parada? no meio da lavagem?), sem perder
//   o historico: fica na NVS e, a cada reconexao com a internet, vai para a nuvem (evento tipo 4 -> display -> camera -> /api/machine/reset-log).
//
//   COMO SABE O ESTADO ANTES DO RESET: um "retrato" na memoria RTC (RTC_NOINIT) e atualizado a cada volta do loop (estado, flags, tempo ligada).
//   A RTC sobrevive a reset de software, watchdog, panico e queda de tensao; NAO sobrevive a corte total de energia (ai o estado fica
//   "desconhecido" e o motivo e POWERON = a maquina foi desenergizada/religada, p.ex. botao de emergencia).
//
//   NVS "rst" (blob "log"): contadores por motivo + os ultimos RST_N reinicios (W1 e W2) + flags de envio. Uma gravacao por boot e uma por ACK.
//   ENVIO: um evento por vez (nunca mais que 1 evento tipo 4 na fila da W1, e so com a fila folgada), do mais antigo ao mais novo; nunca
//   expulsa evento de lavagem. Em laco de reinicio (boot < 15 s) nada e enviado: so conta.
//   Eventos tipo 4: res = "W1-<seq>" / "W2-<seq>" (chave unica, volta no ACK), errcode = "W1;m=6;e=5;u=1234;n=12;c=1;s=0":
//     m = esp_reset_reason (1 POWERON 3 SW 4 PANIC 5 INT_WDT 6 TASK_WDT 7 WDT 9 BROWNOUT 11 USB) | e = estado da W1 antes (255 = desconhecido)
//     u = segundos ligada antes do reset | n = total de reinicios daquela placa | c = 1 se estava em ciclo (carro presente) | s = restart
//     t = HORA do reset (epoch, UTC), so quando a W1 ja tinha o relogio: a camera pega a hora na internet (NTP) e manda MSG_HORA; o reinicio e
//     carimbado de tras para frente (hora atual - tempo ligada). Sem relogio: o campo t some e o backend so registra (nao mexe em reserva).
//     DELIBERADO nosso (1 memoria critica, 2 radio travado) ou 0.
// =======================================================================
#pragma once

#define RST_MAGIC        0x52535431UL
#define RST_N            8
#define RST_SW_MEM       1
#define RST_SW_TX        2
#define RST_SW_HARD_BOOT 9      // o "hard reset" unico do 1o boot depois de energizar (hard_reset_fase1): nao e falha
#define RST_ESTADO_DESC  255
#define RST_F_CICLO      1
#define RST_F_EST_OK     2
#define RST_F_NAOENV     4
#define RST_F_ENVIADO    8
#define RST_F_FILA       16
#define RST_F_SEMHORA    32     // criado sem relogio: carimba assim que a hora chegar (so se for do boot atual)

RTC_NOINIT_ATTR static uint32_t g_rtc_magic;
RTC_NOINIT_ATTR static uint8_t  g_rtc_estado;
RTC_NOINIT_ATTR static uint8_t  g_rtc_flags;
RTC_NOINIT_ATTR static uint32_t g_rtc_up_s;
RTC_NOINIT_ATTR static uint8_t  g_rtc_sw;
RTC_NOINIT_ATTR static uint8_t  g_rtc_orig;

typedef struct { uint32_t seq; uint32_t up_s; uint32_t t; uint16_t n; uint8_t quem, motivo, estado, flags, sw, pad; } RstRec;
typedef struct { uint32_t magic, seq; uint16_t tot[3]; uint16_t por_motivo[16]; uint8_t pos, n; RstRec rec[RST_N]; } RstLog;
static RstLog g_rst_log;
static uint32_t g_rst_rel[RST_N];          // so RAM: segundos de uptime da W1 no instante do reset (0 = o proprio boot da W1) - base do carimbo de hora
static uint32_t g_rst_seq_ini = 0;         // 1o seq deste boot (so registros deste boot podem ser carimbados)
static uint32_t rst_epoch_agora() { return g_hora_tem ? g_hora_epoch + (millis() - g_hora_ms) / 1000UL : 0; }   // 0 = sem relogio
static struct { bool tem; uint8_t motivo, estado, flags, sw; uint32_t up_s; } g_rst_boot = {};

static const char* rst_nome(uint8_t m) {
    switch (m) {
        case 1: return "POWERON";   case 2: return "EXT";       case 3: return "SW";        case 4: return "PANIC";
        case 5: return "INT_WDT";   case 6: return "TASK_WDT";  case 7: return "WDT";       case 8: return "DEEPSLEEP";
        case 9: return "BROWNOUT";  case 10: return "SDIO";     case 11: return "USB";      case 12: return "JTAG";
        default: return "?";
    }
}
static bool rst_estado_em_ciclo(uint8_t e) { return e == AUTO_CARRO_ENTRANDO || e == AUTO_AGUARDA_POS || e == AUTO_INICIANDO || e == AUTO_PROCESSO || e == AUTO_PAUSADO; }

// ---- marcas de restart DELIBERADO (chamadas logo antes de ESP.restart / esp_restart) ----
void rst_sw_motivo(uint8_t m) { g_rtc_sw = m; }
void rst_hard_boot_marca(uint8_t motivo_original) { g_rtc_sw = RST_SW_HARD_BOOT; g_rtc_orig = motivo_original; }

// Primeira coisa do setup (ANTES do hard_reset_fase1): le o retrato da RTC e decide o que esse boot significa.
void rst_rtc_iniciar() {
    esp_reset_reason_t r = esp_reset_reason();
    bool valido = (g_rtc_magic == RST_MAGIC) && r != ESP_RST_POWERON;
    uint8_t motivo = (uint8_t)r, estado = RST_ESTADO_DESC, sw = 0; uint32_t up = 0;
    if (valido) { estado = g_rtc_estado; up = g_rtc_up_s; sw = g_rtc_sw; }
    if (valido && sw == RST_SW_HARD_BOOT) { motivo = g_rtc_orig; estado = RST_ESTADO_DESC; up = 0; sw = 0; }   // 2o boot do hard reset: vale o motivo do 1o
    g_rst_boot.tem = true; g_rst_boot.motivo = motivo; g_rst_boot.estado = estado; g_rst_boot.up_s = up; g_rst_boot.sw = sw;
    g_rst_boot.flags = (estado != RST_ESTADO_DESC ? RST_F_EST_OK : 0) | (rst_estado_em_ciclo(estado) ? RST_F_CICLO : 0)
                     | ((motivo == 2 || motivo == 11 || motivo == 12) ? RST_F_NAOENV : 0);   // reset por botao EN / USB / JTAG = tecnico, nao vai para a nuvem
    g_rtc_magic = RST_MAGIC; g_rtc_sw = 0; g_rtc_estado = RST_ESTADO_DESC; g_rtc_flags = 0; g_rtc_up_s = 0;
}

static void rst_salvar() { Preferences p; if (p.begin("rst", false)) { p.putBytes("log", &g_rst_log, sizeof(g_rst_log)); p.end(); } }
static void rst_carregar() {
    memset(&g_rst_log, 0, sizeof(g_rst_log));
    Preferences p; if (p.begin("rst", true)) {
        if (p.getBytesLength("log") == sizeof(g_rst_log)) p.getBytes("log", &g_rst_log, sizeof(g_rst_log));
        p.end();
    }
    if (g_rst_log.magic != RST_MAGIC) { memset(&g_rst_log, 0, sizeof(g_rst_log)); g_rst_log.magic = RST_MAGIC; }
}
static void rst_carimbar() {   // da hora aos registros deste boot que nasceram sem relogio
    uint32_t ep = rst_epoch_agora(); if (!ep) return;
    uint32_t now_s = millis() / 1000UL; bool mudou = false;
    for (uint8_t i = 0; i < RST_N; i++) {
        RstRec& r = g_rst_log.rec[i];
        if (!(r.flags & RST_F_SEMHORA) || r.seq < g_rst_seq_ini) continue;
        uint32_t atras = now_s > g_rst_rel[i] ? now_s - g_rst_rel[i] : 0;
        r.t = ep > atras ? ep - atras : ep; r.flags &= ~RST_F_SEMHORA; mudou = true;
        DBG_PRINTF("[RST] %s #%lu carimbado: ha %lus (epoch %lu)\n", r.quem == 1 ? "W1" : "W2", (unsigned long)r.seq, (unsigned long)atras, (unsigned long)r.t);
    }
    if (mudou) rst_salvar();
}
static void rst_adicionar(uint8_t quem, uint8_t motivo, uint8_t estado, uint8_t flags, uint8_t sw, uint32_t up_s, uint32_t rel_s) {
    RstRec r = {}; r.seq = ++g_rst_log.seq; r.quem = quem; r.motivo = motivo; r.estado = estado; r.flags = flags | RST_F_SEMHORA; r.sw = sw; r.up_s = up_s;
    g_rst_rel[g_rst_log.pos] = rel_s;
    if (quem >= 1 && quem <= 2) { g_rst_log.tot[quem]++; r.n = g_rst_log.tot[quem]; }
    if (motivo < 16) g_rst_log.por_motivo[motivo]++;
    g_rst_log.rec[g_rst_log.pos] = r; g_rst_log.pos = (g_rst_log.pos + 1) % RST_N; if (g_rst_log.n < RST_N) g_rst_log.n++;
    DBG_PRINTF("[RST] %s reiniciou: motivo=%u(%s) estado_antes=%u%s uptime_antes=%lus%s%s (total %s=%u)\n", quem == 1 ? "W1" : "W2", (unsigned)motivo, rst_nome(motivo),
               (unsigned)estado, estado == RST_ESTADO_DESC ? "(desconhecido)" : "", (unsigned long)up_s, (flags & RST_F_CICLO) ? " EM CICLO" : "",
               sw ? " [deliberado]" : "", quem == 1 ? "W1" : "W2", (unsigned)r.n);
}
static void rst_reconciliar_fila() {   // registro marcado "na fila" mas o evento nao esta mais na fila da W1 (perdeu): volta a ser enviavel
    for (uint8_t i = 0; i < RST_N; i++) {
        RstRec& r = g_rst_log.rec[i];
        if (!(r.flags & RST_F_FILA) || (r.flags & RST_F_ENVIADO)) continue;
        char res[16]; snprintf(res, sizeof(res), "W%u-%lu", (unsigned)r.quem, (unsigned long)r.seq);
        bool achou = false;
        for (uint8_t k = 0; k < g_evq_n; k++) if (g_evq[k].tipo == 4 && strcmp(g_evq[k].res, res) == 0) achou = true;
        if (!achou) r.flags &= ~RST_F_FILA;
    }
}

// Depois de nuvem_carregar() (precisa da fila de eventos carregada): registra ESTE boot e imprime o historico.
void rst_boot_registrar() {
    rst_carregar();
    rst_reconciliar_fila();
    g_rst_seq_ini = g_rst_log.seq + 1;
    if (g_rst_boot.tem) {
        rst_adicionar(1, g_rst_boot.motivo, g_rst_boot.estado, g_rst_boot.flags, g_rst_boot.sw, g_rst_boot.up_s, 0);
        rst_salvar();
        g_rst_boot.tem = false;
    }
    DBG_PRINTF("[RST] totais: W1=%u W2=%u | por motivo:", (unsigned)g_rst_log.tot[1], (unsigned)g_rst_log.tot[2]);
    for (uint8_t m = 0; m < 16; m++) if (g_rst_log.por_motivo[m]) DBG_PRINTF(" %s=%u", rst_nome(m), (unsigned)g_rst_log.por_motivo[m]);
    DBG_PRINTLN("");
}

// ---- W2 reiniciou (a W2 manda MSG_W2_BOOT por ~20 s depois de cada boot) ----
static uint16_t g_w2_boot_visto = 0; static bool g_w2_boot_tem = false;
static void rst_w2_processar() {
    if (!g_w2boot_novo) return;
    MsgW2Boot b; memcpy(&b, (const void*)&g_w2boot_rx, sizeof(b)); g_w2boot_novo = false;
    if (g_w2_boot_tem && g_w2_boot_visto == b.boot_id) return;      // repeticao da mesma mensagem
    g_w2_boot_tem = true; g_w2_boot_visto = b.boot_id;
    uint8_t est = (uint8_t)g_estado_auto;                           // o que a W1 (que continua viva) estava fazendo quando a W2 voltou
    uint8_t fl = RST_F_EST_OK | (rst_estado_em_ciclo(est) ? RST_F_CICLO : 0) | ((b.motivo == 2 || b.motivo == 11 || b.motivo == 12) ? RST_F_NAOENV : 0);
    uint32_t now_s = millis() / 1000UL;
    rst_adicionar(2, b.motivo, est, fl, 0, b.up_s, now_s > b.up_s ? now_s - b.up_s : 0);
    rst_salvar();
    rst_carimbar();
}

void rst_evento_confirmado(const char* res) {                       // ACK do display para o evento tipo 4 da cabeca da fila
    if (!res || res[0] != 'W') return;
    uint8_t quem = (uint8_t)(res[1] - '0'); uint32_t seq = (uint32_t)atol(res + 3);
    for (uint8_t i = 0; i < RST_N; i++) {
        RstRec& r = g_rst_log.rec[i];
        if (r.quem == quem && r.seq == seq) { r.flags |= RST_F_ENVIADO; r.flags &= ~RST_F_FILA; rst_salvar(); return; }
    }
}

static void rst_enviar_tick(uint32_t agora) {
    static uint32_t t = 0;
    if (agora - t < 2000) return; t = agora;
    if (agora < 15000) return;                                      // boot recente (possivel laco de reinicio): so conta, nao envia
    if (g_evq_n > EVQ_MAX / 2) return;                              // fila de lavagem apertada: eventos de lavagem tem prioridade
    for (uint8_t k = 0; k < g_evq_n; k++) if (g_evq[k].tipo == 4) return;   // um por vez
    int8_t melhor = -1;
    for (uint8_t i = 0; i < RST_N; i++) {
        const RstRec& r = g_rst_log.rec[i];
        if (!r.seq || (r.flags & (RST_F_ENVIADO | RST_F_NAOENV | RST_F_FILA))) continue;
        if ((r.flags & RST_F_SEMHORA) && r.seq >= g_rst_seq_ini && agora < 120000UL) continue;   // espera o relogio chegar (ate 2 min de boot)
        if (melhor < 0 || r.seq < g_rst_log.rec[melhor].seq) melhor = i;
    }
    if (melhor < 0) return;
    RstRec& r = g_rst_log.rec[melhor];
    EvtRec e = {}; e.tipo = 4;
    snprintf(e.res, sizeof(e.res), "W%u-%lu", (unsigned)r.quem, (unsigned long)r.seq);
    int k = snprintf(e.err, sizeof(e.err), "W%u;m=%u;e=%u;u=%lu;n=%u;c=%u;s=%u", (unsigned)r.quem, (unsigned)r.motivo, (unsigned)r.estado, (unsigned long)r.up_s,
                     (unsigned)r.n, (r.flags & RST_F_CICLO) ? 1u : 0u, (unsigned)r.sw);
    if (r.t && k > 0 && k < (int)sizeof(e.err) - 14) snprintf(e.err + k, sizeof(e.err) - k, ";t=%lu", (unsigned long)r.t);   // hora do reset (so com relogio)
    evq_push(e);
    r.flags |= RST_F_FILA; rst_salvar();
    DBG_PRINTF("[RST] evento %s enfileirado para a nuvem\n", e.res);
}

// Chamado a cada volta do loop: retrato RTC (estado antes do proximo reset), W2 e envio.
void rst_tick() {
    g_rtc_estado = (uint8_t)g_estado_auto;
    g_rtc_flags = (home_rodando() ? 1 : 0) | (recuperacao_ativa() ? 2 : 0);
    uint32_t agora = millis(), s = agora / 1000UL; if (s != g_rtc_up_s) g_rtc_up_s = s;
    rst_w2_processar();
    { static uint32_t t_c = 0; if (agora - t_c >= 5000) { t_c = agora; rst_carimbar(); } }
    rst_enviar_tick(agora);
}
