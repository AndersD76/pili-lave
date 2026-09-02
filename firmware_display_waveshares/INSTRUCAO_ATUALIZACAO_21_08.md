# Instrução de Atualização — 21/08 (continuidade)

Documento para retomar o trabalho após reiniciar o PC. Resume o ESTADO ATUAL,
o que está pendente de gravação, e os próximos passos. Projeto: lava car now
(display ESP32-S3 COM6 + waveshare2 COM10, comunicação ESP-NOW).

---

## 0. ONDE PARAMOS (resumo rápido)

- ✅ **Giro 2→1 FUNCIONANDO** (grande vitória desta sessão). Ver run5/run7:
  `[GIRO] 2->1 fim giro (viu_home=1 parada=1 dt_saiu=...) -> fine-home` +
  `[GIRO] fine-home OK (X17+HOME) [imediato]`.
- 🔧 **Em diagnóstico:** erro **"CARRO TRAVADO"** no `carr_fwd` (ida do carrinho).
  O carrinho ANDA (~5 m confirmado pelo operador), mas o watchdog do X0 dispara.
  Conclusão: é **timing do X0** (pulsos espaçados / watchdog apertado), não é o
  carrinho parado. Ação em curso: watchdog X0 2000 → **4000 ms**.
- ⚠️ **BLOQUEIO ATUAL:** o display **não enumera COM6** (ponte CH343 não aparece
  no Windows, nem com troca de cabo/porta). A waveshare (USB nativo) aparece normal,
  então o PC está OK — é a CH343 do display travada ou danificada. Reboot do PC em
  andamento pra tentar destravar o driver.

---

## 1. BUILD PENDENTE DE GRAVAÇÃO (compilado, NÃO gravado ainda)

O firmware EM DISCO tem estas mudanças que o BOARD ainda NÃO recebeu (o último
upload falhou por a COM6 sumir):

1. **Watchdog do X0: 2000 → 4000 ms** (`processos.h`, `#define CARRO_WD_MS 4000`).
   Motivo: CARRO TRAVADO na ida mesmo com o carrinho andando.
2. **Debug melhorado no heartbeat** (`display.ino`): a linha `[DBG]` agora mostra
   `X10 X0 | Y4 Y14 vfd | X15 X16 X17 X12 | rec auto` — pra ver se o Y14 fecha e o
   inversor é comandado FWD durante o carr_fwd.

**AÇÃO ao voltar:** assim que a COM6 aparecer, gravar:
```
cd "C:\Users\giova\Documents\Arduino\lava car now\display"
arduino-cli.exe compile --upload -p COM6 --fqbn esp32:esp32:esp32s3:CDCOnBoot=default,FlashMode=qio,FlashSize=16M,PartitionScheme=default_8MB,PSRAM=opi,CPUFreq=240 .
```
(se der "porta ocupada": matar python.exe/esptool.exe antes; se UnicodeError:
`chcp 65001 & set PYTHONIOENCODING=utf-8` antes do comando.)

Depois: MONITORAR e rodar um ciclo, olhando o novo `[DBG]` durante o carr_fwd.

---

## 2. O QUE JÁ ESTÁ GRAVADO NO BOARD (versão anterior, funcionando)

Firmware atual no display (antes do build pendente) já contém, TUDO desta sessão:

- **X17 e X16 como NÍVEL ao vivo + debounce 100 ms** (`tipos.h` PULSO_W2_MASK
  0x42→0x02; `giro_tick` lê g_viv2 com `SENSOR_HOME_DEBOUNCE_MS 100`). Foi a
  correção RAIZ que fez o giro 2→1 parar no home (o X17 pulso escapava a 50 ms).
- **Marco de tempo do 2→1 (`_giro_t_saiu_pos2`)**: os cronômetros do 2→1
  (GIRO_IGNORA_X17_MS, GIRO_INICIO_RAMPA_MS, g_giro_timeout_ms) contam a partir da
  SAÍDA da pos2, não do Y4. Log `[GIRO] saiu pos2 dt_y4=Xms` e `dt_saiu=Xms`.
- **Memória de direção do fine-homing** (X11/X16/X7): decide horário/anti-horário.
  Ordem anti-horária 2→1: X11 → X16 → X17 → X7. PASSOU (saiu do X16 / chegou X7)
  → horário; AQUÉM (viu X11, não chegou) → anti-horário. Regra 3 (perde sinal
  >200 ms → inverte) já existia no `perdeu_tudo`.
- **Rampa de desaceleração: 1500 → 2000 ms** (GIRO_DESAC_MS e HOME_DESAC_MS).
- **Debounce do X15 (500 ms)** na entrada (AUTO_INICIANDO) — o X15 é instável no
  hardware (pisca 0/1) e travava o ciclo no primeiro 0. PENDENTE: checar o sensor
  X15 físico (fiação/distância) — o debounce é paliativo.
- Correções anteriores (já documentadas em MELHORIAS_IMPLANTADAS.md e
  ajuste x17/RELATORIO_AJUSTE_X17.md): X10 fantasma, Cor Mágica Y7, HOME por
  processo comentado, AP espera 5 s, senha cfg 1111, auto-home no boot, X12 no
  HOME 50 s, secagem 4 s, pausa (shift timers), LIMPAR ERRO, persistência de
  modelos/velocidades, gate do painel (remoto/X1), X15-abort→home.

---

## 3. ITENS TEMPORÁRIOS DE DEBUG (remover quando os testes terminarem)

- **Heartbeat `[DBG]`** no loop do `display.ino` (o novo, com X0/Y14/vfd).
- **Logs `[RAMPA]`** (giro, processos.h) e **`[RAMPA-HOME]`** (comm_espnow.h).
- **Painel de tuning GIRO/TIMEOUT** na tela AUTO (tela_auto.h) + globais
  `g_giro_dur_ms`/`g_giro_timeout_ms` + chaves NVS `giro_dur`/`giro_to` — fixar os
  valores achados como #define e remover.

---

## 4. PROBLEMA DO USB (CH343 do display) — status e próximos passos

Sintoma: display liga a tela (tem 5V), mas NÃO cria COM6 (nem "dispositivo
desconhecido" no Gerenciador). Waveshare (USB nativo do S3) aparece normal → PC OK.
Já testado: troca de cabo, troca de porta USB, BOOT+RST — sem efeito.

Ordem de tentativas ao voltar:
1. **Reboot do PC** (em andamento) — limpa driver CH343 travado (falha silenciosa
   só pra aquele chip, comum após desconexão "suja").
2. **Power-cycle TOTAL do display** — tirar toda energia (USB + fonte) 30-60 s.
3. Se nada: CH343/conector provavelmente danificado. FALLBACK: gravar por
   **adaptador USB-serial externo** nos pinos UART0 TX0/RX0/GND + BOOT/RST do
   display (contorna a CH343). Mais trabalhoso, mas funciona.

Obs.: a MÁQUINA OPERA NORMAL pelo painel/remoto mesmo sem USB (ESP-NOW é sem fio).

---

## 5. AMBIENTE (lembretes)

- WSL → Windows: usar `arduino-cli.exe` do Windows via cmd.exe.
- FQBN display: `esp32:esp32:esp32s3:CDCOnBoot=default,FlashMode=qio,FlashSize=16M,PartitionScheme=default_8MB,PSRAM=opi,CPUFreq=240`
- Monitor serial confiável (WSL): PowerShell `System.IO.Ports.SerialPort` a 115200
  (o `arduino-cli monitor` não grava em arquivo neste ambiente).
- USB instável: as duas placas (display COM6 / waveshare2 COM10) às vezes não
  coexistem; matar python.exe/esptool.exe quando a porta trava.

---

## 6. PRÓXIMO PASSO IMEDIATO (ao retomar)

1. Restaurar a COM6 (seção 4).
2. Gravar o build pendente (seção 1).
3. Monitorar + rodar ciclo; observar o novo `[DBG]` no carr_fwd (Y14 fechou? vfd
   FWD? X0 pulsando?) e ver se o watchdog 4000 ms resolveu o CARRO TRAVADO.
4. Se resolver: seguir o ciclo completo. Se não: analisar o `[DBG]` pra decidir
   (subir mais o watchdog, ou tratar a reversão do inversor / contator Y14).
