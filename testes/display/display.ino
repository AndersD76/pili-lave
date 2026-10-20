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
#include "lvgl_v8_port.h"
#include "protocolo_teste.h"

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

static void on_recv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
    if (len < (int)sizeof(MsgTesteStatus)) return;
    const CabEspNow* c = (const CabEspNow*)data;
    if (c->id_maquina != ID_MAQUINA || c->origem != ORIGEM_WAVE1 || c->tipo != MSG_TESTE_STATUS) return;
    memcpy(&g_st, data, sizeof(g_st));
    g_st_ms = millis();
    g_st_ok = true;
}

// Sem confirmacao no ESP-NOW: comandos criticos (PARAR) saem repetidos.
static void enviar(uint8_t acao, uint8_t repeticoes = 1) {
    MsgTesteCmd m;
    m.cab.tipo = MSG_TESTE_CMD; m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = g_seq++;
    m.acao = acao;
    for (uint8_t i = 0; i < repeticoes; i++) {
        esp_now_send((uint8_t*)MAC_WAVE1, (uint8_t*)&m, sizeof(m));
        if (i + 1 < repeticoes) delay(25);
    }
}

static void radio_init() {
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    esp_wifi_set_mac(WIFI_IF_STA, (uint8_t*)MAC_DISPLAY);
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(ESPNOW_CANAL, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    if (esp_now_init() != ESP_OK) { Serial.println("[ESP-NOW] init FALHOU"); return; }
    esp_now_set_pmk(ESPNOW_PMK);
    esp_now_register_recv_cb(on_recv);
    esp_now_peer_info_t p = {};
    p.channel = 0; p.ifidx = WIFI_IF_STA; p.encrypt = true;
    memcpy(p.lmk, ESPNOW_LMK, 16);
    memcpy(p.peer_addr, MAC_WAVE1, 6);
    esp_now_add_peer(&p);
    Serial.printf("[TESTE] radio pronto (canal fixo %d)\n", ESPNOW_CANAL);
}

// ------------------------------------------------------------------ UI -----
static lv_obj_t *lbl_estado, *lbl_etapa, *lbl_msg, *lbl_cont, *lbl_link, *lbl_sens, *lbl_giro, *lbl_cmd, *lbl_w1;
static lv_obj_t *btn_bomba, *lbl_bomba;

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

static void cb_home(lv_event_t*)    { enviar(0); }
static void cb_iniciar(lv_event_t*) { enviar(1); }
static void cb_parar(lv_event_t*)   { enviar(2, 3); }
static void cb_bomba(lv_event_t*)   {
    bool ligada = g_st_ok && g_st.bomba_on;
    enviar(ligada ? 3 : 4, 2);   // alterna (a fonte da verdade e a W1, no status)
}

static void ui_criar() {
    lv_obj_t* scr = lv_obj_create(nullptr);
    lv_obj_set_style_bg_color(scr, COR_FUNDO, 0);
    lv_obj_clear_flag(scr, LV_OBJ_FLAG_SCROLLABLE);

    // Barra de cima: botao da BOMBA no canto superior esquerdo + titulo ao lado
    btn_bomba = novo_botao(scr, "BOMBA: OFF (a seco)", COR_CINZA, 8, 8, 320, 56, cb_bomba, &lbl_bomba);
    lv_obj_t* t = novo_label(scr, &lv_font_montserrat_20, COR_AMARELO, 344, 22, 450);
    lv_label_set_text(t, "TESTE ALTA PRESSAO (etapa 0)");

    lbl_estado = novo_label(scr, &lv_font_montserrat_20, COR_TEXTO,    16, 80,  770);
    lbl_etapa  = novo_label(scr, &lv_font_montserrat_18, COR_FRACO,    16, 118, 770);
    lbl_msg    = novo_label(scr, &lv_font_montserrat_18, COR_VERMELHO, 16, 154, 770);
    lbl_cont   = novo_label(scr, &lv_font_montserrat_20, COR_TEXTO,    16, 196, 770);
    lbl_link   = novo_label(scr, &lv_font_montserrat_18, COR_FRACO,    16, 236, 770);
    lbl_w1     = novo_label(scr, &lv_font_montserrat_16, COR_VERDE,    16, 258, 780);
    lbl_sens   = novo_label(scr, &lv_font_montserrat_16, COR_FRACO,    16, 278, 770);
    lbl_giro   = novo_label(scr, &lv_font_montserrat_16, COR_AMARELO,  16, 298, 780);
    lbl_cmd    = novo_label(scr, &lv_font_montserrat_16, COR_AZUL,     16, 320, 780);

    novo_botao(scr, "HOME",          COR_AZUL,     16,  352, 170, 100, cb_home);
    novo_botao(scr, "INICIAR TESTE", COR_VERDE,   200,  352, 270, 100, cb_iniciar);
    novo_botao(scr, "PARAR",         COR_VERMELHO, 484, 352, 300, 100, cb_parar);

    lv_scr_load(scr);
}

static void ui_atualizar() {
    bool contato = g_st_ok && (millis() - g_st_ms) < 2000;
    MsgTesteStatus s = g_st;   // copia local (o callback pode atualizar a qualquer momento)

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
        lv_label_set_text(lbl_etapa, s.bomba_on ? "Bomba habilitada no proximo teste (Y13; SAJ em frequencia fixa)"
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
                 (s.w2_do_cmd >> 2) & 1, (s.w2_do_real >> 2) & 1,
                 MOV[s.vfd_mov > 2 ? 0 : s.vfd_mov], s.vfd_mov_freq / 10.0f);
        lv_label_set_text(lbl_cmd, buf);
    }

    lv_label_set_text(lbl_bomba, s.bomba_on ? "BOMBA: ON (Y13)" : "BOMBA: OFF (a seco)");
    lv_obj_set_style_bg_color(btn_bomba, s.bomba_on ? lv_color_hex(0xE08A00) : COR_CINZA, 0);
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
    delay(5);
}
