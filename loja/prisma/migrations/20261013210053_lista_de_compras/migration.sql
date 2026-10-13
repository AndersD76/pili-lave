-- CreateTable
CREATE TABLE "ItemCompra" (
    "produtoId" TEXT NOT NULL PRIMARY KEY,
    "quantidade" INTEGER NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ItemCompra_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
