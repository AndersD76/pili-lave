// Publica um firmware do DISPLAY ou da W1 para a atualizacao remota (a camera baixa e entrega por ESP-NOW).
// Uso:  node server/scripts/publicar-firmware.mjs <w1|display> <arquivo.bin> <versao>
//   <arquivo.bin>  o .ino.bin gerado pelo arduino-cli (SO o app, nao o .merged.bin)
//   <versao>       inteiro MAIOR que o OTA_FW_VERSAO do firmware que esta rodando; tem que ser o MESMO numero do #define OTA_FW_VERSAO
//                  compilado dentro desse .bin (a placa recusa se a versao oferecida nao for maior que a dela)
// Escreve server/public/firmware/<alvo>.bin e <alvo>-version.json ({"version","size","md5"}). Depois e so commitar e fazer push na main
// (o Railway publica). A camera olha a cada 15 min e so entrega com a maquina fora de lavagem.
import { readFileSync, writeFileSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const [alvo, arquivo, versaoTxt] = process.argv.slice(2);
const versao = Number(versaoTxt);
if (!["w1", "display"].includes(alvo) || !arquivo || !Number.isInteger(versao) || versao < 1) {
  console.error("uso: node server/scripts/publicar-firmware.mjs <w1|display> <arquivo.bin> <versao>");
  process.exit(1);
}
if (!existsSync(arquivo)) { console.error("arquivo nao encontrado:", arquivo); process.exit(1); }
if (/merged|bootloader|partitions/i.test(path.basename(arquivo))) {
  console.error("use o .ino.bin (so o app), nao o merged/bootloader/partitions:", arquivo);
  process.exit(1);
}
const dados = readFileSync(arquivo);
if (dados[0] !== 0xe9) { console.error("nao parece uma imagem de app do ESP32 (1o byte deveria ser 0xE9)"); process.exit(1); }
if (dados.length < 100000 || dados.length > 3 * 1024 * 1024) { console.error("tamanho fora do esperado:", dados.length); process.exit(1); }
const md5 = createHash("md5").update(dados).digest("hex");
const pasta = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "firmware");
copyFileSync(arquivo, path.join(pasta, `${alvo}.bin`));
writeFileSync(path.join(pasta, `${alvo}-version.json`), JSON.stringify({ version: versao, size: dados.length, md5 }) + "\n");
console.log(`${alvo}: versao ${versao}, ${dados.length} bytes, md5 ${md5}`);
console.log("Gravado em server/public/firmware/. Falta commitar e dar push na main.");
