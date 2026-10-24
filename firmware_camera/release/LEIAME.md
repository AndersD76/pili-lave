# Firmware da câmera v5 — PRONTO, NÃO PUBLICADO (aguardando o Giovani)

`camera_v5.bin` é o firmware da câmera com as mudanças da arquitetura nova (W1 conversa direto com a câmera):
- Aceita "vai para o canal N" vindo do display (`MsgCanal`), fica **30 s sem internet** nesse intervalo, guarda o canal na NVS (`canal_sis`) e responde o "oi".
- **Sobe no canal combinado** (não sempre no 1) depois de qualquer reinício.
- Se o roteador estiver em outro canal, **não sai do canal combinado**: pede **re-sync** ao display (`MSG_RESYNC_REQ`, id 21) e só conecta depois; passados 5 min sem resposta conecta assim mesmo (nuvem tem prioridade).
- As respostas da nuvem (`MSG_HB_RESP`, `MSG_EVT_ACK`) vão para a **W1** e também para o display (o display antigo ainda as espera).
- Chave `PILI_RESYNC_COM_DISPLAY` em `src/main.cpp`: 0 = comportamento antigo (anuncia e migra sozinha), para usar com o display ANTIGO.

## Como publicar (OTA pelo Wi-Fi) — SÓ quando o Giovani mandar
A câmera confere `GET <api>/firmware/camera-version.json` a cada 10 min e, se a versão for maior que a dela (`PILI_FW_VERSION`, hoje 5; publicada hoje: 4), baixa `camera.bin`.
1. Copiar `release/camera_v5.bin` para `server/public/firmware/camera.bin`.
2. Pôr `{ "version": 5 }` em `server/public/firmware/camera-version.json`.
3. Commitar e **fazer o deploy do servidor** (é uma ação de PRODUÇÃO: todas as câmeras com acesso à nuvem vão se atualizar sozinhas em até 10 min).
Atenção: a câmera v5 só funciona direito com o **W1/display novos** (firmware de `testes/`). Com o display antigo, ponha `PILI_RESYNC_COM_DISPLAY 0`.
