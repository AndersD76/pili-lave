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
#define PILI_WIFI_SSID  "SUA_REDE_WIFI"
#define PILI_WIFI_PASS  "SUA_SENHA_WIFI"

/* ================= BACKEND ================= */
#define PILI_API_BASE   "https://SEU_APP"        // sem barra no final
#define PILI_DEVICE_KEY "GERE_UM_SEGREDO"        // DEVICE_KEY do servidor

/* ================= CAPTURA ================= */
#define PILI_FRAME_MS      1500UL   // com movimento: 1 frame a cada 1,5 s
#define PILI_IDLE_MS       5000UL   // parado: 1 frame a cada 5 s
#define PILI_JPEG_QUALITY  12       // 0(melhor)..63 — 12 equilibra nitidez/tamanho
#define PILI_HTTP_TIMEOUT  15000

/* Detecção de movimento barata: variação do tamanho do JPEG entre
 * frames (cena mudou => tamanho muda). Percentual mínimo p/ "movimento". */
#define PILI_MOTION_PCT    12

#endif // PILI_CAM_CONFIG_H
