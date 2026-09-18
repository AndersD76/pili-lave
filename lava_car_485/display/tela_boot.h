#pragma once
#include <lvgl.h>
#include <esp_now.h>
#include "tipos.h"
#include "nvs_manager.h"
#include "wifi_manager.h"   // MAC_CAMERA
#include "tela_senha.h"

// =======================================================================
// tela_boot.h — Cadastro da máquina na 1ª ligada (e acesso técnico depois)
//
// PRIMEIRA vez (NVS_PROVISIONADO ainda false): a máquina entra direto
// nesta tela em vez da tela normal — ela não tem serventia (não sabe pra
// qual unidade mandar heartbeat) até ser cadastrada.
//   [CADASTRAR MÁQUINA]  ->  [NOVA] ou [SUBSTITUIÇÃO]
//   [ACESSO TÉCNICO]     ->  pede senha (nvs_get_senha_tec(), padrão 2828)
//
// NOVA: técnico digita Cidade + Rua + Número; o display GERA sua própria
// identidade (deviceKey) uma única vez e manda pra câmera (MSG_PROV_REQ),
// que é quem tem HTTPS de verdade e faz o POST /api/machine/provisionar.
//
// SUBSTITUIÇÃO (display trocado, câmera continua a mesma): NÃO pede nada
// pra nuvem. O display pergunta pra câmera "quem é você?" (MSG_IDENT_REQ)
// por ESP-NOW — rádio de curto alcance, então só existe resposta se a
// câmera estiver fisicamente por perto. É essa distância física que evita
// pegar a máquina errada, não uma senha ou lista escolhida na tela.
//
// Depois de cadastrada uma vez, esta tela nunca mais aparece sozinha — o
// botão "Técnico" na tela normal (tela_manual.h) volta pra cá só quando
// alguém pede (recadastrar, ou repetir a substituição).
// =======================================================================

static lv_obj_t* scr_boot       = nullptr;
static lv_obj_t* scr_boot_tipo  = nullptr;
static lv_obj_t* scr_boot_nova  = nullptr;
static lv_obj_t* scr_boot_subst = nullptr;

static lv_obj_t* ta_boot_cidade = nullptr;
static lv_obj_t* ta_boot_rua    = nullptr;
static lv_obj_t* sb_boot_numero = nullptr;
static lv_obj_t* lbl_boot_nova_status = nullptr;
static lv_obj_t* lbl_boot_subst_status = nullptr;
static lv_obj_t* btn_boot_subst_confirmar = nullptr;
static lv_obj_t* kb_boot = nullptr;

static void (*_cb_boot_concluido)() = nullptr;   // chamado ao terminar (vai pra tela normal)

// -----------------------------------------------------------------------
// Estado do round-trip com a câmera (preenchido pelo callback ESP-NOW,
// processado no tick — mesmo padrão de tela_wifi.h).
// -----------------------------------------------------------------------
static volatile bool     g_boot_prov_chegou  = false;
static volatile uint8_t  g_boot_prov_ok      = 0;
static volatile uint16_t g_boot_prov_numero  = 0;
static char               g_boot_prov_cidade[32] = {0};
static char               g_boot_prov_rua[40]     = {0};
static char               g_boot_prov_erro[48]    = {0};

static volatile bool     g_boot_ident_chegou = false;
static volatile uint8_t  g_boot_ident_tem    = 0;
static char               g_boot_ident_key[24]    = {0};
static volatile uint16_t g_boot_ident_numero = 0;
static char               g_boot_ident_cidade[32] = {0};
static char               g_boot_ident_rua[40]     = {0};

// Chamados pelo espnow_on_recv() de comm_espnow.h.
void boot_prov_espnow_handle(const uint8_t* data, int len) {
    if (len < (int)sizeof(MsgProvResp)) return;
    const MsgProvResp* r = (const MsgProvResp*)data;
    g_boot_prov_ok = r->ok;
    g_boot_prov_numero = r->numero;
    strncpy(g_boot_prov_cidade, r->cidade, sizeof(g_boot_prov_cidade) - 1);
    strncpy(g_boot_prov_rua, r->rua, sizeof(g_boot_prov_rua) - 1);
    strncpy(g_boot_prov_erro, r->erro, sizeof(g_boot_prov_erro) - 1);
    g_boot_prov_chegou = true;
}
void boot_ident_espnow_handle(const uint8_t* data, int len) {
    if (len < (int)sizeof(MsgIdentResp)) return;
    const MsgIdentResp* r = (const MsgIdentResp*)data;
    g_boot_ident_tem = r->temIdentidade;
    strncpy(g_boot_ident_key, r->deviceKey, sizeof(g_boot_ident_key) - 1);
    g_boot_ident_numero = r->numero;
    strncpy(g_boot_ident_cidade, r->cidade, sizeof(g_boot_ident_cidade) - 1);
    strncpy(g_boot_ident_rua, r->rua, sizeof(g_boot_ident_rua) - 1);
    g_boot_ident_chegou = true;
}

// Gera uma identidade única pra esta máquina, uma única vez (chip ID —
// nunca se repete, nunca é escolhido por ninguém). Guardada pra sempre em
// NVS_DEVICE_KEY; reaproveitada em toda religada seguinte.
static String boot_gerar_device_key() {
    String salva = nvs_get_device_key();
    if (salva.length() > 0) return salva;
    uint64_t chip = ESP.getEfuseMac();
    char buf[24];
    snprintf(buf, sizeof(buf), "disp_%012llX", (unsigned long long)chip);
    nvs_set_device_key(String(buf));
    return String(buf);
}

static void boot_ir_tipo(lv_event_t* e)      { lv_scr_load(scr_boot_tipo); }
static void boot_ir_boot(lv_event_t* e)      { lv_scr_load(scr_boot); }

static void boot_ir_nova(lv_event_t* e) {
    lv_textarea_set_text(ta_boot_cidade, "");
    lv_textarea_set_text(ta_boot_rua, "");
    lv_spinbox_set_value(sb_boot_numero, 1);
    lv_label_set_text(lbl_boot_nova_status, "");
    lv_scr_load(scr_boot_nova);
}

static void boot_ir_subst(lv_event_t* e) {
    lv_label_set_text(lbl_boot_subst_status, "Procurando a câmera desta máquina...");
    lv_obj_add_state(btn_boot_subst_confirmar, LV_STATE_DISABLED);
    g_boot_ident_chegou = false;
    lv_scr_load(scr_boot_subst);
}

// -----------------------------------------------------------------------
// NOVA — envia MSG_PROV_REQ
// -----------------------------------------------------------------------
static void cb_boot_nova_enviar(lv_event_t* e) {
    String cidade = String(lv_textarea_get_text(ta_boot_cidade));
    String rua    = String(lv_textarea_get_text(ta_boot_rua));
    cidade.trim(); rua.trim();
    if (cidade.length() == 0 || rua.length() == 0) {
        lv_label_set_text(lbl_boot_nova_status, "Preencha cidade e rua.");
        return;
    }
    String deviceKey = boot_gerar_device_key();

    MsgProvReq m = {};
    m.cab.tipo = MSG_PROV_REQ; m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = 0;
    strncpy(m.deviceKey, deviceKey.c_str(), sizeof(m.deviceKey) - 1);
    strncpy(m.cidade, cidade.c_str(), sizeof(m.cidade) - 1);
    strncpy(m.rua, rua.c_str(), sizeof(m.rua) - 1);
    m.numero = (uint16_t)lv_spinbox_get_value(sb_boot_numero);
    m.stationId[0] = '\0';   // unidade nova — sempre por cidade/rua nesta 1ª versão

    if (!esp_now_is_peer_exist(MAC_CAMERA)) {
        esp_now_peer_info_t p = {}; p.channel = 0; p.ifidx = WIFI_IF_STA; p.encrypt = false;
        memcpy(p.peer_addr, MAC_CAMERA, 6); esp_now_add_peer(&p);
    }
    g_boot_prov_chegou = false;
    esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
    lv_label_set_text(lbl_boot_nova_status, "Enviando pra nuvem...");
}

// Chamado no loop() — processa a resposta do provisionamento.
void tela_boot_nova_tick() {
    if (!g_boot_prov_chegou) return;
    g_boot_prov_chegou = false;
    if (g_boot_prov_ok) {
        nvs_set_identidade(String(g_boot_prov_cidade), String(g_boot_prov_rua), g_boot_prov_numero);
        lv_label_set_text_fmt(lbl_boot_nova_status, "Cadastrada! %s - %s - Maquina %u",
                               g_boot_prov_cidade, g_boot_prov_rua, (unsigned)g_boot_prov_numero);
        if (_cb_boot_concluido) _cb_boot_concluido();
    } else {
        String msg = strlen(g_boot_prov_erro) ? String(g_boot_prov_erro) : String("Sem resposta da câmera/nuvem. Tente de novo.");
        lv_label_set_text(lbl_boot_nova_status, msg.c_str());
    }
}

// -----------------------------------------------------------------------
// SUBSTITUIÇÃO — envia MSG_IDENT_REQ, repete a cada 2s até achar a câmera
// -----------------------------------------------------------------------
static void cb_boot_subst_confirmar(lv_event_t* e) {
    if (!g_boot_ident_tem) return;   // botão só habilita quando achou identidade de verdade
    nvs_set_device_key(String(g_boot_ident_key));
    nvs_set_identidade(String(g_boot_ident_cidade), String(g_boot_ident_rua), g_boot_ident_numero);
    if (_cb_boot_concluido) _cb_boot_concluido();
}

// Chamado no loop() — manda o pedido periodicamente e trata a resposta.
void tela_boot_subst_tick() {
    if (lv_scr_act() != scr_boot_subst) return;
    static uint32_t t_ultimo_req = 0;
    if (millis() - t_ultimo_req >= 2000) {
        t_ultimo_req = millis();
        if (!esp_now_is_peer_exist(MAC_CAMERA)) {
            esp_now_peer_info_t p = {}; p.channel = 0; p.ifidx = WIFI_IF_STA; p.encrypt = false;
            memcpy(p.peer_addr, MAC_CAMERA, 6); esp_now_add_peer(&p);
        }
        MsgIdentReq m; m.cab.tipo = MSG_IDENT_REQ; m.cab.id_maquina = ID_MAQUINA;
        m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = 0;
        esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
    }
    if (!g_boot_ident_chegou) return;
    g_boot_ident_chegou = false;
    if (g_boot_ident_tem) {
        lv_label_set_text_fmt(lbl_boot_subst_status,
            "Camera encontrada: %s - %s - Maquina %u\nConfirma que e esta?",
            g_boot_ident_cidade, g_boot_ident_rua, (unsigned)g_boot_ident_numero);
        lv_obj_clear_state(btn_boot_subst_confirmar, LV_STATE_DISABLED);
    } else {
        lv_label_set_text(lbl_boot_subst_status,
            "Camera respondeu mas ainda nao tem cadastro.\nUse CADASTRAR > NOVA nesta camera primeiro.");
        lv_obj_add_state(btn_boot_subst_confirmar, LV_STATE_DISABLED);
    }
}

// Chamar sempre no loop() (barato).
void tela_boot_tick() {
    tela_boot_nova_tick();
    tela_boot_subst_tick();
}

// -----------------------------------------------------------------------
// Teclado virtual pros campos de texto (Cidade/Rua)
// -----------------------------------------------------------------------
static void cb_boot_kb_close(lv_event_t* e) { if (kb_boot) { lv_obj_del(kb_boot); kb_boot = nullptr; } }
static void cb_boot_ta_focus(lv_event_t* e) {
    if (!kb_boot) {
        kb_boot = lv_keyboard_create(scr_boot_nova);
        lv_obj_set_size(kb_boot, 800, 200);
        lv_obj_align(kb_boot, LV_ALIGN_BOTTOM_MID, 0, 0);
        lv_obj_add_event_cb(kb_boot, cb_boot_kb_close, LV_EVENT_READY,  nullptr);
        lv_obj_add_event_cb(kb_boot, cb_boot_kb_close, LV_EVENT_CANCEL, nullptr);
    }
    lv_keyboard_set_textarea(kb_boot, (lv_obj_t*)lv_event_get_target(e));
}

// -----------------------------------------------------------------------
// Acesso técnico — reaproveita a tela de senha genérica
// -----------------------------------------------------------------------
static void cb_boot_tecnico(lv_event_t* e) {
    cb_ir_senha_tec();   // declarada em tipos.h, definida em display.ino
}

// -----------------------------------------------------------------------
// Criação das telas
// -----------------------------------------------------------------------
void tela_boot_criar(void (*cb_concluido)()) {
    _cb_boot_concluido = cb_concluido;

    // ---- tela raiz: CADASTRAR MÁQUINA / ACESSO TÉCNICO ----
    scr_boot = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_boot, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_boot, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t* t = lv_label_create(scr_boot);
    lv_label_set_text(t, "PILI CLEAN - CONFIGURACAO INICIAL");
    lv_obj_set_style_text_color(t, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t, &lv_font_montserrat_20, 0);
    lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 40);

    lv_obj_t* sub = lv_label_create(scr_boot);
    lv_label_set_text(sub, "Esta maquina ainda nao foi cadastrada.");
    lv_obj_set_style_text_color(sub, COR_TEXTO_FRACO, 0);
    lv_obj_align(sub, LV_ALIGN_TOP_MID, 0, 75);

    lv_obj_t* btn_cad = lv_btn_create(scr_boot);
    lv_obj_set_size(btn_cad, 320, 90);
    lv_obj_align(btn_cad, LV_ALIGN_CENTER, 0, -40);
    lv_obj_set_style_bg_color(btn_cad, COR_VERDE, 0);
    lv_obj_t* lbl_cad = lv_label_create(btn_cad);
    lv_label_set_text(lbl_cad, "CADASTRAR MAQUINA");
    lv_obj_set_style_text_font(lbl_cad, &lv_font_montserrat_20, 0);
    lv_obj_center(lbl_cad);
    lv_obj_add_event_cb(btn_cad, boot_ir_tipo, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* btn_tec = lv_btn_create(scr_boot);
    lv_obj_set_size(btn_tec, 320, 70);
    lv_obj_align(btn_tec, LV_ALIGN_CENTER, 0, 70);
    lv_obj_set_style_bg_color(btn_tec, COR_ATIVO, 0);
    lv_obj_t* lbl_tec = lv_label_create(btn_tec);
    lv_label_set_text(lbl_tec, "ACESSO TECNICO");
    lv_obj_center(lbl_tec);
    lv_obj_add_event_cb(btn_tec, cb_boot_tecnico, LV_EVENT_CLICKED, nullptr);

    // ---- tipo: NOVA / SUBSTITUIÇÃO ----
    scr_boot_tipo = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_boot_tipo, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_boot_tipo, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t* t2 = lv_label_create(scr_boot_tipo);
    lv_label_set_text(t2, "MAQUINA NOVA OU PECA SUBSTITUIDA?");
    lv_obj_set_style_text_color(t2, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t2, &lv_font_montserrat_18, 0);
    lv_obj_align(t2, LV_ALIGN_TOP_MID, 0, 40);

    lv_obj_t* btn_nova = lv_btn_create(scr_boot_tipo);
    lv_obj_set_size(btn_nova, 300, 90);
    lv_obj_align(btn_nova, LV_ALIGN_CENTER, -170, 0);
    lv_obj_set_style_bg_color(btn_nova, COR_VERDE, 0);
    lv_obj_t* lbl_nova = lv_label_create(btn_nova);
    lv_label_set_text(lbl_nova, "NOVA");
    lv_obj_set_style_text_font(lbl_nova, &lv_font_montserrat_20, 0);
    lv_obj_center(lbl_nova);
    lv_obj_add_event_cb(btn_nova, boot_ir_nova, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* btn_sub = lv_btn_create(scr_boot_tipo);
    lv_obj_set_size(btn_sub, 300, 90);
    lv_obj_align(btn_sub, LV_ALIGN_CENTER, 170, 0);
    lv_obj_set_style_bg_color(btn_sub, COR_AMARELO, 0);
    lv_obj_t* lbl_sub = lv_label_create(btn_sub);
    lv_label_set_text(lbl_sub, "SUBSTITUICAO");
    lv_obj_set_style_text_font(lbl_sub, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_color(lbl_sub, lv_color_hex(0x000000), 0);
    lv_obj_center(lbl_sub);
    lv_obj_add_event_cb(btn_sub, boot_ir_subst, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* btn_v2 = lv_btn_create(scr_boot_tipo);
    lv_obj_set_size(btn_v2, 120, 44);
    lv_obj_align(btn_v2, LV_ALIGN_BOTTOM_MID, 0, -20);
    lv_obj_set_style_bg_color(btn_v2, COR_BORDA, 0);
    lv_obj_t* lblv2 = lv_label_create(btn_v2);
    lv_label_set_text(lblv2, LV_SYMBOL_LEFT " Voltar");
    lv_obj_center(lblv2);
    lv_obj_add_event_cb(btn_v2, boot_ir_boot, LV_EVENT_CLICKED, nullptr);

    // ---- NOVA: Cidade / Rua / Número ----
    scr_boot_nova = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_boot_nova, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_boot_nova, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t* t3 = lv_label_create(scr_boot_nova);
    lv_label_set_text(t3, "CADASTRAR MAQUINA NOVA");
    lv_obj_set_style_text_color(t3, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t3, &lv_font_montserrat_18, 0);
    lv_obj_set_pos(t3, 10, 8);

    lv_obj_t* lbl_cid = lv_label_create(scr_boot_nova);
    lv_label_set_text(lbl_cid, "Cidade:");
    lv_obj_set_style_text_color(lbl_cid, COR_TEXTO, 0);
    lv_obj_set_pos(lbl_cid, 10, 50);
    ta_boot_cidade = lv_textarea_create(scr_boot_nova);
    lv_textarea_set_one_line(ta_boot_cidade, true);
    lv_obj_set_size(ta_boot_cidade, 400, 44);
    lv_obj_set_pos(ta_boot_cidade, 130, 45);
    lv_obj_set_style_bg_color(ta_boot_cidade, COR_ATIVO, 0);
    lv_obj_set_style_text_color(ta_boot_cidade, COR_TEXTO, 0);
    lv_obj_add_event_cb(ta_boot_cidade, cb_boot_ta_focus, LV_EVENT_FOCUSED, nullptr);

    lv_obj_t* lbl_rua = lv_label_create(scr_boot_nova);
    lv_label_set_text(lbl_rua, "Rua:");
    lv_obj_set_style_text_color(lbl_rua, COR_TEXTO, 0);
    lv_obj_set_pos(lbl_rua, 10, 105);
    ta_boot_rua = lv_textarea_create(scr_boot_nova);
    lv_textarea_set_one_line(ta_boot_rua, true);
    lv_obj_set_size(ta_boot_rua, 400, 44);
    lv_obj_set_pos(ta_boot_rua, 130, 100);
    lv_obj_set_style_bg_color(ta_boot_rua, COR_ATIVO, 0);
    lv_obj_set_style_text_color(ta_boot_rua, COR_TEXTO, 0);
    lv_obj_add_event_cb(ta_boot_rua, cb_boot_ta_focus, LV_EVENT_FOCUSED, nullptr);

    lv_obj_t* lbl_num = lv_label_create(scr_boot_nova);
    lv_label_set_text(lbl_num, "Numero da maquina nesta unidade:");
    lv_obj_set_style_text_color(lbl_num, COR_TEXTO, 0);
    lv_obj_set_pos(lbl_num, 10, 165);
    sb_boot_numero = lv_spinbox_create(scr_boot_nova);
    lv_spinbox_set_range(sb_boot_numero, 1, 20);
    lv_spinbox_set_digit_format(sb_boot_numero, 2, 0);
    lv_spinbox_set_value(sb_boot_numero, 1);
    lv_obj_set_size(sb_boot_numero, 90, 40);
    lv_obj_set_pos(sb_boot_numero, 400, 160);
    lv_obj_set_style_bg_color(sb_boot_numero, COR_ATIVO, 0);
    lv_obj_set_style_text_color(sb_boot_numero, COR_TEXTO, 0);
    // TODO (próxima versão): número 1 pré-marcado; se já existir a "1" nesta
    // unidade o backend recusa (409) — o técnico só sobe pra 2, 3... vendo o erro.

    lbl_boot_nova_status = lv_label_create(scr_boot_nova);
    lv_label_set_text(lbl_boot_nova_status, "");
    lv_obj_set_style_text_color(lbl_boot_nova_status, COR_AMARELO, 0);
    lv_obj_set_width(lbl_boot_nova_status, 780);
    lv_obj_set_pos(lbl_boot_nova_status, 10, 230);

    lv_obj_t* btn_env = lv_btn_create(scr_boot_nova);
    lv_obj_set_size(btn_env, 200, 50);
    lv_obj_set_pos(btn_env, 10, 280);
    lv_obj_set_style_bg_color(btn_env, COR_VERDE, 0);
    lv_obj_t* lbl_env = lv_label_create(btn_env);
    lv_label_set_text(lbl_env, "ENVIAR CADASTRO");
    lv_obj_center(lbl_env);
    lv_obj_add_event_cb(btn_env, cb_boot_nova_enviar, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* btn_v3 = lv_btn_create(scr_boot_nova);
    lv_obj_set_size(btn_v3, 120, 44);
    lv_obj_set_pos(btn_v3, 670, 6);
    lv_obj_set_style_bg_color(btn_v3, COR_DESTAQUE, 0);
    lv_obj_t* lblv3 = lv_label_create(btn_v3);
    lv_label_set_text(lblv3, LV_SYMBOL_LEFT " Voltar");
    lv_obj_center(lblv3);
    lv_obj_add_event_cb(btn_v3, boot_ir_tipo, LV_EVENT_CLICKED, nullptr);

    // ---- SUBSTITUIÇÃO: procura a câmera local ----
    scr_boot_subst = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_boot_subst, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_boot_subst, LV_OBJ_FLAG_SCROLLABLE);

    lv_obj_t* t4 = lv_label_create(scr_boot_subst);
    lv_label_set_text(t4, "SUBSTITUICAO DE PECA");
    lv_obj_set_style_text_color(t4, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t4, &lv_font_montserrat_18, 0);
    lv_obj_align(t4, LV_ALIGN_TOP_MID, 0, 30);

    lbl_boot_subst_status = lv_label_create(scr_boot_subst);
    lv_label_set_text(lbl_boot_subst_status, "");
    lv_obj_set_style_text_color(lbl_boot_subst_status, COR_TEXTO, 0);
    lv_obj_set_style_text_align(lbl_boot_subst_status, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_set_width(lbl_boot_subst_status, 700);
    lv_obj_align(lbl_boot_subst_status, LV_ALIGN_CENTER, 0, -20);

    btn_boot_subst_confirmar = lv_btn_create(scr_boot_subst);
    lv_obj_set_size(btn_boot_subst_confirmar, 260, 60);
    lv_obj_align(btn_boot_subst_confirmar, LV_ALIGN_CENTER, 0, 90);
    lv_obj_set_style_bg_color(btn_boot_subst_confirmar, COR_VERDE, 0);
    lv_obj_add_state(btn_boot_subst_confirmar, LV_STATE_DISABLED);
    lv_obj_t* lbl_confsub = lv_label_create(btn_boot_subst_confirmar);
    lv_label_set_text(lbl_confsub, "SIM, E ESTA MAQUINA");
    lv_obj_center(lbl_confsub);
    lv_obj_add_event_cb(btn_boot_subst_confirmar, cb_boot_subst_confirmar, LV_EVENT_CLICKED, nullptr);

    lv_obj_t* btn_v4 = lv_btn_create(scr_boot_subst);
    lv_obj_set_size(btn_v4, 120, 44);
    lv_obj_align(btn_v4, LV_ALIGN_BOTTOM_MID, 0, -20);
    lv_obj_set_style_bg_color(btn_v4, COR_BORDA, 0);
    lv_obj_t* lblv4 = lv_label_create(btn_v4);
    lv_label_set_text(lblv4, LV_SYMBOL_LEFT " Voltar");
    lv_obj_center(lblv4);
    lv_obj_add_event_cb(btn_v4, boot_ir_tipo, LV_EVENT_CLICKED, nullptr);
}

void tela_boot_ativar() { lv_scr_load(scr_boot); }
