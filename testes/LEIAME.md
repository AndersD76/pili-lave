# testes/ — bancada da Alta Pressão (etapa 0)

Base nova, construída passo a passo. `wave1_mestre/` (experimento) e `lava_car_485/`
(versão estável do dia) ficam intactas, só para consulta e como plano B.

## Placas
- `display/` — tela única: HOME, INICIAR TESTE, PARAR, BOMBA ON/OFF + diagnóstico.
- `waveshare1/` — controladora: máquina de estados, RS-485 do Delta, ESP-NOW. Canal fixo em 1.
- `waveshare2/` — sensores/saídas (igual a `wave1_mestre/waveshare2`).
- `protocolo_teste.h` — **idêntico** em `display/` e `waveshare1/` (conferir com `cmp`).

## Fiação do RS-485 que funcionou
Waveshare 1 -> Delta, **só os dois**, 120 ohm nas duas pontas. O **SAJ fica fora do RS-485**
(parte por terminal, frequência fixa em F0.08, bomba ligada pelo Y13). O fio RS-485 do
display e os da Waveshare 2 ficam desligados.

## Como rodar o teste
1. Esperar ~1 min parado (linha de base). 2. HOME. 3. Escolher bomba OFF/ON.
4. INICIAR TESTE (emergência na mão). 5. Ler o resumo `[RS485]` no serial (a cada 5 s).
Abrir a porta serial reinicia a Waveshare 1 (o botão da bomba volta a OFF).

## Medições (falha = transações do RS-485 sem resposta ou com CRC errado, em movimento)
| Situação | Falha | Escritas perdidas |
|---|---|---|
| Parado | 0% | 0 |
| SAJ no RS-485, bomba OFF | 18% a 50% | 0 a 38 |
| SAJ no RS-485, bomba ON | 71% a 80% | 92 a 138 |
| **SAJ fora do RS-485, bomba OFF** | **3%** | **0** |
| **SAJ fora do RS-485, bomba ON** | **9%** | **1** |

Aterramento (A: malha só na W1; B: malha também nos inversores) **não mudou** o resultado.
Causa: o SAJ no barramento. Filtro de RS-485 comprado, ainda não instalado.

## Proteções no firmware de teste (todas validadas na bancada)
- Espera do RS-485 de 100 para 40 ms; X16/X17 capturados no callback do ESP-NOW.
- **Item 1** — o callback do rádio só enfileira; PARAR é flag de prioridade e cancela as esperas.
- **Item 3** — HOME sem laço bloqueante (a tela e o status seguem vivos); cancelar e PARAR funcionam.
- **Item 4** — comando ao Delta é repetido até entregar; se não entregar, para tudo com erro;
  6 escritas perdidas seguidas também param o ciclo.
- **Itens 5/6** — a W1 manda a W2 desligar tudo no boot e reenvia saídas divergentes (comandado x real).
- **Homem morto** — movimento manual (giro/carrinho) só enquanto o botão é segurado; sem sinal do
  display por 0,5 s o motor para (log `[MANUAL] parou ... motivo=DEADMAN`). Teto de 20 s.
- **HOME** só com a máquina parada; **INICIAR** só com X16 (braço no home) e X12 (carrinho recuado).
- SAJ por RS-485 desligado por padrão (`TESTE_SAJ_POR_RS485 0` em `saj_rs485_w1.h`).
- Tela: o canto inferior esquerdo não responde ao toque; controles críticos ficam em cima/no meio.

## Diagnóstico no serial (a cada 5 s)
`[RS485]` (ok/sem resposta/CRC, mov, giro, home), `[LINK]` (maior pausa do loop, maior intervalo da
W2, envios entregues/falhos, reconciliações), `[HOME]` (estados e sensores), `[MANUAL]` (início/parada
com motivo), `[GIRO]` (sensores e decisões). Análise: `testes_ruido_rs485/ferramentas/analisar_ciclos.py`.

## Tela AUTOMATICO (validada)
Fluxo completo: modelo 1..4 -> INICIAR -> luz verde, espera X14 -> X15 -> 6 s (luz vermelha) -> confere
HOME (X16) -> processo -> concluido. **PAUSAR** para o motor e desliga as saidas de processo (Y13, Y7,
solenoides, compressor, Y0); **CONTINUAR** religa e espera 2 s para restabelecer a pressao antes de
retomar o movimento. CANCELAR = parada total. Os 4 modelos rodam completos (sequencias do cliente, com
esperas por etapa em `g_modelos_espera`; as esperas so valem no modo CARRO REAL). Botao SECO/CARRO REAL
na tela AUTOMATICO (so com a maquina parada).

## Plano
1. ~~Segurança e estado confiável~~ (feito, acima). Item 2 (homem morto) feito junto com a tela manual.
2. Display <-> W1: fim de ciclo não perdido, painel físico com toque curto, canal ESP-NOW.
3. Telas e automático completo (modelos, velocidades, configuração com NVS), nuvem; só então avaliar
   promover no lugar da `lava_car_485/`. Cada tela entra uma por vez, testada na bancada.
Ideia em aberto: testar a `lava_car_485/` com o SAJ fora do RS-485.

## Display e W1 — telas e funções (compiladas em 2026-10-22; NADA disso foi gravado na W1 nem testado na máquina)
Display (`testes/display/`, 800x480, abre no **AUTOMATICO**):
- **AUTOMATICO:** PARAR TUDO, HOME, CONFIG (senha), MANUAL; 4 modelos, INICIAR AUTOMATICO, PAUSAR; **TECNICO** (senha 2828);
  **TIPO** do próximo ciclo (presencial > aplicativo > sócio > bônus; volta a presencial a cada ciclo); logo Pili;
  **planilha de lavagens** (por modelo e por tipo, desde o último acerto) e **PAGAMENTO EFETUADO** (senha 3462 -> acerto).
- **MANUAL:** HOME, AUTOMATICO, giro e carrinho (segurando), e liga/desliga de válvula, espuma A/B, cor mágica, secagem e cera
  (só parado, desligam sozinhas em 60 s; bomba de espuma e compressor só com BOMBA em ON). Y13 (alta pressão) só no TECNICO.
- **TECNICO:** BOMBA ON/OFF, HOME, INICIAR TESTE, PARAR e **CARRO SECO/REAL**.
- **CONFIG** (senha 1111): velocidades, esperas dos modelos por etapa, atrasos em carro real, tempo do giro 1->2 por processo,
  **sequência dos modelos** e **alterar senhas** (ficam na memória do display). Valores de processo na NVS da W1, só alteram parado.
- **Aviso de fim de ciclo** (concluído/erro) sobre qualquer tela até tocar OK. **Painel físico/controle remoto** (X1,X2,X5,X6 =
  modelo 1..4; X4 = pausar/continuar) arma o ciclo sem abrir tela, e o display salta para o AUTOMATICO.
W1: tabelas e NVS (`cfg`, `giro`, `lav`), mensagens ESP-NOW 32..35 (config set/req/dump e data) em `protocolo_teste.h`.
Planilha: tipos presencial/aplicativo/sócio/bônus; a **data** só existe quando a câmera mandar `MSG_TESTE_DATA` (câmera ainda não envia).
Ver `PENDENCIAS_NA_MAQUINA.md` (seções A–E) e `docs/TROCA_DE_DISPLAY.md` (displays novos sem flat de toque).

## Nuvem e estado na máquina (2026-10-25)
O **display** conversa com a câmera (`display/nuvem_display.h`: heartbeat, fila de eventos com ACK, licença, ordens à W1) e a **W1** só opera (`waveshare1/nuvem_w1.h`: inicia por reserva do app,
lâmpada, aspirador, 16 eventos na NVS até o display confirmar). Mensagens 36–38 em `protocolo_teste.h` (idêntico em display/W1/display_sem_toque). **Tudo isso já foi gravado e validado na máquina**
(teste com o app de ponta a ponta). Telas novas/alteradas: botão CANCELAR ESPERA no AUTOMATICO, tela Wi-Fi (senha guardada, rede da câmera, painel W1/W2/câmera/nuvem), cadastro da máquina (sem teste).
Estado completo, decisões e como gravar: **`docs/ESTADO_ATUAL.md`**.

## Pendências para testar NA MÁQUINA
Lista completa e atualizada em **[PENDENCIAS_NA_MAQUINA.md](PENDENCIAS_NA_MAQUINA.md)**.
