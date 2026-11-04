# PILI CLEAN — Guia Técnico Completo

> Documento de referência de tudo que existe no sistema, **atualizado em 2026-11-03** (escrito originalmente em 2026-09-19; firmware reescrito neste dia para refletir o que está gravado na máquina: W1 controladora, W2 por cabo UART, display e câmera v7): firmware (display, Waveshares, câmera), backend, app mobile, PWA, painel admin e banco de dados. Escrito a partir da leitura completa do código-fonte — quando algo é uma limitação conhecida ou pendência, está marcado explicitamente.

---

## 1. Visão geral

PILI CLEAN é um sistema de lavagem automática de carros **sem operador fixo no local**: o cliente reserva/paga pelo app, a câmera reconhece a placa do carro na chegada, a máquina libera sozinha e executa o ciclo de lavagem automaticamente.

**Por máquina física instalada**, o hardware é:
- 1 **display** touchscreen (ESP32-S3, tela LVGL 800×480) — interface do painel físico e **hub da nuvem** (fala com a câmera e manda ordens à W1).
- 2 **Waveshares** ESP32-S3-POE-ETH-8DI-8DO (8 entradas + 8 saídas cada): a **W1 é a controladora** (executa o ciclo de lavagem) e a **W2 é só E/S** (sensores e saídas); ligadas entre si por **cabo UART**.
- 1 **inversor de frequência** Delta MS300 — controla o motor (giro do braço / deslocamento do carrinho), em RS-485 com a W1. A bomba de alta pressão tem um segundo inversor (SAJ), fora do RS-485 (parte por terminal, frequência fixa).
- 1 **câmera** ESP32-CAM (AI-Thinker) — tira fotos da placa e é o **único ponto de conexão com a internet** da máquina.
- (opcional, por máquina) 1 **aspirador de pó**, ligado via relé (DO8 da Waveshare 2), controlado pelo app (ver seção 6.6c).

**Softwares:**
- **App mobile** (Expo/React Native) — cliente final: cadastro, compra de lavagem, acompanhamento.
- **PWA** (Next.js, dentro do próprio `server/`) — versão web do app, mesma função.
- **Backend** (Next.js API Routes + Prisma + Postgres) — cérebro de tudo: pagamento, fila, reconhecimento de placa (IA), heartbeat das máquinas, admin.
- **Painel admin** (dentro do `server/`) — visão gerencial, cadastro de lavadores, preço por unidade, divisão admin/lavador, controle de licença/pagamento por máquina.

> **IMPORTANTE (descoberto em 09-19): o app mobile nunca foi publicado.** A pasta `mobile/` (Expo/React Native) não está distribuída em nenhuma loja (Play Store/App Store) nem como APK/TestFlight — ela só roda hoje via Expo Go apontando pra um servidor de desenvolvimento. Isso significa que **o PWA (`server/app/(pwa)/app/`, acessado pelo navegador no domínio do Railway) é hoje a ÚNICA forma real de um usuário de produção — cliente, lavador ou parceiro — usar o sistema.** Todo o trabalho de paridade do PWA com o app nativo (seção 8) existe por causa disso: o PWA não é um "extra", é o produto em uso.

**Hospedagem:** backend no **Railway** (`pili-lave-production.up.railway.app`), banco Postgres no **Neon**.

**Ambiente de teste local:** desde 2026-09-18 existe um Postgres local (`pililave_dev`) pra testar sem tocar em produção — `server/.env` aponta pra ele por padrão; `server/.env.production` guarda as credenciais reais (nunca carregado por `next dev`). Migrações precisam ser aplicadas **manualmente** nos dois lados (`npx prisma migrate deploy`, trocando o `.env` temporariamente pra produção) — o deploy do Railway **não roda migração sozinho**.

---

## 2. Arquitetura de comunicação (o pulo do gato)

**Arquitetura atual (gravada na máquina em 2026-11-02):**

```
                         cabo UART0 (GPIO43/44, 115200)
[Waveshare 1 = W1] <==============================> [Waveshare 2 = W2]
 controladora: máquina de estados,                    E/S "burra": sensores X10..X17,
 ciclo, giro, HOME, protocolo com o Delta             saídas (bombas, solenoides, Y14, luzes, aspirador)
    |         |
    | RS-485  +----ESP-NOW (canal do roteador)----> [Display] <----ESP-NOW----> [Câmera]
    v                                                (cliente fino + hub da nuvem)   |
 [Delta MS300]  (SAJ da bomba fora do RS-485,                                      HTTPS
  parte por terminal)                                                                |
                                                                                     v
                                                                            [Backend / Nuvem]
```

Pontos importantes:
- **A W1 é a controladora e só opera**: um defeito na nuvem ou no display não pode derrubar o controle no meio de uma lavagem. Ela fala RS-485 só com o Delta, cabo UART com a W2, e ESP-NOW com o display (e recebe a hora da câmera).
- **A W2 não tem rádio** no firmware atual (o link por cabo existe porque o ESP-NOW entre W1 e W2 deixava a W2 "muda" por 160–208 s em 29–31/10, e a W1 deixava de ver o X10). Se a W1 some, a W2 desliga as saídas sozinha em 2 s (menos as luzes).
- **O display NÃO tem Wi-Fi/internet** (não tem RAM suficiente pra TLS). Ele fala ESP-NOW com a câmera e com a W1, e é o **hub da nuvem**: faz o heartbeat (a cada 5 s), guarda a fila de eventos (com ACK) e manda **ordens** à W1 a cada 2 s (lâmpada, licença, aspirador, iniciar reserva do app).
- **A câmera é o gateway de nuvem**: conecta no Wi-Fi, é a "mestre de canal" (avisa display e W1 em qual canal do rádio ela está), e faz todo o HTTPS (heartbeat, fotos LPR, eventos, provisionamento, reinícios das placas). Também pega a **hora por NTP** e repassa à W1 (`MSG_HORA`).
- Todos no **mesmo canal** (o do roteador). A migração de canal é orquestrada pelo display (câmera → W1 → credenciais), com rollback; a câmera pede **re-sync** ao display se o roteador mudar de canal.
- **ESP-NOW é rádio de curto alcance** (dezenas de metros) — isso é usado deliberadamente como trava de segurança na troca de peça (ver seção A.9).
- **Achado real em teste de bancada (09-19)**: quando a câmera muda de rede Wi-Fi (e portanto de canal) com tudo já em operação, o display **não tinha como descobrir sozinho** o canal novo. Corrigido com o "modo caça" (ver A.4) e, depois, com o re-sync (câmera v5+).

**Histórico.** Até 2026-10 a produção era o firmware `lava_car_485/` (display como mestre, RS-485 para as duas Waveshares). Em 2026-10 a controladora passou para a W1 (`testes/`, ESP-NOW com a W2) e em 2026-11-02 o ESP-NOW W1↔W2 foi trocado pelo cabo. Tudo o que é antigo foi movido para `lixo/` (mapa em `lixo/LEIAME.md`); a descrição dele está nos Apêndices A e B.

---

## 3. Firmware atual da máquina — controladora (W1) e display (`testes/`)

### 3.1 Visão geral e onde está cada coisa

| Peça | Placa / porta | Código | Como gravar |
|---|---|---|---|
| **W1** (controladora) | Waveshare ESP32-S3-POE-ETH-8DI-8DO, COM24 | `testes/w1_w2_por_rxtx/waveshare1/` | `arduino-cli upload`, FQBN `esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc,UploadSpeed=230400` |
| **W2** (E/S) | idem, COM10 | `testes/w1_w2_por_rxtx/waveshare2/` | mesmo FQBN |
| **Display** | ESP32-S3-Touch-LCD-7, COM11 | `testes/display/` | FQBN `esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi,FlashSize=16M`; compilar leva 5–17 min; nunca dois compiles ao mesmo tempo; às vezes precisa BOOT+RESET |
| **Câmera** | ESP32-CAM | `firmware_camera/` (PlatformIO) | OTA (seção 5.1) |

Regras de operação ao mexer no firmware: **só gravar com o "grava" explícito do Giovani**; abrir a serial da W1 **reinicia** a W1 (e o log de boot às vezes não aparece: `DBG` só imprime com o host conectado); fechar qualquer script de captura da serial antes de gravar; a **câmera tem OTA** (sem cabo), o **display e as Waveshares exigem cabo USB**.

Os firmwares antigos (ESP-NOW entre W1 e W2, `lava_car_485`, `wave1_mestre`, diagnósticos) estão em `lixo/`. A cópia ESP-NOW de produção (`lixo/testes/waveshare1|2`) continua compilando, mas **gravá-la quebra o cabo** (as duas placas precisam estar no mesmo modo).

### 3.2 W1 — arquivos e responsabilidades (`testes/w1_w2_por_rxtx/waveshare1/`)

| Arquivo | O que faz |
|---|---|
| `waveshare1.ino` | `setup()`/`loop()`, ordem de inicialização |
| `tipos_w1.h` | tipos, estados, protocolo de teste (`g_estado_auto`, `g_pausa_x10`…) |
| `maquina_estados.h` | **máquina de estados do ciclo automático** e todas as proteções (pausa por W2, X10, X15, duração máxima, recuperação de boot) |
| `processos.h` | sub-máquinas de cada etapa (Pré-lavagem/Enxágue, Alta Pressão com giro triplo, Espuma A/B, Cor Mágica, Cera d'água, Secagem), **giro** (`giro_iniciar`, `giro_tick`, rebobinar), carrinho |
| `controle.h` | E/S das duas placas (espelho de entradas/saídas da W2), HOME, manual com homem morto, painel físico/controle remoto (X1,X2,X5,X6 = modelos 1..4; X4 = pausar/continuar), status para o display |
| `vfd_rs485_w1.h` | protocolo Modbus RTU com o Delta MS300 (só ele no RS-485) |
| `saj_rs485_w1.h` | controle do SAJ (bomba) por RS-485 — **desligado** (`TESTE_SAJ_POR_RS485 0`); o SAJ parte por terminal, frequência fixa |
| `nuvem_w1.h` | recebe as ordens do display (`MSG_NV_ORDEM`), inicia o ciclo do app, lâmpada, aspirador, manda eventos (`MSG_NV_EVT`) e guarda até 16 na NVS até o ACK |
| `reset_log_w1.h` | registro permanente de reinícios (W1/W2), retrato da etapa, ocorrências O1..O6, envio à nuvem |
| `link_cfg.h`, `link_frame.h`, `link_w2_uart.h` | transporte UART W1↔W2 (seção 4.2); `LINK_W1_W2_UART` 1 = cabo, 0 = ESP-NOW antigo |
| `comm_espnow.h`, `nvs_manager.h`, `protocolo_teste.h` | ESP-NOW com display/câmera; NVS; mensagens (seção 3.8) |

**Máquina de estados** (`maquina_estados.h`):
```
IDLE -> AGUARDA_CARRO -> CARRO_ENTRANDO (X14) -> AGUARDA_POS (X15)
     -> INICIANDO (6 s, luz vermelha) -> PROCESSO (sub-máquinas) -> CONCLUIDO -> IDLE
                      \-> PAUSADO (8)   \-> ERRO (7)   \-> HOME / recuperação
```
- A luz verde só acende quando a lavagem foi **liberada** (app ou controle remoto/botão INICIAR AUTOMATICO) — é a autorização para o carro entrar.
- **Erro** = `auto_erro()`: para tudo, vermelho piscando, **sem HOME automático** (o HOME automático com carro dentro já bateu o braço no carro em 2026-10-25), manda `fault` à nuvem (o backend marca a reserva FAILED e **estorna na hora**). PARAR TUDO e CANCELAR do operador também mandam a falha quando o ciclo era do app.
- **Pausar/continuar** (`auto_pausar`/`auto_retomar`): para o motor, desliga bombas/solenoides/compressor e guarda o movimento, a frequência e as saídas; ao continuar religa as saídas, espera **2 s de pressão** (`RETOMAR_PRESSAO_MS`), re-emite o movimento e desloca os cronômetros de etapa e os watchdogs do X0 (`processos_shift_timers`, que agora inclui `_cr_t_pulso` e `_cx_t_pulso`: sem isso, uma pausa > 4 s dava CARRO TRAVADO ao retomar).
- **Giro** (`processos.h`): sub-máquina própria; 1→2 por tempo (sentido anti-horário, "A"), 2→1 até X16+X17 (HOME do braço). O giro triplo da Alta Pressão faz 1→2 (A), 2→1 (B), 1→2 (A); a volta repete a sequência. Tem rampa de desaceleração, debounce de sensores e "fine-home" por pulsos. O **HOME** do giro tem limite de **60 s** (`HOME_TIMEOUT_MS`; era 25 s e falhou com o braço longe do zero, andando devagar).
- **Carrinho**: avança com Y14 até perder o X10, volta até o X12 com rampa de 350 ms (`CARR_RAMPA_MS`); trava mútua Y4↔Y14 e cooldown de 500 ms no contator.
- **Painel físico / controle remoto**: o pedido de modelo só vale se o contato ficar ativo por **50 ms** (`PAINEL_PULSO_MIN_MS`; pulsos menores são ruído e saem como `[PAINEL] pulso curto descartado`); janela de 3 s depois de qualquer mudança de saída; ciclo armado só pelo painel expira em 3 min.
- **Tipos de ciclo** (`g_tipo_ciclo`): presencial, aplicativo, sócio, bônus — o `wash-complete` leva `source` `remote`/`socio`/`bonus` (o app usa a reserva).
- **Ao ligar a W1 sobe em COM X10 + BOMBA ON** (o display reassume isso ao sair do TECNICO). No modo **SECO** o X10 é simulado e as esperas não valem.

### 3.3 Proteções e watchdogs da W1 (todos gravados)

- **Pausa por falha da W2:** sem quadro da W2 por 1,5 s o ciclo **pausa** e retoma sozinho ao voltar; 10 min sem voltar = erro. A idade do último quadro é calculada com `hb2_idade_ms()` (diferença **com sinal**).
- **Armadilha recorrente (3 vezes em 2026-11-02): subtração de tempo sem sinal** entre a tarefa de recepção (UART/ESP-NOW grava `g_hb2`, `g_t_app_armado`…) e o laço principal: se a tarefa grava um instante mais novo que o `millis()` já lido, `agora - t` dá ~4 bilhões. Sempre usar `(int32_t)(agora - t)`. Já corrigidos: HOME "falhou por comunicação", START do app cancelado na hora, `comm_perdida()` verdadeiro com o cabo perfeito.
- **Recuperação de boot:** ao ligar fora do zero (HOME do giro e X12 não ok) **nada se move**; vermelho piscando e a tela pede o toque em **HOME** no display (HOME obrigatório pelo botão). Com carro no X15 pede para retirar o veículo. A recuperação reavalia o zero: X16+X12 estáveis por 1500 ms encerram a espera. 3 falhas seguidas do HOME = desiste e fica em ERRO.
- **Duração máxima do ciclo:** 30 min em PROCESSO (pausa não conta) = para tudo, sem HOME (`CICLO_MAX_MS`).
- **Prazo de 3 min** nos estados "carro entrando"/"aguardando posição": ciclo armado só pelo painel desarma e apaga o verde; ciclo do **app** que não chega ao X15 em 3 min é cancelado com `errorCode` `X15_POSICAO` (o backend devolve a reserva para a fila, sem estorno).
- **O app prevalece** sobre um ciclo armado só pelo painel que ainda não começou o processo; reserva do app que some da nuvem desarma o ciclo (8 s, só com a nuvem online).
- **X15 perdido por 3 s no processo** = para tudo e fica em erro, sem HOME.
- **Delta mudo:** 20 leituras seguidas sem resposta com a máquina parada = mensagem na tela e contador na NVS (não bloqueia). **Leitura do código de falha do Delta/SAJ não existe** (endereço do registrador não confirmado).
- **Monitor de memória** (a cada 10 s; < 40 KB registra, < 20 KB com a máquina parada reinicia; nunca no meio de ciclo) e **vigia do envio de rádio** (reinicia só o ESP-NOW; nunca reinicia a W1 no meio de ciclo).
- **Caixa-preta na NVS** (`erro`, `w2`, `tx`, `mem`), impressa no boot como `[BOOT]`.
- **Pulso de vida em IO1** (GPIO1, alterna a cada 3 s): para o futuro supervisor externo (`docs/SUPERVISOR_HARDWARE.md`); IO1 confirmado funcionando.
- **Homem morto** no movimento manual: só enquanto o botão é segurado; sem sinal do display por 0,5 s o motor para; teto de 20 s.

### 3.4 X10 (carro sob a mesa) e as regras de proteção do ciclo

Especificação completa: `docs/REGRAS_RETOMADA_CICLO.md` (G1–G15, tabela de pontos de interrupção, parâmetros). O que **está programado e gravado** (2026-11-02, commits `3532e38`…`b5d08b8`, função `x10_pausa_tick()` em `maquina_estados.h`):

| Regra | Comportamento na máquina | Estado |
|---|---|---|
| **G3** X10 é pré-requisito | Antes de **cada etapa** o X10 tem que ler o carro; sem ele a etapa não começa (`g_x10_segura`) até o X10 ficar estável por 1500 ms. No início (AUTO_INICIANDO) a luz vermelha não conta e nada liga sem X10; 60 s sem X10 = erro. | início: validado; entre etapas: **não testado** |
| **G4/G5** X10 sumiu sem deslocamento | "Ausente indevido" = X10 apagado **sem o carrinho ter andado 3 s** (Y14 ligado) desde a última vez que o viu parado. Por 500 ms → **PAUSA** (motor parado, bombas/solenoides desligados); X10 de volta e estável 1500 ms → **retoma sozinho**; 60 s sem X10 → ERRO ("Sem X10 (carro sob a mesa) por 60 s - lavagem cancelada"). Sair do X10 andando (≥ 3 s) é normal e não pausa. | giro: validado; demais etapas e retorno ao X12: **não testado** |
| **G8** giro 1→2 interrompido | Ao voltar o X10, **rebobina** até X16+X17 (posição 1) a 5 Hz (`GIRO_REWIND_HZ10 50`, limite 30 s) no sentido oposto e **refaz** o giro. Giro 2→1 interrompido: retoma normalmente. | 1→2: validado |
| Ocorrências O1..O6 | A Fase 0 **observa e registra** (retrato + diário) sem decidir nada (seção 3.7). | gravado |

Constantes: `X10_PERDIDO_MS 500`, `X10_VOLTA_MS 1500`, `X10_PAUSA_MAX_MS 60000`, `X10_ESPERA_MAX_MS 60000`. O X10 não vale no SECO nem nos testes técnicos.

**Ainda NÃO programado** (nada disto existe no firmware): G6 (X13 com X10 ausente), G7 (carrinho parado na frente após reinício), G8b (giro triplo da volta a 5 Hz sem repetir), **retomada no meio do movimento depois de reinício** (Fase 1/2, G9/G12/G15), 5 Hz também no giro 2→1 retomado, leitura da posição 2 sem X17 (P1). Hoje, depois de um reinício no meio do ciclo a W1 **não retoma**: registra, avisa e o backend cancela e estorna a lavagem do app.

### 3.5 Display (`testes/display/`)

Cliente fino em LVGL 8.4, 800×480, abre no **AUTOMATICO**. Arquivos: `display.ino` (telas, estado), `nuvem_display.h` (hub da nuvem), `wifi_tecnico.h` (Wi-Fi/rede do técnico), `cadastro_tecnico.h` (cadastro da máquina), `protocolo_teste.h` (**idêntico** ao da W1; conferir com `cmp`), `logo_pili.h`, porting LVGL.
- **AUTOMATICO:** PARAR TUDO, HOME, CONFIG (senha 1111), MANUAL; 4 modelos, INICIAR AUTOMATICO, PAUSAR (vira **CANCELAR ESPERA** quando a W1 espera o carro); **TECNICO** (senha 2828); tipo do próximo ciclo (presencial > aplicativo > sócio > bônus; volta a presencial a cada ciclo); planilha de lavagens por modelo e tipo e **PAGAMENTO EFETUADO** (senha 3462 → acerto).
- **MANUAL:** HOME, giro e carrinho (segurando), válvulas, espumas, cor mágica, secagem, cera (só parado, desligam sozinhas em 60 s). Y13 só no TECNICO.
- **TECNICO:** BOMBA ON/OFF, HOME, INICIAR TESTE, PARAR, CARRO SECO/REAL, Wi-Fi/rede (rede e senha guardadas, painel `Canal N W1: ok W2: ok / Câmera: vista Nuvem: ONLINE`, rede da câmera), cadastro da máquina (nova / trocou display / trocou câmera: ainda **não testado** na base nova).
- **CONFIG:** velocidades e pressões por modelo, esperas por etapa, atrasos em carro real, tempo do giro 1→2 por processo, sequência dos modelos, alterar senhas (ficam na memória do display).
- Avisos de fim de ciclo (erro = pop-up com OK; sucesso = aviso curto); "SEM CONTATO COM A MAQUINA" quando perde a W1 por > 5 s (e avisa a câmera "ocupada").
- **Watchdog de tarefa (20 s)** e vigia do envio de rádio (reinicializa só o ESP-NOW; 3 tentativas sem resolver reinicia o display); envia `FAULT` no heartbeat quando a W1 está em ERRO.
- Displays novos sem flat do toque (GT911): `docs/TROCA_DE_DISPLAY.md`. Em caso de tela branca, ver a seção do FQBN em 3.1.

### 3.6 Nuvem e fluxo do app na base atual

O display conversa com a câmera (`nuvem_display.h`: heartbeat a cada 5 s; fila de eventos na NVS com ACK; licença 40/50 dias + 15 dias ligada sem comunicação) e manda ordens à W1 a cada 2 s (`MSG_NV_ORDEM`: lâmpada, licença, aspirador, reserva do app). Sem ordens por 60 s a W1 age em modo seguro. A W1 manda eventos (`MSG_NV_EVT`, confirmados por `MSG_NV_EVT_ACK`) e guarda até 16 na NVS.

**Fluxo com o app (validado de ponta a ponta em 2026-10-25 e de novo em 2026-11-02):** reserva paga (HELD) → a câmera lê a placa ou o cliente toca "Já estou na máquina" (ACTIVE: luz verde, o heartbeat devolve `start`) → o display repassa à W1, que arma o ciclo e espera o X14 → `car_entered` (ENTERED) → ciclo → `wash_completed` (COMPLETED). Em erro ou cancelamento a W1 manda `fault` e o backend estorna.
O START do app tinha um defeito de subtração sem sinal que o cancelava na hora (`carro nao chegou na posicao em 3 min`); corrigido em `nuvem_w1.h`.
Lâmpada: a W1 ociosa segue a lâmpada do backend; acesa (DO7 da W2) durante o ciclo, fica mais 10 min e apaga. Aspirador = DO8 da W2.

### 3.7 Registro de reinícios, relógio e ocorrências (Fase 0)

- **Reinícios:** a W1 guarda cada reinício (W1 e W2) na NVS (motivo, estado antes do reset, tempo ligada, total, se estava em ciclo) e manda à nuvem como evento **tipo 4** (display → câmera → `POST /api/machine/reset-log`). Só envia **depois de receber `MSG_HORA`** da câmera nova (senão uma câmera antiga prenderia a fila de eventos de lavagem). O texto leva `;t=<epoch>`.
- **Relógio:** a câmera pega NTP e manda `MSG_HORA` (41) a cada 30 s; a W1 mantém o relógio na RAM (some em corte total de energia).
- **Retrato da etapa** (`J;…`): processo, sub-estado, giro, modelo, entradas/saídas das duas placas, frequência; checkpoint na NVS a cada troca de etapa/giro. **Ocorrências** (`O;…`): O1 X10 apagou sem 3 s de Y14, O2 X13 com X10, O3 X12 com X13, O4 X15 sem carro, O5 X10 apagou durante o giro, O6 HOME falhou por comunicação com a W2. Só registro e aviso, 1 por tipo a cada 5 min.
- **Diário X14/X15** na W2 (`MSG_W2_DIARIO` 42 → `LT_DIARIO` pelo cabo): bordas enquanto a W1 estava fora.
- **Regra do backend:** a W1 reiniciou em ciclo → reservas do app ACTIVE/ENTERED que começaram **antes** do reset são canceladas e estornadas na hora (só com a hora do reset conhecida). Reinício da W2 não cancela (a W1 pausa e retoma). Queda **total** de energia aparece como "energia ligada" sem estado anterior e não cancela sozinha; o cron de expiração é a rede de segurança. Ver 6.12.

### 3.8 Protocolo ESP-NOW (`protocolo_teste.h`)

Idêntico em `testes/display/` e `testes/w1_w2_por_rxtx/waveshare1/`. 4–22 compatíveis com a câmera; 30–42 da base atual:

| Mensagens | Uso |
|---|---|
| 4–6, 11–12, 21 | canal, Wi-Fi (`MSG_WIFI_REQ/CFG`), scan de redes, re-sync |
| 7–10 | heartbeat (`MSG_HB_STATE/RESP`) e eventos (`MSG_EVT/ACK`) display↔câmera |
| 13–20 | cadastro: provisionar, identidade, busca de unidades, troca de câmera |
| 22 | `MSG_REDE_INFO`: rede Wi-Fi da câmera mostrada no display |
| 30–35 | teste/config: comando e status do display↔W1, tabelas de configuração (NVS da W1), data |
| 36–38 | `MSG_NV_EVT`, `MSG_NV_EVT_ACK`, `MSG_NV_ORDEM` (W1↔display) |
| 40–42 | `MSG_W2_BOOT`, `MSG_HORA` (câmera→W1), `MSG_W2_DIARIO` (os de W2 viajam pelo cabo como `LT_*`) |

### 3.9 Validado na máquina x pendente (resumo em 2026-11-03)

- **Validado em 2026-11-02:** loopback do cabo nas duas placas; 10 min parado e ~13.000 quadros em produção com tudo zero (um único quadro com CRC ruim no dia); HOME (depois das correções); ciclo a seco; ciclo com bomba; lavagem completa pelo app; pulso de vida IO1; X10 no início, X10 no giro (pausa, rebobina, refaz).
- **Pendente de teste na máquina** (o Giovani testa em outro dia): X10 removido no retorno ao X12; X10 removido entre etapas (espera G3); retomada com os watchdogs do X0; uma lavagem real completa com todas as proteções.
- **Aberto:** pulsos fantasmas nas entradas do painel (~44 por ciclo de 80 s, não vêm do RS-485; o filtro de 50 ms os descarta); X15 instável (ajuste mecânico/cabo/blindagem); Y7 bloqueado na Cor Mágica (`io1_set_do` só aceita Y2/Y3/Y10: o Giovani mandou não mudar por enquanto); câmera: conferir que o OTA para a v7 aconteceu (`flags=4`); validar no admin os reinícios e ocorrências quando a câmera nova enviar; filtro do RS-485 e recolocar o SAJ no barramento (teste à parte); supervisor externo de hardware (`docs/SUPERVISOR_HARDWARE.md`); Delta parar na perda de comunicação Modbus.
- Lista viva e completa: `testes/PENDENCIAS_NA_MAQUINA.md` (seções H–O) e `docs/ESTADO_ATUAL.md`.

---

## 4. Firmware atual da W2 e o link W1↔W2 por cabo

### 4.1 W2 — entradas e saídas "burras" (`testes/w1_w2_por_rxtx/waveshare2/waveshare2.ino`)

Um único arquivo. Sem rádio, sem lógica de ciclo: lê as 8 entradas (X10–X17, lógica NPN ativa em nível baixo, **latch por interrupção** com debounce de 800 µs) e manda para a W1; recebe ordens de saída e as aplica via expansor I2C PCA9554.
- Saídas: Y10 (bomba espuma baixo), Y12 (luz vermelha), **Y13 (bomba alta pressão, canal 3)**, **Y14 (contator do deslocamento; cooldown de 500 ms antes de religar)**, luzes da máquina no **DO7**, aspirador no **DO8**; o canal **Y15/DO5 é bloqueado** por segurança e nunca aciona.
- **Fail-safe:** sem nenhum quadro da W1 por **2 s**, desliga todas as saídas (bombas, solenoides, contator do carrinho, aspirador), **menos as luzes (DO7)**; quando a W1 volta, o reconciliador dela reenvia o que quer ligado.
- **Watchdog de tarefa de 8 s** (reinicia a W2 se o laço travar; no boot as saídas ficam desligadas). Avisa a W1 do reinício (uptime no `LT_HB`; `MSG_W2_BOOT` no ESP-NOW antigo).
- Diagnóstico: `[WAVE2LINK]` a cada 30 s e `[WAVE2] FAIL-SAFE…` no serial.

### 4.2 Link por cabo UART0 (`docs/LINK_W1_W2_UART.md`)

- **Fiação:** TXD (GPIO43) de uma → RXD (GPIO44) da outra, cruzado, com **100–330 Ω em série em cada linha**, GND comum, fio trançado de 10–15 cm longe da força. 3,3 V direto no chip, **sem isolação — nunca ligar 24 V nesses bornes**. O GPIO43 emite o texto de boot do ROM por instantes depois de cada reset (o protocolo descarta lixo e ressincroniza).
- **Quadro:** `A5 5A | tipo | seq (2 B LE) | len | payload | CRC16-CCITT (2 B LE)`, 115200 8N1, payload ≤ 128.
- **Tipos de produção:** `LT_HB` 0x10 (W2→W1, a cada 200 ms: entradas vivas, saídas, motivo do reset, uptime), `LT_EVT` 0x11 (W2→W1, a cada borda de entrada), `LT_CMD` 0x12 (W1→W2, ordem de saída; limite de 200 ms por canal, reconciliador de 400 ms, "desligar tudo" no boot), `LT_KEEP` 0x13 (W1→W2, sinal de vida a cada 200 ms), mais o diário X14/X15. Sem confirmação por quadro; a recepção na W1 roda no **callback da UART**, não no laço.
- **Diagnóstico:** `[W2LINK]` na W1 a cada 5 s (quadros ok, CRC ruim, truncados, espúrios, erros da UART, maior intervalo, motivo do último reset e uptime da W2, reinícios detectados).
- **Chave de reversão:** `LINK_W1_W2_UART` em `link_cfg.h` (1 = cabo, 0 = ESP-NOW antigo, código preservado); trocar nas **duas** pastas, recompilar e regravar as duas placas. Outras vias de volta: backup das placas (`testes/w1_w2_por_rxtx/backup_atual/`, cópias completas fora do git em `Documentos\pili_backups_flash_2026-11-02`) e a tag `backup-antes-link-uart-2026-11-01`.
- **Migração de canal:** a W2 saiu da conversa; a W1 confirma o canal novo ouvindo o display (12 s) em vez de ver a W2.
- **Resultado medido:** loopback OK nas duas placas; 10 min parado e ~13.000 quadros em produção com tudo zero, silêncio máximo 200 ms.

---

## 5. Firmware da Câmera — `firmware_camera/`

Roda num ESP32-CAM (AI-Thinker, sensor OV2640). Arquivo único `src/main.cpp` + `src/pili_cam_config.h`. **Versão atual: v8** (`PILI_FW_VERSION`; v8 = diagnóstico da câmera para a nuvem e etapa da lavagem no heartbeat): v5 = comando de canal do display e re-sync automático; v6 = informa ao display a rede Wi-Fi conectada (`MSG_REDE_INFO`); v7 = evento tipo 4 (reinícios, retrato e ocorrências das placas) com `POST /api/machine/reset-log` e **hora por NTP** repassada à W1 (`MSG_HORA`). Regra de publicação por OTA: `firmware_camera/release/LEIAME.md`.

**Papel: gateway de nuvem "burro de propósito".** Não tem sensor de presença, não decide nada — manda uma foto crua pro backend a cada 8s (`PILI_ENVIO_INTERVALO_MS`), sempre, tenha carro ou não. Toda a inteligência (ler a placa, decidir se tem carro, liberar a máquina) roda na **nuvem** via IA.

Funções principais:
- **Modo CONFIG vs CONECTADA**: sem credenciais salvas (NVS vazia), fica no canal 1 pedindo config (`MSG_WIFI_REQ`) até o display responder. Com credenciais, conecta e vira mestre de canal.
- **Heartbeat** a cada 10s: `POST /api/machine/heartbeat` com o estado que o display mandou; relay da resposta (lâmpada/licença/start/aspirador) de volta pro display.
- **LPR**: máquina de estados não-bloqueante — no máximo 1 tentativa HTTP por passagem do `loop()`, timeout de 15s (`PILI_LPR_HTTP_TIMEOUT`), até 3 tentativas antes de descartar o frame. JPEG com qualidade reduzida (`PILI_JPEG_QUALITY`, 12→20, ~120KB→~90KB) — achado real (10-06): payload menor facilita achar um bloco de heap contíguo grande o bastante pra TLS numa memória fragmentada, reduzindo bastante falha de envio ("Failed to send chunk").
- **Relay de eventos** (car-entered/wash-complete/fault): recebe do display por ESP-NOW, faz o POST, e só confirma (`MSG_EVT_ACK`) quando o backend responde 200 — garante que o débito nunca se perde. `wash-complete` com `source="remote"` (lavagem presencial, sem reserva) vira um registro de `LavagemPresencial` na nuvem (ver 6.6) em vez de ser descartado como "órfão".
- **Watchdog de ESP-NOW**: se ficar 60s sem NENHUM envio bem-sucedido (não só falha de resposta — falha ao enviar mesmo), reinicia o chip sozinho.
- **Watchdog geral de 30s (novo, 10-06)**: além do watchdog específico de sensor (abaixo), o sistema inteiro tem um `esp_task_wdt` de 30s — se o `loop()` não conseguir "alimentar" o watchdog por esse tempo (travado em qualquer ponto), reinicia sozinho. Achado real: o Arduino-ESP32 3.x já sobe com um watchdog padrão de fábrica ativo (timeout curto) — `esp_task_wdt_init()` falha silenciosamente com "already initialized" nesse caso, e é preciso usar `esp_task_wdt_reconfigure()` pra realmente trocar o timeout. Desligado explicitamente só durante o upload do OTA e do envio de foto LPR (operações que podem legitimamente passar de 30s numa rede lenta, sem estarem travadas de verdade) e religado logo depois.
- **Recuperação do sensor de imagem**: se `esp_camera_fb_get()` falhar 3 vezes seguidas (~24s), reinicia só o módulo da câmera (`esp_camera_deinit` + `hardResetSensor` + `cameraInit`) — achado real: erros de I2C/SCCB no boot deixavam o sensor OV2640 preso sem gerar nenhum log depois disso (heartbeat continuava OK, mas nenhuma foto nova por minutos).
- **Pausa do anúncio ESP-NOW durante o envio da foto**: o anúncio de canal (1x/s) disputava o mesmo rádio com o upload HTTPS da foto (maior que o heartbeat), causando falha de escrita na maioria das tentativas — agora pausa durante o `http.POST()` da foto e retoma logo depois.
- **Timeout de handshake TLS (adicionado 09-19)**: `tls.setHandshakeTimeout()` em **todas** as chamadas HTTPS. Achado real em teste de bancada: com Wi-Fi fraco/instável, o handshake TLS podia ficar pendurado indefinidamente e travava o chip inteiro (só um reset físico recuperava) — o `HTTPClient.setTimeout()` sozinho não cobria essa fase.
- **Provisionamento** (`MSG_PROV_REQ`): faz o POST de cadastro e guarda a identidade (cidade/rua/número/deviceKey) na própria NVS.
- **Identidade** (`MSG_IDENT_REQ`, troca de display): responde com o que já tem salvo, sem tocar na nuvem.
- **Busca de unidades** (`MSG_UNI_REQ`, 09-19): faz `GET /api/machine/unidades?cidade=X` e devolve a lista paginada por ESP-NOW.
- **Recebe identidade** (`MSG_IDPUSH_REQ`, troca de câmera, 09-19): aplica localmente o que o display mandou (`aplicarIdPush()`), sem chamada nenhuma pra nuvem.
- **Reinícios e ocorrências das placas (v7):** recebe do display o evento tipo 4 (texto compacto `W1;m=..;e=..` / `J;…` / `O;…`) e faz `POST /api/machine/reset-log` com `{key, info}`; só confirma (`MSG_EVT_ACK`) com resposta 200.
- **Hora (v7):** NTP (`pool.ntp.org`/`time.google.com`); manda `MSG_HORA` (epoch UTC) à W1 a cada 30 s, só com a hora válida.
- **Etapa da lavagem (v8):** o display acrescentou `proc` e `modelo` ao `MsgHbState` (só durante o ciclo: PROCESSO/PAUSADO); a câmera os leva no heartbeat como `"proc"` (aceita o `MsgHbState` antigo, sem os 2 bytes). A nuvem usa isso para o app listar as tarefas e marcar a atual (seção 6.13).
- **Diagnóstico (v8):** a cada 5 min (e se 3+ fotos seguidas falham, no máx. 1/min) faz `POST /api/machine/camera-diag` com Wi-Fi (RSSI mín/méd/máx, canal, quedas, maior tempo desconectada, buscas de rede), memória (heap e maior bloco livre, mínimos da janela), fotos/heartbeats ok e falha + último código de erro, motivo do último reinício (inclui o motivo do boot frio, antes do hard reset) e tempo ligada. Se o POST não sai, os contadores seguem acumulando. Só observa: não muda canal, conexão nem envio.
- **Comando serial de emergência** (`atenderComandoSerial()`, novo 10-06): aceita `WIFI:<ssid>:<senha>` via USB — grava direto na NVS sem precisar da tela do display, útil quando o touch não alcança o botão Salvar.

### 5.1 OTA (atualização por Wi-Fi) — novo 10-06

A câmera consegue se atualizar sozinha pela internet, **sem precisar de cabo USB** depois da primeira gravação:

- A cada 10 minutos (`PILI_OTA_CHECK_MS`, só quando conectada), confere `GET <api>/firmware/camera-version.json` (arquivo estático servido pelo Next.js, em `server/public/firmware/`).
- Se a versão publicada for maior que a gravada no firmware (`PILI_FW_VERSION`, em `pili_cam_config.h`), baixa `GET <api>/firmware/camera.bin` e grava via `Update.h` (biblioteca padrão do ESP32 pra OTA).
- **Só reinicia se a gravação fechar certinho** (`Update.end()` + `Update.isFinished()`) — senão continua rodando o firmware atual. Nunca troca pra uma imagem incompleta/corrompida sozinho.
- **Esquema de partições**: precisou trocar pra `min_spiffs.csv` (`board_build.partitions` no `platformio.ini`) — o esquema padrão da placa (`huge_app`) tem uma única partição de app de 3MB e **nenhuma sobra pra OTA** (`Update.begin()` falharia sempre). `min_spiffs` dá 2 partições de ~1.9MB cada (`ota_0`/`ota_1`), de sobra pro firmware atual (~1.2MB).

**Como publicar uma atualização nova** (depois da gravação inicial por USB):
1. Suba `PILI_FW_VERSION` no `pili_cam_config.h`.
2. Compile (`pio run`).
3. Copie `.pio/build/esp32cam/firmware.bin` por cima de `server/public/firmware/camera.bin`.
4. Suba o número em `server/public/firmware/camera-version.json`.
5. Commit + push (o Railway serve os arquivos estáticos automaticamente).

A câmera se atualiza sozinha no próximo ciclo de 10 minutos.

> ⚠️ O **display** não tem esse mecanismo — ele não tem Wi-Fi (ver seção 2), então não há como baixar um `.bin` direto. OTA do display exigiria relay via ESP-NOW (a câmera baixa o firmware do display e repassa em pacotes pequenos, ~250 bytes cada) — não implementado ainda (ver pendências, seção 11).

---

## 6. Backend — `server/` (Next.js 16, App Router, Prisma + Postgres/Neon)

### 6.1 Autenticação
Três sistemas de auth **separados e independentes**:
1. **Cliente do app**: e-mail + senha (`/api/auth/register`, `/api/auth/login`) — JWT de 180 dias guardado no `SecureStore` do celular. *(Login por SMS/OTP existe ainda no código — `lib/otp.ts` — mas não é mais usado por nenhuma tela; mantido só por legado.)* **Não existe "esqueci minha senha"** (removido a pedido — não enviamos nada por e-mail).
2. **Admin** (`/admin`): usuário + senha únicos (`ADMIN_USER`/`ADMIN_PASSWORD` no ambiente), cookie JWT de 7 dias. Sem essas variáveis configuradas, o painel fica **aberto sem senha** (fase de teste) — hoje já protegido em produção.
3. **Dispositivos** (display/câmera/máquina): header `x-device-key` — cada `Machine` tem seu próprio `deviceKey` único (`requireMachine()` resolve pelo header). Rotas de câmera legadas usam uma chave global (`DEVICE_KEY`) mais simples (`requireDevice()`).

### 6.2 Modelo de dados (Prisma) — visão geral
- **User**: cliente, lavador, parceiro ou admin (`role`: `CLIENT`/`LAVADOR`/`PARCEIRO`/`ADMIN`). Todo cadastro novo já nasce `CLIENT` (não existe opção "sou cliente" pra marcar). `walletCents` é um cache — a fonte da verdade é `WalletTx`.
- **SolicitacaoParceiro** (nova, 09-19): pedido de uma capacidade extra (`tipo`: `LAVADOR`/`COMISSAO1`/`COMISSAO2`/`ALUGUEL`) feito por um usuário, com `status` (`PENDENTE`/`APROVADA`/`REJEITADA`). Um mesmo usuário pode ter várias linhas pendentes ao mesmo tempo (tipos diferentes), aprovadas/rejeitadas **independentemente** uma da outra. Pode ser criada no cadastro (marcando várias capacidades de uma vez) ou depois, a qualquer momento, pelo Perfil.
- **MachineParticipante** (nova, 09-19): quem participa financeiramente de uma máquina — `machineId` + `userId` + `tipo` (enum `TipoParticipacao`: `LAVADOR`/`COMISSAO1`/`COMISSAO2`/`ALUGUEL`) + **`escopo`** (enum `ParticipacaoEscopo`: `LAVAGEM`/`ASPIRADOR`, novo 10-06) + `percentual`. Substitui o antigo split fixo 55/45. Lavagem e aspirador têm percentuais **independentes** por escopo (`@@unique([machineId, tipo, escopo])`). Ver 6.6 e 6.6c.
- **Vehicle**: placa normalizada, programa padrão.
- **Program**: os 4 tipos de lavagem — hoje só o **nome** é editável de forma centralizada (aba `/admin/precos`); o `precoCents` do Program é o valor de fábrica, praticamente não usado desde que o preço passou a ser por unidade (ver `StationPrograma`).
- **StationPrograma** (nova, 09-19): preço de um tipo de lavagem **numa unidade específica** — cada unidade cobra o valor que quiser, preenchido do zero (não herda de nenhum "padrão" central). `lib/precos.ts` (`precoEfetivo()`) resolve o preço certo na hora de cobrar.
- **WashStation**: a **unidade** (endereço — cidade + rua).
- **Machine**: a máquina física, pertence a uma `WashStation`, tem `numero` (posição na unidade), `deviceKey`, status ao vivo, sensores X14/X15, contadores de lavagem, controle de licença (`lastPaymentDate` — também serve de ponto de "fechamento" pra todo mundo que participa dela), `vacuumEnabled`/`vacuumPriceCents`/`vacuumDurationMin` (aspirador, novo 10-06, ver 6.6c), e a lista de `MachineParticipante` vinculados (Lavador, Comissão 1, Comissão 2, Aluguel — ver 6.6). O campo antigo `operadorId` foi substituído pelo participante do tipo `LAVADOR`.
- **VacuumUse** (nova, 10-06): um uso do aspirador — `userId`, `machineId`, `amountCents`, `durationSec`, `status` (`PAID` → `ACTIVE` → `COMPLETED`), `startedAt`, `completedAt`. Compra debita o crédito na hora (`PAID`); o cliente decide quando começar a contar o tempo (`ACTIVE`, botão "Começar agora"). Não depende de `Order`/`Reservation` — pode ser comprado solto, sem lavar o carro.
- **Order**: a compra (voucher). Status `PAID` → `REDEEMED` (lavagem concluída) ou `CANCELED` (estorno).
- **Reservation**: o motor real da fila — `HELD` (pago, esperando 1h) → `ACTIVE` (placa reconhecida, máquina livre, verde aceso) → `ENTERED` (X14 confirmou) → `COMPLETED` (**único ponto de débito de verdade**) / `EXPIRED` / `CANCELED` / `FAILED`.
- **LavagemPresencial** (nova, 09-19): uma linha por lavagem paga em dinheiro nos botões físicos X1-X6 — valor em R$ e data/hora exatos (o firmware só contava localmente, sem valor nem timestamp).
- **Arrival**: registro de cada leitura de câmera, pra exibição no app (`WAITING_DRIVER`, `SUGGESTED` quando a leitura foi de baixa confiança e bate com a fila).
- **WalletTx**: extrato real da carteira (TOPUP/WASH/REFUND/ADJUST).
- **PushSubscription**: inscrições de notificação push (Web Push/VAPID).
- **Event**: log genérico de auditoria (praticamente tudo relevante gera um Event).
- **Capture**: fotos que a câmera manda pro LPR + o que a IA leu (usado em `/capturas`).

### 6.3 Fluxo de reserva e pagamento
1. Cliente escolhe a **unidade primeiro** (obrigatório desde 09-19, ver 7 e 8), depois compra pelo app (`POST /api/orders`) → debita a carteira na hora, cria `Order` (PAID) + `Reservation` (HELD, válida por 1h). O preço já é o **da unidade escolhida** (`precoEfetivo`).
2. Quando o carro chega, a câmera lê a placa → `handlePlateRead()` promove `HELD` → `ACTIVE` (se a máquina estiver livre) ou mantém na fila com o relógio congelado (se estiver ocupada — não queima o tempo do cliente por culpa da operação).
3. Sensor X14 confirma o carro entrando → `ENTERED`.
4. Máquina reporta conclusão (`wash-complete`) → `COMPLETED` — **é aqui, e só aqui, que o valor é debitado de verdade** (a reserva só "segurava" o saldo). Se veio dos botões físicos (sem reserva), vira `LavagemPresencial` em vez de debitar carteira de ninguém.
5. **Estorno automático**: se a reserva vence (1h) sem ser usada, o valor volta sozinho pro saldo. Se a máquina travar durante a lavagem (2× a duração do programa sem concluir), também estorna sozinho.

**Alternativas de liberação sem câmera:**
- **"Cheguei" na compra** (`jaEstouNaMaquina`): libera na hora se a máquina estiver livre.
- **"Cheguei" numa reserva já existente** (`POST /api/reservations/[id]/confirmar-chegada`): pra quando a câmera não reconheceu a placa. Se a unidade tiver mais de uma máquina, pergunta qual (`escolherMaquina: true` + lista de números) antes de liberar.

### 6.4 Reconhecimento de placa (LPR)
`POST /api/lpr/frame` recebe o JPEG cru da câmera. Filtro de cena primeiro (compara tamanho do arquivo pra não gastar orçamento de IA em cena parada). A leitura em si é feita pela **API de visão da Anthropic** (`lib/vision-claude.ts`). Fallback: Plate Recognizer (se configurado) → Tesseract (bancada).

**Limpeza periódica das fotos** (`iniciarLimpezaPeriodica`, `server/lib/frames.ts`, novo 10-06): a cada 20s, zera só os **bytes JPEG** (não a linha) das capturas com mais de 2 minutos — a câmera manda 1 frame a cada ~8s o tempo todo, então sem isso a tabela `Capture` (que guarda o JPEG inteiro na própria linha) cresceria sem parar. O registro em si (placa, status, horário, nota) continua existindo pra sempre — é histórico. `/capturas` mostra "imagem expirada" pras que já foram limpas.

Leitura de alta confiança (≥0.97) libera sozinha; leitura fraca compara contra quem já pagou e está na fila — se bater com exatamente um veículo, cria uma "sugestão" (`Arrival.SUGGESTED`) que o motorista confirma no app ("é o seu carro?").

**Câmera ao vivo** (`/api/lpr/ao-vivo`, agora ligada na tela — era só backend até 10-06): sem `?img`, devolve metadados da captura mais recente (id/hora); com `?img=<id>`, devolve o JPEG daquela captura. Só libera pra quem **tem lavagem em andamento** (reserva viva) — câmera do pátio não é liberada pra qualquer um ver parado. As telas da unidade (mobile e PWA) fazem poll a cada 4s nos metadados e só baixam a imagem de novo quando o id muda; fora de uma lavagem ativa, mostram "Disponível quando sua lavagem estiver em andamento" em vez de ficar tentando.

### 6.5 Sistema multi-máquina
Uma unidade (`WashStation`) pode ter **várias máquinas** (`Machine.numero`). A compra não escolhe qual máquina — entra numa **fila única**: quando promove a reserva, pega **qualquer máquina livre daquela unidade** (`machineForStation()`). O cliente só escolhe manualmente quando libera sem câmera e há mais de uma máquina (ver 6.3).

**Provisionamento** (`POST /api/machine/provisionar`): cadastro automático de máquina nova — recebe o ID único do chip + unidade (existente por `stationId`, ou nova por cidade+rua) + número. Reconhece unidade já existente mesmo com **acento, maiúscula E prefixo de logradouro diferentes** ("Joao Carlon" == "Rua João Carlon", fix de 09-19 depois de uma duplicata real em produção). Protegido por `PROVISION_SECRET`.

**Busca de unidades** (`GET /api/machine/unidades?cidade=X`, nova 09-19): lista unidades existentes que batem com a cidade digitada, já com o **próximo número livre** de máquina calculado — usada pela tela de cadastro do display antes de criar uma unidade nova.

### 6.6 Sistema de participantes e divisão de comissão (N participantes por máquina)

O antigo split fixo 55%/45% lavador/admin foi substituído por um modelo de **N participantes por máquina** (`MachineParticipante`, ver 6.2). Cada máquina pode ter até 4 participantes cadastrados, um de cada `tipo` (`TipoParticipacao`):
- `LAVADOR` — quem opera a máquina no dia a dia, escaneia vouchers no balcão.
- `COMISSAO1` / `COMISSAO2` — dois "vendedores"/comissionados independentes.
- `ALUGUEL` — quem recebe pelo espaço onde a máquina está instalada.

**Regra fixa dos 100%**: a soma dos percentuais dos participantes cadastrados numa máquina nunca passa de 100%. O que sobrar até 100% fica automaticamente com o **admin** — esse percentual do admin nunca é gravado no banco, é sempre calculado on-the-fly (100% menos a soma dos participantes cadastrados). Cadastro/edição de participante é feito em `/admin/maquinas` → seção "Participação na máquina" de cada máquina, via a action `salvarParticipante` (`server/app/admin/maquinas/actions.ts`), que calcula o percentual máximo ainda disponível pra aquele tipo e recusa/limita a entrada se passar de 100% — o erro aparece na tela (usa `useActionState` do React), não falha mais em silêncio.

**Quem já fica com o dinheiro na mão** (o mesmo de antes, mas agora generalizado pra todos os participantes):
- **Presencial** (dinheiro, botões X1-X6): o **lavador** já embolsa 100% na hora e deve repassar a parte de todo mundo (inclusive do admin) proporcional ao percentual de cada um.
- **App** (carteira do cliente): o **admin** já fica com 100% na hora e deve repassar a parte de todo mundo (inclusive do lavador).
- `COMISSAO1`, `COMISSAO2` e `ALUGUEL` **nunca** ficam com dinheiro na mão em nenhum dos dois casos — são sempre credores dos dois lados (presencial e app).

Toda a lógica de cálculo está em `server/lib/comissao.ts`:
- `participacoesDaMaquina(machineId, escopo?)` — lista os participantes cadastrados na máquina, filtrados por escopo (`"LAVAGEM"` por padrão; ver 6.6c pro aspirador).
- `percentualDoUsuarioNaMaquina(machineId, userId, escopo?)` — percentual de uma pessoa específica, também por escopo.
- `percentualAdmin(machineId)` — calcula o que sobra pro admin (100% menos a soma dos cadastrados), **por escopo** (o teto de 100% de lavagens e de aspirador são independentes).
- `participacaoDe(...)` / `divisaoCompleta(...)` — quebra o valor faturado (presencial/app, por tipo de lavagem) entre todos os participantes + admin.
- `relatorioMaquinaPara(machineId, percentual, inicio, fim, percentualAspirador?)` — monta o relatório de uma pessoa específica numa máquina, incluindo a linha de aspirador com o percentual **separado** (ver 6.6c). Faz fechamento preguiçoso de usos de aspirador vencidos (`finalizarAspiradoresVencidos`) pra não depender só do heartbeat do display ter confirmado.

`GET /api/lavador/painel` (só vê as máquinas onde é o participante `LAVADOR`) e o novo `GET /api/parceiro/painel` (`server/app/api/parceiro/painel/route.ts`, só vê as máquinas onde é `COMISSAO1`/`COMISSAO2`/`ALUGUEL`) aceitam os mesmos parâmetros:
- `?de=AAAA-MM-DD&ate=AAAA-MM-DD`: período customizado (calendário no app).
- `?desde=acerto`: tudo desde o último "Marcar pago hoje" da máquina (`lastPaymentDate`).
- Sem nenhum dos dois: hoje.
- Traz por tipo de lavagem (1-4) x origem (presencial/app), mas os valores mostrados **já são a parte da pessoa** (não o bruto, nem o percentual de ninguém) — só "Total no período" continua bruto.

**Diferença chave entre os dois papéis**: o lavador recebe push notification quando a máquina falha/trava/fica offline; o parceiro (`/api/parceiro/painel`) **nunca** recebe esse tipo de notificação — só vê o relatório financeiro das próprias máquinas.

`/admin/maquinas` (seção "Divisão entre participantes" de cada máquina) mostra a tabela completa **sem esconder nada** — por participante (incluindo o admin calculado), quanto veio do presencial/app e o saldo (a receber ou a repassar).

### 6.6b Solicitação de papel e aprovação (`SolicitacaoParceiro`)

Qualquer cliente pode pedir uma ou mais capacidades extras (Lavador, Comissão 1, Comissão 2, Aluguel) — no cadastro (marcando várias checkboxes/chips de uma vez) ou depois, a qualquer momento, pelo **Perfil** (seção "Também é lavador, vendedor ou aluguel?" com um botão "Pedir" por tipo). Cada marcação cria uma linha independente em `SolicitacaoParceiro` (`userId` + `tipo` + `status: PENDENTE`). Enquanto pendente, o usuário continua `CLIENT` normal — **nunca fica bloqueado** esperando aprovação.

- `POST /api/parceiro/solicitar` — cria o pedido (endpoint usado tanto no cadastro quanto no Perfil).
- `/admin/usuarios` — seção **"Cadastros a aprovar"** no topo, lista cada solicitação pendente (telefone, nome, tipo pedido, data) com botões Aprovar/Rejeitar, um pedido por vez (uma pessoa pode ter 2-3 pedidos pendentes simultâneos, de tipos diferentes). Um badge vermelho com a contagem de pendentes aparece no `AdminNav`, ao lado do link "Usuários".
- **Regra de promoção de `role` na aprovação**: o role nunca é rebaixado, só promovido — `LAVADOR` sempre "ganha" de `PARCEIRO` (dá acesso ao scanner de vouchers no balcão). Ex.: se a pessoa já é `PARCEIRO` (por causa de um Aluguel aprovado) e depois tem o pedido de `LAVADOR` aprovado também, o role sobe pra `LAVADOR` — sem perder o vínculo de Aluguel, que continua registrado à parte em `MachineParticipante`.
- Também dá pra promover alguém **direto** pelo dropdown de `/admin/usuarios` (Cliente/Lavador/Parceiro — com o tipo específico de Parceiro obrigatório, não dá mais pra deixar "Parceiro" genérico sem tipo), sem esperar a pessoa pedir.
- **Correção 09-19** (`server/app/admin/usuarios/actions.ts`): o atalho de promover **direto** pra Lavador só mudava o `role` do usuário, sem criar a `SolicitacaoParceiro` correspondente como `APROVADA` — a pessoa virava Lavador de verdade (ganhava a aba), mas o próprio Perfil dela continuava mostrando "Pedir" em vez de "Aprovado" na seção "Também é lavador, vendedor ou aluguel?". Isso já funcionava certo pro caso "Parceiro"; agora o caso "Lavador" também faz `upsert` de `SolicitacaoParceiro` (tipo `LAVADOR`, status `APROVADA`) na mesma transação que atualiza o `role` — os dois atalhos ficam consistentes.
- Filtro por tipo de cadastro em `/admin/usuarios`: abas no topo (Todos/Cliente/Lavador/Comissão 1/Comissão 2/Aluguel/Admin) com contagem, via `?filtro=` na URL.
- No mobile, a visibilidade das abas "Minha Máquina" e "Comissões" é baseada em **capacidade aprovada** (solicitação com `status: APROVADA`), não mais só no campo `role` — uma pessoa aprovada como Lavador e também como Aluguel vê as duas abas ao mesmo tempo.

### 6.6c Aspirador de pó (novo, 10-06)

Serviço opcional por máquina, independente da lavagem — pago pela carteira (nunca em espécie), com percentuais de comissão **próprios**, separados dos das lavagens (ver `escopo` em 6.2).

**Configuração** (`/admin/maquinas`, seção "Aspirador de pó" de cada máquina): checkbox de habilitado + preço (R$) + duração (minutos). Desabilitado por padrão em toda máquina nova.

**Fluxo de compra**:
1. `POST /api/vacuum/buy` — debita o crédito na hora (mesma guarda atômica de saldo do `/api/orders`), cria `VacuumUse` em `PAID`. Pode ser chamado solto (tela da unidade, botão "X min de aspirador de pó") ou como add-on oferecido depois de pagar uma lavagem.
2. `POST /api/vacuum/start` — o cliente aperta "Começar agora" quando estiver pronto pra usar; só então o uso vira `ACTIVE` com `startedAt = now()`. Comprar não liga nada sozinho.
3. A cada heartbeat (`POST /api/machine/heartbeat`), se há um `VacuumUse` `ACTIVE` na máquina, o backend calcula `segundosRestantes` (= `durationSec` − tempo desde `startedAt`) e devolve no campo `vacuum` da resposta. Quando chega a 0, marca `COMPLETED` e para de mandar o comando.
4. O display liga/desliga o relé (DO8) só com base nesse campo — ver A.5. **Isolado do `g_estado_auto`**: nunca interfere numa lavagem em andamento, mesmo que aconteçam ao mesmo tempo.
5. **Fechamento preguiçoso** (`finalizarAspiradoresVencidos`, `server/lib/vacuum.ts`): como o passo 3 depende do heartbeat físico da máquina pra fechar o uso, e isso pode não acontecer (câmera off, teste sem hardware), os relatórios (painel do lavador/parceiro) também fecham usos vencidos por conta própria ao serem consultados — garante que o faturamento não fica "preso" em `ACTIVE` pra sempre.

**App**: tela dedicada (`aspirador.tsx` no mobile, `/app/aspirador` na PWA) cobre comprar → "Começar agora" → contagem regressiva local (só visual — o tempo real é controlado pelo backend/display). Acessível de duas formas: standalone (botão na tela da unidade) ou como add-on oferecido num `Alert`/`confirm` depois de pagar uma lavagem na mesma unidade (decisão de produto: só lavagem oferece add-on de aspirador, o inverso não).

**Faturamento**: aparece como linha extra no painel do lavador/parceiro ("Aspirador · Nx — R$ X") e como tabela de "Divisão entre participantes — Aspirador" no admin (ver 7 do guia de admin) — sempre do lado "app" (nunca presencial, já que é sempre pago por carteira).

### 6.7 Preço por unidade (`StationPrograma`, `lib/precos.ts`)

Cada unidade cobra o que quiser pelos 4 tipos de lavagem — não existe mais um preço "padrão" que as unidades herdam. A aba `/admin/precos` só edita o **nome** dos 4 tipos (compartilhado entre todas as unidades); o preço em R$ é preenchido do zero dentro de cada unidade, em `/admin/maquinas`. `precoEfetivo(programId, stationId)` é chamado nos 3 pontos que cobram uma lavagem (`/api/reservations`, `/api/orders`, `/api/arrivals/[id]/request`) — sem preço próprio cadastrado, usa o `Program.precoCents` de fábrica como último recurso (nunca deveria acontecer numa unidade já em operação).

### 6.8 Rotas de API — mapa geral
```
/api/auth/            register, login  (cliente — e-mail/senha)
                       otp/request, otp/verify  (legado, não usado por nenhuma tela)
/api/me                perfil do cliente logado
/api/vehicles           CRUD de veículos
/api/programs           lista os 4 tipos — aceita ?stationId= pra devolver o preço daquela unidade
/api/orders             compra de lavagem (voucher) — aceita stationId
/api/reservations       criar/listar reservas (aceita stationId); [id]/cancel; [id]/confirmar-chegada
/api/arrivals/mine      chegada atual do cliente (pra tela inicial) — inclui stationId
/api/arrivals/[id]/confirm   responder a uma sugestão de placa
/api/arrivals/[id]/request   pagar lavagem a partir de uma chegada detectada
/api/stations           lista pública de unidades (mapa do app)
/api/wallet             saldo e extrato
/api/push/              inscrição de push notification
/api/lavador/painel     painel do lavador — ?de=&ate= ou ?desde=acerto
/api/parceiro/painel    painel do parceiro (comissão 1/2, aluguel) — mesmos parâmetros, sem alerta de falha
/api/parceiro/solicitar pede uma capacidade nova (lavador/comissão1/comissão2/aluguel)
/api/lpr/frame          recebe foto da câmera, aciona o LPR
/api/lpr/ao-vivo        câmera ao vivo (metadados + imagem), só com lavagem em andamento
/api/vacuum/buy         compra do aspirador (debita credito, cria VacuumUse em PAID)
/api/vacuum/start       "começar agora" — vira ACTIVE, começa a contar o tempo
/api/machine/           heartbeat, car-entered, wash-complete (app + presencial + sócio/bônus), fault
                        (errorCode X15_POSICAO = volta para a fila, sem estorno), ack, next,
                        provisionar, unidades (busca por cidade), reset-log (reinícios/ocorrências)
/api/admin/machine/payment   marcar pagamento em dia (legado, ver /admin/maquinas)
/api/cron/expire-reservations   cron do Railway (a cada 5 min) — expira reservas, estorna, checa saúde
                        (agendado no serviço `cron-pili` do Railway, ver "Cron de expiração" abaixo)
/api/saude              diagnóstico de saúde da operação (usado pelo app antes de deixar comprar)
```

### 6.9 Saúde da operação (`lib/saude.ts`)
Três coisas precisam estar vivas pra uma lavagem acontecer: o **display** (executa o ciclo), a **câmera** (reconhece a placa) e a **internet** da máquina (se cai, os dois somem juntos). `diagnosticar()` calcula isso; `verificarEAlertar()` (rodado pelo cron) avisa admin + lavador quando há problema, com **dedup por tipo+máquina** (10 min) pra não virar spam.

**Limitação conhecida**: `diagnosticar()` hoje sempre olha a "máquina padrão" (`findFirst`) — não está totalmente adaptado pro cenário de múltiplas máquinas ainda.

### 6.10 Notificações push (`lib/push.ts`)
Web Push com chaves VAPID. `avisarCliente()` manda pra todos os aparelhos inscritos de um usuário (limpa inscrições mortas automaticamente); `avisarAdmins()` manda pra todos os admins. Nunca derruba o fluxo principal se falhar — push é extra.

### 6.11 Loja de conveniência — etapa 1 (novo 10-11, **só no banco local**, branch `loja-conveniencia`)

Produto paralelo à lavagem, no mesmo app. O conceito, as decisões e a ordem de construção estão em `PROJETO_LOJA_AUTOSERVICE.md`. O que já existe no código:

- **Schema** (migration `20261011150000_loja_cadastro_cliente`, **ainda não aplicada em produção**): `User.codigoCliente` (numérico, sequencial, único — é o que a loja registra na entrada), `User.nascimento`, `User.termosVersao` / `User.termosAceitosEm`, e a tabela **`FotoRosto`** (JPEG do rosto + `consentimentoEm`; fica fora de `User` porque `requireUser()` carrega o `User` inteiro a cada chamada).
- **Termo de uso** (`lib/termos.ts`): `TERMOS_VERSAO` + os tópicos do texto. Trocar a versão obriga todo mundo a aceitar de novo. **O texto atual é um rascunho**, pendente de revisão jurídica. `GET /api/termos` devolve o texto (usado pelo app nativo); `POST /api/termos` registra o aceite e exige data de nascimento (quem se cadastrou antes informa ali).
- **Foto do rosto**: `POST /api/me/foto` (`jpegBase64` + `consentimento: true`) — exige termo aceito, confere que é JPEG, limite de 1 MB, uma foto por pessoa (mandar de novo substitui).
- **Conferência da foto** (`lib/rosto.ts`, migration `20261012200000_foto_rosto_conferida`): antes de guardar, a IA de visão (mesma `ANTHROPIC_API_KEY` da leitura de placa; modelo `claude-opus-5-5`) responde se a imagem é o rosto de **uma** pessoa, de frente e visível. Foto recusada volta 422 com a explicação (sem pessoa, mais de uma, rosto coberto, rosto não visível, imagem ruim). Não identifica quem é a pessoa e não é prova de vida (foto de uma foto passa). Se não der pra conferir (sem chave, IA fora do ar), a foto é aceita com `FotoRosto.conferida = false`. **Ainda não testada com a IA de verdade**: o ambiente local não tem `ANTHROPIC_API_KEY`.
- **`/api/me`, login e cadastro** devolvem também `codigoCliente`, `nascimento`, `termosAceitos` (da versão vigente) e `temFoto`. O cadastro aceita `nascimento` ("AAAA-MM-DD").
- **Telas** (PWA em `server/app/(pwa)/app/`, nativo em `mobile/src/app/`): `escolha` (porta de entrada: "Loja conveniência" ou "Lavagem expressa" — login, abertura do app e `start_url` da PWA caem aqui), `termos` (bloqueia o uso até aceitar), `loja` (home da loja; exige foto) e a tela de foto (`loja/foto` na PWA, `loja-foto` no nativo). A home da lavagem continua em `/app` (PWA) e `/(tabs)` (nativo), com um link de volta pra escolha. O onboarding da lavagem passou a aparecer na primeira vez que o cliente escolhe a lavagem.

**Lojas, dono, bloqueio e suporte** (migration `20261012100000_loja_dono_bloqueio`, também **só no banco local**):

- **`Loja`**: cadastro da loja (nome, endereço, `capacidade` — padrão 3, `active`, `donoId`). Estoque e catálogo **não** ficam aqui: vivem no computador local de cada loja.
- **Dono de loja**: novo valor `DONO_LOJA` em `TipoParticipacao`, usado **só** em `SolicitacaoParceiro` (pedido no cadastro ou no perfil, aprovado em `/admin/usuarios`) — nunca como `MachineParticipante`. Aprovar **não muda o `role`** (continua `CLIENT`; virar `PARCEIRO` abriria a aba Comissões à toa). As abas "Comissões" (PWA e nativo) ignoram `DONO_LOJA`. O vínculo com a loja é `Loja.donoId`, definido em **`/admin/lojas`** (o select só oferece quem tem `DONO_LOJA` aprovado).
- **`LojaBloqueio`**: cliente impedido de entrar numa loja, com `motivo` (visível só pro dono). Vale enquanto `removidoEm` for null — desbloquear não apaga a linha.
- **`LojaMensagem`**: mensagem do cliente pro suporte da loja + `resposta` do dono. Limite de 3 mensagens sem resposta por cliente por loja.
- **Rotas do cliente**: `GET /api/lojas` (lojas abertas + `bloqueado` + as próprias mensagens) e `POST /api/lojas/[id]/suporte` (avisa o dono por push; loja sem dono avisa os admins).
- **Rotas do dono** (todas conferem `Loja.donoId`, via `lib/loja.ts`): `GET /api/dono/lojas`, `POST /api/dono/lojas/[id]/bloqueios` (por `codigoCliente` + motivo), `DELETE /api/dono/bloqueios/[id]`, `POST /api/dono/mensagens/[id]` (resposta; avisa o cliente).
- **Telas**: home da loja lista as lojas com aviso de bloqueio e formulário de suporte; **"Minha loja"** (`/app/minha-loja` na PWA, `minha-loja` no nativo) é a área do dono.

**Auto-cadastro da loja** (migration `20261012150000_loja_provisionamento`, **só no banco local**) — mesma lógica do cadastro de máquina (6.5):

- `Loja.deviceKey` (identidade do computador central da loja, gerada por ele; null = loja criada à mão no admin) e `Loja.stationId` (unidade de lavagem no mesmo endereço, opcional).
- `GET /api/loja/unidades?cidade=X`: endereços já cadastrados naquela cidade — lojas existentes (`temComputador` diz se já há um computador vinculado) mais as unidades de lavagem que ainda não têm loja.
- `POST /api/loja/provisionar`: recebe `deviceKey` + `lojaId` **ou** `stationId` **ou** `cidade`+`rua`. Endereço digitado é comparado com `lib/endereco.ts` (ignora acento, maiúscula e prefixo de logradouro) contra lojas e unidades de lavagem antes de criar. Loja nova nasce `active=false` e sem dono (o admin abre em `/admin/lojas`). Loja que já tem outro computador responde 409 com `precisaSubstituir` e só troca com `substituir: true`; um computador já cadastrado em outra loja é recusado.
- As duas rotas são protegidas pelo mesmo `PROVISION_SECRET` das máquinas (header `x-provision-secret`).
- Quem chama essas rotas é a tela de primeiro uso do programa local da loja, que ainda não existe (etapa 2).

**Programa do computador da loja — `loja/`** (etapas 2 e 3; ver também `loja/README.md`): app Next.js separado do `server/`, com banco **SQLite local** (`loja/dados/loja.db`, fora do Git), em `http://localhost:3100`. Cada loja tem o seu, independente.

- `lib/config.ts`: tabela `Config` (chave/valor) com a identidade do computador (`deviceKey`, gerada aqui) e a loja vinculada. `NUVEM_URL` e `SENHA_FABRICA` vêm do `loja/.env`.
- `/primeiro-uso`: chama `/api/loja/unidades` e `/api/loja/provisionar` da nuvem; não cria senha. Depois de cadastrada, a tela não abre mais.
- **`/` é a tela do cliente: o caixa de autoatendimento** (`app/Caixa.tsx`, componente de cliente), com o link "Acesso administrativo" → `/entrar`. A gestão inteira fica em **`/gestao/*`**.
- **Caixa** (`lib/caixa.ts`, tabelas `Venda`/`VendaItem`): o leitor de código de barras funciona como teclado, então o campo do código fica sempre com o foco. `GET /api/caixa/produto?codigo=` devolve nome e preço (ou `NAO_ENCONTRADO` / `INDISPONIVEL` pra produto inativo ou sem preço); `POST /api/caixa/finalizar` recebe só produto e quantidade — **preço e total são recalculados no servidor**, a venda e as baixas (`Movimento` VENDA, `usuarioId` null, `refId` = `Venda.codigo`) entram numa transação só. As duas rotas não pedem login (quem usa é o cliente). Compra parada por 3 min é cancelada. `Venda.forma` hoje é sempre `SIMULADO`: carteira e maquininha ainda não estão ligadas. `Venda.codigo` (cuid) é a chave pra sincronizar com a nuvem sem duplicar. `/gestao/vendas` (só lojista) lista as vendas.
- **Usuários** (tabela `Usuario`, `lib/sessao.ts`, `lib/permissoes.ts`): `LOJISTA` (acesso total) e `FUNCIONARIO` (permissões marcadas pelo lojista: `PRODUTOS`, `PRECO`, `ENTRADA`, `PERDA`, `INVENTARIO`, `RELATORIOS`, `COMPRAS`, guardadas em JSON). Cookie JWT de 30 min com o id do usuário; o usuário é relido do banco a cada requisição, então desativar ou tirar permissão vale na hora. Guardas: `exigirGestao()`, `exigirPermissao(p)`, `exigirLojista()` — toda ação que muda dados chama uma delas, e as telas escondem o que a pessoa não pode (o servidor confere de novo).
- **Login do lojista**: `/entrar` manda e-mail e senha pra nuvem em **`POST /api/loja/dono-login`** (server/), identificando-se pelo `x-device-key`; a nuvem responde se a conta é a dona daquela loja (`Loja.donoId`). Deu certo: cria/atualiza o `Usuario` LOJISTA local com a senha copiada (hash) e desativa lojistas anteriores. Nuvem fora do alcance: vale a cópia local. Login sem "@" é sempre funcionário, conferido só localmente.
- **Registro de atividades** (tabela `Atividade`, `lib/atividade.ts`): quem, quando, ação e detalhe (com antes → depois em preço e cadastro). Gravado na mesma transação da mudança. `Movimento.usuarioId` e `Entrada.usuarioId` guardam quem lançou. Telas `/gestao/usuarios` e `/gestao/atividades` são só do lojista.
- `lib/estoque.ts`: `movimentar()` é o **único** caminho pra mudar saldo — grava `Movimento` (ENTRADA/VENDA/PERDA/AJUSTE, com `saldoApos` e `usuarioId`) e atualiza o cache `Produto.estoqueAtual` na mesma transação. `entradaManual()`, `registrarPerda()` e `ajustarInventario()` recebem o usuário; `baixarVenda()` já existe pro totem usar (sem usuário).
- Telas da gestão: painel (para comprar, sem preço, valor em estoque), produtos e estoque (busca, cadastro), produto (edição, entrada manual, perda, contagem de inventário, extrato com quem lançou), usuários, atividades.
- **Entrada por nota fiscal** (`lib/nfe.ts`, `/gestao/entradas`, permissão `ENTRADA`): recebe o **XML da NF-e** (`fast-xml-parser`, tudo lido como texto pra não estragar código de barras). O envio só guarda a nota em `NotaPendente`; o estoque muda na **conferência** (`/gestao/entradas/conferir/[id]`). Cada item é casado com um produto pelo código de barras e, sem ele, pela memória `CodigoFornecedor` (o que foi escolhido na última nota daquele fornecedor); o que não casa vem como "criar produto novo" (nasce sem preço de venda). A quantidade vem da unidade **tributável** da nota (`qTrib`/`cEANTrib`, a unidade de prateleira) quando existe, senão da comercial, e é editável. Confirmar grava `Entrada` (origem `XML`, `chaveNfe` única — a mesma nota não entra duas vezes), os itens, os movimentos, atualiza o custo (total do item ÷ unidades) e a memória, numa transação. Leitura de **PDF** não existe ainda. Há uma nota fictícia pra teste em `loja/exemplos/nfe-exemplo.xml`.
- **Preço de venda** (`lib/precos.ts`): `Produto.margemPct` é o percentual sobre o custo e `Produto.precoManual` desliga a regra. `reajustarPreco()` recalcula `precoCents = custo × (1 + %)` e grava a atividade `PRECO_ALTERADO` com o motivo; é chamada, dentro da transação, sempre que custo ou percentual mudam (confirmação de nota, entrada manual com custo, `salvarProduto`, `definirPercentuais`). Não faz nada em produto manual ou sem percentual. Cadastro manual de produto exige percentual ou preço manual. Na lista de produtos, quem tem a permissão `PRECO` edita o percentual direto na coluna "% de venda", em qualquer aba, e salva em lote (`definirPercentuais` só grava o que mudou; campo em branco não apaga). As abas `?f=sempct` (sem percentual) e `?f=manual` (sem reajuste automático) filtram a lista; o painel tem um cartão pra cada. A conferência da nota tem a coluna "% de venda" (em branco = mantém o guardado) e mostra o que vai acontecer com o preço de cada item. O aviso de confirmação ao marcar "Preço manual" é do componente de cliente `CampoPreco.tsx`.
- **Relatórios** (`lib/relatorios.ts`, `/gestao/relatorios`, permissão `RELATORIOS`): estoque (posição de agora), entradas, saídas (vendas por produto) e perdas/ajustes por período (padrão: mês corrente; dias no fuso de Brasília). `/gestao/relatorios/csv` baixa o mesmo relatório em CSV (`;` e BOM, pro Excel em português) usando as mesmas funções da tela. O valor das perdas usa o custo atual do produto.

- **Lista de compras** (`lib/compras.ts`, `/gestao/compras`, permissão `COMPRAS`): tabela `ItemCompra` (um produto marcado + quantidade). A tela tem duas visões de escolha, `?v=minimo` (padrão) e `?v=todos`; `salvarMarcacoes` só mexe nos produtos que estavam na tela (manda os ids em `ids`). A quantidade sugerida é o que falta pra passar do mínimo. `movimentar()` apaga o `ItemCompra` do produto em toda ENTRADA. `/gestao/compras/csv` baixa a lista; a impressão usa o `@media print` do `globals.css` (classe `nao-imprimir`).
- **Banco local** (`loja/prisma/schema.prisma`, SQLite): `Config`, `Usuario`, `Atividade`, `Produto`, `Movimento`, `Fornecedor`, `Entrada`, `EntradaItem`, `CodigoFornecedor`, `NotaPendente`, `Venda`, `VendaItem`, `ItemCompra`. As migrations ficam em `loja/prisma/migrations/` e são aplicadas sozinhas ao iniciar o programa (`npm run dev` e `npm start` rodam `prisma migrate deploy`), então o banco de uma loja já instalada é atualizado na próxima vez que o programa abrir. Dinheiro sempre em centavos (inteiro).
- **Testes**: não há suíte automatizada no repositório. Cada parte foi validada por um script descartável que envia os formulários por HTTP e confere o banco; antes de qualquer teste destrutivo, copiar `loja/dados/loja.db`.

Ainda não existe: leitura de nota em PDF, e tudo das etapas seguintes (pagamento de verdade no caixa, sincronização, entrada por BLE, câmeras). O bloqueio ainda não impede nada fisicamente — passa a valer quando a entrada por BLE consultar `LojaBloqueio`.

---

### 6.13 Etapas da lavagem no app e diagnóstico da câmera (v8)

- **Etapas (`lib/etapas.ts`):** o heartbeat passa a aceitar `proc` (processo em execução: 1 enxágue, 3 espuma, 5 cor mágica, 6 cera, 7 alta pressão, 8 secagem; 0 = nenhum). `registrarEtapa()` guarda **1 `Event` `lavagem_etapa` por mudança** (`{reservationId, idx, proc, programId}`), não por batida, sem tabela nova. A **sequência de cada modelo** (`SEQUENCIA`, modelo = `programId`) é uma cópia de `g_modelos` do firmware (`tipos_w1.h`) — **se mudar lá, mude em `lib/etapas.ts`**. Como o mesmo processo se repete na sequência (Espuma duas vezes), a posição é um ponteiro que só avança (`proximaPosicao`). `GET /api/arrivals/mine` devolve `etapas: {itens, atual}` enquanto a reserva está ENTERED; o app (`ProgressoLavagem.tsx`) mostra a lista com ✓ / ● agora / ○. Os nomes mostrados ficam em `PROC_NOME`.
- **Diagnóstico da câmera (`/api/machine/camera-diag`):** cada relatório da câmera v8 vira um `Event` `camera_diag` (campos numéricos validados por zod; 200 mesmo para corpo ilegível). Serve para analisar por que a câmera fica sem enviar fotos (Wi-Fi × memória × envio × reinício); não decide nada nem avisa ninguém.

### 6.12 Reinícios das placas, retrato e ocorrências (`/api/machine/reset-log`, `lib/resets.ts`)

Recebe da câmera (v7) o histórico de reinícios das placas e os registros da Fase 0 da retomada do ciclo (seção 3.7). **Sem tabela nova e sem migration**: cada registro vira um `Event` (`machine_reset` e afins). Idempotente pela `key` (`W1-12`): a câmera/display reenviam até receber 200. Responde 200 mesmo para conteúdo ilegível (um 4xx travaria a fila de eventos de lavagem atrás); só a falta de autenticação devolve erro.
- **Reinício com a máquina parada:** só registro (admin > Máquinas > "Reinícios das placas"). **Reinício no meio de um ciclo:** aviso imediato por push ao lavador da máquina e aos admins.
- **Regra do Giovani (2026-11-02):** W1 reiniciou em ciclo → as reservas do app ACTIVE/ENTERED que **começaram antes** do reset são **canceladas e estornadas na hora** (o cliente reserva de novo; não reagenda). Só age com a hora do reset conhecida (`t`); reinício antigo reenviado horas depois nunca cancela a lavagem de outro cliente. Reinício da W2 não cancela nada.
- **Retrato da etapa** (`J;…`) e **ocorrências** (`O;…`, O1..O6 em `NOMES_OCORRENCIA`): só registro; aparecem na coluna "Etapa" e na seção "Ocorrências observadas" do admin. São o material para criar as regras de retomada (`docs/REGRAS_RETOMADA_CICLO.md`).
- **Alertas de saúde sem repetição** (avisa uma vez ao cair e uma vez ao voltar: display, câmera e falha da máquina), com histórico por máquina em `/admin/alertas`; texto do "voltou": "saiu do estado de falha".
- `fault` com `errorCode` `X15_POSICAO` (carro não chegou à posição em 3 min): a reserva volta a HELD sem estorno nem FAULT na máquina.
- `wash-complete` aceita `source` `remote` (presencial), `socio` e `bonus` (contabilizados em R$ 0,00 no admin).

---

## 7. App Mobile — `mobile/` (Expo/React Native + Expo Router)

Estrutura de abas (`src/app/(tabs)/`):
- **Início** (`index.tsx`): saldo, reserva ativa (com contagem regressiva, botão "Cheguei" manual, cancelar), veículos, sugestão de placa fraca pra confirmar. Botão "Reservar lavagem" abre a lista de **Unidades** (não vai mais direto pro formulário — ver abaixo).
- **Unidades**: lista/mapa das unidades (`/api/stations`), com status agregado (aberto/ocupado/manutenção), sem mencionar aspirador — essa opção só aparece depois de entrar na unidade. Tocar numa unidade abre o detalhe (`unidade/[id].tsx`) com as máquinas dela, a câmera ao vivo (poll de 4s em `/api/lpr/ao-vivo`, ver 6.4), o botão "Reservar lavagem" (já leva o `stationId` pra frente) e, se a unidade tiver máquina habilitada, o botão **"X min de aspirador de pó"** (`aspirador.tsx`, novo 10-06 — ver 6.6c).
- **Carteira**: saldo e extrato, recarga.
- **Planos**: os tipos de lavagem.
- **Minha Máquina** (`minha-maquina.tsx`, aparece pra quem tem a capacidade **Lavador aprovada** em `SolicitacaoParceiro` — não é mais baseado só em `role`): painel da(s) máquina(s) que o usuário opera — filtro Hoje / período customizado (calendário nativo, `@react-native-community/datetimepicker`) / "Não acertado ainda", tabela por tipo (presencial/app, já com a parte do lavador), soma no rodapé de cada coluna, e o card "Sua participação" com o valor final.
- **Comissões** (`minhas-comissoes.tsx`, nova 09-19, aparece pra quem tem Comissão 1, Comissão 2 e/ou Aluguel aprovados): painel equivalente ao "Minha Máquina", mas pro parceiro — mesmo filtro de período, tabela por tipo de lavagem (presencial x app) e o valor final a receber, sem mostrar percentual nem o corte de ninguém. Uma pessoa pode ver as duas abas ao mesmo tempo se tiver mais de uma capacidade aprovada (ex.: Lavador de uma máquina e Aluguel de outra).

**Correção 09-19**: `nova-lavagem.tsx` **exige** `stationId` (vem por parâmetro de rota) — sem ele, mostra uma tela pedindo pra escolher a unidade primeiro, em vez de deixar reservar "sem unidade nenhuma" (bug real: toda reserva nascia com `stationId=null`, dando a impressão de cair direto numa máquina qualquer).

Telas fora das abas: `cadastro.tsx` (e-mail+senha, mais os checkboxes/chips opcionais "Sou lavador"/"Sou vendedor 1"/"Sou vendedor 2"/"Recebo aluguel" — pode marcar mais de um, cada marcação vira uma `SolicitacaoParceiro`) / `login.tsx`, `onboarding.tsx` (3 passos, termina na tela de recarga), `nova-lavagem.tsx`, `veiculo-novo.tsx`, `recarga.tsx`, `historico.tsx`, `meus-dados.tsx` (com a seção "Também é lavador, vendedor ou aluguel?" pra pedir uma capacidade nova a qualquer momento), `voucher/[id].tsx`, `scanner.tsx` (lavador escaneia voucher no balcão), `unidade/[id].tsx`.

**Correção do onboarding não travar em PIX (09-19)**: o passo final do onboarding usava `router.replace("/recarga")`, trocando a tela sem deixar histórico de navegação — se a geração do PIX falhasse (Asaas fora do ar, sem chave configurada) ou demorasse, o cliente ficava preso na tela de recarga sem conseguir usar o resto do app. Corrigido: agora existe um link "Agora não, quero só olhar o app" que leva direto pras abas normais. Adicionar saldo é sempre uma ação **opcional**, disponível a qualquer momento na Carteira ou na Home — nunca um pré-requisito bloqueante pra usar o app (só é necessário na hora de efetivamente reservar uma lavagem).

**Sessão**: token JWT guardado no `expo-secure-store` (`lib/session.tsx`), com opção de **biometria** (Face ID/digital) como trava extra ao abrir o app (`lib/biometria.ts`) — configurável em "Meus dados".

---

## 8. PWA — `server/app/(pwa)/`

Versão web do app, servida pelo mesmo Next.js do backend (rota `/app`). Mesmas telas conceituais do mobile (cadastro, login, onboarding, home, lavagem, recarga, histórico, perfil), com componentes próprios (`CameraAoVivo.tsx`, `ProgressoLavagem.tsx`, `AvisosPush.tsx`). Também tem `/camera` (painel de luz pro celular fixo na máquina) e `/capturas` (debug: últimas fotos + o que a IA leu).

**Correção 09-19 (causa real de "o app entra direto numa máquina")**: a home mostrava um card `StatusMaquina` que chamava `/api/saude` → `diagnosticar()` → pega a **primeira máquina do banco inteiro** (`prisma.machine.findFirst()`), sem relação nenhuma com unidade — resquício de antes do multi-máquina existir. Isso rodava antes de qualquer escolha do cliente. **Removido** — o componente não existe mais. Nova tela `/app/unidades` (mesmo endpoint `/api/stations` do mobile) fica sempre no caminho antes de comprar, mesmo com uma unidade só; `lavagem/page.tsx` exige `stationId` igual ao mobile, e `/api/orders` usa `machineForStation(stationId)` em vez de `defaultMachine()` quando informado. O botão "Já estou na máquina" da home também foi corrigido pra usar o `stationId` da própria chegada (`Arrival.stationId`) em vez da máquina fixa.

### 8.1 Barra de navegação de baixo (`nav.tsx`) e paridade total com o app nativo (09-19)

Desde que ficou claro que o PWA é a única forma real de uso (ver nota no item 1), a barra de baixo do PWA foi levada até ter paridade completa com a do app nativo (`mobile/src/app/(tabs)/_layout.tsx`):

- **`server/app/(pwa)/app/nav.tsx`** virou dinâmico: busca `/api/me` uma vez (client-side) e monta a lista de abas em cima da resposta (`Me`, incluindo `role` e as `solicitacoes` do usuário). Antes, os links de Minha Máquina/Comissões ficavam como botões soltos dentro da página de Perfil — inferior à experiência do nativo.
  - `temMinhaMaquina`: `role === "LAVADOR"`, `role === "ADMIN"`, ou alguma `solicitacao` com `tipo: "LAVADOR"` e `status: "APROVADA"`.
  - `temComissoes`: alguma `solicitacao` com `tipo !== "LAVADOR"` e `status: "APROVADA"` (Comissão 1, Comissão 2 ou Aluguel).
  - Essas duas abas são condicionais; o resto da barra é fixo pra todo mundo.
- **Ordem final da barra**: Início, Unidades, Carteira, Planos, Histórico, [Minha Máq. 🔧 — condicional], [Comissões — condicional], Perfil. O "Histórico" foi mantido mesmo sem equivalente na barra do nativo, pra não tirar uma funcionalidade que já existia e era usada.
- **`/app/minha-maquina`** (novo, 09-19): painel do lavador, equivalente a `mobile/src/app/(tabs)/minha-maquina.tsx`. Filtro Hoje / Período (inputs `type="date"` De/Até) / "Não acertado" (`?desde=acerto`), usando `/api/lavador/painel`. Mostra status da máquina com destaque visual de falha/offline, tabela por tipo de lavagem (presencial x app, quantidade e valor) e o total "Sua participação".
- **`/app/comissoes`** (novo, 09-19): painel do parceiro (Comissão 1/2, Aluguel), equivalente a `mobile/.../minhas-comissoes.tsx`. Mesma estrutura de filtro de período, usa `/api/parceiro/painel` — sem nenhum destaque de falha/status técnico, já que o parceiro só acompanha o relatório financeiro.
- **`/app/planos`** (novo, 09-19): réplica exata da tela "em breve" do nativo (`mobile/src/app/(tabs)/planos.tsx`) — clube de assinatura com lavagens mensais inclusas, anunciado mas **sem lógica nenhuma implementada** ainda, é só uma tela informativa.
- **`/app/unidades`**: já existia (lista de unidades pra escolher antes de reservar), só não estava na barra de navegação — ganhou `<Nav />` e agora aparece como aba.
- **`/app/unidade/[id]`** (novo, 10-06): tela de detalhe da unidade — não existia na PWA antes, só no mobile; a lista de unidades ia direto pra `lavagem/page.tsx`. Agora segue o mesmo padrão do mobile: máquinas, câmera ao vivo, botão "Reservar lavagem" e, se houver, "X min de aspirador de pó".
- **`/app/aspirador`** (novo, 10-06): equivalente a `mobile/src/app/aspirador.tsx` — comprar → "Começar agora" → contagem regressiva (ver 6.6c).
- **`lavagem/page.tsx`**: depois de pagar, se a unidade tiver máquina com aspirador, oferece o add-on via `window.confirm()`.

---

## 9. Painel Admin — `server/app/admin/`

- **Visão geral** (`/admin`): vendas hoje/7d/30d, resgates, recargas, saldo total em carteiras, lavagens por programa.
- **Lavagens** (`/admin/lavagens`): últimas 200, com status/voucher/quem resgatou.
- **Usuários** (`/admin/usuarios`): lista completa, com a seção **"Cadastros a aprovar"** no topo (solicitações pendentes de `SolicitacaoParceiro`, Aprovar/Rejeitar uma a uma) e um badge de contagem no menu. Abas de filtro por tipo de cadastro (Todos/Cliente/Lavador/Comissão 1/Comissão 2/Aluguel/Admin, via `?filtro=`). Promove/rebaixa direto pelo dropdown (Cliente/Lavador/Parceiro — escolhendo o tipo específico quando é Parceiro).
- **Preços** (`/admin/precos`, nova 09-19): só edita o **nome** dos 4 tipos de lavagem — o preço em R$ fica dentro de cada unidade (ver abaixo e 6.7).
- **Alertas** (`/admin/alertas`, 2026-11): histórico de alertas de saúde por máquina (abertos agora, filtros de período/tipo, páginas). A **Visão geral** mostra as máquinas em abas com status e histórico de alertas; horários em Brasília.
- **Máquinas** (`/admin/maquinas`, redesenhado 09-19): cards de estatística no topo (total, offline, em manutenção, licença bloqueada) + **abas por unidade** — unidade com mais de uma máquina abre sub-abas (Máquina 1, 2, 3...) ao clicar. Uma aba **"Resumo geral / TOTAIS"** separada soma tudo (todas as máquinas) por tipo de lavagem. Dentro de cada unidade: preço dos 4 tipos (editável ali mesmo), status/licença/sensores da máquina selecionada, valor acumulado desde o último fechamento, a seção **"Aspirador de pó"** (habilitar + preço + duração, novo 10-06, ver 6.6c), histórico de lavagens, **duas** tabelas de participação — **"Participação na máquina — Lavagens"** e **"— Aspirador de pó"** (cadastro/edição dos 4 tipos de participante com percentual, regra dos 100% **por escopo**, independente entre os dois) — e **duas** tabelas de "Divisão entre participantes" (uma por escopo) com a tabela completa por participante (incluindo o admin calculado), por origem, mais o saldo líquido de cada um.

---

## 10. Variáveis de ambiente relevantes (`server/.env`)

| Variável | Pra que serve |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Postgres (Neon em produção; Postgres local em dev) — pooled/direta |
| `JWT_SECRET` | assina tokens de sessão e admin |
| `ADMIN_USER` / `ADMIN_PASSWORD` | login do painel admin |
| `SMS_PROVIDER` / `SMS_API_KEY` | legado, não usado no login principal |
| `PLACA_PROVIDER` / `PLACA_API_KEY` / `PLACA_DEVICE_TOKEN` | fallback de LPR (hoje o principal é a IA da Anthropic) |
| `ASAAS_*` | pagamento (recarga de saldo) |
| `DEVICE_KEY` | chave genérica legada de dispositivo |
| `MACHINE_DEVICE_KEY` | seed da máquina padrão |
| `CRON_SECRET` | protege o cron de expiração (`x-cron-secret`). Criada no Railway em 2026-11-01 com `${{ secret(48) }}`; sem ela a rota ficaria aberta |
| `PROVISION_SECRET` | senha de fábrica do auto-cadastro de máquina (também protege `/api/machine/unidades`) |
| `PLATE_RECOGNIZER_TOKEN` | fallback de LPR |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | push notifications |

Firmware da câmera tem seu próprio `PILI_PROVISION_SECRET` (deve bater com o `PROVISION_SECRET` do backend).

---

## 11. Pendências e limitações conhecidas

- **`diagnosticar()`** (saúde da operação) ainda assume a "máquina padrão" — não totalmente adaptado pra várias máquinas simultâneas.
- **Sem "esqueci minha senha"** por decisão do usuário (não querem depender de provedor de e-mail ainda).
- **Sem provedor de e-mail configurado** — se no futuro precisar (recibos, etc.), precisa escolher um serviço.
- **Nota fiscal (NFS-e)**: ainda não implementada. Lavagem de carro é serviço (ISS municipal, não NF-e de mercadoria) — exige CNPJ + inscrição municipal + enquadramento tributário definidos com contador antes de qualquer integração técnica. Caminho mais comum pra automatizar: provedor intermediário (Focus NFe, eNotas, NFe.io) que já resolve a integração com cada prefeitura por trás de uma API única.
- **OTA (atualização de firmware remota)**: existe só pra **câmera** desde 10-06 (ver 5.1) — baixa `.bin` e versão de arquivos estáticos no Railway, a cada 10min. O **display não tem** (sem Wi-Fi próprio); ainda exige cabo USB. Dá pra fazer via relay ESP-NOW (câmera baixa o firmware do display e repassa em pacotes pequenos), mas não foi implementado — é mais trabalho de protocolo (chunking, confirmação por pacote) que o da câmera.
- **Watchdog só por software na câmera**: achado real (10-06) — mesmo com o watchdog de 30s e a recuperação específica do sensor de imagem, a câmera já travou de um jeito que nenhum dos dois detectou (só um power-cycle manual resolveu; ~20s+ sem nenhum contato ESP-NOW nesse episódio). Sugere um travamento abaixo do nível que software alcança (ex: driver de rádio Wi-Fi). Um watchdog por **hardware** (circuito externo que corta/religa a alimentação se a câmera não "latir" periodicamente) resolveria isso de verdade, mas não existe ainda.
- **Fragmentação de heap na câmera**: com o tempo de uso (câmera + Wi-Fi + ESP-NOW rodando juntos), o maior bloco livre contíguo de memória oscila e pode cair o suficiente pra atrapalhar a alocação do TLS, causando falha intermitente de envio de foto ("Failed to send chunk"). Mitigado parcialmente reduzindo o tamanho do JPEG (ver 5), mas não eliminado — ainda ocorre ocasionalmente.
- **Diagnóstico remoto fino** (sensores individuais, sub-estado do processo) não chega na nuvem hoje — só aparece na tela física ou no `Serial`. Sem jeito de ler o log serial remotamente (só com cabo USB físico conectado).
- **Espuma manual**: ainda não existe uma opção de espuma manual na tela/fluxo manual do display — hoje só existe via os processos automáticos (Espuma A/B, Cor Mágica).
- **PROVISION_SECRET e ADMIN_PASSWORD**: confirme que estão configurados em produção (Railway) antes de considerar o sistema fechado para acesso externo — o padrão do projeto é "sem a variável, fica aberto (fase de teste)".
- **Migrações não rodam sozinhas no deploy do Railway** — precisa aplicar manualmente (`npx prisma migrate deploy` com o `.env` apontando pra produção, revertendo logo em seguida) toda vez que o schema muda.
- **Retomada do ciclo depois de reinício:** ainda não existe. Hoje a W1 que reinicia em ciclo cancela e estorna a lavagem do app; as regras G6/G7/G8b/Fase 1/Fase 2 estão especificadas (`docs/REGRAS_RETOMADA_CICLO.md`) e **não programadas** (seção 3.4).
- **Regras do X10 em todas as etapas** gravadas em 2026-11-02, validadas só no início e no giro; falta testar no retorno ao X12 e entre etapas (seção 3.9).
- **Cópia ESP-NOW de produção** (`lixo/testes/waveshare1|2`) compilada e **não gravada**; gravá-la quebra o cabo. Branch `link-uart-w1-w2` ainda não foi para a `main` (merge só com "pode subir").
- **Substituição de câmera testada só parcialmente em bancada** — o fluxo ESP-NOW (`MSG_IDPUSH_*`) foi validado, mas ainda não numa instalação real trocando a peça física de verdade.

---

## 12. Onde mexer quando precisar

| Quero mudar... | Vou em... |
|---|---|
| Preço de um tipo de lavagem numa unidade | `/admin/maquinas` (aba da unidade) — não é mais global |
| Nome dos 4 tipos de lavagem | `/admin/precos` |
| Percentual de cada participante numa máquina (lavagem ou aspirador) | `/admin/maquinas` (seção "Participação na máquina — Lavagens" / "— Aspirador") |
| Habilitar/preço/duração do aspirador numa máquina | `/admin/maquinas` (seção "Aspirador de pó") |
| Publicar firmware novo da câmera (OTA) | subir `PILI_FW_VERSION`, copiar `.bin` pra `server/public/firmware/camera.bin`, subir `camera-version.json` |
| Lógica de cálculo de comissão/divisão | `server/lib/comissao.ts` |
| Aprovar/rejeitar pedido de papel (lavador/comissão/aluguel) | `/admin/usuarios` (seção "Cadastros a aprovar"), `server/app/api/parceiro/solicitar/route.ts` |
| Como a fila/reserva funciona | `server/lib/reservations.ts` |
| Como a placa é lida | `server/lib/lpr.ts`, `server/lib/vision-claude.ts` |
| Login/cadastro do cliente | `server/app/api/auth/*`, `mobile/src/app/{login,cadastro}.tsx` |
| Ciclo físico de lavagem (giro, carrinho, processos) | `testes/w1_w2_por_rxtx/waveshare1/maquina_estados.h`, `processos.h` |
| Regras do X10 / pausa e retomada | `maquina_estados.h` (`x10_pausa_tick`), `processos.h` (`giro_rewind_tick`) |
| Entradas/saídas, HOME, painel físico | `waveshare1/controle.h` |
| Link W1↔W2 por cabo | `waveshare1/link_w2_uart.h`, `link_frame.h`, `link_cfg.h`, `waveshare2/waveshare2.ino` |
| Telas do display | `testes/display/display.ino`, `nuvem_display.h` |
| Firmware antigo (consulta) | `lixo/` (mapa em `lixo/LEIAME.md`) |
| O que a câmera manda/recebe da nuvem | `firmware_camera/src/main.cpp` |
| Painel do admin | `server/app/admin/*` |
| App do lavador | `mobile/src/app/(tabs)/minha-maquina.tsx`, `server/app/api/lavador/*` |
| Notificações push | `server/lib/push.ts` |
| Ambiente de teste local | `server/.env` (local) vs `server/.env.production` (real) |

## Apêndice A — Firmware ANTIGO do display (`lixo/lava_car_485/display/`) — só referência

> **Histórico.** Este é o firmware de produção até 2026-10 (display como mestre, RS-485 para as Waveshares). Foi movido para `lixo/` em 2026-11-03 e **não roda mais na máquina**; a descrição fica aqui porque a lógica de processos, os sensores e o fluxo de cadastro/licença foram a base do firmware atual (seção 3) e porque é o plano B documentado. Os caminhos citados neste apêndice estão em `lixo/lava_car_485/`.

Projeto Arduino (`display.ino` + vários `.h`). Board: ESP32S3 Dev Module, Flash 16MB, PSRAM OPI 8MB, tela Waveshare ESP32-S3-Touch-LCD-7 (800×480, LVGL 8.4).

FQBN validado (**importante — outras combinações já causaram tela branca**):
```
esp32:esp32:esp32s3:CDCOnBoot=default,FlashMode=qio,FlashSize=16M,PartitionScheme=default_8MB,PSRAM=opi,CPUFreq=240
```

### A.1 `tipos.h`
Definições compartilhadas: enums de processo (`Processo`) e estado automático (`EstadoAuto`), todo o **protocolo ESP-NOW** (tipos de mensagem `MSG_*` e as structs `Msg*` — precisam bater **byte a byte** com a câmera), mapeamento de saídas físicas (Y1–Y15), endereços Modbus, cores da interface.

Mapeamento de saídas (motor/solenoides):
- Waveshare 1: Y1 (solenoide Cor Mágica), Y2 (Espuma A), Y3 (Espuma B), Y4 (giro do braço — trava mútua com Y14), Y5 (compressor secagem), Y6 (entrada pneumática), Y7 (bomba espuma), Y11 (lâmpada verde).
- Waveshare 2: Y10 (bomba espuma baixo), Y12 (luz vermelha), Y13 (bomba alta pressão), Y14 (deslocamento — trava mútua com Y4), Y0 (junto com Cor Mágica).

Botões físicos de início manual (presencial, pago em dinheiro): **X1=modelo1, X2=modelo2, X5=modelo3, X6=modelo4** (X3=manual/auto, X4=pause). Ver seção 6.6 pra como isso vira registro na nuvem.

### A.2 `maquina_estados.h` + `processos.h`
A **máquina de estados do ciclo automático**:
```
IDLE -> AGUARDA_CARRO -> CARRO_ENTRANDO -> AGUARDA_POS
     -> INICIANDO(6s) -> PROCESSO(sub-máquinas) -> CONCLUIDO -> IDLE
```
Qualquer erro leva a `AUTO_ERRO` (para tudo, acende vermelho piscando).

Processos implementados (cada um com sub-máquina própria, não-bloqueante): Pré-lavagem/Enxágue, Alta Pressão (giro triplo), Espuma A (com giro), Espuma B, Cor Mágica, Cera de Água, Secagem. O giro do braço tem lógica elaborada de rampa de desaceleração, debounce de sensores e "fine-homing" (busca fina por pulsos quando o giro para perto do home mas não exato).

**Rampa de desaceleração do carrinho (Y14)**: tanto no avanço (ao perder o X10) quanto no retorno final (ao achar o X12), o carrinho desacelera suavemente em vez de parar seco — padronizado em **350ms** (`CARR_RAMPA_MS`, era 500ms) em `processos.h`, igual ao HOME (`HOME_X12_RAMPA_MS` em `modbus_waveshares.h`, que tem sua própria máquina de estados separada). Toda sub-máquina de retorno (Pré-Lavagem, Alta Pressão, e os processos simples via `_proc_simples` — Espuma A/B, Cor Mágica, Cera, Secagem) usa a mesma função compartilhada `carr_rev_x12_tick()`; só o jog manual (botão de segurar "carrinho" na tela manual) para instantaneamente, de propósito.

Pausas finais ajustadas por pedido do operador: Espuma A e Cor Mágica = 60s (eram 15s e 45s).

Sensores (nomes herdados do CLP original):
- X0/X7 (Waveshare 1): indutivo de deslocamento / giro braço posição intermediária.
- X10–X17 (Waveshare 2): carro sob a mesa, giro intermediário, fins de curso, **X14 (carro entrando)**, **X15 (carro na posição de lavagem)**, HOME do braço.

**Recuperação no boot**: se a máquina perder energia no meio de um ciclo, ao religar ela detecta se está "fora do zero" e faz um HOME automático (com luz piscando avisando), sem intervenção manual — a menos que tenha um carro em cima (aí só pisca vermelho até tirarem).

Ao concluir um ciclo (`AUTO_CONCLUIDO`), o firmware já sabe se a lavagem foi iniciada pelo app (tem `reservationId` salvo) ou pelos botões físicos (X1-X6, sem reserva) — manda `backend_evt_wash_complete()` com `source="remote"` no segundo caso, e incrementa contadores locais separados por origem (NVS `p1_pres`/`p1_app` etc, só pra exibição na tela — ver 6.6 pra como isso também alimenta a nuvem).

### A.3 `modbus_waveshares.h` + `vfd_rs485.h`
Comunicação RS-485 Modbus RTU com as 2 Waveshares + o inversor, num barramento único e compartilhado (mutex serializa tudo). Leitura de sensores é feita com **latch por interrupção + read-and-clear** (a Waveshare captura o pulso no hardware, o display consome e zera) — resolve o problema antigo de pulsos curtos se perderem entre leituras.

Task de polling roda no **core 0** (separado da UI, que fica no core 1) pra não competir com o LVGL.

### A.4 `comm_espnow.h`
ESP-NOW só com a câmera agora (não fala mais com as Waveshares). Roteia as mensagens recebidas pros handlers certos (Wi-Fi config, heartbeat, eventos, scan de redes, provisionamento, busca de unidade, troca de câmera — ver A.9).

**"Modo caça" (adicionado 09-19)**: quando o técnico aperta Buscar/Enviar numa das telas de cadastro e não há contato recente com a câmera (`espnow_camera_perdida()`, >3s sem ouvir nada dela), o display varre os 13 canais em **background, sem travar o toque/LVGL** (`espnow_cacar_tick()`, chamado todo `loop()`), ficando 1,3s em cada um (tem que ser maior que o intervalo de anúncio da câmera, que é 1s) e repetindo as voltas até achar ou o técnico cancelar saindo da tela. Substitui a lógica antiga de "isolado → estaciona no canal 1", que era passiva e só funcionava se o display por acaso já estivesse parado no canal certo no momento exato do anúncio da câmera.

Alarme de "câmera sem contato" continua em 60s (só informativo, mostra na tela).

### A.5 `backend_client.h` + `licenca.h`
Como o display não tem internet, ele manda seu estado (`FREE`/`WASHING`) pra câmera a cada 5s (`HB_INTERVAL_MS`, reduzido de 10s pra isso — era o mesmo intervalo da câmera, agora o display avisa com o dobro de frequência), e ela relay o POST `/api/machine/heartbeat` de verdade, devolvendo a resposta (`MSG_HB_RESP`) com: estado da lâmpada, dados de licença, comando de início (`start`) quando há uma reserva paga esperando, e comando do **aspirador** (`vacuum_seg` — segundos restantes, -1 = inativo).

**Aspirador (DO8)**: `_backend_processar_vacuum()`, chamada a cada ciclo de heartbeat, liga/desliga o relé do aspirador (`SET_ASPIRADOR`, `maquina_estados.h`) só conforme o campo `vacuum_seg` da resposta — nunca olha `g_estado_auto`, então não interfere numa lavagem em andamento. O backend é a fonte da verdade do tempo restante (ver 6.6c); o firmware só reflete ligado/desligado.

**Duas travas de licença independentes:**
- Pagamento: aviso aos 40 dias sem pagar, bloqueio aos 50 dias (ou `blocked=true` do backend).
- Comunicação: 15 dias sem nenhum heartbeat 200 OK também bloqueia.

Fila de eventos (car-entered / wash-complete / fault) fica em **ring buffer na NVS** — só sai da fila quando a câmera confirma que o backend aceitou (ACK), garantindo que o débito da lavagem nunca se perde mesmo com internet instável.

### A.6 `lampada_app.h`
Controla a lâmpada bicolor (Y11 verde / Y12 vermelho) segundo o `lightState` que vem do backend, com prioridade: recuperação de boot > bloqueio de licença > erro local (sempre pisca vermelho) > estado do app > processo de lavagem em andamento.

### A.7 `wifi_manager.h`
O display **não conecta no Wi-Fi** — só guarda as credenciais (SSID/senha/URL/device-key) e manda pra câmera por ESP-NOW quando ela pede (`MSG_WIFI_REQ`/`MSG_WIFI_CFG`), ou quando alguém salva pela tela de configuração. `enviar_cfg_camera()` varre os 13 canais pra ENVIAR a config nova (garante que a câmera receba onde quer que esteja) e se estaciona no canal 1 esperando ela confirmar o canal novo.

### A.8 Telas (LVGL)
- `tela_manual.h`: tela padrão — controles manuais, contadores, status do inversor, diagnóstico dos 16 sensores. Botão "Técnico" leva pro menu de recadastro (`scr_boot_tipo`).
- `tela_auto.h`: seleção de programa automático + painel temporário de ajuste fino do giro (tuning ao vivo).
- `tela_config.h` / `tela_velocidades.h` / `tela_modelos.h`: parâmetros do sistema, velocidades por etapa, sequência de processos por modelo.
- `tela_senha.h`: teclado numérico genérico — 3 modos: `PAG` (senha de pagamento/acerto, padrão 3462), `CFG` (senha de config, padrão 1111), `TEC` (acesso técnico, padrão **2828** — ver A.9).
- `tela_senhas_cfg.h`: alterar as senhas acima.
- `tela_wifi.h`: configuração Wi-Fi — a câmera é quem escaneia redes (o display nunca mexe no próprio rádio pra isso). Acessível direto da tela inicial de cadastro (botão "Configurar Wi-Fi", 09-19) pra locais onde a rede padrão do firmware não existe. Tem também um campo de **SSID digitado manualmente** (alternativa ao dropdown do scan), útil se o scan falhar ou se o touch não alcançar o dropdown naquela área da tela.

### A.9 `tela_boot.h` — Cadastro da máquina (testado em bancada 09-19)

Na **primeira ligada** (NVS ainda sem `provisionado=true`), o display entra direto nessa tela em vez da tela normal. O botão **"ACESSO TÉCNICO"** foi corrigido em 09-19: antes levava pro mesmo formulário que "CADASTRAR MÁQUINA" já abria sem senha nenhuma (tornando a senha inútil ali); agora leva pra tela de **operação normal** (de onde já dá pra entrar em Configurar Wi-Fi).

```
[CADASTRAR MÁQUINA] -> [NOVA] ou [TROCOU O DISPLAY] ou [TROCOU A CÂMERA]
[ACESSO TÉCNICO]     -> pede senha (padrão 2828) -> tela de OPERAÇÃO normal
[CONFIGURAR WI-FI]   -> direto, sem senha
```

- **NOVA**: primeiro passo é uma **busca de unidades já cadastradas** por cidade (`MSG_UNI_REQ`/`MSG_UNI_RESP`, câmera consulta `GET /api/machine/unidades`) — evita duplicar unidade quando o endereço é digitado diferente da vez anterior (achado real: "Joao Carlon" x "Rua João Carlon" viraram duas unidades antes desse fix). Se encontrar, o técnico escolhe da lista e o **número da máquina já vem pré-preenchido** com o próximo livre daquela unidade (`proximoNumero`, calculado no backend). Se não encontrar (ou "Nenhuma dessas"), cai no formulário livre de sempre (cidade+rua+número). Em qualquer um dos dois casos, o display **gera sua própria identidade** (deviceKey = `ESP.getEfuseMac()`, nunca escolhido por ninguém) e manda pra câmera por ESP-NOW (`MSG_PROV_REQ`); a câmera faz o POST `/api/machine/provisionar` (protegido por `PILI_PROVISION_SECRET`).
- **TROCOU O DISPLAY** (só o display quebrou, a câmera continua a mesma): o display **não consulta a nuvem**. Ele pergunta pra câmera local "quem é você?" (`MSG_IDENT_REQ`) — como o ESP-NOW é rádio de curto alcance, só existe resposta se a câmera estiver **fisicamente por perto**. É essa distância física que impede pegar a máquina errada, não uma senha ou lista escolhida na tela.
- **TROCOU A CÂMERA** (novidade 09-19, só a câmera quebrou, o display continua o mesmo): o display **já sabe sua própria identidade** (salva desde o cadastro original) e empurra ela pra câmera nova por ESP-NOW (`MSG_IDPUSH_REQ`/`MSG_IDPUSH_RESP`) — sem tocar na nuvem, o registro da máquina não muda, só a câmera física aprende quem ela é. Se o display não tiver identidade salva (NVS em branco também), avisa pra usar "NOVA" primeiro.

Depois de cadastrada, a tela nunca mais aparece sozinha — a máquina liga direto na operação normal.

### A.10 `hard_reset.h`
Reinicia o chip inteiro **uma vez** ao energizar (não em loop) — a ESP32-S3 é conhecida por subir com o painel/PSRAM em estado inconsistente no boot frio. Tem uma flag `HARD_RESET_APAGA_NVS` (normalmente 0) que, se ligada, também zera toda a NVS (reset de fábrica) — só pra usar propositalmente numa bancada.

### A.11 `lvgl_v8_port.*` e `esp_panel_board_custom_conf.h`
Código de porting oficial da Espressif (não é nosso, CC0/Apache) — ponte entre o driver do painel e o LVGL, e configuração de pinos do hardware (barramento RGB, touch I2C GT911, backlight, etc.).

---

---

## Apêndice B — Firmware ANTIGO das Waveshares (`lixo/lava_car_485/waveshare1/` e `waveshare2/`) — só referência

Firmware antigo (escravos Modbus do display, hoje substituídos pela W1 controladora e pela W2 por cabo — seções 3 e 4). Eram dois firmwares quase idênticos (endereço Modbus 1 e 2), rodando na placa Waveshare ESP32-S3-POE-ETH-8DI-8DO. Cada uma:
- Lê 8 entradas digitais (lógica NPN, ativo em nível baixo) com **latch por interrupção** (`attachInterruptArg` na borda de descida) — captura o pulso no instante exato, mesmo que dure só 1ms, e guarda até o display ler (leitura destrutiva/read-and-clear).
- Escreve 8 saídas via expansor I2C PCA9554.
- Fala Modbus RTU sobre RS-485 (FC02 leitura de entradas — endereço 0-7 = nível ao vivo, 8-15 = latch; FC05 escrita de saída única).
- Trava de segurança: o canal do contator (giro na Waveshare 1 / deslocamento na Waveshare 2) tem um tempo mínimo de 500ms desligado antes de religar (protege contra reversão brusca do motor).
- Waveshare 2 tem um canal **bloqueado por hardware** (Y15/DO5) que nunca aciona, de propósito.

---

---

*Documento gerado por revisão completa do código-fonte em 2026-09-18, atualizado em 2026-09-19, 2026-10-11 (aspirador de pó, OTA da câmera, câmera ao vivo, comissão por escopo, watchdog/recuperação da câmera, ajustes de rampa) e **2026-11-03** (firmware reescrito: W1 controladora, W2 e cabo UART, regras do X10, reinícios/ocorrências, câmera v7; firmware antigo nos Apêndices A e B). Atualize conforme o sistema evoluir — este arquivo não se atualiza sozinho.*

## Cron de expiração (Railway) — configurado em 2026-11-01
O cron do Railway não chama URL: ele executa um serviço no horário e espera que termine. Por isso existe um **serviço separado `cron-pili`** no mesmo projeto/ambiente (Pili Lave / produção), e **nunca** se usa o campo "Cron Schedule" do serviço `pili-lave` (ele derrubaria o app).
- Imagem `node:20-alpine`; Cron Schedule `*/5 * * * *` (UTC); Restart Policy Never; sem domínio.
- Start Command: `node -e "fetch(process.env.CRON_URL,{method:'POST',headers:{'x-cron-secret':process.env.CRON_SECRET}}).then(async r=>{console.log(r.status,await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})"`
- Variáveis do `cron-pili`: `CRON_SECRET=${{pili-lave.CRON_SECRET}}` (referência, o valor mora só no app) e `CRON_URL=https://pili-lave-production.up.railway.app/api/cron/expire-reservations`.
- Conferir: aba **Cron Runs** do `cron-pili` (execução verde, log `200 {"ok":true,"expired":N,"requeued":N,"offline":N,"saude":{...}}`). `401` = segredo diferente do app.
- A rota roda `expireStale()` e `verificarEAlertar()`: reservas vencidas, máquina offline e alertas de saúde ao admin sem precisar do painel aberto.
- Deploy do app: o Railway segue a branch `main` (deploy automático, espera o CI do GitHub). Ao subir só uma correção, usar commit isolado sobre `origin/main`; não dar merge de branch inteira sem avaliar migrations.
