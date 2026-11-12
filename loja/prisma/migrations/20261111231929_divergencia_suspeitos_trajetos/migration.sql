-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Divergencia" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "inicio" DATETIME NOT NULL,
    "fim" DATETIME NOT NULL,
    "saiuPrateleira" INTEGER NOT NULL,
    "pago" INTEGER NOT NULL,
    "visitas" TEXT NOT NULL DEFAULT '[]',
    "suspeitos" TEXT NOT NULL DEFAULT '[]',
    "trajetos" TEXT NOT NULL DEFAULT '[]',
    "situacao" TEXT NOT NULL DEFAULT 'ABERTA',
    "decisao" TEXT,
    "revisadaPor" TEXT,
    "revisadaEm" DATETIME,
    "criadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_Divergencia" ("criadaEm", "decisao", "fim", "id", "inicio", "pago", "revisadaEm", "revisadaPor", "saiuPrateleira", "situacao", "visitas") SELECT "criadaEm", "decisao", "fim", "id", "inicio", "pago", "revisadaEm", "revisadaPor", "saiuPrateleira", "situacao", "visitas" FROM "Divergencia";
DROP TABLE "Divergencia";
ALTER TABLE "new_Divergencia" RENAME TO "Divergencia";
CREATE INDEX "Divergencia_situacao_criadaEm_idx" ON "Divergencia"("situacao", "criadaEm");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
