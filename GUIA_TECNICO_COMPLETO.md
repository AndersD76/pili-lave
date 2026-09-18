# PILI CLEAN — Guia Técnico Completo

> Documento de referência de tudo que existe no sistema até 2026-09-18: firmware (display, Waveshares, câmera), backend, app mobile, PWA, painel admin e banco de dados. Escrito a partir da leitura completa do código-fonte — quando algo é uma limitação conhecida ou pendência, está marcado explicitamente.

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
- **Painel admin** (dentro do `server/`) — visão gerencial, cadastro de lavadores, controle de licença/pagamento por máquina.

**Hospedagem:** backend no **Railway** (`pili-lave-production.up.railway.app`), banco Postgres no **Neon**.

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

---

## 3. Firmware do Display — `lava_car_485/display/`

Projeto Arduino (`display.ino` + vários `.h`). Board: ESP32S3 Dev Module, Flash 16MB, PSRAM OPI 8MB, tela Waveshare ESP32-S3-Touch-LCD-7 (800×480, LVGL 8.4).

### 3.1 `tipos.h`
Definições compartilhadas: enums de processo (`Processo`) e estado automático (`EstadoAuto`), todo o **protocolo ESP-NOW** (tipos de mensagem `MSG_*` e as structs `Msg*` — precisam bater **byte a byte** com a câmera), mapeamento de saídas físicas (Y1–Y15), endereços Modbus, cores da interface.

Mapeamento de saídas (motor/solenoides):
- Waveshare 1: Y1 (solenoide Cor Mágica), Y2 (Espuma A), Y3 (Espuma B), Y4 (giro do braço — trava mútua com Y14), Y5 (compressor secagem), Y6 (entrada pneumática), Y7 (bomba espuma), Y11 (lâmpada verde).
- Waveshare 2: Y10 (bomba espuma baixo), Y12 (luz vermelha), Y13 (bomba alta pressão), Y14 (deslocamento — trava mútua com Y4), Y0 (junto com Cor Mágica).

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

### 3.3 `modbus_waveshares.h` + `vfd_rs485.h`
Comunicação RS-485 Modbus RTU com as 2 Waveshares + o inversor, num barramento único e compartilhado (mutex serializa tudo). Leitura de sensores é feita com **latch por interrupção + read-and-clear** (a Waveshare captura o pulso no hardware, o display consome e zera) — resolve o problema antigo de pulsos curtos se perderem entre leituras.

Task de polling roda no **core 0** (separado da UI, que fica no core 1) pra não competir com o LVGL.

### 3.4 `comm_espnow.h`
ESP-NOW só com a câmera agora (não fala mais com as Waveshares). Roteia as mensagens recebidas pros handlers certos (Wi-Fi config, heartbeat, eventos, scan de redes, provisionamento — ver 3.9). Tem alarme de "câmera sem contato" (60s) e mecanismo de "estacionar no canal 1" se ficar isolado por muito tempo (5 min) esperando reencontrar a câmera.

### 3.5 `backend_client.h` + `licenca.h`
Como o display não tem internet, ele manda seu estado (`FREE`/`WASHING`) pra câmera a cada 10s (`MSG_HB_STATE`), e ela relay o POST `/api/machine/heartbeat` de verdade, devolvendo a resposta (`MSG_HB_RESP`) com: estado da lâmpada, dados de licença, e comando de início (`start`) quando há uma reserva paga esperando.

**Duas travas de licença independentes:**
- Pagamento: aviso aos 40 dias sem pagar, bloqueio aos 50 dias (ou `blocked=true` do backend).
- Comunicação: 15 dias sem nenhum heartbeat 200 OK também bloqueia.

Fila de eventos (car-entered / wash-complete / fault) fica em **ring buffer na NVS** — só sai da fila quando a câmera confirma que o backend aceitou (ACK), garantindo que o débito da lavagem nunca se perde mesmo com internet instável.

### 3.6 `lampada_app.h`
Controla a lâmpada bicolor (Y11 verde / Y12 vermelho) segundo o `lightState` que vem do backend, com prioridade: recuperação de boot > bloqueio de licença > erro local (sempre pisca vermelho) > estado do app > processo de lavagem em andamento.

### 3.7 `wifi_manager.h`
O display **não conecta no Wi-Fi** — só guarda as credenciais (SSID/senha/URL/device-key) e manda pra câmera por ESP-NOW quando ela pede (`MSG_WIFI_REQ`/`MSG_WIFI_CFG`), ou quando alguém salva pela tela de configuração.

### 3.8 Telas (LVGL)
- `tela_manual.h`: tela padrão — controles manuais, contadores, status do inversor, diagnóstico dos 16 sensores.
- `tela_auto.h`: seleção de programa automático + painel temporário de ajuste fino do giro (tuning ao vivo).
- `tela_config.h` / `tela_velocidades.h` / `tela_modelos.h`: parâmetros do sistema, velocidades por etapa, sequência de processos por modelo.
- `tela_senha.h`: teclado numérico genérico — 3 modos: `PAG` (senha de pagamento/acerto, padrão 3462), `CFG` (senha de config, padrão 1111), `TEC` (acesso técnico, padrão **2828** — ver 3.9).
- `tela_senhas_cfg.h`: alterar as senhas acima.
- `tela_wifi.h`: configuração Wi-Fi — a câmera é quem escaneia redes (o display nunca mexe no próprio rádio pra isso).

### 3.9 `tela_boot.h` — Cadastro da máquina (implementado em 2026-09-18, **NÃO TESTADO EM HARDWARE**)

Na **primeira ligada** com essa versão de firmware (NVS ainda sem `provisionado=true`), o display entra direto nessa tela em vez da tela normal:

```
[CADASTRAR MÁQUINA]  ->  [NOVA]  ou  [SUBSTITUIÇÃO]
[ACESSO TÉCNICO]      ->  pede senha (padrão 2828)
```

- **NOVA**: técnico digita Cidade + Rua + Número da máquina. O display **gera sua própria identidade** (deviceKey = ID único do chip ESP32, `ESP.getEfuseMac()` — nunca escolhido por ninguém, nunca se repete) e manda pra câmera por ESP-NOW (`MSG_PROV_REQ`); a câmera faz o POST `/api/machine/provisionar` (protegido por uma senha de fábrica, `PILI_PROVISION_SECRET`, gravada igual em todo firmware).
- **SUBSTITUIÇÃO** (só o display quebrou, a câmera continua a mesma): o display **não consulta a nuvem**. Ele pergunta pra câmera local "quem é você?" (`MSG_IDENT_REQ`) — como o ESP-NOW é rádio de curto alcance, só existe resposta se a câmera estiver **fisicamente por perto**. É essa distância física que impede pegar a máquina errada, não uma senha ou lista escolhida na tela. A câmera guarda a identidade na própria NVS (sobrevive à troca do display sozinha).

Depois de cadastrada, a tela nunca mais aparece sozinha — a máquina liga direto na operação normal. Um botão **"Técnico"** na tela manual (perto do "Config") reabre o menu sob demanda (recadastrar, repetir substituição).

**Pendência conhecida**: a tela "NOVA" ainda não tem uma lista pra escolher uma unidade **já existente** (evitaria digitar o endereço de novo) — hoje sempre digita cidade+rua na hora. O backend já resolve duplicidade por comparação sem acento/maiúscula (ver seção 6.7), mas uma lista seria mais seguro ainda. Fica pra uma próxima passada.

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
- **LPR**: máquina de estados não-bloqueante — no máximo 1 tentativa HTTP por passagem do `loop()`, timeout de 15s (`PILI_LPR_HTTP_TIMEOUT`), até 3 tentativas antes de descartar o frame. *(Nota histórica: um timeout de 6s tinha sido testado e causou queda no reconhecimento por matar handshakes TLS que ainda iam funcionar — corrigido voltando a 15s.)*
- **Relay de eventos** (car-entered/wash-complete/fault): recebe do display por ESP-NOW, faz o POST, e só confirma (`MSG_EVT_ACK`) quando o backend responde 200 — garante que o débito nunca se perde.
- **Watchdog de ESP-NOW**: se ficar 60s sem NENHUM envio bem-sucedido (não só falha de resposta — falha ao enviar mesmo), reinicia o chip sozinho — achado real em campo onde o ESP-NOW "morria" silenciosamente sem derrubar o Wi-Fi/streaming.
- **Provisionamento** (`MSG_PROV_REQ`/`MSG_IDENT_REQ`, ver 3.9): faz o POST de cadastro e guarda a identidade (cidade/rua/número/deviceKey) na própria NVS — é essa cópia que permite a "Substituição" funcionar sem depender da nuvem.

---

## 6. Backend — `server/` (Next.js 16, App Router, Prisma + Postgres/Neon)

### 6.1 Autenticação
Três sistemas de auth **separados e independentes**:
1. **Cliente do app**: e-mail + senha (`/api/auth/register`, `/api/auth/login`) — JWT de 180 dias guardado no `SecureStore` do celular. *(Login por SMS/OTP existe ainda no código — `lib/otp.ts` — mas não é mais usado por nenhuma tela; mantido só por legado.)* **Não existe "esqueci minha senha"** (removido a pedido — não enviamos nada por e-mail).
2. **Admin** (`/admin`): usuário + senha únicos (`ADMIN_USER`/`ADMIN_PASSWORD` no ambiente), cookie JWT de 7 dias. Sem essas variáveis configuradas, o painel fica **aberto sem senha** (fase de teste) — hoje já protegido em produção.
3. **Dispositivos** (display/câmera/máquina): header `x-device-key` — cada `Machine` tem seu próprio `deviceKey` único (`requireMachine()` resolve pelo header). Rotas de câmera legadas usam uma chave global (`DEVICE_KEY`) mais simples (`requireDevice()`).

### 6.2 Modelo de dados (Prisma) — visão geral
- **User**: cliente, lavador ou admin (`role`). `walletCents` é um cache — a fonte da verdade é `WalletTx`.
- **Vehicle**: placa normalizada, programa padrão.
- **Program**: os 4 tipos de lavagem (preço, duração).
- **WashStation**: a **unidade** (endereço — cidade + rua).
- **Machine**: a máquina física, pertence a uma `WashStation`, tem `numero` (posição na unidade), `deviceKey`, status ao vivo, sensores X14/X15, contadores de lavagem, controle de licença (`lastPaymentDate`), e **`operadorId`** (o lavador responsável).
- **Order**: a compra (voucher). Status `PAID` → `REDEEMED` (lavagem concluída) ou `CANCELED` (estorno).
- **Reservation**: o motor real da fila — `HELD` (pago, esperando 1h) → `ACTIVE` (placa reconhecida, máquina livre, verde aceso) → `ENTERED` (X14 confirmou) → `COMPLETED` (**único ponto de débito de verdade**) / `EXPIRED` / `CANCELED` / `FAILED`.
- **Arrival**: registro de cada leitura de câmera, pra exibição no app (`WAITING_DRIVER`, `SUGGESTED` quando a leitura foi de baixa confiança e bate com a fila).
- **WalletTx**: extrato real da carteira (TOPUP/WASH/REFUND/ADJUST).
- **PushSubscription**: inscrições de notificação push (Web Push/VAPID).
- **Event**: log genérico de auditoria (praticamente tudo relevante gera um Event).

### 6.3 Fluxo de reserva e pagamento
1. Cliente compra pelo app (`POST /api/orders`) → debita a carteira na hora, cria `Order` (PAID) + `Reservation` (HELD, válida por 1h).
2. Quando o carro chega, a câmera lê a placa → `handlePlateRead()` promove `HELD` → `ACTIVE` (se a máquina estiver livre) ou mantém na fila com o relógio congelado (se estiver ocupada — não queima o tempo do cliente por culpa da operação).
3. Sensor X14 confirma o carro entrando → `ENTERED`.
4. Máquina reporta conclusão (`wash-complete`) → `COMPLETED` — **é aqui, e só aqui, que o valor é debitado de verdade** (a reserva só "segurava" o saldo).
5. **Estorno automático**: se a reserva vence (1h) sem ser usada, o valor volta sozinho pro saldo (implementado em 2026-09-17 — antes ficava preso). Se a máquina travar durante a lavagem (2× a duração do programa sem concluir), também estorna sozinho.

**Alternativas de liberação sem câmera:**
- **"Cheguei" na compra** (`jaEstouNaMaquina`): libera na hora se a máquina estiver livre.
- **"Cheguei" numa reserva já existente** (`POST /api/reservations/[id]/confirmar-chegada`): pra quando a câmera não reconheceu a placa. Se a unidade tiver mais de uma máquina, pergunta qual (`escolherMaquina: true` + lista de números) antes de liberar.

### 6.4 Reconhecimento de placa (LPR)
`POST /api/lpr/frame` recebe o JPEG cru da câmera. Filtro de cena primeiro (compara tamanho do arquivo pra não gastar orçamento de IA em cena parada). A leitura em si é feita pela **API de visão da Anthropic** (`lib/vision-claude.ts`) — sem cota mensal, foi a solução que substituiu o Plate Recognizer (que tinha estourado a cota e derrubado o sistema por dias em 08/09). Fallback: Plate Recognizer (se configurado) → Tesseract (bancada).

Leitura de alta confiança (≥0.97) libera sozinha; leitura fraca compara contra quem já pagou e está na fila — se bater com exatamente um veículo, cria uma "sugestão" (`Arrival.SUGGESTED`) que o motorista confirma no app ("é o seu carro?").

### 6.5 Sistema multi-máquina (implementado em 2026-09-17/18)
Uma unidade (`WashStation`) pode ter **várias máquinas** (`Machine.numero`). A compra não escolhe qual máquina — entra numa **fila única**: quando promove a reserva, pega **qualquer máquina livre daquela unidade** (`machineForStation()`). O cliente só escolhe manualmente quando libera sem câmera e há mais de uma máquina (ver 6.3).

**Provisionamento** (`POST /api/machine/provisionar`): cadastro automático de máquina nova — recebe o ID único do chip + unidade (existente por `stationId`, ou nova por cidade+rua) + número. Reconhece unidade já existente mesmo com **acento e maiúscula diferentes** (achado real testando o retrofit da máquina em produção — o teclado do display provavelmente não digita "ã" fácil). Protegido por `PROVISION_SECRET` (senha de fábrica).

### 6.6 Sistema de lavador (implementado em 2026-09-18)
`Machine.operadorId` vincula um usuário (`role: LAVADOR`) a uma máquina específica. O admin faz isso direto num dropdown em `/admin/maquinas`. Quando a máquina falha/trava/fica offline, **o lavador daquela máquina** recebe push notification (além do admin) — antes só o admin era avisado. `GET /api/lavador/painel` devolve, só das máquinas do lavador logado: status ao vivo, lavagens e faturamento (hoje/7 dias/30 dias).

### 6.7 Rotas de API — mapa geral
```
/api/auth/            register, login  (cliente — e-mail/senha)
                       otp/request, otp/verify  (legado, não usado por nenhuma tela)
/api/me                perfil do cliente logado
/api/vehicles           CRUD de veículos
/api/programs           lista os 4 tipos de lavagem
/api/orders             compra de lavagem (voucher)
/api/reservations       criar/listar reservas; [id]/cancel; [id]/confirmar-chegada
/api/arrivals/mine      chegada atual do cliente (pra tela inicial)
/api/arrivals/[id]/confirm   responder a uma sugestão de placa
/api/stations           lista pública de unidades (mapa do app)
/api/wallet             saldo e extrato
/api/push/              inscrição de push notification
/api/lavador/painel     painel do lavador (só as máquinas dele)
/api/lpr/frame          recebe foto da câmera, aciona o LPR
/api/machine/           heartbeat, car-entered, wash-complete, fault, provisionar
/api/admin/machine/payment   marcar pagamento em dia (legado, ver /admin/maquinas)
/api/cron/expire-reservations   cron do Railway (a cada 5 min) — expira reservas, estorna, checa saúde
/api/saude              diagnóstico de saúde da operação (usado pelo app antes de deixar comprar)
```

### 6.8 Saúde da operação (`lib/saude.ts`)
Três coisas precisam estar vivas pra uma lavagem acontecer: o **display** (executa o ciclo), a **câmera** (reconhece a placa) e a **internet** da máquina (se cai, os dois somem juntos). `diagnosticar()` calcula isso; `verificarEAlertar()` (rodado pelo cron) avisa admin + lavador quando há problema, com **dedup por tipo+máquina** (10 min) pra não virar spam.

**Limitação conhecida**: `diagnosticar()` hoje sempre olha a "máquina padrão" (`findFirst`) — não está totalmente adaptado pro cenário de múltiplas máquinas ainda (funciona certo com 1 máquina por unidade, que é o caso real hoje).

### 6.9 Notificações push (`lib/push.ts`)
Web Push com chaves VAPID. `avisarCliente()` manda pra todos os aparelhos inscritos de um usuário (limpa inscrições mortas automaticamente); `avisarAdmins()` manda pra todos os admins. Nunca derruba o fluxo principal se falhar — push é extra.

---

## 7. App Mobile — `mobile/` (Expo/React Native + Expo Router)

Estrutura de abas (`src/app/(tabs)/`):
- **Início** (`index.tsx`): saldo, reserva ativa (com contagem regressiva, botão "Cheguei" manual, cancelar), veículos, sugestão de placa fraca pra confirmar.
- **Unidades**: lista/mapa das unidades (`/api/stations`), com status agregado (aberto/ocupado/manutenção).
- **Carteira**: saldo e extrato, recarga.
- **Planos**: os tipos de lavagem.
- **Minha Máquina** (`minha-maquina.tsx`, **só aparece pra `role: LAVADOR`**): painel da(s) máquina(s) que o usuário administra.
- **Perfil**: dados, biometria, sair.

Telas fora das abas: `cadastro.tsx` / `login.tsx` (e-mail+senha), `onboarding.tsx` (3 passos, termina na tela de recarga), `nova-lavagem.tsx`, `veiculo-novo.tsx`, `recarga.tsx`, `historico.tsx`, `meus-dados.tsx`, `voucher/[id].tsx`, `scanner.tsx` (lavador escaneia voucher no balcão).

**Sessão**: token JWT guardado no `expo-secure-store` (`lib/session.tsx`), com opção de **biometria** (Face ID/digital) como trava extra ao abrir o app (`lib/biometria.ts`) — configurável em "Meus dados".

---

## 8. PWA — `server/app/(pwa)/`

Versão web do app, servida pelo mesmo Next.js do backend (rota `/app`). Mesmas telas conceituais do mobile (cadastro, login, onboarding, home, lavagem, recarga, histórico, perfil), com componentes próprios (`CameraAoVivo.tsx`, `ProgressoLavagem.tsx`, `StatusMaquina.tsx`, `AvisosPush.tsx`). Também tem `/camera` (painel de luz pro celular fixo na máquina) e `/capturas` (debug: últimas fotos + o que a IA leu).

---

## 9. Painel Admin — `server/app/admin/`

- **Visão geral** (`/admin`): vendas hoje/7d/30d, resgates, recargas, saldo total em carteiras, lavagens por programa.
- **Lavagens** (`/admin/lavagens`): últimas 200, com status/voucher/quem resgatou.
- **Usuários** (`/admin/usuarios`): lista completa, promove/rebaixa entre Cliente/Lavador.
- **Máquinas** (`/admin/maquinas`): status online/offline, sensores, licença/pagamento (marcar pago hoje, pôr em manutenção), **e o vínculo com o lavador responsável**.

---

## 10. Variáveis de ambiente relevantes (`server/.env`)

| Variável | Pra que serve |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Postgres (Neon) — pooled/direta |
| `JWT_SECRET` | assina tokens de sessão e admin |
| `ADMIN_USER` / `ADMIN_PASSWORD` | login do painel admin |
| `SMS_PROVIDER` / `SMS_API_KEY` | legado, não usado no login principal |
| `PLACA_PROVIDER` / `PLACA_API_KEY` / `PLACA_DEVICE_TOKEN` | fallback de LPR (hoje o principal é a IA da Anthropic) |
| `ASAAS_*` | pagamento (recarga de saldo) |
| `DEVICE_KEY` | chave genérica legada de dispositivo |
| `MACHINE_DEVICE_KEY` | seed da máquina padrão |
| `CRON_SECRET` | protege o cron de expiração |
| `PROVISION_SECRET` | senha de fábrica do auto-cadastro de máquina |
| `PLATE_RECOGNIZER_TOKEN` | fallback de LPR |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | push notifications |

Firmware da câmera tem seu próprio `PILI_PROVISION_SECRET` (deve bater com o `PROVISION_SECRET` do backend).

---

## 11. Pendências e limitações conhecidas

- **Firmware do display/câmera com o cadastro novo (seção 3.9) não foi testado em hardware** — só revisado manualmente (sem toolchain Arduino disponível no ambiente de desenvolvimento). Testar na bancada antes de gravar em produção.
- **Sem lista de "unidade já existente"** na tela de cadastro do display — sempre digita cidade/rua na hora (mitigado por comparação sem acento no backend, mas uma lista seria mais seguro).
- **`diagnosticar()`** (saúde da operação) ainda assume a "máquina padrão" — não totalmente adaptado pra várias máquinas simultâneas.
- **Sem "esqueci minha senha"** por decisão do usuário (não querem depender de provedor de e-mail ainda).
- **Sem provedor de e-mail configurado** — se no futuro precisar (recibos, etc.), precisa escolher um serviço.
- **OTA (atualização de firmware remota)** não existe — toda atualização exige cabo USB no local.
- **Diagnóstico remoto fino** (sensores individuais, sub-estado do processo) não chega na nuvem hoje — só aparece na tela física ou no `Serial`.
- **PROVISION_SECRET e ADMIN_PASSWORD**: confirme que estão configurados em produção (Railway) antes de considerar o sistema fechado para acesso externo — o padrão do projeto é "sem a variável, fica aberto (fase de teste)".

---

## 12. Onde mexer quando precisar

| Quero mudar... | Vou em... |
|---|---|
| Regra de preço/tempo de lavagem | `server/prisma/schema.prisma` (`Program`) + `/admin` |
| Como a fila/reserva funciona | `server/lib/reservations.ts` |
| Como a placa é lida | `server/lib/lpr.ts`, `server/lib/vision-claude.ts` |
| Login/cadastro do cliente | `server/app/api/auth/*`, `mobile/src/app/{login,cadastro}.tsx` |
| Ciclo físico de lavagem (giro, carrinho, processos) | `lava_car_485/display/maquina_estados.h`, `processos.h` |
| Telas do display | `lava_car_485/display/tela_*.h` |
| O que a câmera manda/recebe da nuvem | `firmware_camera/src/main.cpp` |
| Painel do admin | `server/app/admin/*` |
| App do lavador | `mobile/src/app/(tabs)/minha-maquina.tsx`, `server/app/api/lavador/*` |
| Notificações push | `server/lib/push.ts` |

---

*Documento gerado por revisão completa do código-fonte em 2026-09-18. Atualize conforme o sistema evoluir — este arquivo não se atualiza sozinho.*
