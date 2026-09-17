# Relatório — Integração do App/Nuvem no firmware do Display (Lava Car Now)

Data: 26/08/2026 · Pasta: `lava_car_now_app/` (cópia baseada na `lava car now 2`)
Guia-fonte: *"Instrução de complemento dos códigos para instalação de comunicação com app e câmera.docx"*

Status: **✅ COMPILA LIMPO** — `Sketch uses 1486217 bytes (44%)` · RAM 14% · **não gravado ainda**.

---

## 1. Objetivo

Integrar a lavadora (display ESP32-S3-Touch-LCD-7, master ESP-NOW) ao **backend na nuvem (Pili Lave App)**:
comunicação Wi-Fi + heartbeat, controle remoto de ciclo pelo app, sinalização por lâmpada,
travas de licença e fila de eventos com reenvio. E deixar o **display pronto para alimentar a câmera**
ESP32-S3-CAM com credenciais Wi-Fi via ESP-NOW (o firmware da câmera é uma etapa à parte).

---

## 2. Arquivos NOVOS criados (`display/`)

| Arquivo | Papel |
|---|---|
| `wifi_manager.h` | Conecta no Wi-Fi (credenciais em NVS), lê o canal do roteador, salva e **sincroniza o canal ESP-NOW** com as waveshares (MSG_CANAL broadcast 1–13). Responde à câmera (MSG_WIFI_REQ → MSG_WIFI_CFG com ssid/pass/canal/api_url/dev_key). Reconexão não-bloqueante. |
| `backend_client.h` | **Heartbeat a cada 10 s** (`POST /api/machine/heartbeat`), lê `lightState`, `license`, `start`. **Fila NVS (ring buffer 8)** de eventos car-entered / wash-complete / fault com reenvio até 200 OK. Dispara `auto_iniciar()` no comando `start` (só se FREE, com dedup por reservationId). Usa **ArduinoJson**. |
| `lampada_app.h` | Aplica o `lightState` do backend nas lâmpadas Y11/Y12 (OFF, verde/vermelho fixo, piscando, alternando) — só quando não há lavagem nem recuperação em andamento. |
| `licenca.h` | **Trava 1 (pagamento):** aviso a partir de 40 dias, bloqueio em 50+ ou `blocked`. **Trava 2 (comunicação):** bloqueia após 7 dias sem heartbeat OK (conta a partir do 1º OK). Qualquer trava barra `auto_iniciar` e o remoto; heartbeat continua rodando para autodesbloquear. |
| `tela_wifi.h` | Tela LVGL: scan de redes, senha, URL do backend, device key. Botão salvar reconecta. |

## 3. Arquivos EDITADOS (inserções cirúrgicas)

| Arquivo | O que entrou |
|---|---|
| `nvs_manager.h` | Chaves NVS novas (wifi_ssid/pass/canal, api_base, device_key, last_hb_ok, lic_days/blocked, last_res_id, fila evt_0..7 + head/tail) + init + getters/setters + funções da fila. |
| `tipos.h` | Enum de mensagens expandido: `MSG_CANAL=4, MSG_WIFI_REQ=5, MSG_WIFI_CFG=6`. |
| `maquina_estados.h` | Trava de licença no `auto_iniciar`; enfileira **car-entered** (borda do X14), **wash-complete** (AUTO_CONCLUIDO, distingue app vs remoto pelo reservationId), **fault** (auto_erro). |
| `display.ino` | Includes dos módulos; `wifi_init()`/`backend_init()` no setup; `wifi_tick/backend_tick/licenca_tick/lampada_app_tick` no loop; função e atualização do **ícone Wi-Fi**; criação da tela Wi-Fi. |
| `tela_config.h` | **Botão Wi-Fi** (ícone) que abre a tela de configuração Wi-Fi. |

## 4. Dependência instalada

- **ArduinoJson 6.21.5** (via `arduino-cli lib install ArduinoJson@6.21.5`).
  ⚠️ **Não usar 7.x** — o código usa `StaticJsonDocument`, removido na v7.

---

## 5. Ajustes de integração que precisei fazer (não estavam no doc — o "ajuste fino")

1. **Conflito de símbolo `MSG_CANAL`/`REQ`/`CFG`:** vinham como `#define` no `wifi_manager.h` **e** como enum no `tipos.h` → removi os `#define` do wifi_manager e deixei só o enum (adicionei `#include "tipos.h"` lá).
2. **Dependência circular** `backend_client.h` ↔ `maquina_estados.h` (o backend usa `g_estado_auto`/`auto_iniciar`, e a FSM chama `backend_evt_*`): resolvido com **forward-declarations** no topo do `maquina_estados.h`; as definições reais entram depois, no `display.ino`.
3. **Gerador de protótipos do Arduino:** a função `ui_atualizar_wifi_icon()` estava como 1ª função do `.ino`, fazendo os protótipos irem antes do enum `TelaAtiva` → **movi a função para antes do `setup()`**.
4. **`wifi_manager.h` autossuficiente:** `#include <esp_now.h>` (usa `esp_now_add_peer/send`).
5. **Ordem de includes** no `display.ino`: os módulos do app entram **depois** do `maquina_estados.h` (dependem de `g_estado_auto`, `SET_Y11/12`, etc.).

---

## 6. Arquitetura / fluxo de dados

```
                 Wi-Fi / HTTPS
   [Backend nuvem] <-----------> [DISPLAY ESP32-S3]  (master ESP-NOW)
        ^                              |  \
        | heartbeat 10s               |   \ ESP-NOW (canal sincronizado)
        | eventos (fila NVS)          |    \-> [Waveshare1] [Waveshare2]
        | start / lightState / license|    \-> [Câmera ESP32-S3-CAM] (recebe credenciais)
```

- **Comandos do app → máquina:** heartbeat traz `start{reservationId,programId,duracaoSeg}` → `auto_iniciar` (só se FREE, com dedup).
- **Máquina → app:** eventos car-entered / wash-complete / fault na fila NVS, reenviados até 200 OK.
- **Sinalização:** `lightState` do backend → `lampada_app` (Y11/Y12).
- **Licença:** trava a máquina por falta de pagamento (50d) ou de comunicação (7d).
- **Câmera:** ao ligar, pede credenciais (MSG_WIFI_REQ) e o display responde (MSG_WIFI_CFG com ssid/pass/canal/api_url/dev_key).

---

## 7. Como configurar/usar (após gravar)

1. Config → botão **Wi-Fi** → Buscar rede, senha, **URL do backend** e **device key** → Salvar.
2. Ícone Wi-Fi no canto: vermelho=sem rede, amarelo=Wi-Fi mas sem backend, verde=backend OK.
3. NVS guarda tudo — reboot mantém a configuração.

Endpoints usados: `/api/machine/heartbeat`, `/api/machine/car-entered`, `/api/machine/wash-complete`, `/api/machine/fault`. Header `x-device-key`.

---

## 8. Pendências

1. **Bloco 2A — roteamento da câmera no `comm_espnow.h`** (chamar `wifi_espnow_handle` no `espnow_on_recv` ao receber MSG_WIFI_REQ). **ADIADO** para ir junto com o firmware da câmera (evita mexer no include-order agora).
2. **Firmware da câmera ESP32-S3-CAM** — etapa própria. O `.docx` traz um "prompt" pronto. O display já está preparado (envia credenciais + api_url + dev_key na `MsgWifiCfg` expandida).
3. **Gravar e testar** — ainda não gravado. Configurar Wi-Fi/URL/device key na tela nova.
4. Definir a **URL real** do backend e as **device keys** (máquina e câmera — hoje a da câmera está fixa `"pili-cam-01"` no `_wifi_responder_camera`, ajustável).

---

## 9. Observações

- Produção intacta: `lava car now 2` (e o backup `lava car now`) **não foram tocados**. Toda a integração está só na `lava_car_now_app`.
- Os itens temporários de debug do firmware base (`[DBG]`, `[RAMPA]`, painel de tuning GIRO/TIMEOUT) continuam presentes — remover quando finalizar.
