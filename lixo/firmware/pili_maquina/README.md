# PILI LAVE — Firmware da Máquina (fluxo de reserva)

ESP32 acoplado ao CLP. Quatro funções: heartbeat (recebe a liberação do
pagamento e o estado da lâmpada), sensor X14, desfecho do ciclo
(wash-complete/fault) e lâmpada bicolor.

## Gravação

1. Edite `pili_maquina_config.h`: WiFi, `PILI_API_BASE`, `PILI_DEVICE_KEY`
   (= `Machine.deviceKey` no banco — o seed cria a primeira máquina) e os
   GPIOs reais (X14, relé do CLP, saídas DONE/ERRO, lâmpada G/R).
2. Placa: qualquer ESP32 com WiFi. Biblioteca extra: **ArduinoJson v7**.
3. `arduino-cli compile --fqbn esp32:esp32:esp32 . && arduino-cli upload ...`

## Comportamento

- `POST /api/machine/heartbeat` a cada 10 s — a **resposta** traz
  `lightState` e `start{reservationId, programId, duracaoSeg}`.
- Dedup do START por `reservationId` em NVS: replay nunca pulsa o relé 2×.
- Eventos (car-entered, wash-complete, fault) em fila NVS, retransmitidos
  até 200 OK — queda de rede não perde o débito.
- Fail-safe: 60 s sem resposta do backend → lâmpada apaga sozinha.
- Sem as saídas DONE/ERRO do CLP ligadas (`-1` no config), o fim do ciclo
  cai no timer interno (`duracaoSeg`) — fallback de bancada, ligue os fios.
