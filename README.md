# PILI LAVE

Plataforma do lava-rápido PILI: app mobile (cliente + lavador), servidor com
painel admin, e firmware do totem físico.

```
pili-lave/
├── mobile/    App Android/iOS (Expo/React Native, roda no Expo Go)
├── server/    API + painel admin (Next.js 16 + Prisma 6 + Postgres/Neon)
├── firmware/  Totem físico (Waveshare ESP32-S3-Touch-LCD-7, LVGL + Asaas + ESP-NOW)
└── design/    Direção de marca (BRAND.md — "verniz molhado", dark-first)
```

## Como funciona (MVP)

1. Cliente entra no app com o **celular + código SMS** (OTP).
2. Cadastra o veículo pela **placa** (formato antigo/Mercosul; consulta de
   dados via API plugável).
3. **Adiciona saldo** (carteira pré-paga) via **PIX Asaas** — QR na tela,
   crédito automático por webhook.
4. Compra a lavagem **por tipo (1–4)** com o saldo → recebe um **voucher QR**.
5. O **lavador** (papel promovido no painel admin) abre "Modo lavador" e
   **escaneia o QR com a câmera** → o servidor valida, marca como resgatada e
   a lavagem está liberada. Sem timer, sem leitura de placa na cancela.
6. O painel `/admin` mostra **contagens**: lavagens/dia, receita, saldo em
   carteiras (passivo), vendas por tipo, usuários — e promove lavadores.

## Rodar local

```bash
# servidor (porta 3000)
cd server
cp .env.example .env   # preencha Neon, Asaas, senha do admin
npm install
npx prisma db push && npm run db:seed
npm run dev

# app (Expo Go no celular, mesma rede WiFi)
cd mobile
npm install
npx expo start         # escaneie o QR com o Expo Go
```

Em dev, `SMS_PROVIDER=console` imprime o código OTP no terminal do servidor.
O app descobre a API automaticamente pelo IP do Metro; para apontar para
produção use `EXPO_PUBLIC_API_URL`.

## Deploy

- **Servidor**: Railway (serviço com *root directory* = `server/`;
  `railway.json` incluso). Variáveis: as mesmas do `.env.example`.
- **Banco**: Neon. `DATABASE_URL` = string *pooled* (`…-pooler…`),
  `DIRECT_URL` = a mesma sem `-pooler` (migrations).
- **Webhook Asaas**: aponte para `https://SEU_APP/api/asaas/webhook` com o
  token `ASAAS_WEBHOOK_TOKEN` (eventos `PAYMENT_RECEIVED`/`PAYMENT_CONFIRMED`).
- **App**: desenvolvimento via **Expo Go**; builds de loja depois via EAS.

## Integrações plugáveis (env)

| Recurso | Env | Opções |
|---|---|---|
| SMS OTP | `SMS_PROVIDER` | `console` (dev) · `brasilsms` (R$5 teste) |
| Placa | `PLACA_PROVIDER` | `none` (só formato) · `apibrasil` (7/dia grátis) · `placaapi` (10 teste) |
| Pagamento | `ASAAS_BASE_URL` | sandbox · produção |

## Pendências

- [ ] Chave Asaas (`ASAAS_API_KEY`) — sandbox primeiro
- [ ] Provedor de SMS de produção
- [ ] Ícone do app (DALL-E, prompt no histórico) → assets do Expo
- [ ] Integração totem ↔ servidor (fase 2: MQTT ou voucher no totem)
