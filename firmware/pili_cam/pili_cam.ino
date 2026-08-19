/************************************************************
 * PILI LAVE — Firmware da CÂMERA (ESP32-CAM → nuvem)
 * ----------------------------------------------------------
 * "Burra de propósito": captura JPEG e envia o frame cru para
 * POST /api/lpr/frame SOMENTE quando detecta uma chegada
 * (variação da cena ou sensor físico). O LPR roda na NUVEM;
 * a resposta {plate, light} é apenas logada — quem aciona a
 * lâmpada é o ESP32 da máquina, via heartbeat.
 *
 * Posicionamento: altura 1,0–1,5 m, ângulo ≤ 30°, distância
 * 2–3 m (lente fixa).
 *
 * LED vermelho de status (GPIO33, ativo LOW no AI-Thinker):
 *   piscando lento = conectando WiFi
 *   1 piscada      = frame enviado
 *   3 piscadas     = erro de envio
 ************************************************************/
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include "esp_camera.h"
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

static void blink(int n, int ms = 120) {
#ifdef LED_STATUS
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_STATUS, LOW);  delay(ms);
    digitalWrite(LED_STATUS, HIGH); delay(ms);
  }
#endif
}

static bool cameraInit() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_pwdn = PWDN_GPIO;   c.pin_reset = RESET_GPIO;
  c.pin_xclk = XCLK_GPIO;   c.pin_sccb_sda = SIOD_GPIO; c.pin_sccb_scl = SIOC_GPIO;
  c.pin_d7 = Y9_GPIO; c.pin_d6 = Y8_GPIO; c.pin_d5 = Y7_GPIO; c.pin_d4 = Y6_GPIO;
  c.pin_d3 = Y5_GPIO; c.pin_d2 = Y4_GPIO; c.pin_d1 = Y3_GPIO; c.pin_d0 = Y2_GPIO;
  c.pin_vsync = VSYNC_GPIO; c.pin_href = HREF_GPIO; c.pin_pclk = PCLK_GPIO;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size   = FRAMESIZE_SVGA;  // 800x600: nítido o bastante e leve p/ TLS
  c.jpeg_quality = PILI_JPEG_QUALITY;
  c.fb_count     = 1;               // buffer único libera heap p/ o HTTPS
  c.grab_mode    = CAMERA_GRAB_LATEST;
  if (esp_camera_init(&c) != ESP_OK) return false;

  sensor_t *s = esp_camera_sensor_get();
  if (s) {                       // placa refletiva: reforça contraste/nitidez
    s->set_contrast(s, 1);
    s->set_sharpness(s, 1);
    s->set_whitebal(s, 1);
    s->set_exposure_ctrl(s, 1);
  }
  return true;
}

/* Envia o frame cru; resposta {plate, light} é apenas logada. */
static bool enviarFrame(camera_fb_t *fb) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  client.setInsecure();                       // TODO produção: pinning
  HTTPClient http;
  http.setTimeout(PILI_HTTP_TIMEOUT);
  if (!http.begin(client, String(PILI_API_BASE) + "/api/lpr/frame")) return false;
  http.addHeader("Content-Type", "image/jpeg");
  if (strlen(PILI_DEVICE_KEY)) http.addHeader("x-device-key", PILI_DEVICE_KEY);
  Serial.printf("[dbg] heap %u | frame %uKB\n", (unsigned)ESP.getFreeHeap(), (unsigned)(fb->len / 1024));
  /* o buffer da câmera vive na PSRAM; o TLS às vezes falha escrevendo de lá —
     copia para a RAM interna antes de enviar */
  uint8_t *body = (uint8_t *)malloc(fb->len);
  if (!body) { Serial.println("[lpr] sem RAM p/ copiar frame"); http.end(); return false; }
  memcpy(body, fb->buf, fb->len);
  int code = http.POST(body, fb->len);
  free(body);
  bool ok = (code == 200);
  if (ok) Serial.printf("[lpr] %uKB -> %s\n", (unsigned)(fb->len / 1024), http.getString().substring(0, 140).c_str());
  else    Serial.printf("[lpr] envio falhou (%d: %s)\n", code, http.errorToString(code).c_str());
  http.end();
  blink(ok ? 1 : 3);
  return ok;
}

/* Chegada detectada: manda uma pequena rajada de frames (com retry) */
static void eventoChegada() {
  Serial.printf("[evento] chegada detectada — enviando frames (RSSI %d dBm)\n", WiFi.RSSI());
  for (int i = 0; i < PILI_FOTOS_EVENTO; i++) {
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) {
      bool ok = false;
      for (int t = 0; t < 3 && !ok; t++) {       // rede 2.4G oscila: insiste
        ok = enviarFrame(fb);
        if (!ok) delay(800);
      }
      esp_camera_fb_return(fb);
    }
    if (i + 1 < PILI_FOTOS_EVENTO) delay(1200);
  }
}

void setup() {
  Serial.begin(115200);
#ifdef LED_STATUS
  pinMode(LED_STATUS, OUTPUT);
  digitalWrite(LED_STATUS, HIGH);
#endif
#if PILI_MODO_SENSOR
  pinMode(PILI_PIN_SENSOR, INPUT);
#endif
  Serial.println("\nPILI LAVE — Câmera (evento -> frame -> nuvem)");
  if (!cameraInit()) {
    Serial.println("[cam] falha ao iniciar a câmera — verifique a placa em pili_cam_config.h");
    delay(5000);
    ESP.restart();
  }
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(PILI_WIFI_SSID, PILI_WIFI_PASS);
  Serial.printf("[wifi] conectando em %s", PILI_WIFI_SSID);
  while (WiFi.status() != WL_CONNECTED) { blink(1, 250); Serial.print("."); delay(250); }
  Serial.printf("\n[wifi] ok: %s\n", WiFi.localIP().toString().c_str());

  /* diagnóstico de rede no boot: DNS -> TCP 443 -> HTTPS */
  delay(1000);
  IPAddress ip;
  const char *host = "pili-lave-production.up.railway.app";
  Serial.printf("[diag] DNS %s -> %s\n", host,
                WiFi.hostByName(host, ip) ? ip.toString().c_str() : "FALHOU");
  Serial.printf("[diag] gateway %s | dns %s\n",
                WiFi.gatewayIP().toString().c_str(), WiFi.dnsIP().toString().c_str());
  {
    WiFiClient tcp;
    Serial.printf("[diag] TCP %s:443 -> %s\n", ip.toString().c_str(),
                  tcp.connect(ip, 443, 8000) ? "ok" : "FALHOU");
    tcp.stop();
  }
  {
    WiFiClientSecure tls; tls.setInsecure();
    Serial.printf("[diag] TLS %s:443 -> %s\n", host,
                  tls.connect(host, 443, 15000) ? "ok" : "FALHOU");
    tls.stop();
  }

  /* frame de teste no boot: valida câmera+rede sem precisar de movimento */
  delay(500);
  camera_fb_t *fb = esp_camera_fb_get();
  if (fb) { Serial.println("[boot] enviando frame de teste"); enviarFrame(fb); esp_camera_fb_return(fb); }
}

void loop() {
  static uint32_t lastCheck = 0, cooldownAte = 0;
  static float baseline = 0;

  if (millis() - lastCheck < PILI_CHECAGEM_MS) { delay(10); return; }
  lastCheck = millis();
  if (WiFi.status() != WL_CONNECTED) { blink(1, 250); return; }
  if (millis() < cooldownAte) return;

#if PILI_MODO_SENSOR
  /* sensor físico: nível ALTO = veículo presente */
  if (digitalRead(PILI_PIN_SENSOR) == HIGH) {
    eventoChegada();
    cooldownAte = millis() + PILI_COOLDOWN_MS;
  }
#else
  /* detecção pelo quadro: cena parada gera JPEG de tamanho estável;
     algo entrando muda o tamanho — só aí os frames são enviados. */
  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) return;
  const float size = (float)fb->len;
  esp_camera_fb_return(fb);           // frame de checagem é descartado local

  if (baseline <= 0) { baseline = size; return; }   // aquecimento
  const float varPct = fabsf(size - baseline) * 100.0f / baseline;
  baseline = baseline * 0.9f + size * 0.1f;         // média móvel da cena

  if (varPct >= PILI_MOTION_PCT) {
    eventoChegada();
    cooldownAte = millis() + PILI_COOLDOWN_MS;
    baseline = 0;                                   // re-aprende a cena
  }
#endif
}
