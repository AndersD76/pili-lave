-- Momento em que o sensor passou a acusar carro (filtra piscada do X15).
ALTER TABLE "Machine" ADD COLUMN "sensorDesde" TIMESTAMP(3);
