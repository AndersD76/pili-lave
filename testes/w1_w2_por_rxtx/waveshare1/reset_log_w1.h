// =======================================================================
// reset_log_w1.h — REGISTRO PERMANENTE DOS REINICIOS + FASE 0 DA RETOMADA (2026-11-02, pedido do Giovani)
//
//   NADA AQUI MUDA UMA DECISAO DE MOVIMENTO: so LE o estado da maquina e GRAVA/ENVIA. (Regras da retomada: docs/REGRAS_RETOMADA_CICLO.md.)
//
//   1) REINICIOS (W1 e W2): quantas vezes, por que, em que estado a maquina estava. Retrato na memoria RTC (sobrevive a reset de software,
//      watchdog, panico e queda de tensao) atualizado a cada volta do loop; NAO sobrevive a corte total de energia (ai o motivo e POWERON).
//   2) RETRATO DA ETAPA (Fase 0): processo, sub-estado, indice da etapa, giro (n, sentido, destino), modelo, entradas/saidas das duas placas e
//      frequencia. Alem da RTC, um CHECKPOINT na NVS ("et") a cada troca de etapa/giro (no maximo 1 por 1,5 s) para sobreviver a corte de
//      energia: depois dele, a nuvem sabe EM QUE ETAPA a lavagem estava.
//   3) OCORRENCIAS (Fase 0, so observa): contradicoes entre sensores que as regras da retomada vao tratar (O1..O5, ver ocr_tick). Cada uma
//      grava um retrato e sobe para a nuvem para analisarmos ("autoaprendizagem": nos analisamos e criamos a regra).
//   4) DIARIO DO X14/X15 (W2): a W2 conta as bordas de X14/X15 (MSG_W2_DIARIO a cada 5 s). Se a W1 reinicia e a W2 NAO, a diferenca de bordas
//      mostra se um carro saiu/entrou enquanto a W1 estava fora (a/b no retrato; 255 = a W2 tambem reiniciou).
//
//   NVS "rst": blob "log" (contadores + ultimos RST_N reinicios + ultimas OCR_N ocorrencias + flags de envio) e blob "et" (checkpoint).
//   ENVIO (tipo 4, um por vez, so com a fila folgada, nunca em boot < 15 s, nunca expulsa evento de lavagem), do mais antigo ao mais novo:
//     reinicio   res "W1-<seq>"/"W2-<seq>" err "W1;m=6;e=5;u=1234;n=12;c=1;s=0[;k=1][;t=<epoch>]"
//     ocorrencia res "W3-<seq>"            err "O;o=1;e=5;n=3;v=1200[;t=<epoch>]"
//     retrato    res "J1-<seq>"/"J3-<seq>" err "J;p=7;q=12;i=3;g=2;d=1;m=4;x=a5f0;y=03c0;h=150;a=1;b=0"   (depois do principal, so se tem retrato)
//   m = esp_reset_reason | e = estado da W1 antes (255 = desconhecido) | u = s ligada antes | n = total da placa / da ocorrencia | c = em ciclo |
//   s = restart deliberado (1 memoria, 2 radio) | k = ciclo em andamento SEGUNDO o checkpoint da NVS (queda de energia) | t = hora (epoch UTC).
//   Retrato: p processo | q sub-estado | i indice da etapa | g giro triplo (0 = nenhum, 1..3) | d giro: 0 A->pos2, 1 A->pos1, 2 B->pos2, 3 B->pos1, 4 sem giro
//   m modelo | x entradas (bit0-7 = X0..X7 da W1, bit8-15 = X10..X17 da W2) | y saidas (idem) | h frequencia x10 Hz | a/b = bordas de X14/X15 durante a queda.
// =======================================================================
#pragma once

#define RST_MAGIC        0x52535433UL
#define RST_N            8
#define OCR_N            8
#define RST_SW_MEM       1
#define RST_SW_TX        2
#define RST_SW_HARD_BOOT 9      // o "hard reset" unico do 1o boot depois de energizar (hard_reset_fase1): nao e falha
#define RST_ESTADO_DESC  255
#define RST_F_CICLO      1      // estava em ciclo (carro presente) SEGUNDO o retrato da RTC
#define RST_F_EST_OK     2
#define RST_F_NAOENV     4
#define RST_F_ENVIADO    8
#define RST_F_FILA       16
#define RST_F_SEMHORA    32     // criado sem relogio: carimba assim que a hora chegar (so se for do boot atual)
#define RST_F_SEMW2      64     // aguardando o 1o diario da W2 para calcular as bordas de X14/X15 durante a queda
#define RST_F_NVS        128    // o retrato veio do checkpoint da NVS (corte de energia), nao da RTC
#define RST_F_SNAP       256    // tem retrato da etapa
#define RST_F_SNAPENV    512    // retrato enviado
#define RST_F_FILAJ      1024   // retrato na fila de eventos
#define RST_F_CICLO_NVS  2048   // ciclo em andamento segundo o checkpoint da NVS

typedef struct { uint8_t em_ciclo, proc, sub, slot, giro, dir, dest, modelo; uint16_t di, doo, hz10; } RstEtapa;   // dir: 0 A, 1 B, 2 nenhum | dest: 0 pos2, 1 pos1, 2 nenhum
typedef struct { uint16_t boot_id, x14, x15; uint8_t valido, pad; } RstW2Vis;
typedef struct { uint32_t seq, up_s, t, rel_s; uint16_t n, flags, v; uint8_t quem, motivo, estado, sw, dx14, dx15; RstEtapa et; } RstRec;   // quem: 1 W1, 2 W2, 3 ocorrencia
typedef struct { uint32_t magic, seq; uint16_t tot[4]; uint16_t por_motivo[16]; uint16_t por_ocr[8]; uint8_t pos[2], n[2]; RstRec rec[RST_N]; RstRec ocr[OCR_N]; } RstLog;

RTC_NOINIT_ATTR static uint32_t  g_rtc_magic;
RTC_NOINIT_ATTR static uint8_t   g_rtc_estado;
RTC_NOINIT_ATTR static uint8_t   g_rtc_flags;
RTC_NOINIT_ATTR static uint32_t  g_rtc_up_s;
RTC_NOINIT_ATTR static uint8_t   g_rtc_sw;
RTC_NOINIT_ATTR static uint8_t   g_rtc_orig;
RTC_NOINIT_ATTR static RstEtapa  g_rtc_et;
RTC_NOINIT_ATTR static RstW2Vis  g_rtc_w2;

static RstLog g_rst_log;
static uint32_t g_rst_seq_ini = 0;         // 1o seq deste boot (so registros deste boot podem ser carimbados / receber o diario da W2)
static RstW2Vis g_w2prev = {};             // ultimo diario da W2 visto ANTES do reset (RTC)
static struct { bool tem; uint8_t motivo, estado, sw; uint16_t flags; uint32_t up_s; RstEtapa et; bool snap; } g_rst_boot = {};
static uint32_t rst_epoch_agora() { return g_hora_tem ? g_hora_epoch + (millis() - g_hora_ms) / 1000UL : 0; }   // 0 = sem relogio

static const char* rst_nome(uint8_t m) {
    switch (m) {
        case 1: return "POWERON";   case 2: return "EXT";       case 3: return "SW";        case 4: return "PANIC";
        case 5: return "INT_WDT";   case 6: return "TASK_WDT";  case 7: return "WDT";       case 8: return "DEEPSLEEP";
        case 9: return "BROWNOUT";  case 10: return "SDIO";     case 11: return "USB";      case 12: return "JTAG";
        default: return "?";
    }
}
static bool rst_estado_em_ciclo(uint8_t e) { return e == AUTO_CARRO_ENTRANDO || e == AUTO_AGUARDA_POS || e == AUTO_INICIANDO || e == AUTO_PROCESSO || e == AUTO_PAUSADO; }

// ---- retrato da etapa (so le) ----
static void rst_capturar(RstEtapa& r) {
    r.em_ciclo = rst_estado_em_ciclo((uint8_t)g_estado_auto) ? 1 : 0;
    r.proc = (uint8_t)g_estado.processo_ativo; r.sub = _pst; r.slot = g_processo_atual_idx; r.modelo = g_estado.programa_sel;
    r.giro = (g_estado.processo_ativo == PROC_ALTA_PRESSAO) ? (uint8_t)(_ap_giro_n + 1) : 0;
    if (g_giro_ativo) { r.dir = _giro_fwd ? 1 : 0; r.dest = _giro_dest_home ? 1 : 0; } else { r.dir = 2; r.dest = 2; }
    r.di  = (uint16_t)g_io1.di  | ((uint16_t)g_io2.di  << 8);
    r.doo = (uint16_t)g_io1.do_ | ((uint16_t)g_io2.do_ << 8);
    float hz = g_vfd_freq * 10.0f; r.hz10 = hz < 0 ? 0 : (hz > 65000.0f ? 65000 : (uint16_t)hz);
}
static uint8_t rst_dcode(const RstEtapa& e) { return e.dir == 2 ? 4 : (e.dir == 0 ? (e.dest == 0 ? 0 : 1) : (e.dest == 0 ? 2 : 3)); }
static void rst_et_salvar(const RstEtapa& e) { Preferences p; if (p.begin("rst", false)) { p.putBytes("et", &e, sizeof(e)); p.end(); } }
static bool rst_et_carregar(RstEtapa& e) {
    memset(&e, 0, sizeof(e)); bool ok = false;
    Preferences p; if (p.begin("rst", true)) { if (p.getBytesLength("et") == sizeof(e)) { p.getBytes("et", &e, sizeof(e)); ok = true; } p.end(); }
    return ok;
}

// ---- marcas de restart DELIBERADO (chamadas logo antes de ESP.restart / esp_restart) ----
void rst_sw_motivo(uint8_t m) { g_rtc_sw = m; }
void rst_hard_boot_marca(uint8_t motivo_original) { g_rtc_sw = RST_SW_HARD_BOOT; g_rtc_orig = motivo_original; }

// Primeira coisa do setup (ANTES do hard_reset_fase1): le o retrato da RTC e decide o que esse boot significa.
void rst_rtc_iniciar() {
    esp_reset_reason_t r = esp_reset_reason();
    bool valido = (g_rtc_magic == RST_MAGIC) && r != ESP_RST_POWERON;
    uint8_t motivo = (uint8_t)r, estado = RST_ESTADO_DESC, sw = 0; uint32_t up = 0;
    RstEtapa et; memset(&et, 0, sizeof(et)); bool et_nvs = false;
    memset(&g_w2prev, 0, sizeof(g_w2prev));
    if (valido) { estado = g_rtc_estado; up = g_rtc_up_s; sw = g_rtc_sw; et = g_rtc_et; g_w2prev = g_rtc_w2; }
    if (valido && sw == RST_SW_HARD_BOOT) { motivo = g_rtc_orig; estado = RST_ESTADO_DESC; up = 0; sw = 0; valido = false; }   // 2o boot do hard reset: vale o motivo do 1o
    if (!valido) { rst_et_carregar(et); et_nvs = true; memset(&g_w2prev, 0, sizeof(g_w2prev)); }                                 // sem RTC: usa o checkpoint da NVS
    g_rst_boot.tem = true; g_rst_boot.motivo = motivo; g_rst_boot.estado = estado; g_rst_boot.up_s = up; g_rst_boot.sw = sw; g_rst_boot.et = et;
    g_rst_boot.snap = et.em_ciclo != 0;
    g_rst_boot.flags = (estado != RST_ESTADO_DESC ? RST_F_EST_OK : 0) | (rst_estado_em_ciclo(estado) ? RST_F_CICLO : 0)
                     | ((motivo == 2 || motivo == 11 || motivo == 12) ? RST_F_NAOENV : 0)   // reset por botao EN / USB / JTAG = tecnico, nao vai para a nuvem
                     | (g_rst_boot.snap ? RST_F_SNAP : 0) | (et_nvs && et.em_ciclo ? (RST_F_NVS | RST_F_CICLO_NVS) : 0);
    g_rtc_magic = RST_MAGIC; g_rtc_sw = 0; g_rtc_estado = RST_ESTADO_DESC; g_rtc_flags = 0; g_rtc_up_s = 0; memset(&g_rtc_et, 0, sizeof(g_rtc_et));
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
static RstRec* rst_anel(uint8_t quem, uint8_t& N, uint8_t& idx) { if (quem == 3) { N = OCR_N; idx = 1; return g_rst_log.ocr; } N = RST_N; idx = 0; return g_rst_log.rec; }
static RstRec* rst_achar(uint8_t quem, uint32_t seq) {
    uint8_t N, ix; RstRec* a = rst_anel(quem, N, ix);
    for (uint8_t i = 0; i < N; i++) if (a[i].seq == seq && a[i].quem == quem) return &a[i];
    return nullptr;
}
static void rst_chave(const RstRec& r, char pre, char* out, size_t n) { snprintf(out, n, "%c%u-%lu", pre, (unsigned)r.quem, (unsigned long)r.seq); }

static void rst_carimbar() {   // da hora aos registros deste boot que nasceram sem relogio
    uint32_t ep = rst_epoch_agora(); if (!ep) return;
    uint32_t now_s = millis() / 1000UL; bool mudou = false;
    for (uint8_t an = 0; an < 2; an++) {
        uint8_t N, ix; RstRec* a = rst_anel(an == 0 ? 1 : 3, N, ix);
        for (uint8_t i = 0; i < N; i++) {
            RstRec& r = a[i];
            if (!r.seq || !(r.flags & RST_F_SEMHORA) || r.seq < g_rst_seq_ini) continue;
            uint32_t atras = now_s > r.rel_s ? now_s - r.rel_s : 0;
            r.t = ep > atras ? ep - atras : ep; r.flags &= ~RST_F_SEMHORA; mudou = true;
            DBG_PRINTF("[RST] #%lu carimbado: ha %lus (epoch %lu)\n", (unsigned long)r.seq, (unsigned long)atras, (unsigned long)r.t);
        }
    }
    if (mudou) rst_salvar();
}
static RstRec* rst_adicionar(uint8_t quem, uint8_t motivo, uint8_t estado, uint16_t flags, uint8_t sw, uint32_t up_s, uint32_t rel_s, const RstEtapa* et, uint16_t v) {
    uint8_t N, ix; RstRec* a = rst_anel(quem, N, ix);
    RstRec r = {}; r.seq = ++g_rst_log.seq; r.quem = quem; r.motivo = motivo; r.estado = estado; r.flags = flags | RST_F_SEMHORA; r.sw = sw; r.up_s = up_s; r.rel_s = rel_s; r.v = v;
    if (et) { r.et = *et; if ((flags & RST_F_SNAP) && quem == 1 && g_w2prev.valido) r.flags |= RST_F_SEMW2; }
    if (quem == 3) { if (motivo < 8) { g_rst_log.por_ocr[motivo]++; r.n = g_rst_log.por_ocr[motivo]; } g_rst_log.tot[3]++; }
    else { if (quem <= 2) { g_rst_log.tot[quem]++; r.n = g_rst_log.tot[quem]; } if (motivo < 16) g_rst_log.por_motivo[motivo]++; }
    uint8_t slot = g_rst_log.pos[ix]; a[slot] = r; g_rst_log.pos[ix] = (slot + 1) % N; if (g_rst_log.n[ix] < N) g_rst_log.n[ix]++;
    if (quem == 3) DBG_PRINTF("[OCR] O%u #%lu estado=%u valor=%u (total %u)\n", (unsigned)motivo, (unsigned long)r.seq, (unsigned)estado, (unsigned)v, (unsigned)r.n);
    else DBG_PRINTF("[RST] %s reiniciou: motivo=%u(%s) estado_antes=%u%s uptime_antes=%lus%s%s%s (total %s=%u)\n", quem == 1 ? "W1" : "W2", (unsigned)motivo, rst_nome(motivo),
               (unsigned)estado, estado == RST_ESTADO_DESC ? "(desconhecido)" : "", (unsigned long)up_s, (flags & RST_F_CICLO) ? " EM CICLO" : "",
               (flags & RST_F_CICLO_NVS) ? " [ciclo segundo a NVS]" : "", sw ? " [deliberado]" : "", quem == 1 ? "W1" : "W2", (unsigned)r.n);
    if (et && (flags & RST_F_SNAP))
        DBG_PRINTF("[RST]   etapa: proc=%u sub=%u slot=%u giro=%u dir=%u dest=%u modelo=%u di=%04x do=%04x hz10=%u\n", (unsigned)et->proc, (unsigned)et->sub, (unsigned)et->slot,
                   (unsigned)et->giro, (unsigned)et->dir, (unsigned)et->dest, (unsigned)et->modelo, (unsigned)et->di, (unsigned)et->doo, (unsigned)et->hz10);
    return &a[slot];
}
static void rst_reconciliar_fila() {   // registro marcado "na fila" mas o evento nao esta mais na fila da W1 (perdeu): volta a ser enviavel
    for (uint8_t an = 0; an < 2; an++) {
        uint8_t N, ix; RstRec* a = rst_anel(an == 0 ? 1 : 3, N, ix);
        for (uint8_t i = 0; i < N; i++) {
            RstRec& r = a[i]; char res[16];
            if ((r.flags & RST_F_FILA) && !(r.flags & RST_F_ENVIADO)) {
                rst_chave(r, 'W', res, sizeof(res)); bool achou = false;
                for (uint8_t k = 0; k < g_evq_n; k++) if (g_evq[k].tipo == 4 && strcmp(g_evq[k].res, res) == 0) achou = true;
                if (!achou) r.flags &= ~RST_F_FILA;
            }
            if ((r.flags & RST_F_FILAJ) && !(r.flags & RST_F_SNAPENV)) {
                rst_chave(r, 'J', res, sizeof(res)); bool achou = false;
                for (uint8_t k = 0; k < g_evq_n; k++) if (g_evq[k].tipo == 4 && strcmp(g_evq[k].res, res) == 0) achou = true;
                if (!achou) r.flags &= ~RST_F_FILAJ;
            }
        }
    }
}

// Depois de nuvem_carregar() (precisa da fila de eventos carregada): registra ESTE boot e imprime o historico.
void rst_boot_registrar() {
    rst_carregar();
    rst_reconciliar_fila();
    g_rst_seq_ini = g_rst_log.seq + 1;
    if (g_rst_boot.tem) {
        rst_adicionar(1, g_rst_boot.motivo, g_rst_boot.estado, g_rst_boot.flags, g_rst_boot.sw, g_rst_boot.up_s, 0, g_rst_boot.snap ? &g_rst_boot.et : nullptr, 0);
        rst_salvar();
        g_rst_boot.tem = false;
    }
    DBG_PRINTF("[RST] totais: W1=%u W2=%u ocorrencias=%u | por motivo:", (unsigned)g_rst_log.tot[1], (unsigned)g_rst_log.tot[2], (unsigned)g_rst_log.tot[3]);
    for (uint8_t m = 0; m < 16; m++) if (g_rst_log.por_motivo[m]) DBG_PRINTF(" %s=%u", rst_nome(m), (unsigned)g_rst_log.por_motivo[m]);
    DBG_PRINTF(" | ocorrencias por tipo:");
    for (uint8_t m = 0; m < 8; m++) if (g_rst_log.por_ocr[m]) DBG_PRINTF(" O%u=%u", (unsigned)m, (unsigned)g_rst_log.por_ocr[m]);
    DBG_PRINTLN("");
}

// ---- W2 reiniciou (MSG_W2_BOOT, ~20 s depois de cada boot da W2) ----
static uint16_t g_w2_boot_visto = 0; static bool g_w2_boot_tem = false;
static void rst_w2_processar() {
    if (!g_w2boot_novo) return;
    MsgW2Boot b; memcpy(&b, (const void*)&g_w2boot_rx, sizeof(b)); g_w2boot_novo = false;
    if (g_w2_boot_tem && g_w2_boot_visto == b.boot_id) return;      // repeticao da mesma mensagem
    g_w2_boot_tem = true; g_w2_boot_visto = b.boot_id;
    uint8_t est = (uint8_t)g_estado_auto;                           // o que a W1 (que continua viva) estava fazendo quando a W2 voltou
    uint16_t fl = RST_F_EST_OK | (rst_estado_em_ciclo(est) ? RST_F_CICLO : 0) | ((b.motivo == 2 || b.motivo == 11 || b.motivo == 12) ? RST_F_NAOENV : 0);
    uint32_t now_s = millis() / 1000UL;
    rst_adicionar(2, b.motivo, est, fl, 0, b.up_s, now_s > b.up_s ? now_s - b.up_s : 0, nullptr, 0);
    rst_salvar();
    rst_carimbar();
}
// ---- diario do X14/X15 (MSG_W2_DIARIO a cada 5 s) ----
static void rst_w2d_processar() {
    if (!g_w2d_novo) return;
    MsgW2Diario d; memcpy(&d, (const void*)&g_w2d_rx, sizeof(d)); g_w2d_novo = false;
    bool mudou = false;
    for (uint8_t i = 0; i < RST_N; i++) {                           // registros deste boot da W1 que esperam o diario
        RstRec& r = g_rst_log.rec[i];
        if (!(r.flags & RST_F_SEMW2) || r.seq < g_rst_seq_ini) continue;
        if (g_w2prev.valido && g_w2prev.boot_id == d.boot_id) {
            uint16_t d14 = (uint16_t)(d.x14_bordas - g_w2prev.x14), d15 = (uint16_t)(d.x15_bordas - g_w2prev.x15);
            r.dx14 = d14 > 254 ? 254 : (uint8_t)d14; r.dx15 = d15 > 254 ? 254 : (uint8_t)d15;
        } else { r.dx14 = 255; r.dx15 = 255; }                      // a W2 tambem reiniciou (ou nao havia diario anterior): nao da para saber
        r.flags &= ~RST_F_SEMW2; mudou = true;
        DBG_PRINTF("[RST] #%lu: bordas durante a queda da W1: X14=%u X15=%u (255 = desconhecido)\n", (unsigned long)r.seq, (unsigned)r.dx14, (unsigned)r.dx15);
    }
    g_rtc_w2.boot_id = d.boot_id; g_rtc_w2.x14 = d.x14_bordas; g_rtc_w2.x15 = d.x15_bordas; g_rtc_w2.valido = 1;   // base para o proximo reset
    if (mudou) rst_salvar();
}

void rst_evento_confirmado(const char* res) {                       // ACK do display para um evento tipo 4 da cabeca da fila
    if (!res || (res[0] != 'W' && res[0] != 'J')) return;
    uint8_t quem = (uint8_t)(res[1] - '0'); uint32_t seq = (uint32_t)atol(res + 3);
    RstRec* r = rst_achar(quem, seq); if (!r) return;
    if (res[0] == 'W') { r->flags |= RST_F_ENVIADO; r->flags &= ~RST_F_FILA; }
    else               { r->flags |= RST_F_SNAPENV; r->flags &= ~RST_F_FILAJ; }
    rst_salvar();
}

static void rst_enviar_tick(uint32_t agora) {
    static uint32_t t = 0;
    if (agora - t < 2000) return; t = agora;
    if (agora < 15000) return;                                      // boot recente (possivel laco de reinicio): so conta, nao envia
    // SO ENVIA DEPOIS QUE A CAMERA NOVA APARECE: ela manda MSG_HORA (hora NTP) e e a unica que conhece o evento tipo 4 e o endpoint novo. Uma camera
    // ANTIGA ignora o tipo 4 sem confirmar; o display reenviaria a cabeca da fila para sempre e os eventos de lavagem (debito/estorno) ficariam presos atras.
    if (!g_hora_tem) return;
    if (g_evq_n > EVQ_MAX / 2) return;                              // fila de lavagem apertada: eventos de lavagem tem prioridade
    for (uint8_t k = 0; k < g_evq_n; k++) if (g_evq[k].tipo == 4) return;   // um por vez
    // 1) o registro principal mais antigo ainda nao enviado (reinicios antes das ocorrencias)
    RstRec* melhor = nullptr;
    for (uint8_t an = 0; an < 2 && !melhor; an++) {
        uint8_t N, ix; RstRec* a = rst_anel(an == 0 ? 1 : 3, N, ix);
        for (uint8_t i = 0; i < N; i++) {
            RstRec& r = a[i];
            if (!r.seq || (r.flags & (RST_F_ENVIADO | RST_F_NAOENV | RST_F_FILA))) continue;
            if ((r.flags & RST_F_SEMHORA) && r.seq >= g_rst_seq_ini && agora < 120000UL) continue;   // espera o relogio chegar (ate 2 min de boot)
            if (!melhor || r.seq < melhor->seq) melhor = &r;
        }
    }
    EvtRec e = {}; e.tipo = 4;
    if (melhor) {
        RstRec& r = *melhor; int k;
        rst_chave(r, 'W', e.res, sizeof(e.res));
        if (r.quem == 3) k = snprintf(e.err, sizeof(e.err), "O;o=%u;e=%u;n=%u;v=%u", (unsigned)r.motivo, (unsigned)r.estado, (unsigned)r.n, (unsigned)r.v);
        else             k = snprintf(e.err, sizeof(e.err), "W%u;m=%u;e=%u;u=%lu;n=%u;c=%u;s=%u%s", (unsigned)r.quem, (unsigned)r.motivo, (unsigned)r.estado, (unsigned long)r.up_s,
                                       (unsigned)r.n, (r.flags & RST_F_CICLO) ? 1u : 0u, (unsigned)r.sw, (r.flags & RST_F_CICLO_NVS) ? ";k=1" : "");
        if (r.t && k > 0 && k < (int)sizeof(e.err) - 14) snprintf(e.err + k, sizeof(e.err) - k, ";t=%lu", (unsigned long)r.t);   // hora (so com relogio)
        evq_push(e); r.flags |= RST_F_FILA; rst_salvar();
        DBG_PRINTF("[RST] evento %s enfileirado para a nuvem\n", e.res);
        return;
    }
    // 2) o retrato da etapa de um registro ja enviado
    for (uint8_t an = 0; an < 2 && !melhor; an++) {
        uint8_t N, ix; RstRec* a = rst_anel(an == 0 ? 1 : 3, N, ix);
        for (uint8_t i = 0; i < N; i++) {
            RstRec& r = a[i];
            if (!r.seq || !(r.flags & RST_F_SNAP) || !(r.flags & RST_F_ENVIADO) || (r.flags & (RST_F_SNAPENV | RST_F_FILAJ))) continue;
            if ((r.flags & RST_F_SEMW2) && r.seq >= g_rst_seq_ini && agora < 60000UL) continue;   // espera o diario da W2 (ate 1 min de boot)
            if (!melhor || r.seq < melhor->seq) melhor = &r;
        }
    }
    if (!melhor) return;
    RstRec& r = *melhor;
    rst_chave(r, 'J', e.res, sizeof(e.res));
    snprintf(e.err, sizeof(e.err), "J;p=%u;q=%u;i=%u;g=%u;d=%u;m=%u;x=%x;y=%x;h=%u;a=%u;b=%u", (unsigned)r.et.proc, (unsigned)r.et.sub, (unsigned)r.et.slot, (unsigned)r.et.giro,
             (unsigned)rst_dcode(r.et), (unsigned)r.et.modelo, (unsigned)r.et.di, (unsigned)r.et.doo, (unsigned)r.et.hz10, (unsigned)r.dx14, (unsigned)r.dx15);
    evq_push(e); r.flags |= RST_F_FILAJ; rst_salvar();
    DBG_PRINTF("[RST] retrato %s enfileirado para a nuvem\n", e.res);
}

// ---- OCORRENCIAS (Fase 0: so observa; regras da retomada em docs/REGRAS_RETOMADA_CICLO.md) ----
//   O1 X10 apagado (1500 ms) sem 3 s de deslocamento (Y14) desde que o X10 foi visto | O2 X13 com X10 (1500 ms) | O3 X12 com X13 (1500 ms)
//   O4 X15 sem carro (1500 ms) em ciclo | O5 X10 apagado (1500 ms) durante o giro.   So em AUTO_PROCESSO, fora do modo SECO. Cooldown de 5 min por tipo.
#define OCR_ESTAVEL_MS  1500UL
#define OCR_COOLDOWN_MS 300000UL
static void ocr_tick(uint32_t agora) {
    static uint32_t t_ult = 0, y14_ms = 0, desde[6] = {}, ult[6] = {};
    uint32_t dt = t_ult ? agora - t_ult : 0; t_ult = agora; if (dt > 1000) dt = 0;
    bool y14 = (g_io2.do_ & 0x08) != 0, x10 = X10;
    if (y14) y14_ms += dt; else if (x10) y14_ms = 0;                // acumula o deslocamento desde a ultima vez que o X10 foi visto com o carrinho parado
    bool ativo = g_estado_auto == AUTO_PROCESSO && !g_teste_seco && !g_teste_rodando;   // so durante o ciclo real
    bool cond[6] = { false,
        ativo && !x10 && y14_ms < 3000UL,                           // O1
        ativo && X13 && x10,                                        // O2
        ativo && X12 && X13,                                        // O3
        ativo && !X15,                                              // O4
        ativo && g_giro_ativo && !x10 };                            // O5
    for (uint8_t o = 1; o <= 5; o++) {
        if (!cond[o]) { desde[o] = 0; continue; }
        if (!desde[o]) desde[o] = agora ? agora : 1;
        if (agora - desde[o] < OCR_ESTAVEL_MS) continue;
        if (ult[o] && agora - ult[o] < OCR_COOLDOWN_MS) continue;
        ult[o] = agora ? agora : 1;
        RstEtapa et; rst_capturar(et);
        uint32_t now_s = agora / 1000UL;
        rst_adicionar(3, o, (uint8_t)g_estado_auto, RST_F_SNAP | RST_F_EST_OK, 0, 0, now_s, &et, (uint16_t)(y14_ms > 65000UL ? 65000UL : y14_ms));
        rst_salvar();
    }
}

// Relatorio do avanco/retorno do carrinho (diag_x10x12.h, 2026-11-12): ocorrencia tipo 7. No maximo 4 a cada 30 s (so anomalias; nao inunda o anel de 8).
void ocr_diag(uint16_t v) {
    static uint32_t t0 = 0; static uint8_t n = 0;
    uint32_t agora = millis();
    if (!t0 || agora - t0 > 30000UL) { t0 = agora ? agora : 1; n = 0; }
    if (n >= 4) return;
    n++;
    RstEtapa et; rst_capturar(et);
    rst_adicionar(3, 7, (uint8_t)g_estado_auto, RST_F_SNAP | RST_F_EST_OK, 0, 0, agora / 1000UL, &et, v);
    rst_salvar();
}

// Ocorrencia registrada por OUTRO trecho do firmware (ex.: O6 = HOME falhou por comunicacao com a W2; valor = ms sem quadro). No maximo 1 por minuto por tipo.
void ocr_externa(uint8_t tipo, uint16_t valor) {
    static uint32_t ult[8] = {};
    uint32_t agora = millis();
    if (tipo >= 8) return;
    if (ult[tipo] && agora - ult[tipo] < 60000UL) return;
    ult[tipo] = agora ? agora : 1;
    RstEtapa et; rst_capturar(et);
    rst_adicionar(3, tipo, (uint8_t)g_estado_auto, RST_F_SNAP | RST_F_EST_OK, 0, 0, agora / 1000UL, &et, valor);
    rst_salvar();
}

// Chamado a cada volta do loop: retrato RTC (para o proximo reset), checkpoint da NVS, W2, ocorrencias e envio.
void rst_tick() {
    uint32_t agora = millis(), s = agora / 1000UL;
    g_rtc_estado = (uint8_t)g_estado_auto;
    g_rtc_flags = (home_rodando() ? 1 : 0) | (recuperacao_ativa() ? 2 : 0);
    if (s != g_rtc_up_s) g_rtc_up_s = s;
    RstEtapa et; rst_capturar(et); g_rtc_et = et;
    {   // checkpoint na NVS: so na troca de etapa/giro (no maximo 1 por 1,5 s) e ao sair do ciclo
        static uint8_t lp = 255, ls = 255, lg = 255, lgd = 255, lciclo = 0; static uint32_t t_cp = 0;
        uint8_t gd = rst_dcode(et);
        bool mudou = et.em_ciclo != lciclo || (et.em_ciclo && (et.proc != lp || et.slot != ls || et.giro != lg || gd != lgd));
        if (mudou && agora - t_cp >= 1500UL) {
            if (et.em_ciclo || lciclo) rst_et_salvar(et);
            lp = et.proc; ls = et.slot; lg = et.giro; lgd = gd; lciclo = et.em_ciclo; t_cp = agora;
        }
    }
    rst_w2_processar();
    rst_w2d_processar();
    { static uint32_t t_c = 0; if (agora - t_c >= 5000) { t_c = agora; rst_carimbar(); } }
    { static uint32_t t_o = 0; if (agora - t_o >= 100) { t_o = agora; ocr_tick(agora); } }
    rst_enviar_tick(agora);
}
