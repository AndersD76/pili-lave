# Regras de retomada do ciclo — RASCUNHO v1 (2026-11-02)

Objetivo (Giovani): **nunca perder uma lavagem**. Depois de um reinício ou queda de energia no meio do ciclo, a máquina descobre onde estava pelo que **gravou** + pelo que os **sensores confirmam**, e continua. Quando os sensores não confirmam, ela **não adivinha**.

**Status: especificação. Nada disto está programado.** Falta o Giovani revisar e responder as pendências da seção 7. Depois vêm: Fase 0 (diário das etapas e das ocorrências, sem mexer no movimento), Fase 1/2 (retomada), cada passo com teste de bancada em modo SECO.

## 1. Geometria e sentidos (figura do Giovani + código)

- **Sentido A = anti-horário. Sentido B = horário.** Deslocamento: **X12 = fim de curso sentido B (trás)**, **X13 = fim de curso sentido A (frente)**. **Y14 = contator do deslocamento**, **Y4 = contator do giro** (trava Y4↔Y14: nunca os dois).
- **Posição 1 do braço = X16 + X17 juntos** (HOME do braço). A leitura da **posição 2 pelo X17 foi retirada** das regras até ser corrigida (pendência P1): enquanto isso a posição 2 só é conhecida pela memória gravada, não por sensor.
- **Giro normal** (pré-lavagem, espuma A, etc.): sempre sentido A, na ida (1→2) e na volta (2→1).
- **Giro triplo da Alta Pressão** (código + confirmado pelo Giovani para a ida): **ida, com o carrinho no X12: 1→2 em A, 2→1 em B, 1→2 em A.** A volta usa a mesma sequência de sentidos (A, B, A), começando na posição 2: **confirmado pelo Giovani (2026-11-02): depois que volta ao X10, faz o giro triplo.**
- Consequência para a retirada: o sentido **não é fixo**. A retirada rumo à posição 1 usa o sentido que **encurta o caminho até a posição 1**: giro que **vai** ao 1 → continua no mesmo sentido; giro que **sai** do 1 → sentido oposto (refaz o caminho já varrido). O checkpoint grava, **antes de cada giro começar**, qual giro é, de onde para onde e em que sentido.

## 2. Sensores usados (placa)

| Sensor | Placa | Significado |
|---|---|---|
| X0 | W1 | pulsos do deslocamento (indutivo) |
| X7, X11 | W1, W2 | posições intermediárias do giro |
| X10 | W2 | carro sob a mesa (vertical) |
| X12 / X13 | W2 | fim de curso trás (B) / frente (A) |
| X14 / X15 | **W2** | carro entrando / carro na posição de lavagem |
| X16, X17 | W2 | HOME do braço (X16 dedicado; X17 posições do giro) |

Obs. do Giovani: **X14 e X15 estão na W2**, então a máquina precisa saber se alguém saiu ou entrou durante a interrupção (regra G9).

## 3. Regras gerais (contra-provas)

- **G1 — Estabilidade de 1500 ms.** Qualquer leitura usada para decidir (reinício, retomada, HOME, X10, X13) precisa ficar **constante por 1500 ms**. Evita falso registro logo depois do boot.
- **G2 — Retomar exige carro; HOME exige carro ausente.** Retomada: **X15 lendo carro, estável 1500 ms**. HOME: X15 **sem carro**, estável 1500 ms, depois faz o HOME (regra que já existe).
- **G3 — X10 é pré-requisito.** Em toda etapa com carro (exceto o modo SECO, X10 simulado) o **X10 lê o carro antes de começar cada processo** e continua lendo. Girar, terminar o giro e **perder o X10 não significa que saiu do carro**.
- **G4 — Só sai do X10 andando.** Perder o X10 só vale se o carrinho **andou pelo menos 3 s** (Y14 ligado, X0 pulsando). Se saiu antes: **parar e esperar o X10 voltar** (1500 ms); voltou, continua o ciclo.
- **G5 — X10 sumiu sem deslocamento (sem 3 s de Y14).** Pausar o movimento e esperar 1500 ms. Voltou: continua. Não voltou: conferir a comunicação (W2 viva? leitura atualizada?); comunicação boa e X10 ausente: **ERRO** (confirmado em 2026-11-02). "Erro" = o `auto_erro` padrão: para, evento de falha para a nuvem (o backend cancela e **estorna** a lavagem do app) e HOME pelo painel. **Reiniciar a placa não é a resposta** (decisão do Giovani: dar erro).
- **G6 — X13 só com X10 ausente.** X13 com X10 ainda lido é contradição: parar, esperar 1500 ms; persistiu: erro. X13 sem X10: coerente; começa a voltar (sentido B) até reencontrar o X10 e continua a rotina.
- **G7 — Carrinho parado na frente sem ver o X10 (após reinício):** esperar 1500 ms. X10 não voltou: voltar para trás (sentido B) até rever o X10 e continuar o ciclo. Chegou ao **X12 sem rever o X10: erro, aborta a lavagem** (cancela e estorna).
- **G8 — Giro interrompido: voltar sempre à posição 1.** Ir a **X16 + X17** em **5 Hz** (evita passar do ponto) no sentido da seção 1, e só então recomeçar o giro e o ciclo. No giro normal e no triplo da **ida**.
- **G8b — Exceção: giro triplo da VOLTA interrompido** (confirmado pelo Giovani em 2026-11-02): vai à posição 1 a 5 Hz e, em X16 + X17, **segue com o carrinho em sentido B até o X12 sem repetir o triplo**.
- **G9 — Retomada depois de falta de energia.** No máximo **5 minutos** sem energia (decisão do Giovani, 2026-11-02; vale para o texto das placas, seção 8). Se a **W2 ficou viva** durante a interrupção, ela informa se o **X15 ou o X14 mudaram**; qualquer saída ou entrada de carro cancela a retomada. Se nenhuma das duas placas tinha energia, vale o limite de 5 min + X15 estável 1500 ms (possível melhoria: conferir a placa lida pela câmera).
- **G10 — Delta parado.** Antes de religar qualquer saída, conferir que o Delta está em 0 Hz (leitura Modbus). Pré-requisito: o parâmetro de perda de comunicação do Delta.
- **G11 — Alta Pressão (Y13) só liga** com o braço confirmado no lugar e o X10 lendo o carro.
- **G12 — Máximo de retomadas por lavagem: 2** (confirmado pelo Giovani em 2026-11-02). Passou disso: cancela e estorna. O limite de 30 min do ciclo (CICLO_MAX_MS) **continua contando** o tempo total.
- **G13 — Ocorrência fora do previsto = aprendizado (item 9 do Giovani).** Se qualquer conferência falhar de um jeito que as regras não preveem: a máquina **para, faz o HOME confirmado e cancela/estorna** (comportamento seguro de hoje) e **grava um retrato completo** (todos os sensores W1/W2, etapa e giro gravados, saídas ligadas, frequência, tempos) que sobe para a nuvem como evento de **ocorrência**. Depois analisamos cada ocorrência real e criamos a regra para ela.
- **G15 — Depois de EMERGÊNCIA a retomada pede toque no display** (confirmado em 2026-11-02, P2). Reinício só da W1 com energia mantida pode retomar sozinho; falta de energia da rede (até 5 min) também (G9).
- **G14 — Aviso.** Cada retomada, cancelamento ou ocorrência avisa o lavador e o admin no celular.

## 4. Tabela de pontos de interrupção (rascunho)

| Onde parou (gravado) | O que os sensores precisam mostrar | Ao religar |
|---|---|---|
| Etapa só com saídas (espuma, cera...) com carrinho parado | X15 e X10 com carro (1500 ms) | recomeça a etapa (Fase 1) |
| **Giro 1→2** (normal ou triplo), carrinho no X12 | X12, X10, X15 com carro | G8: voltar à posição 1 em B (5 Hz), recomeçar o giro |
| **Giro 2→1 do triplo (ida)**, sentido B | idem | continuar em B até X16+X17 (5 Hz), recomeçar o giro seguinte |
| Giro terminou na **posição 2**, carrinho **parado**, andou **< 3 s** | X10 lendo carro | seguir **para frente** até sair do X10 (≥ 3 s, G4) e continuar o processo |
| **Carrinho andando para frente**, X10 já perdido (≥ 3 s) ou parado na frente | X15 com carro | G7: esperar 1500 ms; voltar (B) até o X10 e continuar |
| **Giro triplo da volta** (depois de voltar ao X10) | X10 lendo | G8b: ir à posição 1 a 5 Hz e seguir o carrinho em B até o X12, **sem repetir o triplo** |
| **Giro 2→1 normal** (depois de voltar ao X10) | X10 lendo | G8: continuar até X16 + X17 a 5 Hz, e então o carrinho volta ao X12 |
| Na **posição 1**, giro terminado, lendo X10 | X10, X16+X17 | seguir o processo (retorno do carrinho) até o **X12** |
| Retorno final em andamento | X10 / X12 | seguir até o X12 |
| Qualquer outro / sensor incoerente | — | G13: ocorrência + HOME + cancela/estorna |

## 5. Parâmetros

| Parâmetro | Valor |
|---|---|
| Estabilidade das leituras | 1500 ms |
| Deslocamento mínimo para aceitar "saiu do X10" | 3 s |
| Velocidade na retirada do giro | 5 Hz |
| Tempo máximo sem energia para retomar | **5 min** |
| Máximo de retomadas por lavagem | 2 (proposta) |

## 6. Plano

> **Fase 0: implementada e compilada em 2026-11-02 (não gravada)**: retrato da etapa, ocorrências O1..O5 e diário X14/X15 da W2. Ver `testes/PENDENCIAS_NA_MAQUINA.md` seção L.3.

1. **Fase 0 (segura):** diário das etapas (checkpoint) **e** de ocorrências, enviados à nuvem junto do registro de reinícios. Não muda o movimento. Mostra onde as interrupções acontecem.
2. **Fase 1:** G2 + G3 + G4 + G5 + G6 como regras de **proteção** do ciclo normal (valem mesmo sem reinício) e retomada recomeçando a etapa.
3. **Fase 2:** retomada no meio do movimento, por etapa, cada uma **desligada por padrão** até testada na máquina em modo SECO.

## 7. Pendências

Todas as perguntas do rascunho foram respondidas em 2026-11-02 (P2 toque após emergência, P3 máx. 2 retomadas, P4 = erro padrão, P5 volta do triplo A, B, A e G8b, P6 diário da W2 para X14/X15: **sim**).

- **P1 (do Giovani)** Leitura da posição 2 sem X17: o Giovani corrige depois. Até lá a posição 2 só vale pela memória gravada.
- **Diário do X14/X15 na W2 (P6):** a W2 anota toda mudança do X14/X15 enquanto a W1 está fora; na retomada a W1 pergunta; qualquer saída/entrada de carro cancela a retomada.

## 8. Texto para as placas de instrução (enviar ao Claude web das placas)

> **Faltou energia durante a lavagem?** Não saia da posição e não retire o veículo. A máquina se restabelece sozinha, em até **5 minutos**, e continua a lavagem do ponto em que parou. Mantenha-se **fora da área de movimento** do braço: ao voltar a energia, a máquina pode se mover sem aviso. Se passar de 5 minutos, a lavagem é cancelada e o valor devolvido ao seu saldo no app.
