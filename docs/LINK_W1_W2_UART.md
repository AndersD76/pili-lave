# Link W1 <-> W2 por cabo (UART0) — projeto, teste e reversão

Documento **novo** (criado em 2026-11-01, branch `link-uart-w1-w2`). **Nenhum documento existente foi alterado**; as edições propostas para eles estão no relatório, sem aplicar.

## 1. Por que
Falhas no link W1<->W2 por rádio (ESP-NOW) fizeram a W1 deixar de ver o X10 (que entra pela W2) e o carrinho seguiu até travar (`CARRO TRAVADO (retorno X10)`). Evidência: silêncios da W2 de 160 a 208 s em 29/10 e 30/10, e o envio de rádio da W1 travado em 31/10 (`tx_ok` congelado). A mudança: **sai o Wi-Fi entre W1 e W2 e entra um cabo**. O rádio fica **só na W1**, que continua falando com o display e a câmera como hoje.

## 2. Escopo (o que muda e o que NÃO muda)
- **Muda só o transporte W1<->W2.** Lógica de processos, giro, carrinho, HOME, Delta/SAJ por RS-485 e intertravamentos não mudam.
- O display e a câmera continuam por ESP-NOW, com a mesma busca e migração de canais (display -> câmera -> W1). A W2 **deixa de ser buscada/migrada por Wi-Fi** (não usa mais canal).
- Tudo em pastas novas: `testes/w1_w2_por_rxtx/` (`teste_link/` = Fase 1, `waveshare1/` e `waveshare2/` = Fase 2). Os firmwares atuais ficam intactos.

## 3. Pinos e fiação
Cabo = **UART0** da placa (3,3 V, direto no chip, **sem isolação**):

| Sinal | GPIO | Observação |
|---|---|---|
| **TXD** (borne) | **43** | fonte do mapeamento: PR #25 de hennejg/waveshare-ESP32-S3-io. **A documentação oficial da Waveshare NÃO dá esse mapeamento: confirmar com o loopback (`L`).** |
| **RXD** (borne) | **44** | idem |

Já usados (**não tocar**): RS-485 do Delta na W1 (TX 17, RX 18, DE/RE 21), entradas X da W2 (GPIO 4 a 11), I2C (SDA 42, SCL 41), CAN (2, 3), Ethernet (12 a 16, 39), LED 38, buzzer 46, BOOT 0, RTC INT 40, SD 45/47/48.
Confirmado no código atual: **nada usa `Serial0`/UART0 nem os GPIO 43/44** (W1 e W2 compilam com `CDCOnBoot=cdc`, então o USB nativo é o `Serial` e a UART0 está livre).

Fiação (feita pelo Giovani):
```
W1 TXD (borne) ──[100 a 330 Ω]── RXD (borne) W2
W2 TXD (borne) ──[100 a 330 Ω]── RXD (borne) W1
W1 GND  ───────────────────────── GND W2          (GND comum)
```
Fio **trançado**, 10 a 15 cm, longe de cabos de força/inversor. O resistor em série em **cada** linha limita corrente e amortece reflexão. **Nunca** ligar 24 V nesses bornes.
Cuidado: o GPIO43 emite **texto de boot do ROM** por instantes depois de cada reset. O protocolo tem byte de início, tamanho, CRC, descarta lixo e ressincroniza; o teste não conta o lixo dos primeiros 3 s.

## 4. Quadro (igual na Fase 1 e na Fase 2)
```
A5 5A | tipo | seq (2 B, little-endian) | len | payload[len] | CRC16 (2 B, little-endian)
```
- **CRC16-CCITT** (poly 0x1021, init 0xFFFF) sobre `tipo, seq, len, payload` (não inclui `A5 5A`). Tamanho máximo do payload: 128.
- Receptor: procura `A5 5A`; descarta e conta o que não for quadro; confere `len <= 128`; se o quadro parar no meio por mais de 20 ms, conta **truncado** e ressincroniza; CRC errado conta **CRC ruim** e ressincroniza.
- Fase 1 usa estes tipos: `1 OI`, `2 RESP`, `4 FASE`, `5 FASE_ACK`. A Fase 2 acrescenta os de E/S (a definir no estudo).

## 5. Fase 1 — firmware só de teste (`teste_link/`)
Pastas `w1_teste_link/` e `w2_teste_link/`; cada uma com `link_proto.h` **idêntico** (`cmp`) e um `.ino` de 8 linhas que só define `LADO` (1 = W1, 2 = W2).
FQBN: `esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc` (W1 = COM24, W2 = COM10).

**Fluxo "oi" e inversão.** A W1 manda o ritmo das **fases** (cada uma dura `T_FASE_S` = 30 s e depois alterna, sem parar):
- **Fase par:** a W1 manda `OI` (20 por segundo) e a W2 responde com `RESP` ecoando o padrão.
- **Fase ímpar: a conversa INVERTE.** A W2 manda `OI`, a W1 responde.
- A W1 anuncia a fase com `FASE` (a cada 100 ms até a W2 confirmar com `FASE_ACK`; depois a cada 2 s, para ressincronizar se a W2 reiniciar).
- O payload de `OI`/`RESP` é: `[fase][pat_id][pat_len][contadores do remetente (90 B)][padrão]`. Padrões: `0x00`, `0xFF`, `0x55`, `0xAA`, incremental, pseudo-aleatório (semente = seq) e `A5 5A A5 5A…` (estressa a sincronização). O tamanho varia de 8 a 32 bytes.
- **Cada lado manda os seus contadores dentro de cada quadro**, então **um único monitor mostra as duas visões**.

**Contadores (relatório a cada 5 s, por direção, e RESUMO ao fim de cada fase).** Como *iniciador*: enviados, ok, CRC ruim, timeouts, fora de hora, eco diferente. Como *respondedor*: recebidos ok, CRC ruim, **perdidos** (saltos de seq), **duplicados**, **fora de ordem**. Comuns: truncados, **bytes espúrios** (fora de quadro, depois dos 3 s de boot; o lixo de boot é contado à parte), **erros da UART** (break, frame, paridade, estouro de FIFO, buffer cheio), **ida e volta** (mínimo, médio e máximo, da janela e da fase), **maior silêncio** entre quadros válidos, **maior rajada** de falhas seguidas.
Cada erro sai **em linha própria**, com o instante em ms e o tipo (limite de 30 linhas por janela; o resto vira "+N suprimidas").

**Veredito** (por lado, na fase atual):
- **OK:** nenhuma falha, nenhum byte espúrio e nenhum erro de UART.
- **ATENCAO:** há falhas, mas a taxa é **menor que 0,1 %**.
- **RUIM:** taxa **de 0,1 % ou mais**, ou uma **rajada de 3 falhas seguidas**.
- **SEM TRAFEGO:** nenhuma tentativa na fase.
- **"RUIDO PROVAVEL"** é somado ao veredito sempre que houver bytes espúrios ou erros da UART **fora da janela de boot**.
- Taxa de falha = (CRC ruim + timeouts + fora de hora + eco diferente + perdidos + duplicados + fora de ordem + truncados) / tentativas.
- O **LED da placa (GPIO 38)** mostra o último veredito: verde (OK), amarelo (ATENÇÃO), vermelho (RUIM), azul (esperando o vizinho).

**Comandos pelo monitor serial (115200):** `L` loopback na própria placa (jumper TXD↔RXD, sem a outra placa), `R` zera os contadores, `S` mostra o resumo agora. **Abrir o monitor serial reinicia a placa.**
**Velocidade:** 115200 por constante. Para comparar a 460800 sem mexer no código, compile **as duas** placas com `--build-property "compiler.cpp.extra_flags=-DLINK_BAUD=460800UL"` (testado: a propriedade chega ao compilador; **não** use `build.extra_flags`, que pode apagar defines da placa). A mesma velocidade tem que estar nos dois lados.

**Segurança da Fase 1:** nenhum sinal nas saídas. No boot cada firmware grava **uma vez** o valor "tudo desligado" no expansor PCA9554 (endereço `0x20`, I²C SDA 42 / SCL 41): registrador de saída **`0xFF`** (a lógica da produção é invertida: bit 1 = relé desligado) e direção `0x00`, confere por leitura de volta (`[EXP] ... -> OK`) e **nunca mais escreve** nas saídas. Diferença para a produção: a produção grava a direção antes da saída; aqui grava a saída **antes** e só depois a direção (estado final idêntico, mas nunca aparece um valor antigo nos relés). Sem RS-485 (GPIO 17, 18, 21 inativos), sem Wi-Fi e sem ESP-NOW.

## 6. Roteiro da Fase 1 na máquina (numerado)
> Só grave com o seu "grava" explícito. Gravar o teste **apaga o firmware de produção** dessas placas até a restauração (item 6.7): a máquina fica **sem controle** durante o teste.

1. **Preparar a máquina:** desligar os **disjuntores dos inversores** (Delta e SAJ) e das **bombas**; deixar só o **24 V das placas**; **sem carro** e **sem ninguém** na área de movimento.
2. **Salvar o backup das duas placas** (dump da flash), conforme `testes/w1_w2_por_rxtx/backup_atual/LEIAME.md` (comandos `read-flash` da COM24 e da COM10). Conferir que cada arquivo tem 16 777 216 bytes.
3. **Ligar o cabo** (seção 3) e **gravar** primeiro a W2 e depois a W1:
   ```
   arduino-cli upload -p COM10 --fqbn "esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc" testes\w1_w2_por_rxtx\teste_link\w2_teste_link
   arduino-cli upload -p COM24 --fqbn "esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc" testes\w1_w2_por_rxtx\teste_link\w1_teste_link
   ```
   (os `.bin` já compilados: `arduino-cli compile` na mesma pasta antes do `upload`).
4. **Loopback em cada placa** (uma por vez, **sem o cabo da outra**): jumper entre os bornes TXD e RXD da placa, abrir o monitor (115200) e digitar `L`. Esperado: `[LOOPBACK] RESULTADO: OK` e, antes, `[EXP] ... -> OK`. Se der **SEM ECO**: o mapeamento GPIO43/44 não é o dos bornes ou o jumper está solto (a doc oficial não o confirma) — **pare e me avise antes de seguir**. Retirar os jumpers.
   Depois, **o par W1 e W2** com a fiação cruzada, **parado por 10 minutos** (20 fases), com **dois monitores** (um por placa).
5. **Inversores energizados, SEM comando de marcha:** ligar os disjuntores do Delta e do SAJ (sem dar marcha) e observar mais 10 minutos a taxa de erro. **Só ligar um inversor pelo painel dele se o Giovani decidir que é seguro.**
6. **Critérios de aprovação** (parado **e** com os inversores energizados, 10 min cada): **zero** CRC ruim, **zero** timeouts, perdidos, duplicados, fora de ordem e truncados; **zero** byte espúrio fora dos 3 s de boot e **zero** erro de UART; veredito **OK** em todas as janelas; ida e volta máxima abaixo de 30 ms. **Se falhar:** (a) conferir cruzamento TXD/RXD, GND comum e resistores; (b) encurtar/trançar o cabo e afastá-lo da força; (c) repetir com baud menor (57600) e maior (460800) para ver a sensibilidade; (d) se ainda ruim, **não passar para a Fase 2** e me avisar.
7. **Restaurar o firmware original das duas placas** (qualquer um dos três jeitos, em `backup_atual/LEIAME.md`): `write-flash 0 backup_w1_COM24_2026-11-01.bin` (e o da W2), ou os `*.merged.bin` da pasta `backup_atual/bin/`, ou compilar e gravar `backup_atual/fonte/`. Depois religar os disjuntores.

## 7. Fase 2 — W1 e W2 de produção com o link por cabo
**Estado: implementada e COMPILADA; NÃO gravada.** Só grave depois da Fase 1 aprovada e com o seu "grava".
Pastas: `testes/w1_w2_por_rxtx/waveshare1/` e `.../waveshare2/` (cópias do firmware gravado em 29–31/10). Fonte única da verdade da chave: `link_cfg.h` (idêntico nas duas).

### 7.1 O que mudou (e só isso)
| Arquivo | Situação |
|---|---|
| `waveshare1/controle.h` | **modificado**: só transporte W1<->W2 (57 linhas inseridas, 0 removidas; o código antigo está no `#else`) |
| `waveshare2/waveshare2.ino` | **modificado**: só transporte + fail-safe + watchdog (96 inseridas, 0 removidas; o código antigo está no `#else`) |
| `link_cfg.h`, `link_frame.h` (nas duas pastas, **idênticos**), `waveshare1/link_w2_uart.h` | **novos** |
| `processos.h`, `maquina_estados.h`, `nuvem_w1.h`, `tipos_w1.h`, `protocolo_teste.h`, `vfd_rs485_w1.h`, `saj_rs485_w1.h`, `waveshare1.ino`, `comm_espnow.h`, `nvs_manager.h`, `tipos.h` | **byte a byte iguais** aos originais (`cmp`) |
| display, câmera, backend | **não mudam** |

### 7.2 Chave de reversão
`LINK_W1_W2_UART` em `link_cfg.h`: **1 = cabo**, **0 = ESP-NOW antigo** (código preservado). Para voltar: troque o `1` por `0` nas duas pastas, recompile e regrave W1 e W2. Sem editar: `--build-property "compiler.cpp.extra_flags=-DLINK_W1_W2_UART=0"`.
**Prova de que a chave em 0 é o firmware atual:** (a) `python prova_chave0.py waveshare1/controle.h ../waveshare1/controle.h` e o mesmo para `waveshare2.ino` resolvem os condicionais com valor 0 e comparam linha a linha com o original: **idênticos**; (b) compiladas com a chave em 0, a W1 dá **953 763 bytes / 50 508 de RAM** (igual à produção de 2026-11-01, já com a regra de 3 min sem X15, duração máxima, Delta mudo, memória e largura do pulso) e a W2 **900 571 / 47 108** (igual à produção). Em 2026-11-01, **depois** da fotografia de `backup_atual/` (que continua sendo o firmware gravado em 31/10, 950 747 / 50 420), entraram na produção os watchdogs novos (recuperação com 3 tentativas, prazo de 3 min nos estados de espera, o app prevalecendo sobre o ciclo armado pelo painel, `FAULT` e watchdog no display); `maquina_estados.h` e `nuvem_w1.h` da Fase 2 foram **atualizados com a cópia exata** da produção (`cmp` igual) e nada do transporte mudou. Detalhe: `testes/PENDENCIAS_NA_MAQUINA.md`, seção J.
Voltar atrás, por ordem de facilidade: (1) chave em `0` e regravar; (2) `backup_atual/` (dump ou `.bin`); (3) `git checkout backup-antes-link-uart-2026-11-01`.

### 7.3 Protocolo (quadro igual ao da Fase 1; tipos de produção)
| Tipo | Sentido | Payload | Quando |
|---|---|---|---|
| `LT_HB` 0x10 | W2 -> W1 | `[di_vivo][do_estado][motivo_do_reset][uptime_s (4 B)]` | a cada 200 ms |
| `LT_EVT` 0x11 | W2 -> W1 | `[di_vivo][di_borda]` | na hora de cada borda de entrada (ISR, debounce 800 µs) |
| `LT_CMD` 0x12 | W1 -> W2 | `[canal 0..7][estado]` | a cada ordem de saída (mesma regra de hoje: limite de 200 ms por canal, reconciliador de 400 ms, "desligar tudo" no boot) |
| `LT_KEEP` 0x13 | W1 -> W2 | (vazio) | a cada 200 ms: sinal de vida |
Sem confirmação por quadro (igual ao ESP-NOW de antes). Os dados atualizam **as mesmas variáveis**, na mesma seção crítica (`g_viv2`, `g_lat2`, `g_hb2`, `g_w2_do_real`, captura de X16/X17 em 100 ms), então `io2_set_do`, `io2_get_di`, `modbus_refresh_io2_di`, `comm_perdida`, o reconciliador, a pausa por falha da W2 e o `[LINK]` seguem iguais. A recepção na W1 roda no **callback da UART** (não no loop, que chega a travar ~1,1 s no RS-485).

### 7.4 Segurança (igual à de hoje, nunca pior)
- **Pausa por falha da W2 (mantida):** sem quadro da W2 por 1,5 s, a W1 pausa o ciclo e retoma sozinha ao voltar (`maquina_estados.h`, idêntico).
- **Fail-safe da W2 (NOVO):** sem **nenhum** quadro da W1 por **2 s**, a W2 desliga as saídas sozinha (bombas, solenoides, contator do carrinho, aspirador), **menos as luzes (DO7)**. Ao voltar, o reconciliador da W1 reenvia o que ela quer ligado. Mantém o cooldown de 500 ms do Y14 e o Y15 sempre bloqueado.
- **Watchdog de tarefa na W2 (NOVO):** 8 s, reinicia a W2 se o loop dela travar (no boot as saídas ficam desligadas).
- A W1 continua mandando a W2 desligar tudo no boot. Nenhum laço bloqueante no loop de controle (a escrita na UART espera no máximo 5 ms pelo mutex).
- Diagnóstico: linha `[W2LINK]` a cada 5 s no serial da W1 (quadros ok, CRC ruim, truncados, espúrios, erros da UART, maior intervalo, motivo do último reset e uptime da W2, reinícios detectados); a W2 imprime `[WAVE2LINK]` a cada 30 s e `[WAVE2] FAIL-SAFE...`.

### 7.5 Migração de canal (único ponto de comportamento que muda)
O fluxo não muda: o display migra a **câmera**, depois a **W1**, depois entrega a senha, e só então a câmera conecta na internet. **A W2 sai da conversa**: não recebe mais "vai para o canal N" e não tem canal. Na W1, a sequência é a mesma (muda, confere, salva na NVS `rede/canal`, "oi" ×4 ao display). A confirmação que era "a W2 apareceu no canal novo em 3 s" (e, se não, volta ao canal antigo) passa a ser "**ouvi o display no canal novo em até 12 s**" (e, se não, volta ao canal antigo). A janela é maior porque o display só chega ao canal novo ~1 s depois da W1, manda ordens a cada 2 s e desiste sozinho em 10 s. Display e câmera ficam intocados.

## 8. Plano de teste na máquina da Fase 2 (depois do "grava", só após a Fase 1 aprovada)
Gravar sempre com a máquina **parada e sem carro**, W1 e W2 ao mesmo tempo (as duas precisam estar no mesmo modo).
1. **Parada, sensores chegando:** monitor da W1: `[W2LINK] ok` subindo, `crc_ruim=0`, `trunc=0`, `espurios=0`, `perdidos=0`, `gap_max` ~200 ms; `[LINK] w2_gap_max` ~200 ms; na tela TÉCNICO "W2: OK". Mexa um sensor da W2 à mão (X10, X12…) e veja o valor mudar na tela. Deixe 30 min.
2. **Ciclo a seco** (TÉCNICO > INICIAR TESTE, sem carro): conclui; `[W2LINK]` limpo; saídas (bomba, solenoides, Y14) acionam e desligam como antes.
3. **Ciclo com carro real:** olhe o `[W2LINK]` e confirme o **X10 em todo retorno parcial** (`CARRINHO REV_X10` seguido de giro, sem `CARRO TRAVADO`). Repetir 3 lavagens.
4. **Cabo desconectado de propósito, com a máquina parada:** a W1 mostra "Waveshare 2 sem contato (cabo)" (alarme em 60 s) e a tela "W2: SEM CONTATO"; com um **teste em andamento** desconecte o cabo por 5 s: a W1 pausa ("PAUSADO por falha W2"), a W2 desliga as saídas em 2 s (`[WAVE2] FAIL-SAFE`, luzes continuam) e, ao reconectar, o ciclo **continua de onde parou** e o fail-safe encerra.
5. **Inversores ligados:** repetir o item 1 por 30 min e um ciclo, vendo a taxa de erro do cabo no `[W2LINK]`.
6. **Display e câmera, busca e migração de canal:** confirmar o reconhecimento normal do display e da câmera; fazer **a migração completa de rede** (escolher rede nova, câmera -> W1 -> senha -> internet) e a de **re-sync** com o roteador mudando de canal; ver `[CANAL] migrando ... (esperando o display no canal novo)` e depois `[CANAL] ok`. **Testar também o caso ruim:** desligar o display durante a migração e ver `[CANAL] FALHOU ... voltei ao ...` em 12 s.
7. **Tela de Wi-Fi do display:** `Canal N  W1: ok  W2: ok` (a W2 vem do status da W1).
8. **Voltar atrás:** chave em 0 e regravar W1 e W2, ou o backup (seção 7.2).

## Resultado do loopback na máquina (2026-11-02) — APROVADO nas duas placas
Sketches `w1_teste_link` (COM24) e `w2_teste_link` (COM10), cada placa sozinha, jumper entre os bornes **TXD e RXD**, comando `L`:
- **W1:** 100 quadros enviados, `ok=100 crc_ruim=0 eco_diferente=0 sem_eco=0 bytes_estranhos=0` → `RESULTADO: OK`.
- **W2:** idem, `ok=100`, tudo zero → `RESULTADO: OK`.
- Conclusão: **os bornes TXD e RXD das duas placas são mesmo GPIO 43 / GPIO 44 (UART0)** e o hardware está bom. O mapeamento do PR #25 de hennejg/waveshare-ESP32-S3-io, que a documentação oficial não confirma, está **validado** nas duas placas.
- Gravações: upload verificado ("Hash of data verified"), `UploadSpeed=230400`. Observação do dia: a **leitura** (`read-flash`) da W1 cai com "Packet content transfer stopped" em trechos com muitos bytes `0xC0` (SLIP do stub do esptool 5.3.1); a gravação não é afetada. Cópia completa da W1 feita com o script de pedaços + `--no-stub` nos trechos difíceis (arquivo fora do git: `Documents\pili_backups_flash_2026-11-02\backup_w1_COM24_2026-11-02.bin`).
- Próximo: par W1+W2 com a fiação cruzada, parado por 10 min (item 4 do roteiro), depois a Fase 2.
