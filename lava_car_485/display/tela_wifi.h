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
// Lista de redes — pedida à CÂMERA, nunca escaneada pelo display
// -----------------------------------------------------------------------
// Regra da arquitetura: só a câmera varre canais (scan mexe no rádio, e quem
// pode se mover entre canais é só ela — o display fica sempre parado ouvindo
// no canal em que estiver). Por isso "Buscar" manda MSG_SCAN_REQ pra câmera
// e só monta o dropdown quando as páginas de MSG_SCAN_RESP chegam.
#define SCAN_MAX_REDES 20
static char           g_scan_ssids[SCAN_MAX_REDES][SCAN_SSID_LEN];
static uint8_t         g_scan_count    = 0;      // entradas válidas recebidas até agora
static volatile bool   g_scan_novo_dado = false; // uma página nova chegou (processar no loop)

void tela_wifi_atualizar_status(); // definida mais abaixo; usada em tela_wifi_scan_tick()

static bool g_wifi_aguardando_caca = false;   // true enquanto o "modo caça" roda em background

static void _wifi_fazer_scan() {
    lv_label_set_text(lbl_wifi_status, "Buscando redes (via câmera)...");
    g_scan_count = 0;
    MsgScanReq req; req.cab.tipo = MSG_SCAN_REQ; req.cab.id_maquina = ID_MAQUINA;
    req.cab.origem = ORIGEM_DISPLAY; req.cab.seq = 0;
    // esp_now_send pode falhar transitoriamente (ESP_ERR_ESPNOW_NO_MEM) se pegar
    // a fila interna do ESP-NOW ocupada com outro envio (heartbeat/canal) no
    // mesmo instante — insiste algumas vezes com um respiro entre elas.
    esp_err_t r = ESP_FAIL;
    for (int t = 0; t < 5 && r != ESP_OK; t++) {
        if (t > 0) delay(50);
        r = esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&req, sizeof(req));
    }
    Serial.printf("[WIFI] MSG_SCAN_REQ enviado (esp_now_send=%d, peer_existe=%d, heap=%u)\n",
                  (int)r, (int)esp_now_is_peer_exist(MAC_CAMERA), (unsigned)ESP.getFreeHeap());
}

// Callback do ESP-NOW (comm_espnow.h) ao chegar uma página de MSG_SCAN_RESP.
// Só copia os dados — quem mexe na LVGL é tela_wifi_scan_tick(), no loop().
void wifi_scan_espnow_handle(const uint8_t* data, int len) {
    if (len < (int)sizeof(MsgScanResp)) return;
    const MsgScanResp* r = (const MsgScanResp*)data;
    for (int i = 0; i < r->n && i < SCAN_POR_PAGINA; i++) {
        int idx = r->pagina * SCAN_POR_PAGINA + i;
        if (idx >= SCAN_MAX_REDES) break;
        strncpy(g_scan_ssids[idx], r->redes[i].ssid, SCAN_SSID_LEN - 1);
        g_scan_ssids[idx][SCAN_SSID_LEN - 1] = '\0';
        if (idx + 1 > g_scan_count) g_scan_count = idx + 1;
    }
    g_scan_novo_dado = true;
}

// Chamar sempre no loop() (barato: só um "if" quando não há nada novo).
// Monta o dropdown a partir do que já chegou — cresce a cada página recebida.
// Também atualiza o status REAL da câmera (lbl_wifi_ip) a cada 1s — é aqui
// que a tela finalmente confirma (ou desmente) o "Enviado. A câmera vai
// conectar." com informação de verdade, em vez de deixar escrito pra sempre.
void tela_wifi_scan_tick() {
    static uint32_t t_status = 0;
    if (millis() - t_status >= 1000) {
        t_status = millis();
        tela_wifi_atualizar_status();
    }
    if (g_wifi_aguardando_caca) {
        if (espnow_cacando()) {
            lv_label_set_text_fmt(lbl_wifi_status, "Procurando a camera (volta %d pelos 13 canais)...", espnow_cacar_volta());
            return;
        }
        g_wifi_aguardando_caca = false;
        if (espnow_cacar_achou()) _wifi_fazer_scan();
        else lv_label_set_text(lbl_wifi_status, "Camera nao encontrada. Toque em Buscar pra tentar de novo.");
        return;
    }
    if (!g_scan_novo_dado) return;
    g_scan_novo_dado = false;
    if (g_scan_count == 0) {
        lv_dropdown_set_options(dd_redes, "(nenhuma rede)");
        lv_label_set_text(lbl_wifi_status, "Nenhuma rede encontrada");
        return;
    }
    String ops = "";
    for (uint8_t i = 0; i < g_scan_count; i++) {
        if (i > 0) ops += "\n";
        ops += g_scan_ssids[i];
    }
    lv_dropdown_set_options(dd_redes, ops.c_str());
    lv_label_set_text(lbl_wifi_status, "Toque na Rede e escolha da lista");
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
    if (espnow_camera_perdida()) {
        g_wifi_aguardando_caca = true;
        lv_label_set_text(lbl_wifi_status, "Procurando a camera (volta 1 pelos 13 canais)...");
        espnow_cacar_iniciar();
        return;
    }
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
    if (g_wifi_aguardando_caca) { espnow_cacar_cancelar(); g_wifi_aguardando_caca = false; }
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
// IMPORTANTE: wifi_conectado() é o Wi-Fi do PRÓPRIO DISPLAY — que nunca
// existe (Opção A: só a câmera conecta). Usar isso aqui sempre dava
// "Desconectado", e nem era chamado de novo depois do "Salvar" — por isso
// a tela ficava pra sempre em "Enviado. A câmera vai conectar." sem nunca
// confirmar (ou desmentir) que a câmera realmente conectou.
// Agora usa sinais REAIS da câmera (via ESP-NOW): backend_ok() (heartbeat
// com a nuvem respondeu 200 recentemente) e g_cam_last_ms (contato ESP-NOW
// mais recente, qualquer que seja). Só mexe no label de baixo
// (lbl_wifi_ip) — o de cima (lbl_wifi_status) fica livre pras mensagens de
// ação (scan em andamento, "Enviado...", etc.) sem um atropelar o outro.
void tela_wifi_atualizar_status() {
    if (!lbl_wifi_ip) return;
    uint32_t desde_camera = millis() - g_cam_last_ms;
    char buf[96];
    if (backend_ok()) {
        snprintf(buf, sizeof(buf), LV_SYMBOL_OK " Camera conectada e falando com a nuvem (contato ha %lus)",
                 (unsigned long)(desde_camera / 1000));
        lv_label_set_text(lbl_wifi_ip, buf);
        lv_obj_set_style_text_color(lbl_wifi_ip, COR_VERDE, 0);
    } else if (desde_camera < 15000) {
        lv_label_set_text(lbl_wifi_ip, LV_SYMBOL_WARNING " Camera responde, aguardando confirmacao da nuvem...");
        lv_obj_set_style_text_color(lbl_wifi_ip, COR_AMARELO, 0);
    } else {
        snprintf(buf, sizeof(buf), LV_SYMBOL_CLOSE " Sem contato com a camera ha %lus", (unsigned long)(desde_camera / 1000));
        lv_label_set_text(lbl_wifi_ip, buf);
        lv_obj_set_style_text_color(lbl_wifi_ip, COR_VERMELHO, 0);
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
