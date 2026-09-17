#pragma once
#include <Preferences.h>

// -----------------------------------------------------------------------
// Chaves NVS
// -----------------------------------------------------------------------
#define NVS_NS           "lavadora"
#define NVS_SENHA_PAG    "senha_pag"    // padrão "3462"
#define NVS_SENHA_CFG    "senha_cfg"    // padrão "1111"
#define NVS_MIG_SCFG     "mig_scfg1111" // flag da migracao unica da senha de config -> 1111
#define NVS_SALDO_ACUM   "saldo_acum"   // uint32 — total histórico pago
#define NVS_PROG1        "prog1"        // uint32 — lavagens prog1 desde acerto
#define NVS_PROG2        "prog2"
#define NVS_PROG3        "prog3"
#define NVS_PROG4        "prog4"
#define NVS_DATA_ACERTO  "data_acerto"  // string "DD/MM/AAAA"
#define NVS_HORAS_MANUAL "horas_manual" // float — horas acumuladas em modo manual
#define NVS_GIRO_DUR     "giro_dur"     // uint32 — TEMPORARIO: tempo de parada do giro (tuning ao vivo)
#define NVS_MIG_GIRO7500 "mig_giro7500" // flag da migracao unica do tempo de giro -> 7500
#define NVS_MIG_WIFI1    "mig_wifi1"    // flag da migracao unica das credenciais Wi-Fi fixas
#define NVS_GIRO_TO      "giro_to"      // uint32 — TEMPORARIO: timeout do giro (tuning ao vivo)
#define NVS_MODELOS      "modelos"      // blob — programacao das etapas por modelo
#define NVS_VELOCID      "velocid"      // blob — velocidades por programa/etapa

// Chaves NVS — Sistema de comunicação com backend (Pili Lave App)
// =======================================================================
// Wi-Fi
#define NVS_WIFI_SSID       "wifi_ssid"     // string — SSID da rede
#define NVS_WIFI_PASS       "wifi_pass"     // string — senha da rede
#define NVS_WIFI_CANAL      "wifi_canal"    // uint8  — canal salvo após conectar
// Backend
#define NVS_API_BASE        "api_base"      // string — URL base do backend
#define NVS_DEVICE_KEY      "device_key"    // string — chave única desta máquina
// Heartbeat / licença
#define NVS_LAST_HB_OK      "last_hb_ok"   // uint32 — timestamp Unix último heartbeat 200 OK
#define NVS_LIC_DAYS        "lic_days"      // uint16 — último daysWithoutPayment recebido
#define NVS_LIC_BLOCKED     "lic_blocked"   // uint8  — último blocked (0 ou 1)
// Dedup do ciclo iniciado pelo app
#define NVS_LAST_RES_ID     "last_res_id"   // string — último reservationId executado
// Fila de eventos (ring buffer 8 slots)
#define NVS_EVT_HEAD        "evt_head"      // uint8  — índice de escrita
#define NVS_EVT_TAIL        "evt_tail"      // uint8  — índice de leitura
#define NVS_EVT_0           "evt_0"         // string — slot 0
#define NVS_EVT_1           "evt_1"         // string — slot 1
#define NVS_EVT_2           "evt_2"         // string — slot 2
#define NVS_EVT_3           "evt_3"         // string — slot 3
#define NVS_EVT_4           "evt_4"         // string — slot 4
#define NVS_EVT_5           "evt_5"         // string — slot 5
#define NVS_EVT_6           "evt_6"         // string — slot 6
#define NVS_EVT_7           "evt_7"         // string — slot 7

static Preferences _nvs;

// -----------------------------------------------------------------------
// Inicializa NVS e grava valores padrão na primeira vez
// -----------------------------------------------------------------------
void nvs_init() {
    _nvs.begin(NVS_NS, false);

    if (!_nvs.isKey(NVS_SENHA_PAG))   _nvs.putString(NVS_SENHA_PAG, "3462");
    if (!_nvs.isKey(NVS_SENHA_CFG))   _nvs.putString(NVS_SENHA_CFG, "1111");

    // Migracao UNICA: forca a senha de configuracao para "1111" neste device uma
    // vez so (a chave ja existia com o valor antigo). O flag garante que futuras
    // alteracoes feitas na tela "Alterar Senhas" nao sejam sobrescritas a cada boot.
    if (!_nvs.isKey(NVS_MIG_SCFG)) {
        _nvs.putString(NVS_SENHA_CFG, "1111");
        _nvs.putBool(NVS_MIG_SCFG, true);
    }
    if (!_nvs.isKey(NVS_SALDO_ACUM))  _nvs.putUInt(NVS_SALDO_ACUM, 0);
    if (!_nvs.isKey(NVS_PROG1))       _nvs.putUInt(NVS_PROG1, 0);
    if (!_nvs.isKey(NVS_PROG2))       _nvs.putUInt(NVS_PROG2, 0);
    if (!_nvs.isKey(NVS_PROG3))       _nvs.putUInt(NVS_PROG3, 0);
    if (!_nvs.isKey(NVS_PROG4))       _nvs.putUInt(NVS_PROG4, 0);
    // Sem RTC/NTP no projeto ainda — data fica manual ate existir uma fonte
    // de hora confiavel (TODO: substituir por data real quando houver RTC).
    if (!_nvs.isKey(NVS_DATA_ACERTO)) _nvs.putString(NVS_DATA_ACERTO, "--/--/----");
    if (!_nvs.isKey(NVS_HORAS_MANUAL)) _nvs.putFloat(NVS_HORAS_MANUAL, 0.0f);
    if (!_nvs.isKey(NVS_GIRO_DUR))     _nvs.putUInt(NVS_GIRO_DUR, 7500);   // TEMPORARIO (tuning giro)

    // Migracao UNICA: reinicia o tempo de giro em 7500 neste reflash (a chave ja
    // existia com o valor do tuning anterior). Depois disso o botao volta a mandar.
    if (!_nvs.isKey(NVS_MIG_GIRO7500)) {
        _nvs.putUInt(NVS_GIRO_DUR, 7500);
        _nvs.putBool(NVS_MIG_GIRO7500, true);
    }
    if (!_nvs.isKey(NVS_GIRO_TO))      _nvs.putUInt(NVS_GIRO_TO, 10000);  // TEMPORARIO (tuning giro)

    // --- App / backend (inicializa só se ainda nao existir) ---
    if (!_nvs.isKey(NVS_WIFI_SSID))    _nvs.putString(NVS_WIFI_SSID,   "");
    if (!_nvs.isKey(NVS_WIFI_PASS))    _nvs.putString(NVS_WIFI_PASS,   "");
    if (!_nvs.isKey(NVS_WIFI_CANAL))   _nvs.putUChar(NVS_WIFI_CANAL,   1);    // canal padrão 1
    if (!_nvs.isKey(NVS_API_BASE))     _nvs.putString(NVS_API_BASE,    "");
    if (!_nvs.isKey(NVS_DEVICE_KEY))   _nvs.putString(NVS_DEVICE_KEY,  "");

    // Opção A: a máquina sai SEM rede. O display NÃO guarda/usa SSID próprio (quem
    // conecta é a câmera). As credenciais são configuradas na tela e enviadas pra
    // câmera. Por isso NÃO semeamos rede aqui.
    if (!_nvs.isKey(NVS_LAST_HB_OK))  ; // nao inicializar — ausencia = nunca conectou (trava 7 dias nao se aplica)
    if (!_nvs.isKey(NVS_LIC_DAYS))    _nvs.putUShort(NVS_LIC_DAYS,    0);
    if (!_nvs.isKey(NVS_LIC_BLOCKED)) _nvs.putUChar(NVS_LIC_BLOCKED,  0);
    if (!_nvs.isKey(NVS_LAST_RES_ID)) _nvs.putString(NVS_LAST_RES_ID, "");
    if (!_nvs.isKey(NVS_EVT_HEAD))    _nvs.putUChar(NVS_EVT_HEAD,     0);
    if (!_nvs.isKey(NVS_EVT_TAIL))    _nvs.putUChar(NVS_EVT_TAIL,     0);
}

static const char* _nvs_prog_key(int prog) {
    switch (prog) {
        case 1: return NVS_PROG1;
        case 2: return NVS_PROG2;
        case 3: return NVS_PROG3;
        case 4: return NVS_PROG4;
        default: return NVS_PROG1;
    }
}

// -----------------------------------------------------------------------
// Contadores por programa
// -----------------------------------------------------------------------
uint32_t nvs_get_prog(int prog) {
    return _nvs.getUInt(_nvs_prog_key(prog), 0);
}

void nvs_inc_prog(int prog) {
    _nvs.putUInt(_nvs_prog_key(prog), nvs_get_prog(prog) + 1);
}

// -----------------------------------------------------------------------
// Saldo acumulado / acerto de contas
// -----------------------------------------------------------------------
uint32_t nvs_get_saldo() {
    return _nvs.getUInt(NVS_SALDO_ACUM, 0);
}

String nvs_get_data_acerto() {
    return _nvs.getString(NVS_DATA_ACERTO, "--/--/----");
}

// Soma os contadores atuais no saldo historico, zera os contadores.
// TODO: gravar a data real do acerto quando o projeto tiver RTC/NTP —
// por enquanto a data de referencia nao e atualizada automaticamente.
void nvs_fazer_acerto() {
    uint32_t total = nvs_get_prog(1) + nvs_get_prog(2) + nvs_get_prog(3) + nvs_get_prog(4);
    _nvs.putUInt(NVS_SALDO_ACUM, nvs_get_saldo() + total);
    _nvs.putUInt(NVS_PROG1, 0);
    _nvs.putUInt(NVS_PROG2, 0);
    _nvs.putUInt(NVS_PROG3, 0);
    _nvs.putUInt(NVS_PROG4, 0);
}

// -----------------------------------------------------------------------
// Horas em modo manual
// -----------------------------------------------------------------------
float nvs_get_horas_manual() {
    return _nvs.getFloat(NVS_HORAS_MANUAL, 0.0f);
}

void nvs_set_horas_manual(float horas) {
    _nvs.putFloat(NVS_HORAS_MANUAL, horas);
}

// TEMPORARIO (tuning do giro): tempo de parada do giro, persistido p/ nao perder no
// power-cycle durante o ajuste. Remover junto com o botao quando o valor for fixado.
uint32_t nvs_get_giro_dur() {
    return _nvs.getUInt(NVS_GIRO_DUR, 7500);
}

void nvs_set_giro_dur(uint32_t ms) {
    _nvs.putUInt(NVS_GIRO_DUR, ms);
}

// TEMPORARIO (tuning): timeout do giro
uint32_t nvs_get_giro_to() {
    return _nvs.getUInt(NVS_GIRO_TO, 10000);
}

void nvs_set_giro_to(uint32_t ms) {
    _nvs.putUInt(NVS_GIRO_TO, ms);
}

// -----------------------------------------------------------------------
// Programacao dos processos (persistente): modelos (sequencia de etapas) e
// velocidades. Salvos como blob. Carregados no boot; se nao houver salvo,
// mantem os defaults do display.ino.
// -----------------------------------------------------------------------
void nvs_save_modelos(const void* buf, size_t len)     { _nvs.putBytes(NVS_MODELOS, buf, len); }
bool nvs_load_modelos(void* buf, size_t len)           { return _nvs.getBytes(NVS_MODELOS, buf, len) == len; }
void nvs_save_velocidades(const void* buf, size_t len) { _nvs.putBytes(NVS_VELOCID, buf, len); }
bool nvs_load_velocidades(void* buf, size_t len)       { return _nvs.getBytes(NVS_VELOCID, buf, len) == len; }

// -----------------------------------------------------------------------
// Senhas
// -----------------------------------------------------------------------
String nvs_get_senha_pag() {
    return _nvs.getString(NVS_SENHA_PAG, "3462");
}

String nvs_get_senha_cfg() {
    return _nvs.getString(NVS_SENHA_CFG, "1111");
}

void nvs_set_senha_pag(String s) {
    _nvs.putString(NVS_SENHA_PAG, s);
}

void nvs_set_senha_cfg(String s) {
    _nvs.putString(NVS_SENHA_CFG, s);
}

// NVS — Wi-Fi
// =======================================================================
String  nvs_get_wifi_ssid()              { return _nvs.getString(NVS_WIFI_SSID, ""); }
String  nvs_get_wifi_pass()              { return _nvs.getString(NVS_WIFI_PASS, ""); }
uint8_t nvs_get_wifi_canal()             { return _nvs.getUChar(NVS_WIFI_CANAL, 1); }
void    nvs_set_wifi_ssid(String s)      { _nvs.putString(NVS_WIFI_SSID, s); }
void    nvs_set_wifi_pass(String s)      { _nvs.putString(NVS_WIFI_PASS, s); }
void    nvs_set_wifi_canal(uint8_t c)    { _nvs.putUChar(NVS_WIFI_CANAL, c); }
// =======================================================================
// NVS — Backend
// =======================================================================
String nvs_get_api_base()                { return _nvs.getString(NVS_API_BASE, ""); }
String nvs_get_device_key()              { return _nvs.getString(NVS_DEVICE_KEY, ""); }
void   nvs_set_api_base(String s)        { _nvs.putString(NVS_API_BASE, s); }
void   nvs_set_device_key(String s)      { _nvs.putString(NVS_DEVICE_KEY, s); }
// =======================================================================
// NVS — Heartbeat / licença
// =======================================================================
bool     nvs_has_last_hb_ok()            { return _nvs.isKey(NVS_LAST_HB_OK); }
uint32_t nvs_get_last_hb_ok()            { return _nvs.getUInt(NVS_LAST_HB_OK, 0); }
void     nvs_set_last_hb_ok(uint32_t t)  { _nvs.putUInt(NVS_LAST_HB_OK, t); }
uint16_t nvs_get_lic_days()              { return _nvs.getUShort(NVS_LIC_DAYS, 0); }
uint8_t  nvs_get_lic_blocked()           { return _nvs.getUChar(NVS_LIC_BLOCKED, 0); }
void     nvs_set_lic_days(uint16_t d)    { _nvs.putUShort(NVS_LIC_DAYS, d); }
void     nvs_set_lic_blocked(uint8_t b)  { _nvs.putUChar(NVS_LIC_BLOCKED, b); }
// =======================================================================
// NVS — Dedup reservationId
// =======================================================================
String nvs_get_last_res_id()             { return _nvs.getString(NVS_LAST_RES_ID, ""); }
void   nvs_set_last_res_id(String s)     { _nvs.putString(NVS_LAST_RES_ID, s); }
// =======================================================================
// NVS — Fila de eventos (ring buffer 8 slots)
// =======================================================================
static const char* _nvs_evt_key(uint8_t idx) {
    static const char* keys[8] = {
        NVS_EVT_0, NVS_EVT_1, NVS_EVT_2, NVS_EVT_3,
        NVS_EVT_4, NVS_EVT_5, NVS_EVT_6, NVS_EVT_7
    };
    return keys[idx & 0x07];
}
uint8_t nvs_evt_head()                   { return _nvs.getUChar(NVS_EVT_HEAD, 0); }
uint8_t nvs_evt_tail()                   { return _nvs.getUChar(NVS_EVT_TAIL, 0); }
bool    nvs_evt_vazia()                  { return nvs_evt_head() == nvs_evt_tail(); }
bool    nvs_evt_cheia()                  { return ((nvs_evt_head() + 1) & 0x07) == nvs_evt_tail(); }
// Enfileira um evento JSON. Retorna false se a fila estiver cheia.
bool nvs_evt_push(const String& json) {
    uint8_t h = nvs_evt_head();
    uint8_t next = (h + 1) & 0x07;
    if (next == nvs_evt_tail()) return false;   // fila cheia
    _nvs.putString(_nvs_evt_key(h), json);
    _nvs.putUChar(NVS_EVT_HEAD, next);
    return true;
}
// Lê o próximo evento sem remover. Retorna "" se vazia.
String nvs_evt_peek() {
    if (nvs_evt_vazia()) return "";
    return _nvs.getString(_nvs_evt_key(nvs_evt_tail()), "");
}
// Remove o evento da cabeça da fila após envio bem-sucedido.
void nvs_evt_pop() {
    if (nvs_evt_vazia()) return;
    uint8_t t = nvs_evt_tail();
    _nvs.putString(_nvs_evt_key(t), "");
    _nvs.putUChar(NVS_EVT_TAIL, (t + 1) & 0x07);
}
