# Pendências que precisam da máquina (testar quando o Giovani voltar lá)

Atualizado em 2026-10-22. O que está validado está em `LEIAME.md`. Aqui só o que **falta** e exige
estar na frente da máquina. Marcar `[x]` e anotar o resultado quando for feito.
Antes de começar: abrir a captura serial da W1 **em tarefa de fundo** (abrir a porta reseta a W1: a
bomba volta para OFF e o modo para SECO; configurar na tela depois de abrir).

## A. Segurança / bug reportado (prioridade)
- [x] ~~Braço bateu no carro no giro da Espuma A~~ — **RESOLVIDO / não era bug** (informado pelo Giovani em 2026-10-22):
  o teste foi feito com o botão no modo **SECO** (X10 simulado por tempo) com carro na máquina. Com carro
  de verdade usar sempre **CARRO REAL**. O giro 1→2 está funcionando bem; não mexer nele sem novo dado.
  **Regra prática: carro na máquina => CARRO REAL; SECO só sem carro.**
- [ ] Confirmar o **modo CARRO REAL** do carrinho com carro de verdade (X10 real no avanço e no retorno
  parcial, sem bater atrás). As proteções X12/X13 só valem em SECO.

- [ ] **NOVO (compilado, NAO gravado nem testado): telas de CONFIGURACAO** (AUTOMATICO > CONFIG): velocidades
  por modelo (0,5 Hz por toque), esperas dos modelos por slot (5 s; "padrao" = valor do processo), atrasos
  em CARRO REAL (espuma A/B, cor magica, secagem) e tempo do giro 1->2 por processo (0,1 s). Os valores
  moram na **NVS da W1** (namespaces `cfg` e `giro`), so mudam com a maquina parada, e os padroes sao os de
  hoje (nada muda ate alguem editar). O display pede a tabela e manda o valor absoluto a cada toque
  (mensagens 32/33/34 em `protocolo_teste.h`). Para testar (**precisa de display COM TOQUE**): gravar W1 e
  display, editar um valor de cada tela, desligar/religar a W1 e conferir que persistiu; conferir no log
  `[CFG] tabela N [i][j] = V (salvo)`; rodar um ciclo e ver se a nova velocidade/espera foi usada.
  Atencao: as velocidades das etapas 11-13 (bomba SAJ) nao aparecem na tela (SAJ esta em frequencia fixa).

## B. Ciclo completo com carro real
- [ ] Modelos 1 a 4 em CARRO REAL com bomba ON (os de bancada rodaram só o modelo 1 completo, a seco e
  molhado). Em especial: **Alta Pressão repetida 2–3 vezes** no mesmo ciclo (modelos 2 e 3; o reinício
  entre repetições nunca rodou), **Cera d'água com Y0 ligado durante toda a espera** (5 s no 2/3,
  **4 min no 4**: confirmar que é isso mesmo), e a pausa da **Secagem** (15 s nos modelos 2/3; 10 s
  padrão no 4, valor não informado pelo cliente).
- [ ] Esperas reais por etapa (45 s depois de Espuma A e Cor Mágica, etc.): conferir se o ciclo bate com o
  que o cliente espera.
- [ ] PAUSAR/CONTINUAR no meio de cada tipo de processo (só foi testado na Alta Pressão e na seco):
  a bomba/espuma volta 2 s antes de retomar o movimento.

## C. Hardware / medições
- [ ] **Instalar o filtro do RS-485** e repetir os testes de ruído (procedimento em
  `testes_ruido_rs485/PROCEDIMENTO.md`, cenário B com o SAJ de volta no barramento).
- [ ] Confirmar **F0.10 do SAJ** (o firmware assume 55 Hz = 100% ; o relatório dos inversores diz 50 Hz).
- [ ] Confirmar terminador de 120 Ω do lado do Delta.
- [ ] **Display novo SEM flat de toque** (causa confirmada em `docs/TROCA_DE_DISPLAY.md` 5b): pedir ao vendedor a versão com toque. Antes: reencaixar o flat
  do touch; se o toque não voltar, trocar/garantia. Depois testar o **RS-485 do display** (TX=16, RX=15)
  e a zona morta do canto inferior esquerdo.
- [ ] Bomba de espuma (Y7) e aspirador via app (DO7/DO8 da Waveshare 2) — ver memória do projeto.

## D. Não precisa de máquina (andamento offline)
- Telas de configuração (velocidades, tempos de giro, esperas dos modelos) com NVS.
- Itens display↔W1: toque curto do painel, propagação do canal, evento de fim de ciclo.
- Nuvem, e depois avaliar promover `testes/` no lugar de `lava_car_485/`.

## E. Câmera / app / backend (adiado de propósito — fazer quando formos mexer na câmera)
- [ ] **Data/hora na máquina.** A W1 e o display não têm relógio. A câmera, quando conectada à internet, deve mandar a data por
  ESP-NOW (`MSG_TESTE_DATA`, origem `ORIGEM_CAMERA`; a W1 já aceita). A **câmera ainda não envia**. Sem isso a planilha mostra
  "Desde --/--/----" e o acerto local grava sem data.
- [ ] **Acerto feito pelo admin/app** (backend já tem `lastPaymentDate` / "Marcar pago hoje"): fica **pendente** na máquina até
  alguém **validar no display** (botão PAGAMENTO EFETUADO, senha 3462). Desenho: backend avisa no retorno do heartbeat da câmera
  que há acerto novo -> câmera repassa à W1 -> o display mostra o pedido pendente -> ao validar, a W1 soma ao saldo e zera ->
  a câmera confirma ao backend no próximo heartbeat. Exige mudar firmware da câmera e (provavelmente) o backend; banco de
  produção só com autorização explícita do Giovani.
- [ ] **Sócios (mensalistas).** Hoje a coluna "Socios" conta os ciclos feitos com o botão **SOCIO: SIM** ligado antes de iniciar (vale
  para UM ciclo; cancelar limpa). Quando houver cadastro de mensalistas (placa reconhecida pela câmera), o marcador deve vir de lá.
- [ ] Tela da planilha (AUTOMATICO) e acerto local: validar na máquina que o ciclo concluído conta no modelo certo, que sócio x normal
  separa direito, que o contador persiste depois de religar a W1 e que o acerto soma ao saldo e zera.
