/*
  testes/display — Display Waveshare ESP32-S3-Touch-LCD-7, projeto de TESTES
  (etapa 0: Alta Pressao em bancada). UMA tela so: sem automatico, sem modelos,
  sem velocidades, sem Wi-Fi/nuvem/licenca. Fala so com a Waveshare 1 por ESP-NOW
  (canal fixo 1) usando protocolo_teste.h.

  Config Arduino: ESP32S3 Dev Module, 16MB, Partition Huge APP, PSRAM OPI,
  240MHz, QIO, USB CDC On Boot Disabled.
*/
#include <Arduino.h>
#include <esp_display_panel.hpp>
#include <lvgl.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <Preferences.h>
#include "lvgl_v8_port.h"
#include "protocolo_teste.h"
#include "logo_pili.h"   // logo Pili (220x86, RGB565, fundo preto) — a mesma do display de producao

using namespace esp_panel::drivers;
using namespace esp_panel::board;

// ---------------------------------------------------------------- cores ----
#define COR_FUNDO     lv_color_hex(0x10151C)
#define COR_TEXTO     lv_color_hex(0xFFFFFF)
#define COR_FRACO     lv_color_hex(0x9AA5B1)
#define COR_VERDE     lv_color_hex(0x00C853)
#define COR_AMARELO   lv_color_hex(0xFFD600)
#define COR_VERMELHO  lv_color_hex(0xE53935)
#define COR_AZUL      lv_color_hex(0x1E5FA8)
#define COR_CINZA     lv_color_hex(0x444C56)

// ------------------------------------------------------- ESP-NOW (W1) ------
static MsgTesteStatus g_st;
static volatile uint32_t g_st_ms = 0;
static volatile bool     g_st_ok = false;
static uint8_t           g_seq = 0;

// Cache da configuracao da W1: [tabela 0..4][modelo (ou 0)][14 valores]
static uint16_t g_cfg[6][4][14];
static bool     g_cfg_ok[6][4];

static void wifi_on_recv(const uint8_t* data, int len);    // wifi_tecnico.h
static void nd_on_recv(const uint8_t* data, int len);      // nuvem_display.h

static void on_recv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
    if (len < (int)sizeof(CabEspNow)) return;
    const CabEspNow* c = (const CabEspNow*)data;
    if (c->id_maquina != ID_MAQUINA) return;
    if (c->origem == ORIGEM_CAMERA && (c->tipo == MSG_HB_RESP || c->tipo == MSG_EVT_ACK)) { nd_on_recv(data, len); return; }   // nuvem: resposta do backend
    if (c->origem == ORIGEM_WAVE1 && c->tipo == MSG_NV_EVT) { nd_on_recv(data, len); return; }                                   // evento da W1
    if (c->origem == ORIGEM_CAMERA || (c->origem == ORIGEM_WAVE1 && c->tipo == MSG_CANAL)) { wifi_on_recv(data, len); return; }   // camera / "oi" da W1
    if (c->origem != ORIGEM_WAVE1) return;
    if (c->tipo == MSG_TESTE_STATUS && len >= (int)sizeof(MsgTesteStatus)) {
        memcpy(&g_st, data, sizeof(g_st));
        g_st_ms = millis();
        g_st_ok = true;
    } else if (c->tipo == MSG_TESTE_CFG_DUMP && len >= (int)sizeof(MsgTesteCfgDump)) {
        const MsgTesteCfgDump* d = (const MsgTesteCfgDump*)data;
        if (d->tabela <= 5 && d->i1 < 4) {
            memcpy(g_cfg[d->tabela][d->i1], d->v, sizeof(d->v));
            g_cfg_ok[d->tabela][d->i1] = true;
        }
    }
}

// Sem confirmacao no ESP-NOW: comandos criticos (PARAR) saem repetidos.
static void enviar(uint8_t acao, uint8_t repeticoes = 1, uint8_t arg = 0) {
    MsgTesteCmd m;
    m.cab.tipo = MSG_TESTE_CMD; m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_seq++;
    m.acao = acao; m.arg = arg;
    for (uint8_t i = 0; i < repeticoes; i++) {
        esp_now_send((uint8_t*)MAC_WAVE1, (uint8_t*)&m, sizeof(m));
        if (i + 1 < repeticoes) delay(25);
    }
}

static void cfg_pedir(uint8_t tabela, uint8_t i1) {
    MsgTesteCfgReq r;
    r.cab.tipo = MSG_TESTE_CFG_REQ; r.cab.id_maquina = ID_MAQUINA; r.cab.origem = ORIGEM_DISPLAY; r.cab.seq = g_seq++;
    r.tabela = tabela; r.i1 = i1;
    esp_now_send((uint8_t*)MAC_WAVE1, (uint8_t*)&r, sizeof(r));
}
// Valor ABSOLUTO (repetir e seguro). Sai 2x porque o ESP-NOW broadcast/unicast nao tem confirmacao aqui.
static void cfg_set(uint8_t tabela, uint8_t i1, uint8_t i2, uint16_t valor) {
    MsgTesteCfgSet m;
    m.cab.tipo = MSG_TESTE_CFG_SET; m.cab.id_maquina = ID_MAQUINA; m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_seq++;
    m.tabela = tabela; m.i1 = i1; m.i2 = i2; m.valor = valor;
    for (int k = 0; k < 2; k++) { esp_now_send((uint8_t*)MAC_WAVE1, (uint8_t*)&m, sizeof(m)); if (k == 0) delay(25); }
}

// ---- canal do radio: guardado na NVS (namespace "rede"); a maquina nova nasce no canal 1 ----
static uint8_t g_canal_disp = ESPNOW_CANAL;
static void radio_set_canal(uint8_t ch) {
    esp_wifi_set_promiscuous(true); esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE); esp_wifi_set_promiscuous(false);
    g_canal_disp = ch;
}
static uint8_t canal_salvo_ler() {
    Preferences p; uint8_t c = ESPNOW_CANAL;
    if (p.begin("rede", true)) { c = p.getUChar("canal", ESPNOW_CANAL); p.end(); }
    return (c >= 1 && c <= 13) ? c : ESPNOW_CANAL;
}
static void canal_gravar(uint8_t c) { Preferences p; if (p.begin("rede", false)) { p.putUChar("canal", c); p.end(); } }

static void radio_init() {
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    esp_wifi_set_mac(WIFI_IF_STA, (uint8_t*)MAC_DISPLAY);
    esp_wifi_set_promiscuous(true);
    g_canal_disp = canal_salvo_ler();
    esp_wifi_set_channel(g_canal_disp, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    if (esp_now_init() != ESP_OK) { Serial.println("[ESP-NOW] init FALHOU"); return; }
    esp_now_set_pmk(ESPNOW_PMK);
    esp_now_register_recv_cb(on_recv);
    esp_now_peer_info_t p = {};
    p.channel = 0; p.ifidx = WIFI_IF_STA; p.encrypt = true;
    memcpy(p.lmk, ESPNOW_LMK, 16);
    memcpy(p.peer_addr, MAC_WAVE1, 6);
    esp_now_add_peer(&p);
    esp_now_peer_info_t pc = {};                      // camera e broadcast: SEM criptografia (como a camera espera)
    pc.channel = 0; pc.ifidx = WIFI_IF_STA; pc.encrypt = false;
    memcpy(pc.peer_addr, MAC_CAMERA, 6); esp_now_add_peer(&pc);
    static const uint8_t BC_RADIO[6] = { 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF };
    memcpy(pc.peer_addr, BC_RADIO, 6); esp_now_add_peer(&pc);
    Serial.printf("[TESTE] radio pronto (canal fixo %d)\n", ESPNOW_CANAL);
}

// ------------------------------------------------------------------ UI -----
static lv_obj_t *lbl_estado, *lbl_etapa, *lbl_msg, *lbl_cont, *lbl_link, *lbl_sens, *lbl_giro, *lbl_cmd, *lbl_w1, *lbl_nuvem;
static lv_obj_t *btn_bomba, *lbl_bomba;
static lv_obj_t *scr_principal = nullptr, *scr_manual = nullptr, *scr_auto = nullptr;      // as telas
static lv_obj_t *lbl_a_estado, *lbl_a_etapa, *lbl_a_msg, *lbl_a_sens, *lbl_a_cont, *lbl_a_pausa;   // textos da tela AUTOMATICO
static lv_obj_t *btn_modelo[4];
static uint8_t   g_modelo_sel = 1;                                   // modelo escolhido na tela (1..4)
static lv_obj_t *lbl_m_estado = nullptr, *lbl_m_info = nullptr, *lbl_m_sens = nullptr;   // textos da tela manual

static const char* NOMES_ETAPA_AP[] = {
    "espera inicial", "espera 5 s", "verifica home", "liga bomba", "espera bomba",
    "inicia giro (ida)", "GIRO (ida)", "pausa entre giros (ida)",
    "inicia avanco", "AVANCO", "pausa", "inicia recuo", "RECUO",
    "inicia giro (volta)", "GIRO (volta)", "pausa entre giros (volta)",
    "inicia retorno", "RETORNO ate X12", "fim",
};
static const char* NOMES_HOME[] = {
    "", "HOME: buscando giro...", "HOME: parando...", "HOME: recuando ate X12...",
    "HOME: freando...", "HOME concluido", "HOME FALHOU",
};

static lv_obj_t* novo_label(lv_obj_t* pai, const lv_font_t* fonte, lv_color_t cor, int x, int y, int larg) {
    lv_obj_t* l = lv_label_create(pai);
    lv_obj_set_style_text_font(l, fonte, 0);
    lv_obj_set_style_text_color(l, cor, 0);
    lv_obj_set_pos(l, x, y);
    lv_obj_set_width(l, larg);
    lv_label_set_long_mode(l, LV_LABEL_LONG_CLIP);
    lv_label_set_text(l, "");
    return l;
}

static lv_obj_t* novo_botao(lv_obj_t* pai, const char* texto, lv_color_t cor, int x, int y, int w, int h,
                            lv_event_cb_t cb, lv_obj_t** lbl_out = nullptr) {
    lv_obj_t* b = lv_btn_create(pai);
    lv_obj_set_size(b, w, h);
    lv_obj_set_pos(b, x, y);
    lv_obj_set_style_bg_color(b, cor, 0);
    lv_obj_t* l = lv_label_create(b);
    lv_obj_set_style_text_font(l, &lv_font_montserrat_20, 0);
    lv_label_set_text(l, texto);
    lv_obj_center(l);
    lv_obj_add_event_cb(b, cb, LV_EVENT_CLICKED, nullptr);
    if (lbl_out) *lbl_out = l;
    return b;
}

static char     g_aviso[64] = "";          // aviso temporario mostrado na tela AUTOMATICO (ex.: CONFIG bloqueado)
static uint32_t g_aviso_ms = 0;
static void cb_home(lv_event_t*)    { enviar(0); }
static void cb_iniciar(lv_event_t*) { enviar(1); }
static void cb_parar(lv_event_t*)   { enviar(2, 3); }
static void cb_bomba(lv_event_t*)   {
    bool ligada = g_st_ok && (g_st.bomba_on & 1);
    enviar(ligada ? 3 : 4, 2);   // alterna (a fonte da verdade e a W1, no status)
}

static void cb_ir_manual(lv_event_t*)    { if (scr_manual) lv_scr_load(scr_manual); }
static void cb_manual_para_auto(lv_event_t*) { enviar(14, 3); if (scr_auto) lv_scr_load(scr_auto); }   // sai do manual: solta qualquer movimento
static void cb_ir_principal(lv_event_t*) { enviar(14, 3); if (scr_principal) lv_scr_load(scr_principal); }

// Botao de SEGURAR: manda o comando ao tocar e repete a cada ~150 ms enquanto pressionado (e o sinal de
// "estou segurando" que mantem o motor ligado na Waveshare 1: se parar de chegar por 0,5 s, ela para).
// Ao soltar (ou arrastar o dedo pra fora) manda "soltou" 3x.
static void cb_hold(lv_event_t* e) {
    static uint32_t t_ult = 0;
    uint8_t acao = (uint8_t)(intptr_t)lv_event_get_user_data(e);
    lv_event_code_t c = lv_event_get_code(e);
    if (c == LV_EVENT_PRESSED) { t_ult = millis(); enviar(acao); }
    else if (c == LV_EVENT_PRESSING) { if (millis() - t_ult >= 150) { t_ult = millis(); enviar(acao); } }
    else if (c == LV_EVENT_RELEASED || c == LV_EVENT_PRESS_LOST) { enviar(14, 3); t_ult = 0; }
}

static lv_obj_t* novo_botao_hold(lv_obj_t* pai, const char* texto, lv_color_t cor, int x, int y, int w, int h, uint8_t acao) {
    lv_obj_t* b = lv_btn_create(pai);
    lv_obj_set_size(b, w, h);
    lv_obj_set_pos(b, x, y);
    lv_obj_set_style_bg_color(b, cor, 0);
    lv_obj_t* l = lv_label_create(b);
    lv_obj_set_style_text_font(l, &lv_font_montserrat_20, 0);
    lv_label_set_text(l, texto);
    lv_obj_center(l);
    lv_obj_add_event_cb(b, cb_hold, LV_EVENT_ALL, (void*)(intptr_t)acao);
    return b;
}

static void ui_manual_criar() {
    scr_manual = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_manual, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_manual, LV_OBJ_FLAG_SCROLLABLE);

    // Faixa de CIMA: o canto inferior esquerdo da tela nao responde ao toque (defeito do painel),
    // entao PARAR TUDO e VOLTAR ficam aqui em cima, onde funciona.
    novo_botao(scr_manual, "PARAR TUDO", COR_VERMELHO, 8, 8, 230, 56, cb_parar);
    novo_botao(scr_manual, "HOME", COR_AZUL, 246, 8, 130, 56, cb_home);
    lv_obj_t* t = novo_label(scr_manual, &lv_font_montserrat_20, COR_AMARELO, 396, 22, 220);
    lv_label_set_text(t, "MANUAL (segure)");
    novo_botao(scr_manual, "AUTOMATICO", COR_VERDE, 620, 8, 172, 56, cb_manual_para_auto);

    novo_botao_hold(scr_manual, "GIRO  <  (anti-horario)", COR_AZUL,  16,  76, 380, 90, 11);
    novo_botao_hold(scr_manual, "GIRO  >  (horario)",      COR_AZUL,  404, 76, 380, 90, 10);
    novo_botao_hold(scr_manual, "CARRINHO  TRAS",          COR_CINZA, 16,  176, 380, 90, 13);
    novo_botao_hold(scr_manual, "CARRINHO  FRENTE",        COR_CINZA, 404, 176, 380, 90, 12);

    lbl_m_estado = novo_label(scr_manual, &lv_font_montserrat_20, COR_TEXTO,    16, 392, 770);
    lbl_m_info   = novo_label(scr_manual, &lv_font_montserrat_18, COR_VERMELHO, 16, 418, 770);
    lbl_m_sens   = novo_label(scr_manual, &lv_font_montserrat_16, COR_FRACO,    16, 446, 780);
}

static void cb_ir_auto(lv_event_t*) { if (scr_auto) lv_scr_load(scr_auto); }

static void marca_modelo() {
    for (int i = 0; i < 4; i++)
        if (btn_modelo[i]) lv_obj_set_style_bg_color(btn_modelo[i], (i + 1 == g_modelo_sel) ? COR_VERDE : COR_CINZA, 0);
}
static void cb_modelo(lv_event_t* e) { g_modelo_sel = (uint8_t)(intptr_t)lv_event_get_user_data(e); marca_modelo(); }
static void cb_auto_iniciar(lv_event_t*)  { enviar(20, 1, g_modelo_sel); }
static void cb_auto_pausa(lv_event_t*)    { enviar((g_st_ok && g_st.estado_auto == 8) ? 22 : 21, 2); }   // alterna pausar/continuar
static void cb_auto_cancelar(lv_event_t*) { enviar(23, 3); }
static lv_obj_t* lbl_t_carro; static lv_obj_t* btn_t_carro;
static lv_obj_t* lbl_t_bomba_teste; static lv_obj_t* btn_t_bomba_teste;
static void cb_bomba_teste(lv_event_t*) {   // liga/desliga o TESTE da bomba de alta pressao (Y13): valor absoluto; a W1 recusa se BOMBA estiver OFF
    bool ligada = g_st_ok && ((g_st.man_saidas >> 6) & 1);
    enviar(66, 2, ligada ? 0 : 1);
}
static void cb_carro(lv_event_t*) { enviar((g_st_ok && (g_st.bomba_on & 2)) ? 6 : 5, 2); }   // alterna SECO / CARRO REAL

static lv_obj_t* novo_botao_cb(lv_obj_t* pai, const char* texto, lv_color_t cor, int x, int y, int w, int h,
                               lv_event_cb_t cb, intptr_t dado, lv_obj_t** lbl_out = nullptr) {
    lv_obj_t* b = lv_btn_create(pai);
    lv_obj_set_size(b, w, h); lv_obj_set_pos(b, x, y);
    lv_obj_set_style_bg_color(b, cor, 0);
    lv_obj_t* l = lv_label_create(b);
    lv_obj_set_style_text_font(l, &lv_font_montserrat_20, 0);
    lv_label_set_text(l, texto); lv_obj_center(l);
    lv_obj_add_event_cb(b, cb, LV_EVENT_CLICKED, (void*)dado);
    if (lbl_out) *lbl_out = l;
    return b;
}

// ---- CONFIGURACAO: hub + editor generico (velocidades, esperas dos modelos, atrasos, tempo do giro) ----
// Os valores moram na W1 (NVS). O display pede a tabela, mostra, e manda o valor ABSOLUTO a cada toque.
static lv_obj_t *scr_hub = nullptr, *scr_ed = nullptr;
static lv_obj_t *lbl_ed_titulo, *lbl_ed_msg, *btn_ed_mod[4];
static lv_obj_t *ed_nome[14], *ed_val[14], *ed_bm[14], *ed_bp[14];
static uint8_t   ed_slot[14];      // indice real (etapa / slot / item) de cada linha visivel
static uint8_t   ed_n = 0;
static uint8_t   g_ed_tab = 0, g_ed_mod = 0;
static uint32_t  g_cfg_req_ms = 0, g_ed_refetch_ms = 0;

static const char* NOMES_ETAPA_V[14] = { "Pre-lavagem", "Cera d'agua", "Espuma A desloc.", "Espuma A giro", "Espuma B desloc.",
    "Espuma B giro", "Cor Magica desloc.", "Cor Magica giro", "Alta pressao", "Secagem", "Retorno",
    "Press. Pre-lavagem", "Press. Enxague", "Press. Alta Pressao" };   // 11..13 = pressao da agua (frequencia do SAJ)
static const char* NOME_PROC_C[11] = { "-", "Pre-lavagem", "-", "Espuma A", "Espuma B", "Cor Magica", "Cera d'agua", "Alta Pressao",
    "Secagem", "Enxague", "Fim" };
static const char* NOMES_ATRASO[4] = { "Espuma A: espera depois", "Espuma B: espera depois", "Cor Magica: espera depois", "Secagem: pausa antes" };
static const char* NOMES_GIRO[3]   = { "Pre-lavagem", "Espuma A", "Alta Pressao" };
static const char* TITULO_ED[5]    = { "VELOCIDADES E PRESSAO (Hz)", "ESPERAS DOS MODELOS", "ATRASOS EM CARRO REAL", "TEMPO DO GIRO 1->2", "SEQUENCIA DOS MODELOS" };
#define ED_COM_MODELO (g_ed_tab <= 1 || g_ed_tab == 4)      // abas que dependem do modelo escolhido
static const uint8_t SEQ_ORDEM[9] = { 10, 1, 3, 4, 5, 6, 7, 8, 9 };   // ciclo do botao +/-: FIM, pre-lavagem, espuma A/B, cor magica, cera, alta pressao, secagem, enxague
static const char* NOME_SEQ[11] = { "-", "Pre-lavagem", "-", "Espuma A", "Espuma B", "Cor Magica", "Cera d'agua", "Alta Pressao", "Secagem", "Enxague", "(fim)" };

static void ed_pedir() {
    uint8_t m = (ED_COM_MODELO) ? g_ed_mod : 0;
    if (g_ed_tab == 1) cfg_pedir(4, m);
    cfg_pedir(g_ed_tab, m);
    g_cfg_req_ms = millis();
}
static void cb_ir_hub(lv_event_t*)    { if (scr_hub) lv_scr_load(scr_hub); }
static void cb_hub_volta(lv_event_t*) { if (scr_auto) lv_scr_load(scr_auto); }
static void cb_hub_abre(lv_event_t* e) {
    g_ed_tab = (uint8_t)(intptr_t)lv_event_get_user_data(e);
    if (scr_ed) lv_scr_load(scr_ed);
    ed_pedir();
}
static void cb_ed_modelo(lv_event_t* e) { g_ed_mod = (uint8_t)(intptr_t)lv_event_get_user_data(e); ed_pedir(); }

static int ed_clamp(int v, int lo, int hi) { return v < lo ? lo : (v > hi ? hi : v); }
static void cb_ed_ajusta(lv_event_t* e) {
    int ud = (int)(intptr_t)lv_event_get_user_data(e);
    int r = ud / 2; bool mais = (ud % 2) != 0;
    if (r >= ed_n || !g_st_ok) return;
    uint8_t i = ed_slot[r], m = (ED_COM_MODELO) ? g_ed_mod : 0;
    uint16_t cur = g_cfg[g_ed_tab][m][i], nv = cur;
    switch (g_ed_tab) {
        case 0: nv = (uint16_t)ed_clamp((int)cur + (mais ? 5 : -5), 50, 600); break;                     // 0,5 Hz
        case 1:                                                                                          // 5 s; 0xFFFF = padrao
            if (cur == 0xFFFF)          nv = mais ? 0 : 0xFFFF;
            else if (cur == 0 && !mais) nv = 0xFFFF;
            else                        nv = (uint16_t)ed_clamp((int)cur + (mais ? 5 : -5), 0, 3600);
            break;
        case 2: nv = (uint16_t)ed_clamp((int)cur + (mais ? 5 : -5), 0, 3600); break;                     // 5 s
        case 3: nv = (uint16_t)ed_clamp((int)cur + (mais ? 100 : -100), 3000, 15000); break;             // 0,1 s
        case 4: {                                                                                        // proximo/anterior processo da lista
            int pos = 0; for (int q = 0; q < 9; q++) if (SEQ_ORDEM[q] == cur) { pos = q; break; }
            nv = SEQ_ORDEM[ed_clamp(pos + (mais ? 1 : -1), 0, 8)]; break; }
    }
    g_cfg[g_ed_tab][m][i] = nv;
    cfg_set(g_ed_tab, (ED_COM_MODELO) ? m : i, (ED_COM_MODELO) ? i : 0, nv);
    g_ed_refetch_ms = millis() + 500;     // confere com o que a W1 realmente gravou
}

static lv_obj_t* scr_alt = nullptr;
static void cb_hub_senhas(lv_event_t*) { if (scr_alt) lv_scr_load(scr_alt); }
static void cb_hub_volta_cfg(lv_event_t*) { if (scr_hub) lv_scr_load(scr_hub); }

static void ui_cfg_criar() {
    // ---- hub ----
    scr_hub = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_hub, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_hub, LV_OBJ_FLAG_SCROLLABLE);
    novo_botao(scr_hub, "PARAR TUDO", COR_VERMELHO, 8, 8, 300, 56, cb_parar);
    lv_obj_t* t = novo_label(scr_hub, &lv_font_montserrat_20, COR_AMARELO, 330, 22, 300);
    lv_label_set_text(t, "CONFIGURACAO");
    novo_botao(scr_hub, "VOLTAR", COR_AZUL, 640, 8, 150, 56, cb_hub_volta);
    for (int k = 0; k < 5; k++)
        novo_botao_cb(scr_hub, TITULO_ED[k], COR_AZUL, 16 + (k % 2) * 392, 90 + (k / 2) * 118, 376, 104, cb_hub_abre, k);
    novo_botao_cb(scr_hub, "ALTERAR SENHAS", COR_AZUL, 408, 326, 376, 104, cb_hub_senhas, 0);
    lv_obj_t* h = novo_label(scr_hub, &lv_font_montserrat_16, COR_FRACO, 16, 448, 770);
    lv_label_set_text(h, "Os valores ficam salvos na Waveshare 1. So da pra alterar com a maquina parada.");

    // ---- editor generico ----
    scr_ed = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_ed, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_ed, LV_OBJ_FLAG_SCROLLABLE);
    novo_botao(scr_ed, "PARAR TUDO", COR_VERMELHO, 8, 8, 230, 50, cb_parar);
    lbl_ed_titulo = novo_label(scr_ed, &lv_font_montserrat_20, COR_AMARELO, 256, 20, 380);
    novo_botao(scr_ed, "VOLTAR", COR_AZUL, 650, 8, 140, 50, cb_ir_hub);
    for (int k = 0; k < 4; k++) {
        char nm[12]; snprintf(nm, sizeof(nm), "MODELO %d", k + 1);
        btn_ed_mod[k] = novo_botao_cb(scr_ed, nm, COR_CINZA, 8 + k * 100, 64, 94, 36, cb_ed_modelo, k);
    }
    for (int r = 0; r < 14; r++) {
        int x0 = 8 + (r / 7) * 398, y = 108 + (r % 7) * 46;
        ed_nome[r] = novo_label(scr_ed, &lv_font_montserrat_16, COR_TEXTO, x0, y + 10, 190);
        ed_val[r]  = novo_label(scr_ed, &lv_font_montserrat_16, COR_AMARELO, x0 + 190, y + 10, 90);
        ed_bm[r]   = novo_botao_cb(scr_ed, "-", COR_CINZA, x0 + 282, y, 50, 42, cb_ed_ajusta, r * 2 + 0);
        ed_bp[r]   = novo_botao_cb(scr_ed, "+", COR_VERDE, x0 + 338, y, 50, 42, cb_ed_ajusta, r * 2 + 1);
    }
    lbl_ed_msg = novo_label(scr_ed, &lv_font_montserrat_16, COR_VERMELHO, 8, 436, 780);
}

static void ui_atualizar_ed(bool contato, const MsgTesteStatus& st) {
    uint8_t m = (ED_COM_MODELO) ? g_ed_mod : 0;
    bool ok = g_cfg_ok[g_ed_tab][m] && (g_ed_tab != 1 || g_cfg_ok[4][m]);
    if ((!ok || (g_ed_refetch_ms && (int32_t)(millis() - g_ed_refetch_ms) >= 0)) && contato && (millis() - g_cfg_req_ms) > 1200) {
        g_ed_refetch_ms = 0; ed_pedir();
    }
    char b[64];
    snprintf(b, sizeof(b), "%s", TITULO_ED[g_ed_tab]);
    lv_label_set_text(lbl_ed_titulo, b);
    for (int k = 0; k < 4; k++) {
        if (ED_COM_MODELO) lv_obj_clear_flag(btn_ed_mod[k], LV_OBJ_FLAG_HIDDEN); else lv_obj_add_flag(btn_ed_mod[k], LV_OBJ_FLAG_HIDDEN);
        lv_obj_set_style_bg_color(btn_ed_mod[k], (k == g_ed_mod) ? COR_VERDE : COR_CINZA, 0);
    }
    // linhas visiveis
    ed_n = 0;
    if (ok && contato) {
        const uint16_t* v = g_cfg[g_ed_tab][m];
        switch (g_ed_tab) {
            case 0: for (int e = 0; e < 14; e++) ed_slot[ed_n++] = e; break;
            case 1: for (int sl = 0; sl < 14; sl++) { uint16_t p = g_cfg[4][m][sl]; if (p == 3 || p == 4 || p == 5 || p == 6 || p == 8) ed_slot[ed_n++] = sl; } break;
            case 2: for (int i = 0; i < 4; i++) ed_slot[ed_n++] = i; break;
            case 3: for (int i = 0; i < 3; i++) ed_slot[ed_n++] = i; break;
            case 4: for (int i = 0; i < 14; i++) ed_slot[ed_n++] = i; break;
        }
        for (int r = 0; r < 14; r++) {
            if (r >= ed_n) continue;
            uint8_t i = ed_slot[r]; char t1[40], t2[24];
            switch (g_ed_tab) {
                case 0: snprintf(t1, sizeof(t1), "%s", NOMES_ETAPA_V[i]); snprintf(t2, sizeof(t2), "%u,%u", (unsigned)(v[i] / 10), (unsigned)(v[i] % 10)); break;
                case 1: { uint16_t p = g_cfg[4][m][i]; snprintf(t1, sizeof(t1), "%d. %s", (int)i + 1, p < 11 ? NOME_PROC_C[p] : "?");
                          if (v[i] == 0xFFFF) snprintf(t2, sizeof(t2), "padrao"); else snprintf(t2, sizeof(t2), "%u s", (unsigned)v[i]); break; }
                case 2: snprintf(t1, sizeof(t1), "%s", NOMES_ATRASO[i]); snprintf(t2, sizeof(t2), "%u s", (unsigned)v[i]); break;
                case 4: snprintf(t1, sizeof(t1), "Etapa %d", (int)i + 1); snprintf(t2, sizeof(t2), "%s", v[i] < 11 ? NOME_SEQ[v[i]] : "?"); break;
                default: snprintf(t1, sizeof(t1), "%s", NOMES_GIRO[i]); snprintf(t2, sizeof(t2), "%u,%u s", (unsigned)(v[i] / 1000), (unsigned)((v[i] % 1000) / 100)); break;
            }
            lv_label_set_text(ed_nome[r], t1); lv_label_set_text(ed_val[r], t2);
        }
    }
    for (int r = 0; r < 14; r++) {
        bool vis = r < ed_n;
        lv_obj_t* o[4] = { ed_nome[r], ed_val[r], ed_bm[r], ed_bp[r] };
        for (int k = 0; k < 4; k++) { if (vis) lv_obj_clear_flag(o[k], LV_OBJ_FLAG_HIDDEN); else lv_obj_add_flag(o[k], LV_OBJ_FLAG_HIDDEN); }
    }
    if (!contato) lv_label_set_text(lbl_ed_msg, "SEM CONTATO COM A WAVESHARE 1");
    else if (!ok) lv_label_set_text(lbl_ed_msg, "Carregando a configuracao da Waveshare 1...");
    else { char mm[56]; strncpy(mm, st.msg, sizeof(mm) - 1); mm[sizeof(mm) - 1] = 0; lv_label_set_text(lbl_ed_msg, mm); }
}

// ---- SENHA (teclado numerico): CONFIG = 1111, TECNICO = 2828. Bloqueado com ciclo/HOME em andamento. ----
// Senhas (padrao de fabrica; podem ser trocadas em CONFIG > ALTERAR SENHAS e ficam na memoria do display):
// indice 0 = configuracao (1111), 1 = tecnico (2828), 2 = pagamento/acerto (3462)
static char g_pw[3][9] = { "1111", "2828", "3462" };
static void pw_carregar() {
    Preferences p; if (!p.begin("senhas", true)) return;
    static const char* K[3] = { "c", "t", "p" };
    for (int i = 0; i < 3; i++) { String v = p.getString(K[i], ""); if (v.length() >= 4 && v.length() <= 8) strcpy(g_pw[i], v.c_str()); }
    p.end();
}
static void pw_salvar(int i) {
    Preferences p; if (!p.begin("senhas", false)) return;
    static const char* K[3] = { "c", "t", "p" };
    p.putString(K[i], g_pw[i]); p.end();
}
static lv_obj_t* scr_senha = nullptr;
static lv_obj_t* lbl_senha_pontos; static lv_obj_t* lbl_senha_titulo; static lv_obj_t* lbl_senha_msg;
static char      g_senha[9] = "";
static uint8_t   g_senha_len = 0;
static uint8_t   g_senha_alvo = 0;       // 0 = CONFIG, 1 = TECNICO

static void senha_mostra() {
    char b[12]; int n = g_senha_len; for (int i = 0; i < n; i++) b[i] = '*'; b[n] = 0;
    lv_label_set_text(lbl_senha_pontos, n ? b : "----");
}
static bool maquina_ocupada() {
    return g_st_ok && ((g_st.estado_auto >= 1 && g_st.estado_auto <= 5) || g_st.estado_auto == 8 || (g_st.home_estado >= 1 && g_st.home_estado <= 4) || g_st.rodando);   // HOME em andamento = estados 1..4 (5 = concluido e 6 = falhou ficam gravados e NAO contam)
}
// ---- ALTERAR SENHA: alvo 10+k (k = 0 config, 1 tecnico, 2 pagamento); fase 0 = senha atual, 1 = nova, 2 = repetir ----
static uint8_t g_alt_fase = 0; static char g_alt_nova[9] = "";
static const char* NOME_PW[3] = { "CONFIGURACAO", "TECNICO", "PAGAMENTO" };
static void senha_alterar_titulo() {
    char b[48]; int k = g_senha_alvo - 10;
    if (g_alt_fase == 0)      snprintf(b, sizeof(b), "SENHA ATUAL (%s)", NOME_PW[k]);
    else if (g_alt_fase == 1) snprintf(b, sizeof(b), "NOVA SENHA (%s)", NOME_PW[k]);
    else                      snprintf(b, sizeof(b), "REPITA A NOVA SENHA");
    lv_label_set_text(lbl_senha_titulo, b);
}
static void senha_alterar_ok() {
    int k = g_senha_alvo - 10;
    if (g_alt_fase == 0) {
        if (strcmp(g_senha, g_pw[k]) == 0) { g_alt_fase = 1; lv_label_set_text(lbl_senha_msg, "Digite a nova senha (4 a 8 digitos)"); }
        else lv_label_set_text(lbl_senha_msg, "Senha incorreta");
    } else if (g_alt_fase == 1) {
        if (g_senha_len < 4) { lv_label_set_text(lbl_senha_msg, "Minimo 4 digitos"); }
        else { strcpy(g_alt_nova, g_senha); g_alt_fase = 2; lv_label_set_text(lbl_senha_msg, ""); }
    } else {
        if (strcmp(g_senha, g_alt_nova) == 0) {
            strcpy(g_pw[k], g_alt_nova); pw_salvar(k);
            g_senha_len = 0; g_senha[0] = 0; g_alt_fase = 0; g_alt_nova[0] = 0;
            snprintf(g_aviso, sizeof(g_aviso), "Senha de %s alterada", NOME_PW[k]); g_aviso_ms = millis();
            if (scr_hub) lv_scr_load(scr_hub);
            return;
        }
        g_alt_fase = 1; lv_label_set_text(lbl_senha_msg, "Nao confere. Digite a nova senha de novo");
    }
    g_senha_len = 0; g_senha[0] = 0;
    senha_alterar_titulo();
}
static void cb_alt_escolhe(lv_event_t* e) {
    g_senha_alvo = (uint8_t)(10 + (int)(intptr_t)lv_event_get_user_data(e));
    g_alt_fase = 0; g_senha_len = 0; g_senha[0] = 0;
    senha_alterar_titulo(); lv_label_set_text(lbl_senha_msg, "");
    senha_mostra();
    lv_scr_load(scr_senha);
}
static void cb_pede_senha(lv_event_t* e) {
    uint8_t alvo = (uint8_t)(intptr_t)lv_event_get_user_data(e);
    if (maquina_ocupada()) {
        snprintf(g_aviso, sizeof(g_aviso), "%s bloqueado: ciclo ou HOME em andamento", alvo == 2 ? "PAGAMENTO" : (alvo ? "TECNICO" : "CONFIG"));
        g_aviso_ms = millis();
        return;
    }
    g_senha_alvo = alvo; g_senha_len = 0; g_senha[0] = 0;
    lv_label_set_text(lbl_senha_titulo, alvo == 2 ? "SENHA DE PAGAMENTO" : (alvo ? "SENHA DO TECNICO" : "SENHA DE CONFIGURACAO"));
    lv_label_set_text(lbl_senha_msg, "");
    senha_mostra();
    lv_scr_load(scr_senha);
}
static void cb_senha_tecla(lv_event_t* e) {
    int k = (int)(intptr_t)lv_event_get_user_data(e);
    if (k >= 0 && k <= 9) { if (g_senha_len < 8) { g_senha[g_senha_len++] = (char)('0' + k); g_senha[g_senha_len] = 0; } lv_label_set_text(lbl_senha_msg, ""); }
    else if (k == 10) { if (g_senha_len) g_senha[--g_senha_len] = 0; }                  // APAGAR
    else if (k == 11) {                                                                  // OK
        if (g_senha_alvo >= 10) { senha_alterar_ok(); senha_mostra(); return; }          // fluxo de ALTERAR SENHA
        const char* certa = g_pw[g_senha_alvo];
        if (strcmp(g_senha, certa) == 0) {
            g_senha_len = 0; g_senha[0] = 0;
            if (g_senha_alvo == 2)      { enviar(9, 2); if (scr_auto) lv_scr_load(scr_auto); }   // ACERTO: a W1 soma ao saldo e zera
            else if (g_senha_alvo)      { if (scr_principal) lv_scr_load(scr_principal); }
            else                        { if (scr_hub)       lv_scr_load(scr_hub); }
            return;
        }
        g_senha_len = 0; g_senha[0] = 0;
        lv_label_set_text(lbl_senha_msg, "Senha incorreta");
    }
    senha_mostra();
}
static void cb_senha_cancela(lv_event_t*) { g_senha_len = 0; g_senha[0] = 0; if (scr_auto) lv_scr_load(scr_auto); }

static void ui_alt_criar() {
    scr_alt = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_alt, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_alt, LV_OBJ_FLAG_SCROLLABLE);
    novo_botao(scr_alt, "VOLTAR", COR_AZUL, 640, 8, 150, 56, cb_hub_volta_cfg);
    lv_obj_t* t = novo_label(scr_alt, &lv_font_montserrat_20, COR_AMARELO, 16, 22, 500);
    lv_label_set_text(t, "ALTERAR SENHAS - qual?");
    for (int k = 0; k < 3; k++) novo_botao_cb(scr_alt, NOME_PW[k], COR_AZUL, 16 + k * 262, 120, 250, 100, cb_alt_escolhe, k);
}

static void ui_senha_criar() {
    ui_alt_criar();
    scr_senha = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_senha, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_senha, LV_OBJ_FLAG_SCROLLABLE);
    novo_botao(scr_senha, "CANCELAR", COR_VERMELHO, 8, 8, 200, 56, cb_senha_cancela);
    lbl_senha_titulo = novo_label(scr_senha, &lv_font_montserrat_20, COR_AMARELO, 300, 22, 400);
    lbl_senha_pontos = novo_label(scr_senha, &lv_font_montserrat_20, COR_TEXTO, 330, 76, 200);
    lbl_senha_msg    = novo_label(scr_senha, &lv_font_montserrat_18, COR_VERMELHO, 300, 104, 300);
    static const char* TX[12] = { "1", "2", "3", "4", "5", "6", "7", "8", "9", "APAGAR", "0", "OK" };
    static const int   KV[12] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 0, 11 };
    for (int i = 0; i < 12; i++) {
        int c = i % 3, r = i / 3;
        lv_color_t cor = (KV[i] == 11) ? COR_VERDE : (KV[i] == 10) ? COR_CINZA : COR_AZUL;
        novo_botao_cb(scr_senha, TX[i], cor, 250 + c * 112, 136 + r * 70, 104, 62, cb_senha_tecla, KV[i]);
    }
}

static lv_obj_t *btn_socio, *lbl_socio;
static lv_obj_t *pl_cel[5][6], *pl_data;
static uint32_t  pl_req_ms = 0;
static void cb_socio(lv_event_t*) { enviar(7, 2, (uint8_t)(((g_st_ok ? g_st.tipo_prox : 0) + 1) & 3)); }   // gira o TIPO do proximo ciclo: presencial > aplicativo > socio > bonus

// ---- Saidas MANUAIS (liga/desliga; so com a maquina parada; a W1 desliga sozinha em 60 s) ----
static lv_obj_t *btn_m_sai[7], *lbl_m_sai[7];
static void cb_man_sai(lv_event_t* e) {
    int idx = (int)(intptr_t)lv_event_get_user_data(e);
    bool ligada = g_st_ok && ((g_st.man_saidas >> idx) & 1);
    enviar((uint8_t)(60 + idx), 2, ligada ? 0 : 1);      // valor ABSOLUTO (repetir e seguro)
}
static void ui_manual_toggles_criar() {
    static const char* NM[7] = { "VALVULA", "ESPUMA A", "ESPUMA B", "COR MAGICA", "SECAGEM", "CERA D'AGUA", "BOMBA ALTA\nPRESSAO (20 s)" };
    for (int i = 0; i < 7; i++)
        btn_m_sai[i] = novo_botao_cb(scr_manual, NM[i], COR_CINZA, 16 + (i % 4) * 194, 276 + (i / 4) * 56, 184, 50, cb_man_sai, i, &lbl_m_sai[i]);
}

// ---- AVISO DE FIM DE CICLO: aparece sobre QUALQUER tela e fica ate tocar OK (ou comecar outro ciclo) ----
static lv_obj_t *pop_ev = nullptr, *lbl_pop_ev = nullptr;
static uint8_t   ev_visto = 0; static bool ev_init = false;
static void cb_pop_ok(lv_event_t*) { if (pop_ev) lv_obj_add_flag(pop_ev, LV_OBJ_FLAG_HIDDEN); }
static void ui_evento_criar() {
    pop_ev = lv_obj_create(lv_layer_top());
    lv_obj_set_size(pop_ev, 640, 230); lv_obj_set_pos(pop_ev, 80, 120);
    lv_obj_set_style_bg_color(pop_ev, lv_color_hex(0x10151C), 0);
    lv_obj_set_style_border_width(pop_ev, 4, 0); lv_obj_set_style_radius(pop_ev, 12, 0);
    lv_obj_clear_flag(pop_ev, LV_OBJ_FLAG_SCROLLABLE);
    lbl_pop_ev = lv_label_create(pop_ev);
    lv_obj_set_width(lbl_pop_ev, 600);
    lv_label_set_long_mode(lbl_pop_ev, LV_LABEL_LONG_WRAP);
    lv_obj_set_style_text_font(lbl_pop_ev, &lv_font_montserrat_20, 0);
    lv_obj_set_style_text_align(lbl_pop_ev, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(lbl_pop_ev, LV_ALIGN_TOP_MID, 0, 18);
    lv_obj_t* b = lv_btn_create(pop_ev);
    lv_obj_set_size(b, 200, 60); lv_obj_align(b, LV_ALIGN_BOTTOM_MID, 0, -6);
    lv_obj_set_style_bg_color(b, COR_AZUL, 0);
    lv_obj_t* l = lv_label_create(b); lv_label_set_text(l, "OK"); lv_obj_center(l);
    lv_obj_add_event_cb(b, cb_pop_ok, LV_EVENT_CLICKED, nullptr);
    lv_obj_add_flag(pop_ev, LV_OBJ_FLAG_HIDDEN);
}
static void ui_evento_atualiza(bool contato, const MsgTesteStatus& s) {
    if (!contato) return;
    if (!ev_init) { ev_init = true; ev_visto = s.ev_seq; return; }            // 1o status depois de ligar: nao mostra evento antigo
    if (s.estado_auto >= 1 && s.estado_auto <= 5) { if (pop_ev) lv_obj_add_flag(pop_ev, LV_OBJ_FLAG_HIDDEN); }   // novo ciclo em andamento
    if (s.ev_seq == ev_visto) return;
    ev_visto = s.ev_seq;
    char b[120];
    if (s.ev_tipo == 1) {
        snprintf(b, sizeof(b), "CICLO CONCLUIDO\n(modelo %u)", (unsigned)s.ev_modelo);
        lv_obj_set_style_border_color(pop_ev, COR_VERDE, 0);
    } else {
        char m[56]; strncpy(m, s.msg, sizeof(m) - 1); m[sizeof(m) - 1] = 0;
        snprintf(b, sizeof(b), "ERRO NO CICLO (modelo %u)\n%s", (unsigned)s.ev_modelo, m);
        lv_obj_set_style_border_color(pop_ev, COR_VERMELHO, 0);
    }
    lv_label_set_text(lbl_pop_ev, b);
    lv_obj_clear_flag(pop_ev, LV_OBJ_FLAG_HIDDEN);
}

static void ui_auto_criar() {
    scr_auto = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr_auto, COR_FUNDO, 0);
    lv_obj_clear_flag(scr_auto, LV_OBJ_FLAG_SCROLLABLE);

    // Faixa de cima (o canto inferior esquerdo da tela nao responde ao toque)
    novo_botao(scr_auto, "PARAR TUDO", COR_VERMELHO, 8, 8, 200, 56, cb_parar);
    novo_botao(scr_auto, "HOME", COR_AZUL, 216, 8, 120, 56, cb_home);
    novo_botao_cb(scr_auto, "CONFIG", COR_AZUL, 344, 8, 200, 56, cb_pede_senha, 0);
    novo_botao(scr_auto, "MANUAL", COR_AZUL, 552, 8, 240, 56, cb_ir_manual);

    static const char* NM[4] = { "MODELO 1", "MODELO 2", "MODELO 3", "MODELO 4" };
    for (int i = 0; i < 4; i++)
        btn_modelo[i] = novo_botao_cb(scr_auto, NM[i], COR_CINZA, 16 + i * 195, 76, 185, 60, cb_modelo, i + 1);
    marca_modelo();

    novo_botao_cb(scr_auto, "INICIAR AUTOMATICO", COR_VERDE,    16, 148, 380, 80, cb_auto_iniciar, 0);
    novo_botao_cb(scr_auto, "PAUSAR",             COR_AMARELO, 404, 148, 380, 80, cb_auto_pausa, 0, &lbl_a_pausa);
    novo_botao_cb(scr_auto, "TECNICO", COR_CINZA, 16, 238, 260, 56, cb_pede_senha, 1);
    btn_socio = novo_botao_cb(scr_auto, "TIPO: PRESENCIAL", COR_CINZA, 284, 238, 270, 56, cb_socio, 0, &lbl_socio);

    // Logo Pili (fundo preto proprio da imagem)
    lv_obj_t* caixa = lv_obj_create(scr_auto);
    lv_obj_set_size(caixa, 220, 86); lv_obj_set_pos(caixa, 564, 232);
    lv_obj_set_style_bg_color(caixa, lv_color_hex(0x000000), 0);
    lv_obj_set_style_border_width(caixa, 0, 0); lv_obj_set_style_pad_all(caixa, 0, 0); lv_obj_set_style_radius(caixa, 6, 0);
    lv_obj_clear_flag(caixa, LV_OBJ_FLAG_SCROLLABLE);
    lv_obj_t* img = lv_img_create(caixa);
    lv_img_set_src(img, &logo_pili);

    lbl_a_estado = novo_label(scr_auto, &lv_font_montserrat_20, COR_TEXTO,    16, 302, 770);
    lbl_a_etapa  = novo_label(scr_auto, &lv_font_montserrat_18, COR_FRACO,    16, 326, 770);
    lbl_a_msg    = novo_label(scr_auto, &lv_font_montserrat_18, COR_VERMELHO, 16, 348, 770);
    lbl_a_cont   = novo_label(scr_auto, &lv_font_montserrat_16, COR_AMARELO,  16, 348, 10);
    lv_obj_add_flag(lbl_a_cont, LV_OBJ_FLAG_HIDDEN);     // ciclos/erros/falhas: ficam na tela TECNICO
    lbl_a_sens   = novo_label(scr_auto, &lv_font_montserrat_16, COR_FRACO,    16, 348, 10);
    lv_obj_add_flag(lbl_a_sens, LV_OBJ_FLAG_HIDDEN);     // diagnostico de sensores: tela TECNICO

    // ---- PLANILHA DE LAVAGENS desde o ultimo acerto: presencial, aplicativo, socios (mensalistas) e bonus (promocao), por modelo ----
    static const char* CAB[5] = { "M1", "M2", "M3", "M4", "TOTAL" };
    static const char* LIN[5] = { "", "Presencial", "Aplicativo", "Socios", "Bonus" };
    for (int r = 0; r < 5; r++) {
        for (int c = 0; c < 6; c++) {
            int x = (c == 5) ? 16 : 130 + c * 90;                      // coluna 5 = rotulo da linha (a esquerda)
            lv_color_t cor = (r == 0) ? COR_FRACO : (r == 1 ? COR_TEXTO : (r == 2 ? lv_color_hex(0x6EC1FF) : (r == 3 ? COR_AMARELO : lv_color_hex(0xC792EA))));
            pl_cel[r][c] = novo_label(scr_auto, &lv_font_montserrat_16, cor, x, 372 + r * 20, 88);
        }
        lv_label_set_text(pl_cel[r][5], LIN[r]);
    }
    for (int c = 0; c < 5; c++) lv_label_set_text(pl_cel[0][c], CAB[c]);
    pl_data = novo_label(scr_auto, &lv_font_montserrat_16, COR_FRACO, 588, 372, 200);
    lv_label_set_text(pl_data, "Desde --/--/----");
    novo_botao_cb(scr_auto, "PAGAMENTO\nEFETUADO", COR_AZUL, 588, 396, 200, 76, cb_pede_senha, 2);
}

// Ao SAIR da tela TECNICO (para AUTOMATICO ou MANUAL) a maquina volta ao modo de operacao: COM X10 (carro real) e BOMBA em ON.
// Evita esquecer esses dois botoes depois de um teste a seco. (Ir para a tela WI-FI nao conta: ela faz parte da aba tecnica.)
static void tecnico_sair_assume_operacao() {
    if (g_st_ok && ((g_st.man_saidas >> 6) & 1)) enviar(66, 2, 0);     // desliga o teste da bomba, se estiver ligado
    enviar(4, 2);                                                       // BOMBA em ON
    if (!maquina_ocupada()) enviar(5, 2);                               // COM X10 (a W1 so troca de modo com a maquina parada)
    snprintf(g_aviso, sizeof(g_aviso), "Saiu do TECNICO: BOMBA em ON e COM X10"); g_aviso_ms = millis();
}
static void cb_tec_para_auto(lv_event_t*)   { tecnico_sair_assume_operacao(); if (scr_auto)   lv_scr_load(scr_auto); }
static void cb_tec_para_manual(lv_event_t*) { tecnico_sair_assume_operacao(); if (scr_manual) lv_scr_load(scr_manual); }

#include "wifi_tecnico.h"
#include "cadastro_tecnico.h"
#include "nuvem_display.h"

static void ui_criar() {
    lv_obj_t* scr = lv_obj_create(nullptr);
    scr_principal = scr;    // = tela TECNICO (atras da senha 2828)
    lv_obj_set_style_bg_color(scr, COR_FUNDO, 0);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    // Barra de cima: botao da BOMBA no canto superior esquerdo + navegacao
    btn_bomba = novo_botao(scr, "BOMBA: OFF (a seco)", COR_CINZA, 8, 8, 250, 56, cb_bomba, &lbl_bomba);
    novo_botao(scr, "AUTOMATICO", COR_VERDE, 266, 8, 180, 56, cb_tec_para_auto);
    novo_botao(scr, "MANUAL", COR_AZUL, 454, 8, 170, 56, cb_tec_para_manual);
    novo_botao(scr, "REDE", COR_AZUL, 632, 8, 160, 56, cb_ir_rede);

    lbl_estado = novo_label(scr, &lv_font_montserrat_20, COR_TEXTO,    16, 80,  770);
    lbl_etapa  = novo_label(scr, &lv_font_montserrat_18, COR_FRACO,    16, 118, 770);
    lbl_msg    = novo_label(scr, &lv_font_montserrat_18, COR_VERMELHO, 16, 154, 770);
    lbl_cont   = novo_label(scr, &lv_font_montserrat_20, COR_TEXTO,    16, 196, 770);
    lbl_nuvem  = novo_label(scr, &lv_font_montserrat_16, COR_AZUL,     16, 216, 780);
    lbl_link   = novo_label(scr, &lv_font_montserrat_18, COR_FRACO,    16, 236, 770);
    lbl_w1     = novo_label(scr, &lv_font_montserrat_16, COR_VERDE,    16, 258, 780);
    lbl_sens   = novo_label(scr, &lv_font_montserrat_16, COR_FRACO,    16, 278, 770);
    lbl_giro   = novo_label(scr, &lv_font_montserrat_16, COR_AMARELO,  16, 298, 780);
    lbl_cmd    = novo_label(scr, &lv_font_montserrat_16, COR_AZUL,     16, 320, 780);

    novo_botao(scr, "HOME",          COR_AZUL,      16, 352, 126, 100, cb_home);
    novo_botao(scr, "INICIAR TESTE", COR_VERDE,    150, 352, 190, 100, cb_iniciar);
    novo_botao(scr, "PARAR",         COR_VERMELHO, 348, 352, 128, 100, cb_parar);
    btn_t_bomba_teste = novo_botao(scr, "BOMBA TESTE\n(20 s)", COR_CINZA, 484, 352, 150, 100, cb_bomba_teste, &lbl_t_bomba_teste);
    btn_t_carro = novo_botao(scr, "SEM X10\n(a seco)", COR_CINZA, 642, 352, 148, 100, cb_carro, &lbl_t_carro);

    pw_carregar();
    ui_manual_criar();
    ui_manual_toggles_criar();
    ui_auto_criar();
    ui_cfg_criar();
    ui_senha_criar();
    ui_wifi_criar();
    ui_cad_criar();
    if (wifi_mig_pendente()) ws_msg("Migracao de canal INTERROMPIDA antes. Toque em BUSCAR REDES (se precisar, ele procura a camera nos canais).", true);
    ui_evento_criar();
    lv_scr_load(scr_auto);   // a maquina vive no AUTOMATICO: e a tela inicial
}

// Atualiza os textos da tela MANUAL (estado, aviso do firmware e sensores/saidas relevantes).
static void ui_atualizar_manual(bool contato, const MsgTesteStatus& s) {
    char buf[200];
    if (!g_st_ok || !contato) {
        lv_label_set_text(lbl_m_estado, "SEM CONTATO COM A WAVESHARE 1 (os botoes nao funcionam)");
        lv_obj_set_style_text_color(lbl_m_estado, COR_VERMELHO, 0);
        lv_label_set_text(lbl_m_info, "");
        lv_label_set_text(lbl_m_sens, "");
        return;
    }
    static const char* MOV[14] = { "PARADO", "", "", "", "", "", "", "", "", "",
                                   "GIRO HORARIO", "GIRO ANTI-HORARIO", "CARRINHO FRENTE", "CARRINHO TRAS" };
    lv_color_t cor = COR_FRACO;
    if (s.manual_mov >= 10 && s.manual_mov <= 13) {
        snprintf(buf, sizeof(buf), "MOVENDO: %s  (solte para parar)", MOV[s.manual_mov]); cor = COR_VERDE;
    } else if (s.estado_auto != 0 || (s.home_estado >= 1 && s.home_estado <= 4)) {
        snprintf(buf, sizeof(buf), "Maquina ocupada (ciclo ou HOME): manual bloqueado"); cor = COR_AMARELO;
    } else {
        snprintf(buf, sizeof(buf), "Parado. Segure um botao para mover."); cor = COR_FRACO;
    }
    lv_label_set_text(lbl_m_estado, buf);
    lv_obj_set_style_text_color(lbl_m_estado, cor, 0);
    for (int i = 0; i < 7; i++) lv_obj_set_style_bg_color(btn_m_sai[i], ((s.man_saidas >> i) & 1) ? (i == 6 ? lv_color_hex(0xC62828) : lv_color_hex(0xE08A00)) : COR_CINZA, 0);

    char msg[56];
    strncpy(msg, s.msg, sizeof(msg) - 1); msg[sizeof(msg) - 1] = '\0';
    lv_label_set_text(lbl_m_info, msg);

    static const char* CMD[] = { "PARADO", "FRENTE", "REVERSO" };
    snprintf(buf, sizeof(buf), "X12:%d X13:%d | X16:%d X17:%d X7:%d | Y4:%d Y14 cmd:%d real:%d | Delta: %s %.1f Hz",
             (s.io2_di >> 2) & 1, (s.io2_di >> 3) & 1, (s.io2_di >> 7) & 1, (s.io2_di >> 6) & 1, (s.io1_di >> 7) & 1,
             (s.w1_do >> 3) & 1, (s.w2_do_cmd >> 3) & 1, (s.w2_do_real >> 3) & 1,
             CMD[s.vfd_mov > 2 ? 0 : s.vfd_mov], s.vfd_mov_freq / 10.0f);
    lv_label_set_text(lbl_m_sens, buf);
}

static void ui_atualizar_auto(bool contato, const MsgTesteStatus& s) {
    char buf[220];
    if (!g_st_ok || !contato) {
        lv_label_set_text(lbl_a_estado, "SEM CONTATO COM A WAVESHARE 1 (os botoes nao funcionam)");
        lv_obj_set_style_text_color(lbl_a_estado, COR_VERMELHO, 0);
        lv_label_set_text(lbl_a_etapa, ""); lv_label_set_text(lbl_a_msg, "");
        lv_label_set_text(lbl_a_cont, ""); lv_label_set_text(lbl_a_sens, "");
        return;
    }
    static const char* PROC[11] = { "-", "Pre-lavagem", "-", "Espuma A", "Espuma B", "Cor Magica",
                                    "Cera de agua", "Alta Pressao", "Secagem", "Enxague", "Fim" };
    lv_color_t cor = COR_TEXTO;
    switch (s.estado_auto) {
        case 0: snprintf(buf, sizeof(buf), "Parado. Escolha o modelo e toque INICIAR AUTOMATICO."); cor = COR_FRACO; break;
        case 1: snprintf(buf, sizeof(buf), "Aguardando carro (X14)...");            cor = COR_AMARELO; break;
        case 2: snprintf(buf, sizeof(buf), "Carro entrando...");                    cor = COR_AMARELO; break;
        case 3: snprintf(buf, sizeof(buf), "Aguardando posicao do carro (X15)...");  cor = COR_AMARELO; break;
        case 4: snprintf(buf, sizeof(buf), "Iniciando ciclo (luz vermelha, confere o HOME)..."); cor = COR_AMARELO; break;
        case 5: snprintf(buf, sizeof(buf), "EXECUTANDO: %s", s.proc_ativo < 11 ? PROC[s.proc_ativo] : "?"); cor = COR_VERDE; break;
        case 6: snprintf(buf, sizeof(buf), "Ciclo concluido");                      cor = COR_VERDE; break;
        case 7: snprintf(buf, sizeof(buf), "ERRO - o ciclo parou");                 cor = COR_VERMELHO; break;
        case 8: snprintf(buf, sizeof(buf), "PAUSADO");                              cor = COR_AMARELO; break;
        default: snprintf(buf, sizeof(buf), "estado interno %d", (int)s.estado_auto); cor = COR_AMARELO; break;
    }
    lv_label_set_text(lbl_a_estado, buf);
    lv_obj_set_style_text_color(lbl_a_estado, cor, 0);

    if ((s.estado_auto == 5 || s.estado_auto == 8) && s.proc_ativo == 7 &&
        s.sub_estado < (sizeof(NOMES_ETAPA_AP) / sizeof(NOMES_ETAPA_AP[0]))) {
        snprintf(buf, sizeof(buf), "Modelo %d | Etapa: %s   (giro %d/3)", (int)s.programa_sel, NOMES_ETAPA_AP[s.sub_estado], (int)s.giro_n + 1);
    } else if (s.estado_auto == 5 || s.estado_auto == 8) {
        snprintf(buf, sizeof(buf), "Modelo %d | %s  (etapa interna %d)", (int)s.programa_sel,
                 s.proc_ativo < 11 ? PROC[s.proc_ativo] : "?", (int)s.sub_estado);
    } else {
        snprintf(buf, sizeof(buf), "Modelo escolhido: %d", (int)g_modelo_sel);
    }
    lv_label_set_text(lbl_a_etapa, buf);

    char msg[60];
    if (g_aviso[0] && (millis() - g_aviso_ms) < 3500) { strncpy(msg, g_aviso, sizeof(msg) - 1); }
    else if (nd_lic_bloq())  { snprintf(msg, sizeof(msg), "MAQUINA BLOQUEADA (licenca): %u dias sem pagar - fale com a Pili", (unsigned)nd_lic_dias()); }
    else if (nd_lic_aviso()) { snprintf(msg, sizeof(msg), "AVISO de licenca: %u dias sem pagamento (bloqueia aos 50)", (unsigned)nd_lic_dias()); }
    else                                              { strncpy(msg, s.msg, sizeof(msg) - 1); }
    msg[sizeof(msg) - 1] = '\0';
    lv_label_set_text(lbl_a_msg, msg);

    snprintf(buf, sizeof(buf), "Ciclos OK: %u   Erros: %u   Falhas de escrita no inversor: %u   Bomba: %s",
             (unsigned)s.ciclos_ok, (unsigned)s.ciclos_erro, (unsigned)s.vfd_falhas, (s.bomba_on & 1) ? "ON" : "OFF (a seco)");
    lv_label_set_text(lbl_a_cont, buf);

    snprintf(buf, sizeof(buf), "X14:%d X15:%d | X16:%d X17:%d X12:%d | luz verde:%d vermelha:%d",
             (s.io2_di >> 4) & 1, (s.io2_di >> 5) & 1, (s.io2_di >> 7) & 1, (s.io2_di >> 6) & 1, (s.io2_di >> 2) & 1,
             (s.w1_do >> 7) & 1, (s.w2_do_real >> 1) & 1);
    lv_label_set_text(lbl_a_sens, buf);

    lv_label_set_text(lbl_a_pausa, s.estado_auto == 8 ? "CONTINUAR" : "PAUSAR");

    static const char* TP[4] = { "TIPO: PRESENCIAL", "TIPO: APLICATIVO", "TIPO: SOCIO", "TIPO: BONUS" };
    static const uint32_t TCOR[4] = { 0x444C56, 0x1E5FA8, 0xE08A00, 0x7B3FA0 };
    uint8_t tp = s.tipo_prox & 3;
    lv_label_set_text(lbl_socio, TP[tp]);
    lv_obj_set_style_bg_color(btn_socio, lv_color_hex(TCOR[tp]), 0);

    // planilha: pede as tabelas 5/0 e 5/1 a cada 3 s e mostra o ultimo valor recebido
    if ((millis() - pl_req_ms) > 3000) { pl_req_ms = millis(); cfg_pedir(5, 0); cfg_pedir(5, 1); }
    if (g_cfg_ok[5][0] && g_cfg_ok[5][1]) {
        const uint16_t* v0 = g_cfg[5][0]; const uint16_t* v1 = g_cfg[5][1];
        char t[24];
        for (int r = 1; r <= 4; r++) {
            unsigned tot = 0;
            for (int c = 0; c < 4; c++) {
                unsigned q = (r == 1) ? v0[c] : (r == 2) ? v0[4 + c] : (r == 3) ? v0[8 + c] : v1[c];
                snprintf(t, sizeof(t), "%u", q); lv_label_set_text(pl_cel[r][c], t); tot += q;
            }
            snprintf(t, sizeof(t), "%u", tot); lv_label_set_text(pl_cel[r][4], t);
        }
        unsigned dia = v0[12] & 0xFF, mes = v0[12] >> 8, ano = v0[13];
        char d[40];
        if (ano) snprintf(d, sizeof(d), "Desde %02u/%02u/%04u", dia, mes, ano); else snprintf(d, sizeof(d), "Desde --/--/----");
        lv_label_set_text(pl_data, d);
    }

}

static void ui_atualizar() {
    bool contato = g_st_ok && (millis() - g_st_ms) < 2000;
    MsgTesteStatus s = g_st;   // copia local (o callback pode atualizar a qualquer momento)

    ui_evento_atualiza(contato, s);

    // TECNICO presente: enquanto estiver nas telas TECNICO, MANUAL ou WI-FI avisa a W1 (acao 70) para manter as luzes da maquina acesas.
    {
        static uint32_t t_ping = 0; static lv_obj_t* tela_ant = nullptr;
        lv_obj_t* a = lv_scr_act();
        bool tec = (a == scr_principal || a == scr_manual || a == scr_wifi || a == scr_rede || a == scr_cad || a == scr_cad_nova);
        if (tec && (a != tela_ant || millis() - t_ping > 10000)) { t_ping = millis(); enviar(70, 1, 0); }
        tela_ant = a;
    }

    // Ciclo armado/iniciado de fora (painel fisico, controle remoto): mostra a tela AUTOMATICO e o modelo pedido.
    static uint8_t estado_ant = 0;
    if (contato) {
        if (estado_ant == 0 && s.estado_auto >= 1 && s.estado_auto <= 5 && scr_auto && lv_scr_act() != scr_auto) lv_scr_load(scr_auto);
        estado_ant = s.estado_auto;
        if (((s.estado_auto >= 1 && s.estado_auto <= 5) || s.estado_auto == 8) && s.programa_sel >= 1 && s.programa_sel <= 4 && g_modelo_sel != s.programa_sel) {
            g_modelo_sel = s.programa_sel; marca_modelo();
        }
    }

    if (scr_manual && lv_scr_act() == scr_manual) { ui_atualizar_manual(contato, s); return; }
    if (scr_auto && lv_scr_act() == scr_auto)     { ui_atualizar_auto(contato, s);   return; }
    if (scr_hub && lv_scr_act() == scr_hub)       { return; }
    if (scr_ed && lv_scr_act() == scr_ed)         { ui_atualizar_ed(contato, s);     return; }
    if (scr_wifi && lv_scr_act() == scr_wifi)     { ui_atualizar_wifi(contato);      return; }
    if (scr_cad && (lv_scr_act() == scr_cad || lv_scr_act() == scr_cad_nova)) { ui_atualizar_cad(contato); return; }
    if (scr_rede && lv_scr_act() == scr_rede)     { return; }

    if (!g_st_ok) {
        lv_label_set_text(lbl_estado, "SEM CONTATO COM A WAVESHARE 1 (nunca recebeu status)");
        lv_obj_set_style_text_color(lbl_estado, COR_VERMELHO, 0);
        return;
    }

    char buf[160];
    lv_color_t cor = COR_TEXTO;
    switch (s.estado_auto) {
        case 0:  snprintf(buf, sizeof(buf), "PARADO (pronto)");           cor = COR_FRACO; break;
        case 5:  snprintf(buf, sizeof(buf), "TESTE EM ANDAMENTO");        cor = COR_VERDE; break;
        case 7:  snprintf(buf, sizeof(buf), "ERRO - o teste parou");      cor = COR_VERMELHO; break;
        default: snprintf(buf, sizeof(buf), "estado interno %d", (int)s.estado_auto); cor = COR_AMARELO; break;
    }
    if (s.home_estado >= 1 && s.home_estado <= 4) { snprintf(buf, sizeof(buf), "%s", NOMES_HOME[s.home_estado]); cor = COR_AMARELO; }
    if (!contato) {   // dados abaixo sao do ULTIMO status recebido
        snprintf(buf, sizeof(buf), "SEM CONTATO COM A W1 HA %lu s (dados abaixo = ultimo status)",
                 (unsigned long)((millis() - g_st_ms) / 1000));
        cor = COR_VERMELHO;
    }
    lv_label_set_text(lbl_estado, buf);
    lv_obj_set_style_text_color(lbl_estado, cor, 0);

    if (s.estado_auto == 5 && s.sub_estado < (sizeof(NOMES_ETAPA_AP) / sizeof(NOMES_ETAPA_AP[0]))) {
        snprintf(buf, sizeof(buf), "Etapa: %s   (giro %d/3)", NOMES_ETAPA_AP[s.sub_estado], (int)s.giro_n + 1);
        lv_label_set_text(lbl_etapa, buf);
    } else {
        lv_label_set_text(lbl_etapa, (s.bomba_on & 1) ? "Bomba habilitada no proximo teste (Y13; SAJ em frequencia fixa)"
                                                : "Teste a seco: sem Y13 (bomba nao liga)");
    }

    char msg[56];
    strncpy(msg, s.msg, sizeof(msg) - 1); msg[sizeof(msg) - 1] = '\0';
    lv_label_set_text(lbl_msg, msg);

    snprintf(buf, sizeof(buf), "Ciclos OK: %u     Erros: %u     Falhas de escrita no inversor: %u",
             (unsigned)s.ciclos_ok, (unsigned)s.ciclos_erro, (unsigned)s.vfd_falhas);
    lv_label_set_text(lbl_cont, buf);

    snprintf(buf, sizeof(buf), "W1: %s   W2: %s   Delta: %.1f Hz (so atualiza parado)",
             contato ? "OK" : "SEM CONTATO", s.w2_ok ? "OK" : "SEM CONTATO", s.vfd_freq_x100 / 100.0f);
    lv_label_set_text(lbl_link, buf);

    {
        static const char* RST[] = { "?", "POWERON", "EXT", "SW", "PANIC", "INT_WDT", "TASK_WDT", "WDT",
                                     "DEEPSLEEP", "BROWNOUT", "SDIO", "USB", "JTAG", "EFUSE", "PWR_GLITCH", "CPU_LOCKUP" };
        snprintf(buf, sizeof(buf), "W1 ligada ha %lu s | ultimo reset: %s | maior pausa do loop: %u ms",
                 (unsigned long)s.up_s, RST[s.rst_motivo < 16 ? s.rst_motivo : 0], (unsigned)s.loop_max_ms);
        lv_label_set_text(lbl_w1, buf);
    }
    // io2: X10=b0 X11=b1 X12=b2 X13=b3 X14=b4 X15=b5 X17=b6 X16=b7 | io1: X0=b0 X7=b7
    snprintf(buf, sizeof(buf), "X16:%d X17:%d X7:%d X11:%d X10:%d X12:%d X13:%d X14:%d X15:%d X0:%d",
             (s.io2_di >> 7) & 1, (s.io2_di >> 6) & 1, (s.io1_di >> 7) & 1, (s.io2_di >> 1) & 1,
             s.io2_di & 1, (s.io2_di >> 2) & 1, (s.io2_di >> 3) & 1, (s.io2_di >> 4) & 1,
             (s.io2_di >> 5) & 1, s.io1_di & 1);
    lv_label_set_text(lbl_sens, buf);

    // diagnostico do ultimo giro (tempos desde a saida da pos 2)
    if (s.ug_tipo == 0 && s.ug_dt_ms == 0) {
        lv_label_set_text(lbl_giro, "Ultimo giro: (nenhum ainda)");
    } else if (s.ug_tipo == 0) {
        snprintf(buf, sizeof(buf), "Ultimo giro 1>2: parou por %s aos %.1f s",
                 s.ug_como == 5 ? "TIMEOUT (erro)" : "TEMPO", s.ug_dt_ms / 1000.0f);
        lv_label_set_text(lbl_giro, buf);
    } else {
        char x16[16], x17[16];
        if (s.ug_x16_ms) snprintf(x16, sizeof(x16), "%.1fs", s.ug_x16_ms / 1000.0f); else snprintf(x16, sizeof(x16), "nao viu");
        if (s.ug_x17_ms) snprintf(x17, sizeof(x17), "%.1fs", s.ug_x17_ms / 1000.0f); else snprintf(x17, sizeof(x17), "nao viu");
        snprintf(buf, sizeof(buf), "Ultimo giro 2>1: X16 em %s, X17 em %s | parou aos %.1fs por %s | busca fina: %s (%u pulsos)",
                 x16, x17, s.ug_dt_ms / 1000.0f, s.ug_como == 1 ? "X16+X17" : "TIMEOUT",
                 s.ug_fh == 1 ? "OK" : (s.ug_fh == 2 ? "FALHOU" : "nao entrou"), (unsigned)s.ug_pulsos);
        lv_label_set_text(lbl_giro, buf);
    }

    // comandado x real (bit3 = DO4: Y4 na W1 e Y14 na W2; bit2 = DO3: Y13 na W2)
    {
        static const char* MOV[] = { "PARADO", "FRENTE", "REVERSO" };
        snprintf(buf, sizeof(buf), "Y4:%d | Y14 cmd:%d real:%d | Y13 cmd:%d real:%d | Delta cmd: %s %.1f Hz",
                 (s.w1_do >> 3) & 1, (s.w2_do_cmd >> 3) & 1, (s.w2_do_real >> 3) & 1,
                 (s.w2_do_cmd >> (Y13_CANAL_W2 - 1)) & 1, (s.w2_do_real >> (Y13_CANAL_W2 - 1)) & 1,
                 MOV[s.vfd_mov > 2 ? 0 : s.vfd_mov], s.vfd_mov_freq / 10.0f);
        lv_label_set_text(lbl_cmd, buf);
    }

    lv_label_set_text(lbl_bomba, (s.bomba_on & 1) ? "BOMBA: ON (Y13)" : "BOMBA: OFF (a seco)");
    lv_obj_set_style_bg_color(btn_bomba, (s.bomba_on & 1) ? lv_color_hex(0xE08A00) : COR_CINZA, 0);
    bool real = (s.bomba_on & 2) != 0;
    lv_label_set_text(lbl_t_carro, real ? "COM X10\n(carro real)" : "SEM X10\n(a seco)");
    lv_obj_set_style_bg_color(btn_t_carro, real ? lv_color_hex(0xE08A00) : COR_CINZA, 0);
    {   // nuvem / licenca (o display conversa com a camera)
        char nb[160];
        const char* on = nd_online() ? "ONLINE" : "OFFLINE";
        char idade[16]; if (nd_idade_s() == 0xFFFF) snprintf(idade, sizeof(idade), "nunca"); else snprintf(idade, sizeof(idade), "%us", (unsigned)nd_idade_s());
        snprintf(nb, sizeof(nb), "Nuvem: %s (ultima resposta: %s) | Licenca: %s | Eventos na fila: %u%s%s%s", on, idade,
                 nd_lic_bloq() ? "BLOQUEADA" : (nd_lic_aviso() ? "AVISO" : "ok"), (unsigned)nd_evq_n(),
                 (s.nuvem_flags & 8) ? " | ASPIRADOR ligado" : "", (s.nuvem_flags & 16) ? " | ciclo do APP" : "", cad_provisionado() ? "" : " | NAO CADASTRADA");
        lv_label_set_text(lbl_nuvem, nb);
        lv_obj_set_style_text_color(lbl_nuvem, (nd_online() && !nd_lic_bloq()) ? COR_VERDE : COR_AMARELO, 0);
    }
    bool bt = (s.man_saidas >> 6) & 1;
    lv_label_set_text(lbl_t_bomba_teste, bt ? "BOMBA TESTE\nLIGADA" : "BOMBA TESTE\n(20 s)");
    lv_obj_set_style_bg_color(btn_t_bomba_teste, bt ? lv_color_hex(0xC62828) : COR_CINZA, 0);
}

// ----------------------------------------------------------- setup/loop ----
void setup() {
    Serial.begin(115200);
    delay(300);

    Board* board = new Board();
    board->init();
#if LVGL_PORT_AVOID_TEARING_MODE
    auto lcd = board->getLCD();
    lcd->configFrameBufferNumber(LVGL_PORT_DISP_BUFFER_NUM);
#if ESP_PANEL_DRIVERS_BUS_ENABLE_RGB && CONFIG_IDF_TARGET_ESP32S3
    auto lcd_bus = lcd->getBus();
    if (lcd_bus->getBasicAttributes().type == ESP_PANEL_BUS_TYPE_RGB) {
        static_cast<BusRGB *>(lcd_bus)->configRGB_BounceBufferSize(lcd->getFrameWidth() * 10);
    }
#endif
#endif
    board->begin();
    lvgl_port_init(board->getLcd(), board->getTouch());

    nd_carregar();       // fila de eventos e licenca (NVS)
    radio_init();

    lvgl_port_lock(-1);
    ui_criar();
    lvgl_port_unlock();
    Serial.println("[TESTE] display de testes pronto");
}

void loop() {
    static uint32_t t = 0;
    if (millis() - t >= 200) {
        t = millis();
        if (lvgl_port_lock(50)) {
            ui_atualizar();
            lvgl_port_unlock();
        }
    }
    wifi_tick();         // busca de redes / migracao de canal (maquina de estados, fora do LVGL)
    cad_tick();          // cadastro da maquina (busca de unidade, cadastro, identidade)
    nd_tick();           // nuvem: heartbeat/eventos com a camera e ordens para a W1
    delay(5);
}
