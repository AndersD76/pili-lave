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

## v9 (2026-11-12)
- Foto menor quando o envio falha em sequência (qualidade JPEG 20 → 30 → 40; volta sozinha depois de 20 fotos entregues), potência de transmissão do Wi-Fi 15 dBm (era 11) e diagnóstico com tamanho/tempo de envio, temperatura do chip, potência em uso e qualidade atual (`camera-diag`).
- Motivo: em 11/11, 25% das fotos falharam no meio do envio (erro -3) sem nenhuma queda de Wi-Fi. Se aparecer reinício por QUEDA-DE-TENSAO no diagnóstico, voltar `PILI_WIFI_TX` para `WIFI_POWER_11dBm`.
- `server/public/firmware/camera.bin` = `camera_v9.bin`; `camera-version.json` = 9. Ler o resultado com `node server/_diag_camera.mjs AAAA-MM-DD`.
