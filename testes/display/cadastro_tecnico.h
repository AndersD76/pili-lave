// =======================================================================
// cadastro_tecnico.h — CADASTRO DA MAQUINA no display (aba TECNICO > REDE > CADASTRO). Porta de lava_car_485/display/tela_boot.h.
// COMPILADO, AINDA NAO TESTADO COM A CAMERA.
//   NOVA MAQUINA      : busca unidades ja cadastradas na cidade (evita duplicar unidade por endereco digitado diferente), escolhe uma
//                       (numero ja vem preenchido) ou cria unidade nova (cidade + rua + numero); a camera faz o POST no backend.
//   TROCOU O DISPLAY  : pergunta para a CAMERA local "quem e voce?" (so responde se ela estiver ao alcance do radio) e grava a identidade.
//   TROCOU A CAMERA   : o display empurra para a camera nova a identidade que ja tem.
// IDENTIDADE na MESMA area da NVS do firmware antigo (namespace "lavadora": device_key, provisionado, uni_cidade, uni_rua, maq_numero),
// entao o que ja estava gravado neste display continua valendo, e o firmware antigo tambem a reconhece se for preciso voltar.
// O deviceKey e gerado UMA vez a partir do chip do display (disp_<MAC>), como antes.
// =======================================================================
#pragma once

// ------------------------------------------------------------ identidade ---
static String cad_device_key() { Preferences p; String k = ""; if (p.begin("lavadora", true)) { k = p.getString("device_key", ""); p.end(); } return k; }
static bool   cad_provisionado() { Preferences p; bool v = false; if (p.begin("lavadora", true)) { v = p.getBool("provisionado", false); p.end(); } return v; }
static String cad_gerar_device_key() {
    String k = cad_device_key(); if (k.length() > 0) return k;
    uint64_t chip = ESP.getEfuseMac(); char buf[24]; snprintf(buf, sizeof(buf), "disp_%012llX", (unsigned long long)chip);
    Preferences p; if (p.begin("lavadora", false)) { p.putString("device_key", String(buf)); p.end(); }
    return String(buf);
}
static void cad_salvar_identidade(const char* cidade, const char* rua, uint16_t numero) {
    Preferences p; if (!p.begin("lavadora", false)) return;
    p.putString("uni_cidade", cidade); p.putString("uni_rua", rua); p.putUShort("maq_numero", numero); p.putBool("provisionado", true); p.end();
}
static void cad_salvar_chave(const char* chave) { Preferences p; if (p.begin("lavadora", false)) { p.putString("device_key", chave); p.end(); } }
static String cad_resumo() {
    Preferences p; String c = "", r = ""; uint16_t n = 0; bool prov = false;
    if (p.begin("lavadora", true)) { c = p.getString("uni_cidade", ""); r = p.getString("uni_rua", ""); n = p.getUShort("maq_numero", 0); prov = p.getBool("provisionado", false); p.end(); }
    if (!prov) return String("Esta maquina NAO esta cadastrada neste display.");
    return String("Cadastrada: ") + c + " - " + r + " - maquina " + String((unsigned)n);
}

// ---------------------------------------------------- recepcao (callback) ---
static volatile bool g_cad_prov_chegou = false;  static volatile uint8_t g_cad_prov_ok = 0;  static volatile uint16_t g_cad_prov_numero = 0;
static char g_cad_prov_cidade[32] = {0}, g_cad_prov_rua[40] = {0}, g_cad_prov_erro[48] = {0};
static volatile bool g_cad_ident_chegou = false; static volatile uint8_t g_cad_ident_tem = 0;  static volatile uint16_t g_cad_ident_numero = 0;
static char g_cad_ident_key[24] = {0}, g_cad_ident_cidade[32] = {0}, g_cad_ident_rua[40] = {0};
static volatile bool g_cad_idpush_chegou = false; static volatile bool g_cad_idpush_ok = false;
#define CAD_UNI_MAX 15
static char    g_uni_id[CAD_UNI_MAX][UNI_STATIONID_LEN], g_uni_rua[CAD_UNI_MAX][UNI_RUA_LEN];
static uint8_t g_uni_prox[CAD_UNI_MAX];
static uint8_t g_uni_n = 0;
static volatile uint32_t g_uni_ult_ms = 0;  static volatile bool g_uni_fim = false;  static volatile uint8_t g_uni_total_pag = 255;

static void cad_on_recv(const uint8_t* data, int len) {
    const CabEspNow* c = (const CabEspNow*)data;
    if (c->tipo == MSG_PROV_RESP && len >= (int)sizeof(MsgProvResp)) {
        const MsgProvResp* r = (const MsgProvResp*)data;
        g_cad_prov_ok = r->ok; g_cad_prov_numero = r->numero;
        strncpy(g_cad_prov_cidade, r->cidade, sizeof(g_cad_prov_cidade) - 1); strncpy(g_cad_prov_rua, r->rua, sizeof(g_cad_prov_rua) - 1);
        strncpy(g_cad_prov_erro, r->erro, sizeof(g_cad_prov_erro) - 1); g_cad_prov_chegou = true;
    } else if (c->tipo == MSG_IDENT_RESP && len >= (int)sizeof(MsgIdentResp)) {
        const MsgIdentResp* r = (const MsgIdentResp*)data;
        g_cad_ident_tem = r->temIdentidade; g_cad_ident_numero = r->numero;
        strncpy(g_cad_ident_key, r->deviceKey, sizeof(g_cad_ident_key) - 1); strncpy(g_cad_ident_cidade, r->cidade, sizeof(g_cad_ident_cidade) - 1);
        strncpy(g_cad_ident_rua, r->rua, sizeof(g_cad_ident_rua) - 1); g_cad_ident_chegou = true;
    } else if (c->tipo == MSG_IDPUSH_RESP && len >= (int)sizeof(MsgIdPushResp)) {
        g_cad_idpush_ok = ((const MsgIdPushResp*)data)->ok != 0; g_cad_idpush_chegou = true;
    } else if (c->tipo == MSG_UNI_RESP && len >= (int)sizeof(MsgUniResp)) {
        const MsgUniResp* r = (const MsgUniResp*)data;
        for (int i = 0; i < r->n && i < UNI_POR_PAGINA; i++) {
            int idx = r->pagina * UNI_POR_PAGINA + i; if (idx >= CAD_UNI_MAX) break;
            strncpy(g_uni_id[idx], r->unidades[i].stationId, UNI_STATIONID_LEN - 1); strncpy(g_uni_rua[idx], r->unidades[i].rua, UNI_RUA_LEN - 1);
            g_uni_prox[idx] = r->unidades[i].proximoNumero; if (idx + 1 > g_uni_n) g_uni_n = idx + 1;
        }
        g_uni_total_pag = r->total_paginas; g_uni_ult_ms = millis();
        if (r->pagina + 1 >= r->total_paginas) g_uni_fim = true;
    }
}

// ------------------------------------------------------ maquina de estados ---
enum CdEstado : uint8_t { CD_IDLE = 0, CD_UNI, CD_PROV, CD_IDENT, CD_IDPUSH };
static uint8_t  g_cd = CD_IDLE;
static uint32_t g_cd_t0 = 0, g_cd_tl = 0;
static char     g_cd_msg[140] = "";  static bool g_cd_erro = false;
static char     g_cad_busca_cidade[32] = "";                       // cidade da busca de unidades
static char     g_cd_cidade[32] = "", g_cd_rua[40] = "", g_cd_station[28] = ""; static uint16_t g_cd_numero = 0;   // pedido de cadastro em curso
static void cd_msg(const char* m, bool erro = false) { snprintf(g_cd_msg, sizeof(g_cd_msg), "%s", m); g_cd_erro = erro; }
static void cad_envia(const void* msg, size_t len) { esp_now_send((uint8_t*)MAC_CAMERA, (const uint8_t*)msg, len); esp_now_send((uint8_t*)BC_ALL, (const uint8_t*)msg, len); }
static CabEspNow cad_cab(uint8_t tipo) { CabEspNow c = {}; c.tipo = tipo; c.id_maquina = ID_MAQUINA; c.origem = ORIGEM_DISPLAY; c.seq = g_seq++; return c; }

static void cad_buscar_unidades(const char* cidade) {
    g_uni_n = 0; g_uni_fim = false; g_uni_total_pag = 255; g_uni_ult_ms = 0;
    MsgUniReq m = {}; m.cab = cad_cab(MSG_UNI_REQ); strncpy(m.cidade, cidade, sizeof(m.cidade) - 1); cad_envia(&m, sizeof(m));
    g_cd = CD_UNI; g_cd_t0 = g_cd_tl = millis(); cd_msg("Buscando unidades ja cadastradas...");
}
static void cad_enviar_prov() {
    MsgProvReq m = {}; m.cab = cad_cab(MSG_PROV_REQ);
    String k = cad_gerar_device_key(); strncpy(m.deviceKey, k.c_str(), sizeof(m.deviceKey) - 1);
    strncpy(m.cidade, g_cd_cidade, sizeof(m.cidade) - 1); strncpy(m.rua, g_cd_rua, sizeof(m.rua) - 1);
    m.numero = g_cd_numero; strncpy(m.stationId, g_cd_station, sizeof(m.stationId) - 1);
    cad_envia(&m, sizeof(m));
}
static void cad_iniciar_prov(const char* cidade, const char* rua, uint16_t numero, const char* station) {
    snprintf(g_cd_cidade, sizeof(g_cd_cidade), "%s", cidade); snprintf(g_cd_rua, sizeof(g_cd_rua), "%s", rua);
    snprintf(g_cd_station, sizeof(g_cd_station), "%s", station); g_cd_numero = numero;
    g_cad_prov_chegou = false; cad_enviar_prov();
    g_cd = CD_PROV; g_cd_t0 = g_cd_tl = millis(); cd_msg("Cadastrando (a camera fala com a nuvem)...");
}
static void cad_iniciar_ident() {
    g_cad_ident_chegou = false; MsgIdentReq m = {}; m.cab = cad_cab(MSG_IDENT_REQ); cad_envia(&m, sizeof(m));
    g_cd = CD_IDENT; g_cd_t0 = g_cd_tl = millis(); cd_msg("Perguntando a camera quem ela e (precisa estar perto)...");
}
static void cad_enviar_idpush() {
    Preferences p; String c = "", r = ""; uint16_t n = 0;
    if (p.begin("lavadora", true)) { c = p.getString("uni_cidade", ""); r = p.getString("uni_rua", ""); n = p.getUShort("maq_numero", 0); p.end(); }
    MsgIdPushReq m = {}; m.cab = cad_cab(MSG_IDPUSH_REQ); String k = cad_device_key();
    strncpy(m.deviceKey, k.c_str(), sizeof(m.deviceKey) - 1); strncpy(m.cidade, c.c_str(), sizeof(m.cidade) - 1); strncpy(m.rua, r.c_str(), sizeof(m.rua) - 1); m.numero = n;
    cad_envia(&m, sizeof(m));
}
static void cad_iniciar_idpush() {
    if (!cad_provisionado() || cad_device_key().length() == 0) { cd_msg("Este display nao tem identidade salva. Use NOVA MAQUINA ou TROCOU O DISPLAY primeiro.", true); return; }
    g_cad_idpush_chegou = false; cad_enviar_idpush();
    g_cd = CD_IDPUSH; g_cd_t0 = g_cd_tl = millis(); cd_msg("Enviando a identidade para a camera nova...");
}

static void cad_tick() {
    uint32_t agora = millis();
    switch (g_cd) {
    case CD_UNI:
        if (g_uni_fim || (g_uni_ult_ms && agora - g_uni_ult_ms > 3000)) {
            char b[80];
            if (g_uni_n == 0) snprintf(b, sizeof(b), "Nenhuma unidade encontrada nessa cidade: escolha UNIDADE NOVA.");
            else snprintf(b, sizeof(b), "%u unidade(s) encontrada(s). Escolha uma ou UNIDADE NOVA.", (unsigned)g_uni_n);
            cd_msg(b); g_cd = CD_IDLE;
        } else if (!g_uni_ult_ms && agora - g_cd_tl > 2500 && agora - g_cd_t0 < 10000) {
            g_cd_tl = agora;                                              // ainda sem nada da camera: repete o pedido
            MsgUniReq m = {}; m.cab = cad_cab(MSG_UNI_REQ); strncpy(m.cidade, g_cad_busca_cidade, sizeof(m.cidade) - 1); cad_envia(&m, sizeof(m));
        } else if (!g_uni_ult_ms && agora - g_cd_t0 >= 10000) { cd_msg("A camera nao respondeu. Confira se esta ligada (ou use WI-FI > BUSCAR REDES para acha-la).", true); g_cd = CD_IDLE; }
        break;
    case CD_PROV:
        if (g_cad_prov_chegou) {
            g_cad_prov_chegou = false;
            if (g_cad_prov_ok) {
                cad_salvar_identidade(g_cad_prov_cidade, g_cad_prov_rua, g_cad_prov_numero);
                char b[140]; snprintf(b, sizeof(b), "CADASTRADA: %s - %s - maquina %u.", g_cad_prov_cidade, g_cad_prov_rua, (unsigned)g_cad_prov_numero);
                cd_msg(b);
            } else { char b[140]; snprintf(b, sizeof(b), "Cadastro recusado: %s", g_cad_prov_erro[0] ? g_cad_prov_erro : "sem detalhe"); cd_msg(b, true); }
            g_cd = CD_IDLE;
        } else if (agora - g_cd_tl > 3000 && agora - g_cd_t0 < 20000) { g_cd_tl = agora; cad_enviar_prov(); }
        else if (agora - g_cd_t0 >= 20000) { cd_msg("A camera nao confirmou o cadastro (sem internet?). Tente de novo.", true); g_cd = CD_IDLE; }
        break;
    case CD_IDENT:
        if (g_cad_ident_chegou) {
            g_cad_ident_chegou = false;
            if (g_cad_ident_tem) {
                cad_salvar_chave(g_cad_ident_key); cad_salvar_identidade(g_cad_ident_cidade, g_cad_ident_rua, g_cad_ident_numero);
                char b[140]; snprintf(b, sizeof(b), "IDENTIDADE RECUPERADA: %s - %s - maquina %u.", g_cad_ident_cidade, g_cad_ident_rua, (unsigned)g_cad_ident_numero); cd_msg(b);
            } else cd_msg("Essa camera nunca foi cadastrada: use NOVA MAQUINA.", true);
            g_cd = CD_IDLE;
        } else if (agora - g_cd_tl > 2000 && agora - g_cd_t0 < 20000) { g_cd_tl = agora; MsgIdentReq m = {}; m.cab = cad_cab(MSG_IDENT_REQ); cad_envia(&m, sizeof(m)); }
        else if (agora - g_cd_t0 >= 20000) { cd_msg("Nenhuma camera respondeu. Ela precisa estar ligada e perto (o radio e de curto alcance).", true); g_cd = CD_IDLE; }
        break;
    case CD_IDPUSH:
        if (g_cad_idpush_chegou) { g_cad_idpush_chegou = false; if (g_cad_idpush_ok) cd_msg("A camera nova aprendeu a identidade desta maquina."); else cd_msg("A camera recusou a identidade.", true); g_cd = CD_IDLE; }
        else if (agora - g_cd_tl > 2000 && agora - g_cd_t0 < 15000) { g_cd_tl = agora; cad_enviar_idpush(); }
        else if (agora - g_cd_t0 >= 15000) { cd_msg("A camera nao respondeu. Confira se esta ligada e perto.", true); g_cd = CD_IDLE; }
        break;
    default: break;
    }
}

// ================================================================ TELAS =======
static lv_obj_t *scr_rede = nullptr, *scr_cad = nullptr, *scr_cad_nova = nullptr;
static lv_obj_t *lbl_cad_ident, *lbl_cad_msg, *lbl_cn_msg, *lbl_cn_sel;
static lv_obj_t *ta_cn_cidade, *ta_cn_rua, *ta_cn_num, *kb_cad;
static lv_obj_t *btn_cn_uni[5], *lbl_cn_uni[5];
static lv_obj_t *btn_cn_enviar;
static uint8_t g_cn_sel = 255;            // unidade escolhida da lista (255 = nenhuma)
static bool    g_cn_nova = false;         // "UNIDADE NOVA": digita rua tambem
static uint8_t g_cn_pag = 0;

static void cb_cad_voltar_tec(lv_event_t*) { if (scr_principal) lv_scr_load(scr_principal); }
static void cb_ir_rede(lv_event_t*)  { if (scr_rede) lv_scr_load(scr_rede); }
static void cb_rede_wifi(lv_event_t*)    { if (scr_wifi) lv_scr_load(scr_wifi); }
static void cb_rede_cad(lv_event_t*)     { if (scr_cad) lv_scr_load(scr_cad); }
static void cb_cad_voltar_rede(lv_event_t*) { if (scr_rede) lv_scr_load(scr_rede); }
static void cb_cn_voltar(lv_event_t*) { if (scr_cad) lv_scr_load(scr_cad); }
static void cb_cad_nova(lv_event_t*) {
    g_cn_sel = 255; g_cn_nova = false; g_cn_pag = 0; g_uni_n = 0;
    lv_textarea_set_text(ta_cn_cidade, ""); lv_textarea_set_text(ta_cn_rua, ""); lv_textarea_set_text(ta_cn_num, "");
    if (g_cd == CD_IDLE) cd_msg("Digite a cidade e toque em BUSCAR UNIDADES.");
    if (scr_cad_nova) lv_scr_load(scr_cad_nova);
}
static void cb_cad_subst(lv_event_t*)  { if (g_cd == CD_IDLE) cad_iniciar_ident(); }
static void cb_cad_idpush(lv_event_t*) { if (g_cd == CD_IDLE) cad_iniciar_idpush(); }
static void cb_cad_ta(lv_event_t* e) {
    lv_obj_t* ta = (lv_obj_t*)lv_event_get_target(e); lv_event_code_t c = lv_event_get_code(e);
    if (c == LV_EVENT_FOCUSED || c == LV_EVENT_CLICKED) {
        lv_keyboard_set_textarea(kb_cad, ta);
        lv_keyboard_set_mode(kb_cad, ta == ta_cn_num ? LV_KEYBOARD_MODE_NUMBER : LV_KEYBOARD_MODE_TEXT_LOWER);
        lv_obj_clear_flag(kb_cad, LV_OBJ_FLAG_HIDDEN);
    }
}
static void cb_cad_kb(lv_event_t* e) { lv_event_code_t c = lv_event_get_code(e); if (c == LV_EVENT_READY || c == LV_EVENT_CANCEL) lv_obj_add_flag(kb_cad, LV_OBJ_FLAG_HIDDEN); }
static void cb_cn_buscar(lv_event_t*) {
    if (g_cd != CD_IDLE) return;
    snprintf(g_cad_busca_cidade, sizeof(g_cad_busca_cidade), "%s", lv_textarea_get_text(ta_cn_cidade));
    if (strlen(g_cad_busca_cidade) < 2) { cd_msg("Digite pelo menos 2 letras da cidade.", true); return; }
    g_cn_sel = 255; g_cn_nova = false; g_cn_pag = 0; lv_obj_add_flag(kb_cad, LV_OBJ_FLAG_HIDDEN);
    cad_buscar_unidades(g_cad_busca_cidade);
}
static void cb_cn_uni(lv_event_t* e) {
    int i = (int)g_cn_pag * 5 + (int)(intptr_t)lv_event_get_user_data(e);
    if (i < g_uni_n) { g_cn_sel = (uint8_t)i; g_cn_nova = false; char n[8]; snprintf(n, sizeof(n), "%u", (unsigned)g_uni_prox[i]); lv_textarea_set_text(ta_cn_num, n); }
}
static void cb_cn_nova(lv_event_t*) { g_cn_nova = true; g_cn_sel = 255; lv_textarea_set_text(ta_cn_num, ""); }
static void cb_cn_pag(lv_event_t* e) {
    int d = (int)(intptr_t)lv_event_get_user_data(e); int pag = (g_uni_n + 4) / 5; int np = (int)g_cn_pag + d;
    if (np < 0) np = 0; if (np >= pag) np = pag > 0 ? pag - 1 : 0; g_cn_pag = (uint8_t)np;
}
static void cb_cn_enviar(lv_event_t*) {
    if (g_cd != CD_IDLE) return;
    uint16_t num = (uint16_t)atoi(lv_textarea_get_text(ta_cn_num));
    lv_obj_add_flag(kb_cad, LV_OBJ_FLAG_HIDDEN);
    if (g_cn_sel < g_uni_n) { cad_iniciar_prov("", "", num, g_uni_id[g_cn_sel]); return; }            // unidade existente: o backend ja sabe cidade/rua
    if (g_cn_nova) {
        const char* c = lv_textarea_get_text(ta_cn_cidade); const char* r = lv_textarea_get_text(ta_cn_rua);
        if (strlen(c) < 2 || strlen(r) < 2) { cd_msg("Unidade nova: preencha cidade e rua.", true); return; }
        cad_iniciar_prov(c, r, num, ""); return;
    }
    cd_msg("Escolha uma unidade da lista ou toque em UNIDADE NOVA.", true);
}

static void ui_cad_criar() {
    // ---- hub REDE ----
    scr_rede = lv_obj_create(nullptr); lv_obj_set_style_bg_color(scr_rede, COR_FUNDO, 0); lv_obj_clear_flag(scr_rede, LV_OBJ_FLAG_SCROLLABLE);
    novo_botao(scr_rede, "VOLTAR", COR_AZUL, 8, 8, 150, 50, cb_cad_voltar_tec);
    lv_obj_t* t = novo_label(scr_rede, &lv_font_montserrat_20, COR_AMARELO, 180, 20, 400); lv_label_set_text(t, "REDE E CADASTRO");
    novo_botao_cb(scr_rede, "WI-FI", COR_AZUL, 16, 110, 376, 130, cb_rede_wifi, 0);
    novo_botao_cb(scr_rede, "CADASTRO DA MAQUINA", COR_AZUL, 408, 110, 376, 130, cb_rede_cad, 0);
    lv_obj_t* h = novo_label(scr_rede, &lv_font_montserrat_16, COR_FRACO, 16, 270, 770);
    lv_label_set_text(h, "WI-FI: a camera escolhe e conecta na rede. CADASTRO: nova maquina, troca de display ou de camera.");

    // ---- menu CADASTRO ----
    scr_cad = lv_obj_create(nullptr); lv_obj_set_style_bg_color(scr_cad, COR_FUNDO, 0); lv_obj_clear_flag(scr_cad, LV_OBJ_FLAG_SCROLLABLE);
    novo_botao(scr_cad, "VOLTAR", COR_AZUL, 8, 8, 150, 50, cb_cad_voltar_rede);
    t = novo_label(scr_cad, &lv_font_montserrat_20, COR_AMARELO, 180, 20, 450); lv_label_set_text(t, "CADASTRO DA MAQUINA");
    lbl_cad_ident = novo_label(scr_cad, &lv_font_montserrat_16, COR_TEXTO, 16, 74, 770);
    novo_botao_cb(scr_cad, "NOVA MAQUINA", COR_VERDE, 16, 120, 250, 110, cb_cad_nova, 0);
    novo_botao_cb(scr_cad, "TROCOU O DISPLAY", COR_AZUL, 280, 120, 250, 110, cb_cad_subst, 0);
    novo_botao_cb(scr_cad, "TROCOU A CAMERA", COR_AZUL, 544, 120, 240, 110, cb_cad_idpush, 0);
    lbl_cad_msg = novo_label(scr_cad, &lv_font_montserrat_18, COR_AMARELO, 16, 260, 770);
    lv_obj_t* h2 = novo_label(scr_cad, &lv_font_montserrat_16, COR_FRACO, 16, 360, 770);
    lv_label_set_text(h2, "TROCOU O DISPLAY: a camera ja instalada diz quem e (precisa estar perto). TROCOU A CAMERA: este display passa a identidade para a camera nova.");

    // ---- NOVA MAQUINA ----
    scr_cad_nova = lv_obj_create(nullptr); lv_obj_set_style_bg_color(scr_cad_nova, COR_FUNDO, 0); lv_obj_clear_flag(scr_cad_nova, LV_OBJ_FLAG_SCROLLABLE);
    novo_botao(scr_cad_nova, "VOLTAR", COR_AZUL, 8, 8, 150, 50, cb_cn_voltar);
    t = novo_label(scr_cad_nova, &lv_font_montserrat_20, COR_AMARELO, 180, 20, 450); lv_label_set_text(t, "NOVA MAQUINA");
    lbl_cn_msg = novo_label(scr_cad_nova, &lv_font_montserrat_16, COR_AMARELO, 16, 62, 770);
    ta_cn_cidade = lv_textarea_create(scr_cad_nova); lv_textarea_set_one_line(ta_cn_cidade, true); lv_textarea_set_placeholder_text(ta_cn_cidade, "cidade");
    lv_textarea_set_max_length(ta_cn_cidade, 31); lv_obj_set_size(ta_cn_cidade, 380, 42); lv_obj_set_pos(ta_cn_cidade, 16, 90);
    lv_obj_add_event_cb(ta_cn_cidade, cb_cad_ta, LV_EVENT_ALL, nullptr);
    novo_botao_cb(scr_cad_nova, "BUSCAR UNIDADES", COR_VERDE, 410, 90, 250, 42, cb_cn_buscar, 0);
    for (int i = 0; i < 5; i++) btn_cn_uni[i] = novo_botao_cb(scr_cad_nova, "-", COR_CINZA, 16, 138 + i * 36, 640, 32, cb_cn_uni, i, &lbl_cn_uni[i]);
    novo_botao_cb(scr_cad_nova, "PAG -", COR_CINZA, 668, 138, 116, 32, cb_cn_pag, -1);
    novo_botao_cb(scr_cad_nova, "PAG +", COR_CINZA, 668, 174, 116, 32, cb_cn_pag, 1);
    novo_botao_cb(scr_cad_nova, "UNIDADE NOVA", COR_AZUL, 668, 210, 116, 68, cb_cn_nova, 0);
    lbl_cn_sel = novo_label(scr_cad_nova, &lv_font_montserrat_16, COR_TEXTO, 16, 322, 770);
    ta_cn_rua = lv_textarea_create(scr_cad_nova); lv_textarea_set_one_line(ta_cn_rua, true); lv_textarea_set_placeholder_text(ta_cn_rua, "rua (so unidade nova)");
    lv_textarea_set_max_length(ta_cn_rua, 39); lv_obj_set_size(ta_cn_rua, 380, 42); lv_obj_set_pos(ta_cn_rua, 16, 348);
    lv_obj_add_event_cb(ta_cn_rua, cb_cad_ta, LV_EVENT_ALL, nullptr);
    ta_cn_num = lv_textarea_create(scr_cad_nova); lv_textarea_set_one_line(ta_cn_num, true); lv_textarea_set_placeholder_text(ta_cn_num, "no da maquina (0 = proximo livre)");
    lv_textarea_set_max_length(ta_cn_num, 3); lv_textarea_set_accepted_chars(ta_cn_num, "0123456789"); lv_obj_set_size(ta_cn_num, 380, 42); lv_obj_set_pos(ta_cn_num, 16, 396);
    lv_obj_add_event_cb(ta_cn_num, cb_cad_ta, LV_EVENT_ALL, nullptr);
    btn_cn_enviar = novo_botao_cb(scr_cad_nova, "CADASTRAR", COR_VERDE, 420, 348, 364, 90, cb_cn_enviar, 0);
    kb_cad = lv_keyboard_create(scr_cad_nova); lv_obj_set_size(kb_cad, 800, 250); lv_obj_align(kb_cad, LV_ALIGN_BOTTOM_MID, 0, 0);
    lv_obj_add_event_cb(kb_cad, cb_cad_kb, LV_EVENT_ALL, nullptr); lv_obj_add_flag(kb_cad, LV_OBJ_FLAG_HIDDEN);
}

static void ui_atualizar_cad(bool contato) {
    (void)contato;
    lv_obj_t* a = lv_scr_act();
    if (a == scr_cad) {
        static uint32_t t_res = 0; static String resumo = "";
        if (resumo.length() == 0 || millis() - t_res > 2000) { resumo = cad_resumo(); t_res = millis(); }   // (nao le a NVS a cada 200 ms)
        lv_label_set_text(lbl_cad_ident, resumo.c_str());
        lv_label_set_text(lbl_cad_msg, g_cd_msg); lv_obj_set_style_text_color(lbl_cad_msg, g_cd_erro ? COR_VERMELHO : COR_AMARELO, 0);
    } else if (a == scr_cad_nova) {
        lv_label_set_text(lbl_cn_msg, g_cd_msg); lv_obj_set_style_text_color(lbl_cn_msg, g_cd_erro ? COR_VERMELHO : COR_AMARELO, 0);
        char b[110]; int paginas = (g_uni_n + 4) / 5;
        for (int i = 0; i < 5; i++) {
            int k = (int)g_cn_pag * 5 + i;
            if (k < g_uni_n) { snprintf(b, sizeof(b), "%s  (proximo no: %u)", g_uni_rua[k][0] ? g_uni_rua[k] : "(sem rua)", (unsigned)g_uni_prox[k]);
                lv_label_set_text(lbl_cn_uni[i], b); lv_obj_set_style_bg_color(btn_cn_uni[i], (k == g_cn_sel) ? COR_VERDE : COR_CINZA, 0); lv_obj_clear_flag(btn_cn_uni[i], LV_OBJ_FLAG_HIDDEN); }
            else lv_obj_add_flag(btn_cn_uni[i], LV_OBJ_FLAG_HIDDEN);
        }
        if (g_cn_sel < g_uni_n) snprintf(b, sizeof(b), "Unidade escolhida: %s. Confira o numero da maquina e toque em CADASTRAR.", g_uni_rua[g_cn_sel]);
        else if (g_cn_nova)     snprintf(b, sizeof(b), "UNIDADE NOVA: preencha a rua e o numero da maquina (0 = proximo livre).");
        else                    snprintf(b, sizeof(b), paginas ? "Escolha uma unidade (pagina %d/%d) ou UNIDADE NOVA." : "Busque a cidade para ver as unidades ja cadastradas.", (int)g_cn_pag + 1, paginas);
        lv_label_set_text(lbl_cn_sel, b);
        if (g_cn_nova) lv_obj_clear_flag(ta_cn_rua, LV_OBJ_FLAG_HIDDEN); else lv_obj_add_flag(ta_cn_rua, LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_bg_color(btn_cn_enviar, (g_cd == CD_IDLE) ? COR_VERDE : COR_CINZA, 0);
    }
}
