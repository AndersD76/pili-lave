-- CreateTable
CREATE TABLE "OperacaoCartao" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "totalCents" INTEGER NOT NULL,
    "situacao" TEXT NOT NULL DEFAULT 'AGUARDANDO',
    "referencia" TEXT,
    "motivo" TEXT,
    "criadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concluidaEm" DATETIME
);
