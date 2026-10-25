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
  **ordens para a W1 a cada 2 s** (`MSG_NV_ORDEM`: lâmpada, licença, aspirador, iniciar reserva do app). `testes/waveshare1/nuvem_w1.h`: só executa as ordens (início pelo app com dedup, **lâmpada** + **vermelho piscando em erro**,
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
