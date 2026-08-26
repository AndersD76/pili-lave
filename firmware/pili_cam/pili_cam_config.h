/************************************************************
 * PILI LAVE — Câmera dedicada (ESP32-CAM)
 * ----------------------------------------------------------
 * Edite antes de gravar. A câmera SÓ captura e envia o frame;
 * o reconhecimento (LPR) roda na nuvem — trocar o dispositivo
 * nunca muda o backend.
 ************************************************************/
#ifndef PILI_CAM_CONFIG_H
#define PILI_CAM_CONFIG_H

/* ================= PLACA =================
 * Escolha UMA (define o mapa de pinos da câmera): */
#define CAMERA_MODEL_AI_THINKER       // ESP32-CAM clássica (OV2640)
// #define CAMERA_MODEL_XIAO_ESP32S3  // Seeed XIAO ESP32-S3 Sense (OV2640/OV5640)

/* ================= WIFI ================= */
#define PILI_WIFI_SSID  "ANDERS"
#define PILI_WIFI_PASS  "@2025@2025"

/* ================= BACKEND ================= */
#define PILI_API_BASE   "https://pili-lave-production.up.railway.app"  // sem barra no final
#define PILI_DEVICE_KEY ""   // vazio = modo teste (servidor aberto)

/* ================= GATILHO =================
 * NADA de foto contínua: a câmera checa a cena localmente e SÓ envia
 * quando detecta chegada (ou quando o sensor físico dispara).
 *  PILI_MODO_SENSOR 0: detecção pelo quadro (tamanho do JPEG muda
 *                      quando algo entra na cena; parado, não muda)
 *  PILI_MODO_SENSOR 1: sensor de presença no GPIO13 (IR/ultrassônico,
 *                      nível ALTO = veículo) — recomendado na instalação */
#define PILI_MODO_SENSOR     0
#define PILI_PIN_SENSOR      13
#define PILI_CHECAGEM_MS     500UL    // intervalo da checagem local (nada é enviado)
#define PILI_MOTION_PCT      8        // % de variação do JPEG que indica chegada
#define PILI_FOTOS_EVENTO    4        // frames por chegada (a nuvem vota entre eles)
#define PILI_COOLDOWN_MS     10000UL  // silêncio após um evento
#define PILI_ASSENTAR_MS     1500UL   // espera a cena assentar antes da 1ª foto
#define PILI_ENTRE_FOTOS_MS  1500UL   // intervalo entre as fotos da rajada

/* ================= CAPTURA ================= */
#define PILI_JPEG_QUALITY  12       // 0(melhor)..63 — 12 equilibra nitidez/tamanho
#define PILI_HTTP_TIMEOUT  20000

#endif // PILI_CAM_CONFIG_H
