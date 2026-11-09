-- CreateTable
CREATE TABLE "VendaLoja" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "forma" TEXT NOT NULL,
    "criadaEm" TIMESTAMP(3) NOT NULL,
    "recebidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendaLoja_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendaLojaItem" (
    "id" TEXT NOT NULL,
    "vendaLojaId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ean" TEXT,
    "quantidade" INTEGER NOT NULL,
    "precoUnitCents" INTEGER NOT NULL,

    CONSTRAINT "VendaLojaItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendaLoja_codigo_key" ON "VendaLoja"("codigo");

-- CreateIndex
CREATE INDEX "VendaLoja_lojaId_criadaEm_idx" ON "VendaLoja"("lojaId", "criadaEm");

-- CreateIndex
CREATE INDEX "VendaLojaItem_vendaLojaId_idx" ON "VendaLojaItem"("vendaLojaId");

-- AddForeignKey
ALTER TABLE "VendaLoja" ADD CONSTRAINT "VendaLoja_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendaLojaItem" ADD CONSTRAINT "VendaLojaItem_vendaLojaId_fkey" FOREIGN KEY ("vendaLojaId") REFERENCES "VendaLoja"("id") ON DELETE CASCADE ON UPDATE CASCADE;
