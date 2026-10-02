-- Pagamentos de comissão/aluguel/lavador feitos pela API do Asaas.
-- Serve de lista branca para a validação de saque: o Asaas pergunta antes
-- de liberar cada saque e só aprovamos o que tem registro aqui.
CREATE TYPE "StatusRepasse" AS ENUM ('PENDENTE', 'APROVADO', 'CONCLUIDO', 'FALHOU');

CREATE TABLE "Repasse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "valorCents" INTEGER NOT NULL,
    "pixChave" TEXT NOT NULL,
    "descricao" TEXT NOT NULL,
    "asaasTransferId" TEXT,
    "status" "StatusRepasse" NOT NULL DEFAULT 'PENDENTE',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidoEm" TIMESTAMP(3),

    CONSTRAINT "Repasse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Repasse_asaasTransferId_key" ON "Repasse"("asaasTransferId");
CREATE INDEX "Repasse_userId_criadoEm_idx" ON "Repasse"("userId", "criadoEm");

ALTER TABLE "Repasse" ADD CONSTRAINT "Repasse_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
