# PILI LAVE — Passo a passo completo

Guia definitivo: do zero até o app rodando no celular, pagamentos PIX,
painel admin e totem. Siga na ordem. Os valores reais das variáveis estão
em `server/.env` (local, fora do git).

---

## PARTE 1 — Servidor no ar (Railway + Neon) · ~15 min

O banco Neon **já está criado, migrado e populado** (programas 1–4). Falta só
o deploy do servidor.

1. Acesse https://railway.app e entre com sua conta GitHub (AndersD76).
2. **New Project → Deploy from GitHub repo** → escolha `AndersD76/pili-lave`.
3. No serviço criado: **Settings → Root Directory** = `server` (importante!).
4. **Variables → Raw Editor** → cole o bloco de variáveis (nomes abaixo,
   valores no seu `server/.env`):
   ```
   DATABASE_URL=        (string POOLED do Neon, com -pooler)
   DIRECT_URL=          (a mesma sem -pooler)
   JWT_SECRET=          (o gerado no .env)
   ADMIN_PASSWORD=      (TROQUE por uma senha só sua)
   SMS_PROVIDER=console
   SMS_API_KEY=
   PLACA_PROVIDER=none
   PLACA_API_KEY=
   PLACA_DEVICE_TOKEN=
   ASAAS_BASE_URL=https://api-sandbox.asaas.com/v3
   ASAAS_API_KEY=       (parte 2)
   ASAAS_WEBHOOK_TOKEN= (o gerado no .env)
   ```
5. **Deploy**. Ao terminar, o Railway dá uma URL tipo
   `https://pili-lave-production.up.railway.app`. Anote — ela é a **URL DO SERVIDOR**.
6. Teste no navegador:
   - `SUA_URL/api/programs` → deve listar os 4 tipos de lavagem em JSON.
   - `SUA_URL/admin` → tela de login escura; entre com o `ADMIN_PASSWORD`.

✅ Pronto quando: o `/admin` abre e mostra os cartões de contagem.

---

## PARTE 2 — Asaas (pagamentos PIX) · ~10 min

Comece no **sandbox** (dinheiro de mentira) e depois troque para produção.

1. Crie a conta sandbox: https://sandbox.asaas.com (é separada da conta real).
2. Lá dentro: **Integrações → Chave de API → Gerar**. Copie a chave.
3. No Railway → Variables → `ASAAS_API_KEY` = a chave. Redeploy automático.
4. Ainda no Asaas: **Integrações → Webhooks → Novo webhook**:
   - URL: `SUA_URL/api/asaas/webhook`
   - Token de autenticação: o valor de `ASAAS_WEBHOOK_TOKEN`
   - Eventos: **PAYMENT_RECEIVED** e **PAYMENT_CONFIRMED**
   - Versão: v3 · Ativo: sim
5. Teste (parte 4): recarga PIX no app → no sandbox do Asaas, abra a cobrança
   e use **"Pagar" simulado** → o saldo entra sozinho no app em ~3 s.

**Quando for pra valer**: crie a chave na conta real (https://www.asaas.com),
troque `ASAAS_BASE_URL` para `https://api.asaas.com/v3`, refaça o webhook
apontando pra mesma URL, e pronto.

✅ Pronto quando: uma recarga teste vira saldo no app sem você tocar em nada.

---

## PARTE 3 — App no seu celular (Expo Go) · ~10 min

Para desenvolver e testar. Build de loja é a parte 7.

1. Instale o **Expo Go** (Play Store / App Store).
2. No PC:
   ```powershell
   cd C:\Users\Daniel Anders\dev\pili-lave\mobile
   npx expo start
   ```
3. Celular na **mesma rede WiFi** → escaneie o QR do terminal com o Expo Go.
4. O app abre direto na tela de login. Duas formas de apontar a API:
   - **Servidor local** (padrão): rode também `cd server && npm run dev` em
     outro terminal. O app acha o server sozinho pelo IP. O código SMS
     aparece **no terminal do server** (modo console).
   - **Servidor do Railway**: crie `mobile/.env` com
     `EXPO_PUBLIC_API_URL=https://SUA_URL` e reinicie o `expo start`.
     (Com SMS_PROVIDER=console no Railway, o código aparece nos **logs do
     Railway** — Deployments → View Logs.)
5. Fluxo de teste completo:
   1. Login com seu celular → código → entra.
   2. Perfil → coloque seu nome.
   3. Início → Adicionar veículo → placa (ex.: `ABC1D23`).
   4. Carteira → Adicionar saldo → R$ 30 → paga o PIX (sandbox: simulado).
   5. Início → **Nova lavagem** → escolha o tipo → Pagar com saldo.
   6. Aparece o **QR do voucher** — "Mostre este código ao lavador".

✅ Pronto quando: você tem um voucher QR na tela.

---

## PARTE 4 — Lavador (quem escaneia e libera) · ~3 min

1. O lavador instala o Expo Go e entra no app com o **telefone dele** (login normal).
2. Você, no **`SUA_URL/admin` → Usuários** → ache o telefone dele →
   **"Tornar lavador"**.
3. No app do lavador: **Perfil → Modo lavador** (botão ciano) → permitir câmera.
4. Ele aponta a câmera pro QR do cliente → tela verde **"Lavagem liberada"**
   com tipo, placa e valor. O mesmo QR não passa duas vezes.

✅ Pronto quando: o resgate aparece no `/admin` (Visão geral e Lavagens).

---

## PARTE 4B — Câmera de placa + luz verde (FLUXO PRINCIPAL) · teste com 2 celulares

O fluxo principal agora é: **câmera lê a placa → nuvem identifica o usuário e
o saldo → motorista toca "Solicitar lavagem" no app → luz verde libera**.

1. **Celular 1 = câmera da máquina**: abra `SUA_URL/camera`, cole a
   `DEVICE_KEY` (está no `server/.env`), toque **Ligar câmera (OCR)** e aponte
   para uma placa — ou use a **digitação manual** para testar sem carro.
   A tela mostra as mensagens do motorista: *"Olá, fulano — abra o app"*,
   *"Saldo insuficiente — adicione saldo"* ou *"Não cadastrado — baixe o app"*.
2. **Celular 2 = motorista**: com o app aberto (`SUA_URL/app`), em ~4 s
   aparece **"Seu carro chegou!"** → toque → escolha a lavagem → **Liberar**.
3. O celular 1 vira a **LUZ VERDE** (tela verde com o tipo de lavagem) e
   confirma sozinho para a nuvem. Débito na carteira, tudo registrado no /admin.
4. Equipamento definitivo depois: `camera/pili_camera.py` (mini-PC/RPi +
   webcam/RTSP + Plate Recognizer free + relé serial). Os tempos de ciclo são
   do IoT da máquina — a nuvem só manda "libera lavagem tipo N".

## PARTE 5 — SMS de verdade (produção) · ~15 min

Em dev o código sai no log (`console`). Para SMS real:

1. Crie conta na **BrasilSMS** (https://brasilsms.com) — tem R$5 de teste —
   e gere a chave de API. (Alternativas: MSG91, Twilio.)
2. Railway → Variables: `SMS_PROVIDER=brasilsms` e `SMS_API_KEY=sua_chave`.
3. Teste um login de verdade. Se o formato da API deles divergir, o ponto
   único de ajuste é `server/lib/otp.ts` → função `sendSms()`.

---

## PARTE 6 — Consulta de placa (opcional) · ~15 min

Sem isso o app já valida o **formato** da placa. Com isso ele preenche
marca/modelo/cor sozinho:

1. Crie conta na **APIBrasil** (https://apibrasil.com.br) → produto
   *Consulta Veículos* → gere `Bearer token` e `DeviceToken` (free tier: ~7
   consultas/dia — cada placa só é consultada 1 vez, fica cacheada).
2. Railway → Variables: `PLACA_PROVIDER=apibrasil`,
   `PLACA_API_KEY=bearer`, `PLACA_DEVICE_TOKEN=device`.

---

## PARTE 7 — Publicar nas lojas (quando o MVP estiver validado)

1. Conta **Expo** (grátis): `npx expo login`.
2. `npm install -g eas-cli` → `eas build:configure` dentro de `mobile/`.
3. `EXPO_PUBLIC_API_URL` apontando pro Railway (arquivo `eas.json`/env).
4. **Android**: conta Google Play Console (US$25 única) →
   `eas build -p android` → `eas submit -p android`.
5. **iOS**: Apple Developer (US$99/ano) → `eas build -p ios` → `eas submit`.
6. Ícone e splash já estão prontos no projeto.

---

## PARTE 8 — Totem físico (firmware) · quando as placas chegarem na bancada

O firmware está pronto e compilado em `firmware/pili_lave_totem/`
(detalhes em `firmware/pili_lave_totem/README.md` e `HANDOFF_IA.md`).

1. Edite `pili_lave_config.h`: WiFi, chave Asaas, e `PILI_LAVE_ROLE`
   (1 = totem com tela de venda, 2 = máquina que recebe o START).
2. Compile e grave (placa no USB, ajuste a COM):
   ```powershell
   $cli  = "C:\Users\Daniel Anders\arduino-cli-bin\arduino-cli.exe"
   $fqbn = "esp32:esp32:esp32s3:PSRAM=opi,PartitionScheme=huge_app"
   $libs = "C:\Users\Daniel Anders\OneDrive\3. DANIEL ANDERS\Documentos\Arduino\libraries"
   $aj   = "C:\Users\Daniel Anders\pili_build\extra_libs\ArduinoJson"
   $sk   = "C:\Users\Daniel Anders\dev\pili-lave\firmware\pili_lave_totem"
   $out  = "C:\Users\Daniel Anders\pili_build\pililave_out"
   & $cli compile --fqbn $fqbn --library $aj --libraries $libs --build-path $out $sk
   & $cli upload  -p COM7 --fqbn $fqbn --input-dir $out $sk
   ```
3. Grave a **placa 1 com ROLE 1** e a **placa 2 com ROLE 2**. As duas no
   mesmo WiFi (ESP-NOW usa o canal do roteador).
4. Relé de partida da máquina: GPIO6 (conector "Sensor AD"), pulso de 1 s.

---

## CREDENCIAIS — onde pegar cada token, um por um

| Variável | Onde conseguir | Caminho exato |
|---|---|---|
| `DATABASE_URL` / `DIRECT_URL` | **Neon** (já tem) | console.neon.tech → seu projeto → **Connection string** → copie a *pooled*; a `DIRECT_URL` é a mesma removendo `-pooler` do host |
| `JWT_SECRET` | **já gerado** | está no `server/.env` local (não precisa criar conta em nada) |
| `ADMIN_PASSWORD` | **você inventa** | qualquer senha forte — é a senha do `/admin` |
| `ASAAS_API_KEY` (sandbox) | **Asaas Sandbox** | sandbox.asaas.com → criar conta → menu do perfil → **Integrações → Chave de API → Gerar chave** → copie (começa com `$aact_`) |
| `ASAAS_API_KEY` (produção) | **Asaas real** | asaas.com → conta aprovada → **Integrações → Chave de API** (e mude `ASAAS_BASE_URL` p/ `https://api.asaas.com/v3`) |
| `ASAAS_WEBHOOK_TOKEN` | **já gerado** | está no `server/.env`; você só **cola ele no Asaas** ao cadastrar o webhook (campo "Token de autenticação") |
| `SMS_API_KEY` | **BrasilSMS** | brasilsms.com → criar conta (ganha R$5) → painel → **API / Integrações → Gerar token** → `SMS_PROVIDER=brasilsms` |
| `PLACA_API_KEY` + `PLACA_DEVICE_TOKEN` | **APIBrasil** | apibrasil.com.br → criar conta → **Painel → Dispositivos → Novo dispositivo** (gera o *DeviceToken*) → **Perfil → Credenciais** (gera o *Bearer*) → assine o plano free de **Consulta Veículos** → `PLACA_PROVIDER=apibrasil` |
| Expo/EAS (lojas) | **Expo** | expo.dev → criar conta grátis → `npx expo login` no PC (token não vai em variável) |
| Google Play | **Google** | play.google.com/console → taxa única US$25 |
| Apple | **Apple** | developer.apple.com → US$99/ano |

> Ordem prática: Railway (parte 1) funciona **sem nenhum token novo** — só
> Neon + os já gerados. Asaas sandbox é o único indispensável pra testar
> pagamento. SMS e placa podem esperar; o app funciona em modo console/formato.

## Operação no dia a dia

- **Painel**: `SUA_URL/admin` — contagens do dia, vendas por tipo, saldo em
  carteiras (passivo), últimas lavagens, gestão de lavadores.
- **Preços/nomes das lavagens**: por enquanto direto no banco (tabela
  `Program` no Neon → SQL Editor) — tela de edição no admin é próximo passo.
- **Limpar dados de teste**: apagar no Neon os usuários `+5554900000001/2`
  (e cascata) quando for pra produção — ou me pedir que eu limpo.

## Se algo der errado

| Sintoma | Causa provável | Onde olhar |
|---|---|---|
| App não conecta | server local parado / rede diferente | terminal do `expo start` |
| Código SMS não chega | SMS_PROVIDER=console | logs do server/Railway |
| PIX não credita | webhook não cadastrado ou token errado | Asaas → Webhooks → logs |
| "Sem permissão" no scanner | usuário não é lavador | /admin → Usuários |
| Placa recusada | formato inválido | ABC1234 ou ABC1D23 |
