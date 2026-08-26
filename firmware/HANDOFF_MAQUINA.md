# PILI LAVE — Repasse de firmware (câmera + máquina)

Para o dev que vai cuidar do ESP32 da **máquina** e da **câmera**.
Servidor em produção: `https://pili-lave-production.up.railway.app`
Código do servidor: `server/` (Next.js). Firmware da câmera: `firmware/pili_cam/`.

---

## 1) Câmera (ESP32-CAM) — o que ela precisa

A câmera é "burra de propósito": só conecta no WiFi, detecta chegada e manda
fotos para a nuvem. **Toda a inteligência (ler a placa, decidir, liberar) é
no servidor.** Nada de lógica de negócio no ESP32-CAM.

### Configuração obrigatória — `firmware/pili_cam/pili_cam_config.h`

```c
#define PILI_WIFI_SSID  "NOME_DA_REDE"      // 2.4 GHz (ESP32 não pega 5 GHz)
#define PILI_WIFI_PASS  "SENHA_DA_REDE"
#define PILI_API_BASE   "https://pili-lave-production.up.railway.app"
#define PILI_DEVICE_KEY ""                  // vazio enquanto o servidor estiver em modo teste
```

- **A rede tem que deixar o dispositivo sair para a internet em TCP 443.**
  A rede `PILI-ADM` do escritório deixa passar só DNS e bloqueia o resto
  para aparelhos novos (foi provado com diagnóstico no boot). Nos testes
  usamos hotspot de celular. Na instalação: liberar o MAC no roteador ou
  dar um roteador/4G próprio para a máquina.
- Gatilho: `PILI_MODO_SENSOR 0` = detecta chegada pela variação da cena;
  `1` = sensor de presença no GPIO13 (recomendado na instalação).
- Rajada: 6 fotos a cada 0,5 s por chegada, depois 5 s de silêncio.
- Resolução UXGA (1600×1200), JPEG qualidade 12, 2 buffers na PSRAM
  (qualidade 8 trava o `esp_camera_fb_get` — não usar).

### Compilar e gravar

- Placa: **AI Thinker ESP32-CAM** (FQBN `esp32:esp32:esp32cam`), core esp32 3.x.
  Sem bibliotecas extras (WiFi, HTTPClient, esp_camera vêm no core).
- `arduino-cli compile --fqbn esp32:esp32:esp32cam firmware/pili_cam`
  `arduino-cli upload -p COMx --fqbn esp32:esp32:esp32cam firmware/pili_cam`
- Serial 115200. No boot ela imprime diagnóstico de rede (DNS/TCP/TLS) e
  manda um frame de teste. Respostas `202` = ok.

### Onde ver o que ela manda

`https://pili-lave-production.up.railway.app/capturas` — cada foto com hora,
placa lida, confiança e resultado. Fica no banco (últimas 300).

---

## 2) Máquina (ESP32 do equipamento) — como receber a liberação da nuvem

Modelo **pull**: a máquina pergunta à nuvem; a nuvem nunca abre conexão com
a máquina (funciona atrás de NAT/4G). Tudo HTTPS, JSON.

### Autenticação

Header `x-device-key: <chave>` em toda chamada.
- Chave = `Machine.deviceKey` (cadastrada no servidor por máquina). Em modo
  teste, o servidor está **aberto** (sem `DEVICE_KEY` configurado) e usa a
  máquina padrão — pode mandar a chave vazia.
- TLS: `WiFiClientSecure` com `setInsecure()` é aceitável na fase de teste.

### Ciclo de vida (o que o firmware precisa fazer)

```
a cada ~10 s ─► POST /api/machine/heartbeat  { "state": "FREE|WASHING|FAULT", "restanteSeg": 0 }
                ◄─ { "lightState": "...", "start": null | { reservationId, programId, duracaoSeg },
                     "license": { "blocked": false } }
                     • acende a lâmpada conforme lightState (tabela abaixo)
                     • se start != null e reservationId ainda não foi executado
                       (guardar em NVS p/ deduplicar) → INICIA o programa programId

a cada ~2 s  ─► GET /api/machine/next            (fluxo "Solicitar lavagem" do app, sem reserva)
                ◄─ { "job": null | { arrivalId, plate, programId, programa } }
                     • se job != null → INICIA programId e confirma:
             ─► POST /api/machine/ack            { "arrivalId": "..." }

carro entrou ─► POST /api/machine/car-entered    { "reservationId": "..." }   (sensor X14)
fim do ciclo ─► POST /api/machine/wash-complete  { "reservationId": "..." }   (ÚNICO ponto de débito; idempotente)
falha        ─► POST /api/machine/fault          { "errorCode": "E12", "reservationId": "..." }
```

- **Tempos de ciclo são da máquina.** `duracaoSeg` vem só como referência;
  o firmware decide quanto dura cada programa (1..4).
- Implementar **os dois** caminhos de liberação (`heartbeat.start` e
  `next/ack`): o app libera por reserva (start) ou por "Solicitar lavagem"
  na chegada (next). Ambos estão ativos na nuvem.
- Deduplicar por `reservationId` / `arrivalId` em NVS: a nuvem pode repetir
  o `start` até receber `car-entered`/`wash-complete`.

### Lâmpada — `lightState`

| lightState | O que acender |
|---|---|
| `OFF` | apagada (carro já dentro / ocioso) |
| `GREEN_SOLID` | verde contínua — pode entrar |
| `GREEN_BLINK` | verde piscando 1 Hz — na fila, aguarde |
| `RED_SOLID` | vermelha contínua — placa não cadastrada |
| `RED_BLINK` | vermelha piscando 1 Hz — máquina offline/falha/manutenção |
| `RED_GREEN_ALT` | alterna verde/vermelha 1 Hz — cadastrado, mas sem saldo/reserva (abra o app) |

Sem heartbeat por 60 s a nuvem considera a máquina OFFLINE e **nunca acende
verde** — por isso o heartbeat é obrigatório mesmo ociosa.

### Exemplos (curl) para testar sem hardware

```bash
BASE=https://pili-lave-production.up.railway.app
curl -X POST $BASE/api/machine/heartbeat -H "Content-Type: application/json" -d '{"state":"FREE"}'
curl $BASE/api/machine/next
curl -X POST $BASE/api/machine/ack -H "Content-Type: application/json" -d '{"arrivalId":"..."}'
curl -X POST $BASE/api/machine/wash-complete -H "Content-Type: application/json" -d '{"reservationId":"..."}'
```

### Esqueleto Arduino (ESP32) do loop

```c
void loop() {
  if (millis() - tHb > 10000) { tHb = millis(); heartbeat(); }     // luz + start
  if (millis() - tNx > 2000)  { tNx = millis(); pollNext(); }      // job da chegada
  atualizarLampada();                                              // pisca conforme lightState
}
// heartbeat(): POST JSON → parse lightState/start → se start novo: iniciarPrograma(programId); salvar id em NVS
// pollNext():  GET → se job: iniciarPrograma(job.programId); POST ack {arrivalId}
// ao terminar o ciclo: POST wash-complete {reservationId}; em erro: POST fault
```

Referência de código já existente: `firmware/pili_lave_totem/` (ROLE 2)
implementa a parte física — pulso de relé em GPIO, fila em NVS, LVGL na tela
— mas recebe o START por ESP-NOW do totem. Para a nuvem, trocar a fonte do
START pelo polling acima; o resto (relé, contadores) reaproveita.

---

## 3) Fluxo completo, ponta a ponta

1. Carro chega → câmera detecta → 6 fotos → `POST /api/lpr/frame` (202).
2. Nuvem lê a placa (Plate Recognizer; qualquer orientação, votação em 2
   fotos) → identifica dono e saldo → cria a chegada → decide a luz.
3. Motorista toca "Solicitar lavagem" no app (ou já tinha reserva).
4. Máquina recebe `start`/`job` no polling → acende verde → inicia programa.
5. `car-entered` (X14) → `wash-complete` → débito na carteira → verde de saída.

Dúvidas: Daniel Anders. Tudo versionado em `github.com/AndersD76/pili-lave`.
