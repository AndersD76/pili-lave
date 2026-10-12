# PILI LAVE (PILI CLEAN)

Lava-rápido automático sem operador fixo: o cliente reserva/paga pelo app, a
câmera reconhece a placa sozinha, a máquina libera e executa o ciclo de
lavagem (e, em algumas unidades, o aspirador de pó) automaticamente.

```
pili-lave/
├── mobile/        App mobile (Expo/React Native) — ainda não publicado em loja
├── server/        Backend + painel admin + PWA (Next.js 16 + Prisma 6 + Postgres/Neon)
├── lava_car_485/  Firmware do display (ESP32-S3, LVGL) + Waveshares (RS-485)
├── firmware_camera/ Firmware da câmera (ESP32-CAM) — gateway de internet da máquina
├── loja/          Programa do computador da loja de conveniência (Next.js + SQLite local) — ver loja/README.md
└── design/        Direção de marca (BRAND.md — "verniz molhado", dark-first)
```

> **O PWA (`server/app/(pwa)/app/`, acessado no navegador) é hoje a forma real
> de uso em produção** — o app mobile (pasta `mobile/`) nunca foi publicado
> numa loja, só roda via Expo Go em desenvolvimento. Veja o `GUIA_TECNICO_COMPLETO.md`
> para o detalhe completo disso e de tudo mais.

## Como funciona

1. Cliente cadastra (e-mail + senha) e adiciona veículo pela **placa**.
2. Escolhe a **unidade** (cada uma tem seu próprio preço) e compra a lavagem
   com o saldo da carteira (recarga via PIX/Asaas).
3. Ao chegar, a **câmera** (ESP32-CAM) lê a placa automaticamente e libera a
   máquina (luz verde); sem câmera disponível, dá pra liberar manualmente
   pelo botão "Cheguei".
4. O **display** (ESP32-S3 touchscreen) executa o ciclo físico de lavagem via
   RS-485 (Waveshares de I/O + inversor de frequência do motor).
5. Em unidades com aspirador de pó habilitado, o cliente também pode comprar
   esse serviço à parte (junto com a lavagem ou avulso).
6. O **painel `/admin`** mostra vendas, usuários, preços por unidade, cadastro
   de lavadores/comissionados/aluguel (com percentual próprio por máquina,
   separado para lavagens e para aspirador) e status de cada máquina.

## Documentação

- **[GUIA_TECNICO_COMPLETO.md](GUIA_TECNICO_COMPLETO.md)** — referência técnica completa (arquitetura, firmware, backend, banco de dados). Comece por aqui para entender o sistema inteiro.
- **[docs/treinamento/](docs/treinamento/)** — guias de uso para cada público: **[GUIA_ADMIN.md](docs/treinamento/GUIA_ADMIN.md)**, **[GUIA_LAVADOR.md](docs/treinamento/GUIA_LAVADOR.md)**, **[GUIA_CLIENTE.md](docs/treinamento/GUIA_CLIENTE.md)**, **[GUIA_LOJISTA.md](docs/treinamento/GUIA_LOJISTA.md)**.
- **[PROJETO_LOJA_AUTOSERVICE.md](PROJETO_LOJA_AUTOSERVICE.md)** — loja de conveniência: conceito, decisões tomadas, ordem de construção e o que já está pronto.

## Loja de conveniência (em construção)

Produto novo, no mesmo app: loja em container, sem caixa humano. O cliente entra pelo app, pega os produtos, passa no totem de autoatendimento e paga com a carteira ou no cartão; câmeras conferem o que saiu das prateleiras.

- No app, a porta de entrada passa a ser a escolha entre **Loja conveniência** e **Lavagem expressa**.
- O `server/` guarda o cadastro das lojas, quem é o dono, bloqueio de clientes e suporte.
- Cada loja roda o programa da pasta `loja/` no seu computador, com banco próprio (produtos, estoque).
- **Situação**: etapa 1 (cadastro do cliente, lojas, dono, bloqueio e suporte) e o início da etapa 2 (programa da loja: primeiro uso, produtos e estoque) estão prontos **só no ambiente local**; nada disso está em produção.

## Rodar local

```bash
# servidor + PWA (porta 3000)
cd server
cp .env.example .env   # preencha Neon, Asaas, senha do admin
npm install
npx prisma migrate dev
npm run dev             # http://localhost:3000/app (PWA) e /admin

# programa da loja de conveniência (porta 3100) — precisa do servidor acima no ar
cd loja
npm install
npm run dev             # http://localhost:3100

# app mobile (Expo Go no celular, mesma rede WiFi)
cd mobile
npm install
npx expo start          # escaneie o QR com o Expo Go
```

O app mobile descobre a API automaticamente pelo IP do Metro; para apontar
para produção, use `EXPO_PUBLIC_API_URL`.

## Deploy

- **Servidor**: Railway (*root directory* = `server/`). Variáveis: as mesmas do `.env.example`.
- **Banco**: Neon. `DATABASE_URL` = string *pooled*, `DIRECT_URL` = a mesma sem `-pooler` (migrations).
- **Migrações não rodam sozinhas no deploy** — aplicar manualmente (`npx prisma migrate deploy`, trocando o `.env` temporariamente para produção).
- **Webhook Asaas**: `https://SEU_APP/api/asaas/webhook`, protegido por `ASAAS_WEBHOOK_TOKEN`.
- **Firmware**: display e Waveshares via cabo USB (Arduino CLI); a câmera tem **OTA pelo Wi-Fi** — depois da primeira gravação por cabo, atualizações seguintes só precisam subir o `.bin` novo em `server/public/firmware/` (ver seção de OTA no guia técnico).

## Integrações plugáveis (env)

| Recurso | Env | Opções |
|---|---|---|
| Placa (fallback) | `PLACA_PROVIDER` | `none` · `apibrasil` · `placaapi` — hoje o reconhecimento principal é por IA (Anthropic) |
| Pagamento | `ASAAS_BASE_URL` | sandbox · produção |
| Push notifications | `VAPID_*` | chaves VAPID (Web Push) |

## Pendências conhecidas

Ver seção 11 do `GUIA_TECNICO_COMPLETO.md` para a lista completa e atualizada.
