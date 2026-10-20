#pragma once
#include <esp_now.h>
#include "tipos.h"
#include "protocolo_w1.h"

// =======================================================================
// cliente_w1.h — SUBSTITUI maquina_estados.h/processos.h/comm_waveshares_espnow.h
// no display. A Waveshare 1 agora e a controladora (ciclo + RS-485 + IO) —
// este display vira "cliente": manda comando, recebe status, mostra na tela.
//
// Fornece os MESMOS NOMES que as telas (tela_auto.h/tela_manual.h) ja
// esperam (g_estado_auto, auto_iniciar/pausar/retomar/cancelar, io1_set_do/
// io2_set_do, vfd_run_fwd/rev/stop, desloc_*, home_iniciar, saj_set_freq,
// proc_estado, home_rodando/estado/mensagem, comm_perdida) — SEM precisar
// editar as telas: por baixo, cada chamada agora manda um pacote ESP-NOW
// pra Waveshare 1 em vez de tocar o hardware direto.
// =======================================================================

// ---- Espelho do status recebido da Waveshare 1 ----
EstadoAuto g_estado_auto = AUTO_IDLE;
uint8_t    g_processo_atual_idx = 0;   // nao usado no display (so a W1 sabe) — mantido por compat

static uint8_t  g_sub_estado_w1 = 0;
static uint8_t  g_io1_di_w1 = 0, g_io2_di_w1 = 0;
static uint8_t  g_io1_do_w1 = 0, g_io2_do_w1 = 0;
float    g_vfd_freq     = 0;
float    g_vfd_corrente = 0;
uint32_t g_vfd_write_falhas = 0;
static uint8_t  g_home_estado_w1 = 0;
static char     g_msg_alarme_buf[64] = "";
static uint32_t g_hb_w1 = 0;   // ultimo status recebido da W1 (p/ comm_perdida)

// Alarme — pode vir de um problema LOCAL do display (ex. "Camera sem
// contato") ou ser sobrescrito pelo proximo status da W1 (ciclo). Simples
// de proposito: os dois casos sao raros ao mesmo tempo.
void alarme_modbus(const char* msg) {
    g_estado.msg_alarme = msg;
    g_estado.alarme     = true;
}

// Macros que o resto do codigo (lampada_app.h/backend_client.h) ja espera —
// agora so encaminham pro io1_set_do/io2_set_do (RPC pra W1) definidos abaixo.
#define SET_Y11(v)       io1_set_do(8, v)   // lampada verde
#define SET_Y12(v)       io2_set_do(2, v)   // luz vermelha
#define SET_ASPIRADOR(v) io2_set_do(8, v)   // aspirador de po

// TEMPORARIO (tuning giro) — valores locais (UI + NVS no display), mandados
// pra W1 via MSG_CONFIG_PUSH sempre que mudam.
uint32_t g_giro_dur_ms     = 7500;
uint32_t g_giro_timeout_ms = 10000;

int  proc_estado() { return (int)g_sub_estado_w1; }
bool giro_dupla()  { return false; }   // diagnostico fino nao espelhado (baixa prioridade)
bool io1_get_di(uint8_t canal) { return (g_io1_di_w1 >> (canal-1)) & 1; }
bool io2_get_di(uint8_t canal) { return (g_io2_di_w1 >> (canal-1)) & 1; }

bool comm_perdida() { return (millis() - g_hb_w1) > COMM_TIMEOUT_MS * 3; }   // folga maior (rede + processamento)

// Recuperacao (auto-home no boot) agora roda inteira na W1 — aqui e so uma
// aproximacao razoavel pra UI local (lampada_app.h usa isso pra nao mexer
// na lampada enquanto a recuperacao estiver com o braco em movimento).
bool recuperacao_ativa() { return g_estado_auto == AUTO_HOMING; }

int  home_estado()   { return (int)g_home_estado_w1; }
bool home_rodando()  { return g_home_estado_w1 >= 1 && g_home_estado_w1 <= 4; }   // HOME_FASE_* = 1..4
const char* home_mensagem() {
    switch (g_home_estado_w1) {
        case 0: return "";
        case 1: return "HOME: buscando giro...";
        case 2: return "HOME: parando...";
        case 3: return "HOME: recuando ate X12...";
        case 4: return "HOME: freando...";
        case 5: return "HOME concluido";
        case 6: return "HOME FALHOU";
        default: return "";
    }
}

// ---- Envio de comandos pra Waveshare 1 ----
static uint8_t g_seq_w1 = 0;
static inline void w1_send(const void* msg, size_t len) {
    esp_now_send((uint8_t*)MAC_WAVE1, (uint8_t*)msg, len);
}

static void auto_cmd(uint8_t acao, uint8_t programa = 0) {
    MsgAutoCmd m; m.cab.tipo=MSG_AUTO_CMD; m.cab.id_maquina=ID_MAQUINA; m.cab.origem=ORIGEM_DISPLAY; m.cab.seq=g_seq_w1++;
    m.acao = acao; m.programa = programa;
    w1_send(&m, sizeof(m));
}
void auto_iniciar(uint8_t modelo) { auto_cmd(0, modelo); }
void auto_pausar()                { auto_cmd(1); }
void auto_retomar()               { auto_cmd(2); }
void auto_cancelar()              { auto_cmd(3); }
void auto_limpar_erro()           { auto_cmd(4); }

static void rc_io(uint8_t alvo, uint8_t canal, bool estado) {
    MsgRcIo m; m.cab.tipo=MSG_RC_IO; m.cab.id_maquina=ID_MAQUINA; m.cab.origem=ORIGEM_DISPLAY; m.cab.seq=g_seq_w1++;
    m.alvo = alvo; m.canal = canal; m.estado = estado ? 1 : 0;
    w1_send(&m, sizeof(m));
}
void io1_set_do(uint8_t canal, bool estado) { rc_io(1, canal, estado); }
void io2_set_do(uint8_t canal, bool estado) { rc_io(2, canal, estado); }

static void rc_vfd(uint8_t acao, uint16_t freq_hz10 = 0) {
    MsgRcVfd m; m.cab.tipo=MSG_RC_VFD; m.cab.id_maquina=ID_MAQUINA; m.cab.origem=ORIGEM_DISPLAY; m.cab.seq=g_seq_w1++;
    m.acao = acao; m.freq_hz10 = freq_hz10;
    w1_send(&m, sizeof(m));
}
void vfd_run_fwd(uint16_t freq_hz10) { rc_vfd(1, freq_hz10); }
void vfd_run_rev(uint16_t freq_hz10) { rc_vfd(2, freq_hz10); }
void vfd_stop()                      { rc_vfd(0); }

static void rc_desloc(uint8_t acao, uint16_t freq_hz10 = 0) {
    MsgRcDesloc m; m.cab.tipo=MSG_RC_DESLOC; m.cab.id_maquina=ID_MAQUINA; m.cab.origem=ORIGEM_DISPLAY; m.cab.seq=g_seq_w1++;
    m.acao = acao; m.freq_hz10 = freq_hz10;
    w1_send(&m, sizeof(m));
}
bool desloc_frente_iniciar(uint16_t f) { rc_desloc(1, f); return true; }
bool desloc_tras_iniciar(uint16_t f)   { rc_desloc(2, f); return true; }
void desloc_parar()                    { rc_desloc(0); }

void home_iniciar() {
    MsgRcHome m; m.cab.tipo=MSG_RC_HOME; m.cab.id_maquina=ID_MAQUINA; m.cab.origem=ORIGEM_DISPLAY; m.cab.seq=g_seq_w1++;
    w1_send(&m, sizeof(m));
}
void saj_set_freq(float freq_hz) {
    MsgRcSaj m; m.cab.tipo=MSG_RC_SAJ; m.cab.id_maquina=ID_MAQUINA; m.cab.origem=ORIGEM_DISPLAY; m.cab.seq=g_seq_w1++;
    m.freq_hz = freq_hz;
    w1_send(&m, sizeof(m));
}

// ---- Push de configuracao (velocidades/modelos/atrasos) — chamar sempre
// que o tecnico salvar algo nessas telas. ----
void w1_push_config() {
    MsgConfigPush m;
    m.cab.tipo=MSG_CONFIG_PUSH; m.cab.id_maquina=ID_MAQUINA; m.cab.origem=ORIGEM_DISPLAY; m.cab.seq=g_seq_w1++;
    memcpy(m.velocidades, g_velocidades, sizeof(g_velocidades));
    memcpy(m.modelos, g_modelos, sizeof(g_modelos));
    m.atraso_init = g_config.atraso_init; m.tempo_espuma_a = g_config.tempo_espuma_a;
    m.tempo_espuma_b = g_config.tempo_espuma_b; m.tempo_cor_magica = g_config.tempo_cor_magica;
    m.dist_compensacao = g_config.dist_compensacao; m.sobrecarga_main = g_config.sobrecarga_main;
    m.sobrecarga_rotacao = g_config.sobrecarga_rotacao; m.tempo_sobrecarga = g_config.tempo_sobrecarga;
    m.atraso_espuma_a = g_config.atraso_espuma_a; m.atraso_espuma_b = g_config.atraso_espuma_b;
    m.atraso_cor_magica = g_config.atraso_cor_magica; m.atraso_secagem = g_config.atraso_secagem;
    m.giro_dur_ms = g_giro_dur_ms; m.giro_timeout_ms = g_giro_timeout_ms;
    w1_send(&m, sizeof(m));
}

// ---- Eventos de nuvem — detectados pela TRANSICAO de estado (a W1 so avisa
// o estado atual; quem decide o que fazer com cada transicao, inclusive a
// distincao app/remoto via reservationId, continua sendo o display). ----
void backend_evt_car_entered();
void backend_evt_wash_complete(uint8_t programId, const String& source);
void backend_evt_fault(const char* errorCode);
String nvs_get_last_res_id();
void   nvs_inc_prog_app(int prog);
void   nvs_inc_prog_pres(int prog);
void   nvs_inc_prog(int prog);

static void w1_detectar_transicao(EstadoAuto antigo, EstadoAuto novo) {
    if (antigo == novo) return;
    if (novo == AUTO_CARRO_ENTRANDO) {
        backend_evt_car_entered();
    } else if (novo == AUTO_CONCLUIDO) {
        String resId = nvs_get_last_res_id();
        bool veio_do_app = resId.length() > 0;
        backend_evt_wash_complete(g_estado.programa_sel, veio_do_app ? "" : "remote");
        if (veio_do_app) nvs_inc_prog_app(g_estado.programa_sel);
        else              nvs_inc_prog_pres(g_estado.programa_sel);
        nvs_inc_prog(g_estado.programa_sel);
    } else if (novo == AUTO_ERRO) {
        backend_evt_fault(g_msg_alarme_buf);
    }
}

// ---- Recepcao do status (chamado pelo espnow_on_recv do comm_espnow.h) ----
void w1_status_on_recv(const uint8_t* data, int len) {
    if (len < (int)sizeof(MsgStatus)) return;
    const MsgStatus* s = (const MsgStatus*)data;
    g_hb_w1 = millis();
    EstadoAuto estado_antigo = g_estado_auto;
    g_estado_auto            = (EstadoAuto)s->estado_auto;
    g_estado.processo_ativo  = (Processo)s->processo_ativo;
    g_sub_estado_w1          = s->sub_estado;
    g_estado.programa_sel    = s->programa_sel;
    // g_estado.modo_auto NAO e sobrescrito aqui — e conceito de TELA (o que o
    // operador esta vendo), local ao display, nao do ciclo fisico na W1.
    g_estado.em_pausa        = s->em_pausa != 0;
    g_estado.alarme          = s->alarme != 0;
    strncpy(g_msg_alarme_buf, s->msg_alarme, sizeof(g_msg_alarme_buf)-1);
    g_msg_alarme_buf[sizeof(g_msg_alarme_buf)-1] = '\0';
    g_estado.msg_alarme = g_msg_alarme_buf;
    g_io1_di_w1 = s->io1_di; g_io2_di_w1 = s->io2_di;
    g_io1_do_w1 = s->io1_do; g_io2_do_w1 = s->io2_do;
    g_vfd_freq = s->vfd_freq_x100 / 100.0f;
    g_vfd_corrente = s->vfd_corrente_x10 / 10.0f;
    g_home_estado_w1 = s->home_estado;
    g_vfd_write_falhas = s->vfd_falhas;

    w1_detectar_transicao(estado_antigo, g_estado_auto);
}
