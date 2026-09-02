#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "tipos.h"
#include "vfd_rs485.h"      // o inversor continua em RS-485

// =======================================================================
// comm_espnow.h — Display <-> Waveshares por ESP-NOW (substitui o Modbus das WS).
// Fornece a MESMA interface de antes (io1_get_di/io2_get_di/io1_set_do/
// io2_set_do/modbus_refresh_io*_di/home/desloc), so muda o transporte.
//
// SENSORES:
//   Nivel (heartbeat/evento): X10,X12,X13,X14,X15,X16(HOME_GIRO)
//   Pulso (evento na ISR + LATCH no display): X0,X7 (W1) · X11,X17 (W2)
// A leitura io*_get_di devolve (vivo | latch); o modbus_refresh_io*_di consome
// o latch (mesma semantica do antigo vivo|latch + ACK).
// =======================================================================

typedef struct { uint8_t di; uint8_t do_; } EstadoIO;
EstadoIO g_io1 = {0,0};    // g_ioX.di = snapshot consumido ; do_ = estado desejado
EstadoIO g_io2 = {0,0};

// Shadow atualizado pelo callback ESP-NOW (outra task) — protegido por spinlock.
static volatile uint8_t  g_viv1=0, g_viv2=0;   // ultimo estado AO VIVO (heartbeat/evento)
static volatile uint8_t  g_lat1=0, g_lat2=0;   // pulsos ACUMULADOS (eventos), consumidos no refresh
static volatile uint8_t  g_do1_eco=0, g_do2_eco=0;
static volatile uint32_t g_hb1=0, g_hb2=0;     // millis do ultimo pacote de cada waveshare
static portMUX_TYPE      g_iomux = portMUX_INITIALIZER_UNLOCKED;
static uint8_t           g_seq = 0;

// Alarme na tela (msg deve ser string literal — g_estado guarda so o ponteiro).
void alarme_modbus(const char* msg) {
    g_estado.msg_alarme = msg;
    g_estado.alarme     = true;
}

// -----------------------------------------------------------------------
// Callback de recepcao — filtra por ID_MAQUINA e atualiza o shadow
// -----------------------------------------------------------------------
// Bloco 2A: handler das mensagens da camera — definido em wifi_manager.h (incluido
// depois no display.ino). Forward-decl p/ o roteamento abaixo enxergar a funcao.
bool wifi_espnow_handle(const uint8_t* mac, const uint8_t* data, int len);
bool backend_espnow_handle(const uint8_t* mac, const uint8_t* data, int len);  // MSG_HB_RESP (câmera)
bool espnow_pode_varrer();   // definida adiante (máquina ociosa? p/ o hunt de canal)

static volatile uint8_t  g_canal_novo   = 0;   // Opção A: canal pedido pela câmera (aplica no loop)
static volatile uint32_t g_cam_last_ms  = 0;   // última vez que ouvimos a câmera (p/ o hunt)
static uint8_t           g_canal_atual  = ESPNOW_CANAL;  // canal em que o rádio está agora

static void espnow_on_recv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
    if (info->src_addr[3] != ID_MAQUINA) return;        // isola maquinas vizinhas
    if (len < (int)sizeof(CabEspNow)) return;
    const CabEspNow* cab = (const CabEspNow*)data;
    if (cab->id_maquina != ID_MAQUINA) return;
    // Bloco 2A: pedido de credenciais da camera (MSG_WIFI_REQ) -> wifi_manager responde
    if (cab->tipo == MSG_WIFI_REQ) { wifi_espnow_handle(info->src_addr, data, len); return; }
    // Resposta do backend repassada pela camera (MSG_HB_RESP / MSG_EVT_ACK) -> backend_client aplica
    if (cab->tipo == MSG_HB_RESP || cab->tipo == MSG_EVT_ACK) {
        g_cam_last_ms = millis(); backend_espnow_handle(info->src_addr, data, len); return;
    }
    // Opção A: a CÂMERA é a mestre de canal. MSG_CANAL avisa o canal do roteador ->
    // o display SEGUE (troca o canal do rádio, aplicado no loop via comm_espnow_canal_tick).
    if (cab->tipo == MSG_CANAL && len >= (int)sizeof(CabEspNow) + 1) {
        uint8_t canal = data[sizeof(CabEspNow)];   // MsgCanal = {CabEspNow; uint8_t canal;}
        if (canal >= 1 && canal <= 13) g_canal_novo = canal;
        g_cam_last_ms = millis();                  // ouvimos a câmera -> sai do hunt
        return;
    }
    uint8_t org = cab->origem;
    uint32_t agora = millis();

    if (cab->tipo == MSG_EVENTO && len >= (int)sizeof(MsgEvento)) {
        const MsgEvento* e = (const MsgEvento*)data;
        portENTER_CRITICAL(&g_iomux);
        if (org == ORIGEM_WAVE1) { g_viv1 = e->di_vivo; g_lat1 |= (e->di_borda & PULSO_W1_MASK); g_hb1 = agora; }
        else if (org == ORIGEM_WAVE2) { g_viv2 = e->di_vivo; g_lat2 |= (e->di_borda & PULSO_W2_MASK); g_hb2 = agora; }
        portEXIT_CRITICAL(&g_iomux);
    } else if (cab->tipo == MSG_HEARTBEAT && len >= (int)sizeof(MsgHeartbeat)) {
        const MsgHeartbeat* h = (const MsgHeartbeat*)data;
        portENTER_CRITICAL(&g_iomux);
        if (org == ORIGEM_WAVE1) { g_viv1 = h->di_vivo; g_do1_eco = h->do_estado; g_hb1 = agora; }
        else if (org == ORIGEM_WAVE2) { g_viv2 = h->di_vivo; g_do2_eco = h->do_estado; g_hb2 = agora; }
        portEXIT_CRITICAL(&g_iomux);
    }
}

// -----------------------------------------------------------------------
// Leitura das entradas (consome o latch dos pulsos, igual ao ACK antigo)
// -----------------------------------------------------------------------
// g_pulsoN = latch (PULSO fresco) consumido no ultimo refresh. Serve p/ decisoes
// que dependem da TRAVESSIA do sensor (nao do nivel): ex. a parada do giro no X17
// (o braco PARADO sobre o X17 e nivel; a travessia em movimento e pulso).
static uint8_t g_pulso1 = 0, g_pulso2 = 0;

void modbus_refresh_io1_di() {
    portENTER_CRITICAL(&g_iomux);
    g_pulso1 = g_lat1;            // pulsos frescos desde o ultimo refresh
    g_io1.di = g_viv1 | g_lat1;   // leitura combinada = vivo|latch
    g_lat1 = 0;                   // consome os pulsos
    portEXIT_CRITICAL(&g_iomux);
}
void modbus_refresh_io2_di() {
    portENTER_CRITICAL(&g_iomux);
    g_pulso2 = g_lat2;
    g_io2.di = g_viv2 | g_lat2;
    g_lat2 = 0;
    portEXIT_CRITICAL(&g_iomux);
}
// PULSO PURO (so a travessia do sensor, ignora o nivel). Chamar apos o refresh.
bool io1_pulso(uint8_t canal) { return (g_pulso1 >> (canal-1)) & 0x01; }
bool io2_pulso(uint8_t canal) { return (g_pulso2 >> (canal-1)) & 0x01; }

// NIVEL: le o shadow AO VIVO (g_vivN, sempre fresco via evento/heartbeat) -> nao
//        depende de refresh em cada estado (era isso que perdia o X14/X15).
// PULSO: le o snapshot CONSUMIDO (g_ioX.di) -> a passagem rapida fica retida ate
//        o modbus_refresh consumir o latch (semantica do giro/home/carrinho).
bool io1_get_di(uint8_t canal) {
    uint8_t bit = 1 << (canal-1);
    if (bit & PULSO_W1_MASK) return (g_io1.di & bit) != 0;   // X0, X7
    return (g_viv1 & bit) != 0;                              // nivel/botoes ao vivo
}
bool io2_get_di(uint8_t canal) {
    uint8_t bit = 1 << (canal-1);
    if (bit & PULSO_W2_MASK) return (g_io2.di & bit) != 0;   // X11, X17
    return (g_viv2 & bit) != 0;                              // nivel ao vivo (X10,X12,X13,X14,X15,X16)
}

// -----------------------------------------------------------------------
// Saidas — envia comando ESP-NOW (ACK de hardware na camada MAC). Trava Y4<->Y14.
// -----------------------------------------------------------------------
static void espnow_envia_comando(const uint8_t* mac, uint8_t canal, uint8_t estado) {
    MsgComando m;
    m.cab.tipo = MSG_COMANDO; m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_seq++;
    m.canal = canal; m.estado = estado;
    esp_now_send((uint8_t*)mac, (uint8_t*)&m, sizeof(m));
}

void io1_set_do(uint8_t canal, bool estado) {
    if (canal < 1 || canal > 8) return;
    if (canal == 4 && estado && (g_io2.do_ & (1 << 3))) {   // trava: Y14 ativo -> nao liga Y4
        alarme_modbus("[SEGURANCA] deslocamento ativo ao ligar giro"); return;
    }
    // Intertravamento Y7 (bomba de espuma "cima"): so liga se houver algum
    // solenoide de espuma/cera ligado — Y2 (Espuma A), Y3 (Espuma B) ou Y10
    // (Cera de agua). Bloqueia o sintoma do Y7 ligar sozinho na transicao de
    // processos. Por isso os processos/manual ligam o solenoide ANTES do Y7.
    if (canal == 7 && estado &&
        !((g_io1.do_ & (1 << 1)) || (g_io1.do_ & (1 << 2)) || (g_io2.do_ & (1 << 0)))) {
        Serial.println("[SEGURANCA] Y7 bloqueado: nenhum solenoide de espuma/cera (Y2/Y3/Y10) ligado");
        return;
    }
    espnow_envia_comando(MAC_WAVE1, canal - 1, estado ? 1 : 0);
    if (estado) g_io1.do_ |=  (1 << (canal-1));
    else        g_io1.do_ &= ~(1 << (canal-1));
}
void io2_set_do(uint8_t canal, bool estado) {
    if (canal < 1 || canal > 8) return;
    if (canal == 4 && estado && (g_io1.do_ & (1 << 3))) {   // trava: Y4 ativo -> nao liga Y14
        alarme_modbus("[SEGURANCA] giro ativo ao ligar deslocamento"); return;
    }
    espnow_envia_comando(MAC_WAVE2, canal - 1, estado ? 1 : 0);
    if (estado) g_io2.do_ |=  (1 << (canal-1));
    else        g_io2.do_ &= ~(1 << (canal-1));
}

// -----------------------------------------------------------------------
// Watchdog de comunicacao
// -----------------------------------------------------------------------
bool comm_perdida() {
    uint32_t now = millis();
    return (now - g_hb1 > COMM_TIMEOUT_MS) || (now - g_hb2 > COMM_TIMEOUT_MS);
}

// modbus_tick() vira: poll do inversor (RS-485) fora do processo/home.
void modbus_tick();   // fwd (usa home_rodando/g_estado_auto)

// =======================================================================
// HOME — referenciamento (giro anti-horario ate X16 E X17, depois desloca até X12)
//   Desacelera pelo X11 (rampa 15->5Hz). Termina só quando X16 E X17 juntos.
// =======================================================================
#define HOME_FREQ_HZ10   150
#define HOME_TIMEOUT_MS  25000
#define HOME_TIMEOUT_DESLOC_MS 50000  // fase de recuo ate X12: DOBRO do timeout geral (o recuo pode ser mais longo)
#define HOME_X0_WD_MS    4000  // watchdog do X0 no recuo ate X12: se nao pulsar por esse tempo -> carro travado
#define HOME_DESAC_FLOOR  50    // 5.0 Hz
#define HOME_DESAC_MS   2000

enum { HOME_IDLE=0, HOME_FASE_GIRO, HOME_FASE_PARADA, HOME_FASE_DESLOC, HOME_OK, HOME_FALHA };
static uint8_t     g_home_estado = HOME_IDLE;
static uint32_t    g_home_t0 = 0;
static const char* g_home_msg = "";
static uint32_t    g_home_x0_t   = 0;      // ultimo instante em que o X0 pulsou no recuo ate X12
static bool        g_home_x0_ant = false;

static inline bool home_sensor_giro() { return (g_io2.di >> 7) & 0x01; }  // X16 (HOME_GIRO)
static inline bool home_sensor_x17()  { return (g_io2.di >> 6) & 0x01; }  // X17
static inline bool home_sensor_x11()  { return (g_io2.di >> 1) & 0x01; }  // X11 (pulso)
static inline bool home_sensor_x12()  { return (g_io2.di >> 2) & 0x01; }  // X12

bool        home_rodando()  { return g_home_estado==HOME_FASE_GIRO || g_home_estado==HOME_FASE_PARADA || g_home_estado==HOME_FASE_DESLOC; }
int         home_estado()   { return (int)g_home_estado; }
const char* home_mensagem() { return g_home_msg; }

static void home_parar_tudo() {
    vfd_stop(); io1_set_do(4,false); io2_set_do(4,false);
}
// Para o home e volta ao estado ocioso (usado pela recuperacao de boot p/ abortar).
void home_reset() { home_parar_tudo(); g_home_estado = HOME_IDLE; g_home_msg = ""; }
static void home_iniciar_fase_desloc() {
    modbus_refresh_io2_di();
    if (home_sensor_x12()) { home_parar_tudo(); g_home_estado=HOME_OK; g_home_msg="HOME concluido"; return; }
    g_home_estado = HOME_FASE_DESLOC; g_home_t0 = millis(); g_home_msg = "HOME: recuando ate X12...";
    g_home_x0_t = millis(); g_home_x0_ant = io1_get_di(1);   // arma o watchdog do X0 no recuo
    io2_set_do(4,true); vfd_run_rev(HOME_FREQ_HZ10);
}
void home_iniciar() {
    if (home_rodando()) { home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME cancelado"; return; }
    home_parar_tudo();
    modbus_refresh_io2_di();
    if (home_sensor_giro() && home_sensor_x17()) { home_iniciar_fase_desloc(); return; }  // ja no home
    g_home_estado = HOME_FASE_GIRO; g_home_t0 = millis(); g_home_msg = "HOME: buscando giro...";
    io1_set_do(4,true); vfd_run_rev(HOME_FREQ_HZ10);   // anti-horario
}
void home_tick() {
    if (!home_rodando()) return;

    // FASE_GIRO: laco dedicado. Desacelera no X11 e PARA só quando X16 E X17 juntos.
    if (g_home_estado == HOME_FASE_GIRO) {
        bool desac=false; uint32_t t_desac=0, t_ramp=0;
        modbus_refresh_io2_di();   // consome latch ANTIGO do X11 (pulso) — senao um
                                   // pulso velho dispara a rampa cedo e o braco rasteja
                                   // a 5Hz o caminho todo em vez de rampar perto do home
        for (;;) {
            modbus_refresh_io2_di();
            if (home_sensor_giro() && home_sensor_x17()) {   // X16 E X17 -> chegou no home
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
                    Serial.printf("[RAMPA-HOME] dt=%u f=%u\n", (unsigned)dt, (unsigned)f);  // TEMP debug rampa home
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
        // Condicoes de parada do recuo ate o X12:
        //   1) chegou no X12 (sucesso)
        //   2) painel interrompeu (X3 cancelar OU X4 pausa)
        //   3) X0 parou de pulsar por HOME_X0_WD_MS -> carro travado
        //   4) timeout geral (failsafe, X12 nao achado)
        if (home_sensor_x12()) { vfd_stop(); io2_set_do(4,false); g_home_estado=HOME_OK; g_home_msg="HOME concluido"; return; }

        // 2) painel: X3 (cancelar) ou X4 (pausa) interrompem o HOME
        modbus_refresh_io1_di();
        if (io1_get_di(4) || io1_get_di(5)) {
            home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME interrompido pelo painel"; return;
        }

        // 3) watchdog do X0: exige o carro pulsando enquanto recua (oversample igual ao carr_fwd)
        for (uint8_t k = 0; k < 5; k++) {
            bool x0 = io1_get_di(1);
            if (x0 != g_home_x0_ant) { g_home_x0_t = millis(); g_home_x0_ant = x0; }
            if (k < 4) modbus_refresh_io1_di();
        }
        if (millis() - g_home_x0_t > HOME_X0_WD_MS) {
            home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: carro travado (X0)"; return;
        }

        // 4) failsafe por tempo
        if (millis() - g_home_t0 > HOME_TIMEOUT_DESLOC_MS) { home_parar_tudo(); g_home_estado=HOME_FALHA; g_home_msg="HOME FALHOU: X12 nao achado"; }
    }
}

// =======================================================================
// Deslocamento manual do carrinho (fim de curso X12/X13)
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

// -----------------------------------------------------------------------
// Poll do inversor (RS-485), suspenso durante home/processo
// -----------------------------------------------------------------------
extern EstadoAuto g_estado_auto;
void modbus_tick() {
    if (home_rodando()) return;
    if (g_estado_auto == AUTO_PROCESSO) return;
    vfd_poll();
}

// Opção A: segue o canal da CÂMERA. Chamar no loop(). Faz duas coisas:
//  1) aplica a troca de canal pedida (MSG_CANAL);
//  2) se ficou SEM ouvir a câmera por muito tempo E a máquina está ociosa, VARRE
//     os canais 1-13 (hunt) até captar o anúncio da câmera e travar no canal certo.
#define CANAL_HUNT_TIMEOUT_MS  10000   // 10s sem câmera -> entra em varredura
#define CANAL_HUNT_DWELL_MS     1500   // tempo em cada canal (> intervalo de anúncio da câmera)
void comm_espnow_canal_tick() {
    // (1) aplica canal anunciado pela câmera — SÓ se mudou de verdade (evita
    //     re-setar o rádio a cada anúncio de 1s, sem log repetido nem micro-glitch).
    if (g_canal_novo) {
        uint8_t ch = g_canal_novo; g_canal_novo = 0;
        if (ch != g_canal_atual) {
            esp_wifi_set_promiscuous(true);
            esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
            esp_wifi_set_promiscuous(false);
            g_canal_atual = ch;
            Serial.printf("[ESP-NOW] display travou no canal %d (camera)\n", ch);
        }
        return;
    }
    // (2) hunt: perdeu a câmera e está ocioso -> varre 1-13 até achar
    if (millis() - g_cam_last_ms > CANAL_HUNT_TIMEOUT_MS && espnow_pode_varrer()) {
        static uint32_t t_hop = 0;
        if (millis() - t_hop >= CANAL_HUNT_DWELL_MS) {
            t_hop = millis();
            g_canal_atual = (uint8_t)((g_canal_atual % 13) + 1);   // 1..13 cíclico
            esp_wifi_set_promiscuous(true);
            esp_wifi_set_channel(g_canal_atual, WIFI_SECOND_CHAN_NONE);
            esp_wifi_set_promiscuous(false);
            Serial.printf("[ESP-NOW] HUNT canal %d (procurando camera)\n", g_canal_atual);
        }
    }
}
// -----------------------------------------------------------------------
// Inicializacao ESP-NOW (WiFi STA, MAC logico, canal fixo, PMK/LMK, peers)
// -----------------------------------------------------------------------
void comm_espnow_init() {
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    esp_wifi_set_mac(WIFI_IF_STA, (uint8_t*)MAC_DISPLAY);         // MAC logico ANTES do esp_now_init
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(ESPNOW_CANAL, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    if (esp_now_init() != ESP_OK) { Serial.println("[ESP-NOW] init FALHOU"); return; }
    esp_now_set_pmk(ESPNOW_PMK);
    esp_now_register_recv_cb(espnow_on_recv);

    esp_now_peer_info_t p = {};
    p.channel = 0; p.ifidx = WIFI_IF_STA; p.encrypt = true;   // canal 0 = segue o rádio (sync WiFi)
    memcpy(p.lmk, ESPNOW_LMK, 16);
    memcpy(p.peer_addr, MAC_WAVE1, 6); esp_now_add_peer(&p);
    memcpy(p.peer_addr, MAC_WAVE2, 6); esp_now_add_peer(&p);
    Serial.println("[ESP-NOW] display pronto");
}

// Compat: nome antigo usado no display.ino / setup. Inicia os DOIS transportes:
// ESP-NOW (waveshares) + RS-485 (inversor Delta).
void modbus_init() {
    vfd_rs485_init();     // UART1 -> inversor
    comm_espnow_init();   // WiFi/ESP-NOW -> waveshares
}
