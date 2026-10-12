-- AlterTable
ALTER TABLE "Loja" ADD COLUMN     "deviceKey" TEXT,
ADD COLUMN     "stationId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Loja_deviceKey_key" ON "Loja"("deviceKey");

-- CreateIndex
CREATE INDEX "Loja_stationId_idx" ON "Loja"("stationId");

-- AddForeignKey
ALTER TABLE "Loja" ADD CONSTRAINT "Loja_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "WashStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
