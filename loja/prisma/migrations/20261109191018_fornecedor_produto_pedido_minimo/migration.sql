-- AlterTable
ALTER TABLE "Fornecedor" ADD COLUMN "pedidoMinimoCents" INTEGER;

-- CreateTable
CREATE TABLE "ProdutoFornecedor" (
    "produtoId" TEXT NOT NULL,
    "fornecedorId" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("produtoId", "fornecedorId"),
    CONSTRAINT "ProdutoFornecedor_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProdutoFornecedor_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ItemCompra" (
    "produtoId" TEXT NOT NULL PRIMARY KEY,
    "quantidade" INTEGER NOT NULL,
    "fornecedorId" TEXT,
    "usuarioId" TEXT NOT NULL,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ItemCompra_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ItemCompra_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ItemCompra" ("criadoEm", "produtoId", "quantidade", "usuarioId") SELECT "criadoEm", "produtoId", "quantidade", "usuarioId" FROM "ItemCompra";
DROP TABLE "ItemCompra";
ALTER TABLE "new_ItemCompra" RENAME TO "ItemCompra";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
