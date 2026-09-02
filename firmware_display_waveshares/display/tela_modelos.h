#pragma once
#include <lvgl.h>
#include "tipos.h"

static lv_obj_t* scr_mod      = nullptr;
static lv_obj_t* tab_mod      = nullptr;
static void (*_cb_mod_voltar)() = nullptr;

// Dropdowns [modelo][slot]
static lv_obj_t* dd_proc[4][NUM_SLOTS];

// -----------------------------------------------------------------------
// Gera string de opções para o dropdown
// -----------------------------------------------------------------------
static const char* OPCOES_PROC =
    "---\n"
    "Pré-lavagem\n"
    "Spray de água\n"
    "Espuma A\n"
    "Espuma B\n"
    "Cor Mágica\n"
    "Cera de água\n"
    "Alta pressão\n"
    "Secagem ao ar\n"
    "Enxágue\n"
    "FIM";

// -----------------------------------------------------------------------
// Callback do dropdown — bloqueia slots após FIM
// -----------------------------------------------------------------------
static void cb_dropdown_changed(lv_event_t* e) {
    // user_data: (modelo << 4) | slot
    uint8_t data  = (uint8_t)(intptr_t)lv_event_get_user_data(e);
    uint8_t model = (data >> 4) & 0x0F;
    uint8_t slot  = data & 0x0F;

    uint8_t val = (uint8_t)lv_dropdown_get_selected((lv_obj_t*)lv_event_get_target(e));
    g_modelos[model][slot] = val;

    // Propaga: bloqueia slots após FIM
    bool fim_encontrado = false;
    for (int s = 0; s < NUM_SLOTS; s++) {
        if (fim_encontrado) {
            lv_dropdown_set_selected(dd_proc[model][s], PROC_FIM);
            g_modelos[model][s] = PROC_FIM;
            lv_obj_add_state(dd_proc[model][s], LV_STATE_DISABLED);
        } else {
            lv_obj_clear_state(dd_proc[model][s], LV_STATE_DISABLED);
        }
        if (g_modelos[model][s] == PROC_FIM) fim_encontrado = true;
    }

    // Slot 9 (posição 10) sempre FIM
    lv_dropdown_set_selected(dd_proc[model][NUM_SLOTS-1], PROC_FIM);
    g_modelos[model][NUM_SLOTS-1] = PROC_FIM;
    lv_obj_add_state(dd_proc[model][NUM_SLOTS-1], LV_STATE_DISABLED);

    nvs_save_modelos(g_modelos, sizeof(g_modelos));   // persiste na NVS a cada alteracao
}

// -----------------------------------------------------------------------
// Cria aba de um modelo
// -----------------------------------------------------------------------
static void criar_aba_modelo(lv_obj_t* tab_content, int modelo) {
    for (int s = 0; s < NUM_SLOTS; s++) {
        int col = s / 5;
        int row = s % 5;
        lv_coord_t x = 10 + col * 390;
        lv_coord_t y = 10 + row * 68;

        // Label slot
        char buf[16];
        snprintf(buf, sizeof(buf), "Etapa %d:", s + 1);
        lv_obj_t* lbl = lv_label_create(tab_content);
        lv_label_set_text(lbl, buf);
        lv_obj_set_style_text_color(lbl, COR_TEXTO_FRACO, 0);
        lv_obj_set_pos(lbl, x, y + 10);

        lv_obj_t* dd = lv_dropdown_create(tab_content);
        lv_dropdown_set_options(dd, OPCOES_PROC);
        lv_dropdown_set_selected(dd, g_modelos[modelo][s]);
        lv_obj_set_size(dd, 240, 44);
        lv_obj_set_pos(dd, x + 80, y);
        lv_obj_set_style_bg_color(dd, COR_ATIVO, 0);
        lv_obj_set_style_text_color(dd, COR_TEXTO, 0);

        // Ajusta cor do slot FIM
        if (g_modelos[modelo][s] == PROC_FIM) {
            lv_obj_set_style_bg_color(dd, COR_PAINEL, 0);
            lv_obj_set_style_text_color(dd, COR_TEXTO_FRACO, 0);
        }

        dd_proc[modelo][s] = dd;
        lv_obj_add_event_cb(dd, cb_dropdown_changed, LV_EVENT_VALUE_CHANGED,
                            (void*)(intptr_t)((modelo << 4) | s));
    }

    // Bloqueia slots já após FIM na carga inicial
    bool fim = false;
    for (int s = 0; s < NUM_SLOTS; s++) {
        if (fim) {
            lv_obj_add_state(dd_proc[modelo][s], LV_STATE_DISABLED);
        }
        if (g_modelos[modelo][s] == PROC_FIM) fim = true;
    }
    // Último sempre bloqueado
    lv_obj_add_state(dd_proc[modelo][NUM_SLOTS-1], LV_STATE_DISABLED);
}

// -----------------------------------------------------------------------
// Callbacks
// -----------------------------------------------------------------------
static void cb_mod_voltar(lv_event_t* ev) {
    if (_cb_mod_voltar) _cb_mod_voltar();
}

// -----------------------------------------------------------------------
// Criação da tela
// -----------------------------------------------------------------------
void tela_modelos_criar(void (*cb_voltar)()) {
    _cb_mod_voltar = cb_voltar;

    scr_mod = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_mod, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_mod, LV_OBJ_FLAG_SCROLLABLE);

    // Título
    lv_obj_t* t = lv_label_create(scr_mod);
    lv_label_set_text(t, LV_SYMBOL_LIST " CONFIGURAÇÃO DE MODELOS");
    lv_obj_set_style_text_color(t, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t, &lv_font_montserrat_18, 0);
    lv_obj_set_pos(t, 10, 5);

    // Tabs por modelo
    tab_mod = lv_tabview_create(scr_mod, LV_DIR_TOP, 44);
    lv_obj_set_size(tab_mod, 800, 390);
    lv_obj_set_pos(tab_mod, 0, 35);
    lv_obj_set_style_bg_color(tab_mod, COR_PAINEL, 0);

    const char* nomes[4] = { "Modelo 1", "Modelo 2", "Modelo 3", "Modelo 4" };
    for (int m = 0; m < 4; m++) {
        lv_obj_t* tab = lv_tabview_add_tab(tab_mod, nomes[m]);
        lv_obj_set_style_bg_color(tab, COR_PAINEL, 0);
        criar_aba_modelo(tab, m);
    }

    // Nota informativa
    lv_obj_t* lbl_nota = lv_label_create(scr_mod);
    lv_label_set_text(lbl_nota, LV_SYMBOL_WARNING " FIM encerra a sequência. Etapa 10 é sempre FIM.");
    lv_obj_set_style_text_color(lbl_nota, COR_AMARELO, 0);
    lv_obj_set_pos(lbl_nota, 10, 432);

    // Botão voltar
    lv_obj_t* btn_v = lv_btn_create(scr_mod);
    lv_obj_set_size(btn_v, 120, 40);
    lv_obj_set_pos(btn_v, 670, 432);
    lv_obj_set_style_bg_color(btn_v, COR_DESTAQUE, 0);
    lv_obj_t* lv1 = lv_label_create(btn_v);
    lv_label_set_text(lv1, LV_SYMBOL_LEFT " Voltar");
    lv_obj_center(lv1);
    lv_obj_add_event_cb(btn_v, cb_mod_voltar, LV_EVENT_CLICKED, nullptr);
}

void tela_modelos_ativar() {
    lv_scr_load(scr_mod);
}
