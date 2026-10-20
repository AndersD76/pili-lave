#pragma once
#include "tipos.h"
#include "vfd_rs485.h"   // Delta/SAJ CONTINUAM em RS-485, sozinhos no barramento (ver vfd_rs485.h)

// =======================================================================
// comm_waveshares_espnow.h — Display <-> Waveshares por ESP-NOW (volta do
// RS-485 compartilhado pro rádio). Mesmo rádio/mesmo init que a câmera já
// usa (ver comm_espnow.h) — só adiciona os peers MAC_WAVE1/MAC_WAVE2 e o
// roteamento das mensagens delas pro shadow abaixo.
//
// Por que voltar: o barramento RS-485 compartilhado (Waveshares + Delta +
// SAJ, tudo no mesmo par de fios) ficou como suspeito nao resolvido de uma
// serie de travamentos reais em teste (giro que nao para, "home nao
// encontrado", "inversor nao confirmou RUN") — a causa exata nunca foi
// confirmada com certeza, mas tirar as Waveshares da disputa do barramento
// elimina essa classe inteira de duvida. O inversor Delta fica sozinho no
// RS-485 dele, sem ninguem mais escrevendo/lendo ali.
//
// FORNECE A MESMA INTERFACE que o resto do codigo ja espera
// (io1_get_di/io2_get_di/io1_set_do/io2_set_do/modbus_refresh_io*_di/
// comm_perdida/alarme_modbus/home_*/desloc_*/modbus_tick/modbus_init) —
// so muda COMO os dados chegam (callback assincrono em vez de poll).
//
// CANAL: as Waveshares usam o MESMO canal fixo que a camera (ESPNOW_CANAL,
// hoje 1) por padrao de fabrica, e guardam o canal real na propria NVS
// delas depois de sincronizadas — um religamento normal (queda de energia)
// volta DIRETO pro canal certo, sem precisar de nenhuma dança de
// pareamento. So uma Waveshare NOVA/trocada (NVS em branco, canal 1) ou uma
// que nunca chegou a sincronizar depois de uma troca de rede do
// estabelecimento precisa do pareamento manual (tela de tecnico — AINDA NAO
// IMPLEMENTADA nesta primeira etapa; por ora, o nudge automatico abaixo
// cobre o caso comum de religamento normal com NVS ja gravada).
// =======================================================================

typedef struct { uint8_t di; uint8_t do_; } EstadoIO;
EstadoIO g_io1 = {0,0};    // g_ioX.di = snapshot consumido ; do_ = estado desejado (espelho local)
EstadoIO g_io2 = {0,0};

// Shadow atualizado pelo callback ESP-NOW (outra task/contexto) — protegido
// por spinlock, mesmo desenho que o poll RS-485 tinha (só troca quem escreve).
static volatile uint8_t  g_viv1=0, g_viv2=0;   // último estado AO VIVO (heartbeat/evento)
static volatile uint8_t  g_lat1=0, g_lat2=0;   // pulsos ACUMULADOS (latch), consumidos no refresh
static volatile uint32_t g_hb1=0, g_hb2=0;     // millis do último pacote recebido de cada waveshare
static portMUX_TYPE       g_iomux = portMUX_INITIALIZER_UNLOCKED;
static uint8_t            g_ws_seq = 0;        // sequencia dos comandos enviados as waveshares

// Alarme na tela (msg deve ser string literal — g_estado guarda só o ponteiro).
void alarme_modbus(const char* msg) {
    g_estado.msg_alarme = msg;
    g_estado.alarme     = true;
}

// -----------------------------------------------------------------------
// Leitura das entradas (consome o latch dos pulsos) — logica IDENTICA a
// antes, só muda quem escreve no shadow por baixo (callback em vez de poll).
// -----------------------------------------------------------------------
static uint8_t g_pulso1 = 0, g_pulso2 = 0;

void modbus_refresh_io1_di() {
    portENTER_CRITICAL(&g_iomux);
    g_pulso1 = g_lat1;
    g_io1.di = g_viv1 | g_lat1;
    g_lat1 = 0;
    portEXIT_CRITICAL(&g_iomux);
}
void modbus_refresh_io2_di() {
    portENTER_CRITICAL(&g_iomux);
    g_pulso2 = g_lat2;
    g_io2.di = g_viv2 | g_lat2;
    g_lat2 = 0;
    portEXIT_CRITICAL(&g_iomux);
}
bool io1_pulso(uint8_t canal) { return (g_pulso1 >> (canal-1)) & 0x01; }
bool io2_pulso(uint8_t canal) { return (g_pulso2 >> (canal-1)) & 0x01; }

bool io1_get_di(uint8_t canal) {
    uint8_t bit = 1 << (canal-1);
    if (bit & PULSO_W1_MASK) return (g_io1.di & bit) != 0;   // X0, X7
    return (g_viv1 & bit) != 0;                              // nível ao vivo
}
bool io2_get_di(uint8_t canal) {
    uint8_t bit = 1 << (canal-1);
    if (bit & PULSO_W2_MASK) return (g_io2.di & bit) != 0;   // X11, X17
    return (g_viv2 & bit) != 0;                              // nível ao vivo
}

// -----------------------------------------------------------------------
// Saidas — ESP-NOW e "fire-and-forget" (nao tem ACK de aplicacao como o
// FC05 do Modbus tinha): manda o comando, atualiza o espelho local na hora
// (otimista), e deixa o heartbeat da waveshare (campo do_estado) corrigir
// sozinho se algo se perder. Mesmo padrao ja validado na versao antiga
// (antes da migracao pro RS-485). Mantem as MESMAS travas de seguranca
// (Y4<->Y14, Y7 so com espuma/cera ligado).
// -----------------------------------------------------------------------
static void ws_envia_comando(const uint8_t* mac, uint8_t canal, uint8_t estado) {
    MsgComando m;
    m.cab.tipo = MSG_COMANDO; m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_ws_seq++;
    m.canal = canal; m.estado = estado;
    esp_now_send((uint8_t*)mac, (uint8_t*)&m, sizeof(m));
}

void io1_set_do(uint8_t canal, bool estado) {
    if (canal < 1 || canal > 8) return;
    if (canal == 4 && estado && (g_io2.do_ & (1 << 3))) {   // trava: Y14 ativo -> não liga Y4
        alarme_modbus("[SEGURANCA] deslocamento ativo ao ligar giro"); return;
    }
    if (canal == 7 && estado &&
        !((g_io1.do_ & (1 << 1)) || (g_io1.do_ & (1 << 2)) || (g_io2.do_ & (1 << 0)))) {
        DBG_PRINTLN("[SEGURANCA] Y7 bloqueado: nenhum solenoide de espuma/cera (Y2/Y3/Y10) ligado");
        return;
    }
    ws_envia_comando(MAC_WAVE1, canal - 1, estado ? 1 : 0);
    if (estado) g_io1.do_ |=  (1 << (canal-1));
    else        g_io1.do_ &= ~(1 << (canal-1));
}
void io2_set_do(uint8_t canal, bool estado) {
    if (canal < 1 || canal > 8) return;
    if (canal == 4 && estado && (g_io1.do_ & (1 << 3))) {   // trava: Y4 ativo -> não liga Y14
        alarme_modbus("[SEGURANCA] giro ativo ao ligar deslocamento"); return;
    }
    ws_envia_comando(MAC_WAVE2, canal - 1, estado ? 1 : 0);
    if (estado) g_io2.do_ |=  (1 << (canal-1));
    else        g_io2.do_ &= ~(1 << (canal-1));
}

// -----------------------------------------------------------------------
// Watchdog de comunicação
// -----------------------------------------------------------------------
bool comm_perdida() {
    uint32_t now = millis();
    return (now - g_hb1 > COMM_TIMEOUT_MS) || (now - g_hb2 > COMM_TIMEOUT_MS);
}

// Alarme de comunicação — mesmo espirito do que existia no RS-485 (avisa
// cedo se uma waveshare parar de responder; some sozinho quando voltar).
#define WAVE_ALARME_MS 60000UL
static bool g_alarme_wave_ativo = false;
extern EstadoAuto g_estado_auto;

static void wave_alarme_tick() {
    uint32_t agora = millis();
    bool perdida1 = (agora - g_hb1 > WAVE_ALARME_MS);
    bool perdida2 = (agora - g_hb2 > WAVE_ALARME_MS);
    if (perdida1 || perdida2) {
        const char* msg = (perdida1 && perdida2) ? "Waveshare 1 e 2 sem contato (radio)"
                         : perdida1               ? "Waveshare 1 sem contato (radio)"
                                                   : "Waveshare 2 sem contato (radio)";
        if (g_estado_auto != AUTO_ERRO) alarme_modbus(msg);
        g_alarme_wave_ativo = true;
    } else if (g_alarme_wave_ativo) {
        g_alarme_wave_ativo = false;
        if (g_estado_auto != AUTO_ERRO) g_estado.alarme = false;
    }
}

// -----------------------------------------------------------------------
// Roteamento das mensagens das Waveshares — chamado pelo espnow_on_recv
// do comm_espnow.h (radio compartilhado com a câmera) quando a origem é
// WAVE1/WAVE2. Atualiza o shadow (vivo/latch) e a marca de "vivo" (hb).
// -----------------------------------------------------------------------
void waveshares_espnow_on_recv(uint8_t origem, const uint8_t* data, int len) {
    const CabEspNow* cab = (const CabEspNow*)data;
    uint32_t agora = millis();

    if (cab->tipo == MSG_EVENTO && len >= (int)sizeof(MsgEvento)) {
        const MsgEvento* e = (const MsgEvento*)data;
        portENTER_CRITICAL(&g_iomux);
        if (origem == ORIGEM_WAVE1) { g_viv1 = e->di_vivo; g_lat1 |= (e->di_borda & PULSO_W1_MASK); g_hb1 = agora; }
        else                        { g_viv2 = e->di_vivo; g_lat2 |= (e->di_borda & PULSO_W2_MASK); g_hb2 = agora; }
        portEXIT_CRITICAL(&g_iomux);
    } else if (cab->tipo == MSG_HEARTBEAT && len >= (int)sizeof(MsgHeartbeat)) {
        const MsgHeartbeat* h = (const MsgHeartbeat*)data;
        portENTER_CRITICAL(&g_iomux);
        if (origem == ORIGEM_WAVE1) { g_viv1 = h->di_vivo; g_hb1 = agora; }
        else                        { g_viv2 = h->di_vivo; g_hb2 = agora; }
        portEXIT_CRITICAL(&g_iomux);
    }
    wave_alarme_tick();
}

// -----------------------------------------------------------------------
// Nudge de canal (caso comum: religamento normal, waveshare já tem o canal
// salvo na própria NVS e nem precisa disso) — tentativa ÚNICA e LIMITADA no
// boot: se uma waveshare não aparecer em poucos segundos, visita o canal 1
// (ponto de encontro de fábrica) por um instante, manda "use o canal X"
// algumas vezes, e volta pro canal normal — NUNCA fica esperando/varrendo
// sem limite (foi exatamente isso que travava tudo na versão antiga).
// A tela de pareamento manual (passo a passo, com confirmação visual por
// componente) fica para uma etapa seguinte — isso aqui só cobre o caso
// automático comum.
// -----------------------------------------------------------------------
static void ws_nudge_canal(const uint8_t* mac, uint8_t canal) {
    MsgCanal m;
    m.cab.tipo = MSG_CANAL; m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_ws_seq++;
    m.canal = canal;
    esp_now_send((uint8_t*)mac, (uint8_t*)&m, sizeof(m));
}

extern uint8_t g_canal_atual;   // definido em comm_espnow.h — canal em que o rádio está agora

void ws_nudge_boot_tick() {
    static bool feito = false;
    static uint32_t t0 = 0;
    if (feito) return;
    if (t0 == 0) t0 = millis();
    if (millis() - t0 < 5000) return;   // dá 5s pro caso comum (NVS já tinha o canal certo) se resolver sozinho
    feito = true;
    if (g_hb1 == 0 || g_hb2 == 0) {   // alguma waveshare nunca apareceu
        DBG_PRINTLN("[ESP-NOW] waveshare sem contato no boot -> tentativa unica de nudge pro canal 1");
        uint8_t canal_alvo = g_canal_atual;
        uint8_t canal_salvo = g_canal_atual;
        esp_wifi_set_promiscuous(true);
        esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
        esp_wifi_set_promiscuous(false);
        if (g_hb1 == 0) for (uint8_t i = 0; i < 5; i++) { ws_nudge_canal(MAC_WAVE1, canal_alvo); delay(100); }
        if (g_hb2 == 0) for (uint8_t i = 0; i < 5; i++) { ws_nudge_canal(MAC_WAVE2, canal_alvo); delay(100); }
        esp_wifi_set_promiscuous(true);
        esp_wifi_set_channel(canal_salvo, WIFI_SECOND_CHAN_NONE);
        esp_wifi_set_promiscuous(false);
    }
}

// -----------------------------------------------------------------------
// Inicialização — SÓ o inversor (Delta/SAJ continuam em RS-485, sozinhos no
// barramento). O rádio ESP-NOW (peers das waveshares incluídos) é
// inicializado em comm_espnow_init() (comm_espnow.h), que já roda logo
// depois no setup() — nome mantido por compatibilidade.
// -----------------------------------------------------------------------
void modbus_init() {
    vfd_rs485_init();   // UART1 -> só o inversor Delta/SAJ agora
    DBG_PRINTLN("[WAVESHARES] display pronto (ESP-NOW: W1/W2 — INV=RS-485 sozinho)");
}

// HARD RESET das saidas: manda OFF para os 8 canais das DUAS waveshares e
// zera o espelho local. Chamado no boot.
void comm_hard_reset_saidas() {
    for (uint8_t canal = 0; canal < 8; canal++) {
        ws_envia_comando(MAC_WAVE1, canal, 0); delay(5);
        ws_envia_comando(MAC_WAVE2, canal, 0); delay(5);
    }
    g_io1.do_ = 0; g_io2.do_ = 0;
    DBG_PRINTLN("[HARD RESET] saidas das waveshares em OFF");
}

// =======================================================================
// HOME — referenciamento (giro anti-horario ate X16 E X17, depois desloca
// até X12). SEM MUDANCA DE LOGICA — copiado da versao RS-485 (so o
// transporte dos io*_get_di/io*_set_do por baixo mudou).
// =======================================================================
#define HOME_FREQ_HZ10   400
#define HOME_TIMEOUT_MS  25000
#define HOME_TIMEOUT_DESLOC_MS 50000
#define HOME_X0_WD_MS    4000
#define HOME_DESAC_FLOOR  50
#define HOME_DESAC_MS   2000
#define HOME_X12_RAMPA_MS      350
#define HOME_X12_RAMPA_STEP_MS 100

enum { HOME_IDLE=0, HOME_FASE_GIRO, HOME_FASE_PARADA, HOME_FASE_DESLOC, HOME_FASE_X12_RAMPA, HOME_OK, HOME_FALHA };
static uint8_t     g_home_estado = HOME_IDLE;
static uint32_t    g_home_t0 = 0;
static const char* g_home_msg = "";
static uint32_t    g_home_x0_t   = 0;
static bool        g_home_x0_ant = false;
static uint32_t    g_home_x12_t0    = 0;
static uint32_t    g_home_x12_t_ramp= 0;

static inline bool home_sensor_giro() { return (g_io2.di >> 7) & 0x01; }
static inline bool home_sensor_x17()  { return (g_io2.di >> 6) & 0x01; }
static inline bool home_sensor_x11()  { return (g_io2.di >> 1) & 0x01; }
static inline bool home_sensor_x12()  { return (g_io2.di >> 2) & 0x01; }

bool        home_rodando()  { return g_home_estado==HOME_FASE_GIRO || g_home_estado==HOME_FASE_PARADA || g_home_estado==HOME_FASE_DESLOC || g_home_estado==HOME_FASE_X12_RAMPA; }
int         home_estado()   { return (int)g_home_estado; }
const char* home_mensagem() { return g_home_msg; }

static void home_parar_tudo() {
    vfd_stop(); io1_set_do(4,false); io2_set_do(4,false);
}
void home_reset() { home_parar_tudo(); g_home_estado = HOME_IDLE; g_home_msg = ""; }
static void home_iniciar_fase_desloc() {
    modbus_refresh_io2_di();
    if (home_sensor_x12()) { home_parar_tudo(); g_home_estado=HOME_OK; g_home_msg="HOME concluido"; return; }
    g_home_estado = HOME_FASE_DESLOC; g_home_t0 = millis(); g_home_msg = "HOME: recuando ate X12...";
    g_home_x0_t = millis(); g_home_x0_ant = io1_get_di(1);
    io2_set_do(4,true); vfd_run_rev(HOME_FREQ_HZ10);
}
void home_iniciar() {
    if (home_rodando()) { home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME cancelado"; return; }
    home_parar_tudo();
    modbus_refresh_io2_di();
    if (home_sensor_giro() && home_sensor_x17()) { home_iniciar_fase_desloc(); return; }
    g_home_estado = HOME_FASE_GIRO; g_home_t0 = millis(); g_home_msg = "HOME: buscando giro...";
    io1_set_do(4,true); vfd_run_rev(HOME_FREQ_HZ10);
}
void home_tick() {
    if (!home_rodando()) return;

    if (g_home_estado == HOME_FASE_GIRO) {
        bool desac=false; uint32_t t_desac=0, t_ramp=0;
        modbus_refresh_io2_di();
        for (;;) {
            modbus_refresh_io2_di();
            if (home_sensor_giro() && home_sensor_x17()) {
                vfd_stop(); io1_set_do(4,false);
                g_home_estado = HOME_FASE_PARADA; g_home_t0 = millis(); g_home_msg = "HOME: parando...";
                return;
            }
            if (!desac && home_sensor_x11()) { desac=true; t_desac=millis(); }
            if (desac) {
                uint32_t ag = millis();
                if (ag - t_ramp >= 120) {
                    t_ramp = ag; uint32_t dt = ag - t_desac;
                    uint16_t f = (dt >= HOME_DESAC_MS) ? HOME_DESAC_FLOOR
                        : (uint16_t)(HOME_FREQ_HZ10 - (uint32_t)(HOME_FREQ_HZ10 - HOME_DESAC_FLOOR)*dt/HOME_DESAC_MS);
                    vfd_run_rev(f);
                }
            }
            if (millis() - g_home_t0 > HOME_TIMEOUT_MS) {
                home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: giro nao achado"; return;
            }
            if (comm_perdida()) { home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: comunicacao"; return; }
            delay(10);
        }
    }

    static uint32_t t_le = 0;
    if (millis() - t_le < 30) return;
    t_le = millis();
    modbus_refresh_io2_di();
    if (g_home_estado == HOME_FASE_PARADA) {
        vfd_stop();
        if (millis() - g_home_t0 >= 1500) home_iniciar_fase_desloc();
    } else if (g_home_estado == HOME_FASE_DESLOC) {
        if (home_sensor_x12()) {
            g_home_estado = HOME_FASE_X12_RAMPA;
            g_home_x12_t0 = millis(); g_home_x12_t_ramp = 0;
            return;
        }

        modbus_refresh_io1_di();
        if (io1_get_di(4) || io1_get_di(5)) {
            home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME interrompido pelo painel"; return;
        }

        for (uint8_t k = 0; k < 5; k++) {
            bool x0 = io1_get_di(1);
            if (x0 != g_home_x0_ant) { g_home_x0_t = millis(); g_home_x0_ant = x0; }
            if (k < 4) modbus_refresh_io1_di();
        }
        if (millis() - g_home_x0_t > HOME_X0_WD_MS) {
            home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: carro travado (X0)"; return;
        }

        if (millis() - g_home_t0 > HOME_TIMEOUT_DESLOC_MS) { home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: X12 nao achado"; }
    } else if (g_home_estado == HOME_FASE_X12_RAMPA) {
        uint32_t dtr = millis() - g_home_x12_t0;
        if (dtr >= HOME_X12_RAMPA_MS) {
            vfd_stop(); io2_set_do(4,false);
            g_home_estado = HOME_OK; g_home_msg = "HOME concluido";
            return;
        }
        if (millis() - g_home_x12_t_ramp >= HOME_X12_RAMPA_STEP_MS) {
            g_home_x12_t_ramp = millis();
            uint16_t f = (uint16_t)(HOME_FREQ_HZ10 -
                (uint32_t)HOME_FREQ_HZ10 * dtr / HOME_X12_RAMPA_MS);
            if (f < 1) f = 1;
            vfd_run_rev(f);
        }
    }
}

// =======================================================================
// Deslocamento manual do carrinho (fim de curso X12/X13) — sem mudança.
// =======================================================================
enum DeslocDir { DESLOC_PARADO=0, DESLOC_FRENTE=1, DESLOC_TRAS=2 };
static DeslocDir g_desloc_dir = DESLOC_PARADO;
static inline bool desloc_lim_x12() { return (g_io2.di >> 2) & 0x01; }
static inline bool desloc_lim_x13() { return (g_io2.di >> 3) & 0x01; }
bool desloc_movendo() { return g_desloc_dir != DESLOC_PARADO; }
void desloc_parar() { g_desloc_dir=DESLOC_PARADO; vfd_stop(); io2_set_do(4,false); }
bool desloc_frente_iniciar(uint16_t f) { modbus_refresh_io2_di(); if (desloc_lim_x13()) return false; g_desloc_dir=DESLOC_FRENTE; io2_set_do(4,true); vfd_run_fwd(f); return true; }
bool desloc_tras_iniciar(uint16_t f)   { modbus_refresh_io2_di(); if (desloc_lim_x12()) return false; g_desloc_dir=DESLOC_TRAS;   io2_set_do(4,true); vfd_run_rev(f); return true; }
void desloc_tick() {
    if (g_desloc_dir == DESLOC_PARADO) return;
    static uint32_t t = 0;
    if (millis() - t < 30) return;
    t = millis();
    modbus_refresh_io2_di();
    if (g_desloc_dir==DESLOC_FRENTE && desloc_lim_x13()) desloc_parar();
    else if (g_desloc_dir==DESLOC_TRAS && desloc_lim_x12()) desloc_parar();
}

// modbus_tick(): poll do inversor (RS-485), suspenso durante home/processo —
// mesmo comportamento de antes.
void modbus_tick() {
    if (home_rodando()) return;
    if (g_estado_auto == AUTO_PROCESSO) return;
    vfd_poll();
}
