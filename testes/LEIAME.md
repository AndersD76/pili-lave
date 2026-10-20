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

## Proteções já no firmware de teste
- Espera do RS-485 de 100 para 40 ms (loop preso menos tempo a cada resposta perdida).
- X16/X17 capturados no callback do ESP-NOW (não se perdem se o loop estiver preso).
- Cancelar HOME de verdade; parada do giro confirmada com reenvios.
- SAJ por RS-485 desligado por padrão (`TESTE_SAJ_POR_RS485 0` em `saj_rs485_w1.h`).

## Plano (um item por vez, com a bancada como teste de regressão)
1. Segurança: fila de comandos, homem morto, falha de escrita vira ação, HOME sem laço bloqueante.
2. Estado confiável: reset das saídas da W2 no boot, conferir "comandado x real", validar modelo/config.
3. Display <-> W1: fim de ciclo não perdido, painel com toque curto, canal ESP-NOW.
4. Telas e automático completo, nuvem; só então avaliar promover no lugar da `lava_car_485/`.
Ideia em aberto: testar a `lava_car_485/` com o SAJ fora do RS-485.
