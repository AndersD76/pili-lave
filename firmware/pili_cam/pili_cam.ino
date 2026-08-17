/************************************************************
 * PILI LAVE — Firmware da CÂMERA (ESP32-CAM → nuvem)
 * ----------------------------------------------------------
 * Captura JPEG e envia o frame cru para POST /api/lpr/frame.
 * O LPR (Plate Recognizer) roda na NUVEM; a resposta traz
 * {plate, light} — apenas logada aqui: quem aciona a lâmpada
 * é o ESP32 da máquina, via heartbeat.
 *
 * Posicionamento: altura 1,0–1,5 m, ângulo ≤ 30°, distância
 * 2–3 m (lente fixa). Ver especificação de hardware no PDF v2.
 *
 * Bibliotecas: core esp32 (esp_camera, WiFi, HTTPClient).
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
#else
  #error "Escolha a placa em pili_cam_config.h"
#endif

static uint32_t g_lastSend = 0;
static size_t   g_lastJpegLen = 0;

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
  c.frame_size   = psramFound() ? FRAMESIZE_UXGA : FRAMESIZE_SVGA; // 1600x1200 com PSRAM
  c.jpeg_quality = PILI_JPEG_QUALITY;
  c.fb_count     = psramFound() ? 2 : 1;
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
static void enviarFrame(camera_fb_t *fb) {
  if (WiFi.status() != WL_CONNECTED) return;
  WiFiClientSecure client;
  client.setInsecure();                       // TODO produção: pinning
  HTTPClient http;
  http.setTimeout(PILI_HTTP_TIMEOUT);
  if (!http.begin(client, String(PILI_API_BASE) + "/api/lpr/frame")) return;
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("x-device-key", PILI_DEVICE_KEY);
  int code = http.POST(fb->buf, fb->len);
  if (code == 200) {
    String resp = http.getString();
    Serial.printf("[lpr] %s\n", resp.c_str()); // {"plate":"ABC1D23","light":"GREEN_SOLID",...}
  } else {
    Serial.printf("[lpr] envio falhou (%d)\n", code);
  }
  http.end();
}

void setup() {
  Serial.begin(115200);
  if (!cameraInit()) {
    Serial.println("[cam] falha ao iniciar a câmera — verifique a placa selecionada");
    while (true) delay(1000);
  }
  WiFi.mode(WIFI_STA);
  WiFi.begin(PILI_WIFI_SSID, PILI_WIFI_PASS);
  Serial.println("[wifi] conectando…");
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    static uint32_t lastTry = 0;
    if (millis() - lastTry > 15000) { lastTry = millis(); WiFi.reconnect(); }
    delay(200);
    return;
  }

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) { delay(200); return; }

  /* movimento barato: variação % do tamanho do JPEG entre frames */
  bool movimento = false;
  if (g_lastJpegLen) {
    size_t diff = (fb->len > g_lastJpegLen) ? fb->len - g_lastJpegLen : g_lastJpegLen - fb->len;
    movimento = diff * 100 / g_lastJpegLen >= PILI_MOTION_PCT;
  }
  g_lastJpegLen = fb->len;

  uint32_t intervalo = movimento ? PILI_FRAME_MS : PILI_IDLE_MS;
  if (millis() - g_lastSend >= intervalo) {
    g_lastSend = millis();
    enviarFrame(fb);
  }
  esp_camera_fb_return(fb);
  delay(250);
}
