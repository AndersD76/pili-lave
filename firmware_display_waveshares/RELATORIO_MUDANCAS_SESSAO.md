# Relatório de Mudanças — Lava Car Now (sessão 21–25/08/2026)

Lista completa e atualizada de **todas as alterações de firmware** feitas nesta sessão,
tanto na versão **anterior (`lava car now`)** quanto na **cópia (`lava car now 2`)**.

- **`lava car now`** = versão ANTERIOR / BACKUP (só foi **gravada**, não recebeu edições novas nesta sessão além do build pendente de 21/08).
- **`lava car now 2`** = CÓPIA onde foram feitas TODAS as edições novas. É a versão de produção atual.
- Arquivo do inversor (`vfd_rs485.h`) e o driver do painel (`lvgl_v8_port.*`, `esp_panel_board_custom_conf.h`) **não foram alterados** em nenhuma das duas.

---

## A) Versão ANTERIOR (`lava car now`) — build pendente de 21/08 que foi GRAVADO

Esse código já existia na fonte (de sessão anterior) e nesta sessão foi **compilado e gravado** no display:

1. **Watchdog do X0: 2000 → 4000 ms** (`CARRO_WD_MS`, `processos.h`).
   Corrige o falso "CARRO TRAVADO" no avanço (o X0 pulsa espaçado; 2 s era apertado).
2. **`[DBG]` heartbeat novo** (`display.ino`) — linha de debug a cada 1 s:
   `X10 X0 | Y4 Y14 vfd | X15 X16 X17 X12 | rec auto`.

> Observação: essa é a base. Todas as mudanças da seção **B** partem daqui e estão só na `lava car now 2`.

---

## B) Mudanças NOVAS (todas na `lava car now 2`)

### 1. Watchdog do X0 no RETORNO até X12 — `processos.h`
- Antes: só o **avanço** (`carr_fwd`) vigiava o X0. O **retorno** (`carr_rev_x12`) não.
- Agora: `carr_rev_x12_tick` faz oversample do X0 (lê a io1 5×/tick) enquanto anda até o X12.
  Se o X0 **não pulsar por `CARRO_WD_MS` (4000 ms)** → para e retorna `SUB_ERR` = "CARRO TRAVADO".
- Só roda na fase de movimento (fase 0); na parada final (rampa 1 s) o X0 não pulsa e o watchdog não roda.
- Tratado nos 3 processos que usam o retorno: **PL_RET, AP_RET, SP_REV**.
- Vars novas: `_cx_t_pulso`, `_cx_x0_ant`.

### 2. HOME até X12 — 3 condições de parada — `comm_espnow.h`
Na fase de recuo do HOME (`HOME_FASE_DESLOC`), além do X12, agora para também por:
- **Painel:** se **X3** (`io1_get_di(4)`) OU **X4** (`io1_get_di(5)`) → "HOME interrompido pelo painel".
- **X0 travado:** se o X0 não pulsar por **`HOME_X0_WD_MS` (4000 ms)** → "HOME FALHOU: carro travado (X0)".
- (X12 continua sendo o sucesso; o timeout de 50 s continua como failsafe.)
- Vars/define novos: `HOME_X0_WD_MS`, `g_home_x0_t`, `g_home_x0_ant`.

### 3. Espera X15 → início do ciclo: 4 s → 6 s — `maquina_estados.h`
- Em `AUTO_INICIANDO`: `if (agora - t_estado >= 6000)` (era 4000). Mais tempo de luz vermelha antes de começar.

### 4. Avanço após perder o X10: 1,5 s → 1 s — `processos.h`
- `1500 → 1000` ms em: **pré-lavagem/enxágue (PL_FWD)**, **alta pressão (AP_FWD)**, **espuma A**, **espuma B**, **cor mágica**, **cera**.
- **Secagem mantém 2500 ms** (a pedido).

### 5. Pisca da lâmpada 4× mais lento — `maquina_estados.h`
- `rec_lamp_fase1` (vermelho): **250 → 1000 ms**.
- `rec_lamp_fase2` (verde/vermelho alternando): **1000 → 4000 ms**.
- (Usado na recuperação de energia no boot.)

### 6. Nova saída Y0 (junto com a Cor Mágica) — `maquina_estados.h`, `processos.h`, `tela_manual.h`
- `#define SET_Y0(v) io2_set_do(6, v)` → **DO6 da waveshare2** (DO5/Y15 é bloqueado por firmware; DO6/7/8 livres).
- Aciona **junto com a Cor Mágica** no **automático** (`tick_cor_magica`) **e no manual** (`cb_toggle_cor_magica`).
- Zerado no `desligar_tudo()` (emergência/erro/boot).
- **Waveshare2 NÃO precisou mudar** — o `escreve_do` já aceita o DO6. (Precisa do relé físico no DO6.)

### 7. Debounce de 150 ms na PERDA do X10 no avanço — `processos.h`
- Antes: 1 leitura fantasma de X10=0 já encerrava o avanço ("andou pouco").
- Agora: o X10 precisa ficar em **0 por `X10_FWD_LOST_MS` (150 ms)** seguidos p/ valer "perdeu X10"; se voltar antes, reseta (fantasma).
- Var nova: `_cf_t_x10_lost`.

### (Já existia — verificado, sem mudança)
- **Ventiladores (Y5) 4 s antes de mover o carrinho** na secagem (`tick_secagem` já usa `liga_wait_ms=4000`).
- **Debounce do X10 ATIVO no retorno** (`carr_rev_x10`, `X10_CONST_MS=300`).
- **Debounce do X15** (500 ms) na entrada.

---

## C) Arquivos alterados (na `lava car now 2`)

| Arquivo | Itens |
|---|---|
| `processos.h` | 1 (watchdog X0 retorno), 4 (avanço 1 s), 6 (Y0 auto), 7 (debounce X10) |
| `comm_espnow.h` | 2 (HOME X12/X0/painel) |
| `maquina_estados.h` | 3 (X15→6 s), 5 (pisca 4× lento), 6 (define SET_Y0 + desligar_tudo) |
| `tela_manual.h` | 6 (Y0 no manual) |

Inalterados: `vfd_rs485.h`, `tipos.h`, `nvs_manager.h`, telas (exceto `tela_manual.h`), `lvgl_v8_port.*`, `esp_panel_board_custom_conf.h`, `waveshare1.ino`, `waveshare2.ino`.

---

## D) Estado atual (o que está GRAVADO nas placas)

- **Display (COM15, via FTDI/UART0):** `lava car now 2` completa — **A + B (itens 1 a 7)**. Gravado e verificado.
- **Waveshare2 (COM10, USB nativo):** firmware atual (aceita o DO6). Gravado.
- **Waveshare1:** sem alterações nesta sessão.
- Backup intacto em `lava car now`.

Método de gravação do display (CH343 nativa morta): FTDI externo no UART0, boot manual (BOOT+RST),
`python -m esptool ... --no-stub --flash-mode keep` + `PYTHONIOENCODING=utf-8`.

---

## E) Pendências

1. **Fonte de 5 V firme (≥1–2 A)** — no conversor fraco a tela apaga (o firmware roda igual; confirmado que acende no USB-C). Backlight puxa ~0,5–1 A.
2. **Relé físico no DO6** — pro Y0 acionar o dispositivo final.
3. **HOME "não gira" era HARDWARE** (contator Y4 / motor do giro) — o inversor é o mesmo do deslocamento (que funciona), firmware inocente (o antigo também não girava). Usuário localizou.
4. Itens de debug ainda no firmware (remover quando finalizar): `[DBG]`, `[RAMPA]`, `[RAMPA-HOME]`, painel de tuning GIRO/TIMEOUT na tela AUTO.

---

## F) Testes confirmados nesta sessão

- ✅ X0 pulsando perfeito no avanço, sem falso "CARRO TRAVADO".
- ✅ Ciclo completo: giro 1→2 → avanço → volta → giro 2→1 com home.
- ✅ Avanço com o debounce de 150 ms no X10 — "ficou muito bom" (não corta mais curto).
- ⏳ Y0/DO6 — a validar com o relé físico.

---

## G) Lógica do giro 2→1 com fine-homing (X11 / X16 / X17 / X7) — JÁ EXISTENTE (contexto)

> ⚠️ **Não é mudança desta sessão** — já estava no código (sessão anterior, descrita no
> `INSTRUCAO_ATUALIZACAO_21_08.md`). Documentada aqui porque é a referência do braço no giro 2→1.
> Fica em `processos.h` (`giro_tick`).

O giro 2→1 tem **duas fases**:

**Fase 1 — `GIRO_FASE_GIRO` (giro normal):** o braço gira anti-horário (REV) da posição 2 para a 1.
Durante o giro, ele **memoriza os sensores por onde passou**, na ordem anti-horária
**X11 → X16 → X17 → X7**:
- `_giro_viu_x11` — viu o intermediário **X11** (AQUÉM do home)
- `_giro_viu_x16` — viu o sensor dedicado do home (**X16**)
- `_giro_saiu_x16` — viu o X16 e **SAIU** dele (passou do home)
- `_giro_viu_x7` — chegou no **X7** (ALÉM do home, passou com folga)

**Fase 2 — `GIRO_FASE_HOME` (fine-homing, ajuste fino em pulsos):** decide o sentido para
encostar exatamente no home, usando a memória acima:
- **PASSOU do home** (`_giro_saiu_x16` OU `_giro_viu_x7`) → volta **HORÁRIO** (fwd) para retornar.
- **AQUÉM do home** (viu X11 mas não chegou) → segue **ANTI-HORÁRIO** (rev) para avançar.
- Se o sentido escolhido estiver **errado** (perde tudo: `!X17 && !home`, ou estoura o orçamento
  de pulsos) → **inverte o sentido** (log `fine-home inverte sentido`).
- **Termina** quando **X17 + HOME (X16) juntos** → log `fine-home OK`.

Resumo: **X11 = referência "aquém" (antes do home)** e **X7 = referência "além" (passou do home)**;
o X16 é o home dedicado e o X17 confirma. Com isso o braço sabe para que lado corrigir no 2→1.

Logs úteis: `[GIRO] fine-home: PASSOU (saiu X16 / chegou X7) -> horario`,
`[GIRO] fine-home: AQUEM (viu_x11=..) -> anti-horario`, `[GIRO] fine-home inverte sentido`,
`[GIRO] fine-home OK (X17+HOME)`.
