-- CreateTable
CREATE TABLE "Capture" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bytes" INTEGER NOT NULL,
    "jpeg" BYTEA NOT NULL,
    "plate" TEXT,
    "score" DOUBLE PRECISION,
    "status" TEXT,
    "light" TEXT,
    "note" TEXT,
    "clientName" TEXT,

    CONSTRAINT "Capture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Capture_at_idx" ON "Capture"("at");
