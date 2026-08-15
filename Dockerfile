# PILI LAVE — build do servidor (server/) direto por Dockerfile.
# Motivo: o Railpack monta TODAS as variáveis do serviço como "secrets" de
# build; uma variável com nome inválido derruba o build inteiro. O Docker
# build não depende disso.
FROM node:24-slim

# OpenSSL é exigido pelo Prisma
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# deps primeiro (cache) — o postinstall roda o prisma generate, então o schema vem junto
COPY server/package.json server/package-lock.json ./
COPY server/prisma ./prisma
RUN npm ci

# código e build
COPY server .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 8080
# Railway injeta a variável PORT e o `next start` a lê sozinho — sem shell, sem -p
CMD ["npm", "start"]
