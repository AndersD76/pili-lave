-- CreateEnum
CREATE TYPE "StatusSolicitacao" AS ENUM ('PENDENTE', 'APROVADA', 'REJEITADA');

-- CreateTable
CREATE TABLE "SolicitacaoParceiro" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" "TipoParticipacao" NOT NULL,
    "status" "StatusSolicitacao" NOT NULL DEFAULT 'PENDENTE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decididoEm" TIMESTAMP(3),

    CONSTRAINT "SolicitacaoParceiro_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SolicitacaoParceiro_status_idx" ON "SolicitacaoParceiro"("status");

-- CreateIndex
CREATE UNIQUE INDEX "SolicitacaoParceiro_userId_tipo_key" ON "SolicitacaoParceiro"("userId", "tipo");

-- AddForeignKey
ALTER TABLE "SolicitacaoParceiro" ADD CONSTRAINT "SolicitacaoParceiro_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Migra cadastros pendentes do modelo antigo (1 pedido por usuário) pro novo
-- (N pedidos por usuário) antes de derrubar as colunas velhas.
INSERT INTO "SolicitacaoParceiro" ("id", "userId", "tipo", "status", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text), "id", "cadastroTipoSolicitado", 'PENDENTE', now()
FROM "User"
WHERE "cadastroPendente" = true AND "cadastroTipoSolicitado" IS NOT NULL;

-- DropColumn
ALTER TABLE "User" DROP COLUMN "cadastroPendente";
ALTER TABLE "User" DROP COLUMN "cadastroTipoSolicitado";
