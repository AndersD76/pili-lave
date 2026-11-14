# Pendências que precisam da máquina (testar quando o Giovani voltar lá)

Atualizado em 2026-10-24. O que está validado está em `LEIAME.md`. Aqui só o que **falta** e exige
estar na frente da máquina. Marcar `[x]` e anotar o resultado quando for feito.
Antes de começar: abrir a captura serial da W1 **em tarefa de fundo** (abrir a porta reseta a W1; desde 2026-10-24 ela
reinicia em **COM X10 + BOMBA ON**, então não precisa reconfigurar a tela).

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
  `lixo/testes_ruido_rs485/PROCEDIMENTO.md`, cenário B com o SAJ de volta no barramento).
- [ ] Confirmar **F0.10 do SAJ** (o firmware assume 55 Hz = 100% ; o relatório dos inversores diz 50 Hz).
- [ ] Confirmar terminador de 120 Ω do lado do Delta.
- [ ] **Display novo SEM flat de toque** (causa confirmada em `docs/TROCA_DE_DISPLAY.md` 5b): pedir ao vendedor a versão com toque. Antes: reencaixar o flat
  do touch; se o toque não voltar, trocar/garantia. Depois testar o **RS-485 do display** (TX=16, RX=15)
  e a zona morta do canto inferior esquerdo.
- [ ] Bomba de espuma (Y7) e aspirador via app (DO7/DO8 da Waveshare 2) — ver memória do projeto.

## D. Não precisa de máquina (andamento offline)
- Telas de configuração (velocidades, tempos de giro, esperas dos modelos) com NVS.
- Itens display↔W1: toque curto do painel, propagação do canal, evento de fim de ciclo.
- Nuvem, e depois avaliar promover `testes/` no lugar de `lixo/lava_car_485/`.

## E. Câmera / app / backend (adiado de propósito — fazer quando formos mexer na câmera)
- [ ] **Wi-Fi do display (aba TECNICO > WI-FI) e migração de canal — compilado, NÃO testado com a câmera.** Display: busca de redes pela
  câmera (com canal), escolha/senha/nome digitado, migração camera -> W1(+W2) -> credenciais, rollback, caça aos canais 1-13 só se a câmera
  não responder ao BUSCAR (`testes/display/wifi_tecnico.h`). W1: aceita `MSG_CANAL` do display, leva a W2 e confirma com "oi"
  (`canal_tick`, canal salvo na NVS `rede`). **Falta na CÂMERA:** obedecer `MSG_CANAL` vindo do DISPLAY ("vai para o canal N", sem conectar
  na internet) e responder com `MSG_CANAL` ("oi") no canal novo, e só conectar quando chegar `MSG_WIFI_CFG`; mais o re-sync automático quando
  o roteador trocar de canal (ver `docs/COMBINADOS.md` seção 6). Para testar: gravar W1 (e W2 se mudar), alterar a câmera, depois no display:
  TECNICO > WI-FI > BUSCAR REDES > escolher rede > senha > CONECTAR; conferir o log `[CANAL]` da W1 e que todos acabam no mesmo canal.
  Testar também a falha (câmera desligada) e a queda de energia no meio (mensagem "Migração interrompida" ao religar).
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

## F. Gravado na máquina em 2026-10-23 (W2, W1 e display) — validar
- [x] **W2 estava no canal 6** (a câmera anunciava o canal do roteador e a W2 obedecia e salvava; display dizia "sem conexão com W2").
  Corrigido: a W2 só aceita troca de canal da **W1** e voltou ao canal 1 no primeiro boot. Depois disso: W2 ok, RS-485 100%.
- [ ] Gravados e **ainda sem teste de ciclo**: painel físico (X1/X2/X5/X6/X4), planilha e acerto, configurações/sequência dos modelos, saídas
  manuais, aviso de fim de ciclo, Wi-Fi/canal (falta a câmera), **Spray removido (= Cera d'água, velocidade da etapa 1)**.
- [x] **BOMBA TESTE (Y13)** nas telas TECNICO e MANUAL (liga só com BOMBA em ON, máquina parada; desliga em 20 s): **funcionou** em 2026-10-23.
  O "sem sinal no Y13" era **fio do Y13 em lugar errado na W2** (não era firmware nem canal ruim). Sobra constante `Y13_CANAL_W2` (hoje 3) em
  `protocolo_teste.h` (hoje NÃO sobra canal livre: DO7 = luzes, DO8 = aspirador). Testar o jato com água na linha.
- [x] (obsoleto desde 2026-10-24) A W1 passou a reiniciar em COM X10 + BOMBA ON; ver seção G.

## G. Mudanças de processo — estado em 2026-10-24
- [ ] **NUVEM pelo DISPLAY (decisão de 2026-10-24, revisada: a W1 fica só com a operação) — W1, W2, câmera v5 e display COMPILADOS, NADA GRAVADO.** `testes/display/nuvem_display.h`: heartbeat para a câmera a cada 5 s,
  **eventos** (a W1 manda `MSG_NV_EVT`; o display guarda na SUA fila na NVS, confirma a W1 e entrega à câmera até o ACK do backend), **licença** (pagamento 40/50 dias; 15 dias LIGADA sem comunicação) e as
  **ordens para a W1 a cada 2 s** (`MSG_NV_ORDEM`: lâmpada, licença, aspirador, iniciar reserva do app). `lixo/testes/waveshare1/nuvem_w1.h`: só executa as ordens (início pelo app com dedup, **lâmpada** + **vermelho piscando em erro**,
  **aspirador DO8**) e guarda até 16 eventos na NVS até o display confirmar. Sem ordens por 60 s: lâmpada apagada, aspirador off, não inicia pelo app. Câmera: `firmware_camera/release/camera_v5.bin` (obedece "vai para o canal N",
  sobe no canal combinado, pede **re-sync** ao display quando o roteador muda de canal). Display: aceita o re-sync da câmera e migra sem senha com a máquina parada. **Depende do display ligado** para app/eventos (painel e controle remoto seguem sem ele).
  **Ordem para gravar (com o Giovani na máquina):** (1) backup exato das placas (`docs/BACKUP_E_RESTAURACAO.md`); (2) W1 + display + W2; (3) câmera v5 pelo OTA (ver `firmware_camera/release/LEIAME.md`; é deploy de PRODUÇÃO).
  **Testar:** heartbeat (`[HB] OK` no log da W1), lâmpada seguindo o app, iniciar uma lavagem pelo app com a máquina parada (e com ela ocupada: não deve iniciar; mesma reserva 2x: não repete),
  concluir uma lavagem e conferir `[EVT] ACK` e o registro no backend, desligar a câmera no meio (evento deve ficar na fila e sair depois), reiniciar a W1 com evento na fila, licença (simular `blocked`), aspirador pelo app,
  e a troca de canal: TECNICO > WI-FI com uma rede nova, mudar o canal do roteador e ver o re-sync automático. **Ainda sem cadastro da máquina (deviceKey):** a câmera segue com o que já tem salvo.
- [ ] **Recuperação de boot LIGADA na W1 (compilada, NÃO gravada).** Antes o código existia mas `recuperacao_tick()` nunca era chamada. Agora, ao ligar fora do zero (HOME_GIRO e X12 não ok), a W1 zera as saídas e:
  com carro na posição (X15) pisca o vermelho e espera tirarem o carro; sem carro, faz o **HOME sozinho** e acompanha até concluir. Enquanto isso o auto, os botões do painel, o manual e o INICIAR ficam bloqueados.
  **Testar na máquina (mão no PARAR TUDO):** (1) desligar a energia com o braço/carrinho fora do lugar, sem carro, religar: deve fazer o HOME sozinho; (2) o mesmo com carro na posição: só pisca vermelho;
  (3) religar com tudo no zero: não deve fazer nada. Atenção: a máquina **se mexe sozinha ao ligar**, como no firmware antigo.
- [ ] **Luzes da máquina no DO7 da W2** (lógica nova): ligam quando há lavagem em andamento ou ciclo armado esperando o carro; ao acabar e não haver mais nada,
  ficam acesas **mais 10 min** e apagam. Começam apagadas ao ligar a W1. PARAR TUDO não apaga (só o tempo). **COMPILADO, NÃO GRAVADO.** Falta: ligar a lâmpada/relé
  no DO7 da W2 (confirmar o fio) e testar. **A "fila esperando" do app ainda não existe** na máquina (variável `g_fila_app` preparada; a câmera/app precisam avisar).
  Aspirador = **DO8** da W2 (`SET_ASPIRADOR`): na produção já liga pelo app (heartbeat); na base de testes só existe o macro, falta ligar quando a câmera voltar.
- [ ] **Pressão da água na tela de Velocidades (CONFIG > VELOCIDADES E PRESSAO):** 3 campos novos por modelo — **Press. Pré-lavagem** (etapa 11), **Press. Enxágue**
  (12) e **Press. Alta Pressão** (13, padrão 25 Hz), em Hz do SAJ. **COMPILADO, NÃO GRAVADO** (W1 e display). Hoje o SAJ está **fora do RS-485**
  (frequência fixa no próprio SAJ), então os valores ficam **guardados mas sem efeito** até o filtro do RS-485 chegar e o controle do SAJ voltar
  (`TESTE_SAJ_POR_RS485 1` em `saj_rs485_w1.h`, e conferir `saj_lendo_parado()`). Ao reinstalar o SAJ: testar se a pressão muda de verdade em cada
  processo. As outras frequências do SAJ ainda são fixas no código (espumas, cor mágica, cera 35 Hz; secagem 55 Hz) — dizer se também devem virar campos.
- [ ] **Cor Mágica: tudo desliga ao COMEÇAR A VOLTAR** (Y1, Y7, Y0 juntos; volta só com Y14). **GRAVADO na W1**, ainda sem validar. Chave: `COR_MAGICA_DESLIGA_NA_VOLTA`
  em `processos.h` (1/0). Conferir: a água para exatamente quando o carrinho começa a voltar e a volta termina no X12.
- [ ] **Cera d'água: Y0 liga junto com Y10 e Y7 e fica ligado o processo todo, inclusive a espera final** (5 s nos modelos 2/3; 4 min no 4).
  **COMPILADO, NÃO GRAVADO** (Giovani não está na máquina). Ao chegar: gravar a W1 (COM24), rodar um modelo que tenha Cera d'água e conferir o Y0.
  Linha antiga deixada comentada em `tick_cera_agua` para voltar fácil.
- [ ] **Confirmar:** Y0 ligado 4 min na espera da Cera d'água do modelo 4 é o desejado? (pendente desde antes)
- [x] W1 liga sempre em **COM X10 + BOMBA ON** (gravado). Display reassume isso ao sair do TECNICO (gravado). Correção do HOME "concluído" que bloqueava o TECNICO (gravado).
- [ ] **Commit** de todo o trabalho de 2026-10-23/24 (W1, W2, display, docs) — ainda NÃO feito. Sem push até o Giovani mandar.

## H. Nuvem pelo display — estado em 2026-10-25 e pendências do teste com o app
Gravado e funcionando na máquina: W1 (COM24), W2 (COM10), display (COM11) e câmera v6 (OTA, publicada na `main`). Canal 6, W1/W2 ok, nuvem ONLINE,
a tela Wi-Fi mostra a rede da câmera, a senha digitada fica guardada, a máquina aparece livre no app. O fluxo "pagou → câmera leu a placa → luz verde" funcionou.

- [ ] **PWA: sem botão de cancelar no estado "carro reconhecido" (reserva ACTIVE).** `server/app/(pwa)/app/page.tsx` só mostra "Cancelar lavagem e receber de volta"
  quando a reserva é HELD, mas a rota `/api/reservations/[id]/cancel` já aceita HELD e ACTIVE. Deploy de produção só na `main` (a tela na `main` pode ser diferente da
  branch `loja-conveniencia`, que tem a "Loja conveniência"). Aguardando o "pode publicar" do Giovani.
- [ ] **Verde preso depois de "cancelar":** a lâmpada da W1 (ociosa) segue o `lightState` do heartbeat; reserva ACTIVE = verde fixo. A reserva só volta a HELD
  depois de 5 min (`ACTIVE_TTL_MIN`) **quando `expireStale()` roda** (cron `/api/cron/expire-reservations`, ou chamadas a `/api/reservations` e à leitura de placa).
  Conferir se o cron está agendado no Railway; se não, a reserva fica ACTIVE para sempre. Voucher do teste: RQMF7HS5GT (reserva `cmvo5xphv005…`).
  Conferir também se cancelar pelo ADMIN (lista de Lavagens) cancela a reserva e apaga a luz (`lightUntil`), como faz a rota do cliente.
- [x] W1 desarma sozinha o ciclo armado pelo app quando a reserva some do backend (8 s, só com nuvem ONLINE). Gravado. **Validar:** reservar, deixar o verde acender, cancelar, ver o verde apagar.
- [x] Display: botão **CANCELAR ESPERA** (no lugar do PAUSAR) quando a W1 espera o carro. Gravado. **Validar** na máquina.
- [x] W1 e display: log de diagnóstico da lâmpada (`[LAMP]`, `[NUVEM] ordens` a cada 10 s) na serial da W1 (115200).
- Decidido: o verde acende e a W1 espera o X14 em **duas situações**: (1) liberada pelo app (câmera leu a placa ou "Já estou na máquina") e (2) controle remoto / botão INICIAR AUTOMATICO da tela. Não mudar.
- [ ] Ainda não testado: ciclo completo iniciado pelo app (carro entra → lava → evento chega ao backend e ao app), fila de eventos com a câmera desligada, aspirador pelo app,
  licença (aviso/bloqueio), recuperação de boot, cadastro "TROCOU DISPLAY".
- [ ] Commits locais **sem push** (branch `loja-conveniencia`): depois de `1e2f298` há câmera v6, CANCELAR ESPERA, correções da W1. A câmera v5/v6 já está na `main` (push só dos arquivos de firmware).

## I. Teste com o app em 2026-10-25 — resultado e pendências
**Funcionou de ponta a ponta (reserva RYD1E43, modelo 1):** reserva paga → câmera leu a placa → luz verde → `START pelo app` → X14 → ciclo completo → `car_entered` e
`wash_completed` no backend → reserva COMPLETED / pedido REDEEMED, sem reserva presa. Gravado: W1 (`ce4ae90`), display (`3da4edc`), câmera v6 (na `main`).

- [x] Ciclo abortado pelo X15 (17:11): o código antigo fazia HOME automático com o carro dentro e o braço bateu no carro. **Corrigido e gravado:** X15 perdido no processo → para tudo
  e fica em erro (sem HOME), avisando o backend (falha + estorno). PARAR TUDO / cancelar do operador também avisa o backend quando era ciclo do app. A reserva presa do teste foi liberada à mão.
- [ ] **X15 instável** (sensor): conferir ajuste mecânico, distância, cabo e blindagem. É a origem da batida.
- [ ] **Y7 bloqueado na Cor Mágica:** o intertravamento do Y7 (`io1_set_do`, `controle.h`) só aceita Y2/Y3/Y10 e ignora o Y1; na Cor Mágica (Y1+Y7) aparece
  `[SEGURANCA] Y7 bloqueado` no início do 2º processo do modelo 1. O Giovani viu o ciclo terminar bem e disse para **não mudar por enquanto**; a correção (incluir `do_estado1 & (1<<0)`) NÃO foi gravada.
  Confirmar na máquina se a bomba Y7 deve ligar na Cor Mágica.
- [ ] **Ruído elétrico** nas transições do inversor: pulsos fantasmas no painel (X1/X2/X5/X6 → "modelo N ignorado"), X11 oscilando, erros de CRC no RS-485 e falhas no link com a W2.
  Com a máquina parada um pulso fantasma ARMA um ciclo e acende o verde. Avaliar filtro/debounce no firmware e blindagem/aterramento.
  **Atualização 2026-10-29:** o RS-485 está **resolvido** (cabo novo ~1,2 m direto pela frente da W1 e do Delta, longe do trajeto antigo que dava a volta no painel, e malha ligando SGND do Delta ao ⏚ da W1): 5 ciclos de 80 s com bomba ON, 0 erros. Ver `LEIAME.md` (rodada de 29/10).
  **Continua aberto:** os pulsos fantasmas do painel (~44 `modelo N ignorado` por ciclo, quase 1 a cada 2 s, sempre nos modelos 1/2/4) **não são do RS-485** (aparecem com o barramento limpo). Investigar entradas X do painel (cabeamento, aterramento, botão) e `loop_max` de ~1,1 s a cada início de giro.
  Falta: repetir com um ciclo de **lavagem real** (modelos completos, com carro/app); instalar o filtro de RS-485 só se o problema voltar; recolocar o SAJ no barramento é teste à parte (antes, com o cabo antigo, foi o pior caso).
- [ ] **Queda de energia** de ~3 min (17:11–17:14, provavelmente a parada de emergência): a W2 e a câmera voltam sozinhas.
- [ ] **Leitura da placa com o carro parado** pode levar até 1 min (filtro "cena parada" do servidor compara com a foto anterior). Correção proposta no servidor, aguardando "pode publicar".
- [ ] `remainingSec` sempre 0 no servidor (o app não mostra contagem regressiva). O estado FREE/WASHING oscilou por alguns segundos durante o ciclo: revisar `nd_estado_str`.
- [ ] Banco de produção sem a coluna `User.codigoCliente` (migrations da loja não aplicadas): atenção ao unir `loja-conveniencia` com a `main`.
- [ ] A serial da W1 parou de imprimir às 17:46 durante o ciclo (a máquina seguiu e terminou): ver se é limite do monitor USB ou da W1.

## J. Watchdogs e travas de segurança — estado em 2026-11-01 (decididos com o Giovani)
Contexto: em 29–31/10 a W2 sumiu por 160–208 s (duas vezes), o envio de rádio da W1 travou (`tx_ok` congelado) e um ciclo armado por pulso falso ficou preso. Ver `docs/ESTADO_ATUAL.md` e `docs/LINK_W1_W2_UART.md`.

**Já GRAVADO na máquina (W1 e display de 31/10):** pausa por falha da W2 (1,5 s; retoma sozinha; 10 min → erro); vigia do envio de rádio da W1; limite de taxa dos comandos à W2; caixa-preta na NVS (`erro`, `w2`, `tx`; impressa no boot como `[BOOT]`); janela de 3 s do painel após qualquer mudança de saída; ciclo armado só pelo painel expira em 3 min; cancelar apaga a memória; automático força COM X10 + BOMBA ON; botão CANCELAR ESPERA nos estados 1 a 4; INICIAR TESTE na aba TÉCNICO não troca de tela; X15 perdido por 3 s (era 1 s).

**IMPLEMENTADO E COMPILADO em 2026-11-01, AINDA NÃO GRAVADO** (W1 e display; decisões do Giovani: 3 tentativas, 3 min, fail-safe 2 s):
- [ ] **Recuperação de boot com limite:** depois de **3 falhas seguidas** do HOME ela desiste, para de comandar a máquina e fica em ERRO (`Recuperacao falhou 3x: faca o HOME pelo painel`, vermelho piscando, evento para a nuvem). PARAR TUDO limpa e libera HOME/MANUAL. (Antes repetia para sempre: 29+ falhas em 31/10.)
- [ ] **Prazo de 3 min nos estados "carro entrando" e "aguardando posição"** para ciclo armado SÓ por pulso do painel (sem reserva): desarma e apaga o verde. Ciclos do app e do display não entram nessa regra.
- [ ] **O app prevalece** sobre um ciclo armado só pelo painel que ainda não começou o processo (estados 1 a 3): `[NUVEM] reserva do app prevalece sobre o ciclo armado pelo painel`. Estado ≥ 4, ciclo do display e reserva já em andamento não são passados por cima.
- [ ] **Reserva do app que some da nuvem** (cancelada/expirada) desarma o ciclo também nos estados 2 e 3 (antes só no 1), depois de 8 s com a nuvem online.
- [ ] **Display envia `FAULT`** no heartbeat quando a W1 está em ERRO (antes o painel mostrava "OK" com a máquina parada). O FAULT some sozinho quando a W1 volta a IDLE.
- [ ] **Display com watchdog de tarefa (20 s) e vigia do envio de rádio:** sem confirmação do rádio por 3 s com ≥ 4 envios pendentes → reinicializa só o ESP-NOW a cada 5 s; 3 tentativas sem resolver → reinicia o display (uptime > 60 s). Linhas `[TX] TRAVADO / reinicializando / normalizado` no serial do display.
- [ ] **Ciclo do APP que não chega ao X15 em 3 min (estados 1 a 3):** a W1 cancela aquela lavagem (`Reserva do app cancelada: carro nao posicionou em 3 min`), vai para IDLE e manda o evento de falha com `errorCode` `X15_POSICAO`. O backend (`server/app/api/machine/fault/route.ts`, alterado em 2026-11-01, em produção desde 2026-11-01) trata esse código como **volta para a fila**: reserva ACTIVE/ENTERED → HELD, sem estorno, sem FAULT na máquina, push ao cliente e alerta leve ao admin. Sem esse deploy, o evento cai no fluxo antigo (FAILED + estorno + FAULT). Aplicado e no ar (commit 7dcd2e0 na main, 2026-11-01).
- [ ] **Duração máxima do ciclo:** mais de 30 min em PROCESSO (pausa não conta) = para tudo, sem HOME automático, ERRO `Ciclo passou do tempo maximo (30 min)`. Valor em `CICLO_MAX_MS` (`maquina_estados.h`); ajustar se alguma lavagem real passar disso.
- [ ] **Delta mudo:** com a máquina parada, 20 leituras seguidas (10 s) sem resposta do Delta = mensagem na tela `Delta (inversor) sem resposta no RS-485`, linha `[DELTA] MUDO` no serial e contador na NVS (`[BOOT] Delta mudo ... n=`). Não bloqueia nada; some sozinho. **Leitura do código de falha do Delta NÃO feita:** o mapa de registradores do código usa 0x2100/0x2101/0x2103 de um jeito que não confere com a tabela padrão do MS300 (onde 0x2100 é o código de erro); só dá para ler com segurança depois de confirmar o endereço no manual/parâmetros do SEU inversor.
- [ ] **Monitor de memória:** a cada 10 s; abaixo de 40 KB livres registra (`[MEM] BAIXA`, NVS `mem`); abaixo de 20 KB com a máquina PARADA reinicia a W1. Nunca reinicia no meio de ciclo. Linha `[MEM] livre=... minimo=...` a cada 10 min no serial.
- [ ] **Largura mínima do pulso do painel (X1/X2/X5/X6):** o pedido de modelo só vale se o contato ficar ativo por 50 ms (`PAINEL_PULSO_MIN_MS`); pulso menor é descartado com `[PAINEL] pulso curto descartado`. **Validar com o controle remoto real** (se algum botão/controle der pulso < 50 ms, baixar o valor).
- Fail-safe da W2 (2 s, desliga tudo menos DO7), watchdog da W2 (8 s) e o link por cabo: ver `docs/LINK_W1_W2_UART.md` (Fase 2, nada gravado).
**Roteiro de validação (depois do "grava")**: (1) boot com o braço fora do zero e carro fora: recuperação faz HOME; forçar falha (cabo do carrinho desconectado) e ver `HOME falhou (1/3) ... DESISTE` e ERRO; PARAR TUDO limpa. (2) Armar pelo painel, deixar o carro parado no X14/X15 sem chegar na posição por 3 min e ver o desarme. (3) Armar pelo painel e criar uma reserva no app antes disso: o app deve assumir. (4) Colocar a W1 em erro e conferir no admin/app que a máquina aparece como FALHA (não "OK"). (5) Display: no serial procurar `[TX]`; simular o travamento é difícil, então vale só conferir que não há reinícios do display (`up` do `[BOOT]`/uptime).

**Ainda NÃO implementado (conversado em 2026-11-01):** leitura do código de falha do Delta/SAJ (falta confirmar o endereço do registrador); telemetria de saúde (reinícios/silêncios) para o painel do admin (hoje só serial/NVS; exige evento novo display→câmera→backend); supervisor externo de hardware e separar a emergência da comunicação (projeto elétrico: `docs/SUPERVISOR_HARDWARE.md`); cron de expiração no Railway (confirmar no painel).

## K. HOME obrigatório + pulso de vida (2026-11-01) — compilado, NÃO gravado
Fontes: lixo/testes/waveshare1 e testes/w1_w2_por_rxtx/waveshare1 (edições idênticas; build 954.407 B / 957.559 B).
- [ ] **HOME obrigatório pelo botão** após energizar: desligue e religue a W1 com o braço fora do zero (ou depois de uma emergência). Esperado: nada se move, vermelho piscando, tela "Religou fora do zero: toque em HOME no display". Tocar em HOME: roda o HOME. Com carro no X15: mensagem de retirar o veículo; HOME não inicia. Religar já no zero: nada exigido.
- [ ] Durante a espera, uma reserva do app não inicia ciclo.
- [ ] **Pulso de vida em IO1** (GPIO1, borne do conector de expansão): multímetro VDC (ou LED + 330 Ω) entre IO1 e GND alterna ~0 V ↔ ~3,3 V a cada 3 s, com a máquina parada e em ciclo. Se não mexer, o borne não é o GPIO1: avisar antes de ligar qualquer supervisor.
- Detalhes e pendências do supervisor externo: docs/SUPERVISOR_HARDWARE.md.
- [ ] **Delta: parar na perda de comunicação Modbus** (parâmetros de tempo limite/tratamento de falha de comunicação do MS300; confirmar no manual). Pré-requisito do supervisor externo; detalhes em docs/SUPERVISOR_HARDWARE.md seção 6.

## L. Registro permanente de reinícios + envio para a nuvem (2026-11-02) — compilado, NÃO gravado, NÃO enviado
Pedido do Giovani: guardar o histórico de reinícios (W1 e W2) e mandar para a nuvem a cada reconexão, para o admin ver; reinício no meio de lavagem avisa o lavador na hora.
**Peças e onde estão**
- W1: `lixo/testes/waveshare1/reset_log_w1.h` (novo) + edições em controle.h, maquina_estados.h, nuvem_w1.h, protocolo_teste.h, tipos_w1.h, waveshare1.ino (cópia do cabo `w1_w2_por_rxtx/waveshare1` igual, mas SEM o aviso de boot da W2: pelo cabo ele precisa de um quadro LT_ novo, pendente no projeto do link). Build 957.011 B (produção) / 960.111 B (cabo).
- W2: `lixo/testes/waveshare2/waveshare2.ino` manda `MSG_W2_BOOT` (motivo + id do boot) 1x/s nos primeiros 20 s depois de cada boot. Build 900.827 B.
- Câmera: `firmware_camera/src/main.cpp` entende o evento tipo 4 e faz POST em `/api/machine/reset-log` (corpo `{key, info}`). Build OK (`pio run`).
- Display: NÃO muda (repassa eventos de forma genérica).
- Backend: branch local `backend-reset-log` (commit 9f40be9, em worktree no scratchpad, **não enviada**): `server/app/api/machine/reset-log/route.ts`, `server/lib/resets.ts`, seção no `server/app/admin/maquinas/page.tsx`, guias. Sem tabela nova (usa `Event` type `machine_reset`), sem migration.
**ORDEM DE IMPLANTAÇÃO (obrigatória)**: 1) backend na main (só com "pode subir") e conferir `/api/health`; 2) câmera por OTA; 3) W2 e W1. Câmera antiga + W1 nova = a câmera não confirma o tipo 4, o display reenvia a cabeça da fila e os eventos de lavagem atrás dela ficam esperando.
**Roteiro de validação**
- [ ] Boot da W1 no monitor serial: linhas `[RST] W1 reiniciou: motivo=...` e `[RST] totais: ...`. Primeira energização: motivo POWERON, estado desconhecido (o hard reset do boot não aparece como falha).
- [ ] Apertar RESET (EN) da W1 com a máquina em ciclo SECO: o serial mostra `estado_antes=5 ... EM CICLO` (valida o retrato da RTC). Não vai para a nuvem (reset técnico).
- [ ] Religar a W1 por energia: motivo POWERON, vai para a nuvem após 15 s ligada (se houver internet); aparece em Admin > Máquinas > "Reinícios das placas".
- [ ] Teste completo do aviso: ciclo SECO em andamento e desligar/religar a energia da **W2**: a W1 pausa, a W2 volta e avisa; deve chegar o push "A máquina parou: placa reiniciou" no lavador e no admin, e a linha na tabela com "ciclo interrompido".
- [ ] Sem internet (câmera fora): os registros ficam e sobem quando voltar. Nenhum evento de lavagem fica preso atrás deles.
- [ ] Depois de enviado, o mesmo reinício não aparece duas vezes no admin.

### L.2 Relógio da máquina e cancelamento com estorno (2026-11-02) — compilado, NÃO gravado, NÃO enviado
- **Relógio**: a câmera pega a hora por NTP (`pool.ntp.org` / `time.google.com`) e manda `MSG_HORA` (41, epoch UTC) à W1 a cada 30 s, só com a hora válida. A W1 mantém o relógio na RAM (`g_hora_*` em controle.h) e carimba cada reinício de trás para frente (hora atual − tempo ligada). O texto do evento ganha `;t=<epoch>`. Sem hora na W1, o campo some (e a W1 espera até 2 min de boot pela hora antes de enviar). Builds: W1 957.599 B / cabo 960.691 B; câmera OK. A hora some em corte total de energia até a câmera voltar à internet (usar o RTC da Waveshare é melhoria futura).
- **Regra do Giovani (backend, branch local `backend-reset-log`, commit 07d1335)**: W1 reiniciou em ciclo → reservas do app ACTIVE/ENTERED que começaram ANTES do reset são canceladas e estornadas na hora; o cliente reserva de novo pelo app (não reagenda). W2 reiniciar não cancela. Sem a hora do reset (`t`) só registra e avisa. Testado no banco LOCAL com 11 casos (estorno, reenvio idempotente, reserva posterior intacta, W2, reset técnico, máquina parada, lixo, hora no futuro, 401).
- [ ] Validação na máquina: com a câmera online, o serial da W1 mostra `[RST] ... carimbado: ha Ns (epoch ...)` poucos segundos depois do boot. No admin, a hora do reinício bate com o relógio real.
- [ ] Validação do cancelamento (só com reserva de teste do app, na máquina em modo SECO): reiniciar a W1 no meio do ciclo por software não é possível sem hook; usar queda de energia da W1 NÃO cancela (estado desconhecido, sem c=1). O caminho c=1 da W1 só ocorre em watchdog/panic/brownout reais; o caminho foi validado no banco local.
- Limite conhecido: queda **total** de energia (inclui o botão de emergência) aparece como "energia ligada" sem estado anterior: não cancela nem estorna sozinha; o cron de expiração (2x a duração) continua sendo a rede de segurança.

### L.3 Fase 0 da retomada do ciclo (2026-11-02) — compilado, NÃO gravado, NÃO enviado
Só observa e registra; **nenhuma decisão de movimento mudou**. Regras em `docs/REGRAS_RETOMADA_CICLO.md`. Código: `reset_log_w1.h` (reescrito, W1 produção e cabo), W2 (`waveshare2.ino`) e backend (branch local `backend-reset-log`). Builds: W1 960.631 B / cabo 963.711 B / W2 901.171 B. Câmera inalterada nesta rodada (o tipo 4 é genérico).
- **Retrato da etapa** (RTC a cada volta do loop + checkpoint na NVS "et" a cada troca de etapa/giro, no máximo 1 por 1,5 s): processo, sub-estado, etapa, giro (n, sentido, destino), modelo, entradas/saídas das duas placas, frequência. Sobe junto de cada reinício **em ciclo** e de cada ocorrência.
- **Ocorrências O1..O5** (só em AUTO_PROCESSO, fora do SECO; 1500 ms estáveis; 1 por tipo a cada 5 min): O1 X10 apagou sem 3 s de Y14, O2 X13 com X10, O3 X12 com X13, O4 X15 sem carro, O5 X10 apagou durante o giro. **Esperamos que O1 apareça** se a perda normal do X10 no avanço acontece antes de 3 s: é o dado para calibrar a regra.
- **Diário X14/X15 na W2**: `MSG_W2_DIARIO` (42) a cada 5 s com as bordas; a W1 guarda o último na RTC e, depois de um reinício só da W1, calcula as bordas durante a queda (campos `a`/`b`).
- [ ] Validação (máquina em SECO, depois ciclo real): o serial da W1 mostra `[RST] ... etapa: proc=... giro=...` depois de um reinício em ciclo; `[OCR] O1 ...` quando houver ocorrência; `[RST] #N: bordas durante a queda da W1: X14=.. X15=..` depois do boot; no admin, a coluna "Etapa" e a seção "Ocorrências observadas".
- [ ] Conferir se O1..O5 disparam em ciclo NORMAL (sem falha): se disparar sempre, anotar o `valor`/etapa: é a calibração das regras (não é defeito da máquina).
- Limite conhecido: sem a hora (câmera sem internet) as ocorrências sobem com a hora de chegada.

### L.4 Sócio e bônus no wash-complete (2026-11-02) — compilado, NÃO gravado
- W1 (`maquina_estados.h` e `nuvem_w1.h`, produção e cabo): ao concluir um ciclo local, o evento `wash-complete` leva `source` = `"socio"` (g_tipo_ciclo 2), `"bonus"` (3) ou `"remote"` (presencial). Builds: 960.695 B (produção) / 963.763 B (cabo). Display e câmera repassam o campo `source` sem mudança.
- **Ordem**: backend primeiro (aceita `socio`/`bonus`; um backend antigo trataria `socio` como reserva de app e poderia confundir), depois a W1.
- [ ] Validação: escolher na tela "sócio" (ou "bônus") para o próximo ciclo, concluir um ciclo local; no admin (Máquinas > resumo) aparece em Sócios (ou Bônus) com R$ 0,00 e Presencial não aumenta.

### L.5 Trava de segurança do envio à nuvem (2026-11-02, dia da gravação)
- Uma **câmera antiga** não conhece o evento tipo 4: não confirma, e o display reenviaria a cabeça da fila para sempre, **prendendo atrás dele os eventos de lavagem** (débito/estorno). Por isso a W1 só envia reinícios/ocorrências/retratos **depois de receber `MSG_HORA`** da câmera nova (`if (!g_hora_tem) return;` em `rst_enviar_tick`). Até lá o registro fica na NVS e no serial. Builds: W1 960.711 B / cabo 963.779 B.
- Ordem de implantação continua: backend com o endpoint `reset-log` → câmera nova (OTA) → W1 já gravada começa a enviar sozinha. A W1 e a W2 podem ser gravadas antes sem risco.

## M. Gravação na máquina em 2026-11-02 (resultado)
**Gravado e verificado ("Hash of data verified")**
- **W2 e W1: versão de PRODUÇÃO POR CABO** (`testes/w1_w2_por_rxtx/waveshare2` e `waveshare1`, UploadSpeed 230400) com watchdogs, HOME obrigatório, registro de reinícios/Fase 0, sócio/bônus, LT_DIARIO (diário do X14/X15) e aviso de reinício da W2 pelo uptime do LT_HB.
- **Display (COM11):** `testes/display` com `PartitionScheme=huge_app,PSRAM=opi,FlashSize=16M` (a tabela de partição que já estava nele: nvs 0x9000/20 KB, app0 0x10000/3 MB, spiffs, coredump). A configuração dele (NVS) foi preservada. Compilação a frio levou 17 min (travou uma vez, foi refeita com `--build-path` novo).
- **Câmera v7 publicada por OTA** (`camera.bin` = firmware_camera compilado, 1.211.504 B; `camera-version.json` = 7; sha256 conferido no servidor). Ela se atualiza em até 10 min **depois de conectar na internet**. Na gravação a câmera ainda estava offline (a W1 mostra `[NUVEM] ... flags=0`).
- **Backend** em produção: reset-log (reinícios, retrato, ocorrências, estorno por reinício da W1), resumo/Visão geral, alertas sem repetição, texto do "voltou".

**Cópias de segurança (fora do git):** pasta `Documentos\pili_backups_flash_2026-11-02` (W1 16 MB, display 4 MB; a W2 não teve cópia completa: o firmware antigo dela está em `backup_atual/bin/w2`).

**Validações feitas**
- Loopback TXD/RXD: **OK nas duas placas** (GPIO43/44).
- Par por cabo, 10 min parado: zero CRC/timeout/truncado/espúrio/erro de UART, ida e volta máx. 26,5 ms. Os "perdidos" do teste eram artefato do sketch (T_FASE consumia a seq dos OIs; corrigido).
- Tráfego real em produção por cabo: ~13.000 quadros em 44 min, **tudo zero**, silêncio máx. 200 ms.
- Display ↔ W1: `[NUVEM] ordens ... idade=1s` (ESP-NOW ok).

**Pendências**
- [x] **IO1 CONFIRMADO em 2026-11-02 (informado pelo Giovani depois, na máquina: 'o IO1 está funcionando')**. Medida original, que não se reproduziu:  multímetro em IO1/GND leu 0,02 V fixo (esperado alternar 0↔3,3 V a cada 3 s). O código roda (conferido); provável que o borne "IO1" não seja o GPIO 1 (a doc da Waveshare não lista os pinos desse conector). Plano: sketch de leitura (só entradas) que diz qual GPIO cai quando o borne vai ao GND. Só importa para o supervisor externo.
- [ ] **Câmera**: conferir energia/Wi-Fi; depois do OTA a W1 mostra `flags=4` (nuvem online) e passa a enviar o histórico de reinícios.
- [ ] **Religar disjuntores** (inversores/bombas) e validar: HOME obrigatório pelo display, ciclo em SECO, depois ciclo real. Conferir no serial `[DELTA] voltou a responder`, `[RS485] ok`.
- [ ] Conferir no admin (Máquinas > Reinícios das placas) quando a câmera nova enviar.

## N. Correcoes feitas NA MAQUINA em 2026-11-02 (HOME)
- **DEFEITO REAL ACHADO (W1): `comm_perdida()` dava TRUE com o link perfeito.** `g_hb2` (instante do ultimo quadro da W2) e gravado pela TAREFA de recepcao (callback da UART/ESP-NOW) e lido pelo laco principal; se a tarefa grava um instante mais novo que o `millis()` ja lido, `millis() - g_hb2` da negativo e, sem sinal, ~4 bilhoes > 700 ms. Aparecia no giro (a W2 manda muitos eventos de sensor). Prova: ocorrencia O6 com `valor=29` (29 ms desde o ultimo quadro) e o cabo a 0 erros. Correcao: `hb2_idade_ms()` (diferenca negativa = 0) em todos os 9 usos (HOME, pausa por falha da W2 no ciclo, status do display, alarme da W2, canal). A W2 nao tem o problema (processa os quadros no proprio laco).
- **Ocorrencia O6** (`ocr_externa(6, ms)`): HOME falhou por comunicacao; grava retrato e sobe para a nuvem. O backend ainda mostra 'ocorrencia 6' (falta o nome em `lib/resets.ts`).
- **Reavaliacao do zero na recuperacao de boot:** enquanto espera o botao HOME, se X16 + X12 ficarem ativos e estaveis por 1500 ms, encerra a recuperacao (antes ficava presa na decisao do boot, tomada com os sensores sem energia). Nao exercitada ainda em campo.
- **Validado na maquina:** HOME obrigatorio pelo botao (`[REC] boot fora do zero` -> `HOME pedido pelo botao do display` -> `HOME concluido` -> `recuperacao encerrada`); 2 HOMEs completos sem falha depois da correcao; movimento manual ok; o filtro de pulso curto descartou pulsos falsos dos botoes do painel durante o movimento; cabo 0 erros com o motor girando.
- Lição: opening the serial resets the W1 sometimes; o log de boot nao aparece (DBG so imprime com o host conectado).

## O. Correcoes e regras novas gravadas NA MAQUINA em 2026-11-02 (tarde/noite)

- **Gravado na W1 (cabo), commits 3532e38, bf69201, 731de19, c20fa3a, faf8ac0, b5d08b8** (copia ESP-NOW de producao compilada igual, nao gravada).
- **START do app cancelava na hora** (`carro nao chegou na posicao em 3 min` junto do START): subtracao sem sinal (`g_t_app_armado` mais novo que `agora` no mesmo tick). Corrigido com sinal. VALIDADO: lavagem completa pelo app.
- **X10 no inicio (AUTO_INICIANDO):** sem X10 a luz vermelha nao conta, nada liga; X10 volta -> 6 s recomecam; 60 s sem X10 -> erro. VALIDADO ('no partir deu certo').
- **X10 no giro (G4/G5/G8):** pausa em 500 ms (motor parado, bombas desligadas), retoma sozinho com X10 estavel 1500 ms; giro 1->2 rebobina ate X16+X17 a 5 Hz e refaz o giro. VALIDADO ('o giro deu certo').
- **X10 em TODAS as etapas (G3/G4/G5), b5d08b8:** etapa nao comeca sem X10; ausencia indevida (sem 3 s de Y14) no meio de qualquer etapa pausa/retoma. **NAO TESTADO ainda** (Giovani testa em outro dia: tirar o X10 no retorno ao X12 e entre etapas). Tambem desloca os watchdogs do X0 (`_cr_t_pulso`, `_cx_t_pulso`) na retomada (antes uma pausa > 4 s dava CARRO TRAVADO).
- **HOME do giro: limite 25 s -> 60 s** (falhou aos 24,7 s com o braco longe do zero, em baixa velocidade).
- **Ainda NAO programado (docs/REGRAS_RETOMADA_CICLO.md):** G6 (X13 com X10), G7 (carrinho parado na frente apos reinicio), G8b (giro triplo da volta a 5 Hz), retomada no meio do movimento apos reinicio (Fase 2), 5 Hz tambem no giro 2->1 retomado.
- **Admin:** O6 com nome na main (8e5c683). IO1 confirmado pelo Giovani. Branch link-uart-w1-w2 com todos os commits so LOCAL (nao enviada).


## P. 2026-11-12 — display regravado, câmera v9 publicada, Cera d'água passando do X12 (EM INVESTIGAÇÃO)
- **Display (COM11) regravado em 2026-11-12** com o código de `testes/display/` do commit `9b83073` (inclui, de 04/11: envio da sequência dos modelos à nuvem e contadores de lavagem). Gravação verificada ("Hash of data verified"); depois dela a W1 viu as ordens do display com 1 s de idade. **Backup exato da memória do display** (16 MiB) em `C:\Users\giova\backups_placas\2026-11-12\backup_display_COM11_2026-11-12.bin` (fora do git). Para voltar: `esptool --chip esp32s3 --port COM11 --baud 460800 write-flash 0 <arquivo>`.
- **W1 NÃO foi regravada**: o código dela só ganhou 1 linha desde 03/11 (campo `proc, modelo` em `MsgHbState`, mensagem que a W1 não usa), então a gravação não mudaria nada e reiniciaria a placa. Compila (967 019 bytes, 73%).
- **Câmera v9 publicada** (`server/public/firmware/camera.bin`, versão 9; a câmera baixa sozinha em até 10 min). Conferir com `node server/_diag_camera.mjs AAAA-MM-DD` (relatórios com `fw` 9 e os campos novos de tamanho/tempo de envio).
- **ARMADILHA DA SERIAL DA W1 (COM24): FECHAR a porta também REINICIA a W1** (visto em 12/11: os contadores do `[W2LINK]` voltaram a cerca de metade entre duas leituras; abrir não reiniciou). A W1 que reinicia pode fazer o HOME sozinha se o braço ou o carrinho não estiverem no zero. Só ler a COM24 com a máquina parada, sem carro e com alguém por perto; ou deixar a leitura aberta e só fechá-la com a máquina parada.
- **Cera d'água passou do X12 duas vezes e bateu no fim de curso** (relato do lavador, 12/11), display sem erro. Raciocínio: sem erro => o X12 **foi** detectado (senão o X0 pararia de pulsar e daria "CARRO TRAVADO" em 4 s); a parada veio tarde. No código (`processos.h`, `carr_rev_x12_tick`): o X12 vem da W2 pelo cabo a cada 200 ms + 300 ms de confirmação sem interrupção + rampa de 350 ms em passos de 100 ms + desaceleração do inversor (desconhecida); não há corte imediato nem limite de tempo no retorno em carro real (as proteções de X12/X13 só valem em SECO). Cabo W1<->W2 **em repouso** limpo (0 CRC, 0 perdidos, intervalo máx. 200 ms). **Falta ver o cabo durante uma Cera d'água** (o `[W2LINK]` mostra CRC, perdidos e intervalo) e saber se algo reinicia a confirmação do X12 (ruído).
- Também a verificar: a regra do X10 (G4/G5) vale para todos os processos sem exceção; num avanço com menos de 3 s de Y14 antes de perder o X10 ela pausa em vez de seguir o roteiro (`x10_pausa_tick`, `maquina_estados.h`).

- **CORREÇÃO (12/11, tarde) — o item "W1 NÃO foi regravada" acima tinha uma premissa errada.** Eu comparei com a `main` e concluí que a W1 quase não mudou desde 03/11. Mas a branch `link-uart-w1-w2` (commit `3b6ef55`, 06/11) tem mudanças da W1 que **não estão na `main`** (X10 sem vigia durante o giro, contraprova do X7, pausa/retoma na falha de escrita do Delta) e existe um trabalho de OTA da W1/display que estava **só num stash local** (agora na branch `wip-ota-display-w1-2026-11-09`). Ver `docs/ESTADO_ATUAL.md`, seção 10. **Não gravar a W1 até comparar a memória dela com a compilação de cada candidato.**
- **[ATUALIZADO 12/11, tarde] A regra dos 3 s no avanço e o registro do X10/X12 foram APLICADOS** (pedido do Giovani: "o carro é sempre maior que este tempo") na branch `ota-mais-w1-06-11` (commit `027e5d5`; W1 compilada com 978.935 bytes; **NÃO gravada**). Em carro real: (1) o X10 apagado nos primeiros 3 s de deslocamento do avanço é IGNORADO e, se durar 500 ms, a regra de pausa (G4/G5) para a máquina e espera o X10 voltar; depois de 3 s, perder o X10 encerra o avanço como antes; (2) o fim de curso da frente (X13) também encerra o avanço (só depois de 1,5 s, confirmado por 100 ms; antes só valia no SECO); (3) registro `diag_x10x12.h`: linhas `[DX]` na serial e ocorrência tipo 7 só para anomalias (X10 apagou cedo, retorno ao X12 com confirmação reiniciada ou parada tardia, pausa por X10, X13 encerrou o avanço). O rascunho original continua em `C:\Users\giova\backups_placas\rascunho_w1_regra3s_registro\`. **Não afeta o retorno ao X12**: a Cera d'água passando do X12 continua em investigação (o registro dos itens 3 ajuda a explicar).

## Q. 2026-11-12 — camera v10 (foto menor + watchdog) e atualizacao remota (OTA) do display/W1 — COMPILADO, NAO GRAVADO NEM PUBLICADO

- **Camera v10** (branch `camera-v10-ota`; compilada, 1.223.069 bytes; **nao publicada**): (1) quando o envio da foto falha, desce um degrau a cada 2 falhas seguidas: qualidade 20 -> 30 -> 40 e depois RESOLUCAO 1600x1200 -> 1280x1024 -> 1024x768; sobe um degrau a cada 20 fotos entregues; (2) o watchdog de 30 s fica pausado durante heartbeat/diagnostico/eventos (como ja era na foto): em 12/11 houve 9 reinicios por WATCHDOG com internet lenta (foto de 90 KB levando 40-60 s); (3) o lado que ENTREGA firmware ao display/W1 (dormente: so age se existirem `server/public/firmware/w1-version.json` / `display-version.json`; confere a cada 15 min). Diagnostico novo: `niv` (degrau da foto), `ow1`/`odp` (versao que W1/display dizem rodar).
- **OTA do display e da W1** (branch `ota-sobre-main`, commit `ad14d06`, sobre a `main` = o que o display tem hoje; **nao inclui** as mudancas de 06/11 da W1): camera baixa o .bin para a PSRAM, confere o MD5 e entrega por ESP-NOW (camera -> display -> W1) em pedacos de 200 bytes com ACK; o alvo grava na particao reserva, confere o MD5 e so entao troca; **rollback automatico** se a placa nao ficar 60 s de pe. So com a maquina PARADA (aborta se um ciclo comecar). Compilados: W1 973.719 bytes (30%), display 1.303.671 bytes (41%).
- **Layout de memoria novo (os dois)**: `PartitionScheme=app3M_fat9M_16MB` (2 particoes de app de 3 MB). NVS fica no mesmo lugar (0x9000, 0x5000): contadores/ocorrencias/configuracao **sao mantidos**. Gravar por cabo com `arduino-cli upload` (grava bootloader + tabela de particoes + app). Sem isso o OTA nao funciona (o display usava `huge_app`, 1 particao so).
- **Como publicar uma atualizacao depois**: compilar, `node server/scripts/publicar-firmware.mjs <w1|display> <arquivo .ino.bin> <versao>` (versao = `OTA_FW_VERSAO` do firmware, maior que a rodando), commit + push na `main`. Primeira gravacao por cabo = versao 1.
- **Branch `ota-mais-w1-06-11`** (decidido em 12/11): `ota-sobre-main` + as 3 mudanças da W1 de 06/11 (X10 sem vigia no giro, X7 contraprova do lado 2, pausa/retoma na falha de escrita do Delta, commit `73dce14`) + a regra dos 3 s e o registro do X10/X12 (commit `027e5d5`); W1 compilada com 978.935 bytes. Binários candidatos em `C:\Users\giova\backups_placas\candidatos_2026-11-12\` (`w1_ota_0611_regra3s.ino.bin` é o mais novo). **Antes de gravar a W1**: ler a memória dela e comparar (seção 10 de `docs/ESTADO_ATUAL.md`).
- **Nao testado em campo**: entrega real pelo rele, rollback, 60 s de validacao. Teste sugerido depois da gravacao: publicar uma versao 2 identica a 1 (so o numero muda) e acompanhar a W1/display.

## R. 2026-11-13 — W1 v4 gravada, teste do SAJ, ruído da Delta e "sem fila" no servidor

- **W1 v4 gravada por cabo** (`--no-stub`, 115200) e confirmada ("firmware v4 confirmado como bom"): v2 = G7 do retorno parcial; v3 = Cor Mágica segue **3 s** depois de perder o X10 (era 1 s) **ou até o X13** (régua da frente, 100 ms), e depois volta; v4 = **teste do SAJ por RS-485** dentro do BOMBA TESTE (tela TECNICO, acao 66): 24 Hz (0-5 s), 35 Hz (5-10 s), 24 Hz (10-20 s); a W1 escreve 0x1000 e lê 0x1001 e mostra na tela e na serial `[SAJ-TESTE]`. O Giovani confirmou que o SAJ **obedeceu**. O ciclo normal continua sem escrever no SAJ (`TESTE_SAJ_POR_RS485 = 0`).
- **Ruído (filtros nas inversoras + resistor de terminação do RS-485):** só aparece com a **Delta andando** (giro ~300 pulsos curtos do painel por 5 s, carrinho ~255; parado ~2). Referência de 12/11 antes dos filtros: ~24 pulsos/min. Com os filtros: ~2.900 a 3.900/min andando. O cabo W1<->W2 **oscila** entre rodadas do mesmo roteiro (3 giros + retorno ao X12): perdidos 20, 3, 0, 22, 0; RS-485 sempre 100%. A SAJ **não** foi medida sozinha. Nenhum giro/retorno falhou nas rodadas e nenhum aperto de botão do painel foi aceito (todos descartados por serem curtos). Ferramentas: `C:\Users\giova\backups_placas\ferramentas\analisa_ruido_serial.py` e `ruido_por_janela.py`; capturas em `C:\Users\giova\backups_placas\2026-11-13_*`.
- **Riscos conhecidos com esse ruído:** os sensores da W2 também recebem rajadas (~50 eventos/s contra ~1/s antes); a vigia de X0 (carrinho travado) pode ser enganada; **o X13 no retorno parcial (G7) para na hora, sem confirmação de tempo — corrigir** (exigir 100 a 300 ms). Próximo passo para a causa: teste A/B com o filtro da Delta em ponte, aterramento (PE) da carcaça do filtro e roteamento dos cabos do motor.
- **Servidor — "sem fila"** (publicado em 14/11): reserva = autorização do carro; o carro autorizado que chega (placa ou "estou aqui") é liberado na hora; só uma lavagem em andamento (reserva `ENTERED` na máquina) segura os outros (`lavagemEmAndamento()`); o status WASHING da máquina deixou de bloquear (o display também o manda com carro parado no X14/X15, que foi a causa da reserva presa em 12/11). Teste: `server/_teste_sem_fila.mts`.
- **Lavagens presenciais não são vistas pela nuvem como "em andamento"**: um carro autorizado que chegar durante uma presencial fica liberado (verde) e a W1 recusa o início por estar lavando. Fechar essa brecha exigiria campo novo no banco ou mudança no firmware.
