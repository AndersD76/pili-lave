-- CreateEnum
CREATE TYPE "TipoParticipacao" AS ENUM ('LAVADOR', 'COMISSAO1', 'COMISSAO2', 'ALUGUEL');

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PARCEIRO';

-- CreateTable
CREATE TABLE "MachineParticipante" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tipo" "TipoParticipacao" NOT NULL,
    "percentual" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "MachineParticipante_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MachineParticipante_userId_idx" ON "MachineParticipante"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MachineParticipante_machineId_tipo_key" ON "MachineParticipante"("machineId", "tipo");

-- AddForeignKey
ALTER TABLE "MachineParticipante" ADD CONSTRAINT "MachineParticipante_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MachineParticipante" ADD CONSTRAINT "MachineParticipante_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
