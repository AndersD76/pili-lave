# Teste de ruído do RS-485 — como repetir (ex.: depois de instalar o filtro)

Pasta **congelada** em 20/10/2026. O firmware aqui é cópia do `testes/` naquele dia; não editar,
para a comparação continuar válida. Evoluções ficam em `testes/`.

## O que tem aqui
- `firmware/` — display, waveshare1 e waveshare2 exatamente como nas medições.
- `ferramentas/capturar_serial.py` — grava o serial da Waveshare 1 num arquivo.
- `ferramentas/analisar_ciclos.py` — resume um ou mais logs (falha %, escritas perdidas, giros).
- `logs_referencia/` — logs das medições de 20/10/2026 (para comparar com os novos).

## Como medir (a mesma sequência de sempre)
Condições fixas: sem carro e sem água, emergência ao alcance da mão, os dois inversores
**energizados** (visor aceso), a mesma fiação em todas as rodadas.

1. **Gravar as placas** (a partir da pasta `firmware/`; ajustar a COM):
   - Waveshare 1: `arduino-cli compile --fqbn "esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc" waveshare1` e o mesmo com `upload -p COMxx`.
   - Waveshare 2: igual, na pasta `waveshare2`. Display: `--fqbn "esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi,FlashSize=16M"` na pasta `display`
     (se não conectar, BOOT+RESET e tentar na hora).
2. **Capturar o serial** (abre a porta e reinicia a Waveshare 1 uma vez; o botão da bomba volta a OFF):
   `python ferramentas/capturar_serial.py COM24 1500 logs_novos/depois_filtro_A.log`
   Não reabrir a porta durante o teste. Dar um nome que diga a situação (ex.: `com_filtro_saj_fora.log`).
3. **Parado por 1 minuto**, sem apertar nada (linha de base; deve dar ~0% de falha).
4. **HOME**, se o braço não estiver na posição 1.
5. **Um ciclo com a bomba em OFF**, depois **um ciclo com a bomba em ON** (botão do canto
   superior esquerdo; confira o texto "BOMBA: ON"). Repetir cada um **pelo menos 3 vezes**: a
   falha varia entre rodadas (a bomba OFF já deu de 3% a 50% em situações diferentes).
6. **Analisar**: `python ferramentas/analisar_ciclos.py logs_novos/depois_filtro_A.log logs_referencia/w1_seguranca.log`
   O resumo final deixa os números lado a lado.

## Cenários para repetir com o filtro
- **A) SAJ fora do RS-485** (como terminou em 20/10): RS-485 só Waveshare 1 -> Delta, 120 ohm nas pontas,
  SAJ com frequência fixa (F0.08) e partida por terminal. Mede se o filtro ajuda o Delta sozinho.
- **B) SAJ de volta no RS-485** (o que realmente queremos poder usar): RS-485 Waveshare 1 -> SAJ -> Delta,
  120 ohm na Waveshare 1 e no Delta. No firmware, ligar o SAJ por RS-485 trocando
  `#define TESTE_SAJ_POR_RS485 0` por `1` em `firmware/waveshare1/saj_rs485_w1.h` (só nessa cópia de teste).
  Parâmetros do SAJ (relatorio_inversores_delta_saj_v2.docx, em Downloads): FC.00=4, FC.01=5 (9600),
  FC.02=1 (8E1), F0.03=0, F0.10 = frequência máxima (o firmware assume 55 Hz como 100%: conferir).
  Onde o filtro foi instalado deve constar no nome do log.

## Valores de referência (falha = sem resposta + CRC errado, em movimento)
| Situação | Falha | Escritas perdidas | Log |
|---|---|---|---|
| Parado | 0% | 0 | todos |
| SAJ no RS-485, bomba OFF | 18% | 1 | w1_seguranca.log |
| SAJ no RS-485, bomba ON | 71% | 92 | w1_seguranca.log |
| SAJ no RS-485, bomba ON, aterramento A | 80% | 138 | w1_pos_terra_final.log |
| SAJ no RS-485, bomba ON, aterramento B | 73% | 118 | w1_pos_terra_final.log |
| SAJ fora do RS-485, bomba OFF | 3% | 0 | w1_sem_saj_final.log |
| SAJ fora do RS-485, bomba ON | 9% | 1 | w1_sem_saj_final.log |

## Critério de sucesso do filtro (proposto)
No cenário **B** (SAJ no barramento), bomba ON, em 3 ciclos seguidos: falha **até ~10%**, no máximo
**2 escritas perdidas** por ciclo e **nenhum erro** de ciclo — ou seja, no nível do cenário A de hoje.
Se ficar bem acima disso, o filtro não resolveu e as alternativas são um RS-485 separado só para o
SAJ ou a frequência do SAJ por terminal (multivelocidade).
