#pragma once
#include <Arduino.h>
#include <lvgl.h>
#include "tipos.h"
#include "nvs_manager.h"

#define SENHA_MODO_PAG 0
#define SENHA_MODO_CFG 1

static lv_obj_t* scr_senha         = nullptr;
static lv_obj_t* lbl_senha_display = nullptr;
static lv_obj_t* lbl_senha_erro    = nullptr;

static char _senha_digitada[5] = "";  // até 4 dígitos + '\0'
static uint8_t _senha_modo     = SENHA_MODO_PAG;
static void (*_cb_senha_sucesso)()  = nullptr;
static void (*_cb_senha_cancelar)() = nullptr;
static lv_timer_t* _timer_senha_erro = nullptr;

static void atualiza_display_senha() {
    char buf[16] = "";
    int len = strlen(_senha_digitada);
    for (int i = 0; i < 4; i++) {
        strcat(buf, i < len ? "* " : "_ ");
    }
    lv_label_set_text(lbl_senha_display, buf);
}

static void limpa_senha() {
    _senha_digitada[0] = '\0';
    atualiza_display_senha();
}

static void cb_timer_limpa_erro_senha(lv_timer_t* t) {
    lv_label_set_text(lbl_senha_erro, "");
    limpa_senha();
    _timer_senha_erro = nullptr;
}

static void mostra_erro_senha() {
    lv_label_set_text(lbl_senha_erro, "SENHA INCORRETA");
    if (_timer_senha_erro) lv_timer_del(_timer_senha_erro);
    _timer_senha_erro = lv_timer_create(cb_timer_limpa_erro_senha, 2000, nullptr);
    lv_timer_set_repeat_count(_timer_senha_erro, 1);
}

static void cb_tecla_num(lv_event_t* e) {
    int len = strlen(_senha_digitada);
    if (len >= 4) return;
    char digito = (char)(intptr_t)lv_event_get_user_data(e);
    _senha_digitada[len]   = digito;
    _senha_digitada[len+1] = '\0';
    atualiza_display_senha();
}

static void cb_tecla_del(lv_event_t* e) {
    int len = strlen(_senha_digitada);
    if (len > 0) _senha_digitada[len-1] = '\0';
    atualiza_display_senha();
}

static void cb_tecla_ok(lv_event_t* e) {
    String esperada = (_senha_modo == SENHA_MODO_PAG) ? nvs_get_senha_pag() : nvs_get_senha_cfg();
    if (esperada == String(_senha_digitada)) {
        limpa_senha();
        lv_label_set_text(lbl_senha_erro, "");
        if (_cb_senha_sucesso) _cb_senha_sucesso();
    } else {
        mostra_erro_senha();
    }
}

static void cb_tecla_cancelar(lv_event_t* e) {
    limpa_senha();
    lv_label_set_text(lbl_senha_erro, "");
    if (_cb_senha_cancelar) _cb_senha_cancelar();
}

// Configura o modo (PAG/CFG) e os callbacks ANTES de navegar para esta tela.
void tela_senha_configurar(uint8_t modo, void (*cb_sucesso)(), void (*cb_cancelar)()) {
    _senha_modo         = modo;
    _cb_senha_sucesso   = cb_sucesso;
    _cb_senha_cancelar  = cb_cancelar;
}

void tela_senha_criar() {
    scr_senha = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_senha, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_senha, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t* t = lv_label_create(scr_senha);
    lv_label_set_text(t, "DIGITE A SENHA");
    lv_obj_set_style_text_color(t, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t, &lv_font_montserrat_20, 0);
    lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 20);

    lbl_senha_display = lv_label_create(scr_senha);
    lv_label_set_text(lbl_senha_display, "_ _ _ _");
    lv_obj_set_style_text_font(lbl_senha_display, &lv_font_montserrat_30, 0);
    lv_obj_set_style_text_color(lbl_senha_display, COR_TEXTO, 0);
    lv_obj_align(lbl_senha_display, LV_ALIGN_TOP_MID, 0, 58);

    lbl_senha_erro = lv_label_create(scr_senha);
    lv_label_set_text(lbl_senha_erro, "");
    lv_obj_set_style_text_color(lbl_senha_erro, COR_VERMELHO, 0);
    lv_obj_align(lbl_senha_erro, LV_ALIGN_TOP_MID, 0, 105);

    // Teclado numérico 3x4
    static const char* teclas[12] = { "1","2","3", "4","5","6", "7","8","9", "DEL","0","OK" };
    lv_coord_t kw = 100, kh = 60, gap = 12;
    lv_coord_t total_w = kw*3 + gap*2;
    lv_coord_t x0 = (800 - total_w) / 2;
    lv_coord_t y0 = 150;

    for (int i = 0; i < 12; i++) {
        int row = i / 3, col = i % 3;
        lv_obj_t* btn = lv_btn_create(scr_senha);
        lv_obj_set_size(btn, kw, kh);
        lv_obj_set_pos(btn, x0 + col*(kw+gap), y0 + row*(kh+gap));
        lv_obj_set_style_bg_color(btn, COR_ATIVO, 0);
        lv_obj_set_style_radius(btn, 6, 0);
        lv_obj_t* lbl = lv_label_create(btn);
        lv_label_set_text(lbl, teclas[i]);
        lv_obj_center(lbl);

        if (strcmp(teclas[i], "DEL") == 0) {
            lv_obj_set_style_bg_color(btn, COR_DESTAQUE, 0);
            lv_obj_add_event_cb(btn, cb_tecla_del, LV_EVENT_CLICKED, nullptr);
        } else if (strcmp(teclas[i], "OK") == 0) {
            lv_obj_set_style_bg_color(btn, COR_VERDE, 0);
            lv_obj_add_event_cb(btn, cb_tecla_ok, LV_EVENT_CLICKED, nullptr);
        } else {
            lv_obj_add_event_cb(btn, cb_tecla_num, LV_EVENT_CLICKED, (void*)(intptr_t)teclas[i][0]);
        }
    }

    lv_obj_t* btn_cancelar = lv_btn_create(scr_senha);
    lv_obj_set_size(btn_cancelar, 150, 44);
    lv_obj_align(btn_cancelar, LV_ALIGN_BOTTOM_MID, 0, -15);
    lv_obj_set_style_bg_color(btn_cancelar, COR_BORDA, 0);
    lv_obj_t* lbl_c = lv_label_create(btn_cancelar);
    lv_label_set_text(lbl_c, "CANCELAR");
    lv_obj_center(lbl_c);
    lv_obj_add_event_cb(btn_cancelar, cb_tecla_cancelar, LV_EVENT_CLICKED, nullptr);
}

void tela_senha_ativar() {
    limpa_senha();
    lv_label_set_text(lbl_senha_erro, "");
    lv_scr_load(scr_senha);
}
