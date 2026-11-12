#pragma once
#include "tipos.h"
#include "comm_espnow.h"
#include "nvs_manager.h"

// --- App/backend: forward declarations (definicoes vem depois, no display.ino,
//     em backend_client.h/licenca.h — evita dependencia circular com g_estado_auto) ---
void backend_evt_car_entered();
void backend_evt_wash_complete(uint8_t programId, const String& source);
void backend_evt_fault(const char* errorCode);
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

// Ciclo armado por PULSO do painel/controle remoto (X1/X2/X5/X6), nao pelo app nem pelo display: se ninguem
// entrar com o carro em PAINEL_ARMADO_MAX_MS, desarma e apaga o verde. (2026-10-29: pulsos isolados no X1, sem
// ninguem apertar, armaram o ciclo e o verde ficou aceso 5 min — o AGUARDA_CARRO nao tinha limite de tempo.)
#define PAINEL_ARMADO_MAX_MS 180000UL    // 3 min
bool            g_armado_painel = false;
static uint32_t t_armado_painel = 0;

// Timestamps / flags de controle do topo
static uint32_t t_estado         = 0;
static uint32_t t_x14_desligou   = 0;
static bool     x14_estava_ativo = false;
// Prazo nos estados CARRO_ENTRANDO / AGUARDA_POS (2026-11-01): ciclo armado SO por pulso do painel (sem reserva do app) que, depois de o carro
// passar pelo X14, nao chega na posicao (X15) em PAINEL_ARMADO_MAX_MS (3 min) e desarmado. (Em 30/10 um ciclo assim ficou 16 min no AGUARDA_POS
// com o verde aceso e bloqueou uma reserva paga.) Ciclos do app e do display NAO entram nesta regra.
#define X10_ESPERA_MAX_MS 60000UL   // sem X10 por 60 s antes de iniciar o processo -> erro
static inline bool painel_prazo_vencido(uint32_t agora) { return g_armado_painel && !nuvem_res_ativa() && (agora - t_x14_desligou) >= PAINEL_ARMADO_MAX_MS; }
// CONTINUAR apos pausa: religa bombas/espumas/secador e ESPERA 2 s (restabelece a pressao) antes de
// retomar o movimento. Espera sem bloquear o loop; PARAR/CANCELAR a interrompem (teste_parar zera).
#define RETOMAR_PRESSAO_MS 2000
static bool     _retomando = false;
static uint32_t _ret_t0    = 0;
bool            g_pausa_x10 = false;   // PAUSADO por falta do X10 no meio de uma etapa (ver x10_pausa_tick)
bool            g_braco_lado2 = false;          // X7 = braco na posicao 2 (contraprova; ver braco_lado2_tick)
bool            g_delta_pausa_pedida = false;  // uma ordem ao Delta se perdeu (delta_falhou em processos.h): delta_pausa_tick PAUSA o ciclo
bool            g_pausa_delta = false;          // PAUSADO por falta de resposta do Delta (ver delta_pausa_tick)
static bool     g_delta_liberando = false;      // true so enquanto delta_pausa_tick chama auto_retomar (o resto fica barrado enquanto o Delta esta fora)
bool            g_x10_ausente_ok = false;  // avanco confirmou a saida do X10: a ausencia e esperada ate o retorno achar o X10 (ou o X12)
bool            g_x10_segura = false;  // sem X10 antes de iniciar a etapa: a etapa NAO comeca (G3)
static void auto_retomar_efetivo();

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
#define SET_Y5(v)  io1_set_do(5, (v) && g_bomba_ciclo)   // compressor secagem (so com a bomba ON)
#define SET_Y6(v)  io1_set_do(6, v)   // solenoide entrada pneumatica
#define SET_Y7(v)  io1_set_do(7, (v) && g_bomba_ciclo)   // bomba espuma (cima) (so com a bomba ON)
#define SET_Y11(v) io1_set_do(8, v)   // lampada verde
//   Waveshare #2 (io2_set_do canal 1-8)
#define SET_Y10(v) io2_set_do(1, v)   // bomba espuma (baixo)
#define SET_Y12(v) io2_set_do(2, v)   // luz vermelha
#define SET_Y13(v) io2_set_do(Y13_CANAL_W2, (v) && g_bomba_ciclo)   // bomba alta pressao (so com a bomba ON); canal da W2 em protocolo_teste.h
#define SET_Y14(v) io2_set_do(4, v)   // contator deslocamento (trava Y4<->Y14)
//   (DO5 = Y15 BLOQUEADO no firmware da waveshare2 — nao usar)
#define SET_Y0(v)  io2_set_do(6, v)   // Y0 (DO6 waveshare2) — aciona JUNTO com a Cor Magica
#define SET_LUZES(v) io2_set_do(7, v)       // DO7 waveshare2 — LUZES DA MAQUINA (ver luzes_tick)
#define SET_ASPIRADOR(v) io2_set_do(8, v)   // DO8 waveshare2 — aspirador de po (liberado pelo app)

// -----------------------------------------------------------------------
// PROJETO DE TESTES (etapa 0) — Alta Pressao em bancada, sem carro.
//   g_teste_bomba : Y13 + SAJ habilitados (OFF = "a seco"). PADRAO AO LIGAR = ON.
//   g_teste_seco  : true = carrinho por TEMPO (X10 simulado, sem carro). PADRAO AO LIGAR = false (COM X10, carro real).
//   Padrao de producao decidido pelo Giovani (2026-10-23): depois de queda de energia ou regravacao a maquina volta pronta para lavar
//   com carro (COM X10 + BOMBA ON). Em SEM X10 o braco bate no carro. Para teste a seco, o tecnico escolhe OFF / SEM X10 na tela TECNICO.
// -----------------------------------------------------------------------
bool     g_teste_bomba   = true;
bool     g_bomba_ciclo   = false;   // g_teste_bomba TRAVADO no inicio do ciclo (nao muda no meio dele)
bool     g_teste_seco    = false;
bool     g_teste_rodando = false;
uint8_t  g_ev_seq = 0, g_ev_tipo = 0, g_ev_modelo = 0;   // ultimo evento de fim de ciclo (vai no status pro display)
uint8_t  g_tipo_prox     = 0;       // tipo do proximo ciclo: 0 presencial, 1 aplicativo, 2 socio, 3 bonus — escolhido na tela
uint8_t  g_tipo_ciclo    = 0;       // g_tipo_prox TRAVADO no inicio do ciclo
bool     g_ciclo_auto    = false;   // ciclo AUTOMATICO iniciado pela tela (conta nos ciclos ok/erro)
uint16_t g_teste_ok      = 0;
uint16_t g_teste_erro    = 0;

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

// ---- CAIXA-PRETA: ultimos 5 erros na NVS (namespace "erro", anel). Grava so quando ha erro (raro). A W1 nao tem relogio: up_s = segundos
// desde o boot (o horario real do erro esta no evento do backend). Lido no boot por erro_imprimir_boot().
struct ErroReg {
    uint32_t n, up_s;                  // n = contador total de erros; up_s = uptime ao errar
    char     msg[64];
    uint8_t  estado, proc, idx, modelo, rst;
    uint8_t  sens;                     // b0 X14 b1 X15 b2 X10 b3 X12 b4 X16 b6 X0
    uint8_t  vfd_mov; uint16_t vfd_freq;
    uint32_t rs_ok, rs_zero, rs_curta, rs_crc;
    uint32_t tx_ok, tx_fail, w2_gap_ms; uint8_t tx_travado;
};
static void erro_registrar(const char* msg) {
    Preferences p; if (!p.begin("erro", false)) return;
    ErroReg r = {};
    r.n = p.getUInt("n", 0) + 1; r.up_s = millis() / 1000;
    strncpy(r.msg, msg ? msg : "", sizeof(r.msg) - 1);
    r.estado = (uint8_t)g_estado_auto; r.proc = (uint8_t)g_estado.processo_ativo;
    r.idx = g_processo_atual_idx; r.modelo = g_estado.programa_sel; r.rst = g_rst_motivo;
    r.sens = (X14 ? 1 : 0) | (X15 ? 2 : 0) | (X10 ? 4 : 0) | (X12 ? 8 : 0) | (HOME_GIRO ? 16 : 0) | (X0 ? 64 : 0);
    r.vfd_mov = g_vfd_mov; r.vfd_freq = g_vfd_mov_freq;
    r.rs_ok = g_mb_ok; r.rs_zero = g_mb_zero; r.rs_curta = g_mb_curta; r.rs_crc = g_mb_crc;
    r.tx_ok = g_tx_ok; r.tx_fail = g_tx_fail; r.w2_gap_ms = hb2_idade_ms(); r.tx_travado = g_tx_travado ? 1 : 0;
    char k[8]; snprintf(k, sizeof(k), "e%u", (unsigned)(r.n % 5));
    p.putBytes(k, &r, sizeof(r)); p.putUInt("n", r.n); p.end();
}
// Imprime no serial, a cada boot, os ultimos erros guardados + os contadores de silencio da W2 e de travamento do envio.
void erro_imprimir_boot() {
    Preferences p; if (!p.begin("erro", true)) return;
    uint32_t n = p.getUInt("n", 0);
    DBG_PRINTF("[BOOT] motivo do reset=%d | erros guardados: %lu\n", (int)g_rst_motivo, (unsigned long)n);
    for (uint32_t i = 0; i < 5 && i < n; i++) {
        uint32_t id = n - i; char k[8]; snprintf(k, sizeof(k), "e%u", (unsigned)(id % 5));
        ErroReg r = {}; if (p.getBytesLength(k) != sizeof(r)) continue; p.getBytes(k, &r, sizeof(r));
        DBG_PRINTF("[BOOT] erro #%lu up=%lus \"%s\" estado=%u proc=%u idx=%u modelo=%u sens=0x%02X vfd=%u@%u rs485 ok=%lu zero=%lu crc=%lu tx_ok=%lu w2_gap=%lums txtrav=%u\n",
                   (unsigned long)r.n, (unsigned long)r.up_s, r.msg, r.estado, r.proc, r.idx, r.modelo, r.sens, r.vfd_mov, r.vfd_freq,
                   (unsigned long)r.rs_ok, (unsigned long)r.rs_zero, (unsigned long)r.rs_crc, (unsigned long)r.tx_ok, (unsigned long)r.w2_gap_ms, r.tx_travado);
    }
    p.end();
    Preferences w; if (w.begin("w2", true))  { DBG_PRINTF("[BOOT] silencios da W2: n=%lu ultimo=%lums maior=%lums\n", (unsigned long)w.getUInt("n", 0), (unsigned long)w.getUInt("ult", 0), (unsigned long)w.getUInt("max", 0)); w.end(); }
    Preferences d; if (d.begin("delta", true)) { DBG_PRINTF("[BOOT] Delta mudo (>10 s sem resposta com a maquina parada): n=%lu\n", (unsigned long)d.getUInt("n", 0)); d.end(); }
    Preferences m; if (m.begin("mem", true))   { DBG_PRINTF("[BOOT] memoria baixa (<40 KB): n=%lu minimo=%lu\n", (unsigned long)m.getUInt("n", 0), (unsigned long)m.getUInt("min", 0)); m.end(); }
    Preferences t; if (t.begin("tx", true))  { DBG_PRINTF("[BOOT] travamentos do envio de radio: n=%lu\n", (unsigned long)t.getUInt("n", 0)); t.end(); }
}

// Sinaliza erro do ciclo: guarda a mensagem (literal, vida estatica) e para tudo
static void auto_erro(const char* msg) {
    erro_registrar(msg);             // caixa-preta (NVS), antes de qualquer mudanca de estado
    desligar_tudo();                 // para tudo UMA vez (aqui), pra o AUTO_ERRO
                                     // nao precisar spammar desligar_tudo() todo
                                     // tick (12 writes Modbus) e travar a tela
    g_estado.msg_alarme = msg;
    g_estado.alarme     = true;
    g_estado_auto       = AUTO_ERRO;
    if (g_teste_rodando || g_ciclo_auto) { g_teste_erro++; g_teste_rodando = false; g_ciclo_auto = false; g_ev_tipo = 2; g_ev_modelo = g_estado.programa_sel; g_ev_seq++; }
    char ec[64];                     // o backend passa a saber em que processo/etapa/modelo parou (errorCode ate 64)
    snprintf(ec, sizeof(ec), "%.42s|p%u i%u m%u", msg, (unsigned)g_estado.processo_ativo, (unsigned)g_processo_atual_idx, (unsigned)g_estado.programa_sel);
    backend_evt_fault(ec);
    DBG_PRINTF("[AUTO] ERRO: %s\n", msg);
}

// ---- W2 PERDIDA: pausa segura e retoma sozinho (2026-10-31) ----
// A W2 le os sensores X10..X17 e comanda as saidas de processo. Se ela some, a W1 so tinha o ULTIMO valor (sensores congelados)
// e seguia o ciclo "cega" (visto em 29/10 e 30/10: silencios de 160 a 208 s). Agora, no processo, sem batida da W2 por
// W2_STALE_PAUSA_MS a W1 entra em PAUSADO (mesma rotina do PAUSAR do operador: para o Delta e desliga bombas/solenoides),
// mostra "PAUSADO por falha W2" e, quando a W2 volta e fica estavel por W2_VOLTA_ESTAVEL_MS, CONTINUA de onde parou
// (religa as saidas, espera a pressao 2 s e retoma o movimento, deslocando os cronometros). Nao faz HOME nem gira sozinha alem disso.
// Antes do processo (carro entrando / aguardando posicao / iniciando) so SEGURA: nao avanca nem acusa X15 com dado velho.
#define W2_STALE_PAUSA_MS    1500UL      // sem batida da W2 por isso = perdida (normal: ate ~255 ms)
#define W2_VOLTA_ESTAVEL_MS  3000UL      // W2 de volta e estavel por isso -> retoma
#define W2_PAUSA_MAX_MS    600000UL      // 10 min pausado sem a W2 -> erro (falha a reserva e estorna)
bool            g_pausa_w2 = false;
static uint32_t t_w2_pausa = 0, t_w2_volta = 0, t_w2_sil_ini = 0;
static inline bool w2_stale() { return (hb2_idade_ms()) > W2_STALE_PAUSA_MS; }
static inline bool radio_ruim() { return w2_stale() || g_tx_travado; }   // W2 muda OU o envio da W1 travado: mesma pausa segura

// ---- VIGIA DO ENVIO POR RADIO (2026-10-31) ----
// Se a W1 faz envios e o radio nao confirma nenhum por TX_TRAVADO_MS, o envio travou (caso das 17:04: a W1 recebia mas nao transmitia;
// o display acusava "sem contato" e o Y14 nao chegava na W2). Acoes, em ordem, SEM perder a lavagem:
//  1) reinicializa so o ESP-NOW (sem reiniciar a placa), de 5 em 5 s;
//  2) durante o PROCESSO, g_tx_travado entra no mesmo caminho da W2 perdida: PAUSADO (retoma sozinho quando o envio normaliza);
//  3) so se estiver PARADA (sem ciclo/HOME/manual) e 3 reinicializacoes nao resolverem: reinicia a W1 (a recuperacao de boot refaz o HOME).
#define TX_TRAVADO_MS     3000UL
#define TX_REINIT_INT_MS  5000UL
static uint8_t  t_tx_reinit_n = 0;
static uint32_t t_tx_ult_reinit = 0, t_tx_primeiro = 0;
static void tx_nvs_conta() {                      // NVS "tx": quantas vezes o envio travou (raro)
    Preferences p; if (!p.begin("tx", false)) return;
    p.putUInt("n", p.getUInt("n", 0) + 1); p.end();
}
static void tx_watchdog_tick(uint32_t agora) {
    bool travado = (g_tx_pend >= 8) && (agora - g_tx_cb_ms) > TX_TRAVADO_MS;
    if (travado && !g_tx_travado) {
        g_tx_travado = true; t_tx_primeiro = agora; t_tx_reinit_n = 0; t_tx_ult_reinit = 0;
        DBG_PRINTF("[TX] TRAVADO (pend=%lu sem confirmacao ha %lu ms) estado=%d\n", (unsigned long)g_tx_pend, (unsigned long)(agora - g_tx_cb_ms), (int)g_estado_auto);
        tx_nvs_conta();
    } else if (!travado && g_tx_travado) {
        g_tx_travado = false;
        DBG_PRINTF("[TX] normalizado apos ~%lu ms (%u reinicializacao(oes))\n", (unsigned long)(agora - t_tx_primeiro), (unsigned)t_tx_reinit_n);
    }
    if (!g_tx_travado) return;
    if (t_tx_ult_reinit == 0 || (agora - t_tx_ult_reinit) >= TX_REINIT_INT_MS) {
        t_tx_ult_reinit = agora; t_tx_reinit_n++;
        DBG_PRINTF("[TX] reinicializando o ESP-NOW (tentativa %u)\n", (unsigned)t_tx_reinit_n);
        espnow_reiniciar();
    }
    bool parada = (g_estado_auto == AUTO_IDLE || g_estado_auto == AUTO_CONCLUIDO || g_estado_auto == AUTO_ERRO) &&
                  !home_rodando() && !g_teste_rodando && !g_manual_ativo;
    if (t_tx_reinit_n >= 3 && parada) {
        DBG_PRINTLN("[TX] reinicializacoes nao resolveram e a maquina esta parada -> reiniciando a W1");
        rst_sw_motivo(2);   // RST_SW_TX
        Serial.flush(); delay(100); ESP.restart();
    }
}
static void w2_sil_salvar(uint32_t dur_ms) {      // so no FIM de um silencio (raro): NVS "w2" n/ult/max, para ler depois
    Preferences p; if (!p.begin("w2", false)) return;
    p.putUInt("n", p.getUInt("n", 0) + 1); p.putUInt("ult", dur_ms);
    if (dur_ms > p.getUInt("max", 0)) p.putUInt("max", dur_ms);
    p.end();
}
static void w2_pausa_tick(uint32_t agora) {
    static bool em_sil = false;
    bool w2s = w2_stale();                  // silencio da W2 (so ela) — diagnostico/NVS "w2"
    bool stale = w2s || g_tx_travado;       // motivo de PAUSAR: W2 muda OU envio de radio da W1 travado
    if (w2s && !em_sil) {
        em_sil = true; t_w2_sil_ini = agora - W2_STALE_PAUSA_MS;
        DBG_PRINTF("[W2] SILENCIO inicio (sem batida ha %lu ms) estado=%d\n", (unsigned long)W2_STALE_PAUSA_MS, (int)g_estado_auto);
    } else if (!w2s && em_sil) {
        em_sil = false; uint32_t dur = agora - t_w2_sil_ini;
        DBG_PRINTF("[W2] SILENCIO fim: durou ~%lu ms\n", (unsigned long)dur);
        w2_sil_salvar(dur);
    }
    if (g_estado_auto == AUTO_PROCESSO && stale) {
        auto_pausar();                                   // para o Delta, desliga bombas/solenoides, guarda o movimento e o instante
        g_pausa_w2 = true; t_w2_pausa = agora; t_w2_volta = 0;
        DBG_PRINTLN("[W2] perdida no processo -> PAUSADO por falha W2 (retoma sozinho quando a W2 voltar)");
    } else if (g_estado_auto == AUTO_PAUSADO && g_pausa_w2) {
        if (stale) {
            t_w2_volta = 0;
            if (agora - t_w2_pausa > W2_PAUSA_MAX_MS) { g_pausa_w2 = false; auto_erro("W2 sem contato: pausa expirou (10 min)"); }
        } else if (!_retomando) {
            if (!t_w2_volta) t_w2_volta = agora;
            else if (agora - t_w2_volta >= W2_VOLTA_ESTAVEL_MS) {
                DBG_PRINTLN("[W2] voltou e estavel -> CONTINUANDO de onde parou");
                g_pausa_w2 = false; t_w2_volta = 0;
                auto_retomar();
            }
        }
    } else if (g_estado_auto != AUTO_PAUSADO) {
        g_pausa_w2 = false;                              // saiu da pausa por outro caminho (cancelar, erro): zera a marca
    }
}

// ---- DURACAO MAXIMA DO CICLO (2026-11-01) ----
// Rede de seguranca contra um ciclo que "nunca acaba" (sub-maquina presa num passo sem sensor/timeout proprio). Conta so o tempo em
// AUTO_PROCESSO (pausa nao conta). Estourou: para tudo, sem HOME automatico (mesma regra do X15 perdido) e acusa erro.
#define CICLO_MAX_MS 1800000UL   // 30 min em PROCESSO (uma lavagem normal leva bem menos)
// ---- MONITOR DE MEMORIA (2026-11-01) ----
// Heap livre a cada 10 s. Abaixo de MEM_AVISO_B: registra na NVS "mem" (min) e no serial. Abaixo de MEM_CRITICO_B com a maquina
// PARADA: reinicia a W1 (a recuperacao de boot refaz o HOME). Nunca reinicia no meio de um ciclo.
#define MEM_AVISO_B   40000UL
#define MEM_CRITICO_B 20000UL
static void mem_tick(uint32_t agora) {
    static uint32_t t = 0, t_log = 0; static bool avisou = false;
    if (agora - t < 10000) return;
    t = agora;
    uint32_t livre = ESP.getFreeHeap(), minimo = ESP.getMinFreeHeap();
    if (agora - t_log >= 600000UL) { t_log = agora; DBG_PRINTF("[MEM] livre=%lu minimo=%lu\n", (unsigned long)livre, (unsigned long)minimo); }
    if (livre < MEM_AVISO_B && !avisou) {
        avisou = true;
        DBG_PRINTF("[MEM] BAIXA: livre=%lu minimo=%lu estado=%d\n", (unsigned long)livre, (unsigned long)minimo, (int)g_estado_auto);
        Preferences p; if (p.begin("mem", false)) { p.putUInt("n", p.getUInt("n", 0) + 1); p.putUInt("min", minimo); p.end(); }
    } else if (livre >= MEM_AVISO_B + 5000) avisou = false;
    bool parada = (g_estado_auto == AUTO_IDLE || g_estado_auto == AUTO_CONCLUIDO || g_estado_auto == AUTO_ERRO) &&
                  !home_rodando() && !g_teste_rodando && !g_manual_ativo;
    if (livre < MEM_CRITICO_B && parada) {
        DBG_PRINTF("[MEM] CRITICA (livre=%lu) com a maquina parada -> reiniciando a W1\n", (unsigned long)livre);
        rst_sw_motivo(1);   // RST_SW_MEM
        Serial.flush(); delay(100); ESP.restart();
    }
}

// Forward: implementadas em processos.h (incluido no fim deste arquivo)
void executar_processo_tick();
void processos_reset();
void processos_shift_timers(uint32_t delta);   // desloca cronometros (usado ao retomar da pausa)
void x10_pausa_tick(uint32_t agora);
void delta_pausa_tick(uint32_t agora);
void braco_lado2_tick(uint32_t agora);
extern bool g_giro_rewind;
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
        DBG_PRINTF("[AUTO] estado=%d idx=%d proc=%d\n",
                      (int)g_estado_auto, g_processo_atual_idx, (int)g_estado.processo_ativo);
    }

    mem_tick(agora);                     // heap baixo: avisa; critico e parada: reinicia
    {   // duracao maxima do ciclo (so conta AUTO_PROCESSO; pausa nao conta)
        static uint32_t t_proc_ult = 0, proc_ms = 0;
        if (g_estado_auto == AUTO_PROCESSO) {
            if (t_proc_ult) proc_ms += agora - t_proc_ult;
            t_proc_ult = agora;
            if (proc_ms >= CICLO_MAX_MS) {
                DBG_PRINTF("[AUTO] ciclo passou de %lu min em PROCESSO -> PARA TUDO\n", (unsigned long)(CICLO_MAX_MS / 60000UL));
                processos_reset();
                g_estado.processo_ativo = PROC_NENHUM;
                proc_ms = 0; t_proc_ult = 0;
                auto_erro("Ciclo passou do tempo maximo (30 min): confira a maquina e faca o HOME");
                return;
            }
        } else {
            t_proc_ult = 0;
            if (g_estado_auto != AUTO_PAUSADO) proc_ms = 0;
        }
    }
    tx_watchdog_tick(agora);             // envio de radio travado -> reinicializa o ESP-NOW (e so pausa/reinicia se preciso)
    w2_pausa_tick(agora);                // W2 perdida (ou envio travado) no processo -> PAUSADO (retoma sozinho)
    x10_pausa_tick(agora);               // X10 perdido durante o giro -> PAUSADO (retoma sozinho, rebobina o giro 1->2)
    delta_pausa_tick(agora);             // ordem ao Delta perdida -> PAUSADO (retoma sozinho quando o Delta responder)
    braco_lado2_tick(agora);             // X7 filtrado (contraprova de que o braco esta no lado 2)
    if (radio_ruim() && (g_estado_auto == AUTO_CARRO_ENTRANDO || g_estado_auto == AUTO_AGUARDA_POS || g_estado_auto == AUTO_INICIANDO))
        return;                          // sem dado confiavel da W2 antes do processo: segura (nao avanca nem acusa X15 com valor velho)

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
        // X10 (carro sob a mesa) OBRIGATORIO no ciclo com carro real. Sem X10 o ciclo ESPERA (como numa pausa): a luz vermelha NAO conta, nada se
        // move e nenhuma bomba liga; quando o X10 aparece, os 6 s recomecam e o ciclo segue. Se o X10 nao vier em X10_ESPERA_MAX_MS: ERRO.
        // No SECO (teste tecnico, X10 simulado) nao se aplica. (2026-11-02: sem carro, com o X15 acionado a mao, o processo rodou ate travar.)
        static uint32_t _t_x10_ini = 0;               // instante em que comecou a esperar o X10 (0 = nao esta esperando)
        static uint32_t _t_x10_msg = 0;
        if (g_teste_seco || X10) {
            if (_t_x10_ini) { DBG_PRINTLN("[AUTO] X10 voltou: o ciclo segue (6 s da luz vermelha recomecam)"); t_estado = agora; }
            _t_x10_ini = 0;
        } else {
            if (!_t_x10_ini) { _t_x10_ini = agora ? agora : 1; DBG_PRINTLN("[AUTO] sem X10 (carro sob a mesa): aguardando antes de iniciar o processo"); }
            t_estado = agora;                         // segura a contagem dos 6 s
            if ((int32_t)(agora - _t_x10_msg) >= 1000) { _t_x10_msg = agora; g_manual_msg = "Aguardando X10 (carro sob a mesa)"; g_manual_msg_ms = millis(); }
            if ((int32_t)(agora - _t_x10_ini) >= (int32_t)X10_ESPERA_MAX_MS) {
                _t_x10_ini = 0;
                auto_erro("Sem carro sob a mesa (X10) apos 60 s - ciclo nao iniciado");
                return;
            }
        }
    }

    switch (g_estado_auto) {

        case AUTO_IDLE:
            break;   // aguardando operador escolher modelo + INICIAR

        case AUTO_AGUARDA_CARRO:
            // Y11 (verde) e Y6 (entrada pneumatica) ja foram ligados em auto_iniciar
            if (g_armado_painel && !nuvem_res_ativa() && !x14_estava_ativo && !X14 && agora - t_armado_painel >= PAINEL_ARMADO_MAX_MS) {
                DBG_PRINTLN("[AUTO] armado pelo painel sem carro ha 3 min -> desarma (apaga o verde)");
                g_armado_painel = false;
                teste_parar();
                break;
            }
            if (X14 && !x14_estava_ativo) {
                x14_estava_ativo = true;
                if (g_bomba_ciclo) {      // projeto de testes: so liga a bomba se habilitada
                    SET_Y13(true);            // liga bomba alta pressao
                    saj_set_freq(30.0f);      // pedido do operador: 30Hz nesse pulso de entrada (antes nao mandava frequencia nenhuma, ficava com o valor que o SAJ tinha de antes)
                }
                backend_evt_car_entered();   // enfileira car-entered
            } else if (!X14 && x14_estava_ativo) {   // else if: evita corrida X14 liga/desliga no mesmo tick
                x14_estava_ativo = false;
                t_x14_desligou = agora;
                g_estado_auto = AUTO_CARRO_ENTRANDO;
            }
            break;

        case AUTO_CARRO_ENTRANDO:
            if (painel_prazo_vencido(agora)) {     // ciclo armado SO por painel: 3 min sem o carro chegar na posicao
                DBG_PRINTLN("[AUTO] armado pelo painel: carro nao chegou na posicao em 3 min -> desarma (apaga o verde)");
                g_armado_painel = false; teste_parar(); break;
            }
            if (agora - t_x14_desligou >= 1000) {  // 1s apos X14 desligar
                SET_Y13(false);           // desliga bomba alta pressao
                SET_Y6(false);            // desliga solenoide entrada
                g_io2.di = 0;             // invalida cache antes de entrar em AGUARDA_POS (X15 deve vir de leitura fresca)
                g_estado_auto = AUTO_AGUARDA_POS;
            }
            break;

        case AUTO_AGUARDA_POS: {
            if (painel_prazo_vencido(agora)) {     // ciclo armado SO por painel: 3 min sem o carro chegar na posicao (caso de 30/10: 16 min preso)
                DBG_PRINTLN("[AUTO] armado pelo painel: carro nao chegou na posicao em 3 min -> desarma (apaga o verde)");
                g_armado_painel = false; teste_parar(); break;
            }
            modbus_refresh_io2_di();      // leitura FRESCA da waveshare2 (nao confiar na cache p/ X15)
            DBG_PRINTF("[DIAG] io2.di=0x%02X X15=%d X10=%d X12=%d HOME_GIRO=%d\n",
                          g_io2.di, (int)X15, (int)X10, (int)X12, (int)HOME_GIRO);
            // DEBOUNCE: exige X15=1 CONTINUO por 300ms antes de aceitar a posicao —
            // sem isso, um unico tick de ruido eletrico (ex.: comutacao do X14
            // desligando, bit adjacente no mesmo byte da waveshare2) e suficiente
            // pra avancar o ciclo com o carro ainda fora da posicao, e so da erro
            // bem depois, no debounce do AUTO_INICIANDO (achado em teste real).
            static uint32_t _t_x15_um = 0;
            if (X15) {
                if (_t_x15_um == 0) _t_x15_um = agora;
                if (agora - _t_x15_um >= 300) {
                    _t_x15_um = 0;
                    SET_Y11(false);           // apaga verde
                    SET_Y12(true);            // acende vermelho
                    t_estado = agora;
                    g_estado_auto = AUTO_INICIANDO;
                }
            } else {
                _t_x15_um = 0;             // X15 caiu -> reinicia o debounce
            }
            break;
        }

        case AUTO_INICIANDO:
            if (agora - t_estado >= 6000) {   // 6s (luz vermelha) — era 4s
                modbus_refresh_io2_di();      // leitura fresca antes de checar o home
                DBG_PRINTF("[DIAG] INICIANDO: HOME_GIRO=%d io2.di=0x%02X\n",
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
            // 3s (debounce — o X15 e instavel; era 1s, subiu a 3s em 2026-10-29 apos abortar
            // uma lavagem real logo ao fim do giro), PARA TUDO (sem HOME automatico).
            // NAO vale durante o giro ativo (g_giro_ativo): o carrinho fisicamente
            // nao se move nessa hora (Y14 nem esta acionado), entao perder o X15
            // ali so pode ser ruido na leitura — nao o carro saindo de verdade.
            // Achado em campo: o surto de EMI da reversao do giro corrompia o X15
            // por um instante, abortava o programa, chamava home_iniciar(), e o
            // PROPRIO watchdog do HOME (X0 sem pulsar, pois o carrinho nao estava
            // realmente se movendo) disparava "HOME FALHOU: carro travado (X0)" —
            // mensagem que parecia vir do giro, mas era do deslocamento do HOME,
            // disparado por engano.
            static uint32_t _t_x15_off = 0;
            if (!g_teste_rodando && !X15 && !g_giro_ativo) {
                if (_t_x15_off == 0) _t_x15_off = agora;
                if (agora - _t_x15_off >= 3000) {
                    // 2026-10-25: NAO faz mais HOME automatico. O X15 e instavel; num ciclo real o HOME girou o braco com o
                    // carro AINDA dentro e bateu nele. Agora so PARA TUDO e fica em erro (lampada vermelha piscando): o lavador
                    // confere o carro e aciona o HOME manualmente. (Comportamento antigo: desligar_tudo + processos_reset +
                    // programa_sel=0 + AUTO_IDLE + home_iniciar().)
                    DBG_PRINTLN("[AUTO] X15 saiu no processo -> PARA TUDO (sem HOME automatico)");
                    processos_reset();
                    g_estado.processo_ativo = PROC_NENHUM;
                    _t_x15_off = 0;
                    auto_erro("X15 perdido no processo: confira o carro e faca o HOME");
                    break;
                }
            } else {
                _t_x15_off = 0;
            }

            // Escritas perdidas SEGUIDAS no Delta (4 tentativas cada, varias vezes): o inversor nao
            // esta recebendo ordens. Para tudo e acusa, em vez de seguir como se nada tivesse acontecido.
            if (g_vfd_falhas_seguidas >= 6) {
                g_vfd_falhas_seguidas = 0;
                g_manual_cmd = 0;   // cancela qualquer movimento manual em curso (manual_tick completa a parada)
                if (g_teste_seco || g_teste_rodando) auto_erro("RS-485: Delta sem resposta (6 escritas perdidas seguidas)");
                else g_delta_pausa_pedida = true;   // ciclo real: PAUSA e retoma quando o Delta voltar (delta_pausa_tick)
                break;
            }
            if (g_x10_segura) break;      // G3: sem X10 a etapa nao comeca (x10_pausa_tick libera)
            executar_processo_tick();     // avanca a sub-maquina
            break;
        }

        case AUTO_CONCLUIDO:
            desligar_tudo();
            SET_Y12(false);               // apaga vermelho
            // Enfileira wash-complete — verifica se veio do app ou do remoto
            {
                String resId = nvs_get_last_res_id();
                bool veio_do_app = resId.length() > 0;
                if (veio_do_app) backend_evt_wash_complete(g_estado.programa_sel, "");
                else              backend_evt_wash_complete(g_estado.programa_sel, g_tipo_ciclo == 2 ? "socio" : g_tipo_ciclo == 3 ? "bonus" : "remote");   // 2026-11-02: o backend conta socios e bonus (valor 0); "remote" = presencial em dinheiro
                // Quebra por origem, só pra lista da tela (ver nvs_manager.h)
                if (veio_do_app) nvs_inc_prog_app(g_estado.programa_sel);
                else              nvs_inc_prog_pres(g_estado.programa_sel);
            }
            nvs_inc_prog(g_estado.programa_sel);
            nuvem_res_limpar();            // (os eventos acima ja guardaram a reserva)
            if (g_ciclo_auto) { lav_contar_ciclo(g_estado.programa_sel, g_tipo_ciclo); g_tipo_prox = 0; }   // planilha de lavagens (so ciclo automatico concluido); o flag de socio vale p/ UM ciclo
            if (g_teste_rodando || g_ciclo_auto) { g_teste_ok++; g_teste_rodando = false; g_ciclo_auto = false; g_ev_tipo = 1; g_ev_modelo = g_estado.programa_sel; g_ev_seq++; }
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
            if (_retomando && (agora - _ret_t0) >= RETOMAR_PRESSAO_MS) {   // pressao restabelecida
                _retomando = false;
                auto_retomar_efetivo();
                break;
            }
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
bool ota_ativa();   // ota_alvo.h
void auto_iniciar(uint8_t modelo) {
    if (licenca_bloqueada()) {
        DBG_PRINTLN("[AUTO] bloqueado por licenca");
        return;
    }
    nuvem_res_limpar();                // ciclo local: sem reserva (o inicio pelo app preenche depois)
    // REGRA: o ciclo AUTOMATICO e SEMPRE COM X10 (carro real) e BOMBA em ON, venha o pedido de onde vier (painel, controle, display ou app).
    // Um teste a seco deixado para tras (SEM X10) fez o carrinho ignorar o X10 e bater no carro (2026-10-30). Aqui a W1 garante, nao a tela.
    if (g_teste_seco || !g_teste_bomba) {
        DBG_PRINTF("[AUTO] forcando CARRO REAL (X10 real) e BOMBA ON para o ciclo automatico (estava seco=%d bomba=%d)\n", (int)g_teste_seco, (int)g_teste_bomba);
        g_teste_seco = false; g_teste_bomba = true; atrasos_aplicar();
    }
    g_bomba_ciclo           = g_teste_bomba;   // trava a chave da bomba durante este ciclo
    g_tipo_ciclo            = g_tipo_prox;     // idem para o TIPO do ciclo (presencial/app/socio/bonus)
    g_estado.programa_sel   = modelo;
    g_estado.modo_auto      = true;
    g_estado.alarme         = false;
    g_processo_atual_idx    = 0;
    x14_estava_ativo        = false;
    processos_reset();       // zera as sub-maquinas dos processos
    desligar_tudo();
    SET_Y11(true);   // lampada verde
    SET_Y6(true);    // solenoide entrada pneumatica
    if (g_estado_auto != AUTO_AGUARDA_CARRO) t_armado_painel = millis();   // trocar de modelo armado NAO renova o prazo
    g_armado_painel = false;         // o painel marca true logo depois de chamar (controle.h painel_tick)
    g_estado_auto = AUTO_AGUARDA_CARRO;
}

// Inicia o teste da Alta Pressao direto no AUTO_PROCESSO (sem entrada de carro).
void teste_iniciar() {
    if (g_estado_auto != AUTO_IDLE && g_estado_auto != AUTO_ERRO) return;   // ja rodando
    if (home_rodando()) return;
    // O ciclo parte do principio de que o braco esta na posicao 1 (X16) e o carrinho recuado (X12):
    // todos os giros e o carrinho contam a partir dai. Fora disso o braco passa do ponto e o ciclo
    // da erro. (Na maquina original o AUTO_INICIANDO conferia isso; o teste pulava essa etapa.)
    modbus_refresh_io2_di();
    if (!HOME_GIRO || !X12) {
        g_manual_msg = "Faca o HOME antes de iniciar (braco fora da posicao 1 ou carrinho nao recuado)";
        g_manual_msg_ms = millis();
        DBG_PRINTF("[TESTE] INICIAR recusado: X16=%d X12=%d (faca o HOME)\n", (int)HOME_GIRO, (int)X12);
        return;
    }
    g_bomba_ciclo         = g_teste_bomba;   // trava a chave da bomba durante este ciclo
    g_estado.programa_sel = 1;
    g_estado.alarme       = false;
    g_estado.msg_alarme   = "";
    g_processo_atual_idx  = 0;
    processos_reset();
    desligar_tudo();
    g_teste_rodando = true;
    g_estado_auto   = AUTO_PROCESSO;
    DBG_PRINTF("[TESTE] iniciado (bomba %s)\n", g_teste_bomba ? "ON" : "OFF");
}

// PARAR: desliga tudo, cancela o home e volta a IDLE.
void teste_parar() {
    home_reset();
    desligar_tudo();
    vfd_stop_garantido();   // repete ate o Delta confirmar a parada
    g_vfd_falhas_seguidas = 0;
    processos_reset();
    g_teste_rodando         = false;
    g_ciclo_auto            = false;
    g_tipo_prox             = 0;       // cancelar/parar volta o tipo para presencial
    man_sai_zera();                    // saidas manuais: desligar_tudo() ja desligou; zera o marcador
    nuvem_res_limpar();                // cancelar/parar: o ciclo deixa de ser de uma reserva do app
    _retomando              = false;
    g_estado.processo_ativo = PROC_NENHUM;
    g_estado.alarme         = false;
    g_estado_auto           = AUTO_IDLE;
    // Apaga a memoria do cancelado: ciclo armado por pulso, pulsos do painel guardados no latch e rearme logo em seguida.
    g_armado_painel         = false;
    g_pausa_w2              = false;
    noInterrupts(); g_lat1 &= ~PAINEL_MASK; interrupts();
    g_painel_silencio_ate   = millis() + PAINEL_SILENCIO_MS;
    DBG_PRINTLN("[TESTE] PARADO pelo operador");
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
    DBG_PRINTLN("[AUTO] erro limpo -> IDLE");
}

static uint8_t  _pausa_mov  = 0;   // movimento que estava rodando ao pausar
static uint16_t _pausa_freq = 0;
static uint32_t _pausa_ini  = 0;   // millis() do instante em que pausou
// Saidas DE PROCESSO ligadas no instante da pausa (a pausa as desliga; CONTINUAR religa na ordem certa).
// io1: Y1(b0) Y2(b1) Y3(b2) Y5(b4) Y7(b6) | io2: Y10(b0) Y13(b2) Y0(b5). Ficam de fora: luzes (Y11/Y12),
// Y6 (entrada pneumatica) e os contatores de movimento (Y4/Y14).
#define PAUSA_MASK_IO1 0x57
#define PAUSA_MASK_IO2 (0x01 | (1 << (Y13_CANAL_W2 - 1)) | 0x20)   // Y10 (canal 1) + Y13 + Y0 (canal 6)
static uint8_t  _pausa_do1 = 0, _pausa_do2 = 0;

void auto_pausar() {
    _pausa_mov  = g_vfd_mov;        // guarda o que estava rodando
    _pausa_freq = g_vfd_mov_freq;
    _pausa_ini  = millis();         // marca o inicio da pausa (p/ deslocar os cronometros ao retomar)
    vfd_stop();                     // para o motor JA
    // Desliga as bombas/solenoides do processo (antes a pausa so parava o motor e a agua continuava saindo).
    _pausa_do1 = g_io1.do_ & PAUSA_MASK_IO1;
    _pausa_do2 = (uint8_t)g_io2.do_ & PAUSA_MASK_IO2;
    SET_Y7(false);  SET_Y13(false); SET_Y0(false);               // bombas primeiro
    SET_Y1(false);  SET_Y2(false);  SET_Y3(false); SET_Y10(false); SET_Y5(false);
    g_estado_auto     = AUTO_PAUSADO;
    g_estado.em_pausa = true;
    DBG_PRINTF("[AUTO] PAUSADO (motor parado; saidas desligadas: io1=0x%02X io2=0x%02X)\n", _pausa_do1, _pausa_do2);
}

// CONTINUAR: religa as saidas de processo e comeca a espera de pressao. O movimento so retoma depois
// (auto_retomar_efetivo, chamada pelo auto_tick quando os 2 s passam).
void auto_retomar() {
    if (_retomando) return;
    if (g_pausa_delta && !g_delta_liberando) { g_manual_msg = "Delta sem resposta: aguarde o inversor voltar para continuar"; g_manual_msg_ms = millis(); return; }
    if (g_pausa_x10 && !X10) { g_manual_msg = "Sem X10 (carro sob a mesa): coloque o carro para continuar"; g_manual_msg_ms = millis(); return; }
    if (radio_ruim()) { g_manual_msg = "Radio/W2 sem contato: aguarde para continuar"; g_manual_msg_ms = millis(); return; }   // nao religa saidas sem a W2
    // Solenoides ANTES da bomba de espuma (Y7 so liga com um solenoide ativo).
    if (_pausa_do1 & 0x01) SET_Y1(true);
    if (_pausa_do1 & 0x02) SET_Y2(true);
    if (_pausa_do1 & 0x04) SET_Y3(true);
    if (_pausa_do1 & 0x10) SET_Y5(true);
    if (_pausa_do2 & 0x01) SET_Y10(true);
    if (_pausa_do1 & 0x40) SET_Y7(true);
    if (_pausa_do2 & 0x04) SET_Y13(true);
    if (_pausa_do2 & 0x20) SET_Y0(true);
    _retomando = true; _ret_t0 = millis();
    g_manual_msg = "Restabelecendo a pressao (2 s) antes de retomar..."; g_manual_msg_ms = millis();
}

static void auto_retomar_efetivo() {
    // desloca TODOS os cronometros dos processos pelo tempo que ficou pausado (inclui a espera de
    // pressao), pra o giro/carrinho continuarem como se o tempo nao tivesse passado.
    uint32_t delta = millis() - _pausa_ini;
    processos_shift_timers(delta);
    _pausa_do1 = 0; _pausa_do2 = 0;
    if (_pausa_mov == 1)      vfd_run_fwd(_pausa_freq);   // re-emite o movimento
    else if (_pausa_mov == 2) vfd_run_rev(_pausa_freq);
    g_estado_auto     = AUTO_PROCESSO;
    g_estado.em_pausa = false;
    DBG_PRINTF("[AUTO] RETOMADO (pausa=%ums deslocada)\n", (unsigned)delta);
}

// ---- X10 EM TODAS AS ETAPAS (regras G3/G4/G5 de docs/REGRAS_RETOMADA_CICLO.md, 2026-11-02) ----
// Vale no ciclo com carro real (nao no SECO nem nos testes tecnicos). 'X10 ausente indevido' = X10 apagado sem o carrinho ter andado 3 s (Y14) desde
// a ultima vez que o X10 foi visto com o carrinho parado (mesma conta da ocorrencia O1). Sair do X10 andando (>= 3 s) e normal e nao pausa.
//  G3: antes de INICIAR cada etapa o X10 tem que ler o carro: sem ele a etapa NAO comeca (g_x10_segura) ate o X10 ficar estavel 1500 ms.
//  G4/G5: no meio de uma etapa, X10 ausente indevido por 500 ms -> PAUSA (motor parado, bombas/solenoides desligados). X10 de volta e estavel
//         1500 ms -> RETOMA sozinho (religa as saidas, 2 s de pressao, re-emite o movimento). Giro 1->2: rebobina ate a posicao 1 e refaz o giro.
//  Sem X10 por 60 s (segurando ou pausado): ERRO (cancela e estorna).
#define X10_PERDIDO_MS     500UL      // X10 apagado por isso para pausar (filtra o fantasma do jato de agua)
#define X10_PERDIDO_GIRO_MS 1500UL    // durante o GIRO o filtro e maior: o jato de agua da Alta Pressao apagava o X10 por ~0,5 s e fazia pausar e rebobinar o braco (2026-11-03)
#define X10_VOLTA_MS       1500UL     // X10 de volta e estavel por isso -> retoma / libera a etapa
#define X10_PAUSA_MAX_MS   60000UL    // 60 s sem X10 -> erro
bool giro_x10_pausa_marcar();
int  proc_estado();
void x10_pausa_tick(uint32_t agora) {
    static uint32_t t_sem = 0, t_pausa = 0, t_volta = 0, t_msg = 0, t_ult = 0, y14_ms = 0, t_ok = 0, t_seg = 0;
    uint32_t dt = t_ult ? agora - t_ult : 0; t_ult = agora; if (dt > 1000) dt = 0;
    bool y14 = (g_io2.do_ & 0x08) != 0;
    if (y14) y14_ms += dt; else if (X10) y14_ms = 0;           // deslocamento acumulado desde a ultima vez que o X10 foi visto com o carrinho parado
    bool sem_x10 = !X10 && y14_ms < 3000UL;                          // X10 ausente sem o deslocamento de 3 s
    bool indevido = sem_x10 && !g_x10_ausente_ok;                    // so conta onde o carro precisa ser visto (nao no retorno)   // ausencia esperada (processo saiu do X10 de proposito) nao conta
    bool vale = !g_teste_seco && !g_teste_rodando;
    if (g_estado_auto == AUTO_PROCESSO && vale) {
        if (proc_estado() == 0 && X10) g_x10_ausente_ok = false;     // etapa nova com o carro visto: o X10 volta a valer
        if (!g_x10_segura && sem_x10 && proc_estado() == 0) {   // G3: a etapa ainda nao comecou (vale mesmo depois de um retorno)
            g_x10_segura = true; t_seg = agora ? agora : 1; t_ok = 0; t_sem = 0;
            DBG_PRINTLN("[X10] sem X10 antes de iniciar a etapa: aguardando (nada liga ate o X10 voltar)");
        }
        if (g_x10_segura) {
            if (X10) { if (!t_ok) t_ok = agora ? agora : 1; else if ((int32_t)(agora - t_ok) >= (int32_t)X10_VOLTA_MS) { g_x10_segura = false; DBG_PRINTLN("[X10] voltou e estavel: a etapa comeca"); } }
            else t_ok = 0;
            if ((int32_t)(agora - t_msg) >= 1000) { t_msg = agora; g_manual_msg = X10 ? "X10 voltou: iniciando..." : "Aguardando X10 (carro sob a mesa)"; g_manual_msg_ms = millis(); }
            if (g_x10_segura && (int32_t)(agora - t_seg) >= (int32_t)X10_PAUSA_MAX_MS) { g_x10_segura = false; auto_erro("Sem X10 (carro sob a mesa) por 60 s - lavagem cancelada"); return; }
        } else if (indevido && !g_giro_ativo) {                    // G4/G5: no meio da etapa. DURANTE O GIRO o X10 NAO e vigiado (2026-11-06: o lavador relatou 3 pausas falsas por leitura do X10 no dia; vale so nos deslocamentos e no inicio da etapa)
            if (!t_sem) t_sem = agora ? agora : 1;
            if ((int32_t)(agora - t_sem) >= (int32_t)X10_PERDIDO_MS) {
                t_sem = 0;
                auto_pausar();                                  // para o Delta, desliga bombas/solenoides, guarda o movimento e o instante
                bool rew = giro_x10_pausa_marcar();             // giro 1->2: a retomada rebobina (e nao re-emite o movimento antigo)
                if (rew) _pausa_mov = 0;
                g_pausa_x10 = true; t_pausa = agora; t_volta = 0;
                DBG_PRINTF("[X10] ausente no meio da etapa (deslocamento %lu ms) -> PAUSADO (motor parado, bombas desligadas)%s\n", (unsigned long)y14_ms, rew ? "; ao voltar: rebobina ate a posicao 1 e refaz o giro" : "");
            }
        } else {
            t_sem = 0;
        }
    } else if (g_estado_auto != AUTO_PAUSADO) {
        t_sem = 0; g_x10_segura = false; g_x10_ausente_ok = false;
    }
    if (g_estado_auto == AUTO_PAUSADO && g_pausa_x10) {
        if ((int32_t)(agora - t_msg) >= 1000) { t_msg = agora; g_manual_msg = X10 ? "X10 voltou: retomando..." : "PAUSADO: sem X10 (carro sob a mesa)"; g_manual_msg_ms = millis(); }
        if (!X10) {
            t_volta = 0;
            if ((int32_t)(agora - t_pausa) >= (int32_t)X10_PAUSA_MAX_MS) { g_pausa_x10 = false; g_giro_rewind = false; auto_erro("Sem X10 (carro sob a mesa) por 60 s - lavagem cancelada"); }
        } else if (!_retomando) {
            if (!t_volta) t_volta = agora ? agora : 1;
            else if ((int32_t)(agora - t_volta) >= (int32_t)X10_VOLTA_MS) {
                DBG_PRINTLN("[X10] voltou e estavel -> CONTINUANDO");
                auto_retomar();                                 // pode recusar (W2 sem contato): tenta de novo no proximo tick
                if (_retomando) { g_pausa_x10 = false; t_volta = 0; }
            }
        }
    } else if (g_estado_auto != AUTO_PAUSADO) {
        g_pausa_x10 = false;                                    // saiu da pausa por outro caminho (cancelar, erro): zera a marca
    }
}

// ---- X7 = CONTRAPROVA DO BRACO NO LADO 2 (2026-11-03) ----
// O X7 foi tirado de todas as rotinas do giro (busca fina do home, vigia de braco parado, memoria de direcao). Fisicamente fica na posicao 2:
// se a maquina perder qualquer informacao (reinicio, pausa, sensor duvidoso), g_braco_lado2 diz que o braco esta no lado 2. Mesmo filtro de ruido
// dos X16/X17: so vale (e so deixa de valer) depois de ficar CONSTANTE por mais de SENSOR_HOME_DEBOUNCE_MS (100 ms). Por ora so informa e
// registra no serial; nada decide por ele.
#define X7_DEBOUNCE_MS 100UL
void braco_lado2_tick(uint32_t agora) {
    static bool lido = false, ult = false;
    static uint32_t t_mud = 0;
    bool x7 = X7;
    if (!lido || x7 != ult) { lido = true; ult = x7; t_mud = agora; }          // mudou: recomeca a contar a estabilidade
    if ((int32_t)(agora - t_mud) >= (int32_t)X7_DEBOUNCE_MS && g_braco_lado2 != ult) {
        g_braco_lado2 = ult;
        DBG_PRINTF("[X7] braco %s o lado 2 (X7 estavel %lu ms)\n", g_braco_lado2 ? "NO" : "FORA do", (unsigned long)X7_DEBOUNCE_MS);
    }
}

// ---- DELTA SEM RESPONDER NO CICLO (2026-11-03) ----
// Uma ordem de movimento ao Delta que se perde de vez (delta_falhou em processos.h) ou 6 escritas perdidas seguidas NAO cancelam mais o ciclo:
// PAUSA (mesmo auto_pausar do X10: motor parado, bombas/solenoides desligados, movimento guardado). A pausa reenvia o vfd_stop a cada 300 ms;
// quando o Delta aceita as ordens de forma estavel por DELTA_VOLTA_MS, RETOMA sozinho (religa as saidas, 2 s de pressao, reemite o movimento).
// Sem o Delta por 60 s: ERRO (cancela e estorna). Nao le o Delta nem cria polling novo: so reage a falha de escrita.
#define DELTA_VOLTA_MS      1500UL
#define DELTA_PAUSA_MAX_MS  60000UL
void delta_pausa_tick(uint32_t agora) {
    static uint32_t t_pausa = 0, t_ok = 0, t_msg = 0;
    if (g_delta_pausa_pedida) {
        g_delta_pausa_pedida = false;
        if (g_estado_auto == AUTO_PROCESSO) {
            auto_pausar();
            g_pausa_delta = true; t_pausa = agora; t_ok = 0;
            Preferences p; if (p.begin("delta", false)) { p.putUInt("pz", p.getUInt("pz", 0) + 1); p.end(); }   // quantas pausas por Delta (admin/diagnostico)
            DBG_PRINTLN("[DELTA] sem resposta no ciclo -> PAUSADO (reenvia o stop; retoma sozinho quando o Delta voltar)");
        }
    }
    if (g_estado_auto == AUTO_PAUSADO && g_pausa_delta) {
        if ((int32_t)(agora - t_msg) >= 1000) { t_msg = agora; g_manual_msg = "PAUSADO: Delta sem resposta - retoma sozinho"; g_manual_msg_ms = millis(); }
        bool ok = g_vfd_run_ok && g_vfd_falhas_seguidas == 0;       // o ultimo vfd_stop (a cada 300 ms) foi aceito
        if (!ok) {
            t_ok = 0;
            if ((int32_t)(agora - t_pausa) >= (int32_t)DELTA_PAUSA_MAX_MS) { g_pausa_delta = false; auto_erro("RS-485: Delta sem resposta por 60 s - lavagem cancelada"); }
        } else if (!_retomando) {
            if (!t_ok) t_ok = agora ? agora : 1;
            else if ((int32_t)(agora - t_ok) >= (int32_t)DELTA_VOLTA_MS) {
                DBG_PRINTLN("[DELTA] voltou e estavel -> CONTINUANDO");
                g_delta_liberando = true; auto_retomar(); g_delta_liberando = false;   // pode recusar (X10 ausente / W2): tenta de novo no proximo tick
                if (_retomando) { g_pausa_delta = false; t_ok = 0; }
            }
        }
    } else if (g_estado_auto != AUTO_PAUSADO) {
        g_pausa_delta = false;                                  // saiu da pausa por outro caminho (cancelar, erro): zera a marca
    }
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
// Limite de tentativas (2026-11-01): em 31/10 a recuperacao falhou 29+ vezes seguidas, acionando o Delta a cada 4 s sem desistir. Agora, apos
// REC_MAX_TENTATIVAS falhas SEGUIDAS do HOME ela DESISTE: para de comandar a maquina e fica em ERRO (vermelho piscando, mensagem na tela, evento
// para a nuvem); o lavador limpa com PARAR TUDO e faz o HOME pelo painel. Carro reentrando (Fase 1) ou HOME ok zeram a contagem.
#define REC_MAX_TENTATIVAS 3
static uint8_t g_rec_tent = 0;
// HOME OBRIGATORIO PELO BOTAO (2026-11-01): ao religar fora do zero a W1 zera as saidas e FICA PARADA (vermelho piscando + mensagem) ate alguem tocar no
// botao HOME do display. So depois a recuperacao roda o HOME (ate REC_MAX_TENTATIVAS). Carro reentrando (X15) cancela o pedido: exige tocar de novo.
static bool g_rec_home_pedido = false;

bool recuperacao_ativa() { return g_rec_estado == REC_ATIVA; }
// Fase 1 da recuperacao = "X15 ocupada, esperando retirar o veiculo" (HOME ainda nao iniciado). Nela o MANUAL (giro/carrinho, homem morto,
// operador olhando) e liberado: sem isso, um braco parado na frente do X15 (que o X15 enxerga como "carro") nunca sai do lugar — o HOME e o
// MANUAL ficavam os dois bloqueados e a maquina nao tinha como se destravar (2026-10-31). HOME/automatico continuam bloqueados com X15 ocupada.
bool recuperacao_fase1() { return g_rec_estado == REC_ATIVA && !g_rec_home_iniciado && !home_rodando(); }

static void rec_lamp_fase1() {   // vermelho piscando 0,5 Hz (1000ms on/off) — 4x mais lento; verde apagado
    static uint32_t t = 0; static bool on = false;
    SET_Y11(false);
    if (millis() - t >= 1000) { t = millis(); on = !on; SET_Y12(on); }
}
static void rec_lamp_fase2() {   // verde/vermelho alternando 0,125 Hz (4000ms cada) — 4x mais lento
    static uint32_t t = 0; static bool verde = true;
    if (millis() - t >= 4000) { t = millis(); verde = !verde; SET_Y11(verde); SET_Y12(!verde); }
}

const char* recuperacao_pedir_home() {
    if (g_rec_estado != REC_ATIVA)  return "HOME bloqueado: recuperacao de boot encerrada";
    if (home_rodando() || g_rec_home_iniciado) return "HOME em andamento: aguarde";
    modbus_refresh_io2_di();
    if (X15) return "Retire o veiculo da posicao e toque em HOME de novo";
    g_rec_home_pedido = true;
    DBG_PRINTLN("[REC] HOME pedido pelo botao do display");
    return "HOME iniciado";
}
const char* recuperacao_mensagem() {
    if (g_rec_estado != REC_ATIVA || home_rodando() || g_rec_home_iniciado) return nullptr;
    // X7 = contraprova do lado 2 (braco_lado2_tick): diz ao operador onde a W1 sabe que o braco esta. Nao muda nenhuma decisao de movimento.
    if (g_braco_lado2) return X15 ? "Religou fora do zero (braco no LADO 2 - X7): retire o veiculo e toque em HOME" : "Religou fora do zero (braco no LADO 2 - X7): toque em HOME no display";
    return X15 ? "Religou fora do zero: retire o veiculo e toque em HOME" : "Religou fora do zero: toque em HOME no display";
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
        DBG_PRINTF("[REC] boot fora do zero -> recuperacao ativa (saidas zeradas). Braco: %s\n",
                   g_braco_lado2 ? "LADO 2 (X7 estavel)" : HOME_GIRO ? "LADO 1 (X16)" : "posicao desconhecida (nem X7 nem X16)");
        return;
    }
    if (g_rec_estado != REC_ATIVA) return;

    // ---- recuperacao ativa: decide a fase pelo X15 ----
    if (!home_rodando()) modbus_refresh_io2_di();    // fora do home, leitura fresca aqui
    // REAVALIACAO DO ZERO (2026-11-02, achado na maquina): a decisao "fora do zero" e tomada UMA vez, no boot. Se naquele instante os sensores estavam
    // sem energia/ainda sem leitura (ordem de ligar dos 24 V), a W1 ficava presa pedindo HOME com o braco ja no zero. Enquanto ESPERA o botao HOME, se
    // X16 (HOME_GIRO) + X12 (carrinho recuado) ficarem ativos e ESTAVEIS por 1500 ms, o zero esta confirmado pelos sensores: encerra a recuperacao.
    {
        static uint32_t t_zero = 0;
        if (!g_rec_home_pedido && !g_rec_home_iniciado && !home_rodando() && HOME_GIRO && X12) {
            if (!t_zero) t_zero = millis() ? millis() : 1;
            else if (millis() - t_zero >= 1500UL) {
                t_zero = 0; g_rec_estado = REC_CONCLUIDA; g_rec_tent = 0; SET_Y11(false); SET_Y12(false);
                DBG_PRINTLN("[REC] sensores confirmam o ZERO (X16 + X12 estaveis por 1500 ms): recuperacao encerrada sem HOME");
                return;
            }
        } else t_zero = 0;
    }
    bool carro = X15;

    if (carro) {
        // FASE 1 — carro na posicao: se um home estava em andamento, aborta.
        if (home_rodando() || g_rec_home_iniciado) {
            home_reset(); g_rec_home_iniciado = false;
            DBG_PRINTLN("[REC] carro reentrou -> aborta home (Fase 1)");
        }
        g_rec_tent = 0;                              // condicao mudou (carro na posicao): a contagem de falhas recomeca
        g_rec_home_pedido = false;                   // e o HOME volta a exigir o botao
        rec_lamp_fase1();
        return;
    }

    // FASE 2 — X15 livre: espera o botao HOME do display; com o pedido, inicia o home e acompanha ate concluir.
    if (!g_rec_home_pedido && !g_rec_home_iniciado) { rec_lamp_fase1(); return; }
    if (!g_rec_home_iniciado) {
        home_iniciar(); g_rec_home_iniciado = true;
        DBG_PRINTLN("[REC] X15 livre -> inicia HOME");
    }
    rec_lamp_fase2();

    int he = home_estado();
    if (he == HOME_OK) {
        SET_Y11(false); SET_Y12(false);
        g_rec_estado = REC_CONCLUIDA; g_rec_tent = 0; g_rec_home_pedido = false;
        DBG_PRINTLN("[REC] HOME concluido -> recuperacao encerrada");
    } else if (he == HOME_FALHA) {
        g_rec_home_iniciado = false;                 // retenta no proximo tick (se X15 livre) ... ate REC_MAX_TENTATIVAS
        g_rec_tent++;
        if (g_rec_tent >= REC_MAX_TENTATIVAS) {
            DBG_PRINTF("[REC] HOME falhou %u vezes seguidas -> DESISTE (ERRO: faca o HOME pelo painel)\n", (unsigned)g_rec_tent);
            g_rec_estado = REC_CONCLUIDA; g_rec_home_pedido = false;   // para de comandar a maquina (libera PARAR TUDO / HOME / MANUAL)
            SET_Y11(false); SET_Y12(false);
            auto_erro("Recuperacao falhou 3x: faca o HOME pelo painel");   // ERRO + evento para a nuvem (display envia FAULT)
        } else {
            DBG_PRINTF("[REC] HOME falhou (%u/%u) -> vai retentar\n", (unsigned)g_rec_tent, (unsigned)REC_MAX_TENTATIVAS);
        }
    }
}

// Sub-maquinas dos processos (usa os macros/helpers acima e g_estado_auto)
// ---- LUZES DA MAQUINA (DO7 da W2) — pedido do Giovani (2026-10-24) ----
// Ligam sempre que houver lavagem em andamento ou pedido de lavagem esperando (ciclo armado esperando o carro; no futuro tambem a fila do app),
// e tambem durante o HOME, o modo MANUAL e o trabalho do TECNICO (pedido do Giovani, 2026-10-24).
// Quando acaba a lavagem e nao ha mais nada esperando, ficam acesas por mais 10 MINUTOS e apagam. Ao ligar a W1 comecam apagadas.
// desligar_tudo() NAO mexe neste canal (PARAR TUDO nao apaga as luzes; so o tempo apaga).
#define LUZES_APOS_FIM_MS 600000UL                 // 10 min
bool g_fila_app = false;                           // FUTURO: camera/app avisa que ha fila esperando lavagem (ainda nao ligado)
static bool     g_luzes_on = false;
static uint32_t g_luzes_t_ativo = 0;
void luzes_tick() {
    // "Ativo" = lavagem em andamento/esperando, HOME, movimento manual, saidas manuais (inclui BOMBA TESTE) ou TECNICO presente
    // (o display manda a acao 70 a cada 10 s enquanto esta nas telas TECNICO, MANUAL ou WI-FI; vale por 30 s sem aviso).
    bool tecnico = g_tec_ping_ms && (millis() - g_tec_ping_ms) < 30000UL;
    bool ativo = (g_estado_auto != AUTO_IDLE && g_estado_auto != AUTO_ERRO) || g_teste_rodando || g_fila_app
                 || home_rodando() || g_manual_ativo || g_man_sai || tecnico;
    uint32_t agora = millis();
    if (ativo) {
        g_luzes_t_ativo = agora ? agora : 1;
        if (!g_luzes_on) { SET_LUZES(true); g_luzes_on = true; DBG_PRINTLN("[LUZES] ligadas (lavagem em andamento / esperando)"); }
    } else if (g_luzes_on && (agora - g_luzes_t_ativo) >= LUZES_APOS_FIM_MS) {
        SET_LUZES(false); g_luzes_on = false;
        DBG_PRINTLN("[LUZES] apagadas (10 min sem lavagem)");
    }
}

#include "processos.h"
