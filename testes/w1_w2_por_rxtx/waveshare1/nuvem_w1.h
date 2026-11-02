// =======================================================================
// nuvem_w1.h — lado da W1 da NUVEM. REVISAO de 2026-10-24: a W1 fica SO COM A OPERACAO; quem conversa com a CAMERA (heartbeat, backend, licenca,
// fila persistente de eventos) e o DISPLAY (nuvem_display.h). Motivo: isolamento de falhas — um erro no codigo de nuvem nao pode reiniciar a
// controladora no meio de uma lavagem. COMPILADO, AINDA NAO TESTADO NA MAQUINA.
//
// A W1 so faz:
//   - ORDENS vindas do display (MsgNvOrdem, a cada 2 s): INICIAR modelo X para a reserva Y (so se parada; dedup da reserva), estado da LAMPADA,
//     bloqueio de LICENCA (impede iniciar), ASPIRADOR. Sem ordem por 60 s (display parado): lampada e aspirador apagam; o bloqueio de licenca
//     que ja estava ativo continua.
//   - EVENTOS (car-entered, wash-complete, fault): ficam numa pequena FILA na NVS da W1 e sao enviados ao display (MsgNvEvt) a cada 2 s ate o
//     display confirmar (MsgNvEvtAck). O display guarda na fila dele e entrega a camera. Assim nenhum debito se perde, mesmo com o display
//     desligado por um tempo (a fila da W1 guarda ate 16 eventos).
// Incluir DEPOIS de maquina_estados.h. nuvem_carregar() no setup e nuvem_tick() em cada volta do loop.
// =======================================================================
#pragma once

#define EVQ_MAX                 16
#define NUVEM_ORDEM_FAILSAFE_MS 60000UL
#define NUVEM_EVT_REENVIO_MS    2000UL

typedef struct { uint32_t id; uint8_t tipo, prog; char res[40]; char source[8]; char err[64]; } EvtRec;
enum LampNuvem : uint8_t { LAMP_OFF = 0, LAMP_GREEN_SOLID, LAMP_GREEN_BLINK, LAMP_RED_SOLID, LAMP_RED_BLINK, LAMP_RED_GREEN_ALT };

static EvtRec   g_evq[EVQ_MAX];          // fila FIFO; [0] = cabeca
static uint8_t  g_evq_n = 0;
static uint32_t g_evt_id = 0;            // contador de eventos (persistido junto com a fila; o display usa para nao duplicar)
static char     g_res_ciclo[40] = "";    // reserva do ciclo EM ANDAMENTO (vazio = lavagem local)
// 3 MIN SEM CHEGAR NA POSICAO (2026-11-01, regra do Giovani): depois de liberar a lavagem do app (placa lida ou "Ja estou na maquina") o carro tem
// APP_POSICAO_MAX_MS para entrar (X14) e chegar na posicao (X15). Se nao chegar, a W1 CANCELA aquela lavagem e a VAGA VOLTA PARA A FILA.
static uint32_t g_t_app_armado = 0;      // instante em que a reserva do app armou este ciclo (0 = nenhum)
static char     g_res_cancelada[40] = ""; // reserva cancelada por esse prazo: assim que ela sair da liberacao da nuvem, a W1 "esquece" que ja a iniciou (g_res_ultima)
#define APP_POSICAO_MAX_MS 180000UL
static char     g_res_ultima[40] = "";   // ultima reserva INICIADA (dedup; NVS)
// ordens recebidas do display
static uint8_t  g_ord_lamp = LAMP_OFF, g_ord_flags = 0; static uint16_t g_ord_lic_dias = 0; static int16_t g_ord_vacuum = -1;
static bool     g_ord_start_valido = false; static uint8_t g_ord_start_prog = 0; static char g_ord_start_res[40] = "";
static uint32_t g_ord_ms = 0;            // quando chegou a ultima ordem (0 = nunca)
static bool     g_lic_bloq = false, g_lic_aviso = false, g_aspirador_on = false;
static uint32_t g_evt_tx_ms = 0;
// recepcao (o callback so copia; o tick processa)
static volatile bool g_rx_ord_novo = false; static MsgNvOrdem g_rx_ord;
static volatile bool g_rx_ack_novo = false; static uint32_t g_rx_ack_id = 0;

static bool ordens_frescas() { return g_ord_ms && (millis() - g_ord_ms) < NUVEM_ORDEM_FAILSAFE_MS; }

// ---------------------------------------------------------------- NVS ---
static void evq_salvar() {   // so grava quando um evento entra/sai da fila (3 por lavagem, no maximo)
    Preferences p; if (!p.begin("nuvem", false)) return;
    p.putUChar("evn", g_evq_n); p.putUInt("eid", g_evt_id); p.putBytes("evq", g_evq, sizeof(g_evq)); p.end();
}
static void nuvem_salvar_res() { Preferences p; if (p.begin("nuvem", false)) { p.putString("res_ult", g_res_ultima); p.end(); } }

void nuvem_carregar() {
    Preferences p; if (!p.begin("nuvem", true)) return;
    g_evq_n = p.getUChar("evn", 0); if (g_evq_n > EVQ_MAX) g_evq_n = 0;
    g_evt_id = p.getUInt("eid", 0);
    if (g_evq_n && p.getBytesLength("evq") == sizeof(g_evq)) p.getBytes("evq", g_evq, sizeof(g_evq)); else g_evq_n = 0;
    String r = p.getString("res_ult", ""); strncpy(g_res_ultima, r.c_str(), sizeof(g_res_ultima) - 1);
    p.end();
    DBG_PRINTF("[NUVEM] carregado: %u evento(s) na fila, ultimo id=%lu\n", (unsigned)g_evq_n, (unsigned long)g_evt_id);
}

// -------------------------------------------------------------- eventos ---
static void evq_push(EvtRec e) {
    e.id = ++g_evt_id;
    if (g_evq_n >= EVQ_MAX) { memmove(&g_evq[0], &g_evq[1], sizeof(EvtRec) * (EVQ_MAX - 1)); g_evq_n = EVQ_MAX - 1; }   // cheia: descarta o mais antigo
    g_evq[g_evq_n++] = e; evq_salvar();
}
static void evq_pop() { if (!g_evq_n) return; memmove(&g_evq[0], &g_evq[1], sizeof(EvtRec) * (EVQ_MAX - 1)); g_evq_n--; evq_salvar(); }
void backend_evt_car_entered() {
    EvtRec e = {}; e.tipo = 1; strncpy(e.res, g_res_ciclo, sizeof(e.res) - 1); evq_push(e);
    DBG_PRINTLN("[EVT] car-entered enfileirado");
}
void backend_evt_wash_complete(uint8_t programId, const String& source) {
    EvtRec e = {}; e.tipo = 2; e.prog = programId;
    if (source == "socio" || source == "bonus") strncpy(e.source, source.c_str(), sizeof(e.source) - 1);   // sem dinheiro na hora (backend conta, valor 0)
    else if (source == "remote" || g_res_ciclo[0] == 0) strncpy(e.source, "remote", sizeof(e.source) - 1);   // local: sem reserva
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

static void evq_enviar_cabeca() {      // para o DISPLAY (que guarda e entrega a camera)
    if (!g_evq_n) return;
    const EvtRec& e = g_evq[0];
    MsgNvEvt m = {};
    m.cab.tipo = MSG_NV_EVT; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_WAVE1; m.cab.seq = g_ws_seq++;
    m.id = e.id; m.evt_tipo = e.tipo; m.prog = e.prog;
    strncpy(m.res, e.res, sizeof(m.res) - 1); strncpy(m.source, e.source, sizeof(m.source) - 1); strncpy(m.errcode, e.err, sizeof(m.errcode) - 1);
    tx_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&m, sizeof(m));
}

// ------------------------------------------------------------- recepcao ---
void nuvem_on_recv(const uint8_t* data, int len) {            // chamado do callback do ESP-NOW (origem DISPLAY): so copia
    const CabEspNow* c = (const CabEspNow*)data;
    if (c->tipo == MSG_NV_ORDEM && len >= (int)sizeof(MsgNvOrdem)) { memcpy((void*)&g_rx_ord, data, sizeof(MsgNvOrdem)); g_rx_ord_novo = true; }
    else if (c->tipo == MSG_NV_EVT_ACK && len >= (int)sizeof(MsgNvEvtAck)) { g_rx_ack_id = ((const MsgNvEvtAck*)data)->id; g_rx_ack_novo = true; }
}

bool licenca_bloqueada() { return g_lic_bloq; }

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
    if (g_lic_bloq) return;                              // licenca bloqueada: apagadas
    if (g_estado_auto == AUTO_PROCESSO || g_estado_auto == AUTO_PAUSADO || g_estado_auto == AUTO_INICIANDO ||
        g_estado_auto == AUTO_AGUARDA_POS || g_estado_auto == AUTO_AGUARDA_CARRO || g_estado_auto == AUTO_CARRO_ENTRANDO) return;   // o ciclo comanda
    if (home_rodando() || g_manual_ativo) return;
    uint8_t novo = (g_estado_auto == AUTO_ERRO) ? LAMP_RED_BLINK : ((ordens_frescas() && (g_ord_flags & 4)) ? g_ord_lamp : LAMP_OFF);   // erro local SEMPRE pisca vermelho
    if (novo != _lamp_atual) {
        _lamp_atual = novo; _lamp_t = 0; _lamp_on = false;
        DBG_PRINTF("[LAMP] lampada -> %u (ordem=%u flags=%u frescas=%d)\n", (unsigned)novo, (unsigned)g_ord_lamp, (unsigned)g_ord_flags, (int)ordens_frescas());
    }
    lamp_aplicar(_lamp_atual);
}

// ----------------------------------------------------- ordens do display ---
static void nuvem_processar_start() {
    if (!ordens_frescas() || !g_ord_start_valido || g_ord_start_prog < 1 || g_ord_start_prog > 4) return;
    // O APP PREVALECE sobre um ciclo armado SO por pulso do painel que ainda nao comecou o processo (estados 1 a 3, sem reserva): era o caso de
    // 30/10, em que um ciclo velho preso no AGUARDA_POS ignorou uma reserva paga. Ciclos do display (INICIAR) e qualquer coisa de estado >= 4
    // (iniciando, processo, pausa, erro) NAO sao passados por cima: ai vale a regra mestra de so iniciar com a maquina parada.
    bool preempta = g_armado_painel && !nuvem_res_ativa() &&
                    (g_estado_auto == AUTO_AGUARDA_CARRO || g_estado_auto == AUTO_CARRO_ENTRANDO || g_estado_auto == AUTO_AGUARDA_POS);
    if ((g_estado_auto != AUTO_IDLE && !preempta) || g_teste_rodando || home_rodando() || g_manual_ativo || recuperacao_ativa() || g_parar_pedido) return;   // regra mestra: so se parada
    if (licenca_bloqueada()) return;
    if (strncmp(g_ord_start_res, g_res_ultima, sizeof(g_res_ultima)) == 0) return;      // dedup: ja iniciada
    if (preempta) {
        DBG_PRINTF("[NUVEM] reserva do app prevalece sobre o ciclo armado pelo painel (estado %d): desarmando o local\n", (int)g_estado_auto);
        g_armado_painel = false; teste_parar();                                          // volta a IDLE (apaga o verde velho) e segue para iniciar a do app
    }
    if (g_man_sai) man_sai_aplicar(0);
    strncpy(g_res_ultima, g_ord_start_res, sizeof(g_res_ultima) - 1); nuvem_salvar_res();
    g_tipo_prox = 1;                                                                     // aplicativo
    g_ciclo_auto = true;
    auto_iniciar(g_ord_start_prog);                                                      // (zera g_res_ciclo e arma o ciclo)
    strncpy(g_res_ciclo, g_ord_start_res, sizeof(g_res_ciclo) - 1);
    g_t_app_armado = millis() ? millis() : 1;                                            // comeca o relogio de 3 min para o carro chegar na posicao
    DBG_PRINTF("[NUVEM] START pelo app: modelo %u reserva %s\n", (unsigned)g_ord_start_prog, g_res_ciclo);
}
static void nuvem_processar_vacuum() {
    bool dev = ordens_frescas() && g_ord_vacuum > 0;                                     // sem ordem por 60 s: aspirador desliga (seguranca)
    if (dev != g_aspirador_on) { g_aspirador_on = dev; SET_ASPIRADOR(dev); DBG_PRINTF("[VACUUM] aspirador %s (restante=%d s)\n", dev ? "LIGADO" : "desligado", (int)g_ord_vacuum); }
}

// ---- resumo para o display (vai no status) ----
uint8_t  nuvem_flags()  { return (ordens_frescas() ? 1 : 0) | (g_lic_bloq ? 2 : 0) | (g_lic_aviso ? 4 : 0) | (g_aspirador_on ? 8 : 0) | (g_res_ciclo[0] ? 16 : 0); }
uint8_t  nuvem_evq_n()  { return g_evq_n; }
uint16_t nuvem_lic_dias() { return g_ord_lic_dias; }
uint16_t nuvem_hb_idade_s() { return g_ord_ms ? (uint16_t)min<uint32_t>((millis() - g_ord_ms) / 1000UL, 65534UL) : 0xFFFF; }   // idade da ultima ORDEM do display

void nuvem_tick() {
    uint32_t agora = millis();
    if (g_rx_ack_novo) {                                   // display confirmou o evento da cabeca
        uint32_t id = g_rx_ack_id; g_rx_ack_novo = false;
        if (g_evq_n && g_evq[0].id == id) { char rk[40] = ""; if (g_evq[0].tipo == 4) strncpy(rk, g_evq[0].res, sizeof(rk) - 1); evq_pop(); if (rk[0]) rst_evento_confirmado(rk); DBG_PRINTF("[EVT] display confirmou id=%lu (%u restam)\n", (unsigned long)id, (unsigned)g_evq_n); }
    }
    if (g_rx_ord_novo) {                                   // ordens da nuvem (vindas pelo display)
        MsgNvOrdem o; memcpy(&o, (const void*)&g_rx_ord, sizeof(o)); g_rx_ord_novo = false;
        g_ord_ms = agora ? agora : 1; g_ord_lamp = o.lamp; g_ord_flags = o.flags; g_ord_lic_dias = o.lic_dias; g_ord_vacuum = o.vacuum_seg;
        g_ord_start_valido = o.start_valido != 0; g_ord_start_prog = o.start_prog;
        strncpy(g_ord_start_res, o.start_res, sizeof(g_ord_start_res) - 1); g_ord_start_res[sizeof(g_ord_start_res) - 1] = 0;
        bool antes = g_lic_bloq; g_lic_bloq = (o.flags & 1) != 0; g_lic_aviso = (o.flags & 2) != 0;
        if (g_lic_bloq && !antes) { io1_set_do(8, false); io2_set_do(2, false); DBG_PRINTF("[LIC] BLOQUEADA (ordem do display, %u dias sem pagar)\n", (unsigned)o.lic_dias); }
        if (!g_lic_bloq && antes) DBG_PRINTLN("[LIC] desbloqueada");
    }
    if (g_evq_n && agora - g_evt_tx_ms >= NUVEM_EVT_REENVIO_MS) { g_evt_tx_ms = agora; evq_enviar_cabeca(); }   // reenvia ate o display confirmar
    nuvem_processar_start();
    nuvem_processar_vacuum();
    {   // ciclo armado pelo APP esperando o carro: se a reserva sumiu do backend (cancelada/expirada), DESARMA e apaga o verde
        static uint32_t t_sem_res = 0;
        bool sumiu = (g_estado_auto == AUTO_AGUARDA_CARRO || g_estado_auto == AUTO_CARRO_ENTRANDO || g_estado_auto == AUTO_AGUARDA_POS) &&   // (estados 2 e 3 desde 2026-11-01)
                     nuvem_res_ativa() && ordens_frescas() && (g_ord_flags & 4) &&   // so com a nuvem ONLINE (offline nao conta)
                     (!g_ord_start_valido || strncmp(g_ord_start_res, g_res_ciclo, sizeof(g_res_ciclo)) != 0);
        if (!sumiu) t_sem_res = 0;
        else if (!t_sem_res) t_sem_res = agora ? agora : 1;
        else if (agora - t_sem_res > 8000) { t_sem_res = 0; DBG_PRINTF("[NUVEM] reserva %s cancelada/expirada: ciclo desarmado\n", g_res_ciclo); teste_parar(); }
    }
    {   // 3 MIN SEM CHEGAR NA POSICAO: ciclo do APP ainda sem processo (estados 1 a 3). Cancela aquela lavagem e a vaga volta para a fila.
        if (g_estado_auto == AUTO_IDLE) g_t_app_armado = 0;
        if (g_t_app_armado && nuvem_res_ativa() &&
            (g_estado_auto == AUTO_AGUARDA_CARRO || g_estado_auto == AUTO_CARRO_ENTRANDO || g_estado_auto == AUTO_AGUARDA_POS) &&
            (int32_t)(agora - g_t_app_armado) >= (int32_t)APP_POSICAO_MAX_MS) {   // COM SINAL: g_t_app_armado pode ser mais novo que 'agora' (setado neste mesmo tick por nuvem_processar_start)
            DBG_PRINTF("[NUVEM] reserva %s: carro nao chegou na posicao (X15) em 3 min -> cancela esta lavagem e devolve a vaga para a fila\n", g_res_ciclo);
            backend_evt_fault("X15_POSICAO: carro nao posicionou em 3 min");              // ANTES de limpar a reserva (o evento leva o id dela); o backend reenfileira
            g_manual_msg = "Reserva do app cancelada: carro nao posicionou em 3 min"; g_manual_msg_ms = millis();
            strncpy(g_res_cancelada, g_res_ciclo, sizeof(g_res_cancelada) - 1);
            g_t_app_armado = 0;
            teste_parar();                                                                // IDLE (nao ERRO): a maquina fica livre para o proximo da fila
        }
        // A nuvem ainda manda a mesma liberacao por alguns segundos; enquanto ela existir a W1 NAO reinicia (g_res_ultima barra). Quando a reserva sai
        // da liberacao (voltou para a fila, ou foi estornada), a W1 esquece que a iniciou: se o cliente chegar de novo, a mesma reserva vale outra vez.
        if (g_res_cancelada[0] && ordens_frescas() && (g_ord_flags & 4) &&
            (!g_ord_start_valido || strncmp(g_ord_start_res, g_res_cancelada, sizeof(g_res_cancelada)) != 0)) {
            if (strncmp(g_res_ultima, g_res_cancelada, sizeof(g_res_ultima)) == 0) { g_res_ultima[0] = 0; nuvem_salvar_res(); }
            g_res_cancelada[0] = 0;
        }
    }
    {   // diagnostico: o que o display esta mandando (a cada 10 s)
        static uint32_t t_diag = 0;
        if (agora - t_diag >= 10000) { t_diag = agora; DBG_PRINTF("[NUVEM] ordens: lamp=%u flags=%u start=%d res=%.12s idade=%us\n", (unsigned)g_ord_lamp, (unsigned)g_ord_flags, (int)g_ord_start_valido, g_ord_start_res, (unsigned)nuvem_hb_idade_s()); }
    }
    lampada_tick();
}
