// =======================================================================
// nuvem_w1.h — a W1 conversa DIRETO com a CAMERA (decisao de 2026-10-24; antes quem fazia isso era o display, ver lava_car_485/display/
// backend_client.h, licenca.h e lampada_app.h, que este arquivo porta). COMPILADO, AINDA NAO TESTADO COM A CAMERA.
//
//   - Heartbeat para a camera a cada 5 s (estado FREE/WASHING); a camera faz o POST no backend e devolve MSG_HB_RESP:
//     lightState, licenca (dias sem pagar / bloqueada), comando `start` (reserva paga esperando) e comando do aspirador.
//   - INICIO PELO APP: `start` valido + maquina parada + reserva ainda nao iniciada -> auto_iniciar(modelo), tipo "aplicativo".
//   - EVENTOS (car-entered, wash-complete, fault) com FILA NA NVS: so saem da fila quando a camera confirma (MSG_EVT_ACK) — o debito
//     da lavagem nunca se perde, mesmo com internet instavel ou a W1 reiniciando.
//   - LICENCA: bloqueia o inicio de ciclos (pagamento: aviso 40 d, bloqueio 50 d; comunicacao: 15 DIAS LIGADA sem heartbeat OK).
//   - LAMPADA (Y11 verde / Y12 vermelho): segue o lightState da nuvem quando nao ha ciclo; erro local SEMPRE pisca vermelho.
//   - ASPIRADOR (DO8 da W2): liga/desliga so conforme `vacuum_seg`, sem olhar o estado do ciclo.
// Incluir DEPOIS de maquina_estados.h. Chamar nuvem_carregar() no setup e nuvem_tick() em cada volta do loop.
// =======================================================================
#pragma once

#define NUVEM_HB_MS        5000UL
#define NUVEM_FAILSAFE_MS  60000UL      // 60 s sem resposta OK -> lampada apagada
#define LIC_AVISO_DIAS     40
#define LIC_BLOQUEIO_DIAS  50
#define LIC_COMM_DIAS      15
#define EVQ_MAX            16

typedef struct { uint8_t tipo, prog; char res[40]; char source[8]; char err[64]; } EvtRec;
enum LampNuvem : uint8_t { LAMP_OFF = 0, LAMP_GREEN_SOLID, LAMP_GREEN_BLINK, LAMP_RED_SOLID, LAMP_RED_BLINK, LAMP_RED_GREEN_ALT };

static EvtRec   g_evq[EVQ_MAX];          // fila FIFO; [0] = cabeca (proximo a enviar)
static uint8_t  g_evq_n = 0;
static char     g_res_ciclo[40] = "";    // reserva do ciclo EM ANDAMENTO (vazio = lavagem local: painel/display)
static char     g_res_ultima[40] = "";   // ultima reserva INICIADA (dedup: o backend repete `start` ate registrar a conclusao)
static uint8_t  g_lamp_nuvem = LAMP_OFF;
static bool     g_backend_ok = false;
static uint32_t g_hb_ok_ms = 0, g_hb_tx_ms = 0;
static int16_t  g_vacuum_seg = -1;
static bool     g_aspirador_on = false;
static bool     g_start_valido = false; static uint8_t g_start_prog = 0; static char g_start_res[40] = "";
// licenca
static uint16_t g_lic_dias = 0; static bool g_lic_blk = false;
static bool     g_lic_bloq = false, g_lic_aviso = false;
static uint32_t g_lic_comm_dias = 0;
static uint32_t g_up_base = 0;           // segundos LIGADA acumulados ate o ultimo boot (NVS)
static uint32_t g_up_ok = 0;             // acumulado no momento do ultimo heartbeat OK
static bool     g_up_tem_ok = false;
static uint32_t g_up_salvo_ms = 0;
// recepcao (o callback so copia; o tick processa)
static volatile bool g_rx_hb_novo = false;  static MsgHbResp g_rx_hb;
static volatile bool g_rx_ack_novo = false; static MsgEvtAck g_rx_ack;

static uint32_t up_agora() { return g_up_base + millis() / 1000UL; }

// ---------------------------------------------------------------- NVS ---
static void evq_salvar() {
    Preferences p; if (!p.begin("nuvem", false)) return;
    p.putUChar("evn", g_evq_n); p.putBytes("evq", g_evq, sizeof(g_evq)); p.end();
}
static void nuvem_salvar_lic() {
    Preferences p; if (!p.begin("nuvem", false)) return;
    p.putUShort("lic_d", g_lic_dias); p.putBool("lic_b", g_lic_blk); p.putUInt("up_ok", g_up_ok); p.putBool("up_tem", g_up_tem_ok); p.end();
}
static void nuvem_salvar_up() { Preferences p; if (p.begin("nuvem", false)) { p.putUInt("up", up_agora()); p.end(); } g_up_salvo_ms = millis(); }
static void nuvem_salvar_res() { Preferences p; if (p.begin("nuvem", false)) { p.putString("res_ult", g_res_ultima); p.end(); } }

void nuvem_carregar() {
    Preferences p; if (!p.begin("nuvem", true)) return;
    g_evq_n = p.getUChar("evn", 0); if (g_evq_n > EVQ_MAX) g_evq_n = 0;
    if (g_evq_n && p.getBytesLength("evq") == sizeof(g_evq)) p.getBytes("evq", g_evq, sizeof(g_evq)); else g_evq_n = 0;
    String r = p.getString("res_ult", ""); strncpy(g_res_ultima, r.c_str(), sizeof(g_res_ultima) - 1);
    g_lic_dias = p.getUShort("lic_d", 0); g_lic_blk = p.getBool("lic_b", false);
    g_up_base = p.getUInt("up", 0); g_up_ok = p.getUInt("up_ok", 0); g_up_tem_ok = p.getBool("up_tem", false);
    p.end();
    DBG_PRINTF("[NUVEM] carregado: %u evento(s) na fila, licenca dias=%u bloqueada=%d, ligada acumulada=%lu s\n",
               (unsigned)g_evq_n, (unsigned)g_lic_dias, (int)g_lic_blk, (unsigned long)g_up_base);
}

// -------------------------------------------------------------- eventos ---
static void evq_push(const EvtRec& e) {
    if (g_evq_n >= EVQ_MAX) { memmove(&g_evq[0], &g_evq[1], sizeof(EvtRec) * (EVQ_MAX - 1)); g_evq_n = EVQ_MAX - 1; }   // cheia: descarta o mais antigo
    g_evq[g_evq_n++] = e; evq_salvar();
}
static void evq_pop() {
    if (!g_evq_n) return;
    memmove(&g_evq[0], &g_evq[1], sizeof(EvtRec) * (EVQ_MAX - 1)); g_evq_n--; evq_salvar();
}
void backend_evt_car_entered() {
    EvtRec e = {}; e.tipo = 1; strncpy(e.res, g_res_ciclo, sizeof(e.res) - 1); evq_push(e);
    DBG_PRINTLN("[EVT] car-entered enfileirado");
}
void backend_evt_wash_complete(uint8_t programId, const String& source) {
    EvtRec e = {}; e.tipo = 2; e.prog = programId;
    if (source == "remote" || g_res_ciclo[0] == 0) strncpy(e.source, "remote", sizeof(e.source) - 1);   // local: sem reserva
    else                                           strncpy(e.res, g_res_ciclo, sizeof(e.res) - 1);        // app: reserva
    evq_push(e);
    DBG_PRINTF("[EVT] wash-complete enfileirado prog=%u src=%s\n", (unsigned)programId, e.source[0] ? e.source : "app");
}
void backend_evt_fault(const char* errorCode) {
    EvtRec e = {}; e.tipo = 3; strncpy(e.res, g_res_ciclo, sizeof(e.res) - 1);
    if (errorCode) { strncpy(e.err, errorCode, sizeof(e.err) - 1); for (char* c = e.err; *c; c++) if (*c == '"') *c = '\''; }
    evq_push(e);
    DBG_PRINTF("[EVT] fault enfileirado (%s)\n", e.err);
}
String nvs_get_last_res_id() { return String(g_res_ciclo); }       // reserva do ciclo em andamento (vazio = local)
void nuvem_res_limpar() { g_res_ciclo[0] = 0; }
bool nuvem_res_ativa() { return g_res_ciclo[0] != 0; }

static void evq_enviar_cabeca() {
    if (!g_evq_n) return;
    const EvtRec& e = g_evq[0];
    MsgEvt m = {};
    m.cab.tipo = MSG_EVT; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_WAVE1; m.cab.seq = g_ws_seq++;
    m.evt_tipo = e.tipo; m.prog = e.prog;
    strncpy(m.res, e.res, sizeof(m.res) - 1); strncpy(m.source, e.source, sizeof(m.source) - 1); strncpy(m.errcode, e.err, sizeof(m.errcode) - 1);
    esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
    DBG_PRINTF("[EVT] enviado a camera tipo=%u (aguardando ACK)\n", (unsigned)e.tipo);
}

// ------------------------------------------------------------- recepcao ---
void nuvem_on_recv(const uint8_t* data, int len) {            // chamado do callback do ESP-NOW: so copia
    const CabEspNow* c = (const CabEspNow*)data;
    if (c->tipo == MSG_HB_RESP && len >= (int)sizeof(MsgHbResp)) { memcpy((void*)&g_rx_hb, data, sizeof(MsgHbResp)); g_rx_hb_novo = true; }
    else if (c->tipo == MSG_EVT_ACK && len >= (int)sizeof(MsgEvtAck)) { memcpy((void*)&g_rx_ack, data, sizeof(MsgEvtAck)); g_rx_ack_novo = true; }
}

// -------------------------------------------------------------- licenca ---
bool licenca_bloqueada() { return g_lic_bloq; }
static void licenca_tick() {
    static uint32_t t = 0; if (millis() - t < 1000) return; t = millis();
    bool antes = g_lic_bloq;
    bool trava1 = g_lic_blk || (g_lic_dias >= LIC_BLOQUEIO_DIAS);
    g_lic_aviso = !trava1 && (g_lic_dias >= LIC_AVISO_DIAS);
    bool trava2 = false;
    if (g_up_tem_ok) { g_lic_comm_dias = (up_agora() - g_up_ok) / 86400UL; trava2 = g_lic_comm_dias >= LIC_COMM_DIAS; }   // dias LIGADA sem comunicacao
    g_lic_bloq = trava1 || trava2;
    if (g_lic_bloq && !antes) { io1_set_do(8, false); io2_set_do(2, false); DBG_PRINTF("[LIC] BLOQUEADA t1=%d t2=%d dias_pag=%u dias_comm=%lu\n", (int)trava1, (int)trava2, (unsigned)g_lic_dias, (unsigned long)g_lic_comm_dias); }
    if (!g_lic_bloq && antes) DBG_PRINTLN("[LIC] desbloqueada");
}

// -------------------------------------------------------------- lampada ---
static uint32_t _lamp_t = 0; static bool _lamp_on = false; static uint8_t _lamp_atual = 255;
static void lamp_aplicar(uint8_t e) {
    uint32_t agora = millis();
    switch (e) {
        case LAMP_OFF:          SET_Y11(false); SET_Y12(false); break;
        case LAMP_GREEN_SOLID:  SET_Y11(true);  SET_Y12(false); break;
        case LAMP_RED_SOLID:    SET_Y11(false); SET_Y12(true);  break;
        case LAMP_GREEN_BLINK:  if (agora - _lamp_t >= 500) { _lamp_t = agora; _lamp_on = !_lamp_on; SET_Y11(_lamp_on); SET_Y12(false); } break;
        case LAMP_RED_BLINK:    if (agora - _lamp_t >= 500) { _lamp_t = agora; _lamp_on = !_lamp_on; SET_Y11(false); SET_Y12(_lamp_on); } break;
        case LAMP_RED_GREEN_ALT:if (agora - _lamp_t >= 500) { _lamp_t = agora; _lamp_on = !_lamp_on; SET_Y11(_lamp_on); SET_Y12(!_lamp_on); } break;
    }
}
static void lampada_tick() {
    if (recuperacao_ativa()) return;                     // a recuperacao de boot comanda as lampadas
    if (g_lic_bloq) return;                              // licenca bloqueada: apagadas (licenca_tick apaga ao bloquear)
    if (g_estado_auto == AUTO_PROCESSO || g_estado_auto == AUTO_PAUSADO || g_estado_auto == AUTO_INICIANDO ||
        g_estado_auto == AUTO_AGUARDA_POS || g_estado_auto == AUTO_AGUARDA_CARRO || g_estado_auto == AUTO_CARRO_ENTRANDO) return;   // o ciclo comanda
    if (home_rodando() || g_manual_ativo) return;
    uint8_t novo = (g_estado_auto == AUTO_ERRO) ? LAMP_RED_BLINK : (g_backend_ok ? g_lamp_nuvem : LAMP_OFF);   // erro local SEMPRE pisca vermelho
    if (novo != _lamp_atual) { _lamp_atual = novo; _lamp_t = 0; _lamp_on = false; }
    lamp_aplicar(_lamp_atual);
}

// ----------------------------------------------------------- heartbeat ---
static const char* estado_str() {
    if (io2_get_di(5) || io2_get_di(6)) return "WASHING";            // X14 / X15: carro presente NUNCA e "livre" pro app
    switch (g_estado_auto) {
        case AUTO_PROCESSO: case AUTO_CARRO_ENTRANDO: case AUTO_PAUSADO: return "WASHING";
        default: return "FREE";
    }
}
static void nuvem_processar_start() {
    if (!g_start_valido || g_start_prog < 1 || g_start_prog > 4) return;
    if (g_estado_auto != AUTO_IDLE || g_teste_rodando || home_rodando() || g_manual_ativo || recuperacao_ativa() || g_parar_pedido) return;   // regra mestra: so se parada
    if (licenca_bloqueada()) return;
    if (strncmp(g_start_res, g_res_ultima, sizeof(g_res_ultima)) == 0) return;      // dedup: ja iniciada
    if (g_man_sai) man_sai_aplicar(0);
    strncpy(g_res_ultima, g_start_res, sizeof(g_res_ultima) - 1); nuvem_salvar_res();
    g_tipo_prox = 1;                                                                 // aplicativo
    g_ciclo_auto = true;
    auto_iniciar(g_start_prog);                                                      // (zera g_res_ciclo e arma o ciclo)
    strncpy(g_res_ciclo, g_start_res, sizeof(g_res_ciclo) - 1);
    DBG_PRINTF("[NUVEM] START pelo app: modelo %u reserva %s\n", (unsigned)g_start_prog, g_res_ciclo);
}
static void nuvem_processar_vacuum() {
    bool dev = g_vacuum_seg > 0;
    if (dev != g_aspirador_on) { g_aspirador_on = dev; SET_ASPIRADOR(dev); DBG_PRINTF("[VACUUM] aspirador %s (restante=%d s)\n", dev ? "LIGADO" : "desligado", (int)g_vacuum_seg); }
}

void nuvem_tick() {
    uint32_t agora = millis();
    // ---- respostas da camera ----
    if (g_rx_ack_novo) {
        MsgEvtAck a; memcpy(&a, (const void*)&g_rx_ack, sizeof(a)); g_rx_ack_novo = false;
        if (a.ok && g_evq_n && g_evq[0].tipo == a.evt_tipo && strncmp(g_evq[0].res, a.res, sizeof(a.res)) == 0) { evq_pop(); DBG_PRINTF("[EVT] ACK tipo=%u -> removido da fila (%u restam)\n", (unsigned)a.evt_tipo, (unsigned)g_evq_n); }
    }
    if (g_rx_hb_novo) {
        MsgHbResp r; memcpy(&r, (const void*)&g_rx_hb, sizeof(r)); g_rx_hb_novo = false;
        if (r.ok) {
            g_backend_ok = true; g_hb_ok_ms = agora; g_lamp_nuvem = r.lightState; g_vacuum_seg = r.vacuum_seg;
            g_lic_dias = r.lic_days; g_lic_blk = r.lic_blocked != 0; g_up_ok = up_agora(); g_up_tem_ok = true; nuvem_salvar_lic();
            g_start_valido = r.start_valido && r.start_prog >= 1 && r.start_prog <= 4;
            if (g_start_valido) { g_start_prog = r.start_prog; strncpy(g_start_res, r.start_res, sizeof(g_start_res) - 1); g_start_res[sizeof(g_start_res) - 1] = 0; }
            DBG_PRINTF("[HB] OK lamp=%u start=%d dias=%u blk=%d vacuum=%d\n", (unsigned)r.lightState, (int)g_start_valido, (unsigned)r.lic_days, (int)r.lic_blocked, (int)r.vacuum_seg);
        } else DBG_PRINTLN("[HB] camera reportou falha no backend");
    }
    // ---- failsafe: sem resposta OK por 60 s ----
    if (g_backend_ok && agora - g_hb_ok_ms > NUVEM_FAILSAFE_MS) { g_backend_ok = false; g_lamp_nuvem = LAMP_OFF; DBG_PRINTLN("[HB] failsafe: 60 s sem resposta -> lampada apagada"); }
    // ---- heartbeat + start + aspirador + 1 evento da fila, a cada 5 s ----
    if (agora - g_hb_tx_ms >= NUVEM_HB_MS) {
        g_hb_tx_ms = agora;
        MsgHbState m = {};
        m.cab.tipo = MSG_HB_STATE; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_WAVE1; m.cab.seq = g_ws_seq++;
        strncpy(m.state, estado_str(), sizeof(m.state) - 1); m.restanteSeg = 0;
        esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
        nuvem_processar_start();
        nuvem_processar_vacuum();
        evq_enviar_cabeca();
    }
    licenca_tick();
    lampada_tick();
    if (agora - g_up_salvo_ms >= 600000UL) nuvem_salvar_up();     // guarda o "tempo ligada" a cada 10 min
}
