-- Sugestão de chegada por leitura de placa de baixa confiança (bate com a
-- fila de reservas HELD; motorista confirma no app antes de liberar).
ALTER TYPE "ArrivalStatus" ADD VALUE 'SUGGESTED';
ALTER TABLE "Arrival" ADD COLUMN "matchScore" DOUBLE PRECISION;
