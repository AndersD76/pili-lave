#pragma once
#include <lvgl.h>
#include "tipos.h"

static lv_obj_t* scr_config = nullptr;

static void (*_cb_config_voltar)()   = nullptr;
static void (*_cb_config_vel)()      = nullptr;
static void (*_cb_config_mod)()      = nullptr;
static void (*_cb_config_senhas)()   = nullptr;
static void (*_cb_config_wifi)()     = nullptr;

// -----------------------------------------------------------------------
// Helper: cria linha de parâmetro com label + spinbox
// -----------------------------------------------------------------------
struct ParamRow {
    lv_obj_t* spinbox;
    uint16_t* valor_ptr;
};

static ParamRow param_rows[12];
static int n_rows = 0;

static ParamRow criar_param(lv_obj_t* pai, const char* nome, uint16_t* ptr,
                             uint16_t min_v, uint16_t max_v,
                             lv_coord_t x, lv_coord_t y) {
    lv_obj_t* lbl = lv_label_create(pai);
    lv_label_set_text(lbl, nome);
    lv_obj_set_style_text_color(lbl, COR_TEXTO, 0);
    lv_obj_set_pos(lbl, x, y + 6);
    lv_obj_set_width(lbl, 220);

    lv_obj_t* sb = lv_spinbox_create(pai);
    lv_spinbox_set_range(sb, min_v, max_v);
    lv_spinbox_set_value(sb, *ptr);
    lv_spinbox_set_digit_format(sb, 4, 0);
    lv_obj_set_size(sb, 100, 36);
    lv_obj_set_pos(sb, x + 225, y);
    lv_obj_set_style_bg_color(sb, COR_ATIVO, 0);
    lv_obj_set_style_text_color(sb, COR_TEXTO, 0);

    // Botões + e -
    lv_obj_t* btn_p = lv_btn_create(pai);
    lv_obj_set_size(btn_p, 36, 36);
    lv_obj_set_pos(btn_p, x + 330, y);
    lv_obj_set_style_bg_color(btn_p, COR_VERDE, 0);
    lv_obj_t* l1 = lv_label_create(btn_p);
    lv_label_set_text(l1, LV_SYMBOL_PLUS);
    lv_obj_center(l1);
    lv_obj_add_event_cb(btn_p, [](lv_event_t* e) {
        lv_obj_t* sb_ptr = (lv_obj_t*)lv_event_get_user_data(e);
        lv_spinbox_increment(sb_ptr);
    }, LV_EVENT_CLICKED, sb);

    lv_obj_t* btn_m = lv_btn_create(pai);
    lv_obj_set_size(btn_m, 36, 36);
    lv_obj_set_pos(btn_m, x + 370, y);
    lv_obj_set_style_bg_color(btn_m, COR_DESTAQUE, 0);
    lv_obj_t* l2 = lv_label_create(btn_m);
    lv_label_set_text(l2, LV_SYMBOL_MINUS);
    lv_obj_center(l2);
    lv_obj_add_event_cb(btn_m, [](lv_event_t* e) {
        lv_obj_t* sb_ptr = (lv_obj_t*)lv_event_get_user_data(e);
        lv_spinbox_decrement(sb_ptr);
    }, LV_EVENT_CLICKED, sb);

    return { sb, ptr };
}

// -----------------------------------------------------------------------
// Salvar valores dos spinboxes na struct de config
// -----------------------------------------------------------------------
static void salvar_config() {
    for (int i = 0; i < n_rows; i++) {
        *param_rows[i].valor_ptr = (uint16_t)lv_spinbox_get_value(param_rows[i].spinbox);
    }
}

// -----------------------------------------------------------------------
// Callbacks
// -----------------------------------------------------------------------
static void cb_cfg_voltar(lv_event_t* e) {
    salvar_config();
    if (_cb_config_voltar) _cb_config_voltar();
}
static void cb_cfg_velocidades(lv_event_t* e) {
    salvar_config();
    if (_cb_config_vel) _cb_config_vel();
}
static void cb_cfg_modelos(lv_event_t* e) {
    salvar_config();
    if (_cb_config_mod) _cb_config_mod();
}
static void cb_cfg_senhas(lv_event_t* e) {
    salvar_config();
    if (_cb_config_senhas) _cb_config_senhas();
}
static void cb_cfg_wifi(lv_event_t* e) {
    salvar_config();
    if (_cb_config_wifi) _cb_config_wifi();
}

// -----------------------------------------------------------------------
// Criação da tela
// -----------------------------------------------------------------------
void tela_config_criar(void (*cb_voltar)(), void (*cb_vel)(), void (*cb_mod)(), void (*cb_senhas)()) {
    _cb_config_voltar = cb_voltar;
    _cb_config_vel    = cb_vel;
    _cb_config_mod    = cb_mod;
    _cb_config_senhas = cb_senhas;

    scr_config = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_config, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_config, LV_OBJ_FLAG_SCROLLABLE);

    // Título
    lv_obj_t* t = lv_label_create(scr_config);
    lv_label_set_text(t, LV_SYMBOL_SETTINGS " CONFIGURAÇÕES");
    lv_obj_set_style_text_color(t, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t, &lv_font_montserrat_20, 0);
    lv_obj_set_pos(t, 10, 8);

    // Coluna esquerda (x=10)
    n_rows = 0;
    param_rows[n_rows++] = criar_param(scr_config, "Atraso inicialização (s)",     &g_config.atraso_init,        0, 30,    10, 48);
    param_rows[n_rows++] = criar_param(scr_config, "Tempo Espuma A (s)",           &g_config.tempo_espuma_a,     0, 300,   10, 92);
    param_rows[n_rows++] = criar_param(scr_config, "Tempo Espuma B (s)",           &g_config.tempo_espuma_b,     0, 300,   10, 136);
    param_rows[n_rows++] = criar_param(scr_config, "Tempo Cor Mágica (s)",         &g_config.tempo_cor_magica,   0, 300,   10, 180);
    param_rows[n_rows++] = criar_param(scr_config, "Distância compensação (pulsos)",&g_config.dist_compensacao,  0, 100,   10, 224);
    param_rows[n_rows++] = criar_param(scr_config, "Sobrecarga mainframe (A)",     &g_config.sobrecarga_main,    0, 50,    10, 268);

    // Coluna direita (x=430)
    param_rows[n_rows++] = criar_param(scr_config, "Sobrecarga rotação (A)",       &g_config.sobrecarga_rotacao, 0, 50,   430, 48);
    param_rows[n_rows++] = criar_param(scr_config, "Tempo sobrecarga (s)",         &g_config.tempo_sobrecarga,   0, 300,  430, 92);
    param_rows[n_rows++] = criar_param(scr_config, "Atraso Espuma A (s)",          &g_config.atraso_espuma_a,    0, 300,  430, 136);
    param_rows[n_rows++] = criar_param(scr_config, "Atraso Espuma B (s)",          &g_config.atraso_espuma_b,    0, 300,  430, 180);
    param_rows[n_rows++] = criar_param(scr_config, "Atraso Cor Mágica (s)",        &g_config.atraso_cor_magica,  0, 600,  430, 224);
    param_rows[n_rows++] = criar_param(scr_config, "Atraso spray água (s)",        &g_config.atraso_spray,       0, 300,  430, 268);

    // Linha divisória
    lv_obj_t* linha = lv_obj_create(scr_config);
    lv_obj_set_size(linha, 780, 2);
    lv_obj_set_pos(linha, 10, 316);
    lv_obj_set_style_bg_color(linha, COR_BORDA, 0);
    lv_obj_clear_flag(linha, LV_OBJ_FLAG_SCROLLABLE);

    // Contadores diários
    lv_obj_t* lbl_cnt = lv_label_create(scr_config);
    lv_label_set_text(lbl_cnt, "Contadores diários:");
    lv_obj_set_style_text_color(lbl_cnt, COR_TEXTO_FRACO, 0);
    lv_obj_set_pos(lbl_cnt, 10, 325);

    for (int i = 0; i < 4; i++) {
        char buf[32];
        snprintf(buf, sizeof(buf), "M%d: %lu", i+1, g_contadores[i]);
        lv_obj_t* lc = lv_label_create(scr_config);
        lv_label_set_text(lc, buf);
        lv_obj_set_style_text_color(lc, COR_AMARELO, 0);
        lv_obj_set_pos(lc, 150 + i * 140, 325);
    }

    // Botões de navegação
    lv_obj_t* btn_vel = lv_btn_create(scr_config);
    lv_obj_set_size(btn_vel, 180, 44);
    lv_obj_set_pos(btn_vel, 10, 370);
    lv_obj_set_style_bg_color(btn_vel, COR_ATIVO, 0);
    lv_obj_t* lv1 = lv_label_create(btn_vel);
    lv_label_set_text(lv1, LV_SYMBOL_SETTINGS " Velocidades");
    lv_obj_center(lv1);
    lv_obj_add_event_cb(btn_vel, cb_cfg_velocidades, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* btn_mod = lv_btn_create(scr_config);
    lv_obj_set_size(btn_mod, 180, 44);
    lv_obj_set_pos(btn_mod, 200, 370);
    lv_obj_set_style_bg_color(btn_mod, COR_ATIVO, 0);
    lv_obj_t* lv2 = lv_label_create(btn_mod);
    lv_label_set_text(lv2, LV_SYMBOL_LIST " Config. Modelo");
    lv_obj_center(lv2);
    lv_obj_add_event_cb(btn_mod, cb_cfg_modelos, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* btn_senhas = lv_btn_create(scr_config);
    lv_obj_set_size(btn_senhas, 180, 44);
    lv_obj_set_pos(btn_senhas, 390, 370);
    lv_obj_set_style_bg_color(btn_senhas, COR_ATIVO, 0);
    lv_obj_t* lv4 = lv_label_create(btn_senhas);
    lv_label_set_text(lv4, LV_SYMBOL_KEYBOARD " Alterar Senhas");
    lv_obj_center(lv4);
    lv_obj_add_event_cb(btn_senhas, cb_cfg_senhas, LV_EVENT_CLICKED, nullptr);

    // Botão Wi-Fi (app) — abre a tela de configuracao Wi-Fi
    lv_obj_t* btn_wifi = lv_btn_create(scr_config);
    lv_obj_set_size(btn_wifi, 84, 44);
    lv_obj_set_pos(btn_wifi, 578, 370);
    lv_obj_set_style_bg_color(btn_wifi, COR_ATIVO, 0);
    lv_obj_t* lvw = lv_label_create(btn_wifi);
    lv_label_set_text(lvw, LV_SYMBOL_WIFI);
    lv_obj_center(lvw);
    lv_obj_add_event_cb(btn_wifi, cb_cfg_wifi, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* btn_v = lv_btn_create(scr_config);
    lv_obj_set_size(btn_v, 120, 44);
    lv_obj_set_pos(btn_v, 670, 370);
    lv_obj_set_style_bg_color(btn_v, COR_DESTAQUE, 0);
    lv_obj_t* lv3 = lv_label_create(btn_v);
    lv_label_set_text(lv3, LV_SYMBOL_LEFT " Voltar");
    lv_obj_center(lv3);
    lv_obj_add_event_cb(btn_v, cb_cfg_voltar, LV_EVENT_CLICKED, nullptr);
}

void tela_config_ativar() {
    lv_scr_load(scr_config);
}

// Registra o callback do botao Wi-Fi (chamado no setup, apos as telas criadas)
void tela_config_set_wifi_cb(void (*cb)()) { _cb_config_wifi = cb; }
