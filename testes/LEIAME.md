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
retomar o movimento. CANCELAR = parada total. Nesta etapa todos os modelos rodam so a Alta Pressao.

## Plano
1. ~~Segurança e estado confiável~~ (feito, acima). Item 2 (homem morto) feito junto com a tela manual.
2. Display <-> W1: fim de ciclo não perdido, painel físico com toque curto, canal ESP-NOW.
3. Telas e automático completo (modelos, velocidades, configuração com NVS), nuvem; só então avaliar
   promover no lugar da `lava_car_485/`. Cada tela entra uma por vez, testada na bancada.
Ideia em aberto: testar a `lava_car_485/` com o SAJ fora do RS-485.
