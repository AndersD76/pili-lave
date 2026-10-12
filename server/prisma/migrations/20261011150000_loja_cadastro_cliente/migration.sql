-- AlterTable
ALTER TABLE "User" ADD COLUMN     "codigoCliente" SERIAL NOT NULL,
ADD COLUMN     "nascimento" DATE,
ADD COLUMN     "termosVersao" TEXT,
ADD COLUMN     "termosAceitosEm" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FotoRosto" (
    "userId" TEXT NOT NULL,
    "jpeg" BYTEA NOT NULL,
    "bytes" INTEGER NOT NULL,
    "consentimentoEm" TIMESTAMP(3) NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FotoRosto_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_codigoCliente_key" ON "User"("codigoCliente");

-- AddForeignKey
ALTER TABLE "FotoRosto" ADD CONSTRAINT "FotoRosto_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
