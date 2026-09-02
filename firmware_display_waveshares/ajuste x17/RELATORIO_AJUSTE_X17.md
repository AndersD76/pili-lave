# Relatório Técnico — Ajuste do X17 e correções relacionadas

Registro das alterações de firmware feitas nesta rodada (display ESP32-S3 + waveshare2).
Serve como transferência de conhecimento (inclusive para refazer o firmware/app depois).

Arquivos do projeto: `.../lava car now/display/*.h` e `display.ino`. Firmware da
waveshare2: `.../lava car now/waveshare2/waveshare2.ino`.

---

## 0. Resumo do achado principal (o "problema do braço")

**Sintoma:** o giro do braço "não lia o X17" — parava fora de posição / não fechava no home.

**Causa raiz (dois problemas encadeados):**
1. **O X17 é sensor de PULSO**, não de nível. No firmware da waveshare2:
   `#define DI7_PIN 10 // X17 home braco 2 pontas (PULSO)`. As 2 pontas do braço
   **passam** pelo sensor e geram um **pulso curto** — o nível ao vivo quase nunca
   está ativo. Só no exato ponto de repouso (home/pos2) uma ponta fica na frente.
2. **O giro lia o X17 pelo nível ao vivo** (`g_viv2 & 0x40`) e, além disso, o
   **latch do pulso era consumido em dobro**: o `auto_tick` (AUTO_PROCESSO) fazia
   `modbus_refresh_io2_di()` e **depois** o `giro_tick` fazia outro refresh, que
   reconstruía `g_io2.di` **sem** o pulso (já consumido). Resultado: o pulso do X17
   era apagado antes do giro ver.

**Correção (em `processos.h`, `giro_tick`):**
- Ler o X17 pelo **latch**: `bool x17 = (g_io2.di & 0x40) != 0;` (nunca `g_viv2`).
- **Remover o `modbus_refresh_io2_di()` de dentro do `giro_tick`**, deixando o
  refresh só no `AUTO_PROCESSO` (que roda logo antes). Assim o pulso capturado por
  esse refresh **sobrevive** até o giro ler.

**Validado ao vivo:** no heartbeat, no home `X17=1`; durante o giro `X17=0`; giro
completa. O X17 passou a ser lido corretamente.

---

## 1. Mapa de sensores da waveshare2 (crucial)

`di_vivo` = nível no instante; `di_borda` = latch de borda/pulso (por interrupção).
No display: `g_viv2` = nível; `g_io2.di = g_viv2 | latch` (nível + pulso). Máscara de
pulso `PULSO_W2_MASK` cobre **X11 e X17**.

| Sinal | DI (waveshare2) | GPIO | bit | Tipo |
|---|---|---|---|---|
| X10 carro sob mesa | DI1 | 4 | 0 | nível |
| X11 giro braço | DI2 | 5 | 1 | **PULSO** |
| X12 fim curso trás | DI3 | 6 | 2 | nível |
| X13 fim curso frente | DI4 | 7 | 3 | nível |
| X14 carro entrando | DI5 | 8 | 4 | nível |
| X15 carro na posição | DI6 | 9 | 5 | nível |
| **X17 home braço (2 pontas)** | DI7 | 10 | 6 | **PULSO** |
| X16 HOME_GIRO (pos 1) | DI8 | 11 | 7 | nível |

**Regra de ouro:** sensor de PULSO (X11, X17) → **sempre** ler por `g_io2.di`
(vivo|latch), nunca por `g_viv2`. E cuidado com **refresh duplo** consumindo o latch
antes do consumidor. Para checar "está no zero" (estático, braço parado) use **só
níveis** (X16, X12) — nunca X17 (pulso = 0 parado).

---

## 2. Demais alterações feitas nesta leva

### 2.1 [FIXO] Auto-home no retorno de energia (recuperação no boot)
`maquina_estados.h` (`recuperacao_tick()`), chamada no loop antes do `home_tick()`.
- No boot: se **não** estiver no zero (`X16 && X12`, só níveis) → recuperação.
- **Fase 1 (X15 com carro):** vermelho (Y12) piscando **2 Hz** = "retire o veículo".
- **Fase 2 (X15 livre):** inicia o **HOME automaticamente**; verde/vermelho
  alternando **0,5 Hz** até concluir. Carro reentra → aborta → Fase 1.
- Ao entrar em recuperação chama `desligar_tudo()` (zera saídas presas do ciclo
  interrompido — ex.: Y13 que ficava aceso).
- Validado ao vivo: `[REC] boot fora do zero -> ... -> HOME concluido -> encerrada`.

### 2.2 [FIXO] Timeout do X12 no HOME dobrado
`comm_espnow.h`: `HOME_TIMEOUT_DESLOC_MS = 50000` (fase de recuo até X12); a fase de
giro segue em 25000. (Antes 25 s davam "X12 nao achado" cedo demais.)

### 2.3 [FIXO] Secagem: ventiladores 4 s antes do Y14
`processos.h`: `_proc_simples(..., liga_wait_ms=2000)`; a secagem passa `4000`.
Y5 (ventiladores) liga e espera 4 s antes de mover o carrinho (Y14). Os outros
processos seguem com 2 s.

### 2.4 [FIXO] Pausa/retoma do ciclo automático
Bug: ao retomar, o giro/carrinho usavam **tempo absoluto (`millis()`)**; o tempo de
pausa entrava na conta e o giro "estourava" (dava `fine-home FALHOU`/erro).
Correção: `auto_pausar()` grava `_pausa_ini`; `auto_retomar()` chama
`processos_shift_timers(delta)` que **soma o tempo de pausa em todos os cronômetros**
dos processos (`_pt`, `_giro_t0`, rampas, `_fh_t`, carrinho), então continua do ponto.

### 2.5 [FIXO] Botão LIMPAR ERRO
`maquina_estados.h`: `auto_limpar_erro()` (só age se houver alarme / AUTO_ERRO —
não aborta ciclo normal). Botão vermelho no topo-direita da tela auto (`tela_auto.h`).
Antes, qualquer erro exigia resetar a máquina.

### 2.6 [FIXO] Persistência de modelos/velocidades na NVS
Antes `g_modelos`/`g_velocidades` eram só RAM (resetavam ao desligar). Agora:
`nvs_manager.h` salva/carrega como blob (`modelos`, `velocid`); salva ao editar
(tela modelos) / ao sair (tela velocidades); carrega no boot (`display.ino`).

### 2.7 [FIXO] Gate do painel corrigido (remoto/X1 não funcionavam)
A recuperação bloqueava a leitura do painel físico (X3 manual/auto, X1/X2/X5/X6
modelos) — como a máquina ficava presa em recuperação, o remoto/X1 morriam. Removido
o `!recuperacao_ativa()` do bloco do painel em `display.ino` (o `auto_tick` continua
barrado durante a recuperação, então segue seguro).

### 2.8 [FIXO] Carro sai (X15) no meio do processo → aborta + HOME
`maquina_estados.h` (AUTO_PROCESSO): se o X15 ficar ausente por **500 ms** (debounce,
pois o X15 é instável) → `desligar_tudo()` + `processos_reset()` + `home_iniciar()`.

### 2.9 [PARCIAL] Rampa de desaceleração do HOME (X11)
- Problema inicial: a rampa "pulava direto pra 5 Hz" — **pulso velho do X11 no latch**
  disparava a rampa cedo demais (mesma classe do X17). Fix: `modbus_refresh_io2_di()`
  antes do laço do HOME (consome latch antigo). Depois disso a rampa passou a disparar
  no X11 **real** (perto do home).
- **Pendente:** como o X11 está **fisicamente perto do home**, a rampa (1,5 s =
  `HOME_DESAC_MS`) é **cortada no meio** (pouco caminho X11→home) e o braço chega
  ainda rápido. Decisão a tomar: **reduzir `HOME_DESAC_MS`** (ex.: ~500 ms) pra a
  rampa caber no trecho e o braço chegar nos 5 Hz; ou disparar a desaceleração antes
  do X11. Medir a janela real com o log `[RAMPA-HOME]`.

---

## 3. Itens TEMPORÁRIOS (remover quando o tuning terminar)
- **Heartbeat `[DBG]`** no loop do `display.ino` (imprime io2/X15/X16/X17/X12/rec/auto
  a cada 1 s) — ótimo pra diagnóstico, remover no fim.
- **Logs `[RAMPA]`** (giro, `processos.h`) e **`[RAMPA-HOME]`** (home, `comm_espnow.h`).
- **Painel de tuning GIRO/TIMEOUT** na tela auto (`tela_auto.h`) + globais
  `g_giro_dur_ms`/`g_giro_timeout_ms` + chaves NVS `giro_dur`/`giro_to` — fixar os
  valores achados como `#define` e remover.
- Migrações únicas na NVS (senha 1111, giro 7500) já cumpriram o papel.

## 4. Pendências / observações
- **X15 instável:** lê 0/1/ativo sem carro; causou `ERRO: Carro fora da posicao` e
  recuperação em Fase 1 indevida. Verificar sensor/fiação do X15 (hardware).
- **`HOME_DESAC_MS`** a ajustar (ver 2.9).
- **USB instável:** as duas placas (display COM6 CH343 / waveshare2 COM10) **não
  coexistem** de forma confiável na USB do PC — uma derruba a outra, causando falhas
  de gravação/monitor. Recomendação: alimentar a waveshare2 por **carregador/power
  bank** e deixar só o display na USB do PC.

## 5. Arquivos alterados nesta leva
- `display/processos.h` — X17 (latch, sem refresh duplo); pausa (shift timers);
  secagem 4 s; log `[RAMPA]` (temp).
- `display/maquina_estados.h` — recuperação/auto-home; `auto_limpar_erro`;
  X15-abort→home no AUTO_PROCESSO; pausa (`_pausa_ini`, shift).
- `display/comm_espnow.h` — timeout X12 (50 s); `home_reset()`; rampa HOME
  (limpa latch X11 + log `[RAMPA-HOME]` temp).
- `display/nvs_manager.h` — senha_cfg 1111; giro_dur/giro_to; modelos/velocidades.
- `display/tela_auto.h` — botão LIMPAR ERRO; painel tuning GIRO/TIMEOUT (temp).
- `display/tela_modelos.h`, `display/tela_velocidades.h` — salvar na NVS.
- `display/display.ino` — carga NVS no boot; recuperação no loop; gate do painel;
  heartbeat `[DBG]` (temp).

## 6. Como gravar (WSL → Windows arduino-cli, display COM6)
```
arduino-cli.exe compile --upload -p COM6 \
  --fqbn 'esp32:esp32:esp32s3:CDCOnBoot=default,FlashMode=qio,FlashSize=16M,PartitionScheme=default_8MB,PSRAM=opi,CPUFreq=240' \
  'C:\Users\giova\Documents\Arduino\lava car now\display'
```
Monitor serial confiável: PowerShell `System.IO.Ports.SerialPort` a 115200 (o
`arduino-cli monitor` não grava em arquivo neste ambiente).
