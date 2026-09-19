# PILI CLEAN — Guia Técnico Completo

> Documento de referência de tudo que existe no sistema até 2026-09-19: firmware (display, Waveshares, câmera), backend, app mobile, PWA, painel admin e banco de dados. Escrito a partir da leitura completa do código-fonte — quando algo é uma limitação conhecida ou pendência, está marcado explicitamente.

---

## 1. Visão geral

PILI CLEAN é um sistema de lavagem automática de carros **sem operador fixo no local**: o cliente reserva/paga pelo app, a câmera reconhece a placa do carro na chegada, a máquina libera sozinha e executa o ciclo de lavagem automaticamente.

**Por máquina física instalada**, o hardware é:
- 1 **display** touchscreen (ESP32-S3, tela LVGL 800×480) — executa o ciclo de lavagem e a interface do painel físico.
- 2 **Waveshares** ESP32-S3-POE-ETH-8DI-8DO — expansores de I/O (8 entradas + 8 saídas cada), ligados via RS-485.
- 1 **inversor de frequência** Delta MS300 — controla o motor (giro do braço / deslocamento do carrinho), também em RS-485.
- 1 **câmera** ESP32-CAM (AI-Thinker) — tira fotos da placa e é o **único ponto de conexão com a internet** da máquina.

**Softwares:**
- **App mobile** (Expo/React Native) — cliente final: cadastro, compra de lavagem, acompanhamento.
- **PWA** (Next.js, dentro do próprio `server/`) — versão web do app, mesma função.
- **Backend** (Next.js API Routes + Prisma + Postgres) — cérebro de tudo: pagamento, fila, reconhecimento de placa (IA), heartbeat das máquinas, admin.
- **Painel admin** (dentro do `server/`) — visão gerencial, cadastro de lavadores, preço por unidade, divisão admin/lavador, controle de licença/pagamento por máquina.

**Hospedagem:** backend no **Railway** (`pili-lave-production.up.railway.app`), banco Postgres no **Neon**.

**Ambiente de teste local:** desde 2026-09-18 existe um Postgres local (`pililave_dev`) pra testar sem tocar em produção — `server/.env` aponta pra ele por padrão; `server/.env.production` guarda as credenciais reais (nunca carregado por `next dev`). Migrações precisam ser aplicadas **manualmente** nos dois lados (`npx prisma migrate deploy`, trocando o `.env` temporariamente pra produção) — o deploy do Railway **não roda migração sozinho**.

---

## 2. Arquitetura de comunicação (o pulo do gato)

```
[Display] <--RS-485 Modbus--> [Waveshare 1] (I/O grupo 1)
    |                          [Waveshare 2] (I/O grupo 2)
    |                          [Inversor Delta MS300] (motor)
    |
    +----ESP-NOW (rádio local, sem internet)----> [Câmera]
                                                       |
                                                    HTTPS
                                                       |
                                                       v
                                                  [Backend / Nuvem]
```

Pontos importantes:
- **O display NÃO tem Wi-Fi/internet** (não tem RAM suficiente pra TLS). Ele só fala ESP-NOW com a câmera.
- **A câmera é o gateway de nuvem**: é ela quem conecta no Wi-Fi, é a "mestre de canal" (avisa display+Waveshares em qual canal do rádio ela está), e faz todo o HTTPS (heartbeat, envio de fotos LPR, eventos, provisionamento).
- **ESP-NOW é rádio de curto alcance** (dezenas de metros) — isso é usado deliberadamente como trava de segurança na troca de peça (ver seção 3.9).
- **Waveshares migraram de ESP-NOW pra RS-485 cabeado** (mudança que deu nome à pasta `lava_car_485`) — só a câmera continua em ESP-NOW com o display.
- **Achado real em teste de bancada (09-19)**: quando a câmera muda de rede Wi-Fi (e portanto de canal) enquanto já está em operação, o display **não tinha como descobrir sozinho** o canal novo — os dois ficavam "surdos" um pro outro até um reset manual. Corrigido com o "modo caça" (ver 3.4).

---

## 3. Firmware do Display — `lava_car_485/display/`

Projeto Arduino (`display.ino` + vários `.h`). Board: ESP32S3 Dev Module, Flash 16MB, PSRAM OPI 8MB, tela Waveshare ESP32-S3-Touch-LCD-7 (800×480, LVGL 8.4).

FQBN validado (**importante — outras combinações já causaram tela branca**):
```
esp32:esp32:esp32s3:CDCOnBoot=default,FlashMode=qio,FlashSize=16M,PartitionScheme=default_8MB,PSRAM=opi,CPUFreq=240
```

### 3.1 `tipos.h`
Definições compartilhadas: enums de processo (`Processo`) e estado automático (`EstadoAuto`), todo o **protocolo ESP-NOW** (tipos de mensagem `MSG_*` e as structs `Msg*` — precisam bater **byte a byte** com a câmera), mapeamento de saídas físicas (Y1–Y15), endereços Modbus, cores da interface.

Mapeamento de saídas (motor/solenoides):
- Waveshare 1: Y1 (solenoide Cor Mágica), Y2 (Espuma A), Y3 (Espuma B), Y4 (giro do braço — trava mútua com Y14), Y5 (compressor secagem), Y6 (entrada pneumática), Y7 (bomba espuma), Y11 (lâmpada verde).
- Waveshare 2: Y10 (bomba espuma baixo), Y12 (luz vermelha), Y13 (bomba alta pressão), Y14 (deslocamento — trava mútua com Y4), Y0 (junto com Cor Mágica).

Botões físicos de início manual (presencial, pago em dinheiro): **X1=modelo1, X2=modelo2, X5=modelo3, X6=modelo4** (X3=manual/auto, X4=pause). Ver seção 6.6 pra como isso vira registro na nuvem.

### 3.2 `maquina_estados.h` + `processos.h`
A **máquina de estados do ciclo automático**:
```
IDLE -> AGUARDA_CARRO -> CARRO_ENTRANDO -> AGUARDA_POS
     -> INICIANDO(6s) -> PROCESSO(sub-máquinas) -> CONCLUIDO -> IDLE
```
Qualquer erro leva a `AUTO_ERRO` (para tudo, acende vermelho piscando).

Processos implementados (cada um com sub-máquina própria, não-bloqueante): Pré-lavagem/Enxágue, Alta Pressão (giro triplo), Espuma A (com giro), Espuma B, Cor Mágica, Cera de Água, Secagem. O giro do braço tem lógica elaborada de rampa de desaceleração, debounce de sensores e "fine-homing" (busca fina por pulsos quando o giro para perto do home mas não exato).

Sensores (nomes herdados do CLP original):
- X0/X7 (Waveshare 1): indutivo de deslocamento / giro braço posição intermediária.
- X10–X17 (Waveshare 2): carro sob a mesa, giro intermediário, fins de curso, **X14 (carro entrando)**, **X15 (carro na posição de lavagem)**, HOME do braço.

**Recuperação no boot**: se a máquina perder energia no meio de um ciclo, ao religar ela detecta se está "fora do zero" e faz um HOME automático (com luz piscando avisando), sem intervenção manual — a menos que tenha um carro em cima (aí só pisca vermelho até tirarem).

Ao concluir um ciclo (`AUTO_CONCLUIDO`), o firmware já sabe se a lavagem foi iniciada pelo app (tem `reservationId` salvo) ou pelos botões físicos (X1-X6, sem reserva) — manda `backend_evt_wash_complete()` com `source="remote"` no segundo caso, e incrementa contadores locais separados por origem (NVS `p1_pres`/`p1_app` etc, só pra exibição na tela — ver 6.6 pra como isso também alimenta a nuvem).

### 3.3 `modbus_waveshares.h` + `vfd_rs485.h`
Comunicação RS-485 Modbus RTU com as 2 Waveshares + o inversor, num barramento único e compartilhado (mutex serializa tudo). Leitura de sensores é feita com **latch por interrupção + read-and-clear** (a Waveshare captura o pulso no hardware, o display consome e zera) — resolve o problema antigo de pulsos curtos se perderem entre leituras.

Task de polling roda no **core 0** (separado da UI, que fica no core 1) pra não competir com o LVGL.

### 3.4 `comm_espnow.h`
ESP-NOW só com a câmera agora (não fala mais com as Waveshares). Roteia as mensagens recebidas pros handlers certos (Wi-Fi config, heartbeat, eventos, scan de redes, provisionamento, busca de unidade, troca de câmera — ver 3.9).

**"Modo caça" (adicionado 09-19)**: quando o técnico aperta Buscar/Enviar numa das telas de cadastro e não há contato recente com a câmera (`espnow_camera_perdida()`, >3s sem ouvir nada dela), o display varre os 13 canais em **background, sem travar o toque/LVGL** (`espnow_cacar_tick()`, chamado todo `loop()`), ficando 1,3s em cada um (tem que ser maior que o intervalo de anúncio da câmera, que é 1s) e repetindo as voltas até achar ou o técnico cancelar saindo da tela. Substitui a lógica antiga de "isolado → estaciona no canal 1", que era passiva e só funcionava se o display por acaso já estivesse parado no canal certo no momento exato do anúncio da câmera.

Alarme de "câmera sem contato" continua em 60s (só informativo, mostra na tela).

### 3.5 `backend_client.h` + `licenca.h`
Como o display não tem internet, ele manda seu estado (`FREE`/`WASHING`) pra câmera a cada 10s (`MSG_HB_STATE`), e ela relay o POST `/api/machine/heartbeat` de verdade, devolvendo a resposta (`MSG_HB_RESP`) com: estado da lâmpada, dados de licença, e comando de início (`start`) quando há uma reserva paga esperando.

**Duas travas de licença independentes:**
- Pagamento: aviso aos 40 dias sem pagar, bloqueio aos 50 dias (ou `blocked=true` do backend).
- Comunicação: 15 dias sem nenhum heartbeat 200 OK também bloqueia.

Fila de eventos (car-entered / wash-complete / fault) fica em **ring buffer na NVS** — só sai da fila quando a câmera confirma que o backend aceitou (ACK), garantindo que o débito da lavagem nunca se perde mesmo com internet instável.

### 3.6 `lampada_app.h`
Controla a lâmpada bicolor (Y11 verde / Y12 vermelho) segundo o `lightState` que vem do backend, com prioridade: recuperação de boot > bloqueio de licença > erro local (sempre pisca vermelho) > estado do app > processo de lavagem em andamento.

### 3.7 `wifi_manager.h`
O display **não conecta no Wi-Fi** — só guarda as credenciais (SSID/senha/URL/device-key) e manda pra câmera por ESP-NOW quando ela pede (`MSG_WIFI_REQ`/`MSG_WIFI_CFG`), ou quando alguém salva pela tela de configuração. `enviar_cfg_camera()` varre os 13 canais pra ENVIAR a config nova (garante que a câmera receba onde quer que esteja) e se estaciona no canal 1 esperando ela confirmar o canal novo.

### 3.8 Telas (LVGL)
- `tela_manual.h`: tela padrão — controles manuais, contadores, status do inversor, diagnóstico dos 16 sensores. Botão "Técnico" leva pro menu de recadastro (`scr_boot_tipo`).
- `tela_auto.h`: seleção de programa automático + painel temporário de ajuste fino do giro (tuning ao vivo).
- `tela_config.h` / `tela_velocidades.h` / `tela_modelos.h`: parâmetros do sistema, velocidades por etapa, sequência de processos por modelo.
- `tela_senha.h`: teclado numérico genérico — 3 modos: `PAG` (senha de pagamento/acerto, padrão 3462), `CFG` (senha de config, padrão 1111), `TEC` (acesso técnico, padrão **2828** — ver 3.9).
- `tela_senhas_cfg.h`: alterar as senhas acima.
- `tela_wifi.h`: configuração Wi-Fi — a câmera é quem escaneia redes (o display nunca mexe no próprio rádio pra isso). Acessível direto da tela inicial de cadastro (botão "Configurar Wi-Fi", 09-19) pra locais onde a rede padrão do firmware não existe.

### 3.9 `tela_boot.h` — Cadastro da máquina (testado em bancada 09-19)

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

### 3.10 `hard_reset.h`
Reinicia o chip inteiro **uma vez** ao energizar (não em loop) — a ESP32-S3 é conhecida por subir com o painel/PSRAM em estado inconsistente no boot frio. Tem uma flag `HARD_RESET_APAGA_NVS` (normalmente 0) que, se ligada, também zera toda a NVS (reset de fábrica) — só pra usar propositalmente numa bancada.

### 3.11 `lvgl_v8_port.*` e `esp_panel_board_custom_conf.h`
Código de porting oficial da Espressif (não é nosso, CC0/Apache) — ponte entre o driver do painel e o LVGL, e configuração de pinos do hardware (barramento RGB, touch I2C GT911, backlight, etc.).

---

## 4. Firmware das Waveshares — `lava_car_485/waveshare1/` e `waveshare2/`

Dois firmwares quase idênticos (endereço Modbus 1 e 2), rodando na placa Waveshare ESP32-S3-POE-ETH-8DI-8DO. Cada uma:
- Lê 8 entradas digitais (lógica NPN, ativo em nível baixo) com **latch por interrupção** (`attachInterruptArg` na borda de descida) — captura o pulso no instante exato, mesmo que dure só 1ms, e guarda até o display ler (leitura destrutiva/read-and-clear).
- Escreve 8 saídas via expansor I2C PCA9554.
- Fala Modbus RTU sobre RS-485 (FC02 leitura de entradas — endereço 0-7 = nível ao vivo, 8-15 = latch; FC05 escrita de saída única).
- Trava de segurança: o canal do contator (giro na Waveshare 1 / deslocamento na Waveshare 2) tem um tempo mínimo de 500ms desligado antes de religar (protege contra reversão brusca do motor).
- Waveshare 2 tem um canal **bloqueado por hardware** (Y15/DO5) que nunca aciona, de propósito.

---

## 5. Firmware da Câmera — `firmware_camera/`

Roda num ESP32-CAM (AI-Thinker, sensor OV2640). Arquivo único `src/main.cpp` + `src/pili_cam_config.h`.

**Papel: gateway de nuvem "burro de propósito".** Não tem sensor de presença, não decide nada — manda uma foto crua pro backend a cada 8s (`PILI_ENVIO_INTERVALO_MS`), sempre, tenha carro ou não. Toda a inteligência (ler a placa, decidir se tem carro, liberar a máquina) roda na **nuvem** via IA.

Funções principais:
- **Modo CONFIG vs CONECTADA**: sem credenciais salvas (NVS vazia), fica no canal 1 pedindo config (`MSG_WIFI_REQ`) até o display responder. Com credenciais, conecta e vira mestre de canal.
- **Heartbeat** a cada 10s: `POST /api/machine/heartbeat` com o estado que o display mandou; relay da resposta (lâmpada/licença/start) de volta pro display.
- **LPR**: máquina de estados não-bloqueante — no máximo 1 tentativa HTTP por passagem do `loop()`, timeout de 15s (`PILI_LPR_HTTP_TIMEOUT`), até 3 tentativas antes de descartar o frame.
- **Relay de eventos** (car-entered/wash-complete/fault): recebe do display por ESP-NOW, faz o POST, e só confirma (`MSG_EVT_ACK`) quando o backend responde 200 — garante que o débito nunca se perde. `wash-complete` com `source="remote"` (lavagem presencial, sem reserva) vira um registro de `LavagemPresencial` na nuvem (ver 6.6) em vez de ser descartado como "órfão".
- **Watchdog de ESP-NOW**: se ficar 60s sem NENHUM envio bem-sucedido (não só falha de resposta — falha ao enviar mesmo), reinicia o chip sozinho.
- **Timeout de handshake TLS (adicionado 09-19)**: `tls.setHandshakeTimeout()` em **todas** as chamadas HTTPS. Achado real em teste de bancada: com Wi-Fi fraco/instável, o handshake TLS podia ficar pendurado indefinidamente e travava o chip inteiro (só um reset físico recuperava) — o `HTTPClient.setTimeout()` sozinho não cobria essa fase.
- **Provisionamento** (`MSG_PROV_REQ`): faz o POST de cadastro e guarda a identidade (cidade/rua/número/deviceKey) na própria NVS.
- **Identidade** (`MSG_IDENT_REQ`, troca de display): responde com o que já tem salvo, sem tocar na nuvem.
- **Busca de unidades** (`MSG_UNI_REQ`, 09-19): faz `GET /api/machine/unidades?cidade=X` e devolve a lista paginada por ESP-NOW.
- **Recebe identidade** (`MSG_IDPUSH_REQ`, troca de câmera, 09-19): aplica localmente o que o display mandou (`aplicarIdPush()`), sem chamada nenhuma pra nuvem.

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
- **MachineParticipante** (nova, 09-19): quem participa financeiramente de uma máquina — `machineId` + `userId` + `tipo` (enum `TipoParticipacao`: `LAVADOR`/`COMISSAO1`/`COMISSAO2`/`ALUGUEL`) + `percentual`. Substitui o antigo split fixo 55/45. Ver 6.6.
- **Vehicle**: placa normalizada, programa padrão.
- **Program**: os 4 tipos de lavagem — hoje só o **nome** é editável de forma centralizada (aba `/admin/precos`); o `precoCents` do Program é o valor de fábrica, praticamente não usado desde que o preço passou a ser por unidade (ver `StationPrograma`).
- **StationPrograma** (nova, 09-19): preço de um tipo de lavagem **numa unidade específica** — cada unidade cobra o valor que quiser, preenchido do zero (não herda de nenhum "padrão" central). `lib/precos.ts` (`precoEfetivo()`) resolve o preço certo na hora de cobrar.
- **WashStation**: a **unidade** (endereço — cidade + rua).
- **Machine**: a máquina física, pertence a uma `WashStation`, tem `numero` (posição na unidade), `deviceKey`, status ao vivo, sensores X14/X15, contadores de lavagem, controle de licença (`lastPaymentDate` — também serve de ponto de "fechamento" pra todo mundo que participa dela), e a lista de `MachineParticipante` vinculados (Lavador, Comissão 1, Comissão 2, Aluguel — ver 6.6). O campo antigo `operadorId` foi substituído pelo participante do tipo `LAVADOR`.
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

Leitura de alta confiança (≥0.97) libera sozinha; leitura fraca compara contra quem já pagou e está na fila — se bater com exatamente um veículo, cria uma "sugestão" (`Arrival.SUGGESTED`) que o motorista confirma no app ("é o seu carro?").

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
- `participacoesDaMaquina(machineId)` — lista os participantes cadastrados na máquina.
- `percentualDoUsuarioNaMaquina(machineId, userId)` — percentual de uma pessoa específica.
- `percentualAdmin(machineId)` — calcula o que sobra pro admin (100% menos a soma dos cadastrados).
- `participacaoDe(...)` / `divisaoCompleta(...)` — quebra o valor faturado (presencial/app, por tipo de lavagem) entre todos os participantes + admin.
- `relatorioMaquinaPara(machineId, userId, periodo)` — monta o relatório de uma pessoa específica numa máquina (usado tanto pelo painel do lavador quanto pelo do parceiro).

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
- Filtro por tipo de cadastro em `/admin/usuarios`: abas no topo (Todos/Cliente/Lavador/Comissão 1/Comissão 2/Aluguel/Admin) com contagem, via `?filtro=` na URL.
- No mobile, a visibilidade das abas "Minha Máquina" e "Comissões" é baseada em **capacidade aprovada** (solicitação com `status: APROVADA`), não mais só no campo `role` — uma pessoa aprovada como Lavador e também como Aluguel vê as duas abas ao mesmo tempo.

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
/api/machine/           heartbeat, car-entered, wash-complete (app + presencial), fault,
                        provisionar, unidades (busca por cidade)
/api/admin/machine/payment   marcar pagamento em dia (legado, ver /admin/maquinas)
/api/cron/expire-reservations   cron do Railway (a cada 5 min) — expira reservas, estorna, checa saúde
/api/saude              diagnóstico de saúde da operação (usado pelo app antes de deixar comprar)
```

### 6.9 Saúde da operação (`lib/saude.ts`)
Três coisas precisam estar vivas pra uma lavagem acontecer: o **display** (executa o ciclo), a **câmera** (reconhece a placa) e a **internet** da máquina (se cai, os dois somem juntos). `diagnosticar()` calcula isso; `verificarEAlertar()` (rodado pelo cron) avisa admin + lavador quando há problema, com **dedup por tipo+máquina** (10 min) pra não virar spam.

**Limitação conhecida**: `diagnosticar()` hoje sempre olha a "máquina padrão" (`findFirst`) — não está totalmente adaptado pro cenário de múltiplas máquinas ainda.

### 6.10 Notificações push (`lib/push.ts`)
Web Push com chaves VAPID. `avisarCliente()` manda pra todos os aparelhos inscritos de um usuário (limpa inscrições mortas automaticamente); `avisarAdmins()` manda pra todos os admins. Nunca derruba o fluxo principal se falhar — push é extra.

---

## 7. App Mobile — `mobile/` (Expo/React Native + Expo Router)

Estrutura de abas (`src/app/(tabs)/`):
- **Início** (`index.tsx`): saldo, reserva ativa (com contagem regressiva, botão "Cheguei" manual, cancelar), veículos, sugestão de placa fraca pra confirmar. Botão "Reservar lavagem" abre a lista de **Unidades** (não vai mais direto pro formulário — ver abaixo).
- **Unidades**: lista/mapa das unidades (`/api/stations`), com status agregado (aberto/ocupado/manutenção). Tocar numa unidade abre o detalhe (`unidade/[id].tsx`) com as máquinas dela; o botão "Reservar lavagem" de lá já leva o `stationId` pra frente.
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

---

## 9. Painel Admin — `server/app/admin/`

- **Visão geral** (`/admin`): vendas hoje/7d/30d, resgates, recargas, saldo total em carteiras, lavagens por programa.
- **Lavagens** (`/admin/lavagens`): últimas 200, com status/voucher/quem resgatou.
- **Usuários** (`/admin/usuarios`): lista completa, com a seção **"Cadastros a aprovar"** no topo (solicitações pendentes de `SolicitacaoParceiro`, Aprovar/Rejeitar uma a uma) e um badge de contagem no menu. Abas de filtro por tipo de cadastro (Todos/Cliente/Lavador/Comissão 1/Comissão 2/Aluguel/Admin, via `?filtro=`). Promove/rebaixa direto pelo dropdown (Cliente/Lavador/Parceiro — escolhendo o tipo específico quando é Parceiro).
- **Preços** (`/admin/precos`, nova 09-19): só edita o **nome** dos 4 tipos de lavagem — o preço em R$ fica dentro de cada unidade (ver abaixo e 6.7).
- **Máquinas** (`/admin/maquinas`, redesenhado 09-19): cards de estatística no topo (total, offline, em manutenção, licença bloqueada) + **abas por unidade** — unidade com mais de uma máquina abre sub-abas (Máquina 1, 2, 3...) ao clicar. Uma aba **"Resumo geral / TOTAIS"** separada soma tudo (todas as máquinas) por tipo de lavagem. Dentro de cada unidade: preço dos 4 tipos (editável ali mesmo), status/licença/sensores da máquina selecionada, valor acumulado desde o último fechamento, histórico de lavagens, a seção **"Participação na máquina"** (cadastro/edição dos 4 tipos de participante com percentual, regra dos 100%) e a seção **"Divisão entre participantes"** com a tabela completa por participante (incluindo o admin calculado), por origem, mais o saldo líquido de cada um.

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
| `CRON_SECRET` | protege o cron de expiração |
| `PROVISION_SECRET` | senha de fábrica do auto-cadastro de máquina (também protege `/api/machine/unidades`) |
| `PLATE_RECOGNIZER_TOKEN` | fallback de LPR |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | push notifications |

Firmware da câmera tem seu próprio `PILI_PROVISION_SECRET` (deve bater com o `PROVISION_SECRET` do backend).

---

## 11. Pendências e limitações conhecidas

- **`diagnosticar()`** (saúde da operação) ainda assume a "máquina padrão" — não totalmente adaptado pra várias máquinas simultâneas.
- **Sem "esqueci minha senha"** por decisão do usuário (não querem depender de provedor de e-mail ainda).
- **Sem provedor de e-mail configurado** — se no futuro precisar (recibos, etc.), precisa escolher um serviço.
- **OTA (atualização de firmware remota)** não existe — toda atualização exige cabo USB no local.
- **Diagnóstico remoto fino** (sensores individuais, sub-estado do processo) não chega na nuvem hoje — só aparece na tela física ou no `Serial`.
- **PROVISION_SECRET e ADMIN_PASSWORD**: confirme que estão configurados em produção (Railway) antes de considerar o sistema fechado para acesso externo — o padrão do projeto é "sem a variável, fica aberto (fase de teste)".
- **Migrações não rodam sozinhas no deploy do Railway** — precisa aplicar manualmente (`npx prisma migrate deploy` com o `.env` apontando pra produção, revertendo logo em seguida) toda vez que o schema muda.
- **Substituição de câmera testada só parcialmente em bancada** — o fluxo ESP-NOW (`MSG_IDPUSH_*`) foi validado, mas ainda não numa instalação real trocando a peça física de verdade.

---

## 12. Onde mexer quando precisar

| Quero mudar... | Vou em... |
|---|---|
| Preço de um tipo de lavagem numa unidade | `/admin/maquinas` (aba da unidade) — não é mais global |
| Nome dos 4 tipos de lavagem | `/admin/precos` |
| Percentual de cada participante numa máquina | `/admin/maquinas` (seção "Participação na máquina") |
| Lógica de cálculo de comissão/divisão | `server/lib/comissao.ts` |
| Aprovar/rejeitar pedido de papel (lavador/comissão/aluguel) | `/admin/usuarios` (seção "Cadastros a aprovar"), `server/app/api/parceiro/solicitar/route.ts` |
| Como a fila/reserva funciona | `server/lib/reservations.ts` |
| Como a placa é lida | `server/lib/lpr.ts`, `server/lib/vision-claude.ts` |
| Login/cadastro do cliente | `server/app/api/auth/*`, `mobile/src/app/{login,cadastro}.tsx` |
| Ciclo físico de lavagem (giro, carrinho, processos) | `lava_car_485/display/maquina_estados.h`, `processos.h` |
| Telas do display | `lava_car_485/display/tela_*.h` |
| O que a câmera manda/recebe da nuvem | `firmware_camera/src/main.cpp` |
| Painel do admin | `server/app/admin/*` |
| App do lavador | `mobile/src/app/(tabs)/minha-maquina.tsx`, `server/app/api/lavador/*` |
| Notificações push | `server/lib/push.ts` |
| Ambiente de teste local | `server/.env` (local) vs `server/.env.production` (real) |

---

*Documento gerado por revisão completa do código-fonte em 2026-09-18, atualizado em 2026-09-19. Atualize conforme o sistema evoluir — este arquivo não se atualiza sozinho.*
