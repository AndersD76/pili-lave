#pragma once
#include <Arduino.h>

// =======================================================================
// protocolo_teste.h — ESP-NOW do projeto de TESTES (bancada, etapa 0).
// IDENTICO nas pastas testes/display e testes/waveshare1 (manter iguais).
//   - W1 <-> W2: protocolo legado (sensores/saidas), igual ao de sempre
//   - Display <-> W1: so 2 mensagens (comando e status)
// =======================================================================

#define ID_MAQUINA 1
// Canal (1..8) da WAVESHARE 2 onde esta ligado o Y13 (contator da bomba de alta pressao): 3. Existe como constante porque em 2026-10-23
// o Y13 parecia sem sinal; era um fio no lugar errado. Se um dia o canal 3 da W2 falhar, ligue o fio em outro canal livre, troque
// este numero para outro canal livre e regrave W1 e display. ATENCAO: o canal 7 da W2 agora e das LUZES da maquina e o 8 e do aspirador;
// nao sobrou canal livre — entao trocar o Y13 de canal exigiria remanejar as luzes ou o aspirador.
#define Y13_CANAL_W2 3
static const uint8_t MAC_DISPLAY[6] = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x01};
static const uint8_t MAC_WAVE1[6]   = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x02};
static const uint8_t MAC_WAVE2[6]   = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x03};
#define ESPNOW_CANAL   1
#define ORIGEM_DISPLAY 0
#define ORIGEM_WAVE1   1
#define ORIGEM_WAVE2   2
#define ORIGEM_CAMERA  3   // reservado: camera (data/hora da internet, acerto vindo do app) — ainda NAO implementado na camera
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

// ---- CAMERA (ESP32-S3-CAM): mensagens que o firmware dela JA entende (iguais a lava_car_485/display/tipos.h e firmware_camera/) ----
static const uint8_t MAC_CAMERA[6] = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x04};
enum : uint8_t { MSG_WIFI_REQ = 5, MSG_WIFI_CFG = 6, MSG_SCAN_REQ = 11, MSG_SCAN_RESP = 12, MSG_RESYNC_REQ = 21 };
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t canal; } MsgResyncReq;   // Camera -> Display: "o roteador mudou para o canal N; migre todos" (sem senha de tecnico)
typedef struct __attribute__((packed)) {      // Display -> Camera: credenciais (a camera e quem conecta no Wi-Fi). 231 bytes
    CabEspNow cab; char ssid[33]; char pass[65]; uint8_t canal; char api_url[96]; char dev_key[32];
} MsgWifiCfg;
typedef struct __attribute__((packed)) { CabEspNow cab; } MsgScanReq;     // Display -> Camera: "escaneia as redes e me diga"
#define SCAN_SSID_LEN 24
#define SCAN_POR_PAGINA 4
typedef struct __attribute__((packed)) { char ssid[SCAN_SSID_LEN]; uint8_t canal; int8_t rssi; } ScanEntry;
typedef struct __attribute__((packed)) {      // Camera -> Display: uma pagina da lista (canal de cada rede incluido)
    CabEspNow cab; uint8_t pagina, total_paginas, n; ScanEntry redes[SCAN_POR_PAGINA];
} MsgScanResp;
// MsgCanal (MSG_CANAL) vindo do DISPLAY = "vai para o canal N" (W1/W2 ja obedecem; a CAMERA ainda nao: pendente).
// MsgCanal vindo da CAMERA ou da W1 = "oi, estou no canal N" (hello depois de migrar).

// ---- Display <-> W1 (projeto de testes) ----
enum : uint8_t {
    MSG_TESTE_CMD    = 30,   // Display -> W1
    MSG_TESTE_STATUS = 31,   // W1 -> Display
    MSG_TESTE_CFG_SET  = 32, // Display -> W1: grava um valor de configuracao (persistido na NVS da W1)
    MSG_TESTE_CFG_REQ  = 33, // Display -> W1: pede uma tabela de configuracao
    MSG_TESTE_CFG_DUMP = 34, // W1 -> Display: a tabela pedida
    MSG_TESTE_DATA     = 35, // Camera/Display -> W1: data de hoje (a maquina nao tem relogio). Camera ainda nao envia.
};

// ---- Configuracao (velocidades, esperas por slot, atrasos, giro) ----
// tabela 0 = VELOCIDADE   i1 = modelo (0..3)  i2 = etapa (0..13)  valor = Hz*10 (50..600)
// tabela 1 = ESPERA SLOT  i1 = modelo (0..3)  i2 = slot  (0..13)  valor = segundos (0..3600; 0xFFFF = padrao do processo)
// tabela 2 = ATRASO REAL  i1 = 0 espuma A, 1 espuma B, 2 cor magica, 3 secagem (i2 = 0)  valor = segundos (0..3600)
// tabela 3 = GIRO 1->2    i1 = 0 pre-lavagem, 1 espuma A, 2 alta pressao (i2 = 0)  valor = ms (3000..15000; 0 = padrao)
// tabela 4 = SEQUENCIA DO MODELO (so leitura, so DUMP): i1 = modelo, v[0..13] = id do processo de cada slot (10 = fim)
// tabela 5 = LAVAGENS desde o ultimo acerto (so leitura, so DUMP). TIPOS: 0 presencial, 1 aplicativo, 2 socio (mensalista), 3 bonus (promocao)
//   i1 = 0: v[0..3] presencial por modelo, v[4..7] aplicativo, v[8..11] socios, v[12] = dia | mes<<8 do ultimo acerto, v[13] = ano (0 = sem data)
//   i1 = 1: v[0..3] bonus por modelo, v[4..5] saldo historico presencial (lo,hi), v[6..7] aplicativo, v[8..9] socios, v[10..11] bonus
// So com a maquina parada. DUMP: tabela 0/1 -> v[0..13] do modelo i1; tabela 2 -> v[0..3]; tabela 3 -> v[0..2] (efetivo).
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t dia, mes; uint16_t ano; } MsgTesteData;
// ---- NUVEM via CAMERA (a W1 conversa DIRETO com a camera — decisao de 2026-10-24). Mesmas mensagens/ids do firmware antigo e da camera ----
enum : uint8_t { MSG_HB_STATE = 7, MSG_HB_RESP = 8, MSG_EVT = 9, MSG_EVT_ACK = 10 };
typedef struct __attribute__((packed)) {      // W1 -> Camera (a cada 5 s): estado para o heartbeat
    CabEspNow cab; char state[12]; uint32_t restanteSeg;   // state = "FREE" / "WASHING"
} MsgHbState;
typedef struct __attribute__((packed)) {      // Camera -> W1: resposta do backend
    CabEspNow cab; uint8_t ok; uint8_t lightState; uint16_t lic_days; uint8_t lic_blocked;
    uint8_t start_valido; uint8_t start_prog; uint32_t start_dur; char start_res[40]; int16_t vacuum_seg;
} MsgHbResp;
typedef struct __attribute__((packed)) {      // W1 -> Camera: evento p/ a nuvem (a fila fica na NVS da W1 ate o ACK)
    CabEspNow cab; uint8_t evt_tipo; uint8_t prog; char res[40]; char source[8]; char errcode[64];   // tipo 1=car-entered 2=wash-complete 3=fault
} MsgEvt;
typedef struct __attribute__((packed)) {      // Camera -> W1: backend aceitou (200)
    CabEspNow cab; uint8_t evt_tipo; uint8_t ok; char res[40];
} MsgEvtAck;

typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t tabela, i1, i2; uint16_t valor; } MsgTesteCfgSet;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t tabela, i1; } MsgTesteCfgReq;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t tabela, i1; uint16_t v[14]; } MsgTesteCfgDump;

// acao: 0=HOME (alterna iniciar/cancelar)  1=INICIAR teste da Alta Pressao
//       5=CARRO REAL (X10 real, atrasos originais)  6=SECO (X10 simulado; so com a maquina parada)
//       7=TIPO do proximo ciclo (arg 0 presencial, 1 aplicativo, 2 socio, 3 bonus; volta a 0 depois de cada ciclo)  9=ACERTO (pagamento efetuado; so parado)
//       60..65 = saida manual (valvula, espuma A, espuma B, cor magica, secagem, cera): arg 1 liga, 0 desliga (so parado; desliga sozinha em 60 s)
//       70 = TECNICO PRESENTE (o display manda a cada 10 s enquanto esta nas telas TECNICO/MANUAL/WI-FI; mantem as luzes da maquina acesas)
//       66 = TESTE da bomba de alta pressao (Y13; so com BOMBA em ON; desliga sozinha em 20 s). Bit 6 de man_saidas.
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
    uint8_t  ev_seq;          // contador de EVENTOS DE FIM DE CICLO (sobe 1 a cada ciclo concluido ou com erro; o display nao perde nenhum)
    uint8_t  ev_tipo;         // ultimo evento: 1 = ciclo concluido, 2 = erro
    uint8_t  ev_modelo;       // modelo do ultimo evento
    uint8_t  tipo_prox;       // tipo do proximo ciclo (0 presencial, 1 aplicativo, 2 socio, 3 bonus)
    uint8_t  man_saidas;      // saidas MANUAIS ligadas (bits: 0 valvula Y6, 1 espuma A, 2 espuma B, 3 cor magica, 4 secagem, 5 cera)
    uint8_t  manual_mov;      // movimento MANUAL em curso (0=nenhum, 10..13 como em MsgTesteCmd)
    uint16_t giro_ms[3];      // tempo do giro 1->2 efetivo: Pre-lavagem, Espuma A, Alta Pressao (ms)
    char     msg[48];         // ultima mensagem (erro, HOME ou aviso do manual)
} MsgTesteStatus;

// Tamanho maximo de um pacote ESP-NOW = 250 bytes: se algum estourar, a compilacao falha aqui.
static_assert(sizeof(MsgTesteStatus) <= 250, "MsgTesteStatus passou de 250 bytes");
static_assert(sizeof(MsgTesteCfgDump) <= 250, "MsgTesteCfgDump passou de 250 bytes");
static_assert(sizeof(MsgWifiCfg) <= 250, "MsgWifiCfg passou de 250 bytes");
static_assert(sizeof(MsgScanResp) <= 250, "MsgScanResp passou de 250 bytes");
static_assert(sizeof(MsgHbResp) <= 250 && sizeof(MsgEvt) <= 250 && sizeof(MsgEvtAck) <= 250 && sizeof(MsgHbState) <= 250, "mensagem da nuvem passou de 250 bytes");
