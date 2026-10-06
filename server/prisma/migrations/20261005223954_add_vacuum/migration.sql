-- CreateEnum
CREATE TYPE "VacuumStatus" AS ENUM ('PAID', 'ACTIVE', 'COMPLETED');

-- AlterEnum
ALTER TYPE "WalletTxKind" ADD VALUE 'VACUUM';

-- AlterTable
ALTER TABLE "Machine" ADD COLUMN     "vacuumDurationMin" INTEGER,
ADD COLUMN     "vacuumEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vacuumPriceCents" INTEGER;

-- CreateTable
CREATE TABLE "VacuumUse" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "status" "VacuumStatus" NOT NULL DEFAULT 'PAID',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VacuumUse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VacuumUse_userId_status_idx" ON "VacuumUse"("userId", "status");

-- CreateIndex
CREATE INDEX "VacuumUse_machineId_status_idx" ON "VacuumUse"("machineId", "status");

-- AddForeignKey
ALTER TABLE "VacuumUse" ADD CONSTRAINT "VacuumUse_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VacuumUse" ADD CONSTRAINT "VacuumUse_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
