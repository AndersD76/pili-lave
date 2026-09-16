-- Presença do carro reportada pelo display no heartbeat (X14/X15).
ALTER TABLE "Machine" ADD COLUMN "sensorX14" BOOLEAN;
ALTER TABLE "Machine" ADD COLUMN "sensorX15" BOOLEAN;
