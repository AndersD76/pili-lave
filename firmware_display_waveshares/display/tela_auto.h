#pragma once
#include <lvgl.h>
#include "tipos.h"
#include "nvs_manager.h"

static lv_obj_t* scr_auto           = nullptr;
static lv_obj_t* lbl_auto_cnt[4]    = {};
static lv_obj_t* btn_auto_prog[4]   = {};   // botoes de programa (pra marcar o selecionado)
static lv_obj_t* btn_pausa_auto     = nullptr;
static lv_obj_t* lbl_pausa_auto     = nullptr;
static lv_obj_t* lbl_status_auto    = nullptr;   // status do ciclo / mensagem de erro
static lv_obj_t* lbl_diag_auto      = nullptr;   // diagnostico: sub-estado + sensores
static lv_obj_t* lbl_giro_dur       = nullptr;   // TEMPORARIO (tuning giro): valor do tempo de giro
static lv_obj_t* lbl_giro_to        = nullptr;   // TEMPORARIO (tuning giro): valor do timeout

// Diagnostico na tela (o serial fica mudo com a maquina ligada). Mostra o
// sub-estado do processo e os sensores-chave. Chamar com o lock do LVGL.
void tela_auto_atualizar_diag() {
    if (!lbl_diag_auto) return;
    char buf[128];
    snprintf(buf, sizeof(buf),
        "St:%d %s X17:%d X16:%d X7:%d X11:%d X10:%d X12:%d X13:%d X14:%d X15:%d",
        proc_estado(),
        giro_dupla() ? "[!MSG DUPLA X7+X11!]" : "",
        io2_get_di(7), io2_get_di(8), io1_get_di(8), io2_get_di(2),
        io2_get_di(1), io2_get_di(3), io2_get_di(4), io2_get_di(5), io2_get_di(6));
    lv_label_set_text(lbl_diag_auto, buf);
}

// Atualiza o texto de status do ciclo automatico na tela AUTO (andamento e
// ERROS — ex.: "braco fora de posicao"). Chamar com o lock do LVGL em maos.
void tela_auto_atualizar_status() {
    if (!lbl_status_auto) return;
    static char buf[72];
    lv_color_t cor = COR_TEXTO;
    switch (g_estado_auto) {
        case AUTO_IDLE:           snprintf(buf, sizeof(buf), "Selecione o modelo"); cor = COR_TEXTO_FRACO; break;
        case AUTO_AGUARDA_CARRO:  snprintf(buf, sizeof(buf), "Aguardando carro..."); cor = COR_AMARELO; break;
        case AUTO_CARRO_ENTRANDO: snprintf(buf, sizeof(buf), "Carro entrando...");    cor = COR_AMARELO; break;
        case AUTO_AGUARDA_POS:    snprintf(buf, sizeof(buf), "Aguardando posicao...");cor = COR_AMARELO; break;
        case AUTO_INICIANDO:      snprintf(buf, sizeof(buf), "Iniciando ciclo...");   cor = COR_AMARELO; break;
        case AUTO_HOMING:         snprintf(buf, sizeof(buf), "Referenciando braco (HOME)..."); cor = COR_AMARELO; break;
        case AUTO_PROCESSO:       snprintf(buf, sizeof(buf), "Executando: %s",
                                           NOMES_PROCESSO[g_estado.processo_ativo]);  cor = COR_VERDE; break;
        case AUTO_CONCLUIDO:      snprintf(buf, sizeof(buf), "Ciclo concluido");      cor = COR_VERDE; break;
        case AUTO_PAUSADO:        snprintf(buf, sizeof(buf), "PAUSADO");              cor = COR_AMARELO; break;
        case AUTO_ERRO:           snprintf(buf, sizeof(buf), "ERRO: %s",
                                           g_estado.msg_alarme ? g_estado.msg_alarme : "?"); cor = COR_VERMELHO; break;
        default:                  buf[0] = '\0'; break;
    }
    lv_label_set_text(lbl_status_auto, buf);
    lv_obj_set_style_text_color(lbl_status_auto, cor, 0);
}

// Marca (destaca em verde) o programa selecionado; os outros voltam ao azul.
// Chamar com o lock do LVGL em maos.
void tela_auto_marcar_programa(uint8_t prog) {
    for (int i = 0; i < 4; i++) {
        if (!btn_auto_prog[i]) continue;
        lv_obj_set_style_bg_color(btn_auto_prog[i],
            (i + 1 == prog) ? COR_VERDE : COR_ATIVO, 0);
    }
}

static void (*_cb_auto_voltar)() = nullptr;

// ===================== TEMPORARIO (tuning do giro) =====================
// Botao para ajustar o tempo de parada do giro AO VIVO, ate achar o valor certo.
// Depois de fixar o valor, REMOVER: este bloco, o painel em tela_auto_criar, a
// chamada em tela_auto_ativar, o global g_giro_dur_ms/NVS e voltar ao #define.
// -----------------------------------------------------------------------
void tela_auto_atualizar_giro_dur() {
    if (lbl_giro_dur) lv_label_set_text_fmt(lbl_giro_dur, "GIRO: %u ms", (unsigned)g_giro_dur_ms);
}
void tela_auto_atualizar_giro_to() {
    if (lbl_giro_to) lv_label_set_text_fmt(lbl_giro_to, "TIMEOUT: %u ms", (unsigned)g_giro_timeout_ms);
}

static void cb_giro_ajuste(lv_event_t* e) {
    int32_t delta = (int32_t)(intptr_t)lv_event_get_user_data(e);
    int32_t v = (int32_t)g_giro_dur_ms + delta;
    if (v < 3000)  v = 3000;     // pisos/tetos de seguranca
    if (v > 14000) v = 14000;
    g_giro_dur_ms = (uint32_t)v;
    nvs_set_giro_dur(g_giro_dur_ms);
    tela_auto_atualizar_giro_dur();
}

static void cb_timeout_ajuste(lv_event_t* e) {
    int32_t delta = (int32_t)(intptr_t)lv_event_get_user_data(e);
    int32_t v = (int32_t)g_giro_timeout_ms + delta;
    if (v < 5000)  v = 5000;
    if (v > 20000) v = 20000;
    g_giro_timeout_ms = (uint32_t)v;
    nvs_set_giro_to(g_giro_timeout_ms);
    tela_auto_atualizar_giro_to();
}
// =================== FIM TEMPORARIO (tuning do giro) ===================

// Atualiza o botao PAUSAR/RETOMAR conforme o estado do ciclo automatico.
// Chamar SEMPRE com o lock do LVGL em maos.
void tela_auto_atualizar_pausa() {
    if (!btn_pausa_auto) return;
    if (g_estado_auto == AUTO_PAUSADO) {
        lv_label_set_text(lbl_pausa_auto, "RETOMAR");
        lv_obj_set_style_bg_color(btn_pausa_auto, lv_color_hex(0x00C853), 0);
        lv_obj_clear_state(btn_pausa_auto, LV_STATE_DISABLED);
    } else if (g_estado_auto == AUTO_PROCESSO) {
        lv_label_set_text(lbl_pausa_auto, "PAUSAR");
        lv_obj_set_style_bg_color(btn_pausa_auto, lv_color_hex(0xFFD600), 0);
        lv_obj_clear_state(btn_pausa_auto, LV_STATE_DISABLED);
    } else {
        // IDLE / AGUARDA_CARRO / etc -> pausa desabilitada
        lv_label_set_text(lbl_pausa_auto, "PAUSAR");
        lv_obj_set_style_bg_color(btn_pausa_auto, lv_color_hex(0xFFD600), 0);
        lv_obj_add_state(btn_pausa_auto, LV_STATE_DISABLED);
    }
}

static void cb_pausa_auto(lv_event_t* e) {
    if (g_estado_auto == AUTO_PROCESSO)      auto_pausar();
    else if (g_estado_auto == AUTO_PAUSADO)  auto_retomar();
    tela_auto_atualizar_pausa();
}

// LIMPAR ERRO — so age se houver alarme (a propria auto_limpar_erro protege)
static void cb_limpar_erro(lv_event_t* e) {
    auto_limpar_erro();
    tela_auto_atualizar_status();
    tela_auto_atualizar_pausa();
}

// M/A — cancela o modo automático e volta para a tela manual
static void cb_auto_ma(lv_event_t* e) {
    g_estado.modo_auto = false;
    if (_cb_auto_voltar) _cb_auto_voltar();
}

// Seleciona o programa, entra em modo automático e volta para a tela manual
static void cb_auto_prog(lv_event_t* e) {
    uint8_t prog = (uint8_t)(intptr_t)lv_event_get_user_data(e);
    g_estado.programa_sel = prog;
    g_estado.modo_auto = true;
    if (_cb_auto_voltar) _cb_auto_voltar();
}

void tela_auto_criar(void (*cb_voltar)()) {
    _cb_auto_voltar = cb_voltar;

    scr_auto = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_auto, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_auto, LV_OBJ_FLAG_SCROLLABLE);

    // M/A no topo
    lv_obj_t* btn_ma = lv_btn_create(scr_auto);
    lv_obj_set_pos(btn_ma, 10, 10);
    lv_obj_set_size(btn_ma, 110, 50);
    lv_obj_set_style_bg_color(btn_ma, COR_ATIVO, 0);
    lv_obj_set_style_radius(btn_ma, 6, 0);
    lv_obj_t* lbl_ma = lv_label_create(btn_ma);
    lv_label_set_text(lbl_ma, "M/A");
    lv_obj_center(lbl_ma);
    lv_obj_add_event_cb(btn_ma, cb_auto_ma, LV_EVENT_CLICKED, nullptr);

    // LIMPAR ERRO (topo-direita) — vermelho; so limpa quando ha alarme
    lv_obj_t* btn_err = lv_btn_create(scr_auto);
    lv_obj_set_pos(btn_err, 660, 10);
    lv_obj_set_size(btn_err, 130, 50);
    lv_obj_set_style_bg_color(btn_err, COR_DESTAQUE, 0);
    lv_obj_set_style_radius(btn_err, 6, 0);
    lv_obj_t* lbl_err = lv_label_create(btn_err);
    lv_label_set_text(lbl_err, "LIMPAR ERRO");
    lv_obj_set_style_text_font(lbl_err, &lv_font_montserrat_16, 0);
    lv_obj_center(lbl_err);
    lv_obj_add_event_cb(btn_err, cb_limpar_erro, LV_EVENT_CLICKED, nullptr);

    // Logo (centro-topo)
    lv_obj_t* logo_fundo = lv_obj_create(scr_auto);
    lv_obj_set_size(logo_fundo, 350, 100);
    lv_obj_align(logo_fundo, LV_ALIGN_TOP_MID, 0, 10);
    lv_obj_set_style_bg_color(logo_fundo, lv_color_hex(0x000000), 0);
    lv_obj_set_style_border_width(logo_fundo, 0, 0);
    lv_obj_set_style_radius(logo_fundo, 0, 0);
    lv_obj_clear_flag(logo_fundo, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t* lbl_logo = lv_label_create(logo_fundo);
    lv_label_set_text(lbl_logo, "[ " LV_SYMBOL_HOME " ] PILI");
    lv_obj_set_style_text_color(lbl_logo, COR_TEXTO, 0);
    lv_obj_set_style_text_font(lbl_logo, &lv_font_montserrat_28, 0);
    lv_obj_center(lbl_logo);

    // 4 botões grandes de programa
    static const char* nomes[4] = { "PROGRAMA 1", "PROGRAMA 2", "PROGRAMA 3", "PROGRAMA 4" };
    static const lv_coord_t xs[4] = { 10, 188, 366, 544 };
    for (int i = 0; i < 4; i++) {
        lv_obj_t* btn = lv_btn_create(scr_auto);
        lv_obj_set_pos(btn, xs[i], 140);
        lv_obj_set_size(btn, 170, 90);
        lv_obj_set_style_bg_color(btn, COR_ATIVO, 0);
        lv_obj_set_style_radius(btn, 8, 0);
        btn_auto_prog[i] = btn;
        lv_obj_t* lbl = lv_label_create(btn);
        lv_label_set_text(lbl, nomes[i]);
        lv_obj_set_style_text_font(lbl, &lv_font_montserrat_18, 0);
        lv_obj_center(lbl);
        lv_obj_add_event_cb(btn, cb_auto_prog, LV_EVENT_CLICKED, (void*)(intptr_t)(i+1));

        lbl_auto_cnt[i] = lv_label_create(scr_auto);
        lv_label_set_text_fmt(lbl_auto_cnt[i], "Prog %d hoje: 0", i+1);
        lv_obj_set_style_text_color(lbl_auto_cnt[i], COR_TEXTO_FRACO, 0);
        lv_obj_set_pos(lbl_auto_cnt[i], xs[i], 245);
    }

    // ---- TEMPORARIO (tuning giro): painel de ajuste GIRO + TIMEOUT ao vivo ----
    // Remover este bloco inteiro quando os valores forem fixados no #define.
    lv_obj_t* pnl_giro = lv_obj_create(scr_auto);
    lv_obj_set_pos(pnl_giro, 100, 264);
    lv_obj_set_size(pnl_giro, 600, 88);
    lv_obj_set_style_bg_color(pnl_giro, COR_PAINEL, 0);
    lv_obj_set_style_border_color(pnl_giro, COR_BORDA, 0);
    lv_obj_set_style_border_width(pnl_giro, 1, 0);
    lv_obj_set_style_radius(pnl_giro, 8, 0);
    lv_obj_set_style_pad_all(pnl_giro, 4, 0);
    lv_obj_clear_flag(pnl_giro, LV_OBJ_FLAG_SCROLLABLE);

    static const lv_coord_t gt_x[6] = { 168, 238, 308, 382, 452, 522 };  // x dos 6 botoes

    // ----- linha 1: GIRO (parada do lado 1->2 / rede) -----
    lbl_giro_dur = lv_label_create(pnl_giro);
    lv_obj_set_style_text_color(lbl_giro_dur, COR_AMARELO, 0);
    lv_obj_set_style_text_font(lbl_giro_dur, &lv_font_montserrat_16, 0);
    lv_obj_set_pos(lbl_giro_dur, 2, 10);
    static const char*   g_txt[6]   = { "-100", "-25", "-10", "+10", "+25", "+100" };
    static const int32_t g_delta[6] = { -100,   -25,   -10,   10,    25,    100   };
    for (int i = 0; i < 6; i++) {
        lv_obj_t* btn = lv_btn_create(pnl_giro);
        lv_obj_set_pos(btn, gt_x[i], 2);
        lv_obj_set_size(btn, 64, 34);
        lv_obj_set_style_bg_color(btn, COR_ATIVO, 0);
        lv_obj_set_style_radius(btn, 6, 0);
        lv_obj_t* l = lv_label_create(btn);
        lv_label_set_text(l, g_txt[i]);
        lv_obj_center(l);
        lv_obj_add_event_cb(btn, cb_giro_ajuste, LV_EVENT_CLICKED, (void*)(intptr_t)g_delta[i]);
    }

    // ----- linha 2: TIMEOUT (no 2->1 dispara o fine-homing) -----
    lbl_giro_to = lv_label_create(pnl_giro);
    lv_obj_set_style_text_color(lbl_giro_to, COR_AMARELO, 0);
    lv_obj_set_style_text_font(lbl_giro_to, &lv_font_montserrat_16, 0);
    lv_obj_set_pos(lbl_giro_to, 2, 52);
    static const char*   t_txt[6]   = { "-500", "-100", "-25", "+25", "+100", "+500" };
    static const int32_t t_delta[6] = { -500,   -100,   -25,   25,    100,    500   };
    for (int i = 0; i < 6; i++) {
        lv_obj_t* btn = lv_btn_create(pnl_giro);
        lv_obj_set_pos(btn, gt_x[i], 44);
        lv_obj_set_size(btn, 64, 34);
        lv_obj_set_style_bg_color(btn, COR_ATIVO, 0);
        lv_obj_set_style_radius(btn, 6, 0);
        lv_obj_t* l = lv_label_create(btn);
        lv_label_set_text(l, t_txt[i]);
        lv_obj_center(l);
        lv_obj_add_event_cb(btn, cb_timeout_ajuste, LV_EVENT_CLICKED, (void*)(intptr_t)t_delta[i]);
    }
    tela_auto_atualizar_giro_dur();
    tela_auto_atualizar_giro_to();
    // ---- FIM TEMPORARIO (tuning giro) ----

    // Status do ciclo / mensagem de erro (acima do botao PAUSAR)
    lbl_status_auto = lv_label_create(scr_auto);
    lv_label_set_text(lbl_status_auto, "Selecione o modelo");
    lv_obj_set_style_text_color(lbl_status_auto, COR_TEXTO_FRACO, 0);
    lv_obj_set_style_text_font(lbl_status_auto, &lv_font_montserrat_18, 0);
    lv_obj_set_width(lbl_status_auto, 780);
    lv_obj_set_style_text_align(lbl_status_auto, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(lbl_status_auto, LV_ALIGN_BOTTOM_MID, 0, -95);

    // Linha de diagnostico (sub-estado + sensores) — no rodape
    lbl_diag_auto = lv_label_create(scr_auto);
    lv_label_set_text(lbl_diag_auto, "");
    lv_obj_set_style_text_color(lbl_diag_auto, COR_TEXTO_FRACO, 0);
    lv_obj_set_style_text_font(lbl_diag_auto, &lv_font_montserrat_16, 0);
    lv_obj_align(lbl_diag_auto, LV_ALIGN_BOTTOM_MID, 0, -2);

    // Botao PAUSAR / RETOMAR (abaixo dos 4 programas)
    btn_pausa_auto = lv_btn_create(scr_auto);
    lv_obj_set_size(btn_pausa_auto, 200, 60);
    lv_obj_align(btn_pausa_auto, LV_ALIGN_BOTTOM_MID, 0, -20);
    lv_obj_set_style_bg_color(btn_pausa_auto, lv_color_hex(0xFFD600), 0);
    lv_obj_add_event_cb(btn_pausa_auto, cb_pausa_auto, LV_EVENT_CLICKED, nullptr);

    lbl_pausa_auto = lv_label_create(btn_pausa_auto);
    lv_label_set_text(lbl_pausa_auto, "PAUSAR");
    lv_obj_center(lbl_pausa_auto);

    tela_auto_atualizar_pausa();   // estado inicial (desabilitado no idle)
}

void tela_auto_ativar() {
    // "hoje" reaproveita o contador desde o ultimo acerto — o projeto ainda
    // nao tem RTC/NTP para separar por dia de verdade.
    for (int i = 0; i < 4; i++) {
        lv_label_set_text_fmt(lbl_auto_cnt[i], "Prog %d hoje: %u", i+1, (unsigned)nvs_get_prog(i+1));
    }
    tela_auto_marcar_programa(g_estado.programa_sel);
    tela_auto_atualizar_pausa();
    tela_auto_atualizar_status();
    tela_auto_atualizar_giro_dur();   // TEMPORARIO (tuning giro)
    tela_auto_atualizar_giro_to();    // TEMPORARIO (tuning giro)
    lv_scr_load(scr_auto);
}
