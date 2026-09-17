-- Multi-máquina por unidade: cada Machine ganha um "numero" (posição dentro
-- da WashStation) para o técnico se referir a ela ("Erechim, João Carlon, 1").
ALTER TABLE "Machine" ADD COLUMN "numero" INTEGER NOT NULL DEFAULT 1;

-- Backfill: máquinas já existentes na mesma unidade recebem números
-- sequenciais (1, 2, 3…) por ordem de criação, para não colidir no índice
-- único abaixo.
WITH numerada AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "stationId" ORDER BY "createdAt") AS rn
  FROM "Machine"
)
UPDATE "Machine" m SET "numero" = n.rn
FROM numerada n
WHERE m."id" = n."id";

CREATE UNIQUE INDEX "Machine_stationId_numero_key" ON "Machine"("stationId", "numero");
