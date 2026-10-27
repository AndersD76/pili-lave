# Firmware da câmera — v6 PUBLICADA (2026-10-25)

- `camera_v5.bin` (publicado em `b976845`) e `camera_v6.bin` (publicado em `9915b00`, **atual**) estão em `firmware_camera/release/`; o servidor entrega `server/public/firmware/camera.bin` com `camera-version.json` = 6.
- **v5:** aceita "vai para o canal N" do display (`MsgCanal`), fica 30 s sem internet nesse intervalo, guarda o canal na NVS, sobe no canal combinado, pede **re-sync** (`MSG_RESYNC_REQ`, 21) quando o roteador está em outro canal.
- **v6:** a cada 5 s manda ao display `MSG_REDE_INFO` (22) com o nome da rede Wi-Fi e o sinal (aparece na tela TECNICO > REDE > WI-FI). `PILI_FW_VERSION` 6 em `pili_cam_config.h`.
- As respostas da nuvem (`MSG_HB_RESP`, `MSG_EVT_ACK`) vão para a W1 e para o display; quem usa é o display (a W1 ignora).
- Chave `PILI_RESYNC_COM_DISPLAY` em `src/main.cpp`: 0 = comportamento antigo (para display antigo).

## Como publicar uma versão nova (OTA pelo Wi-Fi) — **deploy de PRODUÇÃO, só com o "pode publicar" do Giovani**
A câmera confere `GET <api>/firmware/camera-version.json` a cada 10 min e, se a versão for maior que `PILI_FW_VERSION`, baixa `camera.bin`.
1. Compilar (`pio run` em `firmware_camera`) e copiar para `release/camera_vN.bin`.
2. Em um clone limpo da `main`: `server/public/firmware/camera.bin` = o `.bin`; `camera-version.json` = `{ "version": N }`.
3. Commit e **push na `main`** (o Railway publica; a branch `loja-conveniencia` não vai junto). Toda câmera com nuvem se atualiza em até 10 min.
