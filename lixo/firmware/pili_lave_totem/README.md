# PILI LAVE — Firmware do Totem + Máquina

Firmware para **Waveshare ESP32-S3-Touch-LCD-7** (800×480, touch GT911).
O **mesmo sketch** roda nas **duas placas** — muda apenas `PILI_LAVE_ROLE` em
`pili_lave_config.h`:

| ROLE | Placa | Função |
|------|-------|--------|
| `1`  | TOTEM | UI cliente/lavador, cobrança Asaas (PIX/débito/crédito), libera a lavagem |
| `2`  | MÁQUINA | Recebe a liberação via ESP-NOW, pulsa o relé de partida, mostra andamento |

## Fluxo do totem

```
Início ──► CLIENTE ──► Tipo de lavagem (1..4) ──► PIX / DÉBITO / CRÉDITO ──► QR na tela
   │                                                        │
   │                                              pagamento aprovado (poll Asaas)
   │                                                        ▼
   └──► LAVADOR ──► PIN ──► Tipo de lavagem ──────► START via ESP-NOW ──► MÁQUINA inicia
```

- **PIX**: cria cobrança na API Asaas, mostra o QR do "copia e cola" na tela e
  consulta o status a cada 3 s. Aprovou → libera.
- **DÉBITO / CRÉDITO**: o totem não tem maquininha — mostra o QR do **checkout
  Asaas** (`invoiceUrl`); o cliente escaneia e paga **no próprio celular**.
  O totem faz o mesmo poll de status.
- **LAVADOR**: digita o PIN (`PILI_LAVADOR_PIN`), escolhe o tipo e libera direto,
  sem cobrança. Tudo é registrado (contadores em flash + POST opcional ao backend).
- A liberação entra numa **fila persistente** (flash): se a máquina estiver ocupada
  ou sem sinal, o totem reenvia o START a cada 5 s até receber ACK — nada se perde,
  nem com queda de energia.

## Arquivos

| Arquivo | Papel |
|---------|-------|
| `pili_lave_totem.ino` | Firmware principal (UI, Asaas, ESP-NOW, fila) |
| `pili_lave_config.h` | **Edite aqui**: WiFi, chave Asaas, preços, PIN, papel da placa |
| `pili_lave_espnow.h` | Protocolo ESP-NOW compartilhado entre as placas |
| `esp_panel_*_conf.h`, `esp_utils_conf.h` | Config do ESP32_Display_Panel (board Waveshare LCD-7 já selecionada) |
| `lvgl_v8_port.*` | Port LVGL 8 (task própria, tearing evitado) — herdado do pili_disp7 |
| `pili_font_*.c` | Montserrat 14/16/20/28 com acentos (Latin-1) |

## Dependências (já instaladas nesta máquina)

- Arduino core **esp32 3.3.8** (`esp32:esp32`)
- **ESP32_Display_Panel 1.0.4** + esp-lib-utils + ESP32_IO_Expander
- **LVGL 8.3.11** com `lv_conf.h` na pasta de bibliotecas (`LV_USE_QRCODE 1`)
- **ArduinoJson 7.4.3** — ⚠️ a cópia do OneDrive está como *placeholder* não
  baixado (compila com erro "Invalid argument"); use a cópia local em
  `C:\Users\Daniel Anders\pili_build\extra_libs\ArduinoJson` via `--library`

Bibliotecas em: `C:\Users\Daniel Anders\OneDrive\3. DANIEL ANDERS\Documentos\Arduino\libraries`

## Compilar e gravar

```powershell
$cli  = "C:\Users\Daniel Anders\arduino-cli-bin\arduino-cli.exe"
$libs = "C:\Users\Daniel Anders\OneDrive\3. DANIEL ANDERS\Documentos\Arduino\libraries"
$aj   = "C:\Users\Daniel Anders\pili_build\extra_libs\ArduinoJson"
$sk   = "C:\Users\Daniel Anders\dev\pili-lave\firmware\pili_lave_totem"

# 1) edite pili_lave_config.h (ROLE, WiFi, chave Asaas)
& $cli compile --fqbn "esp32:esp32:esp32s3:PSRAM=opi,PartitionScheme=huge_app" `
       --library $aj --libraries $libs `
       --build-path "C:\Users\Daniel Anders\pili_build\pililave_out" $sk

# 2) gravar (placa em modo normal; segure BOOT+RESET se não entrar sozinha)
& $cli upload -p COM7 --fqbn "esp32:esp32:esp32s3:PSRAM=opi,PartitionScheme=huge_app" `
       --input-dir "C:\Users\Daniel Anders\pili_build\pililave_out" $sk
```

> Grave a **placa 1 com `PILI_LAVE_ROLE 1`** (totem) e a **placa 2 com
> `PILI_LAVE_ROLE 2`** (máquina). `PSRAM=opi` é obrigatório.

## Configurar o Asaas

1. Painel Asaas → **Integrações → API** → gere a chave e cole em `PILI_ASAAS_API_KEY`.
2. Comece no **sandbox** (`https://api-sandbox.asaas.com/v3`); em produção troque
   `PILI_ASAAS_BASE_URL` para `https://api.asaas.com/v3`.
3. Cliente das cobranças: cole um id em `PILI_ASAAS_CUSTOMER_ID` **ou** deixe `""`
   e preencha `PILI_ASAAS_CUSTOMER_CPF` (o firmware cria o cliente sozinho na
   primeira venda e guarda o id na flash).

## Ligação entre as placas (ESP-NOW)

- Sem fio, sem pareamento (broadcast). Exigência única: **mesmo canal WiFi**.
  Conecte as duas no mesmo roteador e pronto. Se a máquina ficar sem WiFi, ela
  escaneia o SSID configurado só para descobrir o canal.
- Confiabilidade: START reenviado a cada 5 s até o ACK; seq com dedup na máquina
  (replay não inicia lavagem dupla); fila sobrevive a reboot (NVS).

## Relé de partida (placa MÁQUINA)

- Pino padrão: **GPIO6** = pino `AD` do conector **Sensor AD** (3V3 | GND | AD).
- Pulso HIGH de 1 s no início da lavagem (`PILI_RELAY_*` no config).
- Use um módulo relé 3V3 ou optoacoplador para acionar o CLP/contactora.

## Limitações e notas

- **HTTPS sem validação de certificado** (`setInsecure()`): padrão pragmático em
  ESP32; para endurecer, fixe o root CA do Asaas em `asaasRequest()`.
- Débito/crédito dependem dos meios habilitados na sua conta Asaas; o botão
  DÉBITO usa `billingType UNDEFINED` (cliente escolhe no checkout) — ajustável
  em `PILI_BILLING_*`.
- Sem internet o fluxo do **cliente** fica indisponível (mensagem na tela); o
  fluxo do **lavador** continua funcionando (só ESP-NOW).
- Backend opcional: preencha `PILI_BACKEND_URL` para receber um POST JSON por
  lavagem (formato no comentário do config).
