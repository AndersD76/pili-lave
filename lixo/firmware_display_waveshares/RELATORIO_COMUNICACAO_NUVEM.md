# RELATÓRIO — Comunicação com a Nuvem (Wi-Fi + Heartbeat via Câmera)
**Projeto:** Lava Car Now — pasta `lava_car_now_app`
**Data:** 2026-08-27
**Escopo:** Tudo que foi feito DEPOIS dos relatórios anteriores
(`RELATORIO_INTEGRACAO_APP.md`, `RELATORIO_MUDANCAS_SESSAO.md`). Cobre a
sincronização de canal ESP-NOW×Wi-Fi, a blindagem de segurança do manual, o
ajuste da licença, toda a saga de conexão Wi-Fi, a descoberta da limitação de
RAM/TLS no display e a **arquitetura final: a câmera como gateway de nuvem**.

> IMPORTANTE p/ próximas sessões: este documento é a fonte de verdade do que
> mudou. Se algo aqui contradiz o código, o código venceu — reveja e atualize.

---

## 1. RESUMO EXECUTIVO — o que está funcionando

| Item | Status |
|---|---|
| Máquina **manual** | ✅ Funciona; **nunca trava** por Wi-Fi/app/câmera (blindagem) |
| Máquina **automática** (X1/X2/X5/X6) | ✅ Funciona **offline** (licença é offline-safe) |
| **Wi-Fi do display** | ✅ Conecta sozinho no `PILI-ADM` (credenciais fixas/seed no NVS) |
| **ESP-NOW + Wi-Fi juntos** | ✅ Waveshares respondem no canal do roteador com Wi-Fi ligado |
| **Nuvem (heartbeat)** | ✅ Via **câmera** (gateway). Display mostra `[HB] OK(via cam)` a cada 10s |
| **Licença** | ✅ Pagamento 50d / comunicação 15d / sem Wi-Fi NÃO bloqueia |
| **Câmera LPR (foto/placa)** | ⏸️ ADIADO — modo gateway (sem capacitor não segura o módulo) |

**Evidência final capturada:** display na COM15 mostrando `[HB] OK(via cam)
lamp=0 start=0 dias=0 blk=0` 4× seguidas, `reportou falha: 0`, `cred enviadas: 0`,
e `[DBG]` das waveshares vivo (I/O no canal 10 coexistindo com o Wi-Fi).

---

## 2. O PROBLEMA CENTRAL E A ARQUITETURA FINAL

### 2.1 Rádio único: ESP-NOW × Wi-Fi
O ESP32 tem **um só rádio**. O ESP-NOW das waveshares usava canal fixo 1; o
roteador `PILI-ADM` está no **canal 10**. Com o ESP-NOW travando o canal 1, o
Wi-Fi nunca associava (erro "Peer channel is not equal to the home channel").

**Solução (sincronização de canal):**
- Todos os peers ESP-NOW passaram a usar **`channel = 0`** (seguem o rádio).
- O display **descobre o canal do AP por scan ANTES de conectar**, avisa as
  waveshares por `MSG_CANAL` (varrendo o rádio 1–13 pra alcançá-las em qualquer
  canal) e alinha o próprio rádio; só então faz `WiFi.begin`.
- As waveshares tratam `MSG_CANAL` e trocam o canal do rádio (aplicado no
  `loop()`, fora do callback).
- Resultado: todos convergem no canal do roteador; máquina + Wi-Fi + câmera
  coexistem.

### 2.2 Display não tem RAM para TLS → câmera é o gateway
Descoberta decisiva: o display (ESP32-S3 + LVGL + framebuffer) fica com **~10 KB
de heap interno livre** (`ESP.getFreeHeap()`), e o **TLS/HTTPS precisa de ~40 KB**
→ o `POST` retornava `code=-1` (connection refused; até o DNS retornava
`0.0.0.0`). Confirmado que o buffer do LVGL já está na PSRAM (modo avoid-tearing 3
usa os framebuffers da PSRAM), então não havia como liberar 40 KB no display.

**Arquitetura adotada:** a **câmera (ESP32-CAM, sem LVGL, ~267 KB livres)** faz o
HTTPS. Fluxo:
```
Display  --MSG_HB_STATE (ESP-NOW, tipo 7)-->  Câmera
Câmera   --POST /api/machine/heartbeat (HTTPS)-->  Backend (Railway)
Backend  --resposta JSON (lightState/license/start)-->  Câmera
Câmera   --MSG_HB_RESP (ESP-NOW, tipo 8)-->  Display  (aplica lamp/licença/start)
```

---

## 3. MUDANÇAS NO DISPLAY (`lava_car_now_app/display/`)

### 3.1 `wifi_manager.h` — conexão Wi-Fi robusta + sincronização de canal + blindagem
- **Peers em canal 0** (câmera e broadcast) — seguem o rádio.
- **`_maquina_ocupada()`** (REGRA DE SEGURANÇA): retorna true se
  `g_vfd_mov != 0 || g_estado_auto != AUTO_IDLE || home_rodando() ||
  recuperacao_ativa()`. O Wi-Fi só mexe no rádio (scan/hop) quando a máquina
  está OCIOSA — **nunca durante movimento/ciclo**, senão o comando ESP-NOW se
  perde e o manual "não responde".
- **`_wifi_enviar_msg_canal(canal, varrer)`**: quando `varrer=true`, varre o
  rádio 1–13 mandando 2× por canal (broadcast sem ACK) pra convergir as
  waveshares; deixa o rádio no canal alvo no fim. Quando `varrer=false`, manda
  só no canal atual (barato).
- **`_wifi_sync_e_conectar(ssid, pass, permitir_scan)`**: usa canal já descoberto
  (flag `_wifi_canal_conhecido`) pra **NÃO re-scanear** a cada tentativa (o scan
  abortava a conexão em andamento — era a causa do "nunca conecta"). Faz
  `WiFi.disconnect(false,false)` antes do `begin` p/ estado limpo.
- **`wifi_init()`**: NÃO conecta no boot (a máquina pode estar em recuperação/
  HOME). Agenda a 1ª tentativa pro `wifi_tick` fazer quando ociosa. Registra
  `WiFi.onEvent(_wifi_on_event)` que loga o `reason` de desconexão.
- **`wifi_tick()`**: só (re)conecta com máquina ociosa E `!_wifi_pausar_auto`.
  Contador `_wifi_falhas`: após 6 falhas força novo scan (recupera troca de canal
  do roteador).
- **`wifi_pausar_auto(bool)`**: a tela de config chama isto p/ pausar o
  auto-connect e liberar o rádio pro scan/save da UI.
- **`_wifi_on_event(...)`**: imprime `[WIFI] desconectado reason=N`, `associado`,
  `GOT_IP` — diagnóstico.

### 3.2 `nvs_manager.h` — SEED de credenciais fixas (migração única)
Adicionado `#define NVS_MIG_WIFI1 "mig_wifi1"` e, no `nvs_init()`, um bloco de
**migração única** (padrão dos `NVS_MIG_*` já existentes):
```c
if (!_nvs.isKey(NVS_MIG_WIFI1)) {
    _nvs.putString(NVS_WIFI_SSID, "PILI-ADM");
    _nvs.putString(NVS_WIFI_PASS, "@2019@2020");
    _nvs.putString(NVS_API_BASE,  "https://pili-lave-production.up.railway.app");
    _nvs.putBool(NVS_MIG_WIFI1, true);
}
```
**Por quê:** a tela de Wi-Fi é sensível/difícil de digitar e o scan às vezes não
achava a rede; o seed faz o display conectar sozinho **sem tela nenhuma**. Corrige
também um SSID errado que tinha sido salvo por engano ('Visitantes'). A tela ainda
permite trocar a rede depois.

### 3.3 `tela_wifi.h` — SSID digitável + pausa do auto-connect
- Trocado o **dropdown de redes** por um **campo de texto `ta_ssid`**
  pré-preenchido com o SSID salvo (ou "PILI-ADM") — não depende mais do scan.
- Botão "Buscar" virou auxiliar (lista as redes no status).
- `tela_wifi_ativar()` chama `wifi_pausar_auto(true)`; `cb_wifi_salvar` e
  `cb_wifi_voltar` chamam `wifi_pausar_auto(false)`.

### 3.4 `licenca.h` — comunicação 7 → 15 dias
`#define LIC_COMM_DIAS 15` (era 7). Regras finais:
- **Trava 1 (pagamento):** avisa aos **40 dias**, bloqueia aos **50 dias**
  (`LIC_AVISO_DIAS 40`, `LIC_BLOQUEIO_DIAS 50`). Vem do backend.
- **Trava 2 (comunicação):** bloqueia após **15 dias** seguidos sem heartbeat OK,
  e **só arma depois do 1º heartbeat OK na vida** (`nvs_has_last_hb_ok()`).
- **Sem Wi-Fi (nunca conectou):** nenhuma trava arma → máquina funciona sempre.
  Um Wi-Fi caindo por horas/1 dia NÃO bloqueia.

### 3.5 `backend_client.h` — heartbeat via ESP-NOW (não faz mais HTTPS)
- **`_backend_heartbeat()`** agora **manda `MSG_HB_STATE` pra câmera**
  (`esp_now_send` p/ `MAC_CAMERA`) com o estado (`state[12]`, `restanteSeg`).
  Não faz mais `POST` (o display não tem RAM p/ TLS).
- **`backend_espnow_handle(mac,data,len)`** (novo, chamado pelo `comm_espnow`):
  recebe `MSG_HB_RESP`, aplica `g_lamp_state`, `nvs_set_lic_days/blocked`,
  `g_start_cmd`, marca `g_backend_ok` + `g_hb_last_ok` + `nvs_set_last_hb_ok`.
  Imprime `[HB] OK(via cam) lamp=.. start=.. dias=.. blk=..`.
- **Flush de eventos por HTTP DESABILITADO** (car-entered/wash-complete/fault
  ficam enfileirados no NVS — **Fase 2**: relay pela câmera). Sem isso, cada ciclo
  tentaria um TLS que falha e polui o log/gasta RAM.
- Correção de TLS (`WiFiClientSecure + setInsecure`) foi adicionada mas ficou
  como código de referência — o caminho HTTP do display não é mais usado no
  heartbeat.

### 3.6 `tipos.h` — novos tipos de mensagem
```c
MSG_HB_STATE = 7,   // display -> câmera
MSG_HB_RESP  = 8,   // câmera -> display
```
Structs (packed) — **têm que bater byte-a-byte com a câmera**:
```c
typedef struct __attribute__((packed)) {
    CabEspNow cab; char state[12]; uint32_t restanteSeg;
} MsgHbState;
typedef struct __attribute__((packed)) {
    CabEspNow cab; uint8_t ok; uint8_t lightState; uint16_t lic_days;
    uint8_t lic_blocked; uint8_t start_valido; uint8_t start_prog;
    uint32_t start_dur; char start_res[40];
} MsgHbResp;
```

### 3.7 `comm_espnow.h` — roteamento do MSG_HB_RESP
- Forward-decl `bool backend_espnow_handle(...)`.
- No `espnow_on_recv`: `if (cab->tipo == MSG_HB_RESP) { backend_espnow_handle(...); return; }`
  (ao lado do já existente `MSG_WIFI_REQ -> wifi_espnow_handle`).

---

## 4. MUDANÇAS NAS WAVESHARES (`waveshare1/` e `waveshare2/`)
(feitas na etapa de sincronização de canal; ambas idênticas fora do MAC/mapa I/O)
- `enum` ganhou `MSG_CANAL = 4`; struct `MsgCanal { CabEspNow cab; uint8_t canal; }`.
- `on_recv` trata `MSG_CANAL` ANTES do check de tamanho do `MsgComando`
  (MsgCanal é menor); grava `g_canal_novo`.
- Peers com `p.channel = 0` (segue o rádio).
- No início do `loop()`: se `g_canal_novo`, aplica
  `esp_wifi_set_channel(ch,...)` (com promiscuous on/off) e loga `[WAVE1/2] canal -> N`.

---

## 5. MUDANÇAS NA CÂMERA (`C:\Users\giova\Documents\PlatformIO\pili_camera\`)

### 5.1 `platformio.ini`
- Adicionado `lib_deps = bblanchon/ArduinoJson@6.21.5` (parse da resposta do backend).

### 5.2 `src/main.cpp` — câmera vira gateway de nuvem
- **Tipos espelhados do display:** `MSG_HB_STATE=7`, `MSG_HB_RESP=8`,
  structs `MsgHbState`/`MsgHbResp` idênticas, e `_light_code(String)` que mapeia
  o `lightState` string → código igual ao enum `LampState` do display
  (OFF=0, GREEN_SOLID=1, GREEN_BLINK=2, RED_SOLID=3, RED_BLINK=4, RED_GREEN_ALT=5).
- **Credenciais FIXAS** (elimina o pareamento ESP-NOW, que era frágil com o
  display travado no canal 10):
  ```c
  #define CAM_SSID_FIXO   "PILI-ADM"
  #define CAM_PASS_FIXO   "@2019@2020"
  #define CAM_API_FIXO    "https://pili-lave-production.up.railway.app"
  #define CAM_DEVKEY_FIXO "pili-cam-01"
  ```
  No `setup()`, se o NVS não tiver creds, usa as fixas e salva (`temCreds=true`).
  O pedido por ESP-NOW (`pedirCredenciais`) ficou como **fallback** (se as fixas
  falharem, ex.: rede mudou).
- **`onRecvImpl`** trata `MSG_HB_STATE`: guarda `g_hb_state[12]` + `g_hb_restante`.
- **`fazerHeartbeat()`** (novo): `POST <api>/api/machine/heartbeat` com o estado
  guardado; parse com ArduinoJson; monta `MsgHbResp` e manda pro display
  (`esp_now_send` p/ `MAC_DISPLAY`). LED: **2 piscadas = OK**, **4 piscadas =
  Wi-Fi ok mas POST falhou**. Chamada no `loop()` a cada 10s (prioridade, antes do LPR).
- **ANTI-BROWNOUT (câmera reiniciava em loop `rst:0x1 POWERON_RESET`):**
  1. `WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0)` no início do `setup()`.
  2. `WiFi.setTxPower(WIFI_POWER_11dBm)` no `espnowInit()`.
  3. **Câmera (OV2640) inicializada só DEPOIS do Wi-Fi conectar** (o pico de
     corrente de parear/conectar acontece com o módulo desligado).
- **`#define PILI_LPR_ATIVO 0` (MODO GATEWAY):** o módulo da câmera fica
  DESLIGADO — só o heartbeat roda. Com o módulo ligado, o pico (Wi-Fi TX +
  câmera) derruba o TLS do POST (brownout) **sem capacitor**. Guardas `#if
  PILI_LPR_ATIVO` no `setup()` (init pós-Wi-Fi) e no `loop()` (LPR).

---

## 6. CREDENCIAIS E CONSTANTES (têm que bater entre firmwares)
- `ID_MAQUINA = 1`
- Wi-Fi: SSID **`PILI-ADM`**, senha **`@2019@2020`** (2.4 GHz, canal 10 no local)
- Backend: **`https://pili-lave-production.up.railway.app`**
  - `POST /api/machine/heartbeat` → responde `{lightState, start, license{daysWithoutPayment, blocked}}`
  - `POST /api/lpr/frame` (câmera LPR — pendente)
  - device-key da câmera: `pili-cam-01` (o heartbeat responde 200 com ou sem chave)
- MACs lógicos: DISPLAY `{0x02,0x00,0x00,1,0x01,0x01}`, WAVE1 `..0x02`,
  WAVE2 `..0x03`, CAMERA `{0x02,0x00,0x00,1,0x01,0x04}`
- Tipos ESP-NOW: EVENTO=1, HEARTBEAT=2, COMANDO=3, CANAL=4, WIFI_REQ=5,
  WIFI_CFG=6, **HB_STATE=7, HB_RESP=8**
- Licença: aviso 40d, bloqueio pagamento 50d, bloqueio comunicação **15d**

---

## 7. PROCEDIMENTO DE GRAVAÇÃO (WSL2 → Windows) — ARMADILHAS

### Display (ESP32-S3, conector CH343/UART = COM15)
- **Boot manual obrigatório:** segura BOOT → aperta/solta RST → **solta BOOT**.
- **NUNCA gravar o `merged.bin`** por esptool: ele tem 16 MB (padding) e o flash
  sem stub é lento; pior, escrever de 0x0 pra frente **apaga o NVS** (partição em
  0x9000) → perde credenciais/configs. **Já aconteceu nesta sessão** (apagou o
  Wi-Fi salvo).
- **Gravar SÓ os bins separados** (preserva o NVS):
  ```
  python -m esptool --chip esp32s3 --port COM15 --baud 460800 --no-stub \
    --before no-reset --after hard-reset write-flash --flash-mode keep \
    0x0 display.ino.bootloader.bin 0x8000 display.ino.partitions.bin \
    0x10000 display.ino.bin
  ```
  (bins exportados com `arduino-cli compile --output-dir .../build_out`)
- `--before no-reset` porque o auto-reset do esptool não pega nesse conector; por
  isso o boot manual. O `hard-reset` do esptool **não** faz o board bootar nesse
  conector → depois de gravar, **apertar o RST físico** (só RST) pra rodar o app.
- Se ficar em `boot:0x0 (DOWNLOAD)` / "waiting for download" = BOOT ficou
  pressionado no reset; apertar **só RST**.
- FQBN display: `esp32:esp32:esp32s3:CDCOnBoot=default,FlashMode=qio,FlashSize=16M,PartitionScheme=default_8MB,PSRAM=opi,CPUFreq=240`
- Serial do display sai na UART0/CH343 (COM15) por causa do `CDCOnBoot=default`.
- `PYTHONIOENCODING=utf-8` + `PYTHONUTF8=1` (senão UnicodeEncodeError).

### Waveshares (ESP32-S3 USB nativo)
- WAVE1 na COM9, WAVE2 na COM10 (variam). Auto-reset às vezes falha → boot manual
  + esptool `--before no-reset`; ou `arduino-cli compile --upload`.
- FQBN waveshare: `...CDCOnBoot=cdc,...` (USB nativo).

### Câmera (ESP32-CAM, COM16)
- PlatformIO: `C:\Users\giova\.platformio\penv\Scripts\pio.exe run -d <proj> -t upload --upload-port COM16`
- **Monitorar a COM16 via .NET SerialPort RESETA a câmera** → não dá pra observar
  o estado "conectado" ao vivo. **Confirmar sempre pelo display (COM15)**
  (`[HB] OK(via cam)`) ou pelo **LED da câmera** (2 piscadas/10s = nuvem OK).
- Processos `python.exe` do esptool/monitor **ficam pendurados segurando a porta**
  ("Acesso negado"/"port is busy"); matar antes de regravar
  (`Get-Process python | Stop-Process -Force`).

---

## 8. COMO REATIVAR A CÂMERA LPR (quando tiver capacitor)
1. Ligar a câmera numa **fonte 5V firme (≥1A)** + **capacitor 470–1000 µF** entre
   5V e GND, colado na placa, fios curtos e grossos.
2. Em `pili_camera/src/main.cpp`, trocar `#define PILI_LPR_ATIVO 0` → **`1`**.
3. Recompilar e regravar a câmera (COM16, ainda com USB antes de ir pra fonte fixa).
4. A câmera passa a inicializar o OV2640 depois do Wi-Fi e a mandar as fotos pra
   `/api/lpr/frame`, **além** do heartbeat. Nenhuma outra mudança necessária.

---

## 9. PENDÊNCIAS / FASE 2
- **Câmera LPR** (foto/placa): depende do capacitor + `PILI_LPR_ATIVO 1` (§8).
- **Relay dos eventos** (car-entered / wash-complete / fault): hoje ficam
  enfileirados no NVS do display e NÃO são enviados (flush HTTP desabilitado).
  Fase 2: mandar pela câmera (novo tipo de mensagem ESP-NOW display→câmera com o
  evento; câmera faz o POST no endpoint certo). Já existem `backend_evt_*` que
  enfileiram; falta o transporte.
- **device-key da máquina** no heartbeat: hoje a câmera manda `pili-cam-01`; o
  backend aceita 200 com ou sem chave. Se o backend passar a exigir uma chave de
  MÁQUINA específica, configurar.
- **Sincronização de hora**: sem RTC/NTP; `nvs_set_last_hb_ok` usa
  `esp_timer_get_time()` (segundos desde boot) como aproximação p/ a trava de 15d.

---

## 10. HISTÓRICO DE DIAGNÓSTICOS (pra não repetir)
- **"Wi-Fi nunca conecta":** era o re-scan a cada 10s abortando a conexão em
  andamento (`WiFi.scanNetworks` enquanto STA connecting). Resolvido com
  `_wifi_canal_conhecido` (não re-scaneia depois de achar o canal).
- **"Manual não responde":** o Wi-Fi mexia no rádio (scan bloqueante ~2,6s a cada
  10s) durante a operação. Resolvido com o gate `_maquina_ocupada()`.
- **Credenciais sumiram:** o `merged.bin` parcial apagou o NVS (§7). Resolvido com
  o seed em `nvs_manager.h` + gravar só bins separados.
- **`[HB] falha code=-1` mesmo conectado:** display sem RAM p/ TLS
  (`heap=10008, maxblk=7668`). Resolvido movendo o HTTPS pra câmera.
- **Câmera reiniciando em loop:** brownout do ESP32-CAM. Mitigado (§5.2) +
  modo gateway.
- **Câmera não pareava:** ESP-NOW frágil com display travado no canal 10.
  Resolvido com credenciais FIXAS na câmera (conecta direto).
- **POST da câmera falhava (`ok=0`):** módulo OV2640 ligado causava brownout no
  TLS. Resolvido com `PILI_LPR_ATIVO 0` (gateway).

---

## 11. ARQUIVOS TOCADOS NESTA ETAPA
**Display:** `wifi_manager.h`, `nvs_manager.h`, `tela_wifi.h`, `licenca.h`,
`backend_client.h`, `tipos.h`, `comm_espnow.h`
**Waveshares:** `waveshare1/waveshare1.ino`, `waveshare2/waveshare2.ino`
**Câmera:** `pili_camera/platformio.ini`, `pili_camera/src/main.cpp`

Todos compilam limpos. Display ~40% flash; câmera (gateway) ~35% flash, RAM 18,5%
(~267 KB livres — folga p/ TLS).
