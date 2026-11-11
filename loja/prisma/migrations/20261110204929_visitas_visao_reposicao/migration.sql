-- CreateTable
CREATE TABLE "ClienteLocal" (
    "nuvemUserId" TEXT NOT NULL PRIMARY KEY,
    "codigoCliente" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "bloqueado" BOOLEAN NOT NULL DEFAULT false,
    "temRosto" BOOLEAN NOT NULL DEFAULT false,
    "atualizadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Visita" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nuvemUserId" TEXT,
    "codigoCliente" TEXT,
    "nome" TEXT NOT NULL,
    "criancas" INTEGER NOT NULL DEFAULT 0,
    "entrouEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "saiuEm" DATETIME,
    "origem" TEXT NOT NULL,
    "vendaId" INTEGER,
    "saiuSemPagar" BOOLEAN NOT NULL DEFAULT false
);

-- CreateTable
CREATE TABLE "EventoVisao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tipo" TEXT NOT NULL,
    "zona" TEXT,
    "delta" INTEGER NOT NULL DEFAULT 0,
    "visitasNaZona" TEXT NOT NULL DEFAULT '[]',
    "ambiguo" BOOLEAN NOT NULL DEFAULT false,
    "visitaId" TEXT,
    "reposicaoId" TEXT,
    "imagens" TEXT NOT NULL DEFAULT '[]',
    "detalhe" TEXT,
    "ocorridoEm" DATETIME NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "divergenciaId" TEXT,
    CONSTRAINT "EventoVisao_divergenciaId_fkey" FOREIGN KEY ("divergenciaId") REFERENCES "Divergencia" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Divergencia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inicio" DATETIME NOT NULL,
    "fim" DATETIME NOT NULL,
    "saiuPrateleira" INTEGER NOT NULL,
    "pago" INTEGER NOT NULL,
    "visitas" TEXT NOT NULL DEFAULT '[]',
    "situacao" TEXT NOT NULL DEFAULT 'ABERTA',
    "decisao" TEXT,
    "revisadaPor" TEXT,
    "revisadaEm" DATETIME,
    "criadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Reposicao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "usuarioNome" TEXT NOT NULL,
    "inicio" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fim" DATETIME
);

-- CreateTable
CREATE TABLE "AlertaNuvem" (
    "codigo" TEXT NOT NULL PRIMARY KEY,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "detalhe" TEXT NOT NULL,
    "imagens" TEXT NOT NULL DEFAULT '[]',
    "ocorridoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadoEm" DATETIME
);

-- CreateTable
CREATE TABLE "AberturaRemota" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pedidaPor" TEXT NOT NULL,
    "abertaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ok" BOOLEAN NOT NULL DEFAULT true
);

-- CreateIndex
CREATE UNIQUE INDEX "ClienteLocal_codigoCliente_key" ON "ClienteLocal"("codigoCliente");

-- CreateIndex
CREATE INDEX "Visita_saiuEm_idx" ON "Visita"("saiuEm");

-- CreateIndex
CREATE INDEX "Visita_entrouEm_idx" ON "Visita"("entrouEm");

-- CreateIndex
CREATE INDEX "EventoVisao_ocorridoEm_idx" ON "EventoVisao"("ocorridoEm");

-- CreateIndex
CREATE INDEX "EventoVisao_tipo_ocorridoEm_idx" ON "EventoVisao"("tipo", "ocorridoEm");

-- CreateIndex
CREATE INDEX "Divergencia_situacao_criadaEm_idx" ON "Divergencia"("situacao", "criadaEm");

-- CreateIndex
CREATE INDEX "Reposicao_fim_idx" ON "Reposicao"("fim");

-- CreateIndex
CREATE INDEX "AlertaNuvem_enviadoEm_idx" ON "AlertaNuvem"("enviadoEm");
