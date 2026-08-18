-- Contadores de lavagem por modelo + controle de licença Pili Tecnologia
ALTER TABLE "Machine" ADD COLUMN "totalWashesM1" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Machine" ADD COLUMN "totalWashesM2" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Machine" ADD COLUMN "totalWashesM3" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Machine" ADD COLUMN "totalWashesM4" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Machine" ADD COLUMN "totalWashesAll" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Machine" ADD COLUMN "lastPaymentDate" TIMESTAMP(3);
ALTER TABLE "Machine" ADD COLUMN "lastHeartbeatSuccess" TIMESTAMP(3);
