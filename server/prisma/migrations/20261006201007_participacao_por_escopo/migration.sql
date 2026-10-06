-- CreateEnum
CREATE TYPE "ParticipacaoEscopo" AS ENUM ('LAVAGEM', 'ASPIRADOR');

-- DropIndex
DROP INDEX "MachineParticipante_machineId_tipo_key";

-- AlterTable
ALTER TABLE "MachineParticipante" ADD COLUMN     "escopo" "ParticipacaoEscopo" NOT NULL DEFAULT 'LAVAGEM';

-- CreateIndex
CREATE UNIQUE INDEX "MachineParticipante_machineId_tipo_escopo_key" ON "MachineParticipante"("machineId", "tipo", "escopo");

