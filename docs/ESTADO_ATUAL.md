# Estado atual do projeto — resumo para quem vai continuar (atualizado em 2026-10-27)

Este é o **ponto de entrada**. Ele diz o que existe hoje na máquina, o que foi decidido, o que foi feito em produção, e em que ordem ler o resto.
Os outros documentos têm o detalhe; este diz onde ele está e o que mudou por último.

## 1. Arquitetura que está rodando na máquina (Pili Clean, unidade João Carlon, Erechim)
| Peça | Papel | Onde está o código |
|---|---|---|
| **W1** (Waveshare ESP32-S3, COM24) | **Só operação**: máquina de estados do ciclo, RS-485 com o Delta, painel físico/controle remoto, ESP-NOW com a W2 e o display. Guarda **eventos** na NVS até o display confirmar. **Não fala com a câmera.** | `testes/waveshare1/` |
| **W2** (Waveshare, COM10) | E/S burra (sensores, saídas: Y13 bomba alta pressão no canal 3, luzes DO7, aspirador DO8) | `testes/waveshare2/` |
| **Display** (ESP32-S3-Touch-LCD-7, COM11) | Cliente fino **e hub da nuvem**: fala com a câmera (heartbeat a cada 5 s, fila de eventos com ACK, licença) e manda **ordens** à W1 a cada 2 s (lâmpada, licença, aspirador, iniciar reserva do app) | `testes/display/` (`nuvem_display.h`, `wifi_tecnico.h`, `cadastro_tecnico.h`) |
| **Câmera** (ESP32-CAM, **v6**) | Única com Wi-Fi/HTTPS: heartbeat/eventos/foto da placa. Informa ao display a rede conectada (`MSG_REDE_INFO`). Atualiza por **OTA** | `firmware_camera/` |
| **Backend** (Next.js + Prisma/Postgres Neon, Railway, branch `main`) | Reservas, pagamento, leitura de placa, heartbeat, admin, PWA | `server/` |
- O antigo (`lava_car_485/`, display mestre) e `wave1_mestre/` ficam **intactos, só consulta**. Backup: tag git `backup-w1-mestre-funcionando-2026-10-24` + `docs/BACKUP_E_RESTAURACAO.md`.
- Protocolo ESP-NOW: `protocolo_teste.h` **idêntico** em `testes/display/`, `testes/waveshare1/` e `testes/display_sem_toque/`. Mensagens 30–35 (teste/config), 36–38 (W1↔display: `MSG_NV_EVT`, `MSG_NV_EVT_ACK`, `MSG_NV_ORDEM`),
  4–22 compatíveis com a câmera (canal, Wi-Fi, heartbeat 7/8, evento 9/10, scan, cadastro 13–20, re-sync 21, **rede da câmera 22**).
- Todos no **canal 6** (o do roteador). A migração de canal é orquestrada pelo display (câmera → W1/W2 → credenciais), com rollback; a câmera v5+ pede **re-sync** ao display se o roteador mudar.

## 2. Estado em 2026-10-25/27 (validado na máquina)
- **Teste com o app, de ponta a ponta, funcionou** (reserva RYD1E43, modelo 1): reserva paga → câmera leu a placa → luz verde → `START pelo app` → X14 → ciclo → `car_entered` e `wash_completed` no backend → COMPLETED/REDEEMED.
- Firmware gravado: W1 `ce4ae90`, W2 (proteção de canal), display `3da4edc`/`1e2f298`/`5776362`+, câmera **v6** publicada na `main` (push `9915b00`; v5 em `b976845`).
- Nada de produção foi migrado; as migrations da loja de conveniência **não** estão no banco de produção (falta `User.codigoCliente`).
- **Commits locais ainda SEM push** na branch `loja-conveniencia` (de `2874f61` até o último de documentação). Só os arquivos da câmera foram para a `main`, por push separado.

## 3. Decisões do Giovani (valem; não reabrir sem pedir)
1. **W1 só opera; o display fala com a câmera** (revisado em 2026-10-24: um defeito na nuvem não pode derrubar o controle no meio da lavagem).
2. **A luz verde só pode acender quando a lavagem foi liberada**: (a) pelo app (câmera leu a placa ou "Já estou na máquina") ou (b) controle remoto / botão INICIAR AUTOMATICO. Ela é a autorização para o carro entrar.
3. **Falha ou parada no meio do ciclo deve falhar a reserva e liberar o veículo na hora** (estorno automático). Implementado: AUTO_ERRO e PARAR TUDO/CANCELAR do operador mandam o evento de falha ao backend (`/api/machine/fault`: FAILED + estorno).
4. **Sem HOME automático com carro dentro.** X15 perdido no processo → para tudo e fica em erro (vermelho piscando); o lavador faz o HOME. (O código antigo fazia HOME e o braço bateu no carro em 2026-10-25.)
5. Ciclo concluído com sucesso **não** abre pop-up com OK (só aviso curto); **erro** continua com pop-up e OK.
6. Ao ligar, a W1 sobe em **COM X10 + BOMBA ON**; o display reassume isso ao sair do TECNICO.
7. Wi-Fi, canal e senhas: ver `docs/COMBINADOS.md` seção 6. Aspectos de sócios/bônus no app: **a discutir depois**.
8. Quando o display perde a W1 por >5 s, informa à câmera "ocupada" (o app não reserva) e mostra "SEM CONTATO COM A MAQUINA"; ao voltar, "COMUNICACAO REESTABELECIDA".
9. Regras de trabalho: sem gravar W1/W2/câmera sem "grava" explícito; sem tocar em banco de produção/migration sem autorização a cada vez; commits só quando pedidos; **push só quando pedido** (ver `CLAUDE.md`).

## 4. Telas novas do display (2026-10-25)
- **AUTOMATICO:** o botão PAUSAR vira **CANCELAR ESPERA** (vermelho) quando a W1 está armada esperando o carro (X14). Mensagens de licença (aviso 40 d, bloqueio 50 d) vêm do display.
- **TECNICO > REDE > WI-FI:** campo em edição sobe acima do teclado, botão OK; **senha e rede guardadas** (NVS `rede`: `w_ssid`,`w_pass`,`w_can`); painel `Canal N  W1: ok  W2: ok / Camera: vista  Nuvem: ONLINE`;
  "Rede da camera: NOME (dBm)" (v6) ou "Ultima enviada"; mensagem de fim só diz "CONECTADA" quando o backend respondeu (limite de 3 min).
- **TECNICO > REDE > CADASTRO** (nova máquina / trocou display / trocou câmera): ainda **não testado**.

## 5. O que ficou acontecendo em produção (banco) por ordem do Giovani, em 2026-10-25
- Reserva `cmvo5xph…` (Geizon Munis, ACTIVE, R$ 1,00) **cancelada e estornada** ("reset para novo teste"); luz da máquina zerada.
- Reserva `cmvo9b8en00e…` (Giovani pili, placa RYD1E43, ENTERED após o abort do X15) marcada **FAILED**, pedido cancelado, **R$ 1,00 estornado** (carteira 17,00 → 18,00).
- Foram scripts temporários (apagados). O sistema de permissões bloqueou a primeira tentativa; a segunda foi executada **a pedido explícito** do Giovani.
- **Problema conhecido:** o `@prisma/client` da branch conhece `User.codigoCliente`, que não existe em produção; scripts que leem a tabela inteira de `User` falham. Usar `select` mínimo.

## 6. O que aprendemos sobre o backend (para não redescobrir)
- Reserva: `HELD` (paga, esperando) → `ACTIVE` (placa lida ou "Já estou na máquina": luz **verde**, heartbeat manda `start`) → `ENTERED` (X14) → `COMPLETED`/`FAILED`.
  Só dá para cancelar em HELD/ACTIVE (`/api/reservations/[id]/cancel`); em ENTERED não. A PWA só mostra o botão de cancelar em **HELD** (lacuna).
- `expireStale()`: ACTIVE sem X14 há 5 min volta a HELD; ENTERED vira FAILED+estorno após 2× a duração do programa. Roda no cron `/api/cron/expire-reservations` (POST, aberto se não houver `CRON_SECRET`) e em chamadas a `/api/reservations` e à leitura de placa.
  Não achamos agendamento do cron no repositório.
- `computeLight()` manda a lâmpada no heartbeat; a W1 ociosa **segue a lâmpada do backend** (verde preso se a reserva ACTIVE ficou).
- Leitura de placa: filtro "cena parada (não analisada)" compara cada foto com a **anterior**; com o carro parado só há 1 análise forçada por minuto (placa pode demorar até 1 min).
- `/admin/lavagens` lista **vouchers** (fluxo antigo), não as reservas do app. `remainingSec` vem sempre 0.

## 7. Incidentes e medições de 2026-10-25 (detalhe nas pendências)
- X15 instável → abort + HOME → braço bateu no carro (corrigido). Queda de energia ~3 min (parada de emergência). **Ruído elétrico** nas transições do inversor: pulsos fantasmas no painel (X1/X2/X5/X6), X11 oscilando, CRC no RS-485, falhas no link com a W2.
- `[SEGURANCA] Y7 bloqueado` na Cor Mágica (intertravamento ignora o Y1); correção preparada mas **não gravada** por decisão do Giovani.

## 8. Ordem de leitura sugerida
1. Este arquivo. 2. `CLAUDE.md` (regras). 3. `docs/COMBINADOS.md` (decisões). 4. `testes/PENDENCIAS_NA_MAQUINA.md` (**seções H e I** são as mais recentes). 5. `docs/PARIDADE_ANTIGO_NOVO.md` (o que o novo já faz vs o antigo).
6. `testes/LEIAME.md` (base de testes e telas). 7. `GUIA_TECNICO_COMPLETO.md` (referência técnica; seção 3.13 e as do backend). 8. `docs/BACKUP_E_RESTAURACAO.md`, `docs/TROCA_DE_DISPLAY.md`, `firmware_camera/release/LEIAME.md`.

## 9. Como compilar e gravar (resumo)
- W1/W2: `arduino-cli compile|upload --fqbn esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc` (W1 = COM24, W2 = COM10). **Abrir a serial da W1 a reinicia.**
- Display: `--fqbn esp32:esp32:esp32s3:PartitionScheme=huge_app,PSRAM=opi,FlashSize=16M` (máquina = COM11); compilar leva ~5 min; **nunca dois compiles ao mesmo tempo**; às vezes precisa BOOT+RESET.
- Câmera: PlatformIO em `firmware_camera` (`pio run`); publicar = copiar o `.bin` para `server/public/firmware/camera.bin`, subir `camera-version.json` e dar **push na `main`** (Railway publica; a câmera confere a cada 10 min). É **deploy de produção**.
