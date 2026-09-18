/************************************************************
 * PILI LAVE — Firmware da MÁQUINA (fluxo de reserva)
 * ----------------------------------------------------------
 * Um ESP32 acoplado ao CLP concentra 4 funções:
 *  1. HEARTBEAT (POST /api/machine/heartbeat a cada 10 s) — é por ele
 *     que a máquina RECEBE A LIBERAÇÃO DO PAGAMENTO: a resposta traz
 *     `start{reservationId, programId, duracaoSeg}` e `lightState`.
 *     Modelo pull: sem porta aberta, funciona atrás de NAT/4G.
 *  2. X14 (sensor de entrada do CLP) -> POST /api/machine/car-entered.
 *  3. Desfecho do ciclo -> wash-complete (AUTO_CONCLUIDO, é o débito)
 *     ou fault (AUTO_ERRO, libera o saldo do cliente).
 *  4. Lâmpada bicolor (verde/vermelha) via 2 relés — a ÚNICA barreira
 *     de acesso (não há cancela).
 *
 * Garantias:
 *  - Dedup do START por reservationId em NVS — replay nunca pulsa o
 *    relé duas vezes.
 *  - Eventos (car-entered/wash-complete/fault) numa fila persistente em
 *    NVS, retransmitidos até 200 OK — rede cair não perde o débito.
 *  - Fail-safe: 60 s sem resposta do backend -> lâmpada apaga sozinha
 *    (nunca deixar um "verde fantasma" convidando carro).
 *
 * Bibliotecas: core esp32 (WiFi, HTTPClient) + ArduinoJson v7.
 ************************************************************/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include "pili_maquina_config.h"

/* ===== Estado local ===== */
enum LampState : uint8_t { L_OFF, L_GREEN_SOLID, L_GREEN_BLINK, L_RED_SOLID, L_RED_BLINK, L_RED_GREEN_ALT };
enum MaqState  : uint8_t { M_FREE, M_WASHING, M_FAULT };

static Preferences g_prefs;
static LampState g_lamp = L_OFF;
static MaqState  g_state = M_FREE;
static uint32_t  g_cicloFimMs = 0;      // fallback interno (sem CLP_DONE ligado)
static String    g_resAtual;            // reservationId do ciclo em andamento
static uint32_t  g_lastHb = 0;
static uint32_t  g_lastOk = 0;
static uint32_t  g_lastRetry = 0;

/* ===== Fila persistente de eventos (NVS) =====
 * Slots ev0..ev7 com o corpo JSON; head/count controlam o anel.
 * Cada item: {"path":"/api/machine/...","body":"{...}"}                */
#define QMAX 8
static uint8_t g_qHead = 0, g_qCount = 0;

static String slotKey(uint8_t i) { return String("ev") + i; }

static void queueSaveMeta() {
  g_prefs.putUChar("qHead", g_qHead);
  g_prefs.putUChar("qCount", g_qCount);
}
static void queueLoad() {
  g_qHead = g_prefs.getUChar("qHead", 0);
  g_qCount = g_prefs.getUChar("qCount", 0);
  if (g_qHead >= QMAX || g_qCount > QMAX) { g_qHead = 0; g_qCount = 0; }
}
static void queuePush(const char *path, const String &body) {
  JsonDocument d;
  d["path"] = path;
  d["body"] = body;
  String item; serializeJson(d, item);
  if (g_qCount >= QMAX) {            // cheia: descarta o mais antigo (nunca deveria acontecer)
    g_qHead = (g_qHead + 1) % QMAX;
    g_qCount--;
  }
  uint8_t slot = (g_qHead + g_qCount) % QMAX;
  g_prefs.putString(slotKey(slot).c_str(), item);
  g_qCount++;
  queueSaveMeta();
}
static bool queueFront(String &path, String &body) {
  if (!g_qCount) return false;
  String item = g_prefs.getString(slotKey(g_qHead).c_str(), "");
  if (!item.length()) return false;
  JsonDocument d;
  if (deserializeJson(d, item)) return false;
  path = String((const char *)d["path"]);
  body = String((const char *)d["body"]);
  return true;
}
static void queuePop() {
  if (!g_qCount) return;
  g_prefs.remove(slotKey(g_qHead).c_str());
  g_qHead = (g_qHead + 1) % QMAX;
  g_qCount--;
  queueSaveMeta();
}

/* ===== HTTP ===== */
static int httpPost(const String &path, const String &body, String &respOut) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure client;
  client.setInsecure();                       // TODO produção: pinning
  HTTPClient http;
  http.setTimeout(PILI_HTTP_TIMEOUT);
  if (!http.begin(client, String(PILI_API_BASE) + path)) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", PILI_DEVICE_KEY);
  int code = http.POST(body);
  respOut = (code > 0) ? http.getString() : String();
  http.end();
  return code;
}

/* ===== Lâmpada (não bloqueante) ===== */
static void lampWrite(bool g, bool r) {
  digitalWrite(PILI_LAMP_G_GPIO, (g == (bool)PILI_LAMP_ATIVO_ALTO) ? HIGH : LOW);
  digitalWrite(PILI_LAMP_R_GPIO, (r == (bool)PILI_LAMP_ATIVO_ALTO) ? HIGH : LOW);
}
static void lampTick() {
  bool phase = (millis() / PILI_LAMP_BLINK_MS) & 1;
  switch (g_lamp) {
    case L_GREEN_SOLID:   lampWrite(true, false); break;
    case L_RED_SOLID:     lampWrite(false, true); break;
    case L_GREEN_BLINK:   lampWrite(phase, false); break;
    case L_RED_BLINK:     lampWrite(false, phase); break;
    case L_RED_GREEN_ALT: lampWrite(phase, !phase); break;
    default:              lampWrite(false, false); break;
  }
}
static LampState parseLight(const char *s) {
  if (!s) return L_OFF;
  if (!strcmp(s, "GREEN_SOLID"))   return L_GREEN_SOLID;
  if (!strcmp(s, "GREEN_BLINK"))   return L_GREEN_BLINK;
  if (!strcmp(s, "RED_SOLID"))     return L_RED_SOLID;
  if (!strcmp(s, "RED_BLINK"))     return L_RED_BLINK;
  if (!strcmp(s, "RED_GREEN_ALT")) return L_RED_GREEN_ALT;
  return L_OFF;
}

/* ===== Entradas com debounce ===== */
struct DebouncedInput {
  int pin; bool activeHigh; bool last; uint32_t lastChange;
  bool read() { return (digitalRead(pin) == HIGH) == activeHigh; }
  /* true só na borda de subida estável */
  bool rose(uint32_t debounceMs) {
    bool now = read();
    if (now != last && millis() - lastChange > debounceMs) {
      lastChange = millis(); last = now;
      return now;
    }
    return false;
  }
};
static DebouncedInput g_x14  = { PILI_X14_GPIO, (bool)PILI_X14_ATIVO_ALTO, false, 0 };
static DebouncedInput g_done = { PILI_CLP_DONE_GPIO, (bool)PILI_CLP_DONE_ATIVO, false, 0 };
static DebouncedInput g_erro = { PILI_CLP_ERRO_GPIO, (bool)PILI_CLP_ERRO_ATIVO, false, 0 };

/* ===== Ciclo ===== */
static void iniciarCiclo(const String &resId, uint32_t duracaoSeg) {
  // pulso no relé dispara o CLP (AUTO_AGUARDA_CARRO)
  digitalWrite(PILI_RELAY_GPIO, PILI_RELAY_ATIVO_ALTO ? HIGH : LOW);
  delay(PILI_RELAY_PULSO_MS);
  digitalWrite(PILI_RELAY_GPIO, PILI_RELAY_ATIVO_ALTO ? LOW : HIGH);

  g_resAtual = resId;
  g_prefs.putString("lastRes", resId);      // dedup persistente
  g_state = M_WASHING;
  g_cicloFimMs = millis() + duracaoSeg * 1000UL;
  Serial.printf("[ciclo] START res=%s dur=%lus\n", resId.c_str(), (unsigned long)duracaoSeg);
}

static void concluirCiclo() {
  JsonDocument d;
  d["reservationId"] = g_resAtual;
  String body; serializeJson(d, body);
  queuePush("/api/machine/wash-complete", body);   // débito acontece na nuvem
  g_state = M_FREE; g_cicloFimMs = 0; g_resAtual = "";
  Serial.println("[ciclo] AUTO_CONCLUIDO -> wash-complete enfileirado");
}

static void falharCiclo(const char *code) {
  JsonDocument d;
  if (g_resAtual.length()) d["reservationId"] = g_resAtual;
  d["errorCode"] = code;
  String body; serializeJson(d, body);
  queuePush("/api/machine/fault", body);           // saldo do cliente é liberado
  g_state = M_FAULT; g_cicloFimMs = 0; g_resAtual = "";
  Serial.printf("[ciclo] AUTO_ERRO (%s) -> fault enfileirado\n", code);
}

/* ===== Heartbeat: estado sobe, luz + liberação descem ===== */
static void heartbeat() {
  g_lastHb = millis();

  JsonDocument d;
  d["state"] = (g_state == M_WASHING) ? "WASHING" : (g_state == M_FAULT) ? "FAULT" : "FREE";
  d["restanteSeg"] = (g_state == M_WASHING && g_cicloFimMs > millis())
                       ? (g_cicloFimMs - millis()) / 1000 : 0;
  String body; serializeJson(d, body);

  String resp;
  int code = httpPost("/api/machine/heartbeat", body, resp);
  if (code != 200) { Serial.printf("[hb] falhou (%d)\n", code); return; }
  g_lastOk = millis();

  JsonDocument r;
  if (deserializeJson(r, resp)) return;
  g_lamp = parseLight(r["lightState"]);

  if (!r["start"].isNull()) {                       // <<< PAGAMENTO LIBERADO PELA NUVEM
    String resId = String((const char *)r["start"]["reservationId"]);
    uint32_t dur = r["start"]["duracaoSeg"] | 1800;
    String ultima = g_prefs.getString("lastRes", "");
    if (resId != ultima && g_state == M_FREE)       // dedup: replay não reinicia
      iniciarCiclo(resId, dur);
    else if (resId == ultima && g_state == M_WASHING)
      g_resAtual = resId;                           // reboot no meio do ciclo: reanexa
  }
}

/* ===== Setup / Loop ===== */
void setup() {
  Serial.begin(115200);
  pinMode(PILI_RELAY_GPIO, OUTPUT);
  digitalWrite(PILI_RELAY_GPIO, PILI_RELAY_ATIVO_ALTO ? LOW : HIGH);
  pinMode(PILI_LAMP_G_GPIO, OUTPUT);
  pinMode(PILI_LAMP_R_GPIO, OUTPUT);
  lampWrite(false, false);
  pinMode(PILI_X14_GPIO, INPUT_PULLDOWN);
  if (PILI_CLP_DONE_GPIO >= 0) pinMode(PILI_CLP_DONE_GPIO, INPUT_PULLDOWN);
  if (PILI_CLP_ERRO_GPIO >= 0) pinMode(PILI_CLP_ERRO_GPIO, INPUT_PULLDOWN);

  g_prefs.begin("pilimaq");
  queueLoad();

  WiFi.mode(WIFI_STA);
  WiFi.begin(PILI_WIFI_SSID, PILI_WIFI_PASS);
  Serial.println("[wifi] conectando…");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    static uint32_t lastTry = 0;
    if (millis() - lastTry > 15000) { lastTry = millis(); WiFi.reconnect(); }
  }

  /* fail-safe: backend sumiu -> lâmpada apaga (nunca verde fantasma) */
  if (millis() - g_lastOk > PILI_FAILSAFE_MS) g_lamp = L_OFF;

  /* heartbeat periódico */
  if (millis() - g_lastHb > PILI_HB_MS) heartbeat();

  /* X14: carro fisicamente dentro — prova que não foi leitura falsa */
  if (g_x14.rose(PILI_X14_DEBOUNCE_MS)) {
    JsonDocument d;
    if (g_resAtual.length()) d["reservationId"] = g_resAtual;
    String body; serializeJson(d, body);
    queuePush("/api/machine/car-entered", body);
    Serial.println("[x14] carro entrou -> car-entered enfileirado");
  }

  /* desfecho do ciclo */
  if (g_state == M_WASHING) {
    if (PILI_CLP_ERRO_GPIO >= 0 && g_erro.rose(PILI_X14_DEBOUNCE_MS)) falharCiclo("AUTO_ERRO");
    else if (PILI_CLP_DONE_GPIO >= 0 && g_done.rose(PILI_X14_DEBOUNCE_MS)) concluirCiclo();
    else if (PILI_CLP_DONE_GPIO < 0 && g_cicloFimMs && millis() > g_cicloFimMs) concluirCiclo();
  }

  /* recuperação de falha: sinal de erro do CLP limpo há 30 s -> volta a FREE
   * (o próximo heartbeat reporta FREE e o backend reabre a máquina) */
  if (g_state == M_FAULT) {
    static uint32_t erroLimpoDesde = 0;
    bool erroAtivo = (PILI_CLP_ERRO_GPIO >= 0) && g_erro.read();
    if (erroAtivo) erroLimpoDesde = 0;
    else if (!erroLimpoDesde) erroLimpoDesde = millis();
    else if (millis() - erroLimpoDesde > 30000) { g_state = M_FREE; erroLimpoDesde = 0; }
  }

  /* fila de eventos: reenvia o primeiro até 200 OK */
  if (g_qCount && millis() - g_lastRetry > PILI_RETRY_MS) {
    g_lastRetry = millis();
    String path, body, resp;
    if (queueFront(path, body)) {
      int code = httpPost(path, body, resp);
      if (code == 200) { queuePop(); Serial.printf("[fila] %s ok\n", path.c_str()); }
      else Serial.printf("[fila] %s falhou (%d), mantém\n", path.c_str(), code);
    } else queuePop();  // slot corrompido: descarta
  }

  lampTick();
  delay(20);
}
