-- CreateTable
CREATE TABLE "NotaPendente" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "xml" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "criadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
