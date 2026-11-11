-- CreateTable
CREATE TABLE "RostoRemovido" (
    "userId" TEXT NOT NULL,
    "codigoCliente" INTEGER NOT NULL,
    "removidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RostoRemovido_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "LojaAlerta" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "codigo" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "detalhe" TEXT NOT NULL DEFAULT '',
    "codigoCliente" INTEGER,
    "ocorridoEm" TIMESTAMP(3) NOT NULL,
    "recebidoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lidoEm" TIMESTAMP(3),

    CONSTRAINT "LojaAlerta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LojaAlertaImagem" (
    "id" TEXT NOT NULL,
    "alertaId" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL,
    "jpeg" BYTEA NOT NULL,

    CONSTRAINT "LojaAlertaImagem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LojaAberturaRemota" (
    "id" TEXT NOT NULL,
    "lojaId" TEXT NOT NULL,
    "pedidaPorId" TEXT NOT NULL,
    "motivo" TEXT NOT NULL DEFAULT '',
    "pedidaEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feitaEm" TIMESTAMP(3),

    CONSTRAINT "LojaAberturaRemota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RostoRemovido_removidoEm_idx" ON "RostoRemovido"("removidoEm");

-- CreateIndex
CREATE UNIQUE INDEX "LojaAlerta_codigo_key" ON "LojaAlerta"("codigo");

-- CreateIndex
CREATE INDEX "LojaAlerta_lojaId_ocorridoEm_idx" ON "LojaAlerta"("lojaId", "ocorridoEm");

-- CreateIndex
CREATE INDEX "LojaAlerta_lojaId_lidoEm_idx" ON "LojaAlerta"("lojaId", "lidoEm");

-- CreateIndex
CREATE INDEX "LojaAlertaImagem_alertaId_ordem_idx" ON "LojaAlertaImagem"("alertaId", "ordem");

-- CreateIndex
CREATE INDEX "LojaAberturaRemota_lojaId_pedidaEm_idx" ON "LojaAberturaRemota"("lojaId", "pedidaEm");

-- CreateIndex
CREATE INDEX "FotoRosto_criadaEm_idx" ON "FotoRosto"("criadaEm");

-- AddForeignKey
ALTER TABLE "LojaAlerta" ADD CONSTRAINT "LojaAlerta_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LojaAlertaImagem" ADD CONSTRAINT "LojaAlertaImagem_alertaId_fkey" FOREIGN KEY ("alertaId") REFERENCES "LojaAlerta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LojaAberturaRemota" ADD CONSTRAINT "LojaAberturaRemota_lojaId_fkey" FOREIGN KEY ("lojaId") REFERENCES "Loja"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LojaAberturaRemota" ADD CONSTRAINT "LojaAberturaRemota_pedidaPorId_fkey" FOREIGN KEY ("pedidaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
