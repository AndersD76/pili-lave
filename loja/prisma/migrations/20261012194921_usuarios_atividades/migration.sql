-- AlterTable
ALTER TABLE "Entrada" ADD COLUMN "usuarioId" TEXT;

-- AlterTable
ALTER TABLE "Movimento" ADD COLUMN "usuarioId" TEXT;

-- CreateTable
CREATE TABLE "Usuario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "nome" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "senhaHash" TEXT NOT NULL,
    "papel" TEXT NOT NULL,
    "permissoes" TEXT NOT NULL DEFAULT '[]',
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "nuvemUserId" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Atividade" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "usuarioId" TEXT NOT NULL,
    "usuarioNome" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "detalhe" TEXT NOT NULL,
    "produtoId" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Atividade_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "Usuario" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_login_key" ON "Usuario"("login");

-- CreateIndex
CREATE UNIQUE INDEX "Usuario_nuvemUserId_key" ON "Usuario"("nuvemUserId");

-- CreateIndex
CREATE INDEX "Atividade_criadoEm_idx" ON "Atividade"("criadoEm");

-- CreateIndex
CREATE INDEX "Atividade_usuarioId_criadoEm_idx" ON "Atividade"("usuarioId", "criadoEm");
