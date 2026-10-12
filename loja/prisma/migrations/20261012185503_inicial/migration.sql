-- CreateTable
CREATE TABLE "Config" (
    "chave" TEXT NOT NULL PRIMARY KEY,
    "valor" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Produto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ean" TEXT,
    "nome" TEXT NOT NULL,
    "unidade" TEXT NOT NULL DEFAULT 'UN',
    "custoCents" INTEGER NOT NULL DEFAULT 0,
    "precoCents" INTEGER,
    "estoqueAtual" INTEGER NOT NULL DEFAULT 0,
    "estoqueMinimo" INTEGER NOT NULL DEFAULT 5,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "atualizadoEm" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Movimento" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "produtoId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "saldoApos" INTEGER NOT NULL,
    "nota" TEXT,
    "refId" TEXT,
    "criadoEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sincronizadoEm" DATETIME,
    CONSTRAINT "Movimento_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Fornecedor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cnpj" TEXT NOT NULL,
    "nome" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "Entrada" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "origem" TEXT NOT NULL,
    "numeroNf" TEXT,
    "chaveNfe" TEXT,
    "dataEmissao" DATETIME,
    "fornecedorId" TEXT,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "criadaEm" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Entrada_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntradaItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entradaId" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,
    "codigoFornecedor" TEXT,
    "descricao" TEXT NOT NULL,
    "quantidade" INTEGER NOT NULL,
    "custoUnitCents" INTEGER NOT NULL,
    CONSTRAINT "EntradaItem_entradaId_fkey" FOREIGN KEY ("entradaId") REFERENCES "Entrada" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "EntradaItem_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CodigoFornecedor" (
    "fornecedorId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "produtoId" TEXT NOT NULL,

    PRIMARY KEY ("fornecedorId", "codigo"),
    CONSTRAINT "CodigoFornecedor_fornecedorId_fkey" FOREIGN KEY ("fornecedorId") REFERENCES "Fornecedor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CodigoFornecedor_produtoId_fkey" FOREIGN KEY ("produtoId") REFERENCES "Produto" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Produto_ean_key" ON "Produto"("ean");

-- CreateIndex
CREATE INDEX "Produto_nome_idx" ON "Produto"("nome");

-- CreateIndex
CREATE INDEX "Movimento_produtoId_criadoEm_idx" ON "Movimento"("produtoId", "criadoEm");

-- CreateIndex
CREATE INDEX "Movimento_tipo_criadoEm_idx" ON "Movimento"("tipo", "criadoEm");

-- CreateIndex
CREATE UNIQUE INDEX "Fornecedor_cnpj_key" ON "Fornecedor"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "Entrada_chaveNfe_key" ON "Entrada"("chaveNfe");

-- CreateIndex
CREATE INDEX "Entrada_criadaEm_idx" ON "Entrada"("criadaEm");

-- CreateIndex
CREATE INDEX "EntradaItem_entradaId_idx" ON "EntradaItem"("entradaId");
