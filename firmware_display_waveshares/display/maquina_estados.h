#pragma once
#include "tipos.h"
#include "comm_espnow.h"
#include "nvs_manager.h"

// --- App/backend: forward declarations (definicoes vem depois, no display.ino,
//     em backend_client.h/licenca.h — evita dependencia circular com g_estado_auto) ---
void backend_evt_car_entered();
void backend_evt_wash_complete(uint8_t programId, const String& source);
void backend_evt_fault();
bool licenca_bloqueada();

// =======================================================================
// Maquina de estados AUTOMATICA — ciclo completo de lavagem
//
// Fluxo de topo (auto_tick):
//   IDLE -> (INICIAR) -> AGUARDA_CARRO -> CARRO_ENTRANDO -> AGUARDA_POS
//        -> INICIANDO(4s) -> PROCESSO(sub-maquinas) -> CONCLUIDO -> IDLE
//   Qualquer erro num processo -> AUTO_ERRO (para tudo).
//
// IMPORTANTE: nada de delay(). Tudo por millis(). auto_tick e chamado a
// cada ~50ms no loop(). Os processos ficam em processos.h (incluido no fim).
// =======================================================================

EstadoAuto g_estado_auto        = AUTO_IDLE;
uint8_t    g_processo_atual_idx = 0;

// Timestamps / flags de controle do topo
static uint32_t t_estado         = 0;
static uint32_t t_x14_desligou   = 0;
static bool     x14_estava_ativo = false;

// -----------------------------------------------------------------------
// Leitura de sensores (nomes X* do CLP original)
//   Waveshare #1 (io1_get_di canal 1-8)
// -----------------------------------------------------------------------
#define X0        io1_get_di(1)   // sensor deslocamento (pulsos, indutivo)
#define X7        io1_get_di(8)   // giro braco posicao intermediaria (W1)
// Painel fisico (tratado em display.ino, nao pela FSM):
//   X1=DI2=modelo1  X2=DI3=modelo2  X3=DI4=manual/auto
//   X4=DI5=pause    X5=DI6=modelo3  X6=DI7=modelo4
//   Waveshare #2 (io2_get_di canal 1-8)
#define X10       io2_get_di(1)   // sensor vertical carro sob mesa
#define X11       io2_get_di(2)   // giro braco posicao intermediaria (W2)
#define X12       io2_get_di(3)   // fim de curso sentido B (tras)
#define X13       io2_get_di(4)   // fim de curso sentido A (frente)
#define X14       io2_get_di(5)   // carro entrando
#define X15       io2_get_di(6)   // carro na posicao de lavagem
#define X17       io2_get_di(7)   // HOME braco (posicao 1 E 2)
#define HOME_GIRO io2_get_di(8)   // sensor dedicado posicao 1

// -----------------------------------------------------------------------
// Saidas (SET_Yn(bool))
//   Waveshare #1 (io1_set_do canal 1-8)
// -----------------------------------------------------------------------
#define SET_Y1(v)  io1_set_do(1, v)   // solenoide Cor Magica
#define SET_Y2(v)  io1_set_do(2, v)   // solenoide Espuma A
#define SET_Y3(v)  io1_set_do(3, v)   // solenoide Espuma B
#define SET_Y4(v)  io1_set_do(4, v)   // contator giro braco   (trava Y4<->Y14)
#define SET_Y5(v)  io1_set_do(5, v)   // compressor secagem
#define SET_Y6(v)  io1_set_do(6, v)   // solenoide entrada pneumatica
#define SET_Y7(v)  io1_set_do(7, v)   // bomba espuma (cima)
#define SET_Y11(v) io1_set_do(8, v)   // lampada verde
//   Waveshare #2 (io2_set_do canal 1-8)
#define SET_Y10(v) io2_set_do(1, v)   // bomba espuma (baixo)
#define SET_Y12(v) io2_set_do(2, v)   // luz vermelha
#define SET_Y13(v) io2_set_do(3, v)   // bomba alta pressao
#define SET_Y14(v) io2_set_do(4, v)   // contator deslocamento (trava Y4<->Y14)
//   (DO5 = Y15 BLOQUEADO no firmware da waveshare2 — nao usar)
#define SET_Y0(v)  io2_set_do(6, v)   // Y0 (DO6 waveshare2) — aciona JUNTO com a Cor Magica

// -----------------------------------------------------------------------
// Desliga TODAS as saidas de processo + para o motor
// -----------------------------------------------------------------------
void desligar_tudo() {
    SET_Y1(false);  SET_Y2(false);  SET_Y3(false);
    SET_Y4(false);  SET_Y5(false);  SET_Y6(false);
    SET_Y7(false);  SET_Y10(false); SET_Y11(false);
    SET_Y12(false); SET_Y13(false); SET_Y14(false);
    SET_Y0(false);
    vfd_stop();
}

// Braco referenciado no HOME (posicao 1) = sensor dedicado HOME_GIRO (X16),
// que e onde a rotina de HOME para. (X17 fica ativo no home tambem, mas nao
// exigimos ele aqui pra nao depender do alinhamento exato dos dois sensores.)
bool braco_em_home() {
    return HOME_GIRO;
}

// Sinaliza erro do ciclo: guarda a mensagem (literal, vida estatica) e para tudo
static void auto_erro(const char* msg) {
    desligar_tudo();                 // para tudo UMA vez (aqui), pra o AUTO_ERRO
                                     // nao precisar spammar desligar_tudo() todo
                                     // tick (12 writes Modbus) e travar a tela
    g_estado.msg_alarme = msg;
    g_estado.alarme     = true;
    g_estado_auto       = AUTO_ERRO;
    backend_evt_fault();
    Serial.printf("[AUTO] ERRO: %s\n", msg);
}

// Forward: implementadas em processos.h (incluido no fim deste arquivo)
void executar_processo_tick();
void processos_reset();
void processos_shift_timers(uint32_t delta);   // desloca cronometros (usado ao retomar da pausa)
extern bool g_giro_ativo;   // true enquanto um giro roda (definido em processos.h)

// =======================================================================
// TICK PRINCIPAL — chamar a cada ~50ms
// =======================================================================
void auto_tick() {
    uint32_t agora = millis();

    // DIAGNOSTICO: loga toda mudanca de estado do ciclo
    static int _ea_ant = -1;
    if ((int)g_estado_auto != _ea_ant) {
        _ea_ant = (int)g_estado_auto;
        Serial.printf("[AUTO] estado=%d idx=%d proc=%d\n",
                      (int)g_estado_auto, g_processo_atual_idx, (int)g_estado.processo_ativo);
    }

    // =====================================================================
    // TRAVA X15 — exige o X15 (carro na posicao) pra INICIAR o ciclo. So no
    // AUTO_INICIANDO: durante o AUTO_PROCESSO NAO re-le o io2 aqui, senao
    // consome o latch do X11 antes do giro ver (leitura dupla). O io2 do
    // processo e lido 1x/tick no proprio caso AUTO_PROCESSO.
    // =====================================================================
    if (g_estado_auto == AUTO_INICIANDO) {
        modbus_refresh_io2_di();          // leitura FRESCA do X15
        // DEBOUNCE: o X15 e instavel (pisca 0/1). So acusa "carro fora" se ficar em 0
        // CONTINUO por 500ms — um unico pico de 0 nao trava mais o ciclo. Qualquer
        // leitura 1 zera a contagem.
        static uint32_t _t_x15_zero = 0;
        if (!X15) {
            if (_t_x15_zero == 0) _t_x15_zero = agora;
            if (agora - _t_x15_zero >= 500) {
                _t_x15_zero = 0;
                auto_erro("Carro fora da posicao (X15) — ciclo travado");  // auto_erro ja desliga tudo
                return;
            }
        } else {
            _t_x15_zero = 0;              // X15 voltou -> reinicia o debounce
        }
    }

    switch (g_estado_auto) {

        case AUTO_IDLE:
            break;   // aguardando operador escolher modelo + INICIAR

        case AUTO_AGUARDA_CARRO:
            // Y11 (verde) e Y6 (entrada pneumatica) ja foram ligados em auto_iniciar
            if (X14 && !x14_estava_ativo) {
                x14_estava_ativo = true;
                SET_Y13(true);            // liga bomba alta pressao
                backend_evt_car_entered();   // enfileira car-entered
            } else if (!X14 && x14_estava_ativo) {   // else if: evita corrida X14 liga/desliga no mesmo tick
                x14_estava_ativo = false;
                t_x14_desligou = agora;
                g_estado_auto = AUTO_CARRO_ENTRANDO;
            }
            break;

        case AUTO_CARRO_ENTRANDO:
            if (agora - t_x14_desligou >= 1000) {  // 1s apos X14 desligar
                SET_Y13(false);           // desliga bomba alta pressao
                SET_Y6(false);            // desliga solenoide entrada
                g_io2.di = 0;             // invalida cache antes de entrar em AGUARDA_POS (X15 deve vir de leitura fresca)
                g_estado_auto = AUTO_AGUARDA_POS;
            }
            break;

        case AUTO_AGUARDA_POS:
            modbus_refresh_io2_di();      // leitura FRESCA da waveshare2 (nao confiar na cache p/ X15)
            Serial.printf("[DIAG] io2.di=0x%02X X15=%d X10=%d X12=%d HOME_GIRO=%d\n",
                          g_io2.di, (int)X15, (int)X10, (int)X12, (int)HOME_GIRO);
            if (X15) {                    // carro na posicao de lavagem
                SET_Y11(false);           // apaga verde
                SET_Y12(true);            // acende vermelho
                t_estado = agora;
                g_estado_auto = AUTO_INICIANDO;
            }
            break;

        case AUTO_INICIANDO:
            if (agora - t_estado >= 6000) {   // 6s (luz vermelha) — era 4s
                modbus_refresh_io2_di();      // leitura fresca antes de checar o home
                Serial.printf("[DIAG] INICIANDO: HOME_GIRO=%d io2.di=0x%02X\n",
                              (int)HOME_GIRO, g_io2.di);
                if (braco_em_home()) {        // exige braço no HOME (feito manualmente) — sem auto-home
                    g_processo_atual_idx = 0;
                    g_estado_auto = AUTO_PROCESSO;
                } else {
                    auto_erro("Coloque o braco em HOME antes de iniciar");
                }
            }
            break;

        case AUTO_PROCESSO: {
            // Sensores FRESCOS antes de rodar a sub-maquina (senao o giro/carrinho
            // passam pelos sensores rapido demais e a cache lenta (~400ms) perde
            // as transicoes -> giro nao para).
            modbus_refresh_io1_di();
            modbus_refresh_io2_di();

            // Carro saiu da posicao no meio do processo? Se o X15 ficar ausente por
            // 500ms (debounce — o X15 e instavel), ABORTA o programa e faz HOME.
            static uint32_t _t_x15_off = 0;
            if (!X15) {
                if (_t_x15_off == 0) _t_x15_off = agora;
                if (agora - _t_x15_off >= 500) {
                    Serial.println("[AUTO] X15 saiu no processo -> aborta programa + HOME");
                    desligar_tudo();
                    processos_reset();
                    g_estado.processo_ativo = PROC_NENHUM;
                    g_estado.programa_sel   = 0;
                    g_estado_auto           = AUTO_IDLE;
                    _t_x15_off = 0;
                    home_iniciar();          // referencia o braco
                    break;
                }
            } else {
                _t_x15_off = 0;
            }

            executar_processo_tick();     // avanca a sub-maquina
            break;
        }

        case AUTO_CONCLUIDO:
            desligar_tudo();
            SET_Y12(false);               // apaga vermelho
            // Enfileira wash-complete — verifica se veio do app ou do remoto
            {
                String resId = nvs_get_last_res_id();
                if (resId.length() > 0)
                    backend_evt_wash_complete(g_estado.programa_sel, "");
                else
                    backend_evt_wash_complete(g_estado.programa_sel, "remote");
            }
            nvs_inc_prog(g_estado.programa_sel);
            g_estado.processo_ativo = PROC_NENHUM;
            g_estado.programa_sel   = 0;  // limpa modelo — proximo carro deve escolher
            g_estado_auto           = AUTO_IDLE;
            // modo_auto permanece true — operador nao precisa pressionar X3
            break;

        case AUTO_ERRO: {
            // NAO re-chamar desligar_tudo() a cada tick (12 writes Modbus travam a
            // tela num barramento com timeout). Ja paramos tudo em auto_erro();
            // aqui so reforcamos o motor parado de vez em quando.
            static uint32_t t_er = 0;
            if (agora - t_er >= 300) { t_er = agora; vfd_stop(); }
            g_estado.alarme = true;       // msg ja preenchida em auto_erro()
            break;
        }

        case AUTO_PAUSADO: {
            // Reforca a parada periodicamente (garante motor parado mesmo se
            // um comando de stop tiver colidido no barramento).
            static uint32_t t_ps = 0;
            if (agora - t_ps >= 300) { t_ps = agora; vfd_stop(); }
            break;
        }
    }
}

// =======================================================================
// Comandos externos (botoes / X3)
// =======================================================================
void auto_iniciar(uint8_t modelo) {
    if (licenca_bloqueada()) {
        Serial.println("[AUTO] bloqueado por licenca");
        return;
    }
    g_estado.programa_sel   = modelo;
    g_estado.modo_auto      = true;
    g_estado.alarme         = false;
    g_processo_atual_idx    = 0;
    x14_estava_ativo        = false;
    processos_reset();       // zera as sub-maquinas dos processos
    desligar_tudo();
    SET_Y11(true);   // lampada verde
    SET_Y6(true);    // solenoide entrada pneumatica
    g_estado_auto = AUTO_AGUARDA_CARRO;
}

void auto_cancelar() {
    desligar_tudo();
    g_estado_auto           = AUTO_IDLE;
    g_estado.modo_auto      = false;
    g_estado.processo_ativo = PROC_NENHUM;
    g_estado.alarme         = false;
}

// Limpa o alarme/erro e volta ao ocioso (sem desligar o modo auto). So faz algo se
// houver alarme ou estiver em AUTO_ERRO — pra o botao nao abortar um ciclo normal.
void auto_limpar_erro() {
    if (!g_estado.alarme && g_estado_auto != AUTO_ERRO) return;
    desligar_tudo();
    g_estado.alarme     = false;
    g_estado.msg_alarme = "";
    g_estado.processo_ativo = PROC_NENHUM;
    g_estado_auto       = AUTO_IDLE;
    Serial.println("[AUTO] erro limpo -> IDLE");
}

static uint8_t  _pausa_mov  = 0;   // movimento que estava rodando ao pausar
static uint16_t _pausa_freq = 0;
static uint32_t _pausa_ini  = 0;   // millis() do instante em que pausou

void auto_pausar() {
    _pausa_mov  = g_vfd_mov;        // guarda o que estava rodando
    _pausa_freq = g_vfd_mov_freq;
    _pausa_ini  = millis();         // marca o inicio da pausa (p/ deslocar os cronometros ao retomar)
    vfd_stop();                     // para o motor JA
    g_estado_auto     = AUTO_PAUSADO;
    g_estado.em_pausa = true;
    Serial.println("[AUTO] PAUSADO (motor parado)");
}

void auto_retomar() {
    // desloca TODOS os cronometros dos processos pelo tempo que ficou pausado, pra
    // o giro/carrinho continuarem como se o tempo nao tivesse passado.
    uint32_t delta = millis() - _pausa_ini;
    processos_shift_timers(delta);
    if (_pausa_mov == 1)      vfd_run_fwd(_pausa_freq);   // re-emite o movimento
    else if (_pausa_mov == 2) vfd_run_rev(_pausa_freq);
    g_estado_auto     = AUTO_PROCESSO;
    g_estado.em_pausa = false;
    Serial.printf("[AUTO] RETOMADO (pausa=%ums deslocada)\n", (unsigned)delta);
}

// =======================================================================
// RECUPERACAO NO BOOT (retorno de energia) — auto-home quando for seguro.
//   Nao entra se o braco ja estiver no zero (X16+X17 e carrinho no X12).
//   Fase 1 (X15 com carro): VERMELHO piscando RAPIDO (2 Hz) = "retire o veiculo".
//   Fase 2 (X15 livre): inicia o HOME sozinho; VERDE/VERMELHO alternando (0,5 Hz)
//                       ate concluir. Se um carro reentrar (X15), aborta -> Fase 1.
// =======================================================================
enum { REC_AVALIAR = 0, REC_ATIVA, REC_CONCLUIDA };
static uint8_t g_rec_estado = REC_AVALIAR;
static bool    g_rec_home_iniciado = false;

bool recuperacao_ativa() { return g_rec_estado == REC_ATIVA; }

static void rec_lamp_fase1() {   // vermelho piscando 0,5 Hz (1000ms on/off) — 4x mais lento; verde apagado
    static uint32_t t = 0; static bool on = false;
    SET_Y11(false);
    if (millis() - t >= 1000) { t = millis(); on = !on; SET_Y12(on); }
}
static void rec_lamp_fase2() {   // verde/vermelho alternando 0,125 Hz (4000ms cada) — 4x mais lento
    static uint32_t t = 0; static bool verde = true;
    if (millis() - t >= 4000) { t = millis(); verde = !verde; SET_Y11(verde); SET_Y12(!verde); }
}

void recuperacao_tick() {
    // ---- avaliacao inicial: so decide quando a comunicacao estiver de pe ----
    if (g_rec_estado == REC_AVALIAR) {
        if (comm_perdida()) return;                  // espera a waveshare responder
        modbus_refresh_io2_di();                     // leitura fresca dos sensores
        // "no zero" so pode olhar sensores de NIVEL: X16 (HOME) e X12 (carrinho
        // recuado). NAO usar X17 aqui — ele e PULSO e fica 0 com o braco parado.
        bool no_zero = HOME_GIRO && X12;
        if (no_zero) { g_rec_estado = REC_CONCLUIDA; return; }   // ja referenciado
        desligar_tudo();          // zera saidas presas de um ciclo interrompido (Y13, solenoides, etc.)
        g_rec_estado = REC_ATIVA; g_rec_home_iniciado = false;
        Serial.println("[REC] boot fora do zero -> recuperacao ativa (saidas zeradas)");
        return;
    }
    if (g_rec_estado != REC_ATIVA) return;

    // ---- recuperacao ativa: decide a fase pelo X15 ----
    if (!home_rodando()) modbus_refresh_io2_di();    // fora do home, leitura fresca aqui
    bool carro = X15;

    if (carro) {
        // FASE 1 — carro na posicao: se um home estava em andamento, aborta.
        if (home_rodando() || g_rec_home_iniciado) {
            home_reset(); g_rec_home_iniciado = false;
            Serial.println("[REC] carro reentrou -> aborta home (Fase 1)");
        }
        rec_lamp_fase1();
        return;
    }

    // FASE 2 — X15 livre: inicia o home (uma vez) e acompanha ate concluir.
    if (!g_rec_home_iniciado) {
        home_iniciar(); g_rec_home_iniciado = true;
        Serial.println("[REC] X15 livre -> inicia HOME");
    }
    rec_lamp_fase2();

    int he = home_estado();
    if (he == HOME_OK) {
        SET_Y11(false); SET_Y12(false);
        g_rec_estado = REC_CONCLUIDA;
        Serial.println("[REC] HOME concluido -> recuperacao encerrada");
    } else if (he == HOME_FALHA) {
        g_rec_home_iniciado = false;                 // retenta no proximo tick (se X15 livre)
        Serial.println("[REC] HOME falhou -> vai retentar");
    }
}

// Sub-maquinas dos processos (usa os macros/helpers acima e g_estado_auto)
#include "processos.h"
