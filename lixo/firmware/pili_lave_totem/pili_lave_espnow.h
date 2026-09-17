/************************************************************
 * PILI LAVE - Protocolo ESP-NOW entre TOTEM e MÁQUINA
 * ----------------------------------------------------------
 * As DUAS placas (Waveshare ESP32-S3-Touch-LCD-7) rodam o
 * MESMO sketch; muda apenas PILI_LAVE_ROLE no config.
 *
 * TOTEM  -> MÁQUINA : PILI_LAVE_MSG_START  (liberar lavagem)
 * MÁQUINA-> TOTEM   : PILI_LAVE_MSG_ACK    (aceite/ocupada)
 * MÁQUINA-> TOTEM   : PILI_LAVE_MSG_STATUS (estado periódico)
 *
 * Magic 0xA8 (diferente do 0xA7 do sistema PILI TECH de
 * sensores, para não haver conflito se coexistirem no local).
 * Broadcast MAC — sem pareamento. As duas placas precisam
 * estar no MESMO canal WiFi (basta conectar no mesmo roteador,
 * ou a máquina trava no canal do SSID configurado).
 *
 * Payload máximo do ESP-NOW = 250 bytes. Structs cabem folgado.
 ************************************************************/
#ifndef PILI_LAVE_ESPNOW_H
#define PILI_LAVE_ESPNOW_H

#include <stdint.h>

#define PILI_LAVE_MAGIC     0xA8
#define PILI_LAVE_VERSION   1

// msgType
#define PILI_LAVE_MSG_START   1   // totem -> máquina
#define PILI_LAVE_MSG_ACK     2   // máquina -> totem
#define PILI_LAVE_MSG_STATUS  3   // máquina -> totem (broadcast periódico)

// origem da liberação
#define PILI_LAVE_ORIG_CLIENTE 1
#define PILI_LAVE_ORIG_LAVADOR 2

// forma de pagamento
#define PILI_LAVE_PAY_NENHUM  0   // lavador (sem cobrança)
#define PILI_LAVE_PAY_PIX     1
#define PILI_LAVE_PAY_DEBITO  2
#define PILI_LAVE_PAY_CREDITO 3

// estado da máquina
#define PILI_LAVE_ST_LIVRE    0
#define PILI_LAVE_ST_LAVANDO  1

#pragma pack(push, 1)

/* TOTEM -> MÁQUINA: liberar lavagem  (~64 bytes) */
typedef struct {
  uint8_t  magic;          // PILI_LAVE_MAGIC
  uint8_t  version;        // PILI_LAVE_VERSION
  uint8_t  msgType;        // PILI_LAVE_MSG_START
  uint8_t  washType;       // 1..4
  uint8_t  origin;         // PILI_LAVE_ORIG_*
  uint8_t  payMethod;      // PILI_LAVE_PAY_*
  uint16_t duracaoSeg;     // duração do programa em segundos
  uint32_t seq;            // id único da liberação (dedup/ACK)
  uint32_t valorCent;      // valor cobrado em centavos (0 p/ lavador)
  char     paymentId[40];  // id da cobrança Asaas ("" p/ lavador)
} PiliLaveStart;

/* MÁQUINA -> TOTEM: resposta a um START  (~16 bytes) */
typedef struct {
  uint8_t  magic;
  uint8_t  version;
  uint8_t  msgType;        // PILI_LAVE_MSG_ACK
  uint8_t  accepted;       // 1 = lavagem iniciada, 0 = ocupada (retentar)
  uint8_t  state;          // PILI_LAVE_ST_*
  uint32_t seq;            // ecoa o seq do START
  uint16_t restanteSeg;    // se ocupada: tempo restante da lavagem atual
} PiliLaveAck;

/* MÁQUINA -> TOTEM: estado periódico (a cada 2 s)  (~14 bytes) */
typedef struct {
  uint8_t  magic;
  uint8_t  version;
  uint8_t  msgType;        // PILI_LAVE_MSG_STATUS
  uint8_t  state;          // PILI_LAVE_ST_*
  uint8_t  washType;       // programa em andamento (0 se livre)
  uint16_t restanteSeg;    // tempo restante (0 se livre)
  uint32_t ciclosTotal;    // lavagens já executadas pela máquina
} PiliLaveStatus;

#pragma pack(pop)

static const uint8_t PILI_LAVE_BCAST[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};

#endif // PILI_LAVE_ESPNOW_H
