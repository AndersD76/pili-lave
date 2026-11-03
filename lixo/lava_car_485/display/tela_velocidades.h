#pragma once
#include <lvgl.h>
#include "tipos.h"

static lv_obj_t* scr_vel     = nullptr;
static lv_obj_t* tab_vel     = nullptr;
static void (*_cb_vel_voltar)() = nullptr;

// Spinboxes [programa][etapa]
static lv_obj_t* sb_vel[4][NUM_ETAPAS];

// -----------------------------------------------------------------------
// Cria aba de um programa com todos os spinboxes de etapa
// -----------------------------------------------------------------------
static void criar_aba_programa(lv_obj_t* tab_content, int prog) {
    for (int e = 0; e < NUM_ETAPAS; e++) {
        int row = e % 6;
        int col = e / 6;
        lv_coord_t x = 10 + col * 390;
        lv_coord_t y = 10 + row * 58;

        lv_obj_t* lbl = lv_label_create(tab_content);
        lv_label_set_text(lbl, NOMES_ETAPA[e]);
        lv_obj_set_style_text_color(lbl, COR_TEXTO, 0);
        lv_obj_set_pos(lbl, x, y + 8);
        lv_obj_set_width(lbl, 200);

        lv_obj_t* sb = lv_spinbox_create(tab_content);
        lv_spinbox_set_range(sb, 50, 600);   // 5 a 60 Hz (em 0.1Hz)
        lv_spinbox_set_step(sb, 5);
        lv_spinbox_set_value(sb, g_velocidades[prog][e]);
        lv_spinbox_set_digit_format(sb, 3, 0);
        lv_obj_set_size(sb, 90, 36);
        lv_obj_set_pos(sb, x + 205, y);
        lv_obj_set_style_bg_color(sb, COR_ATIVO, 0);
        lv_obj_set_style_text_color(sb, COR_AMARELO, 0);
        sb_vel[prog][e] = sb;

        lv_obj_t* lbl_hz = lv_label_create(tab_content);
        lv_label_set_text(lbl_hz, "Hz");
        lv_obj_set_style_text_color(lbl_hz, COR_TEXTO_FRACO, 0);
        lv_obj_set_pos(lbl_hz, x + 300, y + 8);

        // Botões + e -
        lv_obj_t* bp = lv_btn_create(tab_content);
        lv_obj_set_size(bp, 32, 36);
        lv_obj_set_pos(bp, x + 318, y);
        lv_obj_set_style_bg_color(bp, COR_VERDE, 0);
        lv_obj_t* lp = lv_label_create(bp);
        lv_label_set_text(lp, "+");
        lv_obj_center(lp);
        lv_obj_add_event_cb(bp, [](lv_event_t* e2) {
            lv_spinbox_increment((lv_obj_t*)lv_event_get_user_data(e2));
        }, LV_EVENT_CLICKED, sb);

        lv_obj_t* bm = lv_btn_create(tab_content);
        lv_obj_set_size(bm, 32, 36);
        lv_obj_set_pos(bm, x + 354, y);
        lv_obj_set_style_bg_color(bm, COR_DESTAQUE, 0);
        lv_obj_t* lm = lv_label_create(bm);
        lv_label_set_text(lm, "-");
        lv_obj_center(lm);
        lv_obj_add_event_cb(bm, [](lv_event_t* e2) {
            lv_spinbox_decrement((lv_obj_t*)lv_event_get_user_data(e2));
        }, LV_EVENT_CLICKED, sb);
    }
}

// -----------------------------------------------------------------------
// Salva velocidades
// -----------------------------------------------------------------------
static void salvar_velocidades() {
    for (int p = 0; p < 4; p++)
        for (int e = 0; e < NUM_ETAPAS; e++)
            g_velocidades[p][e] = (uint16_t)lv_spinbox_get_value(sb_vel[p][e]);
    nvs_save_velocidades(g_velocidades, sizeof(g_velocidades));   // persiste na NVS
}

// -----------------------------------------------------------------------
// Callbacks
// -----------------------------------------------------------------------
static void cb_vel_voltar(lv_event_t* ev) {
    salvar_velocidades();
    if (_cb_vel_voltar) _cb_vel_voltar();
}

// -----------------------------------------------------------------------
// Criação da tela
// -----------------------------------------------------------------------
void tela_velocidades_criar(void (*cb_voltar)()) {
    _cb_vel_voltar = cb_voltar;

    scr_vel = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_vel, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_vel, LV_OBJ_FLAG_SCROLLABLE);

    // Título
    lv_obj_t* t = lv_label_create(scr_vel);
    lv_label_set_text(t, LV_SYMBOL_SETTINGS " VELOCIDADES POR ETAPA (Hz)");
    lv_obj_set_style_text_color(t, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t, &lv_font_montserrat_18, 0);
    lv_obj_set_pos(t, 10, 5);

    // Tabs para cada programa
    tab_vel = lv_tabview_create(scr_vel, LV_DIR_TOP, 40);
    lv_obj_set_size(tab_vel, 800, 390);
    lv_obj_set_pos(tab_vel, 0, 35);
    lv_obj_set_style_bg_color(tab_vel, COR_PAINEL, 0);

    const char* nomes_prog[4] = { "Modelo 1", "Modelo 2", "Modelo 3", "Modelo 4" };
    for (int p = 0; p < 4; p++) {
        lv_obj_t* tab = lv_tabview_add_tab(tab_vel, nomes_prog[p]);
        lv_obj_set_style_bg_color(tab, COR_PAINEL, 0);
        criar_aba_programa(tab, p);
    }

    // Botão voltar
    lv_obj_t* btn_v = lv_btn_create(scr_vel);
    lv_obj_set_size(btn_v, 120, 40);
    lv_obj_set_pos(btn_v, 670, 432);
    lv_obj_set_style_bg_color(btn_v, COR_DESTAQUE, 0);
    lv_obj_t* lv1 = lv_label_create(btn_v);
    lv_label_set_text(lv1, LV_SYMBOL_LEFT " Voltar");
    lv_obj_center(lv1);
    lv_obj_add_event_cb(btn_v, cb_vel_voltar, LV_EVENT_CLICKED, nullptr);
}

void tela_velocidades_ativar() {
    lv_scr_load(scr_vel);
}
