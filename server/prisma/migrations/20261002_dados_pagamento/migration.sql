-- Dados para RECEBER comissão/aluguel: chave PIX do participante.
-- O Asaas exige a chave e o TIPO dela (pixAddressKeyType) na transferência.
CREATE TYPE "PixTipo" AS ENUM ('CPF', 'CNPJ', 'EMAIL', 'PHONE', 'EVP');
ALTER TABLE "User" ADD COLUMN "pixChave" TEXT;
ALTER TABLE "User" ADD COLUMN "pixTipo" "PixTipo";
