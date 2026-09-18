-- Lavador responsável por cada máquina (vê só a dele: status, lavagens,
-- faturamento; recebe aviso se ela der erro).
ALTER TABLE "Machine" ADD COLUMN "operadorId" TEXT;
CREATE INDEX "Machine_operadorId_idx" ON "Machine"("operadorId");
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_operadorId_fkey"
    FOREIGN KEY ("operadorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
