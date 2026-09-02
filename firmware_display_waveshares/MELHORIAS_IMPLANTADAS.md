# Melhorias Implantadas — Lavadora Pili (display / ESP32-S3)

Documento de registro das alterações de firmware feitas nesta rodada de ajustes.
Foco: `display/processos.h`, `display/maquina_estados.h`, `display/comm_espnow.h`,
`display/nvs_manager.h`, `display/tela_auto.h` e `display/display.ino`.

> Legenda: **[FIXO]** = melhoria definitiva · **[TEMPORARIO]** = recurso de ajuste/tuning
> que deve ser removido/consolidado quando o valor final for encontrado.

---

## 1. [FIXO] Correção do X10 "fantasma" no retorno do carrinho

**Sintoma:** na Pré-Lavagem, Espuma A e Alta Pressão (todas usam a sub-máquina
`carr_rev_x10`), o carrinho retornava e o giro seguinte começava cedo demais, com o
carrinho ainda longe do sensor X10. Causa: o indutivo X10 sofria interferência
(água do jato) e gerava pulsos falsos de "ativo" que o código aceitava como chegada.

**Correção (`carr_rev_x10_iniciar` / `carr_rev_x10_tick`):**
- Exige ver o carrinho **sair da zona** do X10 antes de aceitar qualquer chegada
  (`_cr_saiu`) — elimina leitura residual no início do movimento.
- Depois disso, exige o sinal **constante por 300 ms** (`X10_CONST_MS`) antes de
  validar. Se cair antes, o cronômetro zera e recomeça.

Vale para os três processos automaticamente (sub-máquina compartilhada).

---

## 2. [FIXO] Cor Mágica agora liga o Y7

**Sintoma:** ao rodar a Cor Mágica, o Y1 (solenoide do produto) ligava, mas o Y7
(bomba de espuma de cima) não — processo sem vazão de água efetiva.

**Correção (`tick_cor_magica` / `_off_cm`):** liga **Y7 junto com Y1** no início e
desliga os dois juntos no fim.

---

## 3. [FIXO] Validação de HOME movida para o fim da entrada de carros

Antes cada processo revalidava o HOME no seu passo 0 (`PL_HOME`, `AP_HOME`,
`SP_HOME`). Essas checagens foram **desativadas (comentadas)** — a validação de HOME
passou a ser **única, no fim da entrada de carros** (`AUTO_INICIANDO` em
`maquina_estados.h`): estando em HOME no início, valida uma vez e segue por todo o
modelo escolhido.

> As três checagens ficaram como comentário no código, prontas para reabilitar.

---

## 4. [FIXO] Alta Pressão: espera inicial de 5000 ms

Adicionados os estados `AP_INI` / `AP_WAIT` no início do processo Alta Pressão: ao
entrar, ele **aguarda 5000 ms** antes de começar (HOME → bomba Y13 → giros).

---

## 5. [FIXO] Senha de configuração dos processos → 1111

A `senha_cfg` (que libera a tela de Config / velocidades / modelos) passou de "1940"
para **"1111"**. Como a senha fica na NVS (e a chave já existia), foi adicionada uma
**migração única** (`nvs_manager.h`) que força 1111 uma vez neste reflash, sem
sobrescrever alterações futuras feitas pela tela "Alterar Senhas".

---

## 6. [FIXO] Reescrita do critério de parada do giro (X17 + HOME + fine-homing)

Esta foi a maior mudança. Histórico resumido:
1. O X17 sofria repique (interferência da água), parando o braço fora de posição.
2. Testamos parada **por tempo fixo**, mas malha aberta não posiciona no home (o
   braço passa pelo home em alta velocidade; a rampa satura o ajuste fino).
3. Solução final: **parada por sensor no lado do home + posicionamento fino em
   pulsos (fine-homing).**

### Mapa dos sensores
- `X17` = ativo na **posição 1 E 2** (extremos).
- `HOME_GIRO` (X16) = ativo **só na posição 1**.
- **Posição 1 exata = X17 e HOME juntos** (a "combinação").

### Giro 1→2 (posição 2)
Para **por tempo** (`g_giro_dur_ms`, ajustável na tela). Timeout = erro (braço travado).

### Giro 2→1 (home) — Opção A
- Parada principal = **combinação X17+HOME**, aceita só **após 6500 ms do T=0**
  (`GIRO_IGNORA_X17_MS`, retardo de leitura do X17).
- Se o **timeout** estourar sem a combinação → vai para o **fine-homing** (NÃO dá erro).
- **Memória robusta a ruído:** o braço começa na pos2 (X17 já = 1). Só depois de
  **sair da pos2** (X17 zerou) é que passa a valer ter visto X17 e X16. Se viu **os
  dois — mesmo em instantes diferentes** (um ruído pode quebrar a leitura
  simultânea) → considera que **passou** pelo home.

### Fine-homing (posicionamento fino, após cada giro 2→1)
- **Prioridade:** se achar X17+HOME a **qualquer instante (inclusive no meio de um
  pulso), para imediatamente** — não espera o pulso terminar.
- Senão, busca em **pulsos de 5 Hz por 1000 ms**, parando e deixando a inércia morrer
  (500 ms) antes de ler os sensores.
- **Sentido inicial pela memória:** passou → **horário** (volta); não passou →
  **anti-horário** (avança).
- **Inversão inteligente:** se ao pulsar ficar **sem nenhum** sensor → sentido
  errado → inverte.
- **Limite:** 5 pulsos na 1ª direção; se não achar, inverte com **10** (5 para voltar
  ao ponto inicial + 5 para explorar o outro lado); se ainda não achar → **erro na
  tela** ("home nao encontrado").

### Referência de tempo unificada
Os três parâmetros do giro 2→1 contam do **mesmo zero, T=0 (Y4 liga):**
| Parâmetro | Valor padrão | Referência |
|---|---|---|
| Retardo de leitura do X17 (combinação só para depois disso) | 6500 ms | T=0 |
| Início da rampa de desaceleração | 6000 ms | T=0 |
| Timeout (→ fine-homing no 2→1 / erro no 1→2) | 10000 ms | T=0 |

> Observação: na **Alta Pressão** o giro é triplo, então **cada** giro interno 2→1
> executa o fine-homing (opção escolhida: "cada giro 2→1"). Funciona; apenas soma
> tempo no meio da sequência. Pode ser restringido só ao giro final se desejado.

---

## 7. [TEMPORARIO] Botões de ajuste ao vivo na tela AUTO (GIRO + TIMEOUT)

Para afinar os tempos sem reflashar, a tela AUTO ganhou um painel com **duas linhas**:
- **GIRO** — ajusta `g_giro_dur_ms` (parada do 1→2 / referência). Botões
  −100/−25/−10/+10/+25/+100. Faixa 3000–14000 ms.
- **TIMEOUT** — ajusta `g_giro_timeout_ms`. Botões −500/−100/−25/+25/+100/+500.
  Faixa 5000–20000 ms.

Ambos os valores são **persistidos na NVS** (`giro_dur`, `giro_to`) e restaurados no
boot. Default: GIRO 7500 (migração forçou neste reflash), TIMEOUT 10000.

> **A remover quando os valores finais forem encontrados:** os dois painéis/botões em
> `tela_auto.h`, os callbacks/labels, os globais `g_giro_dur_ms` / `g_giro_timeout_ms`
> e as chaves de NVS — voltando a `#define` fixos. Tudo está marcado com
> `TEMPORARIO (tuning giro)` no código.

---

---

## 8. [FIXO] Timeout do X12 dobrado na rotina de HOME

A rotina de HOME (`comm_espnow.h`) tem 3 fases: GIRO (busca X16+X17), PARADA (1,5 s) e
DESLOCAMENTO (recua o carrinho até X12). O `HOME_TIMEOUT_MS` (25 s) era usado nas duas
fases; a de recuo até X12 estava dando **"HOME FALHOU: X12 nao achado"** por tempo curto.

**Correção:** criado um timeout dedicado à fase de recuo — `HOME_TIMEOUT_DESLOC_MS =
50000` (dobro). A fase de GIRO continua em 25 s.

---

## 9. [FIXO] Auto-home no retorno de energia (recuperação no boot)

**Objetivo:** ao ligar (inclusive após queda de energia), se o braço não estiver no
zero, referenciar sozinho — de forma segura, sem display para o motorista (sinalização
por lâmpada, com placa física na entrada).

**Implementação:** `maquina_estados.h` (`recuperacao_tick()`), chamada no loop antes do
`home_tick()`. Bloqueia modo auto e botões do painel enquanto está ativa.

**Fluxo:**
- No boot, quando a comunicação sobe, lê os sensores. Se **já no zero**
  (X16+X17 e carrinho no X12) → nada a fazer, boot normal.
- Se **fora do zero** → recuperação:
  - **Fase 1 (X15 com carro):** vermelho (Y12) **piscando rápido 2 Hz**; verde apagado.
    Significado (placa na entrada): "lâmpada vermelha piscando rápido = retire o veículo".
  - **Fase 2 (X15 livre):** **inicia o HOME automaticamente**; verde/vermelho
    **alternando 0,5 Hz** até concluir.
  - **Carro reentra na Fase 2:** aborta o home e volta pra Fase 1.
  - **HOME concluído:** apaga lâmpadas, libera operação normal.

**Limitações conhecidas:** (a) a fase GIRO do home é bloqueante — durante ela a lâmpada
alternada congela e a reentrada de carro não aborta até o fim dela; (b) se o home falhar
(ex.: X12), ele retenta indefinidamente.

---

## 10. [FIXO] Secagem: ventiladores 4 s antes de mover o carrinho (Y14)

Na secagem, o **Y5 (ventiladores/compressor)** liga no início e agora aguarda **4 s**
antes de mover o carrinho (Y14) — antes eram os 2 s padrão. Feito parametrizando o
`_proc_simples` com `liga_wait_ms` (padrão 2000; secagem passa 4000). Espuma A/B, Cera e
Cor Mágica seguem com 2 s.

---

## Arquivos alterados
- `display/processos.h` — X10 fantasma, Cor Mágica, HOME por processo, AP espera 5s,
  todo o giro (X17+HOME, fine-homing, tempos, memória robusta), secagem 4s.
- `display/maquina_estados.h` — validação única de HOME na entrada de carros;
  recuperação no boot (auto-home).
- `display/comm_espnow.h` — timeout do X12 no HOME dobrado (50 s); helper `home_reset()`.
- `display/nvs_manager.h` — senha_cfg 1111 (migração), chaves `giro_dur` e `giro_to`.
- `display/tela_auto.h` — painel temporário de ajuste GIRO/TIMEOUT.
- `display/display.ino` — carga de giro/timeout da NVS no boot; chamada da recuperação
  no loop e bloqueio de auto/painel enquanto ativa.

## Como gravar (WSL → Windows arduino-cli, display no COM6)
```
arduino-cli.exe compile --upload -p COM6 \
  --fqbn esp32:esp32:esp32s3:CDCOnBoot=default,FlashMode=qio,FlashSize=16M,PartitionScheme=default_8MB,PSRAM=opi,CPUFreq=240 \
  'C:\Users\giova\Documents\Arduino\lava car now\display'
```

## Diagnóstico (serial)
- `[GIRO] 1->2 tempo <ms> -> DONE`
- `[GIRO] 2->1 fim giro (viu_home=? combo=? dt=?ms) -> fine-home`
- `[GIRO] fine-home OK (X17+HOME) [imediato]`
- `[GIRO] fine-home inverte sentido`
- `[GIRO] fine-home FALHOU`
