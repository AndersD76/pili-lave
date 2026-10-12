-- CreateTable
CREATE TABLE "Venda" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "codigo" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "forma" TEXT NOT NULL,
    "criadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sincronizadaEm" DATETIME
);

-- CreateTable
CREATE TABLE "VendaItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendaId" INTEGER NOT NULL,
    "produtoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "ean" TEXT,
    "quantidade" INTEGER NOT NULL,
    "precoUnitCents" INTEGER NOT NULL,
    CONSTRAINT "VendaItem_vendaId_fkey" FOREIGN KEY ("vendaId") REFERENCES "Venda" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "VendaItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Venda_codigo_key" ON "Venda"("codigo");

-- CreateIndex
CREATE INDEX "Venda_criadaEm_idx" ON "Venda"("criadaEm");

-- CreateIndex
CREATE INDEX "VendaItem_vendaId_idx" ON "VendaItem"("vendaId");
