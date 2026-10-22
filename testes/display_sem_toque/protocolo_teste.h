#pragma once
#include <Arduino.h>

// =======================================================================
// protocolo_teste.h — ESP-NOW do projeto de TESTES (bancada, etapa 0).
// IDENTICO nas pastas testes/display e testes/waveshare1 (manter iguais).
//   - W1 <-> W2: protocolo legado (sensores/saidas), igual ao de sempre
//   - Display <-> W1: so 2 mensagens (comando e status)
// =======================================================================

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
    MSG_CANAL       = 4,   // (nao usado no projeto de testes — canal fixo em 1)
};
typedef struct __attribute__((packed)) { uint8_t tipo,id_maquina,origem,seq; } CabEspNow;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t di_vivo,di_borda; uint32_t t_us; } MsgEvento;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t di_vivo,do_estado; } MsgHeartbeat;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t canal,estado; } MsgComando;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t canal; } MsgCanal;

// ---- Display <-> W1 (projeto de testes) ----
enum : uint8_t {
    MSG_TESTE_CMD    = 30,   // Display -> W1
    MSG_TESTE_STATUS = 31,   // W1 -> Display
    MSG_TESTE_CFG_SET  = 32, // Display -> W1: grava um valor de configuracao (persistido na NVS da W1)
    MSG_TESTE_CFG_REQ  = 33, // Display -> W1: pede uma tabela de configuracao
    MSG_TESTE_CFG_DUMP = 34, // W1 -> Display: a tabela pedida
};

// ---- Configuracao (velocidades, esperas por slot, atrasos, giro) ----
// tabela 0 = VELOCIDADE   i1 = modelo (0..3)  i2 = etapa (0..13)  valor = Hz*10 (50..600)
// tabela 1 = ESPERA SLOT  i1 = modelo (0..3)  i2 = slot  (0..13)  valor = segundos (0..3600; 0xFFFF = padrao do processo)
// tabela 2 = ATRASO REAL  i1 = 0 espuma A, 1 espuma B, 2 cor magica, 3 secagem (i2 = 0)  valor = segundos (0..3600)
// tabela 3 = GIRO 1->2    i1 = 0 pre-lavagem, 1 espuma A, 2 alta pressao (i2 = 0)  valor = ms (3000..15000; 0 = padrao)
// tabela 4 = SEQUENCIA DO MODELO (so leitura, so DUMP): i1 = modelo, v[0..13] = id do processo de cada slot (10 = fim)
// So com a maquina parada. DUMP: tabela 0/1 -> v[0..13] do modelo i1; tabela 2 -> v[0..3]; tabela 3 -> v[0..2] (efetivo).
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t tabela, i1, i2; uint16_t valor; } MsgTesteCfgSet;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t tabela, i1; } MsgTesteCfgReq;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t tabela, i1; uint16_t v[14]; } MsgTesteCfgDump;

// acao: 0=HOME (alterna iniciar/cancelar)  1=INICIAR teste da Alta Pressao
//       5=CARRO REAL (X10 real, atrasos originais)  6=SECO (X10 simulado; so com a maquina parada)
//       2=PARAR tudo  3=bomba OFF (sem Y13/SAJ)  4=bomba ON (Y13; SAJ em frequencia fixa)
//       MANUAL (segurando o botao; repetir a cada ~150ms enquanto pressionado):
//       10=giro horario  11=giro anti-horario  12=carrinho frente  13=carrinho tras  14=soltou
//       40/41/42 = tempo do giro 1->2 do processo (Pre-lavagem / Espuma A / Alta Pressao); arg = ms/100 (30..150), so parado
//       AUTOMATICO: 20=iniciar (arg = modelo 1..4)  21=pausar  22=continuar  23=cancelar
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t acao; uint8_t arg; } MsgTesteCmd;

typedef struct __attribute__((packed)) {
    CabEspNow cab;
    uint8_t  estado_auto;     // EstadoAuto (0=IDLE 5=PROCESSO 7=ERRO ...)
    uint8_t  sub_estado;      // _pst da Alta Pressao (AP_*)
    uint8_t  giro_n;          // giro atual dentro do triplo (0..2)
    uint8_t  home_estado;     // HOME_* (0=idle)
    uint8_t  bomba_on;        // bit0 = Y13 + SAJ habilitados no proximo ciclo; bit1 = modo CARRO REAL
    uint8_t  rodando;         // 1 = teste em andamento
    uint8_t  w2_ok;           // 1 = W2 respondendo
    uint8_t  io1_di, io2_di;
    uint16_t vfd_freq_x100;
    uint16_t ciclos_ok, ciclos_erro;
    uint32_t vfd_falhas;
    // Diagnostico do ULTIMO giro (tempos em ms desde a saida da posicao 2, no giro 2->1)
    uint8_t  ug_tipo;         // 0 = giro 1->2 (por tempo)   1 = giro 2->1 (por sensores)
    uint8_t  ug_como;         // tipo 0: 0=TEMPO 5=TIMEOUT(erro) | tipo 1: 1=X16+X17 2=TIMEOUT
    uint8_t  ug_fh;           // busca fina: 0=nao entrou 1=OK 2=FALHOU
    uint8_t  ug_pulsos;       // pulsos da busca fina
    uint16_t ug_dt_ms;        // quando o giro decidiu parar
    uint16_t ug_x16_ms;       // 1a vez que X16 (debounce) apareceu (0 = nao viu)
    uint16_t ug_x17_ms;       // 1a vez que X17 (debounce) apareceu (0 = nao viu)
    // Comandado x real (diagnostico): DOs como bits (bit0=canal1 ... bit7=canal8)
    uint8_t  w1_do;           // saidas locais da W1 (Y1..Y7,Y11) — estado real do PCA
    uint8_t  w2_do_cmd;       // o que a W1 mandou ligar na W2 (espelho)
    uint8_t  w2_do_real;      // o que a W2 diz ter ligado (ultimo heartbeat)
    uint8_t  vfd_mov;         // comandado ao Delta: 0=parado 1=frente 2=reverso
    uint16_t vfd_mov_freq;    // frequencia comandada (0.1 Hz)
    // Saude da W1 (diagnostico): reiniciou? ficou presa em escrita do RS-485?
    uint32_t up_s;            // segundos desde o boot (cai a ~0 se a W1 reiniciar)
    uint16_t loop_max_ms;     // maior intervalo entre voltas do loop desde o ultimo status
    uint8_t  rst_motivo;      // esp_reset_reason() deste boot (1=POWERON 3=SW 4=PANIC 6=TASK_WDT 11=USB ...)
    uint8_t  proc_ativo;      // processo em execucao (Processo: 7=Alta Pressao ...)
    uint8_t  programa_sel;    // modelo escolhido (1..4), 0 = nenhum
    uint8_t  manual_mov;      // movimento MANUAL em curso (0=nenhum, 10..13 como em MsgTesteCmd)
    uint16_t giro_ms[3];      // tempo do giro 1->2 efetivo: Pre-lavagem, Espuma A, Alta Pressao (ms)
    char     msg[48];         // ultima mensagem (erro, HOME ou aviso do manual)
} MsgTesteStatus;
