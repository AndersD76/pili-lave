#pragma once
#include <lvgl.h>
#include "tipos.h"
#include "comm_espnow.h"
#include "nvs_manager.h"

// -----------------------------------------------------------------------
// Objetos LVGL
// -----------------------------------------------------------------------
static lv_obj_t* scr_manual        = nullptr;
static lv_obj_t* lbl_titulo        = nullptr;
static lv_obj_t* lbl_processo      = nullptr;
static lv_obj_t* lbl_corrente      = nullptr;
static lv_obj_t* lbl_freq          = nullptr;
static lv_obj_t* btn_ma            = nullptr;
static lv_obj_t* btn_iniciar       = nullptr;
static lv_obj_t* btn_pausa         = nullptr;
static lv_obj_t* btn_valvula       = nullptr;
static lv_obj_t* btn_sol_esp_a     = nullptr;
static lv_obj_t* btn_sol_esp_b     = nullptr;
static lv_obj_t* btn_sol_cm        = nullptr;
static lv_obj_t* btn_secagem       = nullptr;
static lv_obj_t* btn_bomba         = nullptr;
static lv_obj_t* btn_cera          = nullptr;
static lv_obj_t* btn_carr_fwd      = nullptr;
static lv_obj_t* btn_carr_rev      = nullptr;
static lv_obj_t* btn_braco_fwd     = nullptr;
static lv_obj_t* btn_braco_rev     = nullptr;
static lv_obj_t* btn_config        = nullptr;
static lv_obj_t* btn_pagamento     = nullptr;
static lv_obj_t* btn_home          = nullptr;
static lv_obj_t* lbl_home          = nullptr;
static lv_obj_t* lbl_alarme        = nullptr;
static lv_obj_t* lbl_desde         = nullptr;
static lv_obj_t* lbl_prog_cnt[4]   = {};
static lv_obj_t* lbl_horas         = nullptr;
static lv_obj_t* lbl_saldo         = nullptr;
static lv_obj_t* lbl_diag_man      = nullptr;   // diagnostico das 16 entradas (mapear sensores)

// Callbacks de navegação (definidos em display.ino)
static void (*_cb_config)()    = nullptr;
static void (*_cb_auto)()      = nullptr;
static void (*_cb_pagamento)() = nullptr;

// -----------------------------------------------------------------------
// Helpers de estilo
// -----------------------------------------------------------------------
static lv_style_t sty_btn_normal;
static lv_style_t sty_btn_ativo;
static lv_style_t sty_btn_perigo;
static bool        estilos_criados = false;

static void criar_estilos() {
    if (estilos_criados) return;
    estilos_criados = true;

    lv_style_init(&sty_btn_normal);
    lv_style_set_bg_color(&sty_btn_normal, COR_ATIVO);
    lv_style_set_text_color(&sty_btn_normal, COR_TEXTO);
    lv_style_set_border_color(&sty_btn_normal, COR_BORDA);
    lv_style_set_border_width(&sty_btn_normal, 1);
    lv_style_set_radius(&sty_btn_normal, 6);

    lv_style_init(&sty_btn_ativo);
    lv_style_set_bg_color(&sty_btn_ativo, COR_VERDE);
    lv_style_set_text_color(&sty_btn_ativo, lv_color_hex(0x000000));
    lv_style_set_border_color(&sty_btn_ativo, COR_VERDE);
    lv_style_set_border_width(&sty_btn_ativo, 2);
    lv_style_set_radius(&sty_btn_ativo, 6);

    lv_style_init(&sty_btn_perigo);
    lv_style_set_bg_color(&sty_btn_perigo, COR_DESTAQUE);
    lv_style_set_text_color(&sty_btn_perigo, COR_TEXTO);
    lv_style_set_border_color(&sty_btn_perigo, COR_DESTAQUE);
    lv_style_set_border_width(&sty_btn_perigo, 2);
    lv_style_set_radius(&sty_btn_perigo, 6);
}

static lv_obj_t* criar_btn(lv_obj_t* pai, const char* texto, lv_coord_t x, lv_coord_t y, lv_coord_t w, lv_coord_t h) {
    lv_obj_t* btn = lv_btn_create(pai);
    lv_obj_set_pos(btn, x, y);
    lv_obj_set_size(btn, w, h);
    lv_obj_add_style(btn, &sty_btn_normal, 0);
    lv_obj_t* lbl = lv_label_create(btn);
    lv_label_set_text(lbl, texto);
    lv_obj_center(lbl);
    return btn;
}

static void btn_set_ativo(lv_obj_t* btn, bool ativo) {
    lv_obj_remove_style(btn, &sty_btn_normal, 0);
    lv_obj_remove_style(btn, &sty_btn_ativo, 0);
    if (ativo) lv_obj_add_style(btn, &sty_btn_ativo, 0);
    else       lv_obj_add_style(btn, &sty_btn_normal, 0);
    lv_obj_invalidate(btn);
}

// -----------------------------------------------------------------------
// Modo manual/automático — INICIAR e PAUSA só ficam ativos em modo AUTO
// -----------------------------------------------------------------------
static void atualizar_controles_modo() {
    btn_set_ativo(btn_ma, g_estado.modo_auto);
    if (g_estado.modo_auto) {
        lv_obj_clear_state(btn_iniciar, LV_STATE_DISABLED);
        lv_obj_clear_state(btn_pausa,   LV_STATE_DISABLED);
    } else {
        lv_obj_add_state(btn_iniciar, LV_STATE_DISABLED);
        lv_obj_add_state(btn_pausa,   LV_STATE_DISABLED);
    }
}

// -----------------------------------------------------------------------
// Callbacks dos botões
// -----------------------------------------------------------------------
static void cb_btn_ma(lv_event_t* e) {
    g_estado.modo_auto = !g_estado.modo_auto;
    atualizar_controles_modo();
    if (g_estado.modo_auto) {
        if (_cb_auto) _cb_auto();   // abre TELA_AUTO para escolher o programa
    }
}

static void cb_btn_iniciar(lv_event_t* e) {
    // Dispara o ciclo automatico do modelo selecionado (so quando ocioso)
    if (g_estado.modo_auto && g_estado_auto == AUTO_IDLE) {
        auto_iniciar(g_estado.programa_sel);
    }
}

static void cb_btn_pausa(lv_event_t* e) {
    // Alterna pausar/retomar o ciclo automatico
    if (g_estado_auto == AUTO_PROCESSO)      auto_pausar();
    else if (g_estado_auto == AUTO_PAUSADO)  auto_retomar();
    btn_set_ativo(btn_pausa, g_estado.em_pausa);
}

// -----------------------------------------------------------------------
// Saídas manuais — toggle simples (liga/desliga um único canal)
// -----------------------------------------------------------------------
static void cb_toggle_valvula(lv_event_t* e) {
    static bool ativo = false;
    ativo = !ativo;
    io1_set_do(6, ativo);  // Y6
    btn_set_ativo(btn_valvula, ativo);
}

static void cb_toggle_cor_magica(lv_event_t* e) {
    static bool ativo = false;
    ativo = !ativo;
    io1_set_do(1, ativo);  // Y1
    io2_set_do(6, ativo);  // Y0 (DO6 waveshare2) — aciona JUNTO com a Cor Magica
    btn_set_ativo(btn_sol_cm, ativo);
}

static void cb_toggle_secagem(lv_event_t* e) {
    static bool ativo = false;
    ativo = !ativo;
    io1_set_do(5, ativo);  // Y5 — compressor secagem
    btn_set_ativo(btn_secagem, ativo);
}

static void cb_toggle_bomba(lv_event_t* e) {
    static bool ativo = false;
    ativo = !ativo;
    io2_set_do(3, ativo);  // Y13 = W2 DO3 (bomba alta pressão / "bomba de água")
    btn_set_ativo(btn_bomba, ativo);
}

// -----------------------------------------------------------------------
// Y7 (bomba de espuma) é compartilhada entre Espuma A, Espuma B e Cera de
// água — fica ligada se QUALQUER um dos três estiver ativo, e só desliga
// quando os três estiverem desligados (senão desligar um mataria a bomba
// que os outros ainda estão usando).
// -----------------------------------------------------------------------
static bool _ativo_espuma_a = false;
static bool _ativo_espuma_b = false;
static bool _ativo_cera     = false;

static void atualiza_bomba_espuma() {
    io1_set_do(7, _ativo_espuma_a || _ativo_espuma_b || _ativo_cera);  // Y7
}

static void cb_toggle_espuma_a(lv_event_t* e) {
    _ativo_espuma_a = !_ativo_espuma_a;
    io1_set_do(2, _ativo_espuma_a);  // Y2
    atualiza_bomba_espuma();
    btn_set_ativo(btn_sol_esp_a, _ativo_espuma_a);
}

static void cb_toggle_espuma_b(lv_event_t* e) {
    _ativo_espuma_b = !_ativo_espuma_b;
    io1_set_do(3, _ativo_espuma_b);  // Y3
    atualiza_bomba_espuma();
    btn_set_ativo(btn_sol_esp_b, _ativo_espuma_b);
}

static void cb_toggle_cera(lv_event_t* e) {
    _ativo_cera = !_ativo_cera;
    io2_set_do(1, _ativo_cera);      // Y10 = W2 DO1
    atualiza_bomba_espuma();
    btn_set_ativo(btn_cera, _ativo_cera);
}

// Carrinho (deslocamento) — pressionar e soltar.
// Espelha o braço: engata o contator Y14 (deslocamento) ANTES de rodar o VFD,
// e ao soltar para o VFD ANTES de desligar o Y14 (não abrir contator sob carga).
// A trava de segurança em io2_set_do bloqueia Y14 se o Y4 (giro) estiver ativo.
static void cb_carr_fwd_press(lv_event_t* e) {
    // FRENTE (sentido A) — engata Y14, roda, e PARA sozinho no fim de curso X13
    desloc_frente_iniciar(g_velocidades[g_estado.programa_sel-1][0]);
}
static void cb_carr_fwd_rel(lv_event_t* e)  { desloc_parar(); }
static void cb_carr_rev_press(lv_event_t* e) {
    // TRAS (sentido B) — engata Y14, roda, e PARA sozinho no fim de curso X12
    desloc_tras_iniciar(g_velocidades[g_estado.programa_sel-1][0]);
}
static void cb_carr_rev_rel(lv_event_t* e)  { desloc_parar(); }

// Braço — pressionar e soltar
static void cb_braco_fwd_press(lv_event_t* e) {
    io1_set_do(4, true);   // Y4 giro sentido A
    vfd_run_fwd(g_velocidades[g_estado.programa_sel-1][3]);  // freq giro espuma A
}
static void cb_braco_fwd_rel(lv_event_t* e) {
    vfd_stop();
    io1_set_do(4, false);
}
static void cb_braco_rev_press(lv_event_t* e) {
    io1_set_do(4, true);
    vfd_run_rev(g_velocidades[g_estado.programa_sel-1][3]);
}
static void cb_braco_rev_rel(lv_event_t* e) {
    vfd_stop();
    io1_set_do(4, false);
}

static void cb_btn_config(lv_event_t* e) {
    if (_cb_config) _cb_config();
}

// HOME — inicia o referenciamento automatico (giro ate HOME_GIRO, depois
// deslocamento pra tras ate X12). Se ja estiver rodando, o mesmo botao ABORTA.
static void cb_btn_home(lv_event_t* e) {
    home_iniciar();
}

static void cb_btn_pagamento(lv_event_t* e) {
    if (_cb_pagamento) _cb_pagamento();
}

// -----------------------------------------------------------------------
// Atualiza os contadores do rodapé (chamado na ativação da tela e depois
// de um acerto de contas)
// -----------------------------------------------------------------------
void tela_manual_atualizar_contadores() {
    lv_label_set_text_fmt(lbl_desde, "Desde %s:", nvs_get_data_acerto().c_str());
    for (int i = 0; i < 4; i++) {
        lv_label_set_text_fmt(lbl_prog_cnt[i], "Prog %d: %u lavagens", i+1, (unsigned)nvs_get_prog(i+1));
    }
    lv_label_set_text_fmt(lbl_horas, "Horas no manual: %.1f h", g_horas_manual);
    lv_label_set_text_fmt(lbl_saldo, "Saldo historico: %u lavagens", (unsigned)nvs_get_saldo());
}

// -----------------------------------------------------------------------
// Criação da tela — layout 800x480 landscape
// -----------------------------------------------------------------------
void tela_manual_criar(void (*cb_config)(), void (*cb_auto)(), void (*cb_pagamento)()) {
    _cb_config    = cb_config;
    _cb_auto      = cb_auto;
    _cb_pagamento = cb_pagamento;
    criar_estilos();

    scr_manual = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_manual, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_manual, LV_OBJ_FLAG_SCROLLABLE);

    // ═══════════════════════════════════════════════════════════════════
    // BLOCO ESQUERDO (x=0 a 440)
    // ═══════════════════════════════════════════════════════════════════

    // --- Topo (y=0 a 55): barra de status ---
    lbl_titulo = lv_label_create(scr_manual);
    lv_label_set_text(lbl_titulo, "OPERACAO MANUAL");
    lv_obj_set_style_text_color(lbl_titulo, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(lbl_titulo, &lv_font_montserrat_18, 0);
    lv_obj_set_pos(lbl_titulo, 10, 8);

    lbl_processo = lv_label_create(scr_manual);
    lv_label_set_text(lbl_processo, "Processo: ---");
    lv_obj_set_style_text_color(lbl_processo, COR_TEXTO, 0);
    lv_obj_set_pos(lbl_processo, 10, 32);

    lbl_freq = lv_label_create(scr_manual);
    lv_label_set_text(lbl_freq, "VFD: 0.0 Hz");
    lv_obj_set_style_text_color(lbl_freq, COR_AMARELO, 0);
    lv_obj_set_pos(lbl_freq, 280, 32);

    lbl_corrente = lv_label_create(scr_manual);
    lv_label_set_text(lbl_corrente, "0.0 A");
    lv_obj_set_style_text_color(lbl_corrente, COR_AMARELO, 0);
    lv_obj_set_pos(lbl_corrente, 380, 32);

    // --- Linha 1 (y=62, h=52): M/A + Iniciar + Pausa ---
    btn_ma = criar_btn(scr_manual, "M/A", 10, 62, 110, 52);
    lv_obj_add_event_cb(btn_ma, cb_btn_ma, LV_EVENT_CLICKED, nullptr);

    btn_iniciar = criar_btn(scr_manual, "INICIAR", 128, 62, 145, 52);
    lv_obj_set_style_bg_color(btn_iniciar, COR_VERDE, 0);
    lv_obj_set_style_text_color(btn_iniciar, lv_color_hex(0x000000), 0);
    lv_obj_add_event_cb(btn_iniciar, cb_btn_iniciar, LV_EVENT_CLICKED, nullptr);

    btn_pausa = criar_btn(scr_manual, "PAUSA", 281, 62, 145, 52);
    lv_obj_add_event_cb(btn_pausa, cb_btn_pausa, LV_EVENT_CLICKED, nullptr);

    // --- Linha 2 (y=122, h=52): processo manual (toggle) ---
    btn_valvula = criar_btn(scr_manual, "Valvula", 10, 122, 100, 52);
    lv_obj_add_event_cb(btn_valvula, cb_toggle_valvula, LV_EVENT_CLICKED, nullptr);

    btn_sol_esp_a = criar_btn(scr_manual, "Espuma A", 118, 122, 100, 52);
    lv_obj_add_event_cb(btn_sol_esp_a, cb_toggle_espuma_a, LV_EVENT_CLICKED, nullptr);

    btn_sol_esp_b = criar_btn(scr_manual, "Espuma B", 226, 122, 100, 52);
    lv_obj_add_event_cb(btn_sol_esp_b, cb_toggle_espuma_b, LV_EVENT_CLICKED, nullptr);

    btn_sol_cm = criar_btn(scr_manual, "Cor Magica", 334, 122, 100, 52);
    lv_obj_add_event_cb(btn_sol_cm, cb_toggle_cor_magica, LV_EVENT_CLICKED, nullptr);

    // --- Linha 3 (y=182, h=52) ---
    btn_secagem = criar_btn(scr_manual, "Secagem de ar", 10, 182, 130, 52);
    lv_obj_add_event_cb(btn_secagem, cb_toggle_secagem, LV_EVENT_CLICKED, nullptr);

    btn_bomba = criar_btn(scr_manual, "Bomba de agua", 148, 182, 130, 52);
    lv_obj_add_event_cb(btn_bomba, cb_toggle_bomba, LV_EVENT_CLICKED, nullptr);

    btn_cera = criar_btn(scr_manual, "Cera de agua", 286, 182, 130, 52);
    lv_obj_add_event_cb(btn_cera, cb_toggle_cera, LV_EVENT_CLICKED, nullptr);

    // --- Rodapé contadores (y=245 a 390) ---
    lv_obj_t* painel = lv_obj_create(scr_manual);
    lv_obj_set_pos(painel, 10, 245);
    lv_obj_set_size(painel, 420, 170);
    lv_obj_set_style_bg_color(painel, COR_PAINEL, 0);
    lv_obj_set_style_border_color(painel, COR_BORDA, 0);
    lv_obj_set_style_border_width(painel, 1, 0);
    lv_obj_set_style_radius(painel, 8, 0);
    lv_obj_clear_flag(painel, LV_OBJ_FLAG_SCROLLABLE);

    lbl_desde = lv_label_create(painel);
    lv_label_set_text(lbl_desde, "Desde --/--/----:");
    lv_obj_set_style_text_color(lbl_desde, COR_TEXTO_FRACO, 0);
    lv_obj_set_style_text_font(lbl_desde, &lv_font_montserrat_16, 0);
    lv_obj_set_pos(lbl_desde, 10, 8);

    for (int i = 0; i < 4; i++) {
        lbl_prog_cnt[i] = lv_label_create(painel);
        lv_label_set_text_fmt(lbl_prog_cnt[i], "Prog %d: 0 lavagens", i+1);
        lv_obj_set_style_text_color(lbl_prog_cnt[i], COR_TEXTO, 0);
        lv_obj_set_pos(lbl_prog_cnt[i], 10, 30 + i*20);
    }

    lv_obj_t* linha = lv_obj_create(painel);
    lv_obj_set_size(linha, 400, 1);
    lv_obj_set_pos(linha, 10, 108);
    lv_obj_set_style_bg_color(linha, COR_BORDA, 0);
    lv_obj_clear_flag(linha, LV_OBJ_FLAG_SCROLLABLE);

    lbl_horas = lv_label_create(painel);
    lv_label_set_text(lbl_horas, "Horas no manual: 0.0 h");
    lv_obj_set_style_text_color(lbl_horas, COR_TEXTO, 0);
    lv_obj_set_pos(lbl_horas, 10, 114);

    lbl_saldo = lv_label_create(painel);
    lv_label_set_text(lbl_saldo, "Saldo historico: 0 lavagens");
    lv_obj_set_style_text_color(lbl_saldo, COR_AMARELO, 0);
    lv_obj_set_pos(lbl_saldo, 10, 132);

    // Logo abaixo do painel de contadores (painel termina em y=245+170=415)
    btn_pagamento = criar_btn(scr_manual, "Pagamento Efetuado", 220, 422, 200, 38);
    lv_obj_set_style_bg_color(btn_pagamento, COR_DESTAQUE, 0);
    lv_obj_add_event_cb(btn_pagamento, cb_btn_pagamento, LV_EVENT_CLICKED, nullptr);

    // ═══════════════════════════════════════════════════════════════════
    // BLOCO DIREITO (x=450 a 800)
    // ═══════════════════════════════════════════════════════════════════

    // --- Logo (y=0 a 120) ---
    lv_obj_t* logo_fundo = lv_obj_create(scr_manual);
    lv_obj_set_pos(logo_fundo, 450, 0);
    lv_obj_set_size(logo_fundo, 350, 120);
    lv_obj_set_style_bg_color(logo_fundo, lv_color_hex(0x000000), 0);
    lv_obj_set_style_border_width(logo_fundo, 0, 0);
    lv_obj_set_style_radius(logo_fundo, 0, 0);
    lv_obj_clear_flag(logo_fundo, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t* lbl_logo = lv_label_create(logo_fundo);
    lv_label_set_text(lbl_logo, "[ " LV_SYMBOL_HOME " ] PILI");
    lv_obj_set_style_text_color(lbl_logo, COR_TEXTO, 0);
    lv_obj_set_style_text_font(lbl_logo, &lv_font_montserrat_28, 0);
    lv_obj_center(lbl_logo);

    // --- Carrinho (y=128) ---
    lv_obj_t* lbl_carr = lv_label_create(scr_manual);
    lv_label_set_text(lbl_carr, "CARRINHO");
    lv_obj_set_style_text_color(lbl_carr, COR_TEXTO_FRACO, 0);
    lv_obj_set_style_text_font(lbl_carr, &lv_font_montserrat_16, 0);
    lv_obj_set_pos(lbl_carr, 452, 128);

    btn_carr_fwd = criar_btn(scr_manual, ">> FRENTE", 452, 148, 160, 65);
    lv_obj_add_event_cb(btn_carr_fwd, cb_carr_fwd_press, LV_EVENT_PRESSED,  nullptr);
    lv_obj_add_event_cb(btn_carr_fwd, cb_carr_fwd_rel,   LV_EVENT_RELEASED, nullptr);

    btn_carr_rev = criar_btn(scr_manual, "<< TRAS", 622, 148, 160, 65);
    lv_obj_add_event_cb(btn_carr_rev, cb_carr_rev_press, LV_EVENT_PRESSED,  nullptr);
    lv_obj_add_event_cb(btn_carr_rev, cb_carr_rev_rel,   LV_EVENT_RELEASED, nullptr);

    // --- Braço (y=225) ---
    lv_obj_t* lbl_braco = lv_label_create(scr_manual);
    lv_label_set_text(lbl_braco, "BRACO");
    lv_obj_set_style_text_color(lbl_braco, COR_TEXTO_FRACO, 0);
    lv_obj_set_style_text_font(lbl_braco, &lv_font_montserrat_16, 0);
    lv_obj_set_pos(lbl_braco, 452, 225);

    btn_braco_fwd = criar_btn(scr_manual, ">> Giro A", 452, 245, 160, 65);
    lv_obj_add_event_cb(btn_braco_fwd, cb_braco_fwd_press, LV_EVENT_PRESSED,  nullptr);
    lv_obj_add_event_cb(btn_braco_fwd, cb_braco_fwd_rel,   LV_EVENT_RELEASED, nullptr);

    btn_braco_rev = criar_btn(scr_manual, "<< Giro B", 622, 245, 160, 65);
    lv_obj_add_event_cb(btn_braco_rev, cb_braco_rev_press, LV_EVENT_PRESSED,  nullptr);
    lv_obj_add_event_cb(btn_braco_rev, cb_braco_rev_rel,   LV_EVENT_RELEASED, nullptr);

    // --- HOME (referenciamento automatico) — y=322 ---
    btn_home = criar_btn(scr_manual, "HOME", 452, 322, 160, 60);
    lv_obj_set_style_bg_color(btn_home, COR_DESTAQUE, 0);
    lv_obj_add_event_cb(btn_home, cb_btn_home, LV_EVENT_CLICKED, nullptr);

    lbl_home = lv_label_create(scr_manual);
    lv_label_set_text(lbl_home, "");
    lv_obj_set_style_text_color(lbl_home, COR_TEXTO_FRACO, 0);
    lv_obj_set_style_text_font(lbl_home, &lv_font_montserrat_16, 0);
    lv_obj_set_width(lbl_home, 160);
    lv_obj_set_pos(lbl_home, 622, 340);

    // --- Rodapé direito (y=430) ---
    lbl_alarme = lv_label_create(scr_manual);
    lv_label_set_text(lbl_alarme, "");
    lv_obj_set_style_text_color(lbl_alarme, COR_VERMELHO, 0);
    lv_obj_set_pos(lbl_alarme, 452, 432);

    btn_config = criar_btn(scr_manual, "Config", 690, 428, 105, 44);
    lv_obj_add_event_cb(btn_config, cb_btn_config, LV_EVENT_CLICKED, nullptr);

    // Diagnostico das 16 entradas (mapear sensores movendo o braço/carrinho na mão)
    lbl_diag_man = lv_label_create(scr_manual);
    lv_label_set_text(lbl_diag_man, "");
    lv_obj_set_style_text_color(lbl_diag_man, COR_TEXTO_FRACO, 0);
    lv_obj_set_pos(lbl_diag_man, 10, 462);

    atualizar_controles_modo();
}

// -----------------------------------------------------------------------
// Ativa a tela
// -----------------------------------------------------------------------
void tela_manual_ativar() {
    atualizar_controles_modo();
    tela_manual_atualizar_contadores();
    lv_scr_load(scr_manual);
}

// -----------------------------------------------------------------------
// Atualiza labels com estado atual (chamado a cada 200ms)
// -----------------------------------------------------------------------
void tela_manual_atualizar() {
    // Processo ativo
    lv_label_set_text(lbl_processo, g_estado.processo_ativo == PROC_NENHUM
        ? "Processo: ---"
        : (String("Processo: ") + NOMES_PROCESSO[g_estado.processo_ativo]).c_str());

    // VFD
    char buf[32];
    snprintf(buf, sizeof(buf), "VFD: %.1f Hz", g_vfd_freq);
    lv_label_set_text(lbl_freq, buf);

    snprintf(buf, sizeof(buf), "%.1f A", g_vfd_corrente);
    lv_label_set_text(lbl_corrente, buf);

    // Alarme
    if (g_estado.alarme) {
        lv_label_set_text(lbl_alarme, (String("ALERTA: ") + g_estado.msg_alarme).c_str());
    } else {
        lv_label_set_text(lbl_alarme, "");
    }

    // Horas no manual (acumuladas em display.ino, atualiza em tempo real)
    lv_label_set_text_fmt(lbl_horas, "Horas no manual: %.1f h", g_horas_manual);

    // Diagnostico das 16 entradas (DI1..DI8 de cada waveshare)
    lv_label_set_text_fmt(lbl_diag_man,
        "W1 D1-8: %d%d%d%d%d%d%d%d   W2 D1-8: %d%d%d%d%d%d%d%d",
        io1_get_di(1), io1_get_di(2), io1_get_di(3), io1_get_di(4),
        io1_get_di(5), io1_get_di(6), io1_get_di(7), io1_get_di(8),
        io2_get_di(1), io2_get_di(2), io2_get_di(3), io2_get_di(4),
        io2_get_di(5), io2_get_di(6), io2_get_di(7), io2_get_di(8));

    // Status do HOME (referenciamento)
    lv_label_set_text(lbl_home, home_mensagem());
    int he = home_estado();
    lv_color_t cor_home = (he == 1 || he == 2) ? COR_AMARELO      // rodando
                        : (he == 3)            ? COR_VERDE        // concluido
                        : (he == 4)            ? COR_VERMELHO     // falha
                        :                        COR_TEXTO_FRACO; // idle
    lv_obj_set_style_text_color(lbl_home, cor_home, 0);
    // Rotulo do botao: "ABORTAR" enquanto o home roda, "HOME" caso contrario
    lv_obj_t* lbl_btn_h = lv_obj_get_child(btn_home, 0);
    if (lbl_btn_h) lv_label_set_text(lbl_btn_h, home_rodando() ? "ABORTAR" : "HOME");
}
