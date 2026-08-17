-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLIENT', 'LAVADOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "TopupStatus" AS ENUM ('PENDING', 'PAID', 'CANCELED');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PAID', 'REDEEMED', 'CANCELED');

-- CreateEnum
CREATE TYPE "WalletTxKind" AS ENUM ('TOPUP', 'WASH', 'REFUND', 'ADJUST');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('HELD', 'ACTIVE', 'ENTERED', 'COMPLETED', 'EXPIRED', 'CANCELED', 'FAILED');

-- CreateEnum
CREATE TYPE "MachineStatus" AS ENUM ('FREE', 'WASHING', 'FAULT', 'OFFLINE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ArrivalStatus" AS ENUM ('WAITING_DRIVER', 'NO_MATCH', 'REQUESTED', 'STARTED', 'EXPIRED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "cpf" TEXT,
    "role" "Role" NOT NULL DEFAULT 'CLIENT',
    "asaasCustomerId" TEXT,
    "walletCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Otp" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "brand" TEXT,
    "model" TEXT,
    "color" TEXT,
    "year" TEXT,
    "defaultProgramId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Program" (
    "id" INTEGER NOT NULL,
    "nome" TEXT NOT NULL,
    "precoCents" INTEGER NOT NULL,
    "duracaoMin" INTEGER NOT NULL DEFAULT 30,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Topup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "method" TEXT NOT NULL,
    "status" "TopupStatus" NOT NULL DEFAULT 'PENDING',
    "asaasPaymentId" TEXT,
    "pixPayload" TEXT,
    "invoiceUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Topup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "programId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PAID',
    "voucherCode" TEXT NOT NULL,
    "voucherExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "redeemedAt" TIMESTAMP(3),
    "redeemedById" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTx" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "kind" "WalletTxKind" NOT NULL,
    "refId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTx_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Arrival" (
    "id" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "vehicleId" TEXT,
    "userId" TEXT,
    "status" "ArrivalStatus" NOT NULL DEFAULT 'WAITING_DRIVER',
    "orderId" TEXT,
    "reservationId" TEXT,
    "stationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),

    CONSTRAINT "Arrival_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WashStation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "state" TEXT NOT NULL DEFAULT 'RS',
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WashStation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "stationId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Máquina 1',
    "deviceKey" TEXT NOT NULL,
    "status" "MachineStatus" NOT NULL DEFAULT 'FREE',
    "lastHeartbeat" TIMESTAMP(3),
    "remainingSec" INTEGER NOT NULL DEFAULT 0,
    "lightState" TEXT NOT NULL DEFAULT 'OFF',
    "lightUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "stationId" TEXT,
    "machineId" TEXT,
    "programId" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'HELD',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "activeAt" TIMESTAMP(3),
    "enteredAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "Otp_phone_createdAt_idx" ON "Otp"("phone", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_userId_plate_key" ON "Vehicle"("userId", "plate");

-- CreateIndex
CREATE UNIQUE INDEX "Topup_asaasPaymentId_key" ON "Topup"("asaasPaymentId");

-- CreateIndex
CREATE UNIQUE INDEX "Order_voucherCode_key" ON "Order"("voucherCode");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTx_userId_createdAt_idx" ON "WalletTx"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Arrival_orderId_key" ON "Arrival"("orderId");

-- CreateIndex
CREATE INDEX "Arrival_status_createdAt_idx" ON "Arrival"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Arrival_userId_createdAt_idx" ON "Arrival"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_deviceKey_key" ON "Machine"("deviceKey");

-- CreateIndex
CREATE INDEX "Machine_stationId_idx" ON "Machine"("stationId");

-- CreateIndex
CREATE UNIQUE INDEX "Reservation_orderId_key" ON "Reservation"("orderId");

-- CreateIndex
CREATE INDEX "Reservation_userId_status_idx" ON "Reservation"("userId", "status");

-- CreateIndex
CREATE INDEX "Reservation_vehicleId_status_idx" ON "Reservation"("vehicleId", "status");

-- CreateIndex
CREATE INDEX "Reservation_status_expiresAt_idx" ON "Reservation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Reservation_machineId_status_idx" ON "Reservation"("machineId", "status");

-- CreateIndex
CREATE INDEX "Event_type_createdAt_idx" ON "Event"("type", "createdAt");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_defaultProgramId_fkey" FOREIGN KEY ("defaultProgramId") REFERENCES "Program"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Topup" ADD CONSTRAINT "Topup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_redeemedById_fkey" FOREIGN KEY ("redeemedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTx" ADD CONSTRAINT "WalletTx_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arrival" ADD CONSTRAINT "Arrival_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arrival" ADD CONSTRAINT "Arrival_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arrival" ADD CONSTRAINT "Arrival_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arrival" ADD CONSTRAINT "Arrival_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arrival" ADD CONSTRAINT "Arrival_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "WashStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "WashStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_stationId_fkey" FOREIGN KEY ("stationId") REFERENCES "WashStation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_machineId_fkey" FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reservation" ADD CONSTRAINT "Reservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
