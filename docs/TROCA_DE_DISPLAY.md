# Troca de display (Waveshare ESP32-S3-Touch-LCD-7) — guia para IA/engenheiro

Objetivo: se o display for trocado e a tela não funcionar, seguir este roteiro sem redescobrir
nada. Escrito em 2026-10-22 depois de colocar em uso um display novo (Rev1.2) que subia com
**tela preta**.

## 1. Resumo do caso

- Display novo: Waveshare **ESP32-S3-Touch-LCD-7**, 800x480, serigrafia **Rev1.2**, módulo
  ESP32-S3-WROOM-1 **N16R8** (16 MB flash, 8 MB PSRAM octal). Dois USB-C (USB nativo e UART1/CH343),
  chave UART1/UART2.
- Firmware: o mesmo do display antigo (ESP32_Display_Panel + LVGL, classe `Board`). **No display novo
  a tela ficava preta** (a luz de fundo acendia, sem imagem).
- **Causa direta (confirmada pelo log serial):** o controlador de toque **GT911 não responde no I2C**.
  O `board->begin()` falha na etapa do toque, `lvgl_port_init()` aborta (`Touch device is not
  initialized`) e o LVGL nunca sobe (`LVGL mutex is not initialized` em loop). Sem LVGL nada é
  desenhado. O resto do firmware (ESP-NOW etc.) continua rodando, por isso parece "vivo mas preto".
- **Solução que funcionou:** compilar com o toque desligado (`ESP_OPEN_TOUCH 0`). A tela passa a
  aparecer normalmente. **O toque continua sem funcionar nesse exemplar** (ver seção 5).

## 2. Como reconhecer o problema (30 segundos)

1. Abra a serial da COM do display a 115200 (abrir a porta reseta a placa; leia o início do boot).
2. Procure estas linhas:
   - `esp_lcd_touch_new_i2c_gt911: Unable to initialize the I2C address`
   - `GT911 init failed` / `Touch device begin failed`
   - `lvgl_port_init: Initialize LVGL input driver failed`
   - `LVGL mutex is not initialized` repetido
3. Se aparecem, é este problema (toque não sobe). Se o boot nem chega a `Board initialize success`,
   o problema é outro (alimentação, flash, PSRAM, FQBN).

Leitura rápida em Python (não deixe outro programa com a porta aberta):

```python
import serial, time
s = serial.Serial('COM25', 115200, timeout=1)
s.dtr = False; s.rts = True; time.sleep(0.2); s.rts = False   # reseta a placa
t = time.time(); out = b''
while time.time() - t < 8: out += s.read(2048)
print(out.decode('utf-8', 'replace'))
```

## 3. Dados de hardware já verificados

| Item | Valor |
|---|---|
| I2C | SDA = GPIO 8, SCL = GPIO 9 (compartilhado entre toque e CH422G) |
| Expansor | CH422G; responde em 0x20–0x27 e 0x30–0x3F (comportamento normal do chip) |
| Escrita no CH422G | `0x24 = 0x01` (habilita saídas), `0x38 = byte de saídas` — ambas deram ACK |
| Toque | GT911, INT = GPIO 4, reset pelo CH422G (índice 1 na definição da biblioteca) |
| Luz de fundo | CH422G índice 2 (liga mesmo quando o toque falha: a tela "clareia" ao ligar) |
| LCD reset | CH422G índice 3 |
| RGB | PCLK=7, VSYNC=3, HSYNC=46, DE=5; PCLK 16 MHz; bounce buffer = 800*10 |
| RS-485 do display | TX=GPIO16, RX=GPIO15 (invertido em relação ao rótulo do wiki) |

O `esp_panel_board_custom_conf.h` do projeto é **idêntico à definição oficial** da biblioteca
(`BOARD_WAVESHARE_ESP32_S3_TOUCH_LCD_7.h`), inclusive a sequência de reset do GT911
(`TOUCH_PRE_BEGIN_FUNCTION`: INT baixo, reset pelo expansor, espera 200 ms). **Não é falta de reset
nem erro de config.**

## 4. Diagnósticos feitos (sketches prontos em `testes/`)

Todos compilam com o FQBN da seção 6 e não dependem de LVGL/ESP-NOW.

| Pasta | O que faz | Resultado neste caso |
|---|---|---|
| `testes/diag_i2c_scan/` | Varre I2C 1..126 ao ligar, depois liga o CH422G e reseta o GT911 com INT baixo e alto, testando 0x5D/0x14 | CH422G responde; **GT911 mudo em 0x5D e 0x14** em todos os estados |
| `testes/diag_i2c_scan2/` | Usa cada uma das 8 saídas do CH422G como possível reset do toque (INT baixo e alto) e estados fixos tudo-1/tudo-0 | **Nenhuma** combinação acordou o GT911 |
| `testes/display_sem_toque/` | Firmware de teste completo com `ESP_OPEN_TOUCH 0` | Sobe sem erros, **tela aparece** |

Interpretação: bus I2C e CH422G estão bons; o GT911 não responde de jeito nenhum. Isso afasta
endereço trocado, reset no bit errado e cabo do I2C. Sobram: cabo flat do touch mal encaixado,
GT911 ou painel de toque com defeito (hardware).

## 5. Estado atual e o que NÃO foi resolvido

- **Tela:** funciona com `ESP_OPEN_TOUCH 0` (mostra estado da máquina; sem botões).
- **Toque:** **não existe** nestes exemplares: faltam o flat/painel de toque com o GT911 (ver 5b). Solução: obter a
  versão do display **com** toque (ou o painel de toque + flat).
- Como o projeto depende de botões na tela (HOME, INICIAR, MANUAL, etc.), um display sem toque serve só
  para visualizar. Para operar, é preciso um display com toque funcionando.
- **RS-485 do display** (TX=16, RX=15) só foi validado no display antigo. Depois que o toque
  funcionar, testar com loopback ou com o Delta.

## 5b. Segundo exemplar novo (COM27) e CAUSA CONFIRMADA (2026-10-22)

Um segundo display novo (COM27) deu exatamente o mesmo resultado do primeiro (COM25): `GT911 init failed`,
tela preta com o firmware normal, `diag_i2c_scan` só com a faixa do CH422G (0x20–0x27 e 0x30–0x3F) e nada em
0x5D/0x14, com INT baixo ou alto.

**CAUSA: os dois displays novos NÃO TÊM O FLAT DO TOQUE.** Fotos do Giovani mostram:
- No display antigo (que funciona): um flat laranja fino com o **chip GT911 soldado no próprio flat**
  (impresso "GT911 FPC", pinos 1 RST, 2 VDD, 3 GND, 4 INT, 5 SDA, 6 SCL) encaixado no conector pequeno de 6
  vias ao lado do logo Waveshare (numerado 1..6).
- Nos displays novos esse conector está **vazio** e não há nenhum flat de toque na placa.

Como o GT911 está no flat (não na placa), sem o flat não existe GT911 no I2C: nenhum software resolve.
A serigrafia da placa diz "ESP32-S3-**Touch**-LCD-7 Rev1.2" nas duas versões, então **a serigrafia não
indica se o toque está presente**. Os displays novos são variantes **sem painel de toque** (ou sem o flat).

**Como conferir antes de comprar/instalar:** olhar o conector pequeno ao lado do logo Waveshare. Com flat
GT911 encaixado = tem toque. Vazio = sem toque. Pedir ao vendedor a versão **com painel capacitivo**
(Touch-LCD-7 com GT911), ou comprar o painel de toque + flat separado.

Enquanto isso, o firmware do display sem toque só mostra a interface (`ESP_OPEN_TOUCH 0`,
`testes/display_sem_toque/`): serve para visualizar o estado da máquina, não para operar.

## 6. Passo a passo para trocar de display

1. **Antes de gravar**: desligar o 24 V, deixar só o USB-C do display, conferir a porta com
   `arduino-cli board list` (a COM muda a cada exemplar: já foi COM11 e COM25). Gravação do display
   (CH343) é instável com a máquina toda ligada; se der "No serial data received", desligar o 24 V e
   reconectar o USB (às vezes ajuda BOOT+RESET).
2. **FQBN do display** (o que funcionou nos testes, 16 MB):
   `esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi,FlashSize=16M`
   (a pasta de produção usa `...CDCOnBoot=default,FlashMode=qio,FlashSize=8M,PartitionScheme=default_8MB,PSRAM=opi,CPUFreq=240`;
   ambos sobem no hardware N16R8).
3. Gravar o firmware normal (`testes/display/` no projeto de testes). Ler a serial (seção 2).
4. **Se subir com tela preta + erros do GT911**: rodar `testes/diag_i2c_scan/` para confirmar.
   Se o GT911 aparecer em 0x5D ou 0x14 em algum caso, o problema é de config (ajustar endereço/reset);
   se não aparecer em nenhum, é hardware.
5. Para ter tela mesmo sem toque: copiar a pasta do sketch, trocar `#define ESP_OPEN_TOUCH 1` por `0` em
   `esp_panel_board_custom_conf.h` e gravar (exemplo pronto: `testes/display_sem_toque/`).
6. Física: com tudo desligado, abrir a caixa e reencaixar o flat do touch (conector escuro do
   painel para a placa). Religar e repetir o passo 3.
7. Se um display novo funcionar completo, registrar a COM e a revisão aqui.

## 7. Armadilhas desta sessão

- Abrir a serial do display reseta a placa; manter só um programa por vez na porta
  (`PermissionError` = a porta ainda está com outro processo).
- Compilar o sketch do display é lento (LVGL): pode passar de 10 minutos; rode em segundo plano e
  espere o processo `arduino-cli` terminar.
- Não rodar dois `arduino-cli compile` ao mesmo tempo.
- A biblioteca instalada é a ESP32_Display_Panel **1.0.0** (a 1.0.4 existe); LVGL **8.4.0**; core
  esp32 **3.3.11**. Não atualizar sem testar: os nomes de arquivos mudaram na 1.0.0
  (`ESP_Panel_Board_*` → `esp_panel_board_*`).
- O canto inferior esquerdo do display **antigo** não responde ao toque; os botões críticos ficam na
  faixa de cima. Verificar se o novo também tem essa zona morta.

## 8. Referências no repositório

- Firmware de testes do display: `testes/display/` (`display.ino`, `esp_panel_board_custom_conf.h`,
  `lvgl_v8_port.*`, `protocolo_teste.h`).
- Definição oficial da placa:
  `Documents/Arduino/libraries/ESP32_Display_Panel/src/board/supported/waveshare/BOARD_WAVESHARE_ESP32_S3_TOUCH_LCD_7.h`.
- Referência do projeto de produção: `Documents/Arduino/lava carros/REFERENCIA_PROJETO.md`.
- Guia técnico completo: `GUIA_TECNICO_COMPLETO.md`.
