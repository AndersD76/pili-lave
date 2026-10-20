#pragma once
#include <Arduino.h>
#include <lvgl.h>
#include "tipos.h"
#include "nvs_manager.h"

// Autorização (senha de pagamento) já é exigida ANTES de chegar nesta tela
// — ver cb_ir_alterar_senhas() no display.ino, que passa por TELA_SENHA em
// modo PAG antes de navegar para cá.

static lv_obj_t* scr_senhas_cfg = nullptr;
static lv_obj_t* sb_nova_pag    = nullptr;
static lv_obj_t* sb_nova_cfg    = nullptr;

static void (*_cb_senhas_cfg_voltar)() = nullptr;

static void cb_senhas_cfg_salvar(lv_event_t* e) {
    char buf[8];
    snprintf(buf, sizeof(buf), "%04d", (int)lv_spinbox_get_value(sb_nova_pag));
    nvs_set_senha_pag(String(buf));
    snprintf(buf, sizeof(buf), "%04d", (int)lv_spinbox_get_value(sb_nova_cfg));
    nvs_set_senha_cfg(String(buf));
    if (_cb_senhas_cfg_voltar) _cb_senhas_cfg_voltar();
}

static void cb_senhas_cfg_cancelar(lv_event_t* e) {
    if (_cb_senhas_cfg_voltar) _cb_senhas_cfg_voltar();
}

static lv_obj_t* criar_spinbox_senha(lv_obj_t* pai, const char* label, lv_coord_t y) {
    lv_obj_t* lbl = lv_label_create(pai);
    lv_label_set_text(lbl, label);
    lv_obj_set_style_text_color(lbl, COR_TEXTO, 0);
    lv_obj_set_pos(lbl, 10, y + 8);
    lv_obj_set_width(lbl, 260);

    lv_obj_t* sb = lv_spinbox_create(pai);
    lv_spinbox_set_range(sb, 0, 9999);
    lv_spinbox_set_digit_format(sb, 4, 0);
    lv_obj_set_size(sb, 110, 40);
    lv_obj_set_pos(sb, 280, y);
    lv_obj_set_style_bg_color(sb, COR_ATIVO, 0);
    lv_obj_set_style_text_color(sb, COR_TEXTO, 0);
    return sb;
}

void tela_senhas_cfg_criar(void (*cb_voltar)()) {
    _cb_senhas_cfg_voltar = cb_voltar;

    scr_senhas_cfg = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_senhas_cfg, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_senhas_cfg, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t* t = lv_label_create(scr_senhas_cfg);
    lv_label_set_text(t, "ALTERAR SENHAS");
    lv_obj_set_style_text_color(t, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t, &lv_font_montserrat_20, 0);
    lv_obj_set_pos(t, 10, 8);

    sb_nova_pag = criar_spinbox_senha(scr_senhas_cfg, "Nova senha pagamento:", 60);
    sb_nova_cfg = criar_spinbox_senha(scr_senhas_cfg, "Nova senha config:",    110);

    lv_obj_t* btn_salvar = lv_btn_create(scr_senhas_cfg);
    lv_obj_set_size(btn_salvar, 150, 44);
    lv_obj_set_pos(btn_salvar, 10, 180);
    lv_obj_set_style_bg_color(btn_salvar, COR_VERDE, 0);
    lv_obj_t* lbl_s = lv_label_create(btn_salvar);
    lv_label_set_text(lbl_s, "Salvar");
    lv_obj_center(lbl_s);
    lv_obj_add_event_cb(btn_salvar, cb_senhas_cfg_salvar, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* btn_cancelar = lv_btn_create(scr_senhas_cfg);
    lv_obj_set_size(btn_cancelar, 150, 44);
    lv_obj_set_pos(btn_cancelar, 170, 180);
    lv_obj_set_style_bg_color(btn_cancelar, COR_BORDA, 0);
    lv_obj_t* lbl_c = lv_label_create(btn_cancelar);
    lv_label_set_text(lbl_c, "Cancelar");
    lv_obj_center(lbl_c);
    lv_obj_add_event_cb(btn_cancelar, cb_senhas_cfg_cancelar, LV_EVENT_CLICKED, nullptr);
}

void tela_senhas_cfg_ativar() {
    lv_spinbox_set_value(sb_nova_pag, 0);
    lv_spinbox_set_value(sb_nova_cfg, 0);
    lv_scr_load(scr_senhas_cfg);
}
