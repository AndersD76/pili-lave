-- CreateTable
CREATE TABLE "LavagemPresencial" (
    "id" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "programId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LavagemPresencial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LavagemPresencial_machineId_completedAt_idx" ON "LavagemPresencial"("machineId", "completedAt");

-- AddForeignKey
ALTER TABLE "LavagemPresencial" ADD CONSTRAINT "LavagemPresencial_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LavagemPresencial" ADD CONSTRAINT "LavagemPresencial_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
