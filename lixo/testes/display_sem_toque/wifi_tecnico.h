// =======================================================================
// wifi_tecnico.h — tela de Wi-Fi na aba TECNICO do display (compilado, ainda NAO testado com a camera)
//
// DECIDIDO (docs/COMBINADOS.md, secao 6): display e W1 NAO conectam no Wi-Fi; so a CAMERA tem internet.
//   - Tudo nasce no canal 1. O tecnico manda a camera BUSCAR redes; ela devolve a lista COM O CANAL de cada rede.
//   - Ao escolher a rede: o display manda "vai para o canal N" (MsgCanal) para a CAMERA, vai para o canal N e espera o "oi" dela
//     (MsgCanal vindo da camera); volta ao canal antigo, repete para a W1 (que leva a W2 junto) e espera o "oi" (MsgCanal ou status).
//     SO DEPOIS de todos no canal N o display entrega SSID+senha (MsgWifiCfg) para a camera conectar na internet.
//   - Falhou em qualquer passo: volta sozinho ao canal antigo (e manda quem ja migrou voltar). Estado da migracao fica na NVS.
//   - Camera nao achada ao BUSCAR: SO ENTAO o display varre os canais 1..13 (e trava no canal em que achar a camera).
// Mensagens reaproveitadas da camera: MSG_SCAN_REQ/RESP e MSG_WIFI_CFG (ver protocolo_teste.h). O comando "vai para o canal N"
// da camera (MsgCanal vindo do DISPLAY) ainda NAO existe no firmware da camera: PENDENTE (ver testes/PENDENCIAS_NA_MAQUINA.md).
// =======================================================================
#pragma once

// ---------------------------------------------------------------- estado ---
typedef struct { char ssid[SCAN_SSID_LEN]; uint8_t canal; int8_t rssi; } RedeWifi;
static RedeWifi g_redes[16];
static uint8_t  g_redes_n = 0;
static uint8_t  g_rede_sel = 255;                    // indice na lista (255 = nenhuma)
static uint8_t  g_redes_pag = 0;                     // pagina visivel na tela (5 por pagina)
static uint32_t g_scan_ult_ms = 0;                   // ultimo MSG_SCAN_RESP recebido
static volatile uint32_t g_cam_vista_ms = 0;         // ultimo frame QUALQUER da camera
static volatile uint32_t g_cam_hello_ms = 0;         // ultimo MsgCanal ("oi") vindo da camera
static volatile uint32_t g_w1_hello_ms = 0;          // ultimo MsgCanal ("oi") vindo da W1
static volatile uint8_t  g_resync_pedido = 0;        // MSG_RESYNC_REQ da camera: canal novo do roteador (re-sync automatico)
static bool     g_manual_ssid = false;               // digitando o nome da rede (+ canal) a mao

enum WsEstado : uint8_t { WS_IDLE = 0, WS_SCAN_ESPERA, WS_CACA, WS_CAM_ENVIA, WS_CAM_ESPERA, WS_W1_ENVIA, WS_W1_ESPERA,
                          WS_CFG_ENVIA, WS_VOLTA, WS_FIM };
static uint8_t  g_ws = WS_IDLE;
static uint32_t g_ws_t0 = 0, g_ws_tl = 0;            // t0 = inicio do passo, tl = ultimo envio
static uint8_t  g_ws_n = 0;                          // contador de envios / canal da varredura
static uint8_t  g_canal_ant = ESPNOW_CANAL, g_canal_alvo = ESPNOW_CANAL;
static uint8_t  g_ws_voltar_cam = 0, g_ws_voltar_w1 = 0;   // quem ja migrou e precisa voltar se falhar
static char     g_ws_ssid[33] = "", g_ws_pass[65] = "";
static char     g_ws_msg[100] = "Toque em BUSCAR REDES.";
static bool     g_ws_msg_erro = false;

static const uint8_t BC_ALL[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };

static void cad_on_recv(const uint8_t* data, int len);    // cadastro_tecnico.h

// Chamado do callback do ESP-NOW (nao mexe em LVGL).
static void wifi_on_recv(const uint8_t* data, int len) {
    const CabEspNow* c = (const CabEspNow*)data;
    uint32_t agora = millis();
    if (c->origem == ORIGEM_CAMERA) {
        g_cam_vista_ms = agora;
        if (c->tipo == MSG_CANAL) g_cam_hello_ms = agora;
        else if (c->tipo == MSG_RESYNC_REQ && len >= (int)sizeof(MsgResyncReq)) {
            uint8_t n = ((const MsgResyncReq*)data)->canal;
            if (n >= 1 && n <= 13) g_resync_pedido = n;
        }
        else if (c->tipo == MSG_PROV_RESP || c->tipo == MSG_IDENT_RESP || c->tipo == MSG_UNI_RESP || c->tipo == MSG_IDPUSH_RESP) cad_on_recv(data, len);   // cadastro da maquina
        else if (c->tipo == MSG_SCAN_RESP && len >= (int)sizeof(MsgScanResp)) {
            const MsgScanResp* r = (const MsgScanResp*)data;
            g_scan_ult_ms = agora;
            for (uint8_t i = 0; i < r->n && i < SCAN_POR_PAGINA; i++) {
                const ScanEntry& e = r->redes[i];
                if (!e.ssid[0]) continue;
                bool dup = false;
                for (uint8_t k = 0; k < g_redes_n; k++) if (strncmp(g_redes[k].ssid, e.ssid, SCAN_SSID_LEN) == 0) { dup = true; break; }
                if (dup || g_redes_n >= 16) continue;
                strncpy(g_redes[g_redes_n].ssid, e.ssid, SCAN_SSID_LEN - 1); g_redes[g_redes_n].ssid[SCAN_SSID_LEN - 1] = 0;
                g_redes[g_redes_n].canal = e.canal; g_redes[g_redes_n].rssi = e.rssi;
                g_redes_n++;
            }
        }
    } else if (c->origem == ORIGEM_WAVE1 && c->tipo == MSG_CANAL) {
        g_w1_hello_ms = agora;
    }
}

// ----------------------------------------------------------------- envios ---
static void ws_msg(const char* m, bool erro = false) { snprintf(g_ws_msg, sizeof(g_ws_msg), "%s", m); g_ws_msg_erro = erro; }

static void wifi_envia_scan_req() {
    MsgScanReq m = {};
    m.cab.tipo = MSG_SCAN_REQ; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_seq++;
    esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
    esp_now_send((uint8_t*)BC_ALL,     (uint8_t*)&m, sizeof(m));
}
// "Vai para o canal N": MsgCanal do DISPLAY. Para a camera (sem criptografia) e para a W1 (criptografado).
static void wifi_envia_canal(const uint8_t* mac, uint8_t canal, bool tambem_broadcast) {
    MsgCanal m = {};
    m.cab.tipo = MSG_CANAL; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_seq++;
    m.canal = canal;
    esp_now_send((uint8_t*)mac, (uint8_t*)&m, sizeof(m));
    if (tambem_broadcast) esp_now_send((uint8_t*)BC_ALL, (uint8_t*)&m, sizeof(m));
}
static void wifi_envia_cfg() {
    MsgWifiCfg m = {};
    m.cab.tipo = MSG_WIFI_CFG; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_seq++;
    strncpy(m.ssid, g_ws_ssid, sizeof(m.ssid) - 1);
    strncpy(m.pass, g_ws_pass, sizeof(m.pass) - 1);
    m.canal = g_canal_alvo;          // dica; a camera ja esta nesse canal
    // api_url / dev_key vazios: a camera mantem os que ja tem salvos (so troca os que vierem preenchidos)
    esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
    esp_now_send((uint8_t*)BC_ALL,     (uint8_t*)&m, sizeof(m));
}

// --------------------------------------------------------- NVS da migracao ---
static void wifi_mig_nvs(uint8_t passo, uint8_t alvo) {      // passo 0 = nenhuma migracao em andamento
    Preferences p; if (!p.begin("rede", false)) return;
    p.putUChar("mig_passo", passo); p.putUChar("mig_alvo", alvo); p.end();
}
static uint8_t wifi_mig_pendente() {
    Preferences p; if (!p.begin("rede", true)) return 0;
    uint8_t v = p.getUChar("mig_passo", 0); p.end(); return v;
}

// ------------------------------------------------------------- operacoes ---
static void wifi_buscar() {
    g_redes_n = 0; g_rede_sel = 255; g_redes_pag = 0;
    g_scan_ult_ms = 0; g_cam_vista_ms = 0;
    wifi_envia_scan_req();
    g_ws = WS_SCAN_ESPERA; g_ws_t0 = millis(); g_ws_tl = g_ws_t0;
    ws_msg("Buscando redes pela camera...");
}
static void wifi_caca_iniciar() {
    g_ws = WS_CACA; g_ws_n = 0; g_ws_t0 = 0;
    g_canal_ant = g_canal_disp;
    ws_msg("Camera nao respondeu: procurando nos canais 1 a 13...");
}
static void wifi_migrar(const char* ssid, const char* pass, uint8_t canal_rede) {
    if (g_ws != WS_IDLE && g_ws != WS_FIM) return;
    snprintf(g_ws_ssid, sizeof(g_ws_ssid), "%s", ssid);
    snprintf(g_ws_pass, sizeof(g_ws_pass), "%s", pass);
    g_canal_ant = g_canal_disp; g_canal_alvo = canal_rede;
    g_ws_voltar_cam = 0; g_ws_voltar_w1 = 0;
    wifi_mig_nvs(1, canal_rede);
    if (canal_rede == g_canal_disp) {                  // ja todos no canal da rede: so entrega as credenciais
        g_ws = WS_CFG_ENVIA; g_ws_n = 0; g_ws_t0 = g_ws_tl = millis();
        ws_msg("Entregando a rede para a camera...");
        return;
    }
    g_ws = WS_CAM_ENVIA; g_ws_n = 0; g_ws_t0 = g_ws_tl = 0;
    char b[90]; snprintf(b, sizeof(b), "Passo 1/3: camera -> canal %u", (unsigned)canal_rede); ws_msg(b);
}
static void wifi_falhou(const char* motivo) {
    // volta quem ja migrou: o display esta (ou vai estar) no canal alvo para avisa-los, e depois volta ao canal antigo
    g_ws = WS_VOLTA; g_ws_n = 0; g_ws_t0 = g_ws_tl = 0;
    char b[100]; snprintf(b, sizeof(b), "FALHOU: %s. Voltando ao canal %u...", motivo, (unsigned)g_canal_ant); ws_msg(b, true);
}

// Chamado a cada volta do loop() (fora do LVGL). Maquina de estados NAO bloqueante.
static void wifi_tick() {
    uint32_t agora = millis();
    // RE-SYNC AUTOMATICO: a camera avisou que o roteador mudou de canal. Migra camera, W1 e W2 sem senha de tecnico, so com a maquina parada.
    if (g_resync_pedido && (g_ws == WS_IDLE || g_ws == WS_FIM) && g_st_ok && !maquina_ocupada()) {
        uint8_t n = g_resync_pedido; g_resync_pedido = 0;
        if (n != g_canal_disp) wifi_migrar("", "", n);
    }
    switch (g_ws) {
    case WS_SCAN_ESPERA: {
        if (g_redes_n > 0 && g_scan_ult_ms && agora - g_scan_ult_ms > 1500) {            // paginas pararam de chegar
            char b[60]; snprintf(b, sizeof(b), "%u rede(s) encontrada(s). Escolha uma.", (unsigned)g_redes_n); ws_msg(b);
            g_ws = WS_IDLE;
        } else if (g_redes_n == 0 && g_scan_ult_ms && agora - g_scan_ult_ms > 1500) {      // camera respondeu "nenhuma rede"
            ws_msg("A camera nao encontrou redes. Tente de novo ou digite o nome."); g_ws = WS_IDLE;
        } else if (!g_scan_ult_ms && !g_cam_vista_ms && agora - g_ws_t0 > 5000) {          // nada da camera neste canal
            wifi_caca_iniciar();
        } else if (!g_scan_ult_ms && g_cam_vista_ms && agora - g_ws_t0 > 12000) {
            ws_msg("A camera respondeu mas a busca demorou demais. Tente de novo.", true); g_ws = WS_IDLE;
        } else if (agora - g_ws_tl > 2500 && !g_scan_ult_ms) { g_ws_tl = agora; wifi_envia_scan_req(); }
        break; }

    case WS_CACA: {                                       // varre 1..13 (so porque o BUSCAR nao achou a camera)
        if (g_ws_t0 == 0 || agora - g_ws_t0 > 1300) {
            if (g_cam_vista_ms && g_ws_t0) {              // achou: trava neste canal
                canal_gravar(g_canal_disp);
                char b[80]; snprintf(b, sizeof(b), "Camera encontrada no canal %u. Buscando redes...", (unsigned)g_canal_disp); ws_msg(b);
                g_redes_n = 0; g_scan_ult_ms = 0; wifi_envia_scan_req();
                g_ws = WS_SCAN_ESPERA; g_ws_t0 = g_ws_tl = agora; break;
            }
            g_ws_n++;
            if (g_ws_n > 13) {                            // nao achou em nenhum: volta ao canal de antes
                radio_set_canal(g_canal_ant);
                ws_msg("Camera nao encontrada em nenhum canal. Confira se esta ligada.", true); g_ws = WS_IDLE; break;
            }
            radio_set_canal(g_ws_n); g_cam_vista_ms = 0;
            wifi_envia_scan_req(); g_ws_t0 = agora;
        }
        break; }

    // ---- passo 1: camera ----
    case WS_CAM_ENVIA:
        if (g_ws_n < 4) {
            if (g_ws_tl == 0 || agora - g_ws_tl >= 250) { wifi_envia_canal(MAC_CAMERA, g_canal_alvo, true); g_ws_n++; g_ws_tl = agora ? agora : 1; }
        } else {
            radio_set_canal(g_canal_alvo); g_cam_hello_ms = 0; g_ws_voltar_cam = 1;
            g_ws = WS_CAM_ESPERA; g_ws_t0 = agora;
        }
        break;
    case WS_CAM_ESPERA:
        if (g_cam_hello_ms) {                                       // o "oi" da camera no canal novo
            radio_set_canal(g_canal_ant);
            g_ws = WS_W1_ENVIA; g_ws_n = 0; g_ws_tl = 0;
            char b[90]; snprintf(b, sizeof(b), "Passo 2/3: maquina (W1/W2) -> canal %u", (unsigned)g_canal_alvo); ws_msg(b);
            wifi_mig_nvs(2, g_canal_alvo);
        } else if (agora - g_ws_t0 > 7000) wifi_falhou("a camera nao respondeu no canal novo");
        break;

    // ---- passo 2: W1 (leva a W2) ----
    case WS_W1_ENVIA:
        if (g_ws_n < 4) {
            if (g_ws_tl == 0 || agora - g_ws_tl >= 250) { wifi_envia_canal(MAC_WAVE1, g_canal_alvo, false); g_ws_n++; g_ws_tl = agora ? agora : 1; }
        } else {
            radio_set_canal(g_canal_alvo); g_w1_hello_ms = 0; g_ws_voltar_w1 = 1;
            g_ws = WS_W1_ESPERA; g_ws_t0 = agora;
        }
        break;
    case WS_W1_ESPERA:
        if (g_w1_hello_ms || (g_st_ms > g_ws_t0 && g_st_ok)) {       // "oi" da W1 (ou um status chegando ja no canal novo)
            canal_gravar(g_canal_alvo);
            wifi_mig_nvs(3, g_canal_alvo);
            g_ws = WS_CFG_ENVIA; g_ws_n = 0; g_ws_tl = 0; g_ws_t0 = agora;
            ws_msg("Passo 3/3: entregando a rede para a camera conectar...");
        } else if (agora - g_ws_t0 > 10000) wifi_falhou("a maquina (W1) nao respondeu no canal novo");
        break;

    // ---- passo 3: credenciais (todos ja no canal da rede) ----
    case WS_CFG_ENVIA:
        if (g_ws_ssid[0] && g_ws_n < 3) {                     // (re-sync automatico: sem rede nova para entregar — a camera ja tem a rede)
            if (g_ws_tl == 0 || agora - g_ws_tl >= 300) { wifi_envia_cfg(); g_ws_n++; g_ws_tl = agora ? agora : 1; }
        } else {
            wifi_mig_nvs(0, 0);
            char b[100];
            if (g_ws_ssid[0]) snprintf(b, sizeof(b), "Rede '%s' entregue. Todos no canal %u; a camera esta conectando na internet.", g_ws_ssid, (unsigned)g_canal_disp);
            else              snprintf(b, sizeof(b), "Re-sync concluido: camera, W1 e W2 no canal %u (o roteador mudou).", (unsigned)g_canal_disp);
            ws_msg(b);
            g_ws = WS_FIM;
        }
        break;

    // ---- rollback: manda quem ja migrou voltar ao canal antigo, depois volta o proprio display ----
    case WS_VOLTA:
        if (g_ws_n < 4) {
            if (g_ws_tl == 0 || agora - g_ws_tl >= 250) {
                if (g_ws_voltar_cam) wifi_envia_canal(MAC_CAMERA, g_canal_ant, true);
                if (g_ws_voltar_w1)  wifi_envia_canal(MAC_WAVE1, g_canal_ant, false);
                g_ws_n++; g_ws_tl = agora ? agora : 1;
            }
        } else {
            radio_set_canal(g_canal_ant);
            canal_gravar(g_canal_ant);
            wifi_mig_nvs(0, 0);
            char b[100]; snprintf(b, sizeof(b), "Migracao cancelada. Tudo de volta no canal %u. Tente de novo.", (unsigned)g_canal_ant); ws_msg(b, true);
            g_ws = WS_IDLE;
        }
        break;
    default: break;
    }
}

// ================================================================ TELA =======
static lv_obj_t *scr_wifi = nullptr, *lbl_w_msg, *lbl_w_info, *lbl_w_sel;
static lv_obj_t *btn_w_rede[5], *lbl_w_rede[5];
static lv_obj_t *ta_w_ssid, *ta_w_canal, *ta_w_senha, *kb_w;
static lv_obj_t *btn_w_conectar, *lbl_w_conectar;

static void cb_w_voltar(lv_event_t*) { if (scr_principal) lv_scr_load(scr_principal); }
static void cb_w_buscar(lv_event_t*) {
    if (g_ws != WS_IDLE && g_ws != WS_FIM) return;
    if (maquina_ocupada()) { ws_msg("Bloqueado: ciclo ou HOME em andamento.", true); return; }
    wifi_buscar();
}
static void cb_w_pag(lv_event_t* e) {
    int d = (int)(intptr_t)lv_event_get_user_data(e);
    int paginas = (g_redes_n + 4) / 5;
    int np = (int)g_redes_pag + d; if (np < 0) np = 0; if (np >= paginas) np = paginas > 0 ? paginas - 1 : 0;
    g_redes_pag = (uint8_t)np;
}
static void cb_w_rede(lv_event_t* e) {
    int i = (int)g_redes_pag * 5 + (int)(intptr_t)lv_event_get_user_data(e);
    if (i < g_redes_n) { g_rede_sel = (uint8_t)i; g_manual_ssid = false; }
}
static void cb_w_manual(lv_event_t*) { g_manual_ssid = !g_manual_ssid; if (g_manual_ssid) g_rede_sel = 255; }
static void cb_w_ta(lv_event_t* e) {
    lv_obj_t* ta = (lv_obj_t*)lv_event_get_target(e);
    lv_event_code_t c = lv_event_get_code(e);
    if (c == LV_EVENT_FOCUSED || c == LV_EVENT_CLICKED) {
        lv_keyboard_set_textarea(kb_w, ta);
        lv_keyboard_set_mode(kb_w, ta == ta_w_canal ? LV_KEYBOARD_MODE_NUMBER : LV_KEYBOARD_MODE_TEXT_LOWER);
        lv_obj_clear_flag(kb_w, LV_OBJ_FLAG_HIDDEN);
    }
}
static void cb_w_kb(lv_event_t* e) {
    lv_event_code_t c = lv_event_get_code(e);
    if (c == LV_EVENT_READY || c == LV_EVENT_CANCEL) lv_obj_add_flag(kb_w, LV_OBJ_FLAG_HIDDEN);
}
static void cb_w_conectar(lv_event_t*) {
    if (g_ws != WS_IDLE && g_ws != WS_FIM) return;
    if (maquina_ocupada()) { ws_msg("Bloqueado: ciclo ou HOME em andamento.", true); return; }
    char ssid[33] = ""; uint8_t canal = 0;
    if (g_manual_ssid) {
        snprintf(ssid, sizeof(ssid), "%s", lv_textarea_get_text(ta_w_ssid));
        canal = (uint8_t)atoi(lv_textarea_get_text(ta_w_canal));
    } else if (g_rede_sel < g_redes_n) {
        snprintf(ssid, sizeof(ssid), "%s", g_redes[g_rede_sel].ssid);
        canal = g_redes[g_rede_sel].canal;
    }
    if (!ssid[0])             { ws_msg("Escolha uma rede (ou digite o nome).", true); return; }
    if (canal < 1 || canal > 13) { ws_msg("Canal invalido (1 a 13). Na rede digitada, informe o canal.", true); return; }
    if (!g_st_ok)             { ws_msg("Sem contato com a maquina (W1): nao da para migrar o canal.", true); return; }
    lv_obj_add_flag(kb_w, LV_OBJ_FLAG_HIDDEN);
    wifi_migrar(ssid, lv_textarea_get_text(ta_w_senha), canal);
}
static void cb_ir_wifi(lv_event_t*) {
    if (maquina_ocupada()) { snprintf(g_aviso, sizeof(g_aviso), "Wi-Fi bloqueado: ciclo ou HOME em andamento"); g_aviso_ms = millis(); return; }
    if (scr_wifi) lv_scr_load(scr_wifi);
}

static void ui_wifi_criar() {
    scr_wifi = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_wifi, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_wifi, LV_OBJ_FLAG_SCROLLABLE);
    novo_botao(scr_wifi, "VOLTAR", COR_AZUL, 8, 8, 150, 50, cb_w_voltar);
    lv_obj_t* t = novo_label(scr_wifi, &lv_font_montserrat_20, COR_AMARELO, 180, 20, 420);
    lv_label_set_text(t, "WI-FI (a camera e quem conecta)");
    lbl_w_info = novo_label(scr_wifi, &lv_font_montserrat_16, COR_FRACO, 560, 22, 232);
    lbl_w_msg  = novo_label(scr_wifi, &lv_font_montserrat_16, COR_AMARELO, 16, 64, 770);

    for (int i = 0; i < 5; i++)
        btn_w_rede[i] = novo_botao_cb(scr_wifi, "-", COR_CINZA, 16, 94 + i * 46, 480, 42, cb_w_rede, i, &lbl_w_rede[i]);
    novo_botao_cb(scr_wifi, "BUSCAR REDES", COR_VERDE, 512, 94, 276, 50, cb_w_buscar, 0);
    novo_botao_cb(scr_wifi, "PAG -", COR_CINZA, 512, 150, 132, 42, cb_w_pag, -1);
    novo_botao_cb(scr_wifi, "PAG +", COR_CINZA, 656, 150, 132, 42, cb_w_pag, 1);
    novo_botao_cb(scr_wifi, "OUTRA REDE (digitar)", COR_AZUL, 512, 198, 276, 42, cb_w_manual, 0);

    lbl_w_sel = novo_label(scr_wifi, &lv_font_montserrat_16, COR_TEXTO, 16, 330, 480);
    ta_w_ssid = lv_textarea_create(scr_wifi);
    lv_textarea_set_one_line(ta_w_ssid, true); lv_textarea_set_placeholder_text(ta_w_ssid, "nome da rede (SSID)");
    lv_textarea_set_max_length(ta_w_ssid, 32);
    lv_obj_set_size(ta_w_ssid, 330, 42); lv_obj_set_pos(ta_w_ssid, 16, 324);
    lv_obj_add_event_cb(ta_w_ssid, cb_w_ta, LV_EVENT_ALL, nullptr);
    ta_w_canal = lv_textarea_create(scr_wifi);
    lv_textarea_set_one_line(ta_w_canal, true); lv_textarea_set_placeholder_text(ta_w_canal, "canal 1-13");
    lv_textarea_set_max_length(ta_w_canal, 2); lv_textarea_set_accepted_chars(ta_w_canal, "0123456789");
    lv_obj_set_size(ta_w_canal, 140, 42); lv_obj_set_pos(ta_w_canal, 356, 324);
    lv_obj_add_event_cb(ta_w_canal, cb_w_ta, LV_EVENT_ALL, nullptr);
    ta_w_senha = lv_textarea_create(scr_wifi);
    lv_textarea_set_one_line(ta_w_senha, true); lv_textarea_set_password_mode(ta_w_senha, false);
    lv_textarea_set_placeholder_text(ta_w_senha, "senha da rede"); lv_textarea_set_max_length(ta_w_senha, 64);
    lv_obj_set_size(ta_w_senha, 480, 42); lv_obj_set_pos(ta_w_senha, 16, 372);
    lv_obj_add_event_cb(ta_w_senha, cb_w_ta, LV_EVENT_ALL, nullptr);
    btn_w_conectar = novo_botao_cb(scr_wifi, "CONECTAR", COR_VERDE, 512, 324, 276, 90, cb_w_conectar, 0, &lbl_w_conectar);

    kb_w = lv_keyboard_create(scr_wifi);
    lv_obj_set_size(kb_w, 800, 250); lv_obj_align(kb_w, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_add_event_cb(kb_w, cb_w_kb, LV_EVENT_ALL, nullptr);
    lv_obj_add_flag(kb_w, LV_OBJ_FLAG_HIDDEN);
}

static void ui_atualizar_wifi(bool contato) {
    char b[120];
    lv_label_set_text(lbl_w_msg, g_ws_msg);
    lv_obj_set_style_text_color(lbl_w_msg, g_ws_msg_erro ? COR_VERMELHO : COR_AMARELO, 0);
    uint32_t cv = g_cam_vista_ms;
    snprintf(b, sizeof(b), "Canal: %u  W1: %s\nCamera: %s", (unsigned)g_canal_disp, contato ? "ok" : "sem contato",
             cv ? "vista" : "nao vista");
    lv_label_set_text(lbl_w_info, b);
    int paginas = (g_redes_n + 4) / 5;
    for (int i = 0; i < 5; i++) {
        int k = (int)g_redes_pag * 5 + i;
        if (k < g_redes_n) {
            snprintf(b, sizeof(b), "%s   (canal %u, %d dBm)", g_redes[k].ssid, (unsigned)g_redes[k].canal, (int)g_redes[k].rssi);
            lv_label_set_text(lbl_w_rede[i], b);
            lv_obj_set_style_bg_color(btn_w_rede[i], (k == g_rede_sel) ? COR_VERDE : COR_CINZA, 0);
            lv_obj_clear_flag(btn_w_rede[i], LV_OBJ_FLAG_HIDDEN);
        } else lv_obj_add_flag(btn_w_rede[i], LV_OBJ_FLAG_HIDDEN);
    }
    if (g_manual_ssid) {
        lv_obj_clear_flag(ta_w_ssid, LV_OBJ_FLAG_HIDDEN); lv_obj_clear_flag(ta_w_canal, LV_OBJ_FLAG_HIDDEN);
        lv_label_set_text(lbl_w_sel, "");
    } else {
        lv_obj_add_flag(ta_w_ssid, LV_OBJ_FLAG_HIDDEN); lv_obj_add_flag(ta_w_canal, LV_OBJ_FLAG_HIDDEN);
        if (g_rede_sel < g_redes_n) snprintf(b, sizeof(b), "Rede escolhida: %s (canal %u)", g_redes[g_rede_sel].ssid, (unsigned)g_redes[g_rede_sel].canal);
        else snprintf(b, sizeof(b), paginas ? "Escolha uma rede da lista (pagina %d/%d)." : "Sem redes: toque em BUSCAR REDES.", (int)g_redes_pag + 1, paginas);
        lv_label_set_text(lbl_w_sel, b);
    }
    bool ocupado = (g_ws != WS_IDLE && g_ws != WS_FIM);
    lv_label_set_text(lbl_w_conectar, ocupado ? "AGUARDE..." : "CONECTAR");
    lv_obj_set_style_bg_color(btn_w_conectar, ocupado ? COR_CINZA : COR_VERDE, 0);
}
