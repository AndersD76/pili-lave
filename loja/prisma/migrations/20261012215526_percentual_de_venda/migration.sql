-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Produto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ean" TEXT,
    "nome" TEXT NOT NULL,
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "custoCents" INTEGER NOT NULL DEFAULT 0,
    "precoCents" INTEGER,
    "margemPct" REAL,
    "precoManual" BOOLEAN NOT NULL DEFAULT false,
    "estoqueAtual" INTEGER NOT NULL DEFAULT 0,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 5,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL
);
INSERT INTO "new_Produto" ("ativo", "atualizadoEm", "criadoEm", "custoCents", "ean", "estoqueAtual", "estoqueMinimo", "id", "nome", "precoCents", "unidade") SELECT "ativo", "atualizadoEm", "criadoEm", "custoCents", "ean", "estoqueAtual", "estoqueMinimo", "id", "nome", "precoCents", "unidade" FROM "Produto";
DROP TABLE "Produto";
ALTER TABLE "new_Produto" RENAME TO "Produto";
CREATE UNIQUE INDEX "Produto_ean_key" ON "Produto"("ean");
CREATE INDEX "Produto_nome_idx" ON "Produto"("nome");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
