#pragma once

// =======================================================================
// tipos_w1.h — versao enxuta do tipos.h original, só com o que
// processos.h/maquina_estados.h realmente usam. (Os defines de protocolo
// ESP-NOW ficam em protocolo_w1.h, que e incluido antes deste arquivo.)
// =======================================================================

#define DBG_PRINTF(...)  do { if (Serial.availableForWrite() > 64) Serial.printf(__VA_ARGS__); } while(0)
#define DBG_PRINTLN(x)   do { if (Serial.availableForWrite() > 64) Serial.println(x); } while(0)

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

typedef enum {
    AUTO_IDLE           = 0,
    AUTO_AGUARDA_CARRO  = 1,
    AUTO_CARRO_ENTRANDO = 2,
    AUTO_AGUARDA_POS    = 3,
    AUTO_INICIANDO      = 4,
    AUTO_PROCESSO       = 5,
    AUTO_CONCLUIDO      = 6,
    AUTO_ERRO           = 7,
    AUTO_PAUSADO        = 8,
    AUTO_HOMING         = 9,
} EstadoAuto;

#define NUM_PROCESSOS 11
#define NUM_ETAPAS    14
#define NUM_SLOTS     10

#define PULSO_W1_MASK  0x81   // X0 (b0), X7 (b7) — local, nesta propria placa
#define PULSO_W2_MASK  0x02   // X11 (b1) — remoto, na Waveshare 2

typedef struct {
    bool     modo_auto;
    uint8_t  programa_sel;
    bool     em_pausa;
    Processo processo_ativo;
    bool     alarme;
    const char* msg_alarme;
    uint32_t total_lavagens;
    float    horas_bomba;
} EstadoSistema;

typedef struct {
    uint16_t atraso_init;
    uint16_t tempo_espuma_a;
    uint16_t tempo_espuma_b;
    uint16_t tempo_cor_magica;
    uint16_t dist_compensacao;
    uint16_t sobrecarga_main;
    uint16_t sobrecarga_rotacao;
    uint16_t tempo_sobrecarga;
    uint16_t atraso_espuma_a;
    uint16_t atraso_espuma_b;
    uint16_t atraso_cor_magica;
    uint16_t atraso_secagem;
} ConfigSistema;

// Definidos em controle.h (antes era o display.ino) — esta placa agora e
// dona do estado "de verdade" do ciclo.
EstadoSistema g_estado = {0};
ConfigSistema g_config = {0};
// Projeto de testes: tabelas FIXAS, iguais aos padroes do display. Nao ha
// registro de velocidades nem de modelos. Modelo 1 = so Alta Pressao.
// Etapas: 8 = Alta Pressao (Delta); a bomba SAJ do teste e fixa em 25Hz (processos.h).
uint16_t      g_velocidades[4][NUM_ETAPAS] = {
    { 200, 200, 200, 150, 200, 150, 200, 150, 350, 300, 200, 240, 240, 320 },
    { 200, 200, 200, 150, 200, 150, 200, 150, 350, 300, 200, 240, 240, 320 },
    { 200, 200, 200, 150, 200, 150, 200, 150, 350, 300, 200, 240, 240, 320 },
    { 200, 200, 200, 150, 200, 150, 200, 150, 350, 300, 200, 240, 240, 320 },
};
uint8_t       g_modelos[4][NUM_SLOTS] = {
    { PROC_ALTA_PRESSAO, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
    { PROC_ALTA_PRESSAO, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
    { PROC_ALTA_PRESSAO, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
    { PROC_ALTA_PRESSAO, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
};
uint32_t      g_contadores[4] = {0,0,0,0};
float         g_horas_manual = 0;

extern EstadoAuto g_estado_auto;         // definido em maquina_estados.h
extern uint8_t    g_processo_atual_idx;  // idem

void auto_tick();
void auto_iniciar(uint8_t modelo);
void auto_cancelar();
void auto_pausar();
void auto_retomar();
int  proc_estado();
