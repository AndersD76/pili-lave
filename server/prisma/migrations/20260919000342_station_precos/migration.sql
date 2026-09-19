-- CreateTable
CREATE TABLE "StationPrograma" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "programId" INTEGER NOT NULL,
    "precoCents" INTEGER NOT NULL,

    CONSTRAINT "StationPrograma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StationPrograma_stationId_programId_key" ON "StationPrograma"("stationId", "programId");

-- AddForeignKey
ALTER TABLE "StationPrograma" ADD CONSTRAINT "StationPrograma_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "WashStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StationPrograma" ADD CONSTRAINT "StationPrograma_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
