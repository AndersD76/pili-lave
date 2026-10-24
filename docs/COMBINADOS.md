# Combinados com o Giovani — LER ANTES DE COMEÇAR QUALQUER SESSÃO

Resumo do que já foi decidido, para **não repetir discussões**. Atualizado em 2026-10-23. Se algo aqui parecer errado, perguntar
ao Giovani **antes** de mudar, mas não reabrir o que está marcado como decidido.
Detalhes técnicos: `testes/LEIAME.md`, `testes/PENDENCIAS_NA_MAQUINA.md`, `docs/TROCA_DE_DISPLAY.md`, `GUIA_TECNICO_COMPLETO.md`.

## 1. Regras de trabalho
- Não mexer em `lava_car_485/` (produção estável) nem em `wave1_mestre/` (consulta). O trabalho novo fica em `testes/`.
- Um passo de cada vez, validado na bancada; a IA lê os logs seriais.
- **Gravar W1, W2 e câmera só com autorização do Giovani.** Displays novos e o display antigo (COM5) estão liberados para iterar.
- **Banco de produção e migrations: nunca sem autorização explícita, a cada vez.**
- **Commit só quando ele pedir. Push só quando ele pedir** (remoto `origin` = `AndersD76/pili-lave`).
- Sem a máquina por perto não se testa: o que exige a máquina vai para `testes/PENDENCIAS_NA_MAQUINA.md`.
- Mudou algo, atualizar os guias e o `GUIA_TECNICO_COMPLETO.md`.
- Não deduzir: agir como especialista e dizer claramente o que não se sabe. Não repetir perguntas já decididas.

## 2. Máquina e firmware (`testes/`)
- **W1 é o controlador** (máquina de estados; RS-485 só com o Delta). O **display é cliente fino** por ESP-NOW. A **W2 é só E/S**.
- SAJ em frequência fixa (F0.08), **fora do RS-485**. Filtro do RS-485 comprado: instalar e repetir os testes de ruído.
- **Quando o filtro do RS-485 chegar, o controle do SAJ pelo RS-485 volta.** A pressão da água por processo já tem campo na tela de velocidades
  (Pré-lavagem, Enxágue e Alta Pressão); hoje guarda o valor mas não age (SAJ fixo).
- A seco (sem Y13): Y13, bomba de espuma (Y7) e compressor (Y5) **não ligam**. Molhado = com a bomba em ON.
- HOME só com a máquina parada. INICIAR TESTE exige X16 e X12. INICIAR AUTOMATICO é permitido depois de um erro.
- Pausa: desliga as saídas de processo (inclusive Y13). Ao continuar, a bomba/espumas/secador voltam e **esperam 2 s** antes do movimento.
- Bancada sem carro: carrinho anda 3 s, rampa, X10 simulado volta após 1 s; guardas X12/X13.
- **Regra: carro na máquina = COM X10. Sem carro = SEM X10 (a seco).** (A batida do braço foi o modo errado, não bug.)
- **A W1 liga sempre em COM X10 e BOMBA ON** (decidido em 2026-10-23): depois de queda de energia ou regravação a máquina já está pronta para lavar
  com carro; em SEM X10 o braço bate no carro. Ao **sair da tela TECNICO** (para AUTOMATICO ou MANUAL) o display também reassume COM X10 + BOMBA ON.
  Teste a seco: o técnico escolhe BOMBA OFF / SEM X10 dentro do TECNICO.
- Giro 1→2: 7,9 s. Painel físico/controle remoto: X1, X2, X5, X6 = modelos 1..4; X4 = pausar/continuar. Armam o ciclo **sem abrir tela**.

## 3. Modelos definidos pelo Giovani
- **1:** Cor mágica (espera 45 s) → Alta pressão.
- **2:** (Espuma A, espera 45 → Cor mágica, espera 45 → Alta pressão) ×2 → Cera d'água (espera 5) → Pré-lavagem → Secagem (15 s antes de andar).
- **3:** o mesmo bloco ×3 → Cera d'água (5) → Pré-lavagem → Secagem (15).
- **4:** Espuma A (45) → Cor mágica (45) → Alta pressão → Cera d'água (**4 min**) → Pré-lavagem → Secagem.
- A confirmar: Y0 ligado durante toda a espera da cera; pausa da secagem do modelo 4 (hoje 10 s).

## 4. Display
- **Abre no AUTOMATICO.** Pedidos de fora (app, remoto, painel) iniciam o modelo sem entrar no modo automático.
- **AUTOMATICO:** PARAR TUDO, HOME, CONFIG (senha), MANUAL, TECNICO (senha), 4 modelos, INICIAR/PAUSAR, logo Pili, planilha. **Sem CANCELAR CICLO.**
- **MANUAL:** HOME e AUTOMATICO (sem VOLTAR); giro, carrinho e saídas liga/desliga (60 s).
- **TECNICO:** BOMBA ON/OFF, HOME, INICIAR TESTE, PARAR, SEM/COM X10 e **a tela de Wi-Fi**. **A bomba de alta pressão fica só aqui.**
- Senhas: CONFIG **1111**, TECNICO **2828**, PAGAMENTO **3462** (alteráveis em CONFIG).
- CONFIG: velocidades, esperas por etapa, atrasos em carro real, tempo do giro, sequência dos modelos, alterar senhas.
  (Campos da Config da produção que o firmware de testes não usa foram omitidos — a confirmar.)

## 5. Planilha, acerto e sócios
- Linhas: **Presencial, Aplicativo, Sócios (pessoas que pagam mensalidade), Bônus (ganho em promoção, valores distribuídos diferentes)**.
  O display só **conta**; a divisão de valores é do backend.
- **PAGAMENTO EFETUADO** (senha 3462): soma ao saldo, zera, grava a data.
- Acerto feito pelo **admin/app** fica **pendente** até ser **validado no display**. O display atualiza a **data** toda vez que a câmera conecta na internet.
- A parte do app e da câmera está **pendente** (ver `PENDENCIAS_NA_MAQUINA.md`, seção E).

## 6. Wi-Fi e canal (DECIDIDO — não reabrir)
- **Display e W1 NÃO conectam no Wi-Fi. Só a câmera tem internet.** A tela de Wi-Fi fica na aba **TECNICO** do display (senha 2828).
- Tudo (display, câmera, W1, W2) **nasce no canal 1**. Máquina nova, ou componente trocado, começa no canal 1.
- O técnico manda a câmera **buscar redes**; ela devolve a lista **com o canal de cada rede**, ainda no canal 1. Também deve existir **digitar o nome da rede à mão**.
- Ao escolher a rede: o display manda "vai para o canal N" à câmera, vai para o canal N e espera um "oi" da câmera; volta ao 1 e repete para a W1 e depois para a W2.
  **Só depois que todos estão no canal da rede a câmera conecta na internet** (sincronismo local primeiro, internet depois).
- Segurança: reenviar com timeout; se falhar, **voltar sozinho ao canal 1**; guardar na NVS o estado da migração (queda de energia no meio); o mesmo mecanismo serve para trocar um componente.
- Roteador mudou de canal sozinho: a câmera detecta e refaz o ajuste **automaticamente** (local primeiro, internet depois), sem senha de técnico.
- Tem que ser possível **reconfigurar a internet** quando o roteador for trocado.
- Só quando o display busca e **não acha a câmera**, ao apertar BUSCAR ele varre os 13 canais; depois de escolhido, todos ficam travados no canal.
- Upload de firmware da **câmera pelo Wi-Fi (OTA)**; o display não tem Wi-Fi, continua por cabo USB.

## 7. Pendente para quando o Giovani voltar à máquina
- Gravar W1 e câmera e validar a lista de `PENDENCIAS_NA_MAQUINA.md`.
- Câmera: data, acerto vindo do app, busca de redes com canal, migração de canal e re-sync automático.
- Display **com toque**: os dois displays novos vieram **sem o flat do toque** (pedir a versão com toque); por ora o COM5 é o que funciona.
- RS-485 do display (TX16/RX15) só validado no display antigo. Confirmar F0.10 do SAJ (55 ou 50 Hz) e terminador do Delta.

## 8. Decisão de 2026-10-24: migrar tudo para o firmware novo
- **Ainda não há clientes usando o app**, então não há problema em operar só com o firmware novo enquanto a parte da nuvem é portada.
- **Antes de migrar, o que funciona ficou guardado:** tag git `backup-w1-mestre-funcionando-2026-10-24` (no GitHub) e o antigo intacto em `lava_car_485/` + `firmware_camera/`.
  Como restaurar e como ler a memória exata das placas: `docs/BACKUP_E_RESTAURACAO.md` (a leitura das placas depende delas conectadas).
- **A migração segue a ordem de `docs/PARIDADE_ANTIGO_NOVO.md`:** (1) recuperação de boot, luz de erro, hard reset do display; (2) câmera + nuvem (canal, heartbeat, início pelo app,
  eventos com fila e ACK, licença, lâmpada, aspirador); (3) cadastro da máquina. **Decidido em 2026-10-24 (revisado no mesmo dia): a W1 fica SÓ com a operação; quem conversa com a câmera é o DISPLAY** (heartbeat, eventos com fila e ACK, licença, contagem de 15 dias ligada), pois assim um defeito na nuvem não derruba o controle no meio da lavagem. A W1 manda os eventos ao display e recebe dele as ordens (lâmpada, bloqueio de licença, aspirador, iniciar reserva do app). O teste de homem morto do movimento manual é só de operação e não muda.
