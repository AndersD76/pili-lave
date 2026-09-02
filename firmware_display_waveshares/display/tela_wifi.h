#pragma once
#include <lvgl.h>
#include <WiFi.h>
#include "tipos.h"
#include "nvs_manager.h"
#include "wifi_manager.h"

// URL padrao do backend (pre-preenchida no campo se ainda nao houver nada salvo)
#define PILI_API_URL_DEFAULT "https://pili-lave-production.up.railway.app"
#define PILI_DEVKEY_DEFAULT  "pili-cam-01"
// =======================================================================
// tela_wifi.h — Tela LVGL de configuração Wi-Fi
//
// Acessível pelo menu de configuração existente.
// Permite: scan de redes, entrada de senha, URL do backend, device key.
// Botão "Testar" tenta conectar e faz um heartbeat.
// =======================================================================
static lv_obj_t* scr_wifi          = nullptr;
static lv_obj_t* dd_redes          = nullptr;   // lista clicável de redes (do scan)
static lv_obj_t* ta_senha          = nullptr;
static lv_obj_t* ta_api_base       = nullptr;
static lv_obj_t* ta_device_key     = nullptr;
static lv_obj_t* lbl_wifi_status   = nullptr;
static lv_obj_t* lbl_wifi_ip       = nullptr;
static lv_obj_t* kb_wifi           = nullptr;
static void (*_cb_wifi_voltar)() = nullptr;
// -----------------------------------------------------------------------
// Scan de redes e atualiza dropdown
// -----------------------------------------------------------------------
// Buscar: escaneia e popula a LISTA CLICÁVEL (dropdown) com as redes achadas.
// Obs: WiFi.scanNetworks mexe no canal do rádio; ao terminar forçamos o hunt
// (g_cam_last_ms=0) pra o display re-sincronizar o canal com a câmera.
static void _wifi_fazer_scan() {
    lv_label_set_text(lbl_wifi_status, "Buscando redes...");
    lv_refr_now(nullptr);
    int n = WiFi.scanNetworks();
    if (n <= 0) {
        lv_dropdown_set_options(dd_redes, "(nenhuma rede)");
        lv_label_set_text(lbl_wifi_status, "Nenhuma rede encontrada");
    } else {
        String ops = "";
        for (int i = 0; i < n && i < 12; i++) {
            if (i > 0) ops += "\n";
            ops += WiFi.SSID(i);
        }
        lv_dropdown_set_options(dd_redes, ops.c_str());
        lv_label_set_text(lbl_wifi_status, "Toque na Rede e escolha da lista");
    }
    WiFi.scanDelete();
    g_cam_last_ms = 0;   // força o hunt p/ re-sincronizar o canal após o scan
}
// Botão do olho: revela/esconde a senha
static void cb_wifi_ver_senha(lv_event_t* e) {
    bool oculto = lv_textarea_get_password_mode(ta_senha);
    lv_textarea_set_password_mode(ta_senha, !oculto);
    lv_obj_t* lbl = lv_obj_get_child((lv_obj_t*)lv_event_get_target(e), 0);
    if (lbl) lv_label_set_text(lbl, oculto ? LV_SYMBOL_EYE_CLOSE : LV_SYMBOL_EYE_OPEN);
}
// -----------------------------------------------------------------------
// Callbacks
// -----------------------------------------------------------------------
static void cb_wifi_scan(lv_event_t* e) {
    _wifi_fazer_scan();
}
static void cb_wifi_salvar(lv_event_t* e) {
    // Opção A: o display NÃO conecta — ele MANDA as credenciais pra CÂMERA (que é o
    // gateway). URL e device-key também vão (pré-preenchidos, mas editáveis aqui).
    char _ssbuf[40]; lv_dropdown_get_selected_str(dd_redes, _ssbuf, sizeof(_ssbuf));
    String ssid       = String(_ssbuf);                              ssid.trim();
    String pass       = String(lv_textarea_get_text(ta_senha));
    String api_base   = String(lv_textarea_get_text(ta_api_base));
    String device_key = String(lv_textarea_get_text(ta_device_key));
    if (ssid.length() > 0 && ssid.indexOf('(') < 0) {   // ignora placeholders "(...)"
        lv_label_set_text(lbl_wifi_status, "Enviando p/ camera...");
        lv_refr_now(nullptr);
        enviar_cfg_camera(ssid, pass, api_base, device_key);
        lv_label_set_text(lbl_wifi_status, "Enviado. A camera vai conectar.");
    } else {
        lv_label_set_text(lbl_wifi_status, "Aperte Buscar e escolha a rede");
    }
}
static void cb_wifi_voltar(lv_event_t* e) {
    if (kb_wifi) { lv_obj_del(kb_wifi); kb_wifi = nullptr; }
    wifi_pausar_auto(false);                // retoma o auto-connect ao sair
    if (_cb_wifi_voltar) _cb_wifi_voltar();
}
// Fecha o teclado (botao "OK/check" = READY, botao "esconder teclado" = CANCEL).
// Sem isso o teclado fica aberto cobrindo os botoes Salvar/Voltar -> parece travado.
static void cb_wifi_kb_close(lv_event_t* e) {
    if (kb_wifi) { lv_obj_del(kb_wifi); kb_wifi = nullptr; }
}
static void cb_wifi_ta_focus(lv_event_t* e) {
    if (!kb_wifi) {
        kb_wifi = lv_keyboard_create(scr_wifi);
        lv_obj_set_size(kb_wifi, 800, 200);
        lv_obj_align(kb_wifi, LV_ALIGN_BOTTOM_MID, 0, 0);
        lv_obj_add_event_cb(kb_wifi, cb_wifi_kb_close, LV_EVENT_READY,  nullptr);
        lv_obj_add_event_cb(kb_wifi, cb_wifi_kb_close, LV_EVENT_CANCEL, nullptr);
    }
    lv_keyboard_set_textarea(kb_wifi, (lv_obj_t*)lv_event_get_target(e));
}
// -----------------------------------------------------------------------
// Atualiza status na tela (chamar periodicamente ou após evento)
// -----------------------------------------------------------------------
void tela_wifi_atualizar_status() {
    if (!lbl_wifi_status) return;
    if (wifi_conectado()) {
        char buf[64];
        snprintf(buf, sizeof(buf), "Conectado — %s (canal %d, %d dBm)",
                 WiFi.SSID().c_str(), WiFi.channel(), WiFi.RSSI());
        lv_label_set_text(lbl_wifi_status, buf);
        lv_label_set_text(lbl_wifi_ip, WiFi.localIP().toString().c_str());
    } else {
        lv_label_set_text(lbl_wifi_status, "Desconectado");
        lv_label_set_text(lbl_wifi_ip, "---");
    }
}
// -----------------------------------------------------------------------
// Criação da tela
// -----------------------------------------------------------------------
void tela_wifi_criar(void (*cb_voltar)()) {
    _cb_wifi_voltar = cb_voltar;
    scr_wifi = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_wifi, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_wifi, LV_OBJ_FLAG_SCROLLABLE);
    // Título
    lv_obj_t* t = lv_label_create(scr_wifi);
    lv_label_set_text(t, LV_SYMBOL_WIFI " CONFIGURAÇÃO WI-FI");
    lv_obj_set_style_text_color(t, COR_DESTAQUE, 0);
    lv_obj_set_style_text_font(t, &lv_font_montserrat_20, 0);
    lv_obj_set_pos(t, 10, 8);
    // Rede (SSID) — LISTA CLICÁVEL (dropdown), populada pelo botão Buscar
    lv_obj_t* lbl_r = lv_label_create(scr_wifi);
    lv_label_set_text(lbl_r, "Rede:");
    lv_obj_set_style_text_color(lbl_r, COR_TEXTO, 0);
    lv_obj_set_pos(lbl_r, 10, 48);
    dd_redes = lv_dropdown_create(scr_wifi);
    lv_dropdown_set_options(dd_redes, "(aperte Buscar)");
    lv_obj_set_size(dd_redes, 420, 44);
    lv_obj_set_pos(dd_redes, 80, 42);
    lv_obj_set_style_bg_color(dd_redes, COR_ATIVO, 0);
    lv_obj_set_style_text_color(dd_redes, COR_TEXTO, 0);
    // Botão Buscar — escaneia e enche a lista
    lv_obj_t* btn_scan = lv_btn_create(scr_wifi);
    lv_obj_set_size(btn_scan, 120, 44);
    lv_obj_set_pos(btn_scan, 510, 42);
    lv_obj_set_style_bg_color(btn_scan, COR_ATIVO, 0);
    lv_obj_t* lbl_scan = lv_label_create(btn_scan);
    lv_label_set_text(lbl_scan, LV_SYMBOL_REFRESH " Buscar");
    lv_obj_center(lbl_scan);
    lv_obj_add_event_cb(btn_scan, cb_wifi_scan, LV_EVENT_CLICKED, nullptr);
    // Senha
    lv_obj_t* lbl_s = lv_label_create(scr_wifi);
    lv_label_set_text(lbl_s, "Senha:");
    lv_obj_set_style_text_color(lbl_s, COR_TEXTO, 0);
    lv_obj_set_pos(lbl_s, 10, 100);
    ta_senha = lv_textarea_create(scr_wifi);
    lv_textarea_set_password_mode(ta_senha, true);
    lv_textarea_set_one_line(ta_senha, true);
    lv_obj_set_size(ta_senha, 420, 44);
    lv_obj_set_pos(ta_senha, 80, 95);
    lv_obj_set_style_bg_color(ta_senha, COR_ATIVO, 0);
    lv_obj_set_style_text_color(ta_senha, COR_TEXTO, 0);
    lv_obj_add_event_cb(ta_senha, cb_wifi_ta_focus, LV_EVENT_FOCUSED, nullptr);
    // Botão do olho — revela/esconde a senha
    lv_obj_t* btn_eye = lv_btn_create(scr_wifi);
    lv_obj_set_size(btn_eye, 120, 44);
    lv_obj_set_pos(btn_eye, 510, 95);
    lv_obj_set_style_bg_color(btn_eye, COR_ATIVO, 0);
    lv_obj_t* lbl_eye = lv_label_create(btn_eye);
    lv_label_set_text(lbl_eye, LV_SYMBOL_EYE_OPEN);   // senha começa oculta
    lv_obj_center(lbl_eye);
    lv_obj_add_event_cb(btn_eye, cb_wifi_ver_senha, LV_EVENT_CLICKED, nullptr);
    // URL do backend
    lv_obj_t* lbl_u = lv_label_create(scr_wifi);
    lv_label_set_text(lbl_u, "URL:");
    lv_obj_set_style_text_color(lbl_u, COR_TEXTO, 0);
    lv_obj_set_pos(lbl_u, 10, 155);
    ta_api_base = lv_textarea_create(scr_wifi);
    lv_textarea_set_one_line(ta_api_base, true);
    {
        String _api = nvs_get_api_base();
        if (_api.length() == 0) _api = PILI_API_URL_DEFAULT;   // pre-preenche p/ nao errar
        lv_textarea_set_text(ta_api_base, _api.c_str());
    }
    lv_obj_set_size(ta_api_base, 600, 44);
    lv_obj_set_pos(ta_api_base, 80, 150);
    lv_obj_set_style_bg_color(ta_api_base, COR_ATIVO, 0);
    lv_obj_set_style_text_color(ta_api_base, COR_TEXTO, 0);
    lv_obj_add_event_cb(ta_api_base, cb_wifi_ta_focus, LV_EVENT_FOCUSED, nullptr);
    // Device Key
    lv_obj_t* lbl_k = lv_label_create(scr_wifi);
    lv_label_set_text(lbl_k, "Chave:");
    lv_obj_set_style_text_color(lbl_k, COR_TEXTO, 0);
    lv_obj_set_pos(lbl_k, 10, 210);
    ta_device_key = lv_textarea_create(scr_wifi);
    lv_textarea_set_one_line(ta_device_key, true);
    // Chave pré-preenchida VAZIA (o backend não usa device-key — acessa pela URL).
    // Continua editável caso um dia precise.
    lv_textarea_set_text(ta_device_key, nvs_get_device_key().c_str());
    lv_obj_set_size(ta_device_key, 600, 44);
    lv_obj_set_pos(ta_device_key, 80, 205);
    lv_obj_set_style_bg_color(ta_device_key, COR_ATIVO, 0);
    lv_obj_set_style_text_color(ta_device_key, COR_TEXTO, 0);
    lv_obj_add_event_cb(ta_device_key, cb_wifi_ta_focus, LV_EVENT_FOCUSED, nullptr);
    // Status
    lbl_wifi_status = lv_label_create(scr_wifi);
    lv_label_set_text(lbl_wifi_status, "---");
    lv_obj_set_style_text_color(lbl_wifi_status, COR_AMARELO, 0);
    lv_obj_set_style_text_font(lbl_wifi_status, &lv_font_montserrat_16, 0);
    lv_obj_set_width(lbl_wifi_status, 780);
    lv_obj_set_pos(lbl_wifi_status, 10, 262);
    lbl_wifi_ip = lv_label_create(scr_wifi);
    lv_label_set_text(lbl_wifi_ip, "---");
    lv_obj_set_style_text_color(lbl_wifi_ip, COR_TEXTO_FRACO, 0);
    lv_obj_set_style_text_font(lbl_wifi_ip, &lv_font_montserrat_16, 0);
    lv_obj_set_pos(lbl_wifi_ip, 10, 285);
    // Botões Salvar / Voltar — ficam no topo, ao lado do título (NÃO em baixo:
    // o teclado virtual (kb_wifi) é 800x200 ancorado no rodapé, cobrindo y=280..480;
    // um botão em y=315 fica por baixo do teclado quando ele abre e nunca recebe o toque).
    lv_obj_t* btn_sal = lv_btn_create(scr_wifi);
    lv_obj_set_size(btn_sal, 140, 40);
    lv_obj_set_pos(btn_sal, 520, 6);
    lv_obj_set_style_bg_color(btn_sal, COR_VERDE, 0);
    lv_obj_t* lbl_sal = lv_label_create(btn_sal);
    lv_label_set_text(lbl_sal, LV_SYMBOL_SAVE " Salvar");
    lv_obj_center(lbl_sal);
    lv_obj_add_event_cb(btn_sal, cb_wifi_salvar, LV_EVENT_CLICKED, nullptr);
    lv_obj_t* btn_v = lv_btn_create(scr_wifi);
    lv_obj_set_size(btn_v, 120, 40);
    lv_obj_set_pos(btn_v, 670, 6);
    lv_obj_set_style_bg_color(btn_v, COR_DESTAQUE, 0);
    lv_obj_t* lbl_v = lv_label_create(btn_v);
    lv_label_set_text(lbl_v, LV_SYMBOL_LEFT " Voltar");
    lv_obj_center(lbl_v);
    lv_obj_add_event_cb(btn_v, cb_wifi_voltar, LV_EVENT_CLICKED, nullptr);
}
void tela_wifi_ativar() {
    wifi_pausar_auto(true);          // pausa auto-connect: libera o rádio p/ o scan/save
    tela_wifi_atualizar_status();
    lv_scr_load(scr_wifi);
}
