#pragma once

// -----------------------------------------------------------------------
// Processos disponíveis
// -----------------------------------------------------------------------
typedef enum {
    PROC_NENHUM       = 0,
    PROC_PRE_LAVAGEM  = 1,
    PROC_SPRAY        = 2,
    PROC_ESPUMA_A     = 3,
    PROC_ESPUMA_B     = 4,
    PROC_COR_MAGICA   = 5,
    PROC_CERA_AGUA    = 6,
    PROC_ALTA_PRESSAO = 7,
    PROC_SECAGEM      = 8,
    PROC_ENXAGUE      = 9,
    PROC_FIM          = 10,
} Processo;

// -----------------------------------------------------------------------
// Estado da maquina automatica (ciclo completo de lavagem)
// -----------------------------------------------------------------------
typedef enum {
    AUTO_IDLE           = 0,  // aguardando escolha de modelo
    AUTO_AGUARDA_CARRO  = 1,  // modelo escolhido, aguardando carro entrar
    AUTO_CARRO_ENTRANDO = 2,  // X14 ativo — carro passando
    AUTO_AGUARDA_POS    = 3,  // carro passou X14, aguardando X15
    AUTO_INICIANDO      = 4,  // X15 ativo, contando 4s
    AUTO_PROCESSO       = 5,  // executando processo do modelo
    AUTO_CONCLUIDO      = 6,  // ciclo finalizado
    AUTO_ERRO           = 7,  // erro detectado — parado
    AUTO_PAUSADO        = 8,  // pause ativo
    AUTO_HOMING         = 9,  // referenciando o braço (HOME) antes dos processos
} EstadoAuto;

#define NUM_PROCESSOS 11
#define NUM_ETAPAS    11   // etapas de velocidade por programa
#define NUM_SLOTS     10   // slots de processo por modelo

// Nomes dos processos para exibição
static const char* NOMES_PROCESSO[NUM_PROCESSOS] = {
    "---",
    "Pre-lavagem",
    "Spray de agua",
    "Espuma A",
    "Espuma B",
    "Cor Magica",
    "Cera de agua",
    "Alta pressao",
    "Secagem ao ar",
    "Enxague",
    "FIM",
};

// Nomes das etapas de velocidade
static const char* NOMES_ETAPA[NUM_ETAPAS] = {
    "Pre-lavagem",
    "Spray agua",
    "Espuma A deslocamento",
    "Espuma A giro",
    "Espuma B deslocamento",
    "Espuma B giro",
    "Cor Magica deslocamento",
    "Cor Magica giro",
    "Alta pressao",
    "Secagem",
    "Retorno",
};

// -----------------------------------------------------------------------
// Estado do sistema
// -----------------------------------------------------------------------
typedef struct {
    bool     modo_auto;
    uint8_t  programa_sel;    // 1-4
    bool     em_pausa;
    Processo processo_ativo;
    bool     alarme;
    const char* msg_alarme;
    uint32_t total_lavagens;
    float    horas_bomba;
} EstadoSistema;

// -----------------------------------------------------------------------
// Configurações do sistema
// -----------------------------------------------------------------------
typedef struct {
    uint16_t atraso_init;         // segundos
    uint16_t tempo_espuma_a;      // segundos
    uint16_t tempo_espuma_b;      // segundos
    uint16_t tempo_cor_magica;    // segundos
    uint16_t dist_compensacao;    // pulsos X0
    uint16_t sobrecarga_main;     // Amperes
    uint16_t sobrecarga_rotacao;  // Amperes
    uint16_t tempo_sobrecarga;    // segundos
    uint16_t atraso_espuma_a;     // segundos
    uint16_t atraso_espuma_b;     // segundos
    uint16_t atraso_cor_magica;   // segundos
    uint16_t atraso_spray;        // segundos
} ConfigSistema;

// -----------------------------------------------------------------------
// Variáveis globais (definidas em lavadora_display.ino)
// -----------------------------------------------------------------------
extern EstadoSistema g_estado;
extern ConfigSistema g_config;
extern uint16_t      g_velocidades[4][NUM_ETAPAS];
extern uint8_t       g_modelos[4][NUM_SLOTS];
extern uint32_t      g_contadores[4];
extern float         g_horas_manual;   // horas acumuladas com motor ativo em modo manual

// -----------------------------------------------------------------------
// Maquina automatica (definida em maquina_estados.h / processos.h)
// -----------------------------------------------------------------------
extern EstadoAuto g_estado_auto;
extern uint8_t    g_processo_atual_idx;   // indice do slot atual no modelo

void auto_tick();                 // chamar no loop() a cada ~50ms quando modo_auto
void auto_iniciar(uint8_t modelo);// dispara o ciclo (chamado pelo INICIAR)
void auto_cancelar();             // cancela e volta pro idle
void auto_pausar();
void auto_retomar();
int  proc_estado();               // sub-estado do processo atual (diagnostico)

// -----------------------------------------------------------------------
// Callbacks de navegação
// -----------------------------------------------------------------------
extern void cb_ir_config();
extern void cb_ir_velocidades();
extern void cb_ir_modelos();
extern void cb_ir_manual();

// -----------------------------------------------------------------------
// Endereços Modbus
// -----------------------------------------------------------------------
#define MB_ADDR_IO1      1    // Waveshare #1
#define MB_ADDR_IO2      2    // Waveshare #2
#define MB_ADDR_INVERSOR 3    // Delta VFD-MS300

// Registradores Waveshare (coils)
#define MB_COIL_DO1      0x0000
#define MB_COIL_DO2      0x0001
#define MB_COIL_DO3      0x0002
#define MB_COIL_DO4      0x0003
#define MB_COIL_DO5      0x0004
#define MB_COIL_DO6      0x0005
#define MB_COIL_DO7      0x0006
#define MB_COIL_DO8      0x0007

// Registradores Waveshare (discrete inputs)
#define MB_DI1           0x0000
#define MB_DI2           0x0001
#define MB_DI3           0x0002
#define MB_DI4           0x0003
#define MB_DI5           0x0004
#define MB_DI6           0x0005
#define MB_DI7           0x0006
#define MB_DI8           0x0007

// Registradores Inversor Delta MS300
#define MB_VFD_CMD       0x2000   // comando: 0x18=FWD, 0x34=REV, 0x01=STOP
#define MB_VFD_FREQ      0x2001   // frequência em 0.01Hz (ex: 3000 = 30Hz)
#define MB_VFD_FREQ_OUT  0x2100   // frequência atual (leitura)
#define MB_VFD_CORRENTE  0x2101   // corrente atual (leitura)
#define MB_VFD_STATUS    0x2103   // status (bit0=RUN, bit1=FWD, bit2=REV, bit3=FALHA)

// Comandos VFD
#define VFD_FWD          0x0012   // RUN sentido A (FWD)
#define VFD_REV          0x0022   // RUN sentido B (REV)
#define VFD_STOP         0x0001   // STOP

// =======================================================================
// ESP-NOW — comunicacao Display <-> Waveshares (substitui o Modbus das WS).
// O inversor Delta (addr 3) CONTINUA em RS-485 Modbus RTU (ver vfd_rs485.h).
// =======================================================================
#define ID_MAQUINA 1   // <<< trocar este numero p/ replicar em outra maquina

// MACs LOGICOS por funcao (nao por chip): definidos via esp_wifi_set_mac()
// ANTES do esp_now_init() -> trocar a placa fisica NAO exige reconfiguracao.
// Byte[3] = ID_MAQUINA -> isola maquinas vizinhas (o display so aceita pacotes
// cujo MAC de origem tenha byte[3] == ID_MAQUINA local).
static const uint8_t MAC_DISPLAY[6] = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x01};
static const uint8_t MAC_WAVE1[6]   = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x02};
static const uint8_t MAC_WAVE2[6]   = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x03};

#define ESPNOW_CANAL   1      // canal WiFi fixo p/ os 3 nos
#define ORIGEM_DISPLAY 0
#define ORIGEM_WAVE1   1
#define ORIGEM_WAVE2   2
#define ORIGEM_CAMERA  3

// Grupos de sensor — mascaras de PULSO (bits que recebem LATCH no display):
//   Nivel (heartbeat/evento):  X10,X12,X13,X14,X15,X16(HOME_GIRO),X17
//   Pulso (ISR->evento+latch):  X0,X7 (W1)  ·  X11 (W2)
// X17 (b6) foi movido de PULSO -> NIVEL: agora e lido do nivel ao vivo (g_viv2),
// com debounce de 100ms no giro (ver giro_tick). Antes, como pulso, a travessia
// curta escapava entre as amostras de 50ms e o giro 2->1 passava do home.
#define PULSO_W1_MASK  0x81   // X0 (b0), X7 (b7)
#define PULSO_W2_MASK  0x02   // X11 (b1)   -- X16 (b7) e X17 (b6) sao NIVEL

enum : uint8_t {
    MSG_EVENTO    = 1,
    MSG_HEARTBEAT = 2,
    MSG_COMANDO   = 3,
    MSG_CANAL     = 4,   // sincronização de canal com Waveshares
    MSG_WIFI_REQ  = 5,   // câmera pede credenciais ao display
    MSG_WIFI_CFG  = 6,   // display responde com credenciais à câmera
    MSG_HB_STATE  = 7,   // display -> câmera: estado da máquina p/ o heartbeat
    MSG_HB_RESP   = 8,   // câmera -> display: resposta do backend (lamp/licença/start)
    MSG_EVT       = 9,   // display -> câmera: evento p/ a nuvem (car-entered/wash-complete/fault)
    MSG_EVT_ACK   = 10,  // câmera -> display: evento entregue (200 OK) -> pop da fila NVS
};

typedef struct __attribute__((packed)) {
    uint8_t tipo;         // MSG_*
    uint8_t id_maquina;   // ID_MAQUINA (defesa extra alem do MAC)
    uint8_t origem;       // ORIGEM_*
    uint8_t seq;          // sequencia (detecta perda/duplicata)
} CabEspNow;

typedef struct __attribute__((packed)) {      // Waveshare -> Display (na ISR do DI)
    CabEspNow cab;        // tipo = MSG_EVENTO
    uint8_t   di_vivo;    // estado ao vivo dos 8 DIs no instante do evento
    uint8_t   di_borda;   // bits que ACABARAM de acionar (a borda)
    uint32_t  t_us;       // micros() do evento
} MsgEvento;

typedef struct __attribute__((packed)) {      // Waveshare -> Display (a cada 200ms)
    CabEspNow cab;        // tipo = MSG_HEARTBEAT
    uint8_t   di_vivo;    // estado ao vivo dos 8 DIs
    uint8_t   do_estado;  // eco das 8 saidas (confirma DOs aplicados)
} MsgHeartbeat;

typedef struct __attribute__((packed)) {      // Display -> Waveshare
    CabEspNow cab;        // tipo = MSG_COMANDO
    uint8_t   canal;      // 0..7 (DO1..DO8)
    uint8_t   estado;     // 0=off, 1=on
} MsgComando;

// ----- Relay do heartbeat pela câmera (o display não tem RAM p/ TLS) -----
typedef struct __attribute__((packed)) {      // Display -> Câmera (a cada 10s)
    CabEspNow cab;        // tipo = MSG_HB_STATE
    char      state[12];  // "FREE" / "WASHING"
    uint32_t  restanteSeg;
} MsgHbState;

typedef struct __attribute__((packed)) {      // Câmera -> Display (resposta do backend)
    CabEspNow cab;         // tipo = MSG_HB_RESP
    uint8_t   ok;          // 1 = heartbeat 200 OK
    uint8_t   lightState;  // LampState (espelha lightState do backend)
    uint16_t  lic_days;    // daysWithoutPayment
    uint8_t   lic_blocked; // license.blocked
    uint8_t   start_valido;
    uint8_t   start_prog;  // 1..4
    uint32_t  start_dur;   // duracaoSeg
    char      start_res[40]; // reservationId (dedup)
} MsgHbResp;

// ----- Relay de eventos pela câmera (débito! wash-complete é o único ponto
// de cobrança). O display manda MSG_EVT (a fila fica no NVS dele) e SÓ tira
// da fila quando a câmera confirma com MSG_EVT_ACK (backend respondeu 200).
// DEVE bater byte a byte com o firmware da câmera (main.cpp).
typedef struct __attribute__((packed)) {      // Display -> Câmera
    CabEspNow cab;       // tipo = MSG_EVT
    uint8_t   evt_tipo;  // 1=car-entered 2=wash-complete 3=fault
    uint8_t   prog;      // programId (wash-complete)
    char      res[40];   // reservationId ("" = sem reserva)
    char      source[8]; // "" (app) ou "remote"
} MsgEvt;

typedef struct __attribute__((packed)) {      // Câmera -> Display
    CabEspNow cab;       // tipo = MSG_EVT_ACK
    uint8_t   evt_tipo;
    uint8_t   ok;        // 1 = backend aceitou (200)
    char      res[40];   // ecoa o reservationId
} MsgEvtAck;

#define HEARTBEAT_MS    200   // periodo do heartbeat da waveshare
#define COMM_TIMEOUT_MS 700   // sem heartbeat por isso -> comunicacao perdida (erro seguro)

// Chaves de criptografia ESP-NOW derivadas do ID_MAQUINA (byte[7]) — reforcam o
// isolamento entre maquinas. IDENTICAS nos 3 firmwares (display + 2 waveshares).
static const uint8_t ESPNOW_PMK[16] = {'P','I','L','I','-','p','m','k',ID_MAQUINA,0,0,0,0,0,0,0};
static const uint8_t ESPNOW_LMK[16] = {'P','I','L','I','-','l','m','k',ID_MAQUINA,0,0,0,0,0,0,0};

// -----------------------------------------------------------------------
// Mapeamento saídas — Waveshare #1 (DO1-DO8)
// -----------------------------------------------------------------------
// DO1 = Y1  = Solenoide Cor Mágica
// DO2 = Y2  = Solenoide Espuma A
// DO3 = Y3  = Solenoide Espuma B
// DO4 = Y4  = Contator giro braço     ⚠️ NUNCA simultâneo com W2_DO4!
// DO5 = Y5  = Compressor secagem
// DO6 = Y6  = A definir
// DO7 = Y7  = Bomba espuma
// DO8 = Y11 = Contador de tempo

// -----------------------------------------------------------------------
// Mapeamento saídas — Waveshare #2 (DO1-DO8)
// -----------------------------------------------------------------------
// DO1 = Y10 = A definir
// DO2 = Y12 = Luz vermelha
// DO3 = Y13 = Bomba alta pressão
// DO4 = Y14 = Contator deslocamento   ⚠️ NUNCA simultâneo com W1_DO4!
// DO5 = Y15 = A definir
// DO6-8 = RESERVA

// -----------------------------------------------------------------------
// Cores padrão da interface
// -----------------------------------------------------------------------
#define COR_FUNDO        lv_color_hex(0x1A1A2E)  // azul escuro industrial
#define COR_PAINEL       lv_color_hex(0x16213E)  // painel mais escuro
#define COR_DESTAQUE     lv_color_hex(0xE94560)  // vermelho PILI
#define COR_ATIVO        lv_color_hex(0x0F3460)  // azul médio
#define COR_TEXTO        lv_color_hex(0xEEEEEE)  // branco suave
#define COR_TEXTO_FRACO  lv_color_hex(0x888888)  // cinza
#define COR_VERDE        lv_color_hex(0x00C853)  // botão ativo/ligado
#define COR_VERMELHO     lv_color_hex(0xD50000)  // alarme/erro
#define COR_AMARELO      lv_color_hex(0xFFD600)  // aviso
#define COR_BORDA        lv_color_hex(0x2D4A7A)  // borda paineis
