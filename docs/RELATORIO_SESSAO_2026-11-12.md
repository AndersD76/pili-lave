# Relatório da sessão de 12/11/2026 — câmera v10, atualização remota (OTA), W1 v2 e a falha da Espuma A

Escrito para o Giovani (e para uma próxima conversa com o Claude) retomarem **sem estar conectados à máquina**. Tudo abaixo foi conferido na máquina, no banco de produção (só leitura) ou nos arquivos citados.

## 1. Onde as coisas estão ao fim do dia

| Placa | O que está gravada agora | Observação |
|---|---|---|
| **W1 (COM24)** | **v2** = `main` + atualização remota + mudanças da W1 de 06/11 + regra dos 3 s + registro do X10/X12 + proteção G7 do retorno parcial | gravada por cabo às ~17:15; confirmou "firmware v2 confirmado como bom" aos 60 s |
| **Display (COM11)** | `main` + atualização remota (v1), layout de memória novo | gravado às ~16:25; não imprime nada na serial que dê para ler; comunica com a W1 (ordens com 1 s de idade) |
| **Câmera** | **v10** | publicada na `main` (push 16:3x); relatórios de diagnóstico normais |
| **W2** | não mexida | cabo W1↔W2 limpo em todas as leituras |

Layout de memória novo na W1 e no display: `PartitionScheme=app3M_fat9M_16MB` (2 partições de app de 3 MB). A área dos dados guardados (contadores, ocorrências, configuração) **ficou no mesmo lugar e foi mantida**.

## 2. O que foi feito

1. **Câmera v10** (`firmware_camera/`): (a) quando o envio da foto falha, desce um degrau a cada 2 falhas seguidas — qualidade JPEG 20→30→40 e depois resolução 1600×1200→1280×1024→1024×768 — e sobe um degrau a cada 20 fotos entregues; (b) o watchdog de 30 s fica pausado durante heartbeat, diagnóstico e eventos (a internet lenta de 12/11 gerou 9 reinícios por WATCHDOG); (c) entrega firmware ao display/W1 (**dormente** até existirem `w1-version.json`/`display-version.json` no servidor). Diagnóstico novo: `niv`, `ow1`, `odp`.
2. **Atualização remota (OTA)** do display e da W1 pela câmera: camera baixa o `.bin` para a PSRAM, confere o MD5 e entrega por ESP-NOW (camera → display → W1) em pedaços de 200 bytes com confirmação; o alvo grava na partição reserva, confere o MD5 e só então troca; **rollback automático** se a placa não ficar 60 s de pé. Só com a máquina parada. **Ainda não testada a entrega real** (as duas placas foram gravadas por cabo). Publicar uma versão: `node server/scripts/publicar-firmware.mjs <w1|display> <arquivo .ino.bin> <versão>` + commit + push na `main`.
3. **Regra dos 3 s no avanço** (pedido do Giovani: "o carro é sempre maior que esse tempo"): em carro real, o X10 apagado nos primeiros 3 s de deslocamento é ignorado; se durar 500 ms, a pausa G4/G5 para e espera o X10 voltar. Mais o **registro** `[DX]` (serial) e ocorrência tipo 7.
4. **Mudanças da W1 de 06/11** (já estavam na máquina antes de hoje, descoberto ao ler a memória da W1): X10 sem vigia no giro, X7 como contraprova do lado 2, pausa/retoma na falha de escrita do Delta.
5. **G7 (retorno parcial protegido)** — ver seção 3.
6. Backups das memórias das placas e binários candidatos (seção 5).

## 2.1 Descoberta importante: o que havia na W1

Leitura da memória da W1 (COM24, `--no-stub`): o app em 0x10000 tinha 969.440 bytes, **idêntico (194 bytes de diferença: hash e caminho do build) ao build de 06/11 20:39** do commit `3b6ef55`. Ou seja, as mudanças de 06/11 **já rodavam** (alguém gravou, sem registro de quando). Layout antigo, otadata vazio.

## 3. A falha da Espuma A (2ª vez) — `CARRO TRAVADO (retorno X10)`

**Linha do tempo (horário da W1/Brasília):** 16:41 Espuma A (ok) → 16:43 Cor mágica → 16:44 Pré-lavagem → 16:45:44 Espuma A de novo → falha. Ciclo estornado (R$ 1,00).

**O que os dados mostram**
- O erro foi no **retorno parcial até o X10** (sub-estado `SP_REV_X10`, `idx=3`). O registro O2 (X13 com X10, 1500 ms) de 16:46:05 tinha X7, X10, X13, X15 acesos e **X0 parado**.
- A caixa-preta da W1 (NVS "erro", guarda os 5 últimos erros) tem 3 do mesmo tipo: 06/11 15:28 (Alta Pressão), 11/11 18:18 (Espuma A) e 12/11 16:46 (Espuma A); o histórico da nuvem tem ainda 2 de 02/11 (Espuma A). Todos em processos **com giro**, e nos 3 da caixa-preta o **X10 estava aceso** no erro.
- O2 ("X13 com X10"): 7 ocorrências desde 02/11, **todas durante retornos**, nunca no avanço; 3 ciclos seguiram, 4 falharam.

**Explicação do Giovani (confirmada pelos dados)**
- O avanço terminou **antes de o X10 apagar** (não foi longe o bastante). O retorno parcial só termina depois de ver o X10 **apagar e acender de novo**; como ele nunca apagou, o carrinho foi para trás sem parar e **ignorou o X12** até bater no fim de curso. A proteção do X12 nesse retorno só valia no teste a seco.
- **Sensores X12 e X13 ficam NO CARRINHO e há uma régua em cada ponta da máquina.** Passando do X12, o X12 lê a régua de trás e depois o X13 (lado da frente do carrinho) lê essa mesma régua. **X13 aceso num retorno = passou do X12**, não "foi ao fim de curso da frente". (Registrado em `docs/REGRAS_RETOMADA_CICLO.md`.)
- A regra do rascunho "X13 encerra o avanço" estava baseada na suposição errada e **foi retirada**.

**Correção gravada na W1 v2 (G7)**, em carro real, no retorno parcial: **para e dá erro** "Retorno parcial: passou do X12 sem X10" se o **X12 ficar aceso por 1000 ms** (régua comprida; pedido do Giovani) **ou** se o **X13 acender** sem estar aceso na largada. Antes só parava batendo.

**O que continua aberto:** *o que encerrou o avanço cedo?* Hipótese: o X10 apagando por um instante (respingo, falha de leitura) e voltando; o código aceita 150 ms de X10 apagado como "fim do carro". O registro novo mostra isso na serial.

## 4. O que a captura da serial da W1 mostrou (arquivo `W1_serial_ciclo_teste_v2.txt`, 138 KB, ~30 min)

- **Nenhum erro de ciclo nessa captura.** Vários avanços normais: ~24–26 s de deslocamento, o X10 apaga perto de 24 s (fim real do carro), "avanço aceitou a perda do X10", termina em ~25–26 s; retornos parciais achando o X10 de volta em ~2,2 s; retorno ao X12 com `X12 acendeu → confirmado (300 ms) → parou 684 ms depois da 1ª vez que o X12 acendeu`.
- **Giro 1→2 e X7:** `1->2 tempo 7900ms -> confere o X7 (viu_x7=1, no_x7=0)` → `X7 já passou → pulsos de volta` → `X7 não achado → inverte o sentido` → `X7 confirmou o lado 2 (pulsos=2)` → **logo depois `braço FORA do lado 2`** e o avanço começa. O X7 acende só quando o braço passa e **não fica aceso no ponto onde o giro termina** (o braço escorrega para fora do sensor ou o sensor está na borda). A máquina anda sem o X7 porque ele é só contraprova (decisão anterior do Giovani). **Pergunta em aberto (ver seção 6, item 1).**
- **Ruído nas entradas locais da W1:** `pulso curto descartado` dos botões do painel apareceu **459 vezes** na captura e houve **73 transições do X7**, muitas em liga/desliga rápido com a máquina parada. As entradas locais (X1..X6, X7) estão captando ruído. Cabo W1↔W2: `crc_ruim=0`, `perdidos=2`, `espurios=13` em ~1 h (bom).

## 5. Arquivos e branches

**Em `C:\Users\giova\backups_placas\2026-11-12\`** (fora do git): `backup_display_COM11_2026-11-12.bin` (manhã), `backup_display_COM11_antes_da_gravacao_2.bin` (16 MB, antes da gravação de hoje à tarde), `backup_W1_COM24_0x0-0x290000.bin` (bootloader, partições, NVS e os dois apps da W1 de antes), `W1_app0_imagem.bin`, `W1_nvs_apos_erro_espuma_a.bin` (caixa-preta), `W1_serial_ciclo_teste_v2.txt`.
Para voltar a W1: `esptool --chip esp32s3 --port COM24 --baud 115200 --no-stub write-flash 0 <arquivo>` (a leitura/escrita da W1 **só funciona sem o stub**; usar `PYTHONUTF8=1 PYTHONIOENCODING=utf-8`). Para o display: `esptool --chip esp32s3 --port COM11 --baud 460800 write-flash 0 <arquivo>`.

**Binários candidatos** em `C:\Users\giova\backups_placas\candidatos_2026-11-12\`: `w1_v2_g7.ino.bin` (o que está na W1), `display_ota_main.ino.bin` (o que está no display), bootloader e partições.

**Branches** (GitHub `AndersD76/pili-lave`): `main` (já tem a câmera v10, o script de publicação e as docs até `2f0dd71`); **`ota-mais-w1-06-11`** (código da W1 v2 e do display com OTA; **não está na `main`**); `camera-v10-ota` e `relatorio-sessao-2026-11-12` (docs); `wip-ota-display-w1-2026-11-09` e `link-uart-w1-w2` (históricos). **A `main` não tem o firmware da W1/display gravado hoje**: está só na branch `ota-mais-w1-06-11` (commit `0e698e6`).

## 6. Pendências e decisões abertas

1. **X7 (decisão do Giovani):** (a) só informar, é contraprova; (b) exigir X7 aceso no lado 2 para seguir (hoje pararia em toda lavagem, porque ele apaga depois do giro); ou (c) ajustar o giro para o braço **parar dentro do X7** (parar assim que o X7 for lido; talvez ajuste mecânico do sensor).
2. **Descobrir o que encerra o avanço cedo** na falha da Espuma A: rodar Espuma A várias vezes com a serial capturada (linhas `[DX]`) e ver se aparece `X10 APAGOU` seguido de `avanço terminou ... X10=1` com pouco deslocamento. Se sim: exigir o X10 apagado por mais tempo (ex.: 500 ms) ou deslocamento mínimo antes de aceitar o fim do carro.
3. **Cera d'água passando do X12 no retorno FINAL** (mesmo mecanismo): depois de ler o X12 o código espera 300 ms e faz rampa de 350 ms; nas capturas: o X12 acende e o carrinho para 684 ms depois. Proposta pendente: reduzir a confirmação no retorno final ou baixar a velocidade na aproximação; **não mexi**. Avaliar com a medida da régua (comprimento) e a velocidade.
4. **Ruído nas entradas locais da W1** (459 pulsos curtos do painel em 30 min): checar aterramento/blindagem e fiação do painel e do X7; considerar filtro maior nas entradas.
5. **Testar a atualização remota de verdade:** publicar a W1 v3 (ex.: só o número da versão muda) e o display v2 e acompanhar; só com máquina parada. Os dois testes de rollback (placa que não fica 60 s de pé) ainda não foram feitos.
6. **Trazer o firmware gravado para a `main`** (hoje só na branch `ota-mais-w1-06-11`), depois de validar na máquina.
7. **Câmera:** conferir nos relatórios (`node server/_diag_camera.mjs AAAA-MM-DD`) se os reinícios por WATCHDOG sumiram e se o degrau da foto (`niv`) desce quando a internet cai.
8. Reaplicar/avaliar o X13 como parada de emergência também no retorno FINAL (hoje só no retorno parcial).
9. **DEVICE_KEY** ainda vazia no Railway (endpoints abertos, "fase de teste") e **senhas padrão do display** (1111/2828/3462) estão em docs públicos do repositório.
10. Antes de desligar a leitura da serial: **fechar a COM24 reinicia a W1**; só com a máquina parada e o carrinho/braço no zero (se pedir "Religou fora do zero", tocar HOME no display).

## 7. Comandos úteis para retomar

```
# o que a máquina fez no dia (somente leitura)
node server/_diag_maquina.mjs 2026-11-12
node server/_diag_camera.mjs 2026-11-12
# ler a caixa-preta da W1 (erros guardados): esptool read-flash 0x9000 0x5000 (--no-stub, 115200) e decodificar
```
