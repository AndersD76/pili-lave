# PILI LAVE — Firmware da Câmera (ESP32-CAM → nuvem)

Captura JPEG e envia o frame cru para `POST /api/lpr/frame`; o LPR roda na
nuvem (Plate Recognizer — configure `PLATE_RECOGNIZER_TOKEN` no servidor).
A câmera **não** aciona luz nem máquina — só captura e envia.

## Gravação

1. Edite `pili_cam_config.h`: escolha a placa (`CAMERA_MODEL_AI_THINKER`
   para ESP32-CAM clássica ou `CAMERA_MODEL_XIAO_ESP32S3`), WiFi,
   `PILI_API_BASE` e `PILI_DEVICE_KEY` (= DEVICE_KEY do servidor).
2. FQBN ESP32-CAM: `esp32:esp32:esp32cam` (PSRAM habilita UXGA 1600×1200).
3. Posicionamento: altura 1,0–1,5 m, ângulo ≤ 30°, distância 2–3 m,
   evitar contraluz. À noite, adicionar refletor IR externo.

## Cadência

1 frame/1,5 s com movimento (variação do tamanho do JPEG entre frames);
1 frame/5 s parado. O celular com a página `/camera` continua funcionando
como fallback — mesmo pipeline no backend.
