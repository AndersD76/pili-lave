#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include "nvs_manager.h"
#include "wifi_manager.h"
#include "tipos.h"
// =======================================================================
// backend_client.h — Heartbeat + fila NVS de eventos
//
// REGRAS:
//   1. Heartbeat a cada 10s — sempre, independente do estado da máquina.
//   2. Resposta traz: lightState, start (opcional), license.
//   3. Fila NVS: car-entered, wash-complete, fault — reenvio até 200 OK.
//   4. Um evento por ciclo de heartbeat (não sobrecarrega).
//   5. Nunca bloqueia o loop — timeout HTTP de 8s máximo.
// =======================================================================
#define HB_INTERVAL_MS       10000   // heartbeat a cada 10s
#define HB_FAILSAFE_MS       60000   // 60s sem OK -> lâmpada OFF
#define HTTP_TIMEOUT_MS       8000   // timeout de cada request HTTP
// Estados da lâmpada (espelha o lightState do backend)
typedef enum {
    LAMP_OFF = 0,
    LAMP_GREEN_SOLID,
    LAMP_GREEN_BLINK,
    LAMP_RED_SOLID,
    LAMP_RED_BLINK,
    LAMP_RED_GREEN_ALT,
} LampState;
// Resultado do heartbeat (preenchido a cada ciclo bem-sucedido)
struct StartCmd {
    bool    valido      = false;
    String  reservationId;
    uint8_t programId   = 0;   // 1-4
    uint32_t duracaoSeg = 0;
};
// Estado global do backend (lido por licenca.h e lampada_app.h)
static LampState g_lamp_state        = LAMP_OFF;
static StartCmd  g_start_cmd;
static uint32_t  g_hb_last_ok        = 0;   // millis() do último 200 OK
static bool      g_backend_ok        = false;
// -----------------------------------------------------------------------
// Monta o estado atual da máquina para enviar no heartbeat
// -----------------------------------------------------------------------
static String _backend_estado_str() {
    switch (g_estado_auto) {
        case AUTO_IDLE:
        case AUTO_AGUARDA_CARRO:
        case AUTO_AGUARDA_POS:
        case AUTO_INICIANDO:
        case AUTO_CONCLUIDO:
        case AUTO_ERRO:         return "FREE";
        case AUTO_PROCESSO:
        case AUTO_CARRO_ENTRANDO:
        case AUTO_PAUSADO:      return "WASHING";
        case AUTO_HOMING:       return "FREE";
        default:                return "FREE";
    }
}
static uint32_t _backend_restante_seg() {
    // Retorna 0 por enquanto — pode ser expandido com duração real
    return 0;
}
// -----------------------------------------------------------------------
// Parse do lightState vindo do backend
// -----------------------------------------------------------------------
static LampState _parse_light(const String& s) {
    if (s == "GREEN_SOLID")   return LAMP_GREEN_SOLID;
    if (s == "GREEN_BLINK")   return LAMP_GREEN_BLINK;
    if (s == "RED_SOLID")     return LAMP_RED_SOLID;
    if (s == "RED_BLINK")     return LAMP_RED_BLINK;
    if (s == "RED_GREEN_ALT") return LAMP_RED_GREEN_ALT;
    return LAMP_OFF;
}
// -----------------------------------------------------------------------
// HTTP POST genérico — retorna código HTTP ou -1 em falha
// -----------------------------------------------------------------------
static int _http_post(const String& endpoint, const String& body,
                      String& resposta) {
    if (!wifi_conectado()) return -1;
    String url = nvs_get_api_base() + endpoint;
    if (url.length() < 10) return -1;
    HTTPClient http;
    bool ok;
    if (url.startsWith("https")) {
        // Railway é HTTPS. Sem CA embarcado usamos setInsecure() (não valida o
        // certificado) — senão o handshake TLS falha e o POST retorna code=-1.
        static WiFiClientSecure sclient;
        sclient.setInsecure();
        ok = http.begin(sclient, url);
    } else {
        static WiFiClient client;
        ok = http.begin(client, url);
    }
    if (!ok) { Serial.println("[HB] http.begin falhou"); return -1; }
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-device-key", nvs_get_device_key());
    http.setTimeout(HTTP_TIMEOUT_MS);
    int code = http.POST(body);
    if (code == 200) resposta = http.getString();
    else if (code < 0) {   // diagnóstico: DNS? memória do TLS?
        IPAddress ip;
        bool dns = WiFi.hostByName("pili-lave-production.up.railway.app", ip);
        Serial.printf("[HTTP] code=%d (%s) heap=%u maxblk=%u dns=%d ip=%s\n",
                      code, http.errorToString(code).c_str(),
                      ESP.getFreeHeap(), ESP.getMaxAllocHeap(),
                      (int)dns, dns ? ip.toString().c_str() : "-");
    }
    http.end();
    return code;
}
// -----------------------------------------------------------------------
// Heartbeat — o display NÃO faz HTTPS (sem RAM p/ TLS). Manda o estado à
// CÂMERA por ESP-NOW; a câmera faz o POST /api/machine/heartbeat e devolve a
// resposta do backend em MSG_HB_RESP (tratado por backend_espnow_handle).
// -----------------------------------------------------------------------
static void _backend_heartbeat() {
    // Opção A: o display NÃO faz HTTPS (sem RAM p/ TLS). Manda o estado da máquina
    // à CÂMERA por ESP-NOW; a câmera faz o POST e devolve a resposta em MSG_HB_RESP
    // (tratado por backend_espnow_handle). Roda sempre — a câmera cuida do Wi-Fi.
    MsgHbState m = {};
    m.cab.tipo       = MSG_HB_STATE;
    m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem     = ORIGEM_DISPLAY;
    m.cab.seq        = 0;
    String st = _backend_estado_str();
    strncpy(m.state, st.c_str(), sizeof(m.state) - 1);
    m.state[sizeof(m.state) - 1] = '\0';
    m.restanteSeg = _backend_restante_seg();
    esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
}
// -----------------------------------------------------------------------
// Resposta do backend vinda da câmera (MSG_HB_RESP) — chamada pelo
// espnow_on_recv() de comm_espnow.h. Aplica lamp/licença/start.
// -----------------------------------------------------------------------
bool backend_espnow_handle(const uint8_t* mac, const uint8_t* data, int len) {
    if (len < (int)sizeof(CabEspNow)) return false;
    const CabEspNow* cab = (const CabEspNow*)data;
    if (cab->id_maquina != ID_MAQUINA) return false;

    // ACK de evento vindo da câmera: o backend aceitou (200) -> tira da fila NVS.
    if (cab->tipo == MSG_EVT_ACK) {
        if (len < (int)sizeof(MsgEvtAck)) return true;
        const MsgEvtAck* a = (const MsgEvtAck*)data;
        if (!a->ok) return true;
        // Confere se o ACK corresponde ao evento na cabeça da fila (mesmo res).
        String head = nvs_evt_peek();
        if (head.length()) {
            StaticJsonDocument<256> doc;
            if (deserializeJson(doc, head) == DeserializationError::Ok) {
                String r = doc["r"] | "";
                if (r == String(a->res)) {
                    nvs_evt_pop();
                    Serial.printf("[EVT] ACK(via cam) tipo=%d res=%s -> pop\n", a->evt_tipo, a->res);
                }
            }
        }
        return true;
    }

    if (cab->tipo != MSG_HB_RESP)      return false;
    if (len < (int)sizeof(MsgHbResp))  return true;
    const MsgHbResp* m = (const MsgHbResp*)data;
    if (!m->ok) { Serial.println("[HB] camera reportou falha no backend"); return true; }
    g_backend_ok = true;
    g_hb_last_ok = millis();
    nvs_set_last_hb_ok((uint32_t)(esp_timer_get_time() / 1000000ULL));
    g_lamp_state = (LampState)m->lightState;
    nvs_set_lic_days(m->lic_days);
    nvs_set_lic_blocked(m->lic_blocked);
    g_start_cmd.valido = false;
    if (m->start_valido && m->start_prog >= 1 && m->start_prog <= 4) {
        g_start_cmd.valido        = true;
        g_start_cmd.reservationId = String(m->start_res);
        g_start_cmd.programId     = m->start_prog;
        g_start_cmd.duracaoSeg    = m->start_dur;
    }
    Serial.printf("[HB] OK(via cam) lamp=%d start=%d dias=%d blk=%d\n",
                  (int)g_lamp_state, (int)g_start_cmd.valido, m->lic_days, m->lic_blocked);
    return true;
}
// (parser JSON antigo — mantido só como referência morta abaixo, não usado)
static void _backend_heartbeat_legacy_json(const String& resp) {
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, resp) != DeserializationError::Ok) return;
    if (doc.containsKey("lightState"))
        g_lamp_state = _parse_light(doc["lightState"].as<String>());
    if (doc.containsKey("license")) {
        uint16_t days    = doc["license"]["daysWithoutPayment"] | 0;
        uint8_t  blocked = doc["license"]["blocked"] | 0;
        nvs_set_lic_days(days);
        nvs_set_lic_blocked(blocked);
    }
    g_start_cmd.valido = false;
    if (doc.containsKey("start") && !doc["start"].isNull()) {
        String resId = doc["start"]["reservationId"] | "";
        uint8_t  pid = doc["start"]["programId"]     | 0;
        uint32_t dur = doc["start"]["duracaoSeg"]    | 0;
        if (resId.length() > 0 && pid >= 1 && pid <= 4) {
            g_start_cmd.valido       = true;
            g_start_cmd.reservationId = resId;
            g_start_cmd.programId    = pid;
            g_start_cmd.duracaoSeg   = dur;
        }
    }
    Serial.printf("[HB] OK lamp=%d start=%d\n",
                  (int)g_lamp_state, (int)g_start_cmd.valido);
}
// -----------------------------------------------------------------------
// Processa o campo start — regra mestra: só se FREE
// -----------------------------------------------------------------------
static void _backend_processar_start() {
    if (!g_start_cmd.valido) return;
    if (g_estado_auto != AUTO_IDLE) return;   // regra mestra
    String lastRes = nvs_get_last_res_id();
    if (g_start_cmd.reservationId == lastRes) return;   // dedup
    // Salva e dispara
    nvs_set_last_res_id(g_start_cmd.reservationId);
    auto_iniciar(g_start_cmd.programId);
    Serial.printf("[HB] START: prog=%d res=%s\n",
                  g_start_cmd.programId,
                  g_start_cmd.reservationId.c_str());
}
// -----------------------------------------------------------------------
// Reenvio da fila de eventos — 1 evento por ciclo, VIA CÂMERA (MSG_EVT).
// O display não tem RAM p/ TLS: manda o evento à câmera por ESP-NOW; ela
// POSTa no backend e devolve MSG_EVT_ACK — só então o pop da fila NVS.
// Sem ACK (câmera off/backend fora), reenvia no próximo ciclo (10s).
// -----------------------------------------------------------------------
static void _backend_flush_fila() {
    if (nvs_evt_vazia()) return;
    String json = nvs_evt_peek();
    if (json.length() == 0) { nvs_evt_pop(); return; }
    StaticJsonDocument<256> doc;
    if (deserializeJson(doc, json) != DeserializationError::Ok) {
        nvs_evt_pop(); return;   // JSON corrompido — descarta
    }
    String tipo = doc["t"] | "";
    MsgEvt m = {};
    m.cab.tipo = MSG_EVT; m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = 0;
    if      (tipo == "car-entered")   m.evt_tipo = 1;
    else if (tipo == "wash-complete") m.evt_tipo = 2;
    else if (tipo == "fault")         m.evt_tipo = 3;
    else { nvs_evt_pop(); return; }   // tipo desconhecido — descarta
    String r = doc["r"] | "";
    String s = doc["s"] | "";
    m.prog = (uint8_t)atoi((doc["p"] | "0"));
    strncpy(m.res,    r.c_str(), sizeof(m.res)    - 1);
    strncpy(m.source, s.c_str(), sizeof(m.source) - 1);
    esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
    Serial.printf("[EVT] %s enviado a camera (aguardando ACK)\n", tipo.c_str());
}
// -----------------------------------------------------------------------
// API pública para enfileirar eventos
// -----------------------------------------------------------------------
// Enfileira car-entered
void backend_evt_car_entered() {
    String resId = nvs_get_last_res_id();
    String json;
    if (resId.length() > 0)
        json = "{\"t\":\"car-entered\",\"r\":\"" + resId + "\"}";
    else
        json = "{\"t\":\"car-entered\"}";
    nvs_evt_push(json);
    Serial.println("[EVT] car-entered enfileirado");
}
// Enfileira wash-complete
// source: "" = veio do app (usa reservationId)
//         "remote" = veio do controle remoto
void backend_evt_wash_complete(uint8_t programId, const String& source = "") {
    String resId = nvs_get_last_res_id();
    String json;
    if (source == "remote" || resId.length() == 0) {
        json = "{\"t\":\"wash-complete\",\"s\":\"remote\",\"p\":\""
               + String(programId) + "\"}";
    } else {
        json = "{\"t\":\"wash-complete\",\"r\":\"" + resId +
               "\",\"p\":\"" + String(programId) + "\"}";
    }
    nvs_evt_push(json);
    Serial.printf("[EVT] wash-complete enfileirado prog=%d src=%s\n",
                  programId, source.c_str());
}
// Enfileira fault
void backend_evt_fault() {
    String resId = nvs_get_last_res_id();
    String json;
    if (resId.length() > 0)
        json = "{\"t\":\"fault\",\"r\":\"" + resId + "\"}";
    else
        json = "{\"t\":\"fault\"}";
    nvs_evt_push(json);
    Serial.println("[EVT] fault enfileirado");
}
// -----------------------------------------------------------------------
// Inicialização — chamar no setup() após wifi_init()
// -----------------------------------------------------------------------
void backend_init() {
    g_lamp_state  = LAMP_OFF;
    g_backend_ok  = false;
    g_hb_last_ok  = 0;
    Serial.println("[HB] backend_client iniciado");
}
// -----------------------------------------------------------------------
// Tick — chamar no loop() a cada ciclo
// Heartbeat roda SEMPRE — mesmo com máquina bloqueada por licença.
// -----------------------------------------------------------------------
static uint32_t _hb_last_t = 0;
void backend_tick() {
    uint32_t agora = millis();
    // Failsafe: 60s sem OK -> lâmpada OFF
    if (g_backend_ok && agora - g_hb_last_ok > HB_FAILSAFE_MS) {
        g_lamp_state = LAMP_OFF;
        g_backend_ok = false;
        Serial.println("[HB] failsafe: 60s sem OK -> lamp OFF");
    }
    // Heartbeat a cada 10s + flush da fila de eventos VIA CÂMERA (Fase 2 feita:
    // MSG_EVT -> câmera POSTa -> MSG_EVT_ACK -> pop). 1 evento por ciclo.
    if (agora - _hb_last_t >= HB_INTERVAL_MS) {
        _hb_last_t = agora;
        _backend_heartbeat();
        _backend_processar_start();
        _backend_flush_fila();
    }
}
// Consultas usadas por outros módulos
bool      backend_ok()         { return g_backend_ok; }
uint32_t  backend_last_ok_ms() { return g_hb_last_ok; }
LampState backend_lamp_state() { return g_lamp_state; }
