#pragma once
#include "tipos.h"
#include "comm_espnow.h"
// Este arquivo e incluido no FIM de maquina_estados.h, entao os macros
// X*/SET_Y*/HOME e as funcoes auto_erro()/braco_em_home()/g_estado_auto
// ja estao visiveis aqui.

// =======================================================================
// Sub-maquinas dos processos automaticos (nao-bloqueantes, base millis()).
//
//   - Cada sub-maquina (giro / carrinho) tem um par iniciar()/tick():
//     iniciar() so prepara o movimento e retorna na hora; tick() e chamado
//     repetidamente pelo laco principal e SEMPRE retorna imediatamente
//     (SUB_RUN / SUB_DONE / SUB_ERR). NENHUMA sub-maquina bloqueia o
//     programa com laco proprio ou delay longo — inclusive o giro, que
//     antes travava a maquina inteira por ate 12s (corrigido nesta versao).
//   - Cada processo usa _pst (estado) e _pt (timestamp), compartilhados
//     (so 1 processo ativo por vez). Cada processo reseta _pst=0 ao concluir.
//   - Em erro: auto_erro(msg) e retorna false (nao avanca de slot).
//
// REGRAS DE GIRO (validadas com o usuario):
//   - O giro normal (fora do giro triplo da Alta Pressao) e SEMPRE em
//     sentido anti-horario (REV), tanto pos1->2 quanto pos2->1.
//   - T=0 do giro e o instante em que Y4 liga. A partir dai, dois
//     cronometros INDEPENDENTES (um nao depende do outro):
//       * no 2->1, X17+HOME so pode parar apos 6500ms do T=0 (GIRO_IGNORA_X17_MS)
//       * a rampa de desaceleracao comeca aos 6000ms (GIRO_INICIO_RAMPA_MS)
//   - A rampa dura 1500ms, linear, da frequencia do processo ate 5Hz.
//   - Giro para assim que X17 for valido (pode ser antes da rampa acabar).
//   - Timeout de seguranca fixo (nao muda com a frequencia).
//   - Giro triplo da Alta Pressao: ida E volta usam a MESMA sequencia de
//     sentidos: anti-horario, horario, anti-horario.
// =======================================================================

enum SubRes { SUB_RUN = 0, SUB_DONE = 1, SUB_ERR = 2 };

// Estado/tempo do processo atual (1 processo por vez)
static uint8_t  _pst = 0;
static uint32_t _pt  = 0;

// freq (0.1Hz) da etapa do programa atual
static inline uint16_t vel(uint8_t etapa) {
    return g_velocidades[g_estado.programa_sel - 1][etapa];
}

// -----------------------------------------------------------------------
// GIRO — bloco unico, agora NAO BLOQUEANTE (giro_iniciar + giro_tick)
// -----------------------------------------------------------------------
static const char* _giro_msg = "";
bool               g_giro_ativo = false;

#define GIRO_FREQ_MAX        150   // 15.0 Hz — velocidade cheia do giro
#define GIRO_DESAC_FLOOR      50   // 5.0 Hz — piso da rampa de desaceleracao
#define GIRO_DESAC_MS        2000  // duracao da rampa (freq -> 5Hz) = 2,0s
#define GIRO_IGNORA_X17_MS   6500  // retardo de leitura do X17: no giro 2->1 a combinacao X17+HOME so pode PARAR o giro apos 6,5s contados do T=0 (Y4 liga, inicio do giro)
#define GIRO_INICIO_RAMPA_MS 6000  // fixo: rampa comeca aos 6s do INICIO do giro — INDEPENDENTE do tempo acima
#define GIRO_TIMEOUT_DEFAULT_MS 10000  // valor inicial do timeout (usado quando a NVS ainda nao tem valor)
#define VFD_SETTLE_MS         500  // regra do inversor: parar -> esperar -> comandar
#define GIRO_X17_CONST_MS     300  // X17 (NIVEL ao vivo) precisa ficar constante por esse tempo pra valer o fim do giro — ignora os pulsos de travessia que davam parada na hora errada
#define GIRO_HOME_CONST_MS    200  // HOME_GIRO precisa ficar constante por esse tempo — SO nos giros que terminam na posicao 1 (home). Filtra repique de X17 sem o HOME acompanhando.
#define GIRO_DUR_DEFAULT_MS  7500  // valor inicial do tempo de giro (usado quando a NVS ainda nao tem valor)
// TEMPORARIO (tuning): tempo de parada do giro, ajustavel AO VIVO pelo botao na tela
// AUTO e persistido na NVS. No lado 1->2 (pos 2) e a parada principal; no lado 2->1
// (home) e apenas a REDE DE SEGURANCA (a parada principal la e X17+HOME) — ver giro_tick.
uint32_t g_giro_dur_ms = GIRO_DUR_DEFAULT_MS;
// TEMPORARIO (tuning): timeout do giro, ajustavel por botao na tela e persistido.
// No lado 2->1 o timeout dispara o FINE-HOMING (busca por pulsos), NAO erro.
// No lado 1->2 (posicao 2) o timeout e erro de seguranca (braco travado).
uint32_t g_giro_timeout_ms = GIRO_TIMEOUT_DEFAULT_MS;

// ---- Posicionamento fino no HOME (fine-homing) apos cada giro 2->1 ----
#define GIRO_FASE_GIRO        0    // fase: girando normalmente
#define GIRO_FASE_HOME        1    // fase: buscando o home em pulsos
#define SENSOR_HOME_DEBOUNCE_MS 100 // X16/X17 (NIVEL) so valem apos ficarem >100ms constantes (filtra ruido/travessia curta)
#define FH_PULSE_HZ10        50    // 5.0 Hz — velocidade lenta dos pulsos de busca
#define FH_PULSE_MS        1000    // duracao de cada pulso de busca
#define FH_SETTLE_MS        500    // espera apos parar o pulso (inercia morrer) antes de ler sensores
#define FH_BUDGET_LEG1        5    // pulsos na 1a direcao (escolhida pela memoria passou/nao-passou)
#define FH_BUDGET_LEG2       10    // pulsos na direcao invertida (5 p/ voltar ao inicio + 5 p/ explorar o outro lado)
#define GIRO_RECMD_MS          250 // reforca a freq cheia (antes da rampa) a cada 250ms
#define GIRO_RAMP_STEP_MS      120 // recalcula a rampa a cada 120ms

// Estado interno do giro (uma unica instancia — so 1 giro por vez)
static uint32_t _giro_t0        = 0;      // T=0 — instante em que Y4 ligou
static bool     _giro_fwd       = false;
static uint16_t _giro_freq      = 0;      // freq do processo (0.1Hz)
static bool     _giro_desac     = false;
static bool     _giro_desac_piso= false;
static uint32_t _giro_t_desac   = 0;
static uint32_t _giro_t_ramp    = 0;
static uint32_t _giro_t_recmd   = 0;
static uint32_t _giro_t_x17_on  = 0;   // instante em que o NIVEL de X17 comecou constante
static bool     _giro_dest_home = false;// true se ESTE giro termina na posicao 1 (home): para em X17+HOME
static uint32_t _giro_t_home_on = 0;   // (legado, nao usado)
// --- estado do fine-homing (busca do home em pulsos apos o giro 2->1) ---
static bool     _giro_viu_home  = false;// memoria: passou pelo home durante o giro?
static bool     _giro_saiu_pos2 = false;// ja saiu da pos2 inicial (X17 zerou)
static uint32_t _giro_t_saiu_pos2 = 0;  // marco de tempo: instante em que o braco DEIXOU a pos2 (base dos cronometros do 2->1)
static bool     _giro_viu_x17   = false;// (apos sair da pos2) reentrou na zona do X17 perto do home
static bool     _giro_viu_x16   = false;// (apos sair da pos2) viu o sensor dedicado do home (X16)
// --- memoria de direcao do fine-homing (ordem anti-horaria 2->1: X11 -> X16 -> X17 -> X7) ---
static bool     _giro_viu_x11   = false;// viu o intermediario X11 (aquem do home)
static bool     _giro_saiu_x16  = false;// viu o X16 e depois SAIU dele (passou do home)
static bool     _giro_viu_x7    = false;// chegou no X7 (alem do home -> passou com folga)
static uint8_t  _giro_fase      = GIRO_FASE_GIRO;
static uint8_t  _fh_st          = 0;   // sub-estado da busca
static bool     _fh_fwd         = false;// sentido do pulso: true=horario(fwd), false=anti-horario(rev)
static uint8_t  _fh_n           = 0;   // pulsos ja dados na perna atual
static uint8_t  _fh_leg         = 0;   // 0 = 1a perna (budget 5) ; 1 = perna invertida (budget 10)
static uint32_t _fh_t           = 0;   // timer dos pulsos/settle

// Prepara o giro e retorna NA HORA — nao bloqueia.
// dest_home: true se este giro especifico termina na posicao 1 (home, onde X17 E
// HOME_GIRO ficam ativos juntos) -> criterio de parada exige os DOIS constantes.
// false = termina na posicao 2 (so X17) -> criterio de parada so olha X17 (como hoje).
static void giro_iniciar(bool fwd, uint16_t freq_hz10, bool dest_home) {
    if (freq_hz10 > GIRO_FREQ_MAX) freq_hz10 = GIRO_FREQ_MAX;
    if (freq_hz10 < 1) freq_hz10 = 1;

    g_giro_ativo = true;

    // (1) RESET do inversor: para explicito + espera zerar (nao herda o giro anterior)
    SET_Y14(false);                 // intertravamento Y4<->Y14
    vfd_stop();
    delay(VFD_SETTLE_MS);           // unico delay curto que resta (reset do motor) — 500ms
    // (2) liga Y4
    SET_Y4(true);
    // (3) envia parametros: freq do processo + REV (ou FWD)
    if (fwd) vfd_run_fwd(freq_hz10); else vfd_run_rev(freq_hz10);

    _giro_t0         = millis();    // T=0 deste giro — base dos DOIS cronometros independentes
    _giro_fwd        = fwd;
    _giro_freq       = freq_hz10;
    _giro_desac      = false;
    _giro_desac_piso = false;
    _giro_t_desac    = 0;
    _giro_t_ramp     = 0;
    _giro_t_recmd    = 0;
    _giro_t_x17_on   = 0;
    _giro_dest_home  = dest_home;
    _giro_t_home_on  = 0;
    _giro_viu_home   = false;
    _giro_saiu_pos2  = false;
    _giro_t_saiu_pos2 = 0;
    _giro_viu_x17    = false;
    _giro_viu_x16    = false;
    _giro_viu_x11    = false;
    _giro_saiu_x16   = false;
    _giro_viu_x7     = false;
    _giro_fase       = GIRO_FASE_GIRO;
    _fh_st           = 0;
}

// Chamado a cada ciclo do laco principal. SEMPRE retorna imediatamente.
static int giro_tick() {
    uint32_t agora = millis();

    // X17 e X16 agora sao NIVEL ao vivo (g_viv2, sempre fresco via ESP-NOW — nao
    // depende de refresh nem de latch). DEBOUNCE de 100ms: o nivel so vale depois de
    // ficar constante por >100ms, filtrando ruido e a travessia curta que, como pulso,
    // escapava entre as amostras de 50ms e fazia o giro 2->1 passar do home.
    bool x17_raw = (g_viv2 & 0x40) != 0;  // X17 (bit6) — NIVEL ao vivo
    bool x16_raw = (g_viv2 & 0x80) != 0;  // X16 HOME_GIRO (bit7) — NIVEL ao vivo
    static uint32_t _t_x17_on = 0, _t_x16_on = 0;
    if (x17_raw) { if (_t_x17_on == 0) _t_x17_on = agora; } else _t_x17_on = 0;
    if (x16_raw) { if (_t_x16_on == 0) _t_x16_on = agora; } else _t_x16_on = 0;
    bool x17  = x17_raw && (agora - _t_x17_on >= SENSOR_HOME_DEBOUNCE_MS);
    bool home = x16_raw && (agora - _t_x16_on >= SENSOR_HOME_DEBOUNCE_MS);
    bool combo = x17 && home;             // posicao 1 = X16 e X17 ambos constantes

    // ================= FASE 2: BUSCA FINA DO HOME (pulsos) =================
    // So os giros 2->1 (dest_home) entram aqui, quando o giro para perto do home.
    // Corrige o overshoot de inercia com pulsos lentos ate ficar sobre X17+HOME.
    if (_giro_fase == GIRO_FASE_HOME) {
        // PRIORIDADE: achou X17+HOME a QUALQUER instante (inclusive no meio de um
        // pulso) -> para IMEDIATAMENTE, sem esperar o pulso terminar nem o settle.
        if (combo) {
            SET_Y4(false); vfd_stop();
            g_giro_ativo = false;
            Serial.println("[GIRO] fine-home OK (X17+HOME) [imediato]");
            return SUB_DONE;
        }
        switch (_fh_st) {
            case 0:  // escolhe o sentido inicial pela MEMORIA do giro e faz o 1o settle.
                // Ordem anti-horaria (2->1): X11 -> X16 -> X17 -> X7.
                //  PASSOU do home (saiu do X16, ou chegou no X7) -> volta HORARIO (fwd).
                //  AQUEM  do home (viu X11 mas nao chegou/ficou)  -> segue ANTI-HORARIO (rev).
                if (_giro_saiu_x16 || _giro_viu_x7) {
                    _fh_fwd = true;   // horario — voltar
                    Serial.println("[GIRO] fine-home: PASSOU (saiu X16 / chegou X7) -> horario");
                } else {
                    _fh_fwd = false;  // anti-horario — avancar
                    Serial.printf("[GIRO] fine-home: AQUEM (viu_x11=%d) -> anti-horario\n", (int)_giro_viu_x11);
                }
                _fh_n = 0; _fh_leg = 0;
                vfd_stop(); _fh_t = agora; _fh_st = 1;
                break;
            case 1:  // settle parado antes de rodar (reversao segura no MS300)
                if (agora - _fh_t >= VFD_SETTLE_MS) {
                    SET_Y4(true);
                    if (_fh_fwd) vfd_run_fwd(FH_PULSE_HZ10); else vfd_run_rev(FH_PULSE_HZ10);
                    _fh_t = agora; _fh_st = 2;
                }
                break;
            case 2:  // pulso de FH_PULSE_MS
                if (agora - _fh_t >= FH_PULSE_MS) { vfd_stop(); _fh_t = agora; _fh_st = 3; }
                break;
            case 3:  // deixa a inercia morrer, entao avalia (combo ja tratado no topo)
                if (agora - _fh_t >= FH_SETTLE_MS) {
                    _fh_n++;
                    // REGRA 3: estava sobre X16/X17 e, ao pulsar para um lado, PERDEU o
                    // sinal (aqui ja com >200ms sem sinal, pois FH_SETTLE_MS=500ms) ->
                    // sentido errado -> inverte para o outro lado (busca X16+X17 juntos).
                    bool perdeu_tudo = !x17 && !home;
                    uint8_t budget = (_fh_leg == 0) ? FH_BUDGET_LEG1 : FH_BUDGET_LEG2;
                    if (_fh_leg == 0 && (perdeu_tudo || _fh_n >= budget)) {
                        _fh_fwd = !_fh_fwd;              // inverte -> 2a perna com budget 10
                        _fh_leg = 1; _fh_n = 0;
                        Serial.println("[GIRO] fine-home inverte sentido");
                    } else if (_fh_leg == 1 && _fh_n >= budget) {
                        SET_Y4(false); vfd_stop();
                        g_giro_ativo = false;
                        _giro_msg = "ERRO: home nao encontrado";
                        Serial.println("[GIRO] fine-home FALHOU");
                        return SUB_ERR;
                    }
                    _fh_t = agora; _fh_st = 1;           // proximo pulso (settle -> run)
                }
                break;
        }
        return SUB_RUN;
    }

    // ================= FASE 1: GIRO NORMAL =================
    uint32_t dt = agora - _giro_t0;      // tempo desde que Y4 ligou (T=0)

    if (_giro_dest_home) {
        // ---- lado 2->1 (home): Opcao A — parada principal = COMBINACAO X17+HOME.
        //      Se o timeout estourar sem a combinacao, tambem vai pro fine-homing
        //      (busca por pulsos), NAO da erro.
        //
        // MEMORIA robusta a ruido: comeca na pos2 (X17 ja = 1). So depois de sair da
        // pos2 (X17 zerou) e que passa a valer ter visto X17 e X16. Se viu os DOIS —
        // mesmo em instantes diferentes (um ruido pode quebrar a leitura simultanea) —
        // considera que PASSOU pelo home (tem que voltar no horario).
        // 1a vez que X17 zera: braco DEIXOU a pos2 -> registra o marco de tempo que
        // passa a ser a base dos cronometros do 2->1 (ignora o arranque variavel do VFD).
        if (!x17 && !_giro_saiu_pos2) {
            _giro_saiu_pos2 = true;
            _giro_t_saiu_pos2 = agora;
            Serial.printf("[GIRO] saiu pos2 dt_y4=%ums\n", (unsigned)(agora - _giro_t0));
        }
        if (_giro_saiu_pos2) {
            if (x17)  _giro_viu_x17 = true;              // reentrou na zona do X17 (perto do home)
            if (home) _giro_viu_x16 = true;              // viu o sensor dedicado do home
            else if (_giro_viu_x16) _giro_saiu_x16 = true; // viu o X16 e SAIU -> passou do home
            if (X11)  _giro_viu_x11 = true;              // intermediario (aquem do home)
            if (X7)   _giro_viu_x7  = true;              // alem do home -> passou com folga
        }
        if (combo || (_giro_viu_x17 && _giro_viu_x16)) _giro_viu_home = true;

        // PARADA robusta ao pulso: X16 (HOME_GIRO — NIVEL estavel, o giro pega facil a
        // 50ms) + X17 JA VISTO (latch _giro_viu_x17). NAO exige X17 e X16 no MESMO tick —
        // era isso que fazia o giro 2->1 PASSAR pelo home sem parar (o pulso do X17 caia
        // entre as amostras de 50ms). O HOME manual funciona porque amostra a 10ms.
        // Cronometros do 2->1 contados a partir da SAIDA da pos2 (nao do Y4): enquanto
        // _giro_t_saiu_pos2 for 0 (ainda na pos2), dt_saiu=0 e nada avanca.
        uint32_t dt_saiu = _giro_t_saiu_pos2 ? (agora - _giro_t_saiu_pos2) : 0;
        // retardo de leitura do X17 (GIRO_IGNORA_X17_MS) continua valendo, agora da saida da pos2.
        bool parada_home = home && _giro_viu_x17;
        if ((parada_home && dt_saiu >= GIRO_IGNORA_X17_MS) || dt_saiu >= g_giro_timeout_ms) {
            vfd_stop();
            Serial.printf("[GIRO] 2->1 fim giro (viu_home=%d parada=%d dt_saiu=%ums) -> fine-home\n",
                          (int)_giro_viu_home, (int)parada_home, (unsigned)dt_saiu);
            _giro_fase = GIRO_FASE_HOME; _fh_st = 0;
            return SUB_RUN;                              // segue no proximo tick ja buscando
        }
    } else {
        // ---- lado 1->2 (posicao 2, so X17): para por TEMPO (parada principal).
        if (dt >= g_giro_dur_ms) {
            vfd_stop(); SET_Y4(false);
            g_giro_ativo = false;
            Serial.printf("[GIRO] 1->2 tempo %ums -> DONE\n", (unsigned)g_giro_dur_ms);
            return SUB_DONE;
        }
    }

    // ---- RAMPA — comeca em GIRO_INICIO_RAMPA_MS. No 2->1 conta a partir da SAIDA da
    //      pos2 (_giro_t_saiu_pos2); no 1->2, desde T=0 (Y4). Enquanto o 2->1 nao saiu
    //      da pos2, dt_rampa=0 e a rampa nao comeca.
    uint32_t dt_rampa = _giro_dest_home
        ? (_giro_t_saiu_pos2 ? (agora - _giro_t_saiu_pos2) : 0)
        : dt;
    if (!_giro_desac && dt_rampa >= GIRO_INICIO_RAMPA_MS) {
        _giro_desac   = true;
        _giro_t_desac = agora;
    }
    if (_giro_desac && !_giro_desac_piso) {
        if (agora - _giro_t_ramp >= GIRO_RAMP_STEP_MS) {
            _giro_t_ramp = agora;
            uint32_t dtr = agora - _giro_t_desac;
            uint16_t f;
            if (dtr >= GIRO_DESAC_MS) { f = GIRO_DESAC_FLOOR; _giro_desac_piso = true; }
            else f = (uint16_t)(_giro_freq -
                    (uint32_t)(_giro_freq - GIRO_DESAC_FLOOR) * dtr / GIRO_DESAC_MS);
            Serial.printf("[RAMPA] dtr=%u f=%u (freq_giro=%u)\n", (unsigned)dtr, (unsigned)f, (unsigned)_giro_freq);  // TEMP debug rampa
            if (_giro_fwd) vfd_run_fwd(f); else vfd_run_rev(f);
        }
    } else if (!_giro_desac) {
        // antes da rampa: reforca a velocidade CHEIA periodicamente (garante
        // que nao fica com sobra do giro anterior)
        if (agora - _giro_t_recmd >= GIRO_RECMD_MS) {
            _giro_t_recmd = agora;
            if (_giro_fwd) vfd_run_fwd(_giro_freq); else vfd_run_rev(_giro_freq);
        }
    }

    // ---- TIMEOUT de seguranca — SO no lado 1->2 (no 2->1 o timeout ja levou ao
    //      fine-homing la em cima). Aqui e braco travado de verdade -> erro.
    if (!_giro_dest_home && dt > g_giro_timeout_ms) {
        vfd_stop(); SET_Y4(false);
        g_giro_ativo = false;
        _giro_msg = "ERRO: timeout giro";
        Serial.println("[GIRO] TIMEOUT -> ERR");
        return SUB_ERR;
    }

    return SUB_RUN;
}

// -----------------------------------------------------------------------
// Validacao anti-glitch dos fins de curso X12 e X10 (mesma ideia do X17):
// so consideram "ativo" apos o NIVEL ficar constante por SENSOR_VALID_MS.
// X12/X10 ja sao nivel ao vivo (nao pulso), entao basta cronometrar. Os
// timers sao zerados no iniciar de cada sub-maquina de carrinho.
// -----------------------------------------------------------------------
#define SENSOR_VALID_MS 300
static uint32_t _t_x12_on = 0;
static inline bool x12_estavel() {
    uint32_t a = millis();
    if (X12) { if (!_t_x12_on) _t_x12_on = a; return (a - _t_x12_on) >= SENSOR_VALID_MS; }
    _t_x12_on = 0; return false;
}
// X10 tem validacao propria (anti-fantasma) dentro da sub-maquina carr_rev_x10:
// alem da constancia de 300ms, exige ver o carrinho SAIR da zona antes de aceitar
// qualquer chegada — filtra pulso residual/ruido do indutivo perto do jato de agua.

// -----------------------------------------------------------------------
// Sub-maquina CARRINHO FWD (Y14 sentido A) ate 'dwell' ms apos perder X10.
//   Watchdog: se X0 (indutivo) nao pulsar por 2s -> "CARRO TRAVADO".
// -----------------------------------------------------------------------
#define CARRO_WD_MS  4000   // watchdog do X0: se nao pulsar por esse tempo -> CARRO TRAVADO (era 2000)
#define X10_FWD_LOST_MS  150   // no avanco, o X10 precisa ficar em 0 por esse tempo p/ valer "perdeu X10" (anti-fantasma)
static uint8_t     _cf_st = 0;
static uint32_t    _cf_t_x10 = 0, _cf_t_pulso = 0, _cf_dwell = 0;
static uint32_t    _cf_t_x10_lost = 0;   // instante em que o X10 comecou a ler 0 no avanco (debounce)
static bool        _cf_x0_ant = false;
static const char* _cf_msg = "";

// Garante o motor PARADO DE VEZ antes de um novo movimento. O carrinho costuma
// vir logo apos o giro (REV); arrancar sem o motor parar = REVERSAO de sentido
// que o VFD MS300 nao aceita -> nao anda ("CARRO TRAVADO"). Bloqueia ~500ms
// (curto, so o carrinho usa isso — o giro tem seu proprio reset em giro_iniciar).
static void vfd_parar_de_vez(uint32_t ms) {
    uint32_t ts = millis();
    while (millis() - ts < ms) { vfd_stop(); delay(50); }
}

static void carr_fwd_iniciar(uint16_t freq_hz10, uint32_t dwell_ms) {
    vfd_parar_de_vez(VFD_SETTLE_MS);       // motor parado antes de reverter p/ FWD
    SET_Y14(true);
    vfd_run_fwd(freq_hz10);
    _cf_st      = 0;
    _cf_dwell   = dwell_ms;
    _cf_t_pulso = millis();
    _cf_x0_ant  = X0;
    _cf_t_x10_lost = 0;                   // reinicia o debounce da perda do X10
}

static int carr_fwd_tick() {
    // X0 (indutivo) pulsa rapido (~300ms) e o tick principal (LVGL + comm)
    // pode ser lento demais pra amostrar sem perder pulso -> OVERSAMPLE: le o
    // io1 varias vezes seguidas aqui, amostrando o X0 a cada ~25ms, garantindo
    // pegar as bordas antes de acusar "CARRO TRAVADO".
    for (uint8_t k = 0; k < 5; k++) {
        bool x0 = X0;
        if (x0 != _cf_x0_ant) { _cf_t_pulso = millis(); _cf_x0_ant = x0; }
        if (k < 4) modbus_refresh_io1_di();   // proxima amostra fresca do X0
    }
    if (millis() - _cf_t_pulso > CARRO_WD_MS) {   // X0 sem pulsar por CARRO_WD_MS -> travado
        vfd_stop(); SET_Y14(false);
        _cf_msg = "CARRO TRAVADO";
        return SUB_ERR;
    }
    switch (_cf_st) {
        case 0:  // perdeu X10 — mas so vale se ficar em 0 por X10_FWD_LOST_MS (filtra fantasma)
                 if (!X10) {
                     if (_cf_t_x10_lost == 0) _cf_t_x10_lost = millis();          // X10 caiu a 0 agora
                     if (millis() - _cf_t_x10_lost >= X10_FWD_LOST_MS) {          // ficou 0 por 150ms -> perdeu de verdade
                         _cf_st = 1; _cf_t_x10 = millis();
                     }
                 } else {
                     _cf_t_x10_lost = 0;                                          // X10 voltou -> era fantasma, reseta
                 }
                 break;
        case 1:  if (millis() - _cf_t_x10 >= _cf_dwell) {
                     vfd_stop(); SET_Y14(false);
                     return SUB_DONE;
                 }
                 break;
    }
    return SUB_RUN;
}

// -----------------------------------------------------------------------
// Sub-maquina CARRINHO REV (Y14 sentido B) ate X10 ativo + 500ms.
// -----------------------------------------------------------------------
static uint8_t  _cr_st   = 0;
static uint32_t _cr_t     = 0;
static bool     _cr_saiu  = false;   // true so depois de confirmar que o carrinho
                                     // realmente deixou a zona do X10 (filtra leitura
                                     // fantasma logo no inicio do retorno)
static uint32_t _cr_t_x10_on = 0;    // instante em que X10 comecou a ler ativo sem
                                     // interrupcao (p/ exigir constancia de 300ms)

#define X10_CONST_MS  300   // X10 precisa ficar lido ativo por 300ms seguidos p/
                            // valer -- filtra pulso falso (ruido/borbulha de agua
                            // do sensor indutivo perto do jato de agua)

static void carr_rev_x10_iniciar(uint16_t freq_hz10) {
    vfd_parar_de_vez(VFD_SETTLE_MS);       // motor parado antes de reverter p/ REV
    SET_Y14(true);
    vfd_run_rev(freq_hz10);
    _cr_st       = 0;
    _cr_saiu     = !X10;   // se ja comeca com X10 falso, ok de cara; senao so libera
                           // apos ver o carrinho realmente sair da zona (evita
                           // aceitar de primeira uma leitura residual/fantasma)
    _cr_t_x10_on = 0;
}

static int carr_rev_x10_tick() {
    if (!X10) { _cr_saiu = true; _cr_t_x10_on = 0; }  // confirma saida + reseta constancia
    switch (_cr_st) {
        case 0:
            if (_cr_saiu && X10) {
                if (_cr_t_x10_on == 0) _cr_t_x10_on = millis();    // comecou a ler ativo agora
                if (millis() - _cr_t_x10_on >= X10_CONST_MS) {     // ficou 300ms constante
                    _cr_st = 1; _cr_t = millis();
                }
            }
            break;
        case 1:  if (millis() - _cr_t >= 500) {
                     vfd_stop(); SET_Y14(false);
                     return SUB_DONE;
                 }
                 break;
    }
    return SUB_RUN;
}

// -----------------------------------------------------------------------
// Sub-maquina CARRINHO REV ate o fim de curso X12, com rampa de 1s.
// -----------------------------------------------------------------------
static uint8_t  _cx_st = 0;
static uint32_t _cx_t  = 0;
static uint32_t _cx_t_pulso = 0;   // watchdog X0 no retorno: ultimo instante em que o X0 pulsou
static bool     _cx_x0_ant  = false;

static void carr_rev_x12_iniciar(uint16_t freq_hz10) {
    vfd_parar_de_vez(VFD_SETTLE_MS);       // motor parado antes de arrancar o deslocamento
    SET_Y14(true);
    vfd_run_rev(freq_hz10);
    _cx_st = 0;
    _cx_t_pulso = millis();               // arma o watchdog do X0 (carro travado no retorno)
    _cx_x0_ant  = X0;
    _t_x12_on = 0;                        // reinicia validacao de 300ms do X12
}

static int carr_rev_x12_tick() {
    // Watchdog do X0 SO na fase 0 (enquanto o carrinho anda ate o X12). Igual ao carr_fwd:
    // oversample do X0 (le a io1 varias vezes) e, se nao pulsar por CARRO_WD_MS, acusa travado.
    // Na fase 1 (ja parou no X12, rampa 1s) o X0 nao pulsa mais -> nao roda o watchdog la.
    if (_cx_st == 0) {
        for (uint8_t k = 0; k < 5; k++) {
            bool x0 = X0;
            if (x0 != _cx_x0_ant) { _cx_t_pulso = millis(); _cx_x0_ant = x0; }
            if (k < 4) modbus_refresh_io1_di();   // proxima amostra fresca do X0
        }
        if (millis() - _cx_t_pulso > CARRO_WD_MS) {   // X0 sem pulsar -> carro travado no retorno
            vfd_stop(); SET_Y14(false);
            _cf_msg = "CARRO TRAVADO";
            return SUB_ERR;
        }
    }
    switch (_cx_st) {
        case 0:  if (x12_estavel()) { vfd_stop(); _cx_st = 1; _cx_t = millis(); } break; // fim de curso X12 >=300ms
        case 1:  if (millis() - _cx_t >= 1000) {                                // rampa 1s
                     SET_Y14(false);
                     return SUB_DONE;
                 }
                 break;
    }
    return SUB_RUN;
}

// =======================================================================
// PROC_PRE_LAVAGEM e PROC_ENXAGUE (mesmo roteiro)
// =======================================================================
enum {
    PL_HOME = 0, PL_BOMBA, PL_BOMBA_WAIT,
    PL_GIRO1_INI, PL_GIRO1, PL_FWD_INI, PL_FWD,
    PL_PARA_MEIO, PL_REV_MEIO_INI, PL_REV_MEIO,
    PL_GIRO2_INI, PL_GIRO2, PL_RET_INI, PL_RET, PL_FIM
};

static bool tick_pre_lavagem() {
    switch (_pst) {
        case PL_HOME:
            // TESTE: checagem de HOME por processo desativada — validacao unica agora
            // no fim da entrada de carros (AUTO_INICIANDO). Descomentar p/ reverter.
            // if (!braco_em_home()) { auto_erro("braco fora de posicao"); return false; }
            _pst = PL_BOMBA; break;
        case PL_BOMBA:
            SET_Y13(true); _pt = millis(); _pst = PL_BOMBA_WAIT; break;
        case PL_BOMBA_WAIT:
            if (millis() - _pt >= 2000) _pst = PL_GIRO1_INI; break;

        case PL_GIRO1_INI:
            giro_iniciar(false, vel(0), false); _pst = PL_GIRO1; break;   // REV (anti-horario) pos1->2 (nao-home)
        case PL_GIRO1: {
            int r = giro_tick();
            if (r == SUB_ERR)  { auto_erro(_giro_msg); return false; }
            if (r == SUB_DONE) _pst = PL_FWD_INI;
            break; }

        case PL_FWD_INI:
            carr_fwd_iniciar(vel(0), 1000); _pst = PL_FWD; break;    // ate 1000ms apos perder X10
        case PL_FWD: {
            int r = carr_fwd_tick();
            if (r == SUB_ERR) { auto_erro(_cf_msg); return false; }
            if (r == SUB_DONE) { _pt = millis(); _pst = PL_PARA_MEIO; }
            break; }

        case PL_PARA_MEIO:
            if (millis() - _pt >= 500) _pst = PL_REV_MEIO_INI; break; // 500ms parado
        case PL_REV_MEIO_INI:
            carr_rev_x10_iniciar(vel(0)); _pst = PL_REV_MEIO; break;  // volta ate X10+500ms
        case PL_REV_MEIO: {
            int r = carr_rev_x10_tick();
            if (r == SUB_DONE) _pst = PL_GIRO2_INI;
            break; }

        case PL_GIRO2_INI:
            giro_iniciar(false, vel(0), true); _pst = PL_GIRO2; break;   // REV (anti-horario) pos2->1 (home)
        case PL_GIRO2: {
            int r = giro_tick();
            if (r == SUB_ERR)  { auto_erro(_giro_msg); return false; }
            if (r == SUB_DONE) _pst = PL_RET_INI;
            break; }

        case PL_RET_INI:
            carr_rev_x12_iniciar(vel(10)); _pst = PL_RET; break;     // retorno ate X12 (rampa 1s)
        case PL_RET: {
            int r = carr_rev_x12_tick();
            if (r == SUB_ERR)  { auto_erro(_cf_msg); return false; }   // X0 travado no retorno
            if (r == SUB_DONE) _pst = PL_FIM;
            break; }

        case PL_FIM:
            SET_Y13(false);
            _pst = 0;
            return true;
    }
    return false;
}

// =======================================================================
// PROC_ALTA_PRESSAO — igual ao PRE_LAVAGEM, mas GIRO TRIPLO em cada lado.
//   Ida  (antes do carrinho): anti-horario -> horario -> anti-horario
//   Volta(apos o carrinho)  : anti-horario -> horario -> anti-horario  (MESMA sequencia da ida)
// =======================================================================
enum {
    AP_INI = 0, AP_WAIT,             // espera inicial de 5s antes de comecar o processo
    AP_HOME, AP_BOMBA, AP_BOMBA_WAIT,
    AP_GI_INI, AP_GI, AP_GI_GAP,     // giros de ida (3x)
    AP_FWD_INI, AP_FWD,
    AP_PARA_MEIO, AP_REV_MEIO_INI, AP_REV_MEIO,
    AP_GV_INI, AP_GV, AP_GV_GAP,     // giros de volta (3x)
    AP_RET_INI, AP_RET, AP_FIM
};
static uint8_t _ap_giro_n = 0;   // contador de giros no lado atual (0,1,2)

// direcao do giro N (0,1,2) dentro do triplo: anti-horario, horario, anti-horario
// fwd=true -> horario ; fwd=false -> anti-horario (REV)
static inline bool ap_giro_fwd(uint8_t n) { return (n % 2) == 1; }

// destino de cada giro do triplo (p/ exigir HOME_GIRO SO quando termina na pos1).
// Cada meia-volta ALTERNA a posicao (independe do sentido); o conjunto de IDA parte
// da pos1 (home) e o de VOLTA parte da pos2, entao o destino sai pela paridade de n:
//   IDA  : 1->2 (n0), 2->1 (n1, HOME), 1->2 (n2)          -> home nos indices IMPARES
//   VOLTA: 2->1 (n0, HOME), 1->2 (n1), 2->1 (n2, HOME)    -> home nos indices PARES
static inline bool ap_ida_dest_home(uint8_t n)   { return (n % 2) == 1; }
static inline bool ap_volta_dest_home(uint8_t n) { return (n % 2) == 0; }

static bool tick_alta_pressao() {
    switch (_pst) {
        case AP_INI:
            _pt = millis(); _pst = AP_WAIT; break;                  // marca T=0 da espera inicial
        case AP_WAIT:
            if (millis() - _pt >= 5000) _pst = AP_HOME; break;      // aguarda 5s antes de iniciar a AP
        case AP_HOME:
            // TESTE: checagem de HOME por processo desativada — validacao unica agora
            // no fim da entrada de carros (AUTO_INICIANDO). Descomentar p/ reverter.
            // if (!braco_em_home()) { auto_erro("braco fora de posicao"); return false; }
            _pst = AP_BOMBA; break;
        case AP_BOMBA:
            SET_Y13(true); _pt = millis(); _pst = AP_BOMBA_WAIT; break;
        case AP_BOMBA_WAIT:
            if (millis() - _pt >= 2000) { _ap_giro_n = 0; _pst = AP_GI_INI; } break;

        // ---- Giro triplo de IDA: anti-horario, horario, anti-horario ----
        case AP_GI_INI:
            giro_iniciar(ap_giro_fwd(_ap_giro_n), vel(8), ap_ida_dest_home(_ap_giro_n)); _pst = AP_GI; break;
        case AP_GI: {
            int r = giro_tick();
            if (r == SUB_ERR) { auto_erro(_giro_msg); return false; }
            if (r == SUB_DONE) { _pt = millis(); _pst = AP_GI_GAP; }
            break; }
        case AP_GI_GAP:
            if (millis() - _pt >= 500) {          // gap entre giros
                _ap_giro_n++;
                _pst = (_ap_giro_n >= 3) ? AP_FWD_INI : AP_GI_INI;
            }
            break;

        case AP_FWD_INI:
            carr_fwd_iniciar(vel(8), 1000); _pst = AP_FWD; break;
        case AP_FWD: {
            int r = carr_fwd_tick();
            if (r == SUB_ERR) { auto_erro(_cf_msg); return false; }
            if (r == SUB_DONE) { _pt = millis(); _pst = AP_PARA_MEIO; }
            break; }
        case AP_PARA_MEIO:
            if (millis() - _pt >= 500) _pst = AP_REV_MEIO_INI; break;
        case AP_REV_MEIO_INI:
            carr_rev_x10_iniciar(vel(8)); _pst = AP_REV_MEIO; break;
        case AP_REV_MEIO: {
            int r = carr_rev_x10_tick();
            if (r == SUB_DONE) { _ap_giro_n = 0; _pst = AP_GV_INI; }
            break; }

        // ---- Giro triplo de VOLTA: anti-horario, horario, anti-horario (MESMA sequencia da ida) ----
        case AP_GV_INI:
            giro_iniciar(ap_giro_fwd(_ap_giro_n), vel(8), ap_volta_dest_home(_ap_giro_n)); _pst = AP_GV; break;
        case AP_GV: {
            int r = giro_tick();
            if (r == SUB_ERR) { auto_erro(_giro_msg); return false; }
            if (r == SUB_DONE) { _pt = millis(); _pst = AP_GV_GAP; }
            break; }
        case AP_GV_GAP:
            if (millis() - _pt >= 500) {
                _ap_giro_n++;
                _pst = (_ap_giro_n >= 3) ? AP_RET_INI : AP_GV_INI;
            }
            break;

        case AP_RET_INI:
            carr_rev_x12_iniciar(vel(10)); _pst = AP_RET; break;
        case AP_RET: {
            int r = carr_rev_x12_tick();
            if (r == SUB_ERR)  { auto_erro(_cf_msg); return false; }   // X0 travado no retorno
            if (r == SUB_DONE) _pst = AP_FIM;
            break; }

        case AP_FIM:
            SET_Y13(false);
            _pst = 0;
            return true;
    }
    return false;
}

// =======================================================================
// Processos "simples" com solenoide(s): liga -> desloca -> volta.
//   Estrutura comum: HOME -> liga solenoides -> 2s -> [giro opcional] ->
//   FWD (dwell) -> 500ms -> REV ate X12 -> desliga solenoides.
// =======================================================================
enum {
    SP_HOME = 0, SP_LIGA, SP_LIGA_WAIT,
    SP_GIRO1_INI, SP_GIRO1,
    SP_FWD_INI, SP_FWD, SP_PARA,
    SP_REV_X10_INI, SP_REV_X10,          // retorno parcial ate X10+500ms (so com_giro)
    SP_GIRO2_INI, SP_GIRO2,
    SP_REV_INI, SP_REV, SP_FIM
};

// Nucleo generico parametrizado, usado por espuma/cor magica/cera/secagem.
//   com_giro : executa giro pos1->2 antes e pos2->1 depois (espuma A)
//   fwd_dwell: ms apos perder X10 no FWD (1500 normal, 2500 secagem)
//   etapa_desl / etapa_giro: indices de velocidade
//   desliga():  callback pra desligar as saidas no fim
static bool _proc_simples(bool com_giro, uint32_t fwd_dwell,
                          uint8_t etapa_desl, uint8_t etapa_giro,
                          void (*desliga)(), uint32_t liga_wait_ms = 2000) {
    switch (_pst) {
        case SP_HOME:
            // TESTE: checagem de HOME por processo desativada — validacao unica agora
            // no fim da entrada de carros (AUTO_INICIANDO). Descomentar p/ reverter.
            // if (!braco_em_home()) { auto_erro("braco fora de posicao"); return false; }
            _pt = millis(); _pst = SP_LIGA_WAIT; break;   // solenoides ja ligados pelo caller
        case SP_LIGA_WAIT:
            // ventiladores/solenoides ligados por liga_wait_ms antes de mover o Y14
            if (millis() - _pt >= liga_wait_ms) _pst = com_giro ? SP_GIRO1_INI : SP_FWD_INI; break;

        case SP_GIRO1_INI:
            giro_iniciar(false, vel(etapa_giro), false); _pst = SP_GIRO1; break;   // REV pos1->2 (nao-home)
        case SP_GIRO1: {
            int r = giro_tick();
            if (r == SUB_ERR)  { auto_erro(_giro_msg); return false; }
            if (r == SUB_DONE) _pst = SP_FWD_INI;
            break; }

        case SP_FWD_INI:
            carr_fwd_iniciar(vel(etapa_desl), fwd_dwell); _pst = SP_FWD; break;
        case SP_FWD: {
            int r = carr_fwd_tick();
            if (r == SUB_ERR) { auto_erro(_cf_msg); return false; }
            if (r == SUB_DONE) { _pt = millis(); _pst = SP_PARA; }
            break; }
        case SP_PARA:
            // com giro: retorno parcial ate X10 -> giro2 -> retorno final X12
            // sem giro: vai direto pro retorno final X12
            if (millis() - _pt >= 500) _pst = com_giro ? SP_REV_X10_INI : SP_REV_INI;
            break;

        case SP_REV_X10_INI:
            carr_rev_x10_iniciar(vel(etapa_desl)); _pst = SP_REV_X10; break;  // retorno parcial ate X10+500ms
        case SP_REV_X10: {
            int r = carr_rev_x10_tick();
            if (r == SUB_DONE) _pst = SP_GIRO2_INI;
            break; }

        case SP_GIRO2_INI:
            giro_iniciar(false, vel(etapa_giro), true); _pst = SP_GIRO2; break;   // REV pos2->1 (home)
        case SP_GIRO2: {
            int r = giro_tick();
            if (r == SUB_ERR)  { auto_erro(_giro_msg); return false; }
            if (r == SUB_DONE) _pst = SP_REV_INI;
            break; }

        case SP_REV_INI:
            carr_rev_x12_iniciar(vel(10)); _pst = SP_REV; break;    // retorno final ate X12
        case SP_REV: {
            int r = carr_rev_x12_tick();
            if (r == SUB_ERR)  { auto_erro(_cf_msg); return false; }   // X0 travado no retorno
            if (r == SUB_DONE) _pst = SP_FIM;
            break; }

        case SP_FIM:
            desliga();
            _pst = 0;
            return true;
    }
    return false;
}

// ---- Espuma A: Y7 + Y2, COM giro (etapa desl=2, giro=3) ----
static void _off_espa() { SET_Y7(false); SET_Y2(false); }
static bool tick_espuma_a() {
    if (_pst == SP_HOME) { SET_Y2(true); SET_Y7(true); }   // solenoide ANTES do Y7 (intertravamento)
    return _proc_simples(true, 1000, 2, 3, _off_espa);
}

// ---- Espuma B: Y7 + Y3, SEM giro (etapa desl=4) ----
static void _off_espb() { SET_Y7(false); SET_Y3(false); }
static bool tick_espuma_b() {
    if (_pst == SP_HOME) { SET_Y3(true); SET_Y7(true); }   // solenoide ANTES do Y7 (intertravamento)
    return _proc_simples(false, 1000, 4, 5, _off_espb);
}

// ---- Cor Magica: Y1 + Y7, SEM giro (etapa desl=6) ----
// Correcao: Y7 (bomba espuma cima) tambem deve ligar junto com Y1 — antes so
// ligava Y1 e Y7 ficava desligado, deixando a Cor Magica sem vazao de agua.
static void _off_cm() { SET_Y1(false); SET_Y7(false); SET_Y0(false); }
static bool tick_cor_magica() {
    if (_pst == SP_HOME) { SET_Y1(true); SET_Y7(true); SET_Y0(true); }   // Y0 junto com a Cor Magica
    return _proc_simples(false, 1000, 6, 7, _off_cm);
}

// ---- Cera de agua: Y7 + Y10, SEM giro (usa etapa 0 como default) ----
static void _off_cera() { SET_Y7(false); SET_Y10(false); }
static bool tick_cera_agua() {
    if (_pst == SP_HOME) { SET_Y10(true); SET_Y7(true); }   // solenoide ANTES do Y7 (intertravamento)
    return _proc_simples(false, 1000, 0, 0, _off_cera);
}

// ---- Secagem: Y5, SEM giro, dwell 2500ms (etapa 9). Ventiladores (Y5) ligados
//      4s antes de mover o carrinho (Y14) — os outros processos seguem com 2s. ----
static void _off_sec() { SET_Y5(false); }
static bool tick_secagem() {
    if (_pst == SP_HOME) { SET_Y5(true); }
    return _proc_simples(false, 2500, 9, 9, _off_sec, 4000);
}

// =======================================================================
// Avanco de processo dentro do modelo selecionado
// =======================================================================
void executar_processo_tick() {
    uint8_t proc = g_modelos[g_estado.programa_sel - 1][g_processo_atual_idx];

    if (proc == PROC_FIM) {
        g_estado_auto = AUTO_CONCLUIDO;
        return;
    }

    g_estado.processo_ativo = (Processo)proc;

    bool concluido = false;
    switch (proc) {
        case PROC_PRE_LAVAGEM:
        case PROC_ENXAGUE:      concluido = tick_pre_lavagem();  break;
        case PROC_ALTA_PRESSAO: concluido = tick_alta_pressao(); break;
        case PROC_ESPUMA_A:     concluido = tick_espuma_a();     break;
        case PROC_ESPUMA_B:     concluido = tick_espuma_b();     break;
        case PROC_COR_MAGICA:   concluido = tick_cor_magica();   break;
        case PROC_CERA_AGUA:    concluido = tick_cera_agua();    break;
        case PROC_SECAGEM:      concluido = tick_secagem();      break;
        // PROC_SPRAY e outros nao implementados: pula (nao trava o ciclo)
        default:                concluido = true;               break;
    }

    if (concluido) g_processo_atual_idx++;  // avanca pro proximo slot
}

// =======================================================================
// Reset de todas as sub-maquinas (chamado por auto_iniciar)
// =======================================================================
void processos_reset() {
    _pst = 0; _pt = 0;
    g_giro_ativo = false;
    _cf_st = 0; _cr_st = 0; _cx_st = 0;
    _cr_saiu = false; _cr_t_x10_on = 0;
    _ap_giro_n = 0;
}

// Desloca TODOS os cronometros dos processos por 'delta' ms. Chamado ao RETOMAR da
// pausa: como o millis() correu durante a pausa, somamos esse tempo em cada base de
// tempo, entao "millis() - base" fica igual e o giro/carrinho continuam do mesmo ponto.
void processos_shift_timers(uint32_t delta) {
    _pt          += delta;   // timer da etapa do processo
    _giro_t0     += delta;   // giro: T=0 e rampas
    if (_giro_t_saiu_pos2) _giro_t_saiu_pos2 += delta;  // marco da saida da pos2 (base do 2->1)
    _giro_t_desac+= delta;
    _giro_t_ramp += delta;
    _giro_t_recmd+= delta;
    _fh_t        += delta;   // fine-homing (pulsos/settle)
    _cf_t_x10    += delta;   // carrinho FWD
    _cf_t_pulso  += delta;
    _cr_t        += delta;   // carrinho REV ate X10
    _cr_t_x10_on += delta;
    _cx_t        += delta;   // carrinho REV ate X12
}

// Sub-estado do processo atual (pra diagnostico na tela)
int proc_estado() { return (int)_pst; }

// Diagnostico (obsoleto — mantido p/ compatibilidade da tela)
int giro_dupla() { return 0; }
