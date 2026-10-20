#pragma once
#include <Arduino.h>
#include "tipos.h"   // NUM_ETAPAS/NUM_SLOTS (e, no display, o protocolo ESP-NOW base ja vem daqui)

// =======================================================================
// protocolo_w1.h — mensagens ESP-NOW entre Waveshare 1 (controladora) e:
//   - Waveshare 2 (sensores/saidas dela — igual ao protocolo que o display
//     ja usava com as duas, so que agora o "mestre" e esta placa)
//   - Display (status periodico + comandos — PROTOCOLO NOVO)
// =======================================================================

#ifndef ID_MAQUINA   // ja definido em tipos.h no display — so define de novo se faltar (Waveshare 1)
#define ID_MAQUINA 1
static const uint8_t MAC_DISPLAY[6] = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x01};
static const uint8_t MAC_WAVE1[6]   = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x02};
static const uint8_t MAC_WAVE2[6]   = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x03};
#define ESPNOW_CANAL   1
#define ORIGEM_DISPLAY 0
#define ORIGEM_WAVE1   1
#define ORIGEM_WAVE2   2
#define HEARTBEAT_MS   200
#define COMM_TIMEOUT_MS 700
static const uint8_t ESPNOW_PMK[16] = {'P','I','L','I','-','p','m','k',ID_MAQUINA,0,0,0,0,0,0,0};
static const uint8_t ESPNOW_LMK[16] = {'P','I','L','I','-','l','m','k',ID_MAQUINA,0,0,0,0,0,0,0};

enum : uint8_t {
    MSG_EVENTO      = 1,   // W2 -> W1 (borda de pulso)
    MSG_HEARTBEAT   = 2,   // W2 -> W1 (vivo, a cada 200ms)
    MSG_COMANDO     = 3,   // W1 -> W2 (liga/desliga DO)
    MSG_CANAL       = 4,   // Display -> W1/W2 (migrar de canal)
};
typedef struct __attribute__((packed)) { uint8_t tipo,id_maquina,origem,seq; } CabEspNow;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t di_vivo,di_borda; uint32_t t_us; } MsgEvento;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t di_vivo,do_estado; } MsgHeartbeat;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t canal,estado; } MsgComando;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t canal; } MsgCanal;
#endif

enum : uint8_t {
    MSG_AUTO_CMD    = 20,  // Display -> W1 (iniciar/pausar/retomar/cancelar/limpar_erro)
    MSG_RC_IO       = 21,  // Display -> W1 (io1_set_do/io2_set_do do modo manual)
    MSG_RC_VFD      = 22,  // Display -> W1 (vfd_run_fwd/rev/stop do modo manual)
    MSG_RC_DESLOC   = 23,  // Display -> W1 (desloc_frente/tras/parar do modo manual)
    MSG_RC_HOME     = 24,  // Display -> W1 (home_iniciar — toggle interno)
    MSG_RC_SAJ      = 25,  // Display -> W1 (saj_set_freq do modo manual)
    MSG_CONFIG_PUSH = 26,  // Display -> W1 (g_velocidades/g_modelos/g_config)
    MSG_STATUS      = 27,  // W1 -> Display (estado do ciclo + sensores + alarme)
};

// acao: 0=iniciar 1=pausar 2=retomar 3=cancelar 4=limpar_erro
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t acao; uint8_t programa; } MsgAutoCmd;
// alvo: 1=io1 2=io2
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t alvo; uint8_t canal; uint8_t estado; } MsgRcIo;
// acao: 0=stop 1=run_fwd 2=run_rev
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t acao; uint16_t freq_hz10; } MsgRcVfd;
// acao: 0=parar 1=frente 2=tras
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t acao; uint16_t freq_hz10; } MsgRcDesloc;
typedef struct __attribute__((packed)) { CabEspNow cab; } MsgRcHome;
typedef struct __attribute__((packed)) { CabEspNow cab; float freq_hz; } MsgRcSaj;

typedef struct __attribute__((packed)) {
    CabEspNow cab;
    uint16_t velocidades[4][NUM_ETAPAS];
    uint8_t  modelos[4][NUM_SLOTS];
    uint16_t atraso_init, tempo_espuma_a, tempo_espuma_b, tempo_cor_magica,
             dist_compensacao, sobrecarga_main, sobrecarga_rotacao, tempo_sobrecarga,
             atraso_espuma_a, atraso_espuma_b, atraso_cor_magica, atraso_secagem;
    uint32_t giro_dur_ms, giro_timeout_ms;
} MsgConfigPush;   // sizeof ~= 4 + 112 + 40 + 24 = 180 bytes — cabe no limite ESP-NOW (250)

typedef struct __attribute__((packed)) {
    CabEspNow cab;
    uint8_t  estado_auto;
    uint8_t  processo_ativo;
    uint8_t  sub_estado;    // _pst do processo atual (diagnostico)
    uint8_t  programa_sel;
    uint8_t  modo_auto;
    uint8_t  em_pausa;
    uint8_t  alarme;
    char     msg_alarme[64];
    uint8_t  io1_di, io2_di;       // sensores (vivo|latch combinado), p/ diagnostico na tela
    uint8_t  io1_do, io2_do;
    uint16_t vfd_freq_x100;        // frequencia atual do inversor (0.01Hz)
    uint16_t vfd_corrente_x10;     // corrente atual do inversor (0.1A)
    uint8_t  home_estado;          // HOME_* (0=idle)
    uint32_t vfd_falhas;
} MsgStatus;
