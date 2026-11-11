# Backup do firmware ATUAL antes do link W1<->W2 por cabo (2026-11-01)

Pasta criada na branch `link-uart-w1-w2`. **Nada aqui altera os arquivos de produção**; é só uma fotografia.

## O que tem aqui
| Pasta/arquivo | O que é |
|---|---|
| `fonte/waveshare1`, `fonte/waveshare2`, `fonte/display` | cópia do código-fonte **exatamente como está hoje** em `testes/` (inclui as alterações de 29–31/10 que já estão gravadas na máquina e **ainda não estavam commitadas** na `loja-conveniencia`) |
| `SHA256_FONTE_ORIGINAIS.txt` | hash de cada arquivo original no momento da cópia. Serve para provar depois que os originais não foram alterados (`cd testes && sha256sum -c ../testes/w1_w2_por_rxtx/backup_atual/SHA256_FONTE_ORIGINAIS.txt`) |
| `bin/w1`, `bin/w2`, `bin/display` | firmware **compilado a partir desse código**, **sem gravar**: `*.ino.bin` (aplicativo), `bootloader.bin`, `partitions.bin` e `*.merged.bin` (flash inteira de 16 MB; fica só no disco, fora do git) |
| `SHA256_BIN_ATUAIS.txt` | hash dos binários |

Tamanho do aplicativo (idêntico ao último que foi gravado): W1 950 747 bytes, W2 900 571 bytes.

> Aviso: o `.bin` compilado é **reproduzível a partir do código**, mas **não é byte a byte** o que está na placa (a placa também guarda configuração na NVS: canal, senhas, planilha, etc.). Para uma cópia EXATA use o dump da flash abaixo.

## 1. Salvar uma cópia EXATA das placas (dump da flash)
Faça **com o disjuntor dos inversores e das bombas desligado, sem carro e sem ninguém na área de movimento**: durante o dump (alguns minutos) a placa fica em modo de gravação e **a máquina fica sem controle**. Uma placa de cada vez, cada uma no USB.

```
set ESPTOOL=%LOCALAPPDATA%\Arduino15\packages\esp32\tools\esptool_py\5.3.1\esptool.exe
%ESPTOOL% --chip esp32s3 --port COM24 --baud 921600 read-flash 0 0x1000000 backup_w1_COM24_2026-11-01.bin
%ESPTOOL% --chip esp32s3 --port COM10 --baud 921600 read-flash 0 0x1000000 backup_w2_COM10_2026-11-01.bin
%ESPTOOL% --chip esp32s3 --port COM11 --baud 460800 read-flash 0 0x1000000 backup_display_COM11_2026-11-01.bin
```
(PowerShell: `$ESPTOOL = "$env:LOCALAPPDATA\Arduino15\packages\esp32\tools\esptool_py\5.3.1\esptool.exe"` e depois `& $ESPTOOL ...`. A sintaxe antiga `read_flash` com sublinhado também funciona, com um aviso.)
Cada arquivo tem 16 MB: **guardar fora do git** (disco/nuvem). Confira o tamanho: `16777216` bytes.

## 2. Voltar a gravar o que estava (sem recompilar)
**Pelo dump (volta tudo, inclusive a configuração salva na NVS):**
```
%ESPTOOL% --chip esp32s3 --port COM24 --baud 921600 write-flash 0 backup_w1_COM24_2026-11-01.bin
%ESPTOOL% --chip esp32s3 --port COM10 --baud 921600 write-flash 0 backup_w2_COM10_2026-11-01.bin
%ESPTOOL% --chip esp32s3 --port COM11 --baud 460800 write-flash 0 backup_display_COM11_2026-11-01.bin
```
**Pelos binários compilados desta pasta (volta o programa; a NVS fica como está):**
```
%ESPTOOL% --chip esp32s3 --port COM24 --baud 921600 write-flash 0x0 bin\w1\waveshare1.ino.merged.bin
%ESPTOOL% --chip esp32s3 --port COM10 --baud 921600 write-flash 0x0 bin\w2\waveshare2.ino.merged.bin
```
(`merged.bin` = bootloader + partições + aplicativo em um arquivo só, a partir do endereço 0x0.)

**Pelo código-fonte, com o arduino-cli** (compila e grava o que está em `fonte/`):
```
arduino-cli compile --fqbn "esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc" testes\w1_w2_por_rxtx\backup_atual\fonte\waveshare1
arduino-cli upload  -p COM24 --fqbn "esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc" testes\w1_w2_por_rxtx\backup_atual\fonte\waveshare1
```
(o arduino-cli exige que a pasta se chame como o `.ino`; as pastas de `fonte/` já têm esses nomes.)

## 3. Tag e branch
- Tag `backup-w1-mestre-funcionando-2026-10-24`: existe (firmware de 24/10, mais antigo).
- Tag `backup-antes-link-uart-2026-11-01`: aponta para o commit **que contém esta pasta**, ou seja, o código **realmente gravado hoje**.
- Branch de trabalho: `link-uart-w1-w2` (a partir da `loja-conveniencia`).
