# Guia de Integração — Firmware do Display Waveshare ESP32-S3

**Pili Lave · Agosto/2026**
Documento para o programador do firmware do display (Waveshare ESP32-S3-Touch-LCD-7).
Tudo que o display precisa fazer para se comunicar com o backend na nuvem.

---

## 1. Visão Geral

O display é o master da máquina. Ele controla os módulos Waveshare 8DI-8DO via ESP-NOW, o inversor Delta VFD-MS300 via Modbus RTU, e agora também se comunica com o backend Pili Lave via Wi-Fi/HTTP.

A comunicação com o backend é **pull** — o display faz POST a cada 10 segundos e a resposta traz comandos. Não há MQTT, não há websocket, não há porta aberta no roteador. Funciona atrás de NAT/4G.

### Endpoints que o display usa

| Endpoint                          | Quando chamar                                      |
|-----------------------------------|----------------------------------------------------|
| `POST /api/machine/heartbeat`     | A cada 10 segundos (loop principal)                |
| `POST /api/machine/car-entered`   | Quando X14 detecta carro (borda de subida)         |
| `POST /api/machine/wash-complete` | Quando AUTO_CONCLUIDO (ciclo terminou com sucesso) |
| `POST /api/machine/fault`         | Quando AUTO_ERRO (falha no ciclo)                  |

### Autenticação

Todos os requests levam o header:
```
x-device-key: <chave-unica-desta-maquina>
```
A chave é fornecida pela Pili Tecnologia no momento da instalação. Salvar em NVS.

### URL base

Variável configurável. Exemplo:
```
https://pililave.up.railway.app
```
Salvar em NVS. Configurável pela tela LVGL de configuração.

---

## 2. Heartbeat — O Loop Principal

### Request

```
POST /api/machine/heartbeat
Content-Type: application/json
x-device-key: <deviceKey>

{
  "state": "FREE",
  "restanteSeg": 0
}
```

**Campos do body:**

| Campo         | Tipo                          | Descrição                                        |
|---------------|-------------------------------|--------------------------------------------------|
| `state`       | `"FREE"` / `"WASHING"` / `"FAULT"` | Estado atual da máquina                    |
| `restanteSeg` | inteiro >= 0                  | Segundos restantes do ciclo (0 se FREE/FAULT)    |

**Regras para `state`:**
- `"FREE"` → máquina ociosa, pronta para novo ciclo
- `"WASHING"` → ciclo em andamento (mandar `restanteSeg` com o tempo restante)
- `"FAULT"` → erro ativo (CLP reportou falha)

### Response (200 OK)

```json
{
  "lightState": "GREEN_SOLID",
  "start": {
    "reservationId": "cmswp03uw000854mgsbiu0b51",
    "programId": 2,
    "duracaoSeg": 1800
  },
  "license": {
    "daysWithoutPayment": 23,
    "blocked": false
  }
}
```

**Campos da resposta:**

| Campo                        | Tipo                | Descrição                                                    |
|------------------------------|---------------------|--------------------------------------------------------------|
| `lightState`                 | string (ver abaixo) | Estado que a lâmpada deve mostrar AGORA                      |
| `start`                      | objeto ou `null`    | Se não-nulo, iniciar o ciclo com estes parâmetros             |
| `start.reservationId`        | string              | ID da reserva (para dedup em NVS)                            |
| `start.programId`            | inteiro 1–4         | Modelo de lavagem: 1=M1, 2=M2, 3=M3, 4=M4                   |
| `start.duracaoSeg`           | inteiro             | Duração do ciclo em segundos (timeout de segurança = 2x)     |
| `license.daysWithoutPayment` | inteiro >= 0        | Dias desde o último pagamento registrado pela Pili Tecnologia |
| `license.blocked`            | boolean             | `true` = máquina deve ser bloqueada por falta de pagamento    |

---

## 3. Lâmpada Bicolor — 6 Padrões

O display recebe `lightState` no heartbeat e aciona Y11 (verde) e Y12 (vermelho) via ESP-NOW nos módulos Waveshare 8DI-8DO.

| lightState       | Y11 (verde)     | Y12 (vermelha)  | Significado                           |
|------------------|-----------------|-----------------|---------------------------------------|
| `GREEN_SOLID`    | ON contínuo     | OFF             | Pode entrar — reserva ativa, máquina livre |
| `GREEN_BLINK`    | Pisca 1 Hz      | OFF             | Reserva ativa, máquina ocupada — aguarde  |
| `RED_SOLID`      | OFF             | ON contínuo     | Placa não cadastrada                  |
| `RED_BLINK`      | OFF             | Pisca 1 Hz      | Máquina em falha                      |
| `RED_GREEN_ALT`  | Alterna 1 Hz    | Alterna 1 Hz    | Placa cadastrada mas sem reserva ativa |
| `OFF`            | OFF             | OFF             | Sem evento / fail-safe                |

**Pisca 1 Hz** = 500ms ON, 500ms OFF.

**Alterna 1 Hz** = verde ON 500ms → verde OFF + vermelho ON 500ms → repete.

### Fail-safe da lâmpada

Se o display ficar **60 segundos sem receber resposta 200 OK** do backend, a lâmpada deve ir para **OFF** automaticamente. Nunca deixar verde aceso sem confirmação do backend.

Implementação sugerida: manter um `unsigned long lastHeartbeatOk` em millis(). No loop, se `millis() - lastHeartbeatOk > 60000`, forçar Y11=OFF, Y12=OFF.

---

## 4. Comando START — Iniciar Ciclo

Quando `start` não é `null` na resposta do heartbeat:

### Passo a passo

1. **Ler `start.reservationId`** e comparar com o último reservationId salvo em NVS (chave `"lastRes"`)
2. Se **igual** → ignorar (dedup: já foi executado). Não chamar `auto_iniciar` de novo.
3. Se **diferente** → salvar o novo reservationId em NVS e chamar `auto_iniciar(start.programId)`
4. O backend reenvia `start` em toda resposta do heartbeat até receber `car-entered` ou `wash-complete`. A dedup em NVS garante que o ciclo não é iniciado duas vezes.

### Convivência com controle remoto

O controle remoto físico (X1–X6) também pode iniciar ciclos. Quem chegar primeiro vence. Se o ciclo já foi iniciado pelo controle remoto quando `start` chega, o dedup no NVS deve impedir dupla execução. Se `auto_iniciar` for chamada e a máquina já estiver lavando, a função deve ignorar a chamada.

### Quando start é null

Não há ciclo pendente. Não fazer nada.

---

## 5. Eventos — Fila NVS Persistente

Três eventos devem ser enviados ao backend. Todos usam fila persistente em NVS para sobreviver a reboot e retransmitir até 200 OK.

### 5.1 Car-Entered (X14 detectou carro)

**Quando:** borda de subida do X14, com debounce de 300ms.

```
POST /api/machine/car-entered
Content-Type: application/json
x-device-key: <deviceKey>

{
  "reservationId": "cmswp03uw000854mgsbiu0b51"
}
```

`reservationId` é o último reservationId salvo em NVS (do start mais recente). Se não houver nenhum, enviar `{}` (o backend trata como "X14 órfão" e loga anomalia).

**Resposta esperada:** `200 OK` com `{ "ok": true }`

### 5.2 Wash-Complete (AUTO_CONCLUIDO)

**Quando:** CLP sinaliza fim de ciclo com sucesso.

```
POST /api/machine/wash-complete
Content-Type: application/json
x-device-key: <deviceKey>

{
  "reservationId": "cmswp03uw000854mgsbiu0b51"
}
```

**IMPORTANTE:** Este é o ÚNICO ponto de débito. Quando o backend recebe este evento, ele debita o saldo do cliente e registra a lavagem. O envio deve ser garantido — a fila NVS existe para isso.

**Resposta esperada:** `200 OK` com `{ "ok": true, "reservationId": "...", "orderId": "..." }`

Se a resposta vier com `"dedup": true`, significa que é uma retransmissão e o débito já foi feito na primeira vez. Pode remover da fila com segurança.

### 5.3 Fault (AUTO_ERRO)

**Quando:** CLP sinaliza erro no ciclo.

```
POST /api/machine/fault
Content-Type: application/json
x-device-key: <deviceKey>

{
  "reservationId": "cmswp03uw000854mgsbiu0b51"
}
```

**Resposta esperada:** `200 OK` com `{ "ok": true }`

O backend libera o saldo do cliente (sem débito) e marca a máquina como FAULT.

### Implementação da fila NVS

Sugestão: ring buffer de 8 slots em NVS.

```
Chaves NVS:
  evtHead  (uint8)   — índice do próximo slot a ser escrito
  evtTail  (uint8)   — índice do próximo slot a ser enviado
  evt0..7  (string)  — JSON do evento, ex: {"t":"car-entered","r":"cmswp03..."}
```

**Tipos de evento na fila:**
- `"t": "car-entered"` → POST `/api/machine/car-entered`
- `"t": "wash-complete"` → POST `/api/machine/wash-complete`
- `"t": "fault"` → POST `/api/machine/fault`

**Lógica de reenvio:**
1. A cada iteração do loop (junto com ou após o heartbeat), verificar se `tail != head`
2. Se houver evento pendente, enviar o POST correspondente
3. Se resposta for 200 OK, avançar `tail` e remover do NVS
4. Se falhar (timeout, erro HTTP, sem Wi-Fi), manter na fila e tentar no próximo ciclo
5. Enviar no máximo 1 evento por ciclo de 10s (para não sobrecarregar)

---

## 6. Controle de Licença — Trava por Pagamento

### O que o display recebe

A cada heartbeat, o campo `license` vem na resposta:
```json
{
  "license": {
    "daysWithoutPayment": 23,
    "blocked": false
  }
}
```

### O que fazer com os valores

Salvar `daysWithoutPayment` e `blocked` em NVS a cada heartbeat OK.

| daysWithoutPayment | blocked | Ação no display                                          |
|--------------------|---------|----------------------------------------------------------|
| 0 a 39             | false   | Normal — nenhuma ação                                    |
| 40 a 49            | false   | Mostrar aviso no display para o operador. Máquina continua funcionando normalmente. Texto sugerido: "Licença vence em X dias — entre em contato com a Pili Tecnologia" |
| 50+                | true    | **TELA BLOQUEANTE.** Nenhum ciclo pode ser iniciado. Controle remoto também bloqueado. Texto: "Licença expirada — entre em contato com a Pili Tecnologia" |

### Persistência em NVS

Se a máquina perder internet, usar o ÚLTIMO valor salvo. **Sem internet não reseta o contador.** Isso impede que alguém desconecte o Wi-Fi para escapar do bloqueio.

### Desbloqueio

Quando a Pili Tecnologia registra um pagamento (via painel admin), o próximo heartbeat vem com `daysWithoutPayment = 0` e `blocked = false`. O display desbloqueia automaticamente.

---

## 7. Trava por Ausência de Comunicação (7 dias)

### Objetivo

Impedir que alguém desconecte o Wi-Fi para evitar o bloqueio por pagamento.

### Implementação

1. Salvar em NVS a data/hora (timestamp Unix) do último heartbeat que retornou 200 OK. Chave sugerida: `"lastOk"`.
2. A cada ciclo do loop principal (10s), calcular: `diasSemCom = (now - lastOk) / 86400`
3. Se `diasSemCom >= 7` → **TELA BLOQUEANTE**, independente do `blocked` salvo em NVS.
4. Texto: "Sem comunicação há 7 dias — entre em contato com a Pili Tecnologia"
5. Quando a comunicação é restabelecida e um heartbeat retorna 200 OK, `lastOk` é atualizado e a trava desaparece automaticamente.

### As duas travas são independentes

| Trava              | Condição                                                      |
|--------------------|---------------------------------------------------------------|
| Trava 1 — Pagamento     | `blocked == true` OU `daysWithoutPayment >= 50` (do backend, salvo em NVS) |
| Trava 2 — Comunicação   | 7 dias sem heartbeat 200 OK (contado localmente pelo display)       |

**Qualquer uma que disparar bloqueia a máquina.** As duas se desbloqueiam independentemente.

---

## 8. Tela de Configuração Wi-Fi (LVGL)

Adicionar uma tela de configuração de rede no menu LVGL do display.

### Requisitos

1. **Scan de redes**: listar SSIDs disponíveis com intensidade de sinal
2. **Teclado virtual**: entrada de senha via teclado LVGL (alfanumérico)
3. **Salvar em NVS**: SSID e senha persistem após reinicialização
4. **Campos adicionais** (na mesma tela ou tela separada):
   - URL do backend (padrão: `https://pililave.up.railway.app`)
   - Device Key (chave da máquina)
5. **Botão "Testar conexão"**: tenta conectar no Wi-Fi e fazer um heartbeat; mostra sucesso ou erro

### Acesso

Acessível pelo menu de configuração existente do display (onde já tem contadores e parâmetros).

---

## 9. Indicador de Conectividade no Display

Ícone permanente no canto superior direito do display.

### Estados visuais

| Estado                | Ícone sugerido                        |
|-----------------------|---------------------------------------|
| Wi-Fi conectado, backend OK        | Ícone Wi-Fi com barras cheias (verde) |
| Wi-Fi conectado, backend sem resposta >30s | Ícone Wi-Fi com barras + "!" (amarelo) |
| Wi-Fi conectado, backend sem resposta >60s | Ícone Wi-Fi com barras + "X" (vermelho) — lâmpada já está OFF por fail-safe |
| Wi-Fi desconectado    | Ícone Wi-Fi cortado (vermelho)         |

### Dados

- **Barras de sinal**: `WiFi.RSSI()` → mapear para 0–4 barras
- **Status do backend**: baseado no timestamp do último heartbeat OK

---

## 10. Variáveis NVS — Resumo Completo

Todas as chaves NVS que o firmware precisa manter:

| Chave NVS         | Tipo     | Descrição                                              |
|--------------------|----------|--------------------------------------------------------|
| `wifiSSID`         | string   | SSID da rede Wi-Fi                                     |
| `wifiPass`         | string   | Senha da rede Wi-Fi                                    |
| `apiBase`          | string   | URL base do backend (ex: `https://pililave.up.railway.app`) |
| `deviceKey`        | string   | Chave única desta máquina                              |
| `lastRes`          | string   | Último reservationId executado (dedup do start)        |
| `lastOk`           | uint32   | Timestamp Unix do último heartbeat 200 OK              |
| `licDays`          | uint16   | Último daysWithoutPayment recebido                     |
| `licBlocked`       | uint8    | Último valor de blocked (0 ou 1)                       |
| `evtHead`          | uint8    | Índice de escrita da fila de eventos                   |
| `evtTail`          | uint8    | Índice de leitura da fila de eventos                   |
| `evt0` .. `evt7`   | string   | Slots da fila de eventos (JSON)                        |

---

## 11. Loop Principal — Pseudocódigo

```
cada 10 segundos:
    // --- TRAVA DE COMUNICAÇÃO ---
    se (now - lastOk) >= 7 dias:
        mostrar tela bloqueante "Sem comunicação há 7 dias"
        (continua tentando heartbeat para sair da trava)

    // --- HEARTBEAT ---
    response = POST /api/machine/heartbeat { state, restanteSeg }

    se response == 200 OK:
        lastOk = now  (salvar em NVS)
        parsear JSON da response

        // --- LÂMPADA ---
        acionar Y11/Y12 conforme response.lightState

        // --- LICENÇA ---
        salvar response.license em NVS
        se license.blocked OU license.daysWithoutPayment >= 50:
            mostrar tela bloqueante "Licença expirada"
            bloquear auto_iniciar e controle remoto
        senão se license.daysWithoutPayment >= 40:
            mostrar aviso "Licença vence em X dias"
            (máquina continua funcionando)
        senão:
            esconder avisos de licença

        // --- START ---
        se response.start != null:
            se response.start.reservationId != lastRes (NVS):
                salvar reservationId em NVS
                chamar auto_iniciar(response.start.programId)

    senão (timeout ou erro HTTP):
        se (now - lastOk) > 60s:
            lâmpada OFF (fail-safe)

    // --- FILA DE EVENTOS ---
    se fila não vazia:
        enviar próximo evento da fila
        se 200 OK: remover da fila
```

---

## 12. Diagrama de Fluxo Completo

```
Cliente abre app → POST /api/reservations → status HELD (1h de validade)

Câmera (RPi ou celular PWA) lê placa → POST /api/lpr/read → backend decide lightState

Display faz heartbeat → POST /api/machine/heartbeat
    ← { lightState, start, license }

Display aciona Y11/Y12 via ESP-NOW conforme lightState

Se start != null e reservationId novo:
    Display chama auto_iniciar(programId) internamente

X14 detectado via ESP-NOW → Display enfileira → POST /api/machine/car-entered

AUTO_CONCLUIDO → Display enfileira → POST /api/machine/wash-complete
    (backend debita saldo do cliente, registra lavagem, incrementa contadores)

AUTO_ERRO → Display enfileira → POST /api/machine/fault
    (backend libera saldo do cliente, marca máquina como FAULT)
```

---

## 13. Checklist de Implementação

- [ ] Conectar Wi-Fi com credenciais de NVS
- [ ] Loop de heartbeat a cada 10s
- [ ] Parsear `lightState` → acionar Y11/Y12 via ESP-NOW
- [ ] Parsear `start` → dedup por `lastRes` em NVS → `auto_iniciar(programId)`
- [ ] Detectar X14 via ESP-NOW → enfileirar `car-entered`
- [ ] Detectar AUTO_CONCLUIDO → enfileirar `wash-complete`
- [ ] Detectar AUTO_ERRO → enfileirar `fault`
- [ ] Fila NVS persistente com reenvio até 200 OK
- [ ] Fail-safe: 60s sem 200 OK → lâmpada OFF
- [ ] Parsear `license` → salvar em NVS → aviso 40–49 dias → bloqueio 50+ dias
- [ ] Trava de comunicação: 7 dias sem 200 OK → tela bloqueante
- [ ] Tela LVGL de configuração Wi-Fi (SSID, senha, URL, deviceKey)
- [ ] Indicador de conectividade no canto superior direito
- [ ] Convivência com controle remoto X1–X6 (quem chegar primeiro vence)
- [ ] Y6 (solenoide) NÃO é controlada pelo backend — manter lógica atual

---

**Contato técnico backend:** Daniel Anders — danielanders76@gmail.com
