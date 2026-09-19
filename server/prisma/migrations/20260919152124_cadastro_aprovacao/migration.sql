-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cadastroPendente" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "cadastroTipoSolicitado" "TipoParticipacao";
