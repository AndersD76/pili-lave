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
    // 2 = livre (era "Spray", que e a mesma coisa que a Cera d'agua = 6; foi removido)
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
#define NUM_SLOTS     14

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
// registro de velocidades nem de modelos. Sequencias dos 4 modelos = as originais do display.
// Etapas: 8 = Alta Pressao (Delta); a bomba SAJ do teste e fixa em 25Hz (processos.h).
// Etapas 0..10 = velocidades do CARRINHO/GIRO (Delta). Etapas 11..13 = PRESSAO DA AGUA (frequencia da bomba SAJ, em 0,1 Hz):
//   11 = Pre-lavagem, 12 = Enxague, 13 = Alta Pressao (padrao 25,0 Hz). Hoje o SAJ esta FORA do RS-485 (frequencia fixa no proprio SAJ), entao
//   estes tres valores so passam a valer quando o controle do SAJ voltar (filtro do RS-485: TESTE_SAJ_POR_RS485 = 1 em saj_rs485_w1.h).
uint16_t      g_velocidades[4][NUM_ETAPAS] = {
    { 200, 200, 200, 150, 200, 150, 200, 150, 350, 300, 200, 240, 240, 250 },
    { 200, 200, 200, 150, 200, 150, 200, 150, 350, 300, 200, 240, 240, 250 },
    { 200, 200, 200, 150, 200, 150, 200, 150, 350, 300, 200, 240, 240, 250 },
    { 200, 200, 200, 150, 200, 150, 200, 150, 350, 300, 200, 240, 240, 250 },
};
uint8_t       g_modelos[4][NUM_SLOTS] = {
    { PROC_COR_MAGICA, PROC_ALTA_PRESSAO, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
    { PROC_ESPUMA_A, PROC_COR_MAGICA, PROC_ALTA_PRESSAO, PROC_ESPUMA_A, PROC_COR_MAGICA, PROC_ALTA_PRESSAO, PROC_CERA_AGUA, PROC_PRE_LAVAGEM, PROC_SECAGEM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
    { PROC_ESPUMA_A, PROC_COR_MAGICA, PROC_ALTA_PRESSAO, PROC_ESPUMA_A, PROC_COR_MAGICA, PROC_ALTA_PRESSAO, PROC_ESPUMA_A, PROC_COR_MAGICA, PROC_ALTA_PRESSAO, PROC_CERA_AGUA, PROC_PRE_LAVAGEM, PROC_SECAGEM, PROC_FIM, PROC_FIM },
    { PROC_ESPUMA_A, PROC_COR_MAGICA, PROC_ALTA_PRESSAO, PROC_CERA_AGUA, PROC_PRE_LAVAGEM, PROC_SECAGEM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM, PROC_FIM },
};
// Espera por slot (segundos): depois de Espuma/Cor Magica/Cera = espera final; na Secagem = pausa ANTES de andar.
// 0xFFFF = usa o padrao de g_config. So vale em modo CARRO REAL (em SECO as esperas ficam zeradas).
uint16_t      g_modelos_espera[4][NUM_SLOTS] = {
    { 45, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF },
    { 45, 45, 0xFFFF, 45, 45, 0xFFFF, 5, 0xFFFF, 15, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF },
    { 45, 45, 0xFFFF, 45, 45, 0xFFFF, 45, 45, 0xFFFF, 5, 0xFFFF, 15, 0xFFFF, 0xFFFF },
    { 45, 45, 0xFFFF, 240, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF },
};
uint32_t      g_contadores[4] = {0,0,0,0};
float         g_horas_manual = 0;

extern EstadoAuto g_estado_auto;         // definido em maquina_estados.h
extern uint8_t    g_processo_atual_idx;  // idem

void auto_tick();
void luzes_tick();
void auto_iniciar(uint8_t modelo);
void lav_contar_ciclo(uint8_t modelo, uint8_t tipo);
void man_sai_zera();
void auto_cancelar();
void auto_pausar();
void auto_retomar();
int  proc_estado();

// ---- Tempo do giro 1->2 (movido de processos.h: o controle.h precisa dele antes) ----
#define GIRO_DUR_DEFAULT_MS  7900  // tempo padrao do giro 1->2 (ms), quando nao ha valor proprio do processo
uint32_t g_giro_dur_ms = GIRO_DUR_DEFAULT_MS;
// Tempo do giro 1->2 POR PROCESSO (ms; 0 = usa g_giro_dur_ms). O giro 1->2 para por tempo, e o angulo percorrido
// depende da velocidade do giro do processo (Alta Pressao 35 Hz, Espuma A 15 Hz, ...), entao cada processo que
// gira tem o seu tempo. Persistido na NVS (ver controle.h) e ajustavel na tela (AUTOMATICO > AJUSTE DO GIRO).
// Indices: 0 = Pre-lavagem, 1 = Espuma A, 2 = Alta Pressao.
#define GIRO_PROC_N 3
uint16_t g_giro_dur_proc[GIRO_PROC_N] = {0, 0, 0};
static inline int giro_idx_proc(uint8_t p) {
    return p == PROC_PRE_LAVAGEM ? 0 : p == PROC_ESPUMA_A ? 1 : p == PROC_ALTA_PRESSAO ? 2 : -1;
}
static inline uint32_t giro_dur_do_proc(uint8_t p) {
    int i = giro_idx_proc(p);
    return (i >= 0 && g_giro_dur_proc[i]) ? g_giro_dur_proc[i] : g_giro_dur_ms;
}
