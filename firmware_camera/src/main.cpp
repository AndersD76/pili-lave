/*******************************************************************
 * PILI LAVE — Firmware da CÂMERA (arquitetura simplificada / Opção A)
 * -----------------------------------------------------------------
 * A CÂMERA é o gateway de nuvem e a mestre de canal. As credenciais
 * (SSID/senha/URL/device-key) NÃO são fixas: vêm do DISPLAY por ESP-NOW
 * (MSG_WIFI_CFG) e ficam salvas no NVS. Máquina sai SEM rede — configura
 * na 1ª vez pela tela do display.
 *
 * LPR: a câmera é "burra de propósito" — SEM detecção de chegada e SEM
 * sensor: manda uma foto crua pro backend (/api/lpr/frame) a cada
 * PILI_ENVIO_INTERVALO_MS, sempre, tenha carro ou não. Toda a inteligência
 * (ler a placa, decidir se tem carro, liberar) roda na NUVEM. A resposta
 * {plate, light} é só logada aqui — quem repassa o resultado pro DISPLAY
 * é o heartbeat de sempre (MSG_HB_RESP, que já carrega lightState/start).
 *
 * Estados:
 *   CONECTADA : tem creds válidas -> conecta no roteador (canal X), anuncia
 *               MSG_CANAL(X), faz HTTPS (heartbeat/LPR), ouve MSG_WIFI_CFG.
 *   CONFIG    : sem creds / não conecta -> vai pro canal 1, anuncia
 *               MSG_CANAL(1) e ouve MSG_WIFI_CFG (o display entrega a rede).
 *
 * LED (GPIO33 AI-Thinker, ativo LOW):
 *   piscando lento = CONFIG (sem rede) / conectando
 *   2 piscadas/10s = NUVEM OK (heartbeat 200)
 *   4 piscadas/10s = Wi-Fi ok, POST falhou
 *   1 piscada  = frame LPR enviado
 *   3 piscadas = erro no envio do frame LPR
 *******************************************************************/
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <Preferences.h>
#include "esp_camera.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "pili_cam_config.h"

/* ===== Mapa de pinos ===== */
#if defined(CAMERA_MODEL_AI_THINKER)
  #define PWDN_GPIO 32
  #define RESET_GPIO -1
  #define XCLK_GPIO 0
  #define SIOD_GPIO 26
  #define SIOC_GPIO 27
  #define Y9_GPIO 35
  #define Y8_GPIO 34
  #define Y7_GPIO 39
  #define Y6_GPIO 36
  #define Y5_GPIO 21
  #define Y4_GPIO 19
  #define Y3_GPIO 18
  #define Y2_GPIO 5
  #define VSYNC_GPIO 25
  #define HREF_GPIO 23
  #define PCLK_GPIO 22
  #define LED_STATUS 33
#elif defined(CAMERA_MODEL_XIAO_ESP32S3)
  #define PWDN_GPIO -1
  #define RESET_GPIO -1
  #define XCLK_GPIO 10
  #define SIOD_GPIO 40
  #define SIOC_GPIO 39
  #define Y9_GPIO 48
  #define Y8_GPIO 11
  #define Y7_GPIO 12
  #define Y6_GPIO 14
  #define Y5_GPIO 16
  #define Y4_GPIO 18
  #define Y3_GPIO 17
  #define Y2_GPIO 15
  #define VSYNC_GPIO 38
  #define HREF_GPIO 47
  #define PCLK_GPIO 13
  #define LED_STATUS 21
#else
  #error "Escolha a placa em pili_cam_config.h"
#endif

/* ===================================================================
 * ESP-NOW — tipos DEVEM bater com o tipos.h do display
 * =================================================================== */
#define MSG_CANAL     4   // câmera -> display+waveshares: canal atual
#define MSG_WIFI_REQ  5   // câmera -> display: pede credenciais (modo CONFIG)
#define MSG_WIFI_CFG  6   // display -> câmera: credenciais (SSID/senha/URL/key)
#define MSG_HB_STATE  7   // display -> câmera: estado da máquina p/ heartbeat
#define MSG_HB_RESP   8   // câmera -> display: resposta do backend
#define MSG_EVT       9   // display -> câmera: evento p/ a nuvem (car-entered/wash-complete/fault)
#define MSG_EVT_ACK  10   // câmera -> display: confirmação do evento (200 OK)

typedef struct __attribute__((packed)) {
  uint8_t tipo, id_maquina, origem, seq;
} CabEspNow;

typedef struct __attribute__((packed)) { CabEspNow cab; } MsgWifiReq;

// Relay de eventos (o display não tem RAM p/ TLS; a câmera POSTa por ele)
typedef struct __attribute__((packed)) {
  CabEspNow cab;       // MSG_EVT
  uint8_t   evt_tipo;  // 1=car-entered 2=wash-complete 3=fault
  uint8_t   prog;      // programId (wash-complete)
  char      res[40];   // reservationId ("" = sem reserva)
  char      source[8]; // "" (app) ou "remote"
} MsgEvt;

typedef struct __attribute__((packed)) {
  CabEspNow cab;       // MSG_EVT_ACK
  uint8_t   evt_tipo;
  uint8_t   ok;        // 1 = backend aceitou (200)
  char      res[40];   // ecoa o reservationId (casamento no display)
} MsgEvtAck;

typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t canal; } MsgCanal;

// ESP-NOW <= 250 bytes. Este struct = 231 bytes (DEVE bater com o display).
typedef struct __attribute__((packed)) {
  CabEspNow cab;
  char      ssid[33];
  char      pass[65];
  uint8_t   canal;          // 0 = câmera descobre ao conectar
  char      api_url[96];
  char      dev_key[32];
} MsgWifiCfg;

typedef struct __attribute__((packed)) {
  CabEspNow cab;
  char      state[12];
  uint32_t  restanteSeg;
} MsgHbState;

typedef struct __attribute__((packed)) {
  CabEspNow cab;
  uint8_t   ok;
  uint8_t   lightState;
  uint16_t  lic_days;
  uint8_t   lic_blocked;
  uint8_t   start_valido;
  uint8_t   start_prog;
  uint32_t  start_dur;
  char      start_res[40];
} MsgHbResp;

static uint8_t _light_code(const String& s) {
  if (s == "GREEN_SOLID")   return 1;
  if (s == "GREEN_BLINK")   return 2;
  if (s == "RED_SOLID")     return 3;
  if (s == "RED_BLINK")     return 4;
  if (s == "RED_GREEN_ALT") return 5;
  return 0; // OFF
}

// MACs lógicos (byte[3] = ID_MAQUINA)
static const uint8_t MAC_CAMERA[6]    = {0x02, 0x00, 0x00, ID_MAQUINA, 0x01, 0x04};
static const uint8_t MAC_DISPLAY[6]   = {0x02, 0x00, 0x00, ID_MAQUINA, 0x01, 0x01};
static const uint8_t MAC_BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

/* ===== Estado / credenciais (NVS) ===== */
static Preferences   prefs;
static String        g_ssid, g_pass, g_api_url, g_dev_key;
static uint8_t       g_canal_radio = ESPNOW_CANAL;   // canal atual do rádio (1 em CONFIG)
static bool          g_cam_ok      = false;          // módulo da câmera inicializado?
static volatile bool g_cfg_novo    = false;          // recebeu MSG_WIFI_CFG (aplica no loop)

// Estado recebido do display p/ o heartbeat
static volatile char     g_hb_state[12] = "FREE";
static volatile uint32_t g_hb_restante  = 0;

// Evento pendente recebido do display (1 slot; o display reenvia até o ACK)
static volatile bool     g_evt_pende = false;
static volatile MsgEvt   g_evt;

// Buffers voláteis p/ passar do callback (onRecv) pro loop
static volatile char     g_cfg_ssid[33] = {0};
static volatile char     g_cfg_pass[65] = {0};
static volatile char     g_cfg_url[128] = {0};
static volatile char     g_cfg_key[64]  = {0};

/* ===== LED ===== */
static void blink(int n, int ms = 120) {
#ifdef LED_STATUS
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_STATUS, LOW);  delay(ms);
    digitalWrite(LED_STATUS, HIGH); delay(ms);
  }
#endif
}

/* ===== NVS ===== */
static void nvsCarregar() {
  prefs.begin("cam", true);
  g_ssid    = prefs.getString("ssid",   "");
  g_pass    = prefs.getString("pass",   "");
  g_api_url = prefs.getString("apiurl", "");
  g_dev_key = prefs.getString("devkey", "");
  prefs.end();
}
static void nvsSalvar() {
  prefs.begin("cam", false);
  prefs.putString("ssid",   g_ssid);
  prefs.putString("pass",   g_pass);
  prefs.putString("apiurl", g_api_url);
  prefs.putString("devkey", g_dev_key);
  prefs.end();
}
static bool temCreds() { return g_ssid.length() > 0; }

/* ===== ESP-NOW recv (core 2.x e 3.x) ===== */
static void onRecvImpl(const uint8_t* mac, const uint8_t* data, int len) {
  if (len < (int)sizeof(CabEspNow)) return;
  const CabEspNow* cab = (const CabEspNow*)data;
  if (cab->id_maquina != ID_MAQUINA) return;
  if (cab->tipo == MSG_HB_STATE && len >= (int)sizeof(MsgHbState)) {
    const MsgHbState* m = (const MsgHbState*)data;
    strncpy((char*)g_hb_state, m->state, sizeof(g_hb_state) - 1);
    g_hb_state[sizeof(g_hb_state) - 1] = '\0';
    g_hb_restante = m->restanteSeg;
  } else if (cab->tipo == MSG_EVT && len >= (int)sizeof(MsgEvt)) {
    if (!g_evt_pende) {                       // 1 por vez; o display reenvia a cada 10s
      memcpy((void*)&g_evt, data, sizeof(MsgEvt));
      g_evt_pende = true;
    }
  } else if (cab->tipo == MSG_WIFI_CFG && len >= (int)sizeof(MsgWifiCfg)) {
    const MsgWifiCfg* m = (const MsgWifiCfg*)data;
    strncpy((char*)g_cfg_ssid, m->ssid,    sizeof(g_cfg_ssid) - 1);
    strncpy((char*)g_cfg_pass, m->pass,    sizeof(g_cfg_pass) - 1);
    strncpy((char*)g_cfg_url,  m->api_url, sizeof(g_cfg_url)  - 1);
    strncpy((char*)g_cfg_key,  m->dev_key, sizeof(g_cfg_key)  - 1);
    g_cfg_novo = true;   // aplica no loop (fora do callback)
  }
}
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
static void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) { onRecvImpl(info->src_addr, data, len); }
#else
static void onRecv(const uint8_t* mac, const uint8_t* data, int len) { onRecvImpl(mac, data, len); }
#endif

static void espnowInit() {
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_POWER_11dBm);
  esp_wifi_set_mac(WIFI_IF_STA, (uint8_t*)MAC_CAMERA);
  esp_wifi_set_channel(g_canal_radio, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) { Serial.println("[espnow] init FALHOU"); return; }
  esp_now_register_recv_cb(onRecv);
  esp_now_peer_info_t p = {};
  p.ifidx = WIFI_IF_STA; p.encrypt = false; p.channel = 0;
  memcpy(p.peer_addr, MAC_DISPLAY, 6);   if (!esp_now_is_peer_exist(MAC_DISPLAY))   esp_now_add_peer(&p);
  memcpy(p.peer_addr, MAC_BROADCAST, 6); if (!esp_now_is_peer_exist(MAC_BROADCAST)) esp_now_add_peer(&p);
  Serial.println("[espnow] pronto");
}

/* Em CONFIG: pede as credenciais ao display (ele responde MSG_WIFI_CFG).
 * Sem isto, uma câmera com NVS vazio ficaria esperando para sempre — o
 * display só envia as credenciais quando pedido (ou no salvar da tela). */
static void pedirCredenciais() {
  MsgWifiReq m; m.cab.tipo = MSG_WIFI_REQ; m.cab.id_maquina = ID_MAQUINA;
  m.cab.origem = ORIGEM_CAMERA; m.cab.seq = 0;
  esp_now_send((uint8_t*)MAC_DISPLAY,   (uint8_t*)&m, sizeof(m));
  esp_now_send((uint8_t*)MAC_BROADCAST, (uint8_t*)&m, sizeof(m));
}

/* Relay de eventos do display -> nuvem (car-entered/wash-complete/fault).
 * POSTa no endpoint certo e devolve MSG_EVT_ACK; o display só tira o evento
 * da fila NVS quando o ACK chega (garantia de entrega do DÉBITO). */
static void processarEvento() {
  if (!g_evt_pende) return;
  if (WiFi.status() != WL_CONNECTED || g_api_url.length() < 8) return;

  MsgEvt ev; memcpy(&ev, (const void*)&g_evt, sizeof(ev));

  const char* path = (ev.evt_tipo == 1) ? "/api/machine/car-entered"
                   : (ev.evt_tipo == 2) ? "/api/machine/wash-complete"
                   : (ev.evt_tipo == 3) ? "/api/machine/fault" : nullptr;
  if (!path) { g_evt_pende = false; return; }

  String body = "{";
  bool sep = false;
  if (strlen(ev.res)) { body += String("\"reservationId\":\"") + ev.res + "\""; sep = true; }
  if (ev.evt_tipo == 2 && ev.prog >= 1 && ev.prog <= 4) {
    if (sep) body += ",";
    body += String("\"programId\":") + ev.prog; sep = true;
  }
  if (strlen(ev.source)) { if (sep) body += ","; body += String("\"source\":\"") + ev.source + "\""; }
  body += "}";

  HTTPClient http; http.setTimeout(PILI_HTTP_TIMEOUT);
  WiFiClientSecure tls; tls.setInsecure();
  int code = -1;
  if (http.begin(tls, g_api_url + path)) {
    http.addHeader("Content-Type", "application/json");
    if (g_dev_key.length()) http.addHeader("x-device-key", g_dev_key);
    code = http.POST(body);
    http.end();
  }
  bool ok = (code >= 200 && code < 300);
  Serial.printf("[evt] %s -> %d %s\n", path, code, ok ? "OK" : "(retenta no proximo)");

  if (ok) {
    MsgEvtAck a = {};
    a.cab.tipo = MSG_EVT_ACK; a.cab.id_maquina = ID_MAQUINA; a.cab.origem = ORIGEM_CAMERA; a.cab.seq = 0;
    a.evt_tipo = ev.evt_tipo; a.ok = 1;
    strncpy(a.res, ev.res, sizeof(a.res) - 1);
    esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&a, sizeof(a));
  }
  g_evt_pende = false;   // falhou? o display reenvia no próximo ciclo de heartbeat
}

/* Anuncia MSG_CANAL no canal atual (pacote minúsculo, não mexe no Wi-Fi). */
static void anunciarCanal() {
  MsgCanal m; m.cab.tipo = MSG_CANAL; m.cab.id_maquina = ID_MAQUINA;
  m.cab.origem = ORIGEM_CAMERA; m.cab.seq = 0; m.canal = g_canal_radio;
  esp_now_send((uint8_t*)MAC_BROADCAST, (uint8_t*)&m, sizeof(m));
}

static void irParaCanal(uint8_t ch) {
  if (ch == g_canal_radio) return;
  esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
  g_canal_radio = ch;
}

static bool conectarWifi(uint32_t timeout_ms) {
  if (!temCreds()) return false;
  Serial.printf("[wifi] conectando em %s\n", g_ssid.c_str());
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  WiFi.begin(g_ssid.c_str(), g_pass.c_str());
  uint32_t t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < timeout_ms) { blink(1, 250); Serial.print("."); delay(250); }
  if (WiFi.status() == WL_CONNECTED) {
    g_canal_radio = WiFi.channel();
    Serial.printf("\n[wifi] ok: %s canal %d\n", WiFi.localIP().toString().c_str(), g_canal_radio);
    return true;
  }
  Serial.println("\n[wifi] FALHOU");
  return false;
}

/* Aplica credenciais novas recebidas do display (MSG_WIFI_CFG). */
static void aplicarCfgNovo() {
  g_ssid = String((const char*)g_cfg_ssid);
  g_pass = String((const char*)g_cfg_pass);
  if (strlen((const char*)g_cfg_url) > 0) g_api_url = String((const char*)g_cfg_url);
  if (strlen((const char*)g_cfg_key) > 0) g_dev_key = String((const char*)g_cfg_key);
  nvsSalvar();
  Serial.printf("[cfg] novas credenciais: ssid='%s' (pass_len=%d) url='%s'\n",
                g_ssid.c_str(), g_pass.length(), g_api_url.c_str());
  WiFi.disconnect();
  delay(100);
  conectarWifi(20000);   // se conectar, o loop passa a anunciar o canal real
}

/* Heartbeat: POST <url>/api/machine/heartbeat com o estado vindo do display. */
static void fazerHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (g_api_url.length() < 8) return;
  String url = g_api_url + PILI_HB_PATH;
  HTTPClient http; http.setTimeout(PILI_HTTP_TIMEOUT);
  WiFiClientSecure tls; tls.setInsecure();
  if (!http.begin(tls, url)) return;
  http.addHeader("Content-Type", "application/json");
  if (g_dev_key.length()) http.addHeader("x-device-key", g_dev_key);
  String body = String("{\"state\":\"") + (const char*)g_hb_state +
                "\",\"restanteSeg\":" + String((uint32_t)g_hb_restante) + "}";
  int code = http.POST(body);
  String resp = (code == 200) ? http.getString() : String();
  http.end();

  MsgHbResp r = {};
  r.cab.tipo = MSG_HB_RESP; r.cab.id_maquina = ID_MAQUINA; r.cab.origem = ORIGEM_CAMERA; r.cab.seq = 0;
  if (code == 200) {
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, resp) == DeserializationError::Ok) {
      r.ok = 1;
      if (doc.containsKey("lightState")) r.lightState = _light_code(doc["lightState"].as<String>());
      if (doc.containsKey("license")) {
        r.lic_days    = doc["license"]["daysWithoutPayment"] | 0;
        r.lic_blocked = doc["license"]["blocked"] | 0;
      }
      if (doc.containsKey("start") && !doc["start"].isNull()) {
        String resId = doc["start"]["reservationId"] | "";
        uint8_t  pid = doc["start"]["programId"] | 0;
        uint32_t dur = doc["start"]["duracaoSeg"] | 0;
        if (resId.length() > 0 && pid >= 1 && pid <= 4) {
          r.start_valido = 1; r.start_prog = pid; r.start_dur = dur;
          strncpy(r.start_res, resId.c_str(), sizeof(r.start_res) - 1);
        }
      }
      Serial.printf("[hb] 200 state=%s lamp=%d dias=%d blk=%d start=%d\n",
                    (const char*)g_hb_state, r.lightState, r.lic_days, r.lic_blocked, r.start_valido);
      blink(2, 60);
    }
  } else {
    Serial.printf("[hb] falha code=%d\n", code);
    blink(4, 60);
  }
  esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&r, sizeof(r));
}

/* ===================== LPR (captura + envio p/ nuvem) =====================
 * Sem detecção local, sem sensor: a câmera manda um frame cru pro backend
 * (/api/lpr/frame) a cada PILI_ENVIO_INTERVALO_MS, sempre — o LPR (leitura
 * da placa, decidir se tem carro) roda na NUVEM, não aqui. A resposta
 * {plate, light} da nuvem é só logada; quem manda o resultado pro DISPLAY
 * é o heartbeat de sempre (MSG_HB_RESP já carrega lightState/start, porque
 * o que a nuvem decidiu entra no mesmo estado que o heartbeat lê).
 * =========================================================================*/
static bool cameraInit() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0; c.ledc_timer = LEDC_TIMER_0;
  c.pin_pwdn = PWDN_GPIO;  c.pin_reset = RESET_GPIO;
  c.pin_xclk = XCLK_GPIO;  c.pin_sccb_sda = SIOD_GPIO; c.pin_sccb_scl = SIOC_GPIO;
  c.pin_d7 = Y9_GPIO; c.pin_d6 = Y8_GPIO; c.pin_d5 = Y7_GPIO; c.pin_d4 = Y6_GPIO;
  c.pin_d3 = Y5_GPIO; c.pin_d2 = Y4_GPIO; c.pin_d1 = Y3_GPIO; c.pin_d0 = Y2_GPIO;
  c.pin_vsync = VSYNC_GPIO; c.pin_href = HREF_GPIO; c.pin_pclk = PCLK_GPIO;
  c.xclk_freq_hz = 20000000; c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = psramFound() ? FRAMESIZE_UXGA : FRAMESIZE_XGA; // 1600x1200: caracteres da placa legíveis
  c.jpeg_quality = PILI_JPEG_QUALITY;
  c.fb_count = psramFound() ? 2 : 1; // 2 buffers na PSRAM evitam FB-OVF em UXGA
  c.grab_mode = CAMERA_GRAB_LATEST;
  Serial.printf("[cam] iniciando (psram=%d, heap=%u)...\n", psramFound(), (unsigned)ESP.getFreeHeap());
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) { Serial.printf("[cam] esp_camera_init FALHOU: 0x%x\n", err); return false; }
  Serial.println("[cam] iniciada OK");

  sensor_t *s = esp_camera_sensor_get();
  if (s) { // placa refletiva: reforça contraste/nitidez
    s->set_contrast(s, 2);
    s->set_sharpness(s, 2);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);           // exposição mais estável em contraluz
    s->set_gainceiling(s, GAINCEILING_4X);
    s->set_lenc(s, 1);           // correção de lente
  }
  return true;
}

/* Envia o frame cru pro /api/lpr/frame; resposta {plate, light} é só logada. */
static bool enviarFrame(camera_fb_t *fb) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (g_api_url.length() < 8) return false;
  WiFiClientSecure client;
  client.setInsecure();               // TODO produção: pinning
  HTTPClient http;
  http.setTimeout(PILI_HTTP_TIMEOUT);
  if (!http.begin(client, g_api_url + PILI_LPR_PATH)) return false;
  http.addHeader("Content-Type", "image/jpeg");
  if (g_dev_key.length()) http.addHeader("x-device-key", g_dev_key.c_str());

  Serial.printf("[dbg] heap %u | frame %uKB\n", (unsigned)ESP.getFreeHeap(), (unsigned)(fb->len / 1024));
  int code = http.POST(fb->buf, fb->len);
  bool ok = (code >= 200 && code < 300); // 202 = aceito p/ análise em segundo plano
  if (ok) Serial.printf("[lpr] %uKB -> %s\n", (unsigned)(fb->len / 1024), http.getString().substring(0, 140).c_str());
  else    Serial.printf("[lpr] envio falhou (%d: %s)\n", code, http.errorToString(code).c_str());
  http.end();
  blink(ok ? 1 : 3);
  return ok;
}

/* Sem detecção de chegada, sem sensor: manda uma foto a cada PILI_ENVIO_INTERVALO_MS,
 * sempre. A nuvem decide o que fazer com cada frame (tem carro, tem placa, etc). */
static void enviarFotoPeriodica() {
  static uint32_t tUltimoEnvio = 0;
  if (millis() - tUltimoEnvio < PILI_ENVIO_INTERVALO_MS) return;
  tUltimoEnvio = millis();

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) return;
  bool ok = false;
  for (int t = 0; t < 3 && !ok; t++) {             // até 3 tentativas, com folga crescente
    if (t > 0) delay(800 * t);
    ok = enviarFrame(fb);
  }
  esp_camera_fb_return(fb);
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);
#ifdef LED_STATUS
  pinMode(LED_STATUS, OUTPUT); digitalWrite(LED_STATUS, HIGH);
#endif
  Serial.println("\nPILI LAVE — Camera GATEWAY + LPR (Opcao A, creds do display via NVS)");

  nvsCarregar();
  espnowInit();

  if (temCreds()) {
    Serial.printf("[boot] creds no NVS: ssid='%s' (pass_len=%d) url='%s'\n",
                  g_ssid.c_str(), g_pass.length(), g_api_url.c_str());
    conectarWifi(20000);
  } else {
    Serial.println("[boot] SEM credenciais -> MODO CONFIG (canal 1, aguardando o display)");
    irParaCanal(1);
  }
}

void loop() {
  static uint32_t tHb = 0, tCanal = 0, tReconn = 0;

  // (0) Aplica credenciais novas que chegaram do display
  if (g_cfg_novo) { g_cfg_novo = false; aplicarCfgNovo(); }

  bool conectada = (WiFi.status() == WL_CONNECTED);

  // (1) Anuncia o canal SEMPRE (conectada = canal do roteador; config = canal 1),
  //     pra display+waveshares acharem a câmera pelo hunt.
  if (millis() - tCanal >= PILI_CANAL_ANUNCIO_MS) { tCanal = millis(); anunciarCanal(); }

  if (!conectada) {
    // MODO CONFIG: rádio no canal 1, anunciando, PEDINDO credenciais e
    // ouvindo MSG_WIFI_CFG.
    static uint32_t tReq = 0;
    blink(1, 250);
    irParaCanal(1);
    if (!temCreds() && millis() - tReq > 3000) { tReq = millis(); pedirCredenciais(); }
    if (temCreds() && millis() - tReconn > 15000) {   // tem creds mas caiu -> retenta
      tReconn = millis();
      conectarWifi(8000);
    }
    return;
  }

  // CONECTADA: heartbeat + LPR + relay de eventos.
  if (millis() - tHb >= PILI_HB_INTERVALO_MS) { tHb = millis(); fazerHeartbeat(); }
  processarEvento();

  if (!g_cam_ok) {
    static uint32_t tCamRetry = 0;
    if (millis() - tCamRetry < 5000) return;   // evita retry em loop apertado / spam de log
    tCamRetry = millis();
    g_cam_ok = cameraInit();
    if (!g_cam_ok) return;
  }
  enviarFotoPeriodica();
  delay(5);
}
