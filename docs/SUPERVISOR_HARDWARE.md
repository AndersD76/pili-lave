# Supervisor de hardware e emergência independente da comunicação

Projeto (proposta). O firmware já tem watchdogs de software (tarefa, envio de rádio, W2 muda, estados parados, ciclo longo, memória, Delta mudo). Esta proposta cobre o que software não alcança: o chip travar por completo com a máquina energizada.

## 1. Emergência — já resolvida por fiação (confirmado pelo Giovani, 2026-11-01)

O botão de emergência **desenergiza a fonte e os contatores**: tudo cai, sem passar por ESP32, rádio ou RS-485. Não há nada a construir.

Arquitetura elétrica atual (importante para o resto):
- **Não existe contator geral de potência.** Disjuntores energizam os inversores e as placas ESP32.
- As saídas das placas Waveshare acionam **relés de borne**, que acionam as **contatoras de cada etapa** do processo.
- Consequência da emergência: as placas também perdem energia (tela apagada, nada reportado à nuvem; o backend só vê a máquina sumir). Ao soltar a emergência tudo religa e a W1 faz a **recuperação de boot** (ver seção 3).

## 2. Supervisor externo do ESP32 (watchdog de hardware) — a construir

Cobre o travamento do chip com a máquina energizada (o caso da câmera em 2026-10-06 e uma W1 travada com uma saída ligada).

- CI supervisor tipo TPL5010 / MAX705 / STWD100 alimentado direto da fonte.
- A W1 inverte o nível do pino **IO1** (borne do conector de expansão = GPIO1) enquanto o laço principal gira. Sem transição por ~10 s o supervisor age.
- Como não há contator geral, a ação do supervisor é **cortar a alimentação da própria Waveshare** (MOSFET/relé pequeno na entrada de energia da placa): sem energia, as saídas caem (relés de borne desligam, contatoras caem) e a placa reinicia no religamento. Pendente definir: se a W2 e a câmera entram no mesmo corte, e como a emergência se combina com esse corte.
- O firmware já está pronto do lado da W1 (pulso em IO1).

### Mapa do conector de expansão da Waveshare (W1)

| Borne | GPIO | Uso |
|---|---|---|
| SDA / SCL | 42 / 41 | I2C (relés PCA9554, relógio) — não usar |
| TXD / RXD | 43 / 44 | reservados ao cabo W1↔W2 (projeto `LINK_W1_W2_UART.md`) |
| IO0 | 0 | BOOT (strapping): evitar |
| **IO1** | **1** | **livre — pulso de vida** |

### Teste de bancada do pulso (pendente, na ida à máquina)

O nível de IO1 inverte a cada **3 s** (`VIDA_MEIO_PERIODO_MS`, em controle.h; fica lento de propósito para o multímetro acompanhar; no produto final pode cair para ~1 s). Medir entre IO1 e GND: o multímetro em VDC alterna ~0 V ↔ ~3,3 V, ou um LED com resistor de 330 Ω pisca. Valida que o borne IO1 é de fato o GPIO1 (a documentação da Waveshare não confirma o mapeamento dos bornes). O pino sobe e desce com a máquina parada ou em ciclo, sem depender de HOME. Se ficar parado: a W1 travou ou o borne não é o GPIO1.

## 3. HOME obrigatório pelo botão depois de energizar (feito no firmware, compilado, NÃO gravado)

Antes: ao religar fora do zero, a recuperação de boot iniciava o HOME sozinha assim que o X15 estava livre.
Agora: a W1 zera as saídas e **fica parada** (vermelho piscando + mensagem "Religou fora do zero: toque em HOME no display" ou, com carro no X15, "retire o veiculo e toque em HOME") até alguém tocar no **HOME do display**. Só então roda o HOME, com até 3 tentativas seguidas (depois desiste e vira ERRO). Carro reentrando (X15) cancela o pedido e exige tocar de novo. Enquanto espera, o app não inicia ciclos (a recuperação segue ativa). Se a máquina religa **já no zero** (X16 + carrinho recuado), nada é exigido.

## 4. O que ainda falta para fechar o supervisor

- Esquema/foto do quadro: onde entra a alimentação da Waveshare W1 (e W2) para o corte.
- Escolha do CI e do estágio de corte (MOSFET ou relé), e como a emergência e o supervisor se combinam.
- Montagem e validação por pessoa habilitada, com a máquina parada.

## 5. Referência: o watchdog da placa do carrinho rebocador (PCI_PILI_REBOCADOR V-1.0.0)

O esquema (folha 2, "Circuito Watch Dog") já usa a arquitetura que serve aqui: **TPL5010** (DONE recebe o pulso do GPIO2 do ESP32 por 1 kΩ, com pull-down de 10 kΩ) → **RSTN** → **BC857** (PNP) → **FDS8858CZ** (MOSFET no lado positivo) que liga e desliga a alimentação `3V3_ESP`. Sem pulso, o ESP32 fica sem energia por um instante e religa. O receptor gera HIGH parado + pulso LOW de 50 ms a cada 1 s. `WDT_EN` está no conector de gravação (provavelmente para desligar o watchdog ao gravar; confirmar). Obs.: o TPL5010 aceita o DONE depois do aviso do pino WAKE, que no esquema parece sem ligação; conferir no datasheet antes de copiar.

## 6. Desenho previsto para a W1 (opção escolhida para estudar: cortar a energia da Waveshare) — PENDENTE

A Waveshare recebe 7 a 36 V no borne e gera o 3,3 V internamente, então o MOSFET de 3,3 V do carrinho não serve; o corte é na entrada de energia.

- Mini-fonte de 3,3 V alimentada **antes** do corte (o TPL5010 não pode se desligar junto).
- TPL5010: DONE ← pulso do IO1 da W1; RSTN sai baixo por ~20 ms.
- **Esticador de pulso** (transistor + RC ou temporizador) leva isso a ~2 s de bobina energizada.
- **Relé de baixa corrente com contato normalmente fechado** na entrada da W1: se o supervisor falhar a W1 continua ligada (custo: a falha passa sem aviso; prever LED). Alternativa: MOSFET de potência.
- Chave (ou WDT_EN) para desligar a vigilância na gravação; fusível/TVS na entrada como na placa do carrinho.
- Depois do corte a W1 religa e, se estiver fora do zero, espera o HOME pelo display (seção 3).
- No firmware, trocar o pulso do IO1 (hoje nível invertendo a cada 3 s, para o teste de bancada) pelo formato do receptor (HIGH parado, pulso LOW de 50 ms) **sem `delay`**, com intervalo casado ao resistor do TPL5010.

**Pré-requisito do Delta:** cortar a W1 derruba as saídas dela, mas o inversor segue com o último comando do RS-485. Configurar o Delta MS300 para parar na perda de comunicação Modbus (parâmetros de tempo limite e de tratamento da falha de comunicação, em princípio do grupo 09; confirmar no manual). Vale com ou sem supervisor.

Ainda falta: tensão de alimentação da W1; de onde sai a energia dela (e se W2/câmera dividem a fonte); valor do resistor de intervalo do TPL5010 da placa do carrinho; posição do EN/RESET na Waveshare (alternativa: só resetar o ESP32, sem corte; as saídas ficam 1 a 2 s como estavam até o boot zerá-las).
