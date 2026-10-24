// =======================================================================
// nuvem_display.h — o DISPLAY conversa com a CAMERA (revisao de 2026-10-24: a W1 fica so com a operacao; ver nuvem_w1.h).
// Porta do firmware antigo (backend_client.h, licenca.h) adaptada: a W1 manda EVENTOS (MsgNvEvt) e recebe ORDENS (MsgNvOrdem).
// COMPILADO, AINDA NAO TESTADO COM A CAMERA.
//   - A cada 5 s manda o ESTADO (FREE/WASHING) a camera (MsgHbState) e recebe a resposta do backend (MsgHbResp):
//     lightState, licenca (dias sem pagar / bloqueada), comando `start` (reserva paga esperando) e aspirador.
//   - A cada 2 s manda as ORDENS para a W1 (lampada, bloqueio de licenca, aspirador, iniciar modelo X da reserva Y).
//   - EVENTOS: a W1 manda (MsgNvEvt); o display guarda na SUA fila na NVS, confirma a W1 (MsgNvEvtAck) e entrega a camera (MsgEvt) ate a camera
//     confirmar o backend (MsgEvtAck). So entao sai da fila. Eventos vao por envio UNICAST (nunca broadcast: duplicaria o debito).
//   - LICENCA: pagamento (aviso 40 d, bloqueio 50 d) e comunicacao (15 DIAS LIGADO sem resposta OK; a maquina nao tem relogio, conta tempo ligado).
//   - Sem resposta da camera por 60 s: nuvem OFFLINE, lampada apagada, aspirador desligado, sem iniciar pelo app.
// =======================================================================
#pragma once

#define ND_HB_MS         5000UL
#define ND_ORDEM_MS      2000UL
#define ND_FAILSAFE_MS   60000UL
#define ND_EVQ_MAX       16
#define LIC_AVISO_DIAS   40
#define LIC_BLOQUEIO_DIAS 50
#define LIC_COMM_DIAS    15

typedef struct { uint32_t id; uint8_t tipo, prog; char res[40]; char source[8]; char err[64]; } EvtD;
static EvtD     g_nd_evq[ND_EVQ_MAX];
static uint8_t  g_nd_evq_n = 0;
static uint32_t g_nd_ult_id = 0;                  // ultimo id de evento da W1 ja guardado (nao duplica reenvios)
static bool     g_nd_online = false;
static uint32_t g_nd_hb_ok_ms = 0, g_nd_hb_tx_ms = 0, g_nd_ord_tx_ms = 0, g_nd_evt_tx_ms = 0, g_nd_lic_t = 0, g_nd_up_salvo_ms = 0;
static uint8_t  g_nd_lamp = 0; static uint16_t g_nd_lic_dias = 0; static bool g_nd_lic_blk = false; static int16_t g_nd_vacuum = -1;
static bool     g_nd_start_valido = false; static uint8_t g_nd_start_prog = 0; static char g_nd_start_res[40] = "";
static bool     g_nd_lic_bloq = false, g_nd_lic_aviso = false; static uint32_t g_nd_lic_comm_dias = 0;
static uint32_t g_nd_up_base = 0, g_nd_up_ok = 0; static bool g_nd_up_tem = false;
// recepcao (o callback so copia)
static volatile bool g_nd_rx_hb_novo = false;  static MsgHbResp g_nd_rx_hb;
static volatile bool g_nd_rx_ack_novo = false; static MsgEvtAck g_nd_rx_ack;
static volatile bool g_nd_rx_evt_novo = false; static MsgNvEvt  g_nd_rx_evt;

static uint32_t nd_up_agora() { return g_nd_up_base + millis() / 1000UL; }

// ---------------------------------------------------------------- NVS ---
static void nd_salvar_fila() { Preferences p; if (!p.begin("nuvem_d", false)) return; p.putUChar("evn", g_nd_evq_n); p.putUInt("ult", g_nd_ult_id); p.putBytes("evq", g_nd_evq, sizeof(g_nd_evq)); p.end(); }
static void nd_salvar_lic() { Preferences p; if (!p.begin("nuvem_d", false)) return; p.putUShort("lic_d", g_nd_lic_dias); p.putBool("lic_b", g_nd_lic_blk); p.putUInt("up_ok", g_nd_up_ok); p.putBool("up_tem", g_nd_up_tem); p.end(); }
static void nd_salvar_up() {
    Preferences p; if (p.begin("nuvem_d", false)) { p.putUInt("up", nd_up_agora()); p.putUInt("up_ok", g_nd_up_ok); p.putBool("up_tem", g_nd_up_tem); p.end(); }
    g_nd_up_salvo_ms = millis();
}
static void nd_carregar() {
    Preferences p; if (!p.begin("nuvem_d", true)) return;
    g_nd_evq_n = p.getUChar("evn", 0); if (g_nd_evq_n > ND_EVQ_MAX) g_nd_evq_n = 0;
    g_nd_ult_id = p.getUInt("ult", 0);
    if (g_nd_evq_n && p.getBytesLength("evq") == sizeof(g_nd_evq)) p.getBytes("evq", g_nd_evq, sizeof(g_nd_evq)); else g_nd_evq_n = 0;
    g_nd_lic_dias = p.getUShort("lic_d", 0); g_nd_lic_blk = p.getBool("lic_b", false);
    g_nd_up_base = p.getUInt("up", 0); g_nd_up_ok = p.getUInt("up_ok", 0); g_nd_up_tem = p.getBool("up_tem", false);
    p.end();
}
static void nd_fila_push(const EvtD& e) {
    if (g_nd_evq_n >= ND_EVQ_MAX) { memmove(&g_nd_evq[0], &g_nd_evq[1], sizeof(EvtD) * (ND_EVQ_MAX - 1)); g_nd_evq_n = ND_EVQ_MAX - 1; }
    g_nd_evq[g_nd_evq_n++] = e; nd_salvar_fila();
}
static void nd_fila_pop() { if (!g_nd_evq_n) return; memmove(&g_nd_evq[0], &g_nd_evq[1], sizeof(EvtD) * (ND_EVQ_MAX - 1)); g_nd_evq_n--; nd_salvar_fila(); }

// ---------------------------------------------------------- recepcao ---
static void nd_on_recv(const uint8_t* data, int len) {
    const CabEspNow* c = (const CabEspNow*)data;
    if (c->tipo == MSG_HB_RESP && len >= (int)sizeof(MsgHbResp)) { memcpy((void*)&g_nd_rx_hb, data, sizeof(MsgHbResp)); g_nd_rx_hb_novo = true; }
    else if (c->tipo == MSG_EVT_ACK && len >= (int)sizeof(MsgEvtAck)) { memcpy((void*)&g_nd_rx_ack, data, sizeof(MsgEvtAck)); g_nd_rx_ack_novo = true; }
    else if (c->tipo == MSG_NV_EVT && len >= (int)sizeof(MsgNvEvt)) { memcpy((void*)&g_nd_rx_evt, data, sizeof(MsgNvEvt)); g_nd_rx_evt_novo = true; }
}

// ----------------------------------------------------------- consultas ---
static bool     nd_lic_bloq()  { return g_nd_lic_bloq; }
static bool     nd_lic_aviso() { return g_nd_lic_aviso; }
static uint16_t nd_lic_dias()  { return g_nd_lic_dias; }
static bool     nd_online()    { return g_nd_online; }
static uint16_t nd_idade_s()   { return g_nd_hb_ok_ms ? (uint16_t)min<uint32_t>((millis() - g_nd_hb_ok_ms) / 1000UL, 65534UL) : 0xFFFF; }
static uint8_t  nd_evq_n()     { return g_nd_evq_n; }

// ------------------------------------------------------------- envios ---
static const char* nd_estado_str() {
    if (!g_st_ok) return "FREE";
    if (((g_st.io2_di >> 4) & 1) || ((g_st.io2_di >> 5) & 1)) return "WASHING";     // X14 / X15: carro presente NUNCA e "livre" pro app
    switch (g_st.estado_auto) { case 5: case 2: case 8: return "WASHING"; default: return "FREE"; }   // PROCESSO, CARRO_ENTRANDO, PAUSADO
}
static void nd_enviar_hb() {
    MsgHbState m = {}; m.cab.tipo = MSG_HB_STATE; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_seq++;
    strncpy(m.state, nd_estado_str(), sizeof(m.state) - 1); m.restanteSeg = 0;
    esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
}
static void nd_enviar_cabeca_camera() {
    if (!g_nd_evq_n) return;
    const EvtD& e = g_nd_evq[0];
    MsgEvt m = {}; m.cab.tipo = MSG_EVT; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_seq++;
    m.evt_tipo = e.tipo; m.prog = e.prog;
    strncpy(m.res, e.res, sizeof(m.res) - 1); strncpy(m.source, e.source, sizeof(m.source) - 1); strncpy(m.errcode, e.err, sizeof(m.errcode) - 1);
    esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));          // UNICAST (nunca broadcast: a camera processaria o evento 2x)
}
static void nd_enviar_ordem() {
    MsgNvOrdem o = {}; o.cab.tipo = MSG_NV_ORDEM; o.cab.id_maquina = ID_MAQUINA; o.cab.origem = ORIGEM_DISPLAY; o.cab.seq = g_seq++;
    o.lamp = g_nd_online ? g_nd_lamp : 0;
    o.flags = (g_nd_lic_bloq ? 1 : 0) | (g_nd_lic_aviso ? 2 : 0) | (g_nd_online ? 4 : 0);
    o.lic_dias = g_nd_lic_dias; o.vacuum_seg = g_nd_online ? g_nd_vacuum : -1;
    o.start_valido = (g_nd_online && g_nd_start_valido) ? 1 : 0; o.start_prog = g_nd_start_prog;
    strncpy(o.start_res, g_nd_start_res, sizeof(o.start_res) - 1);
    esp_now_send((uint8_t*)MAC_WAVE1, (uint8_t*)&o, sizeof(o));
}
static void nd_ack_w1(uint32_t id) {
    MsgNvEvtAck a = {}; a.cab.tipo = MSG_NV_EVT_ACK; a.cab.id_maquina = ID_MAQUINA; a.cab.origem = ORIGEM_DISPLAY; a.cab.seq = g_seq++; a.id = id;
    esp_now_send((uint8_t*)MAC_WAVE1, (uint8_t*)&a, sizeof(a));
}

// ------------------------------------------------------------- licenca ---
static void nd_licenca_tick() {
    if (millis() - g_nd_lic_t < 1000) return; g_nd_lic_t = millis();
    bool trava1 = g_nd_lic_blk || (g_nd_lic_dias >= LIC_BLOQUEIO_DIAS);
    g_nd_lic_aviso = !trava1 && (g_nd_lic_dias >= LIC_AVISO_DIAS);
    bool trava2 = false;
    if (g_nd_up_tem) { g_nd_lic_comm_dias = (nd_up_agora() - g_nd_up_ok) / 86400UL; trava2 = g_nd_lic_comm_dias >= LIC_COMM_DIAS; }   // dias LIGADO sem comunicacao
    g_nd_lic_bloq = trava1 || trava2;
}

// -------------------------------------------------------- loop (fora do LVGL) ---
static void nd_tick() {
    uint32_t agora = millis();
    if (g_nd_rx_ack_novo) {                                       // camera confirmou o evento: o backend aceitou (200)
        MsgEvtAck a; memcpy(&a, (const void*)&g_nd_rx_ack, sizeof(a)); g_nd_rx_ack_novo = false;
        if (a.ok && g_nd_evq_n && g_nd_evq[0].tipo == a.evt_tipo && strncmp(g_nd_evq[0].res, a.res, sizeof(a.res)) == 0) nd_fila_pop();
    }
    if (g_nd_rx_evt_novo) {                                       // evento novo da W1: guarda, confirma a W1, entrega a camera depois
        MsgNvEvt e; memcpy(&e, (const void*)&g_nd_rx_evt, sizeof(e)); g_nd_rx_evt_novo = false;
        if (e.id > g_nd_ult_id) {                                 // ids so crescem; reenvios (ja confirmados) sao ignorados
            EvtD d = {}; d.id = e.id; d.tipo = e.evt_tipo; d.prog = e.prog;
            strncpy(d.res, e.res, sizeof(d.res) - 1); strncpy(d.source, e.source, sizeof(d.source) - 1); strncpy(d.err, e.errcode, sizeof(d.err) - 1);
            g_nd_ult_id = e.id; nd_fila_push(d);
        }
        nd_ack_w1(e.id);                                          // confirma SEMPRE (inclusive reenvio), senao a W1 repete para sempre
    }
    if (g_nd_rx_hb_novo) {                                        // resposta do backend (via camera)
        MsgHbResp r; memcpy(&r, (const void*)&g_nd_rx_hb, sizeof(r)); g_nd_rx_hb_novo = false;
        if (r.ok) {
            g_nd_online = true; g_nd_hb_ok_ms = agora ? agora : 1; g_nd_lamp = r.lightState; g_nd_vacuum = r.vacuum_seg;
            bool mudou = (g_nd_lic_dias != r.lic_days) || (g_nd_lic_blk != (r.lic_blocked != 0)) || !g_nd_up_tem;   // so grava na flash se a LICENCA mudou
            g_nd_lic_dias = r.lic_days; g_nd_lic_blk = r.lic_blocked != 0; g_nd_up_ok = nd_up_agora(); g_nd_up_tem = true;
            if (mudou) nd_salvar_lic();
            g_nd_start_valido = r.start_valido && r.start_prog >= 1 && r.start_prog <= 4;
            if (g_nd_start_valido) { g_nd_start_prog = r.start_prog; strncpy(g_nd_start_res, r.start_res, sizeof(g_nd_start_res) - 1); g_nd_start_res[sizeof(g_nd_start_res) - 1] = 0; }
        }
    }
    if (g_nd_online && agora - g_nd_hb_ok_ms > ND_FAILSAFE_MS) { g_nd_online = false; g_nd_lamp = 0; g_nd_vacuum = -1; g_nd_start_valido = false; }   // sem resposta por 60 s
    if (agora - g_nd_hb_tx_ms >= ND_HB_MS)  { g_nd_hb_tx_ms = agora; nd_enviar_hb(); nd_enviar_cabeca_camera(); }
    if (agora - g_nd_ord_tx_ms >= ND_ORDEM_MS) { g_nd_ord_tx_ms = agora; nd_enviar_ordem(); }
    nd_licenca_tick();
    if (agora - g_nd_up_salvo_ms >= 600000UL) nd_salvar_up();      // guarda o "tempo ligado" a cada 10 min
}
