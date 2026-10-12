-- AlterEnum
ALTER TYPE "TipoParticipacao" ADD VALUE 'DONO_LOJA';

-- CreateTable
CREATE TABLE "Loja" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'RS',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "capacidade" INTEGER NOT NULL DEFAULT 3,
    "donoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Loja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LojaBloqueio" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removidoEm" TIMESTAMP(3),

    CONSTRAINT "LojaBloqueio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LojaMensagem" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "texto" TEXT NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resposta" TEXT,
    "respondidaEm" TIMESTAMP(3),

    CONSTRAINT "LojaMensagem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Loja_donoId_idx" ON "Loja"("donoId");

-- CreateIndex
CREATE INDEX "LojaBloqueio_lojaId_userId_idx" ON "LojaBloqueio"("lojaId", "userId");

-- CreateIndex
CREATE INDEX "LojaMensagem_lojaId_criadaEm_idx" ON "LojaMensagem"("lojaId", "criadaEm");

-- CreateIndex
CREATE INDEX "LojaMensagem_userId_idx" ON "LojaMensagem"("userId");

-- AddForeignKey
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_donoId_fkey" FOREIGN KEY ("donoId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LojaBloqueio" ADD CONSTRAINT "LojaBloqueio_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LojaBloqueio" ADD CONSTRAINT "LojaBloqueio_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LojaMensagem" ADD CONSTRAINT "LojaMensagem_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LojaMensagem" ADD CONSTRAINT "LojaMensagem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
