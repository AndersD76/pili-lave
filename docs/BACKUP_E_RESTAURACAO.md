# Backup do firmware que funciona e como restaurar

Criado em 2026-10-24. **Decisão do Giovani:** ainda não há clientes usando o app, então a migração para o firmware novo (W1 mestre) pode continuar;
antes, guardamos o que funciona hoje para não perder nada.

## 1. O que está guardado
| O quê | Onde | Observação |
|---|---|---|
| **Firmware novo que roda na máquina** (W1 mestre, W2, display) | tag git **`backup-w1-mestre-funcionando-2026-10-24`** (commit `a0e377a`, enviada ao GitHub) | Código-fonte completo em `testes/waveshare1`, `testes/waveshare2`, `testes/display` |
| **Firmware antigo com nuvem/app** (display mestre) | pasta `lava_car_485/` e `firmware_camera/` (já no git, intocados) | Tem início por app, eventos, licença, cadastro. Continua sendo a referência de produção do app |
| Bancada de ruído do RS-485 | `testes_ruido_rs485/` | Para repetir os testes quando o filtro chegar |

**Atenção ao que a tag contém:** o commit tem tudo o que foi gravado e testado na máquina **mais** quatro alterações que só foram **compiladas**, ainda **não gravadas**:
Cera d'água com o Y0 o processo todo, pressão da água (SAJ) na tela de velocidades, luzes da máquina (DO7) e a presença do técnico para as luzes.
Ou seja, a tag é um pouquinho **mais nova** que o que está dentro das placas.

## 2. Backup EXATO das placas (pendente: precisa das placas conectadas)
Ler a memória de cada placa guarda **exatamente** o que está gravado (inclusive a configuração salva). Com cada placa no USB (uma de cada vez):
```
esptool --chip esp32s3 --port COM24 --baud 921600 read_flash 0 0x1000000 backup_w1_COM24.bin     # W1  (16 MB)
esptool --chip esp32s3 --port COM10 --baud 921600 read_flash 0 0x1000000 backup_w2_COM10.bin     # W2
esptool --chip esp32s3 --port COM11 --baud 460800 read_flash 0 0x1000000 backup_display_COM11.bin # display (às vezes precisa BOOT+RESET)
```
(o `esptool.exe` fica em `%LOCALAPPDATA%\Arduino15\packages\esp32\tools\esptool_py\5.3.1\`). Cada leitura leva alguns minutos. Para restaurar a placa
inteira: `esptool --chip esp32s3 --port COMx write_flash 0 backup_xxx.bin`. **Esses `.bin` têm 16 MB cada: guardar fora do git** (disco/nuvem).

## 3. Restaurar pelo código (sem os .bin)
```
git checkout backup-w1-mestre-funcionando-2026-10-24
# W1 (COM24) e W2 (COM10):
arduino-cli upload -p COM24 --fqbn "esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc" testes/waveshare1
arduino-cli upload -p COM10 --fqbn "esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc" testes/waveshare2
# display (COM11; se não conectar: BOOT+RESET, ou desligar o 24 V):
arduino-cli upload -p COM11 --fqbn "esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi,FlashSize=16M" testes/display
```
(antes de `upload`, rode `arduino-cli compile` com o mesmo `--fqbn` e a mesma pasta.)

## 4. Voltar ao firmware ANTIGO (display mestre, com app)
Gravar `lava_car_485/display`, `lava_car_485/waveshare1` e `lava_car_485/waveshare2` (FQBNs em `GUIA_TECNICO_COMPLETO.md`, seções 3 e 4) e a câmera
(`firmware_camera`). Atenção: o antigo usa **Modbus RS-485** entre display e Waveshares, então a **fiação do RS-485** precisa estar como era antes
(SAJ de volta no barramento fica fora: foi o que causou o ruído).
