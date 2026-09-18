# HANDOFF — contexto completo para outra IA continuar este projeto

> Leia este arquivo inteiro antes de mexer em qualquer coisa. Ele explica o
> hardware, a arquitetura, o protocolo entre placas, as decisões tomadas e o
> que ainda falta.

## 1. O que é este projeto

Totem de autoatendimento de um **lava-rápido (PILI LAVE)** com duas placas
**Waveshare ESP32-S3-Touch-LCD-7** (ESP32-S3-WROOM-1, LCD RGB 800×480, touch
capacitivo GT911, expansor de IO CH422G):

- **Placa TOTEM** (`PILI_LAVE_ROLE 1`): interface com o usuário.
  Fluxo: `Início → CLIENTE ou LAVADOR → tipo de lavagem (1..4) →`
  - CLIENTE → paga via **Asaas** (PIX com QR na tela; débito/crédito via QR do
    checkout `invoiceUrl`, pago no celular do cliente) → aprovado → libera.
  - LAVADOR → digita PIN (`PILI_LAVADOR_PIN`) → libera direto, sem cobrança.
- **Placa MÁQUINA** (`PILI_LAVE_ROLE 2`): recebe a liberação via **ESP-NOW**,
  dá um pulso no **GPIO6** (relé/CLP inicia a lavagem), mostra contagem
  regressiva e responde ACK/STATUS.

O **mesmo sketch** compila para os dois papéis (muda o `#define`).

## 2. Layout dos arquivos (pasta `firmware/pili_lave_totem/`)

| Arquivo | O que é | Pode editar? |
|---|---|---|
| `pili_lave_totem.ino` | TODO o firmware novo (UI LVGL, Asaas, ESP-NOW, fila) | sim |
| `pili_lave_config.h` | Config do operador (WiFi, chave Asaas, preços, PIN, ROLE) | sim |
| `pili_lave_espnow.h` | Protocolo binário entre as placas | com cuidado (ver §5) |
| `esp_panel_board_supported_conf.h` | Seleciona `BOARD_WAVESHARE_ESP32_S3_TOUCH_LCD_7` | NÃO mexer |
| `esp_panel_board_custom_conf.h` | Desativado (`USE_CUSTOM 0`) | NÃO mexer |
| `esp_panel_drivers_conf.h`, `esp_utils_conf.h` | Config dos drivers do painel | NÃO mexer |
| `lvgl_v8_port.cpp/.h` | Port LVGL (task própria + double buffer PSRAM) | NÃO mexer |
| `pili_font_14/16/20/28.c` | Montserrat com acentos, ranges `0x20-0x7F, 0xB0, 0xC0-0xFF` | não |

Esses arquivos "NÃO mexer" vieram **prontos e testados** do projeto irmão
`C:\Users\Daniel Anders\pili_build\pili_disp7` (dashboard PILI TECH que já
roda nesta mesma placa). Se algo do display quebrar, compare com o original.

## 3. Toolchain desta máquina (Windows)

- `arduino-cli`: `C:\Users\Daniel Anders\arduino-cli-bin\arduino-cli.exe`
- Core: `esp32:esp32` **3.3.8**
- FQBN: `esp32:esp32:esp32s3:PSRAM=opi,PartitionScheme=huge_app`
  (**PSRAM=opi é obrigatório** — o framebuffer vive na PSRAM octal)
- Bibliotecas (pasta única, passar com `--libraries`):
  `C:\Users\Daniel Anders\OneDrive\3. DANIEL ANDERS\Documentos\Arduino\libraries`
  - ESP32_Display_Panel 1.0.4, ESP32_IO_Expander, esp-lib-utils
  - LVGL **8.3.11** — o `lv_conf.h` fica NA RAIZ dessa pasta de bibliotecas
    (`LV_USE_QRCODE 1`, `LV_COLOR_DEPTH 16`, Montserrat 14–32 habilitadas)
  - ArduinoJson **7.4.3** (API v7: `JsonDocument`, filtros ok) — **ATENÇÃO**:
    a cópia do OneDrive é placeholder não baixado (dá "Invalid argument" no
    gcc e arrasta um falso "Preferences.h: No such file"). Use a cópia local
    `C:\Users\Daniel Anders\pili_build\extra_libs\ArduinoJson` passando
    `--library <caminho>` (essa flag tem prioridade sobre `--libraries`).
- Build dir usado: `C:\Users\Daniel Anders\pili_build\pililave_out`
- Comando completo de build/upload: ver `README.md` deste diretório.
- Status verificado em 2026-08-12: ROLE 1 compila (48% flash / 55% RAM) e
  ROLE 2 compila (43% flash / 55% RAM), zero warnings de erro.

## 4. Arquitetura interna do firmware (IMPORTANTE)

Duas tasks FreeRTOS relevantes:

1. **Task do LVGL** (criada por `lvgl_port_init`) — roda os callbacks de toque
   e o `uiTimerCb` (500 ms). **Regra de ouro: nenhum callback de UI faz rede,
   NVS ou ESP-NOW.** Eles apenas setam flags (`g_req`, `g_selOrigin`,
   `g_selWash`) e trocam de tela.
2. **Task Arduino `loop()`** — consome `g_req`, faz HTTP (bloqueante, ok
   porque o LVGL roda em task própria), NVS, fila e ESP-NOW. Toda atualização
   de UI feita a partir do `loop()` fica entre `lvgl_port_lock(-1)` /
   `lvgl_port_unlock()` — sem exceção, senão corrompe o LVGL.

Callbacks do ESP-NOW rodam na task do WiFi: só copiam bytes para buffers
`volatile` (`g_rxStart`, `g_rxAck`, status) e setam dirty-flags; o `loop()`
processa (`processStart()`, `processAck()`).

### Máquina de estados do pagamento (só TOTEM)
`PS_IDLE → (REQ_PAY_*) cria cobrança → PS_WAITING (poll 3 s) →`
- aprovado (`RECEIVED|CONFIRMED|RECEIVED_IN_CASH`) → `releaseWash()` → `PS_IDLE`
- `PENDING|AWAITING_RISK_ANALYSIS` → continua
- outro status → erro; timeout 5 min → cancela (`DELETE /payments/{id}`)

### Fila de liberação (só TOTEM)
`releaseWash()` monta um `PiliLaveStart`, grava na **fila persistente em NVS**
(`g_queue[4]`), incrementa contadores e transmite. O `loop()` retransmite o
primeiro item a cada 5 s até chegar `ACK.accepted==1` com o mesmo `seq`
(aí faz pop e manda o próximo). Sobrevive a reboot e a máquina ocupada.
**Um pagamento aprovado nunca se perde.**

### Dedup na MÁQUINA
- `seq` é um contador persistente do totem (NVS `seq`).
- Máquina guarda `maqLastSeq` (NVS): START repetido com o mesmo `seq` responde
  `accepted=1` sem iniciar de novo (idempotente). Ocupada com seq diferente →
  `accepted=0` + tempo restante (totem mantém na fila).

## 5. Protocolo ESP-NOW (`pili_lave_espnow.h`)

- Broadcast MAC FF:FF:FF:FF:FF:FF, sem pareamento. Magic `0xA8`, versão `1`.
  (O magic `0xA7` pertence ao sistema PILI TECH de sensores — outro produto do
  mesmo dono; não colidir.)
- Mensagens: `START(1)` totem→máquina, `ACK(2)` máquina→totem, `STATUS(3)`
  broadcast da máquina a cada 2 s (estado/restante/ciclos — o totem mostra
  "Máq. livre/lavando/sem sinal" na barra superior).
- Structs `#pragma pack(1)` — se alterar QUALQUER campo, **suba
  `PILI_LAVE_VERSION` e regrave as duas placas**.
- Canal: ESP-NOW exige as duas placas no mesmo canal WiFi. Com as duas no
  mesmo roteador isso é automático. Sem WiFi, `espnowScanChannel()` procura o
  SSID configurado só para copiar o canal.

## 6. Integração Asaas (só TOTEM)

- Base URL no config: sandbox `https://api-sandbox.asaas.com/v3`,
  produção `https://api.asaas.com/v3`.
- Auth: header `access_token: <chave>`. **A CHAVE AINDA NÃO FOI COLOCADA** —
  o usuário (Daniel) vai fornecer; cole em `PILI_ASAAS_API_KEY`.
- Endpoints usados:
  - `POST /customers` (uma vez, se `PILI_ASAAS_CUSTOMER_ID` vazio; id cacheado
    em NVS `asaasCus`)
  - `POST /payments` — `{customer, billingType, value, dueDate, description}`
  - `GET /payments/{id}/pixQrCode` — usamos só o campo `payload` (o
    `encodedImage` base64 é ignorado via filtro do ArduinoJson; o QR é
    renderizado localmente com `lv_qrcode`)
  - `GET /payments/{id}` — só o campo `status`
  - `DELETE /payments/{id}` — cancelamento/timeout (melhor esforço)
- HTTPS com `setInsecure()` (sem validação de CA). Melhoria futura: pinning.
- Débito: Asaas não tem billingType "débito" nativo; botão DÉBITO cria
  cobrança `UNDEFINED` (cliente escolhe no checkout do celular). Crédito usa
  `CREDIT_CARD`. Ajustável em `PILI_BILLING_*`.

## 7. Chaves NVS usadas (namespace `pililave`)

`seq`, `queue`+`queueN` (fila), `hoje`+`hojeKey`+`total` (contadores do totem),
`asaasCus` (id do cliente Asaas), `maqCiclos`, `maqLastSeq` (máquina).

## 8. Estado atual e pendências

- [x] Firmware completo escrito; base de display herdada de projeto que já
      roda nesta placa.
- [x] Compilação local com arduino-cli (ver README; se acabou de clonar,
      rode o build para validar).
- [ ] **Colar a chave Asaas** em `PILI_ASAAS_API_KEY` (Daniel vai passar).
- [ ] Configurar `PILI_WIFI_SSID/PASS` reais.
- [ ] Gravar placa 1 (ROLE 1) e placa 2 (ROLE 2) e testar ponta a ponta:
      PIX sandbox → aprovado → máquina pulsa GPIO6.
- [ ] Definir o que o GPIO6 aciona no mundo real (relé → CLP/contactora).
- [ ] Opcional: backend (`PILI_BACKEND_URL`) para registrar lavagens no
      sistema EAZE/Harbor do Daniel (há um Next.js em
      `OneDrive/4. APLICATIVOS/EAZE_PILI_HARBOR/app`).

## 9. Armadilhas conhecidas (não caia nelas)

1. **Não** faça HTTP/NVS/ESP-NOW dentro de callback LVGL (trava/corrompe).
2. **Não** atualize widget fora de `lvgl_port_lock()` quando estiver no `loop()`.
3. Strings com acento na UI → use as fontes `pili_font_*` (as Montserrat
   embutidas do LVGL não têm `ã é ç`; os símbolos `LV_SYMBOL_*` só existem
   nas embutidas — por isso os ícones de status são círculos/texto).
4. `PSRAM=opi` ausente = tela preta/boot loop.
5. O `lv_conf.h` que vale é o da **raiz da pasta de bibliotecas** (OneDrive),
   não um local do sketch.
6. ArduinoJson é **v7**: use `JsonDocument` (não `DynamicJsonDocument`).
7. Core esp32 3.x: callback ESP-NOW é `(const esp_now_recv_info_t*, ...)`.
8. `dueDate` da cobrança precisa de hora certa → NTP precisa sincronizar antes
   da primeira venda (o firmware bloqueia venda até `g_timeOk`).
