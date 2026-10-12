# PILI CLEAN — instruções para o Claude

Leia isto primeiro, depois (antes de mexer em código) leia **[README.md](README.md)**
e **[GUIA_TECNICO_COMPLETO.md](GUIA_TECNICO_COMPLETO.md)** — esse último é a
referência técnica completa (arquitetura, firmware, backend, banco de dados,
pendências conhecidas). Os guias de uso ficam em `docs/treinamento/`
(`GUIA_ADMIN.md`, `GUIA_LAVADOR.md`, `GUIA_CLIENTE.md`).

## O que é este projeto

Lava-rápido automático sem operador: cliente reserva/paga pelo app, câmera
reconhece a placa, a máquina (display ESP32-S3 + Waveshares RS-485 + inversor)
executa o ciclo de lavagem sozinha. Também tem aspirador de pó opcional por
máquina. Stack: Next.js 16 (backend + painel admin + PWA) + Prisma/Postgres
(Neon) + Expo/React Native (mobile, ainda não publicado em loja — a PWA é o
uso real hoje) + firmware Arduino/ESP32.

## Produto novo: loja de conveniência self-service

Vai rodar **junto, no mesmo app**, como produto paralelo ao lava-rápido — não
é um repositório separado. Antes de desenhar schema/rotas novas, dê uma olhada
em como o domínio existente já resolve problemas parecidos (carteira/crédito,
reserva com expiração, preço por unidade, painel admin multi-tenant) — o guia
técnico tem tudo isso documentado; prefira reaproveitar os padrões já
validados (ex.: `WalletTx` como ledger, `lib/precos.ts` pra preço por unidade)
em vez de reinventar um paralelo.

## Regras de segurança/produção (não pular)

- **Nunca** rodar migration, apagar dados ou mexer no banco de **produção**
  sem autorização explícita do usuário **a cada vez** — mesmo que já tenha
  sido autorizado antes. `server/.env` aponta pro Postgres **local**
  (`pililave_dev`); `server/.env.production` tem as credenciais reais (nunca
  é carregado por `next dev`, só manualmente quando for aplicar migration em
  produção — e depois disso, restaurar o `.env` local).
- Toda migration precisa ser aplicada **manualmente** nos dois bancos — o
  deploy do Railway não roda migration sozinho.
- Commits/push só vão pro remoto `AndersD76/pili-lave` (`origin`).
- Gravar firmware em hardware físico (display/câmera) é uma ação que afeta
  produção de verdade — sempre confirmar antes de fazer upload, mesmo que o
  código já tenha sido aprovado.
- A câmera tem OTA pelo Wi-Fi (ver guia técnico, seção 5.1) — não precisa de
  cabo pra atualizações futuras dela. O display **não tem** Wi-Fi, continua
  exigindo cabo USB.

## Memória entre sessões

Existe um sistema de memória persistente (arquivos em
`~/.claude/projects/.../memory/`, indexados por `MEMORY.md`) com decisões e
pendências registradas ao longo do projeto — confira antes de assumir que
algo é novo ou que uma pendência já foi resolvida.

## Estilo de trabalho observado neste projeto

- Mudanças de schema/produção costumam ser feitas com cautela extra — o
  usuário prefere confirmar passo a passo (compilar → confirmar → gravar)
  a automatizar tudo de uma vez.
- Convenção de commit: mensagens objetivas em português, terminando com
  `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.
- Depois de qualquer mudança de schema, atualizar o `GUIA_TECNICO_COMPLETO.md`
  (e os guias de treinamento relevantes) faz parte do trabalho, não é
  opcional — esses documentos são a fonte de verdade pra quem não lê código.
