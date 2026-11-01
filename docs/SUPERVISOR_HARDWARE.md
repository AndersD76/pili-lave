# Supervisor de hardware e emergência independente da comunicação

Projeto elétrico (proposta, **nada instalado**). O firmware já tem watchdogs de software (tarefa, envio de rádio, W2 muda, estados parados, ciclo longo, memória). Esta proposta cobre o que software não alcança: o chip travar por completo, ou a emergência depender de rádio/RS-485.

## 1. Emergência por fiação (independente de qualquer placa)

Regra: o botão de emergência corta a energia de **potência** por contato físico, sem passar por ESP32, rádio ou RS-485.

- Botão de emergência (NF, cogumelo com trava) em série com a bobina do contator que alimenta as cargas de potência (bomba de alta pressão, motor do giro, solenoides). Soltar a emergência = contator cai = tudo desliga.
- Inversores (Delta MS300 e SAJ): ligar a emergência também na **entrada de parada externa** do inversor (o MS300 tem terminal de parada/falha externa e STO; conferir no manual qual usar e com qual parâmetro). Assim o motor para por rampa/freio mesmo sem comando Modbus.
- As placas (W1, W2, display, câmera) ficam em fonte própria, **sem** passar pelo contator: continuam vivas para mostrar a mensagem e reportar o erro à nuvem.
- Opcional: um contato auxiliar da emergência numa entrada livre da W1, só para a tela avisar "EMERGÊNCIA ACIONADA" (informação, não segurança).
- Hoje a emergência da máquina (confirmar na instalação) pode estar lida como entrada pela W1/W2 e agir via software. Se for esse o caso, esta mudança é a correção.

## 2. Supervisor externo do ESP32 (watchdog de hardware)

Para travamentos que o watchdog interno não pega (rádio, barramento I2C, CPU congelada):

- CI supervisor tipo TPL5010 / MAX705 / STWD100 (ou um microcontrolador pequeno) alimentado direto da fonte.
- A W1 dá um pulso periódico num GPIO livre ("estou viva", a cada 1 s, só se o laço principal e a máquina de estados estiverem andando).
- Sem pulso por ~10 s o supervisor faz duas coisas: (a) derruba o contator de potência (mesmo caminho da emergência); (b) dá reset/power-cycle na W1 (e, se quiser, na W2 e na câmera, via MOSFET na alimentação delas).
- Depois do reset a recuperação de boot da W1 refaz o HOME (já limitada a 3 tentativas).
- Pendência antiga da câmera (travou só com power-cycle em 2026-10-06) usa o mesmo circuito: um supervisor por placa, ou um com saídas independentes.

## 3. O que preciso para virar projeto

- Esquema elétrico atual do quadro: como a emergência está ligada hoje e qual contator alimenta o quê.
- Qual GPIO livre da W1 usar para o pulso (a W1 tem as 8 entradas e 8 saídas em uso; verificar o conector de expansão ou usar uma saída que não seja de processo).
- Modelo exato dos inversores para fechar a ligação de parada externa.

Com isso eu escrevo: o pulso de vida no firmware (poucas linhas, dentro do laço principal, condicionado ao progresso da máquina de estados), o esquema de ligação e a lista de materiais.
