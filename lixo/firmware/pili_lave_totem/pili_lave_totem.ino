/************************************************************
 * PILI LAVE - Totem de autoatendimento (lava-rápido)
 * ----------------------------------------------------------
 * Placa: Waveshare ESP32-S3-Touch-LCD-7 (800x480, GT911)
 * Base:  ESP32_Display_Panel 1.0.4 + LVGL 8.3 (mesma base
 *        do pili_disp7 / PILI TECH)
 *
 * O MESMO sketch roda nas DUAS placas — mude PILI_LAVE_ROLE
 * em pili_lave_config.h:
 *   ROLE 1 (TOTEM):
 *     Início -> Cliente|Lavador -> Tipo de lavagem (1..4)
 *     Cliente -> PIX (QR Asaas) | Débito | Crédito (QR do
 *                checkout Asaas p/ pagar no celular)
 *     Lavador -> PIN -> registra e libera direto
 *     Aprovado/liberado -> envia START via ESP-NOW p/ máquina
 *   ROLE 2 (MÁQUINA):
 *     Recebe START, pulsa relé (PILI_RELAY_GPIO), mostra
 *     andamento e responde ACK/STATUS via ESP-NOW.
 ************************************************************/
#include <Arduino.h>
#include <esp_display_panel.hpp>
#include <lvgl.h>
#include "lvgl_v8_port.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <time.h>
#include "pili_lave_config.h"
#include "pili_lave_espnow.h"

using namespace esp_panel::drivers;
using namespace esp_panel::board;

/* ===== Fontes (Montserrat com acentos, geradas p/ PILI) ===== */
LV_FONT_DECLARE(pili_font_14);
LV_FONT_DECLARE(pili_font_16);
LV_FONT_DECLARE(pili_font_20);
LV_FONT_DECLARE(pili_font_28);
#define F14 &pili_font_14
#define F16 &pili_font_16
#define F20 &pili_font_20
#define F28 &pili_font_28
#define FNUM32 &lv_font_montserrat_32   /* só ASCII: números/siglas */

/* ===== Paleta PILI ===== */
#define COL_RED     lv_color_hex(0xDC2626)
#define COL_RED_M   lv_color_hex(0x991B1B)
#define COL_GREEN   lv_color_hex(0x10B981)
#define COL_TEAL    lv_color_hex(0x0D9488)   /* PIX */
#define COL_AMBER   lv_color_hex(0xF59E0B)
#define COL_ORANGE  lv_color_hex(0xF97316)
#define COL_GRAY    lv_color_hex(0x6B7280)
#define COL_DARK    lv_color_hex(0x111827)
#define COL_CARD    lv_color_hex(0xFFFFFF)
#define COL_TILE    lv_color_hex(0xF3F4F6)
#define COL_BORDER  lv_color_hex(0xE5E7EB)
#define COL_SLATE   lv_color_hex(0x374151)
#define COL_BLUE    lv_color_hex(0x1E40AF)
#define COL_BLUE_L  lv_color_hex(0x3B82F6)
#define COL_BG      lv_color_hex(0xEEF2F7)

/* ===== Programas de lavagem ===== */
typedef struct { const char *nome; uint32_t precoCent; uint16_t minutos; } Programa;
static const Programa PROGRAMAS[5] = {
  { "", 0, 0 },   /* índice 0 não usado */
  { PILI_PROG1_NOME, PILI_PROG1_PRECO, PILI_PROG1_MIN },
  { PILI_PROG2_NOME, PILI_PROG2_PRECO, PILI_PROG2_MIN },
  { PILI_PROG3_NOME, PILI_PROG3_PRECO, PILI_PROG3_MIN },
  { PILI_PROG4_NOME, PILI_PROG4_PRECO, PILI_PROG4_MIN },
};
static const lv_color_t PROG_COL[5] = {
  lv_color_hex(0x000000), lv_color_hex(0x3B82F6), lv_color_hex(0x10B981),
  lv_color_hex(0xF59E0B), lv_color_hex(0xDC2626)
};

/* ===== Persistência (NVS) ===== */
Preferences g_prefs;

/* ===== Fila de liberações pendentes (aguardando ACK) ===== */
#define QUEUE_MAX 4
static PiliLaveStart g_queue[QUEUE_MAX];
static uint8_t       g_queueN = 0;

/* ===== Pedidos da UI -> loop (a UI NUNCA faz rede/NVS) ===== */
enum : uint8_t {
  REQ_NONE = 0,
  REQ_PAY_PIX,
  REQ_PAY_DEBITO,
  REQ_PAY_CREDITO,
  REQ_PAY_CANCEL,
  REQ_LAVADOR_GO,
};
static volatile uint8_t g_req       = REQ_NONE;
static volatile uint8_t g_selOrigin = 0;   /* PILI_LAVE_ORIG_* */
static volatile uint8_t g_selWash   = 0;   /* 1..4 */

/* ===== Estado do pagamento (escrito só pelo loop) ===== */
enum : uint8_t { PS_IDLE = 0, PS_WAITING, PS_APPROVED };
static uint8_t  g_payState = PS_IDLE;
static String   g_payId;
static uint8_t  g_payMethod = PILI_LAVE_PAY_NENHUM;
static uint32_t g_payLastPollMs = 0;
static volatile uint32_t g_payDeadlineMs = 0;  /* p/ contador na UI */

/* ===== Visão do totem sobre a máquina (via ESP-NOW) ===== */
static volatile uint8_t  g_mState    = 0xFF;   /* 0xFF = sem sinal */
static volatile uint8_t  g_mWash     = 0;
static volatile uint16_t g_mRestante = 0;
static volatile uint32_t g_mLastMs   = 0;
static volatile uint32_t g_mCiclos   = 0;

/* ===== ESP-NOW: buffers RX (callback -> loop) ===== */
static volatile PiliLaveStart g_rxStart;   static volatile bool g_rxStartDirty  = false;
static volatile PiliLaveAck   g_rxAck;     static volatile bool g_rxAckDirty    = false;
static bool     g_espnowReady = false;

/* ===== Estado da MÁQUINA (ROLE=2) ===== */
static uint8_t  g_maqState      = PILI_LAVE_ST_LIVRE;
static uint8_t  g_maqWash       = 0;
static uint32_t g_maqEndMs      = 0;
static uint32_t g_maqSeq        = 0;      /* seq da lavagem atual */
static uint32_t g_maqLastSeqOk  = 0;      /* último seq aceito (replay) */
static uint32_t g_maqCiclos     = 0;
static uint32_t g_maqRelayOffMs = 0;
static uint32_t g_maqLastStatusTx = 0;

/* ===== Rede ===== */
static bool     g_wifiOk   = false;
static bool     g_timeOk   = false;
static uint32_t g_lastScanMs = 0;
static uint32_t g_lastStartTxMs = 0;

/* ===== Contadores do totem ===== */
static uint32_t g_lavagensHoje  = 0;
static uint32_t g_lavagensTotal = 0;
static char     g_hojeKey[12]   = "";

/* ===== Telas / widgets ===== */
static lv_obj_t *scrHome, *scrPin, *scrWash, *scrPay, *scrQr, *scrDone, *scrErr, *scrMaq;
/* topo comum */
static lv_obj_t *tbClock[8], *tbWifi[8], *tbMaq[8]; static uint8_t tbCount = 0;
/* home */
static lv_obj_t *homeStats;
/* pin */
static lv_obj_t *pinDots, *pinErr;
static char      g_pin[8] = "";
/* wash */
static lv_obj_t *washTitle, *washPrice[5];
/* pay */
static lv_obj_t *payTitle;
/* qr */
static lv_obj_t *qrCode, *qrTitle, *qrValor, *qrInstr, *qrStatus, *qrTimer, *qrSpin;
/* done */
static lv_obj_t *doneProg, *doneMaq, *doneTimer;
static volatile uint32_t g_doneShownMs = 0;
/* err */
static lv_obj_t *errMsg;
/* máquina */
static lv_obj_t *maqEstado, *maqProg, *maqTempo, *maqBar, *maqCiclosLbl, *maqSinal;

/* ============================================================
 *  Helpers
 * ============================================================ */
static void fmtMoney(char *o, size_t n, uint32_t cent) {
  snprintf(o, n, "R$ %lu,%02lu", (unsigned long)(cent / 100), (unsigned long)(cent % 100));
}
static void fmtMmSs(char *o, size_t n, uint32_t s) {
  snprintf(o, n, "%02u:%02u", (unsigned)(s / 60), (unsigned)(s % 60));
}

static lv_obj_t *mkLabel(lv_obj_t *p, const char *t, const lv_font_t *f, lv_color_t col) {
  lv_obj_t *l = lv_label_create(p);
  lv_label_set_text(l, t);
  lv_obj_set_style_text_font(l, f, 0);
  lv_obj_set_style_text_color(l, col, 0);
  return l;
}

static lv_obj_t *mkBigBtn(lv_obj_t *p, lv_color_t bg, lv_event_cb_t cb, intptr_t ud) {
  lv_obj_t *b = lv_btn_create(p);
  lv_obj_set_style_bg_color(b, bg, 0);
  lv_obj_set_style_bg_color(b, lv_color_darken(bg, 40), LV_STATE_PRESSED);
  lv_obj_set_style_radius(b, 14, 0);
  lv_obj_set_style_shadow_width(b, 12, 0);
  lv_obj_set_style_shadow_opa(b, LV_OPA_20, 0);
  if (cb) lv_obj_add_event_cb(b, cb, LV_EVENT_CLICKED, (void *)ud);
  return b;
}

/* Barra superior comum: título à esquerda, relógio/wifi/máquina à direita */
static void mkTopbar(lv_obj_t *scr, const char *titulo, bool btnVoltar, lv_event_cb_t cbVoltar) {
  lv_obj_t *bar = lv_obj_create(scr);
  lv_obj_set_pos(bar, 0, 0); lv_obj_set_size(bar, 800, 52);
  lv_obj_set_style_bg_color(bar, COL_DARK, 0);
  lv_obj_set_style_radius(bar, 0, 0);
  lv_obj_set_style_border_width(bar, 0, 0);
  lv_obj_set_style_pad_all(bar, 8, 0);
  lv_obj_clear_flag(bar, LV_OBJ_FLAG_SCROLLABLE);

  if (btnVoltar) {
    lv_obj_t *b = lv_btn_create(bar);
    lv_obj_set_size(b, 110, 36);
    lv_obj_align(b, LV_ALIGN_LEFT_MID, 0, 0);
    lv_obj_set_style_bg_color(b, COL_SLATE, 0);
    lv_obj_set_style_radius(b, 8, 0);
    lv_obj_set_style_shadow_width(b, 0, 0);
    lv_obj_add_event_cb(b, cbVoltar, LV_EVENT_CLICKED, NULL);
    lv_obj_t *bl = mkLabel(b, "< Voltar", F14, COL_CARD); lv_obj_center(bl);
    lv_obj_t *t = mkLabel(bar, titulo, F20, COL_CARD);
    lv_obj_align(t, LV_ALIGN_LEFT_MID, 124, 0);
  } else {
    lv_obj_t *t = mkLabel(bar, titulo, F20, COL_CARD);
    lv_obj_align(t, LV_ALIGN_LEFT_MID, 4, 0);
  }

  uint8_t i = tbCount;
  tbMaq[i] = mkLabel(bar, "", F14, COL_GRAY);
  lv_obj_align(tbMaq[i], LV_ALIGN_RIGHT_MID, -150, 0);
  tbWifi[i] = mkLabel(bar, "WiFi", F14, COL_GRAY);
  lv_obj_align(tbWifi[i], LV_ALIGN_RIGHT_MID, -70, 0);
  tbClock[i] = mkLabel(bar, "--:--", F14, COL_CARD);
  lv_obj_align(tbClock[i], LV_ALIGN_RIGHT_MID, -4, 0);
  tbCount++;
}

static void showScreen(lv_obj_t *scr) {
  lv_scr_load_anim(scr, LV_SCR_LOAD_ANIM_FADE_IN, 150, 0, false);
}

/* ============================================================
 *  NVS: fila, contadores, seq
 * ============================================================ */
static void queueSave() {
  g_prefs.putBytes("queue", g_queue, sizeof(PiliLaveStart) * g_queueN);
  g_prefs.putUChar("queueN", g_queueN);
}
static void queueLoad() {
  g_queueN = g_prefs.getUChar("queueN", 0);
  if (g_queueN > QUEUE_MAX) g_queueN = 0;
  if (g_queueN) {
    size_t need = sizeof(PiliLaveStart) * g_queueN;
    if (g_prefs.getBytes("queue", g_queue, need) != need) g_queueN = 0;
  }
}
static bool queuePush(const PiliLaveStart &s) {
  if (g_queueN >= QUEUE_MAX) return false;
  g_queue[g_queueN++] = s;
  queueSave();
  return true;
}
static void queuePopFront() {
  if (!g_queueN) return;
  for (uint8_t i = 1; i < g_queueN; i++) g_queue[i - 1] = g_queue[i];
  g_queueN--;
  queueSave();
}
static uint32_t nextSeq() {
  uint32_t s = g_prefs.getULong("seq", 0) + 1;
  g_prefs.putULong("seq", s);
  return s;
}

static void countersLoad() {
  g_lavagensTotal = g_prefs.getULong("total", 0);
  g_lavagensHoje  = g_prefs.getULong("hoje", 0);
  g_prefs.getString("hojeKey", g_hojeKey, sizeof(g_hojeKey));
}
static void countersBump() {
  char key[12] = "";
  struct tm tmNow;
  if (g_timeOk && getLocalTime(&tmNow, 0)) {
    strftime(key, sizeof(key), "%Y%m%d", &tmNow);
    if (strcmp(key, g_hojeKey) != 0) {          /* virou o dia */
      strlcpy(g_hojeKey, key, sizeof(g_hojeKey));
      g_lavagensHoje = 0;
      g_prefs.putString("hojeKey", g_hojeKey);
    }
  }
  g_lavagensHoje++;  g_lavagensTotal++;
  g_prefs.putULong("hoje", g_lavagensHoje);
  g_prefs.putULong("total", g_lavagensTotal);
}

/* ============================================================
 *  ESP-NOW
 * ============================================================ */
static void onEspNowRecv(const esp_now_recv_info_t *info, const uint8_t *data, int len) {
  (void)info;
  if (len < 3 || data[0] != PILI_LAVE_MAGIC || data[1] != PILI_LAVE_VERSION) return;
  switch (data[2]) {
    case PILI_LAVE_MSG_START:
      if ((size_t)len >= sizeof(PiliLaveStart)) {
        memcpy((void *)&g_rxStart, data, sizeof(PiliLaveStart));
        g_rxStartDirty = true;
      }
      break;
    case PILI_LAVE_MSG_ACK:
      if ((size_t)len >= sizeof(PiliLaveAck)) {
        memcpy((void *)&g_rxAck, data, sizeof(PiliLaveAck));
        g_rxAckDirty = true;
      }
      break;
    case PILI_LAVE_MSG_STATUS:
      if ((size_t)len >= sizeof(PiliLaveStatus)) {
        PiliLaveStatus st;
        memcpy(&st, data, sizeof(st));
        g_mState = st.state; g_mWash = st.washType;
        g_mRestante = st.restanteSeg; g_mCiclos = st.ciclosTotal;
        g_mLastMs = millis();
      }
      break;
  }
}

static void espnowInit() {
  if (g_espnowReady) return;
  if (esp_now_init() != ESP_OK) { Serial.println("ESP-NOW: init falhou"); return; }
  esp_now_register_recv_cb(onEspNowRecv);
  esp_now_peer_info_t peer;
  memset(&peer, 0, sizeof(peer));
  memcpy(peer.peer_addr, PILI_LAVE_BCAST, 6);
  peer.channel = 0;                 /* 0 = canal atual do rádio */
  peer.encrypt = false;
  peer.ifidx   = WIFI_IF_STA;
  esp_now_add_peer(&peer);
  g_espnowReady = true;
  Serial.println("ESP-NOW pronto");
}

static void espnowSend(const void *buf, size_t len) {
  if (g_espnowReady) esp_now_send(PILI_LAVE_BCAST, (const uint8_t *)buf, len);
}

/* Sem WiFi conectado: acha o canal do roteador p/ alinhar o ESP-NOW */
static void espnowScanChannel() {
  int n = WiFi.scanNetworks(false, false, false, 120);
  for (int i = 0; i < n; i++) {
    if (WiFi.SSID(i) == PILI_WIFI_SSID) {
      uint8_t ch = WiFi.channel(i);
      esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
      Serial.printf("ESP-NOW: canal %u (via scan)\n", ch);
      break;
    }
  }
  WiFi.scanDelete();
}

/* ============================================================
 *  HTTP / Asaas
 * ============================================================ */
static int asaasRequest(const char *method, const String &path, const String &body, String &resp) {
  WiFiClientSecure cli;
  cli.setInsecure();                       /* sem validação de CA (ver README) */
  HTTPClient http;
  http.setTimeout(PILI_HTTP_TIMEOUT_MS);
  http.setConnectTimeout(PILI_HTTP_TIMEOUT_MS);
  String url = String(PILI_ASAAS_BASE_URL) + path;
  if (!http.begin(cli, url)) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("access_token", PILI_ASAAS_API_KEY);
  http.addHeader("User-Agent", "PiliLaveTotem/1.0");
  int code = http.sendRequest(method, (uint8_t *)body.c_str(), body.length());
  resp = (code > 0) ? http.getString() : String("");
  http.end();
  Serial.printf("Asaas %s %s -> %d\n", method, path.c_str(), code);
  return code;
}

/* Garante um cliente Asaas p/ as cobranças (config > NVS > cria) */
static bool asaasEnsureCustomer(String &outId) {
  if (strlen(PILI_ASAAS_CUSTOMER_ID) > 0) { outId = PILI_ASAAS_CUSTOMER_ID; return true; }
  String cached = g_prefs.getString("asaasCus", "");
  if (cached.length()) { outId = cached; return true; }

  JsonDocument doc;
  doc["name"]    = PILI_ASAAS_CUSTOMER_NAME;
  doc["cpfCnpj"] = PILI_ASAAS_CUSTOMER_CPF;
  String body; serializeJson(doc, body);
  String resp;
  int code = asaasRequest("POST", "/customers", body, resp);
  if (code != 200) { Serial.println(resp); return false; }

  JsonDocument f; f["id"] = true;
  JsonDocument r;
  if (deserializeJson(r, resp, DeserializationOption::Filter(f))) return false;
  const char *id = r["id"];
  if (!id || !*id) return false;
  outId = id;
  g_prefs.putString("asaasCus", outId);
  return true;
}

/* Cria a cobrança. billingType: "PIX" | "CREDIT_CARD" | "UNDEFINED" */
static bool asaasCreatePayment(const char *billingType, uint8_t washType,
                               String &outId, String &outInvoiceUrl) {
  String cus;
  if (!asaasEnsureCustomer(cus)) return false;

  char due[12];
  struct tm tmNow;
  if (g_timeOk && getLocalTime(&tmNow, 0)) strftime(due, sizeof(due), "%Y-%m-%d", &tmNow);
  else return false;                        /* sem data válida não cobra */

  char desc[64];
  snprintf(desc, sizeof(desc), "Lavagem %s - Totem Pili Lave", PROGRAMAS[washType].nome);

  JsonDocument doc;
  doc["customer"]    = cus;
  doc["billingType"] = billingType;
  doc["value"]       = PROGRAMAS[washType].precoCent / 100.0;
  doc["dueDate"]     = due;
  doc["description"] = desc;
  String body; serializeJson(doc, body);

  String resp;
  int code = asaasRequest("POST", "/payments", body, resp);
  if (code != 200) { Serial.println(resp); return false; }

  JsonDocument f; f["id"] = true; f["invoiceUrl"] = true;
  JsonDocument r;
  if (deserializeJson(r, resp, DeserializationOption::Filter(f))) return false;
  const char *id = r["id"];
  if (!id || !*id) return false;
  outId = id;
  outInvoiceUrl = (const char *)(r["invoiceUrl"] | "");
  return true;
}

/* Payload "copia e cola" do PIX (vira QR na tela) */
static bool asaasGetPixPayload(const String &payId, String &outPayload) {
  String resp;
  int code = asaasRequest("GET", "/payments/" + payId + "/pixQrCode", "", resp);
  if (code != 200) return false;
  JsonDocument f; f["payload"] = true;      /* ignora encodedImage (base64 grande) */
  JsonDocument r;
  if (deserializeJson(r, resp, DeserializationOption::Filter(f))) return false;
  const char *p = r["payload"];
  if (!p || !*p) return false;
  outPayload = p;
  return true;
}

/* -1 erro | 0 pendente | 1 aprovado | 2 cancelado/estornado */
static int asaasGetStatus(const String &payId) {
  String resp;
  int code = asaasRequest("GET", "/payments/" + payId, "", resp);
  if (code != 200) return -1;
  JsonDocument f; f["status"] = true;
  JsonDocument r;
  if (deserializeJson(r, resp, DeserializationOption::Filter(f))) return -1;
  const char *st = r["status"] | "";
  if (!strcmp(st, "RECEIVED") || !strcmp(st, "CONFIRMED") || !strcmp(st, "RECEIVED_IN_CASH")) return 1;
  if (!strcmp(st, "PENDING") || !strcmp(st, "AWAITING_RISK_ANALYSIS")) return 0;
  return 2;
}

static void asaasCancelPayment(const String &payId) {
  if (!payId.length()) return;
  String resp;
  asaasRequest("DELETE", "/payments/" + payId, "", resp);   /* melhor esforço */
}

/* POST opcional para o backend do cliente */
static void backendNotify(const PiliLaveStart &s) {
  if (!strlen(PILI_BACKEND_URL) || !g_wifiOk) return;
  static const char *payNames[] = { "nenhum", "pix", "debito", "credito" };
  JsonDocument doc;
  doc["evento"]    = "lavagem";
  doc["origem"]    = (s.origin == PILI_LAVE_ORIG_CLIENTE) ? "cliente" : "lavador";
  doc["tipo"]      = s.washType;
  doc["programa"]  = PROGRAMAS[s.washType].nome;
  doc["valorCent"] = s.valorCent;
  doc["pagamento"] = payNames[s.payMethod <= 3 ? s.payMethod : 0];
  doc["paymentId"] = s.paymentId;
  doc["seq"]       = s.seq;
  String body; serializeJson(doc, body);

  WiFiClientSecure cli; cli.setInsecure();
  HTTPClient http;
  http.setTimeout(5000);
  if (!http.begin(cli, PILI_BACKEND_URL)) return;
  http.addHeader("Content-Type", "application/json");
  if (strlen(PILI_BACKEND_TOKEN)) http.addHeader("Authorization", String("Bearer ") + PILI_BACKEND_TOKEN);
  http.POST(body);
  http.end();
}

/* ============================================================
 *  Liberação de lavagem (fila + ESP-NOW)
 * ============================================================ */
static void sendQueueFront() {
  if (!g_queueN) return;
  espnowSend(&g_queue[0], sizeof(PiliLaveStart));
  g_lastStartTxMs = millis();
}

/* Monta o START, enfileira, notifica backend e mostra "liberada" */
static void releaseWash(uint8_t origin, uint8_t washType, uint8_t payMethod,
                        uint32_t valorCent, const char *paymentId) {
  PiliLaveStart s;
  memset(&s, 0, sizeof(s));
  s.magic = PILI_LAVE_MAGIC; s.version = PILI_LAVE_VERSION; s.msgType = PILI_LAVE_MSG_START;
  s.washType = washType; s.origin = origin; s.payMethod = payMethod;
  s.duracaoSeg = PROGRAMAS[washType].minutos * 60;
  s.seq = nextSeq();
  s.valorCent = valorCent;
  strlcpy(s.paymentId, paymentId ? paymentId : "", sizeof(s.paymentId));

  queuePush(s);
  countersBump();
  sendQueueFront();
  backendNotify(s);

  lvgl_port_lock(-1);
  char buf[80];
  char money[24]; fmtMoney(money, sizeof(money), valorCent);
  if (payMethod == PILI_LAVE_PAY_NENHUM)
    snprintf(buf, sizeof(buf), "Lavagem %u — %s (lavador)", washType, PROGRAMAS[washType].nome);
  else
    snprintf(buf, sizeof(buf), "Lavagem %u — %s — %s", washType, PROGRAMAS[washType].nome, money);
  lv_label_set_text(doneProg, buf);
  lv_label_set_text(doneMaq, "Enviando para a máquina...");
  lv_obj_set_style_text_color(doneMaq, COL_GRAY, 0);
  g_doneShownMs = millis();
  showScreen(scrDone);
  lvgl_port_unlock();
}

/* ============================================================
 *  CALLBACKS DA UI (rodam na task do LVGL — só setam flags)
 * ============================================================ */
static void cbGoHome(lv_event_t *e)   { (void)e; showScreen(scrHome); }
static void cbGoWash(lv_event_t *e)   { (void)e; showScreen(scrWash); }

static void cbCliente(lv_event_t *e) {
  (void)e;
  g_selOrigin = PILI_LAVE_ORIG_CLIENTE;
  lv_label_set_text(washTitle, "Escolha o tipo de lavagem");
  for (int i = 1; i <= 4; i++) lv_obj_clear_flag(washPrice[i], LV_OBJ_FLAG_HIDDEN);
  showScreen(scrWash);
}
static void cbLavador(lv_event_t *e) {
  (void)e;
  g_selOrigin = PILI_LAVE_ORIG_LAVADOR;
  g_pin[0] = 0;
  lv_label_set_text(pinDots, "");
  lv_obj_add_flag(pinErr, LV_OBJ_FLAG_HIDDEN);
  showScreen(scrPin);
}

static void cbPinPad(lv_event_t *e) {
  lv_obj_t *bm = lv_event_get_target(e);
  const char *txt = lv_btnmatrix_get_btn_text(bm, lv_btnmatrix_get_selected_btn(bm));
  if (!txt) return;
  size_t len = strlen(g_pin);
  if (!strcmp(txt, "C")) { g_pin[0] = 0; }
  else if (!strcmp(txt, "OK")) {
    if (!strcmp(g_pin, PILI_LAVADOR_PIN)) {
      g_pin[0] = 0;
      lv_label_set_text(washTitle, "Lavador — tipo de lavagem");
      for (int i = 1; i <= 4; i++) lv_obj_clear_flag(washPrice[i], LV_OBJ_FLAG_HIDDEN);
      showScreen(scrWash);
      return;
    }
    lv_obj_clear_flag(pinErr, LV_OBJ_FLAG_HIDDEN);
    g_pin[0] = 0;
  }
  else if (len < 6) { g_pin[len] = txt[0]; g_pin[len + 1] = 0; }
  char dots[8] = "";
  for (size_t i = 0; i < strlen(g_pin); i++) strcat(dots, "*");
  lv_label_set_text(pinDots, dots);
}

static void cbWashSel(lv_event_t *e) {
  uint8_t tipo = (uint8_t)(intptr_t)lv_event_get_user_data(e);
  g_selWash = tipo;
  if (g_selOrigin == PILI_LAVE_ORIG_LAVADOR) {
    g_req = REQ_LAVADOR_GO;                    /* loop registra e libera */
    return;
  }
  char t[96], money[24];
  fmtMoney(money, sizeof(money), PROGRAMAS[tipo].precoCent);
  snprintf(t, sizeof(t), "Lavagem %u — %s — %s", tipo, PROGRAMAS[tipo].nome, money);
  lv_label_set_text(payTitle, t);
  showScreen(scrPay);
}

static void cbPayPix(lv_event_t *e)  { (void)e; g_req = REQ_PAY_PIX; }
static void cbPayDeb(lv_event_t *e)  { (void)e; g_req = REQ_PAY_DEBITO; }
static void cbPayCred(lv_event_t *e) { (void)e; g_req = REQ_PAY_CREDITO; }
static void cbPayCancel(lv_event_t *e) { (void)e; g_req = REQ_PAY_CANCEL; }

/* ============================================================
 *  CONSTRUÇÃO DAS TELAS (TOTEM)
 * ============================================================ */
static lv_obj_t *mkScreen() {
  lv_obj_t *s = lv_obj_create(NULL);
  lv_obj_set_style_bg_color(s, COL_BG, 0);
  lv_obj_clear_flag(s, LV_OBJ_FLAG_SCROLLABLE);
  return s;
}

static void buildHome() {
  scrHome = mkScreen();
  mkTopbar(scrHome, "PILI LAVE", false, NULL);

  lv_obj_t *sub = mkLabel(scrHome, "Bem-vindo! Toque para começar", F20, COL_SLATE);
  lv_obj_align(sub, LV_ALIGN_TOP_MID, 0, 72);

  lv_obj_t *bC = mkBigBtn(scrHome, COL_GREEN, cbCliente, 0);
  lv_obj_set_size(bC, 350, 250);
  lv_obj_align(bC, LV_ALIGN_CENTER, -190, 10);
  lv_obj_t *lC1 = mkLabel(bC, "CLIENTE", F28, COL_CARD);
  lv_obj_align(lC1, LV_ALIGN_CENTER, 0, -20);
  lv_obj_t *lC2 = mkLabel(bC, "Pagar e lavar", F16, COL_CARD);
  lv_obj_align(lC2, LV_ALIGN_CENTER, 0, 24);

  lv_obj_t *bL = mkBigBtn(scrHome, COL_BLUE, cbLavador, 0);
  lv_obj_set_size(bL, 350, 250);
  lv_obj_align(bL, LV_ALIGN_CENTER, 190, 10);
  lv_obj_t *lL1 = mkLabel(bL, "LAVADOR", F28, COL_CARD);
  lv_obj_align(lL1, LV_ALIGN_CENTER, 0, -20);
  lv_obj_t *lL2 = mkLabel(bL, "Liberar com senha", F16, COL_CARD);
  lv_obj_align(lL2, LV_ALIGN_CENTER, 0, 24);

  homeStats = mkLabel(scrHome, "", F14, COL_GRAY);
  lv_obj_align(homeStats, LV_ALIGN_BOTTOM_MID, 0, -12);
}

static void buildPin() {
  scrPin = mkScreen();
  mkTopbar(scrPin, "Acesso do lavador", true, cbGoHome);

  lv_obj_t *card = lv_obj_create(scrPin);
  lv_obj_set_size(card, 360, 396);
  lv_obj_align(card, LV_ALIGN_CENTER, 0, 26);
  lv_obj_set_style_bg_color(card, COL_CARD, 0);
  lv_obj_set_style_radius(card, 14, 0);
  lv_obj_set_style_border_color(card, COL_BORDER, 0);
  lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);

  lv_obj_t *t = mkLabel(card, "Digite a senha", F16, COL_SLATE);
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 0);

  pinDots = mkLabel(card, "", FNUM32, COL_DARK);
  lv_obj_align(pinDots, LV_ALIGN_TOP_MID, 0, 26);

  pinErr = mkLabel(card, "Senha incorreta", F14, COL_RED);
  lv_obj_align(pinErr, LV_ALIGN_TOP_MID, 0, 66);
  lv_obj_add_flag(pinErr, LV_OBJ_FLAG_HIDDEN);

  static const char *map[] = { "1","2","3","\n","4","5","6","\n","7","8","9","\n","C","0","OK","" };
  lv_obj_t *bm = lv_btnmatrix_create(card);
  lv_btnmatrix_set_map(bm, map);
  lv_obj_set_size(bm, 320, 260);
  lv_obj_align(bm, LV_ALIGN_BOTTOM_MID, 0, 0);
  lv_obj_set_style_text_font(bm, F20, LV_PART_ITEMS);
  lv_obj_set_style_bg_color(bm, COL_CARD, 0);
  lv_obj_set_style_border_width(bm, 0, 0);
  lv_obj_add_event_cb(bm, cbPinPad, LV_EVENT_VALUE_CHANGED, NULL);
}

static void buildWash() {
  scrWash = mkScreen();
  mkTopbar(scrWash, "Tipo de lavagem", true, cbGoHome);

  washTitle = mkLabel(scrWash, "Escolha o tipo de lavagem", F20, COL_SLATE);
  lv_obj_align(washTitle, LV_ALIGN_TOP_MID, 0, 64);

  const int W = 372, H = 168, GX = 10, GY = 10;
  for (int i = 1; i <= 4; i++) {
    int col = (i - 1) % 2, row = (i - 1) / 2;
    lv_obj_t *b = mkBigBtn(scrWash, PROG_COL[i], cbWashSel, i);
    lv_obj_set_size(b, W, H);
    lv_obj_align(b, LV_ALIGN_TOP_LEFT,
                 14 + col * (W + GX), 100 + row * (H + GY));
    char t1[48];
    snprintf(t1, sizeof(t1), "%d  ·  %s", i, PROGRAMAS[i].nome);
    lv_obj_t *l1 = mkLabel(b, t1, F28, COL_CARD);
    lv_obj_align(l1, LV_ALIGN_CENTER, 0, -26);
    char t2[48], money[24];
    fmtMoney(money, sizeof(money), PROGRAMAS[i].precoCent);
    snprintf(t2, sizeof(t2), "%s  ·  %u min", money, PROGRAMAS[i].minutos);
    washPrice[i] = mkLabel(b, t2, F20, COL_CARD);
    lv_obj_align(washPrice[i], LV_ALIGN_CENTER, 0, 26);
  }
}

static void buildPay() {
  scrPay = mkScreen();
  mkTopbar(scrPay, "Pagamento", true, cbGoWash);

  payTitle = mkLabel(scrPay, "", F20, COL_SLATE);
  lv_obj_align(payTitle, LV_ALIGN_TOP_MID, 0, 70);

  struct { const char *t1; const char *t2; lv_color_t col; lv_event_cb_t cb; } BTNS[3] = {
    { "PIX",     "QR na tela",       COL_TEAL,   cbPayPix  },
    { "DÉBITO",  "pague no celular", COL_BLUE_L, cbPayDeb  },
    { "CRÉDITO", "pague no celular", COL_ORANGE, cbPayCred },
  };
  for (int i = 0; i < 3; i++) {
    lv_obj_t *b = mkBigBtn(scrPay, BTNS[i].col, BTNS[i].cb, 0);
    lv_obj_set_size(b, 240, 230);
    lv_obj_align(b, LV_ALIGN_CENTER, (i - 1) * 256, 40);
    lv_obj_t *l1 = mkLabel(b, BTNS[i].t1, F28, COL_CARD);
    lv_obj_align(l1, LV_ALIGN_CENTER, 0, -24);
    lv_obj_t *l2 = mkLabel(b, BTNS[i].t2, F14, COL_CARD);
    lv_obj_align(l2, LV_ALIGN_CENTER, 0, 22);
  }
}

static void buildQr() {
  scrQr = mkScreen();
  mkTopbar(scrQr, "Pagamento", false, NULL);

  lv_obj_t *card = lv_obj_create(scrQr);
  lv_obj_set_size(card, 330, 330);
  lv_obj_align(card, LV_ALIGN_LEFT_MID, 24, 20);
  lv_obj_set_style_bg_color(card, COL_CARD, 0);
  lv_obj_set_style_radius(card, 14, 0);
  lv_obj_set_style_border_color(card, COL_BORDER, 0);
  lv_obj_clear_flag(card, LV_OBJ_FLAG_SCROLLABLE);

  qrCode = lv_qrcode_create(card, 290, lv_color_hex(0x000000), lv_color_hex(0xFFFFFF));
  lv_obj_center(qrCode);
  lv_qrcode_update(qrCode, "PILI LAVE", 9);

  qrTitle = mkLabel(scrQr, "Pague com PIX", F28, COL_DARK);
  lv_obj_align(qrTitle, LV_ALIGN_TOP_LEFT, 388, 84);

  qrValor = mkLabel(scrQr, "", FNUM32, COL_DARK);
  lv_obj_align(qrValor, LV_ALIGN_TOP_LEFT, 388, 130);

  qrInstr = mkLabel(scrQr, "", F16, COL_SLATE);
  lv_label_set_long_mode(qrInstr, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(qrInstr, 380);
  lv_obj_align(qrInstr, LV_ALIGN_TOP_LEFT, 388, 182);

  qrSpin = lv_spinner_create(scrQr, 1000, 60);
  lv_obj_set_size(qrSpin, 34, 34);
  lv_obj_align(qrSpin, LV_ALIGN_TOP_LEFT, 388, 258);

  qrStatus = mkLabel(scrQr, "Aguardando pagamento...", F16, COL_AMBER);
  lv_obj_align(qrStatus, LV_ALIGN_TOP_LEFT, 434, 266);

  qrTimer = mkLabel(scrQr, "", F14, COL_GRAY);
  lv_obj_align(qrTimer, LV_ALIGN_TOP_LEFT, 388, 306);

  lv_obj_t *bCancel = mkBigBtn(scrQr, COL_RED, cbPayCancel, 0);
  lv_obj_set_size(bCancel, 200, 56);
  lv_obj_align(bCancel, LV_ALIGN_BOTTOM_LEFT, 388, -40);
  lv_obj_t *lc = mkLabel(bCancel, "Cancelar", F20, COL_CARD);
  lv_obj_center(lc);
}

static void buildDone() {
  scrDone = mkScreen();
  mkTopbar(scrDone, "PILI LAVE", false, NULL);

  lv_obj_t *circ = lv_obj_create(scrDone);
  lv_obj_set_size(circ, 120, 120);
  lv_obj_align(circ, LV_ALIGN_TOP_MID, 0, 84);
  lv_obj_set_style_radius(circ, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(circ, COL_GREEN, 0);
  lv_obj_set_style_border_width(circ, 0, 0);
  lv_obj_clear_flag(circ, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_t *ok = mkLabel(circ, "OK", F28, COL_CARD);
  lv_obj_center(ok);

  lv_obj_t *t = mkLabel(scrDone, "Lavagem liberada!", F28, COL_DARK);
  lv_obj_align(t, LV_ALIGN_TOP_MID, 0, 224);

  doneProg = mkLabel(scrDone, "", F20, COL_SLATE);
  lv_obj_align(doneProg, LV_ALIGN_TOP_MID, 0, 272);

  doneMaq = mkLabel(scrDone, "", F16, COL_GRAY);
  lv_obj_align(doneMaq, LV_ALIGN_TOP_MID, 0, 316);

  doneTimer = mkLabel(scrDone, "", F14, COL_GRAY);
  lv_obj_align(doneTimer, LV_ALIGN_BOTTOM_MID, 0, -16);

  lv_obj_t *b = mkBigBtn(scrDone, COL_SLATE, cbGoHome, 0);
  lv_obj_set_size(b, 220, 56);
  lv_obj_align(b, LV_ALIGN_BOTTOM_MID, 0, -48);
  lv_obj_t *l = mkLabel(b, "Início", F20, COL_CARD);
  lv_obj_center(l);
}

static void buildErr() {
  scrErr = mkScreen();
  mkTopbar(scrErr, "PILI LAVE", false, NULL);

  lv_obj_t *circ = lv_obj_create(scrErr);
  lv_obj_set_size(circ, 120, 120);
  lv_obj_align(circ, LV_ALIGN_TOP_MID, 0, 90);
  lv_obj_set_style_radius(circ, LV_RADIUS_CIRCLE, 0);
  lv_obj_set_style_bg_color(circ, COL_RED, 0);
  lv_obj_set_style_border_width(circ, 0, 0);
  lv_obj_clear_flag(circ, LV_OBJ_FLAG_SCROLLABLE);
  lv_obj_t *x = mkLabel(circ, "X", F28, COL_CARD);
  lv_obj_center(x);

  errMsg = mkLabel(scrErr, "Não foi possível concluir", F20, COL_DARK);
  lv_label_set_long_mode(errMsg, LV_LABEL_LONG_WRAP);
  lv_obj_set_width(errMsg, 640);
  lv_obj_set_style_text_align(errMsg, LV_TEXT_ALIGN_CENTER, 0);
  lv_obj_align(errMsg, LV_ALIGN_TOP_MID, 0, 238);

  lv_obj_t *b = mkBigBtn(scrErr, COL_SLATE, cbGoHome, 0);
  lv_obj_set_size(b, 220, 56);
  lv_obj_align(b, LV_ALIGN_BOTTOM_MID, 0, -48);
  lv_obj_t *l = mkLabel(b, "Início", F20, COL_CARD);
  lv_obj_center(l);
}

/* ============================================================
 *  TELA DA MÁQUINA (ROLE=2)
 * ============================================================ */
static void buildMaq() {
  scrMaq = mkScreen();
  mkTopbar(scrMaq, "PILI LAVE — Máquina", false, NULL);

  maqEstado = mkLabel(scrMaq, "AGUARDANDO", F28, COL_SLATE);
  lv_obj_align(maqEstado, LV_ALIGN_TOP_MID, 0, 96);

  maqProg = mkLabel(scrMaq, "", F20, COL_GRAY);
  lv_obj_align(maqProg, LV_ALIGN_TOP_MID, 0, 152);

  maqTempo = mkLabel(scrMaq, "--:--", FNUM32, COL_DARK);
  lv_obj_set_style_transform_zoom(maqTempo, 512, 0);   /* 2x = bem grande */
  lv_obj_align(maqTempo, LV_ALIGN_CENTER, 0, 30);

  maqBar = lv_bar_create(scrMaq);
  lv_obj_set_size(maqBar, 600, 22);
  lv_obj_align(maqBar, LV_ALIGN_BOTTOM_MID, 0, -96);
  lv_bar_set_range(maqBar, 0, 100);
  lv_obj_set_style_bg_color(maqBar, COL_BORDER, 0);
  lv_obj_set_style_bg_color(maqBar, COL_GREEN, LV_PART_INDICATOR);

  maqCiclosLbl = mkLabel(scrMaq, "", F14, COL_GRAY);
  lv_obj_align(maqCiclosLbl, LV_ALIGN_BOTTOM_LEFT, 16, -14);

  maqSinal = mkLabel(scrMaq, "", F14, COL_GRAY);
  lv_obj_align(maqSinal, LV_ALIGN_BOTTOM_RIGHT, -16, -14);
}

/* ============================================================
 *  TIMER DE UI (500 ms, task do LVGL) — só leitura/labels
 * ============================================================ */
static void uiTimerCb(lv_timer_t *tm) {
  (void)tm;
  uint32_t now = millis();

  /* topo: relógio + wifi + máquina (todas as barras criadas) */
  char clk[8] = "--:--";
  struct tm tmNow;
  if (g_timeOk && getLocalTime(&tmNow, 0)) strftime(clk, sizeof(clk), "%H:%M", &tmNow);
  bool mAlive = (g_mLastMs != 0) && (now - g_mLastMs < 8000);
  for (uint8_t i = 0; i < tbCount; i++) {
    lv_label_set_text(tbClock[i], clk);
    lv_obj_set_style_text_color(tbWifi[i], g_wifiOk ? COL_GREEN : COL_RED, 0);
#if PILI_LAVE_ROLE == 1
    if (!mAlive) { lv_label_set_text(tbMaq[i], "Máq. s/ sinal"); lv_obj_set_style_text_color(tbMaq[i], COL_RED, 0); }
    else if (g_mState == PILI_LAVE_ST_LAVANDO) {
      char b[24], t[12]; fmtMmSs(t, sizeof(t), g_mRestante);
      snprintf(b, sizeof(b), "Máq. lavando %s", t);
      lv_label_set_text(tbMaq[i], b); lv_obj_set_style_text_color(tbMaq[i], COL_AMBER, 0);
    } else { lv_label_set_text(tbMaq[i], "Máq. livre"); lv_obj_set_style_text_color(tbMaq[i], COL_GREEN, 0); }
#endif
  }

#if PILI_LAVE_ROLE == 1
  /* home: contadores + fila */
  char st[96];
  if (g_queueN)
    snprintf(st, sizeof(st), "Hoje: %lu lavagens  ·  Total: %lu  ·  %u na fila da máquina",
             (unsigned long)g_lavagensHoje, (unsigned long)g_lavagensTotal, g_queueN);
  else
    snprintf(st, sizeof(st), "Hoje: %lu lavagens  ·  Total: %lu",
             (unsigned long)g_lavagensHoje, (unsigned long)g_lavagensTotal);
  lv_label_set_text(homeStats, st);

  /* QR: contagem regressiva */
  if (lv_scr_act() == scrQr && g_payDeadlineMs) {
    uint32_t dl = g_payDeadlineMs;
    char b[40], t[12];
    fmtMmSs(t, sizeof(t), (dl > now) ? (dl - now) / 1000 : 0);
    snprintf(b, sizeof(b), "Expira em %s", t);
    lv_label_set_text(qrTimer, b);
  }

  /* done: status da máquina + auto-home */
  if (lv_scr_act() == scrDone) {
    if (!g_queueN) {
      lv_label_set_text(doneMaq, "Máquina iniciou a lavagem!");
      lv_obj_set_style_text_color(doneMaq, COL_GREEN, 0);
    } else if (mAlive && g_mState == PILI_LAVE_ST_LAVANDO) {
      lv_label_set_text(doneMaq, "Máquina ocupada — na fila, inicia ao terminar");
      lv_obj_set_style_text_color(doneMaq, COL_AMBER, 0);
    }
    uint32_t shown = g_doneShownMs;
    if (shown && now - shown > PILI_DONE_AUTOHOME_S * 1000UL) {
      g_doneShownMs = 0;
      lv_scr_load(scrHome);
    } else if (shown) {
      char b[32];
      snprintf(b, sizeof(b), "Voltando ao início em %lus",
               (unsigned long)(PILI_DONE_AUTOHOME_S - (now - shown) / 1000));
      lv_label_set_text(doneTimer, b);
    }
  }
#else
  /* tela da máquina */
  if (g_maqState == PILI_LAVE_ST_LAVANDO) {
    uint32_t rest = (g_maqEndMs > now) ? (g_maqEndMs - now) / 1000 : 0;
    uint32_t total = PROGRAMAS[g_maqWash].minutos * 60;
    char t[12]; fmtMmSs(t, sizeof(t), rest);
    lv_label_set_text(maqEstado, "LAVAGEM EM ANDAMENTO");
    lv_obj_set_style_text_color(maqEstado, COL_GREEN, 0);
    char p[64];
    snprintf(p, sizeof(p), "Programa %u — %s", g_maqWash, PROGRAMAS[g_maqWash].nome);
    lv_label_set_text(maqProg, p);
    lv_label_set_text(maqTempo, t);
    lv_bar_set_value(maqBar, total ? (int32_t)(100 - rest * 100 / total) : 0, LV_ANIM_OFF);
  } else {
    lv_label_set_text(maqEstado, "AGUARDANDO LIBERAÇÃO");
    lv_obj_set_style_text_color(maqEstado, COL_SLATE, 0);
    lv_label_set_text(maqProg, "Aguardando totem...");
    lv_label_set_text(maqTempo, "--:--");
    lv_bar_set_value(maqBar, 0, LV_ANIM_OFF);
  }
  char c[40];
  snprintf(c, sizeof(c), "Lavagens executadas: %lu", (unsigned long)g_maqCiclos);
  lv_label_set_text(maqCiclosLbl, c);
  lv_label_set_text(maqSinal, g_espnowReady ? "ESP-NOW ok" : "ESP-NOW off");
#endif
}

/* ============================================================
 *  PROCESSAMENTO NO LOOP (rede, NVS, ESP-NOW)
 * ============================================================ */
static void uiShowError(const char *msg) {
  lvgl_port_lock(-1);
  lv_label_set_text(errMsg, msg);
  showScreen(scrErr);
  lvgl_port_unlock();
}

static void startPayment(uint8_t method) {
  uint8_t tipo = g_selWash;
  if (tipo < 1 || tipo > 4) return;

  if (!g_wifiOk) { uiShowError("Sem conexão com a internet.\nTente novamente em instantes."); return; }
  if (!g_timeOk) { uiShowError("Sincronizando relógio...\nTente novamente em instantes."); return; }

  /* tela QR em modo "gerando" */
  char money[24];
  fmtMoney(money, sizeof(money), PROGRAMAS[tipo].precoCent);
  lvgl_port_lock(-1);
  lv_qrcode_update(qrCode, "...", 3);
  lv_label_set_text(qrValor, money);
  lv_label_set_text(qrStatus, "Gerando cobrança...");
  lv_obj_set_style_text_color(qrStatus, COL_AMBER, 0);
  if (method == PILI_LAVE_PAY_PIX) {
    lv_label_set_text(qrTitle, "Pague com PIX");
    lv_label_set_text(qrInstr, "Abra o app do seu banco, escolha\npagar com PIX e escaneie o código.");
  } else {
    lv_label_set_text(qrTitle, method == PILI_LAVE_PAY_DEBITO ? "Débito no celular" : "Crédito no celular");
    lv_label_set_text(qrInstr, "Escaneie o QR com a câmera do\ncelular e finalize o pagamento\nno checkout seguro Asaas.");
  }
  showScreen(scrQr);
  lvgl_port_unlock();

  const char *billing = (method == PILI_LAVE_PAY_PIX) ? "PIX"
                      : (method == PILI_LAVE_PAY_DEBITO) ? PILI_BILLING_DEBITO
                      : PILI_BILLING_CREDITO;

  String payId, invoiceUrl;
  if (!asaasCreatePayment(billing, tipo, payId, invoiceUrl)) {
    uiShowError("Falha ao criar a cobrança.\nVerifique a conexão e tente de novo.");
    return;
  }

  String qrData;
  if (method == PILI_LAVE_PAY_PIX) {
    if (!asaasGetPixPayload(payId, qrData)) {
      asaasCancelPayment(payId);
      uiShowError("Falha ao gerar o QR do PIX.\nTente novamente.");
      return;
    }
  } else {
    if (!invoiceUrl.length()) {
      asaasCancelPayment(payId);
      uiShowError("Cobrança sem link de pagamento.\nTente novamente.");
      return;
    }
    qrData = invoiceUrl;
  }

  g_payId = payId;
  g_payMethod = method;
  g_payState = PS_WAITING;
  g_payLastPollMs = millis();
  g_payDeadlineMs = millis() + PILI_PAY_TIMEOUT_S * 1000UL;

  lvgl_port_lock(-1);
  lv_qrcode_update(qrCode, qrData.c_str(), qrData.length());
  lv_label_set_text(qrStatus, "Aguardando pagamento...");
  lvgl_port_unlock();
  Serial.printf("Cobrança %s criada (%s)\n", payId.c_str(), billing);
}

static void pollPayment() {
  if (g_payState != PS_WAITING) return;
  uint32_t now = millis();

  if (now > g_payDeadlineMs) {
    asaasCancelPayment(g_payId);
    g_payState = PS_IDLE; g_payId = ""; g_payDeadlineMs = 0;
    uiShowError("Tempo esgotado.\nNenhum pagamento identificado.");
    return;
  }
  if (now - g_payLastPollMs < PILI_PAY_POLL_MS) return;
  g_payLastPollMs = now;

  int st = asaasGetStatus(g_payId);
  if (st == 1) {
    uint8_t tipo = g_selWash, method = g_payMethod;
    String payId = g_payId;
    g_payState = PS_IDLE; g_payId = ""; g_payDeadlineMs = 0;
    Serial.println("Pagamento aprovado!");
    releaseWash(PILI_LAVE_ORIG_CLIENTE, tipo, method,
                PROGRAMAS[tipo].precoCent, payId.c_str());
  } else if (st == 2) {
    g_payState = PS_IDLE; g_payId = ""; g_payDeadlineMs = 0;
    uiShowError("Cobrança cancelada ou estornada.");
  }
  /* st==0 pendente: segue aguardando | st==-1 erro de rede: tenta de novo */
}

static void processRequests() {
  uint8_t req = g_req;
  if (req == REQ_NONE) return;
  g_req = REQ_NONE;

  switch (req) {
    case REQ_PAY_PIX:     startPayment(PILI_LAVE_PAY_PIX);     break;
    case REQ_PAY_DEBITO:  startPayment(PILI_LAVE_PAY_DEBITO);  break;
    case REQ_PAY_CREDITO: startPayment(PILI_LAVE_PAY_CREDITO); break;
    case REQ_PAY_CANCEL:
      if (g_payState == PS_WAITING) asaasCancelPayment(g_payId);
      g_payState = PS_IDLE; g_payId = ""; g_payDeadlineMs = 0;
      lvgl_port_lock(-1);
      showScreen(scrPay);
      lvgl_port_unlock();
      break;
    case REQ_LAVADOR_GO: {
      uint8_t tipo = g_selWash;
      if (tipo >= 1 && tipo <= 4) {
        if (g_queueN >= QUEUE_MAX) { uiShowError("Fila da máquina cheia.\nAguarde e tente novamente."); break; }
        releaseWash(PILI_LAVE_ORIG_LAVADOR, tipo, PILI_LAVE_PAY_NENHUM, 0, "");
      }
      break;
    }
  }
}

/* ACKs vindos da máquina (totem) */
static void processAck() {
  if (!g_rxAckDirty) return;
  PiliLaveAck ack;
  memcpy(&ack, (const void *)&g_rxAck, sizeof(ack));
  g_rxAckDirty = false;

  g_mState = ack.state; g_mRestante = ack.restanteSeg; g_mLastMs = millis();
  if (g_queueN && ack.seq == g_queue[0].seq && ack.accepted) {
    Serial.printf("Máquina aceitou seq %lu\n", (unsigned long)ack.seq);
    queuePopFront();
    if (g_queueN) sendQueueFront();   /* próxima da fila */
  }
}

/* STARTs vindos do totem (máquina) */
static void processStart() {
  if (!g_rxStartDirty) return;
  PiliLaveStart s;
  memcpy(&s, (const void *)&g_rxStart, sizeof(s));
  g_rxStartDirty = false;

  PiliLaveAck ack;
  memset(&ack, 0, sizeof(ack));
  ack.magic = PILI_LAVE_MAGIC; ack.version = PILI_LAVE_VERSION; ack.msgType = PILI_LAVE_MSG_ACK;
  ack.seq = s.seq;

  if (g_maqState == PILI_LAVE_ST_LAVANDO) {
    uint32_t now = millis();
    ack.state = PILI_LAVE_ST_LAVANDO;
    ack.restanteSeg = (g_maqEndMs > now) ? (g_maqEndMs - now) / 1000 : 0;
    ack.accepted = (s.seq == g_maqSeq) ? 1 : 0;     /* reenvio da atual = ok */
  } else if (s.seq == g_maqLastSeqOk) {
    ack.accepted = 1;                               /* replay de seq já executada */
    ack.state = g_maqState;
  } else {
    /* inicia a lavagem */
    g_maqState = PILI_LAVE_ST_LAVANDO;
    g_maqWash  = (s.washType >= 1 && s.washType <= 4) ? s.washType : 1;
    g_maqSeq   = s.seq;
    g_maqLastSeqOk = s.seq;
    g_maqEndMs = millis() + (uint32_t)s.duracaoSeg * 1000UL;
    g_maqCiclos++;
    g_prefs.putULong("maqCiclos", g_maqCiclos);
    g_prefs.putULong("maqLastSeq", g_maqLastSeqOk);

    digitalWrite(PILI_RELAY_GPIO, PILI_RELAY_ATIVO_ALTO ? HIGH : LOW);
    g_maqRelayOffMs = millis() + PILI_RELAY_PULSO_MS;

    ack.accepted = 1;
    ack.state = PILI_LAVE_ST_LAVANDO;
    ack.restanteSeg = s.duracaoSeg;
    Serial.printf("START seq %lu: lavagem %u por %u s (origem %u)\n",
                  (unsigned long)s.seq, s.washType, s.duracaoSeg, s.origin);
  }
  espnowSend(&ack, sizeof(ack));
}

static void maquinaTick() {
  uint32_t now = millis();
  /* desliga o pulso do relé */
  if (g_maqRelayOffMs && now > g_maqRelayOffMs) {
    digitalWrite(PILI_RELAY_GPIO, PILI_RELAY_ATIVO_ALTO ? LOW : HIGH);
    g_maqRelayOffMs = 0;
  }
  /* fim da lavagem */
  if (g_maqState == PILI_LAVE_ST_LAVANDO && now > g_maqEndMs) {
    g_maqState = PILI_LAVE_ST_LIVRE;
    g_maqWash = 0;
    Serial.println("Lavagem concluída — máquina livre");
  }
  /* broadcast de status a cada 2 s */
  if (now - g_maqLastStatusTx > 2000) {
    g_maqLastStatusTx = now;
    PiliLaveStatus st;
    memset(&st, 0, sizeof(st));
    st.magic = PILI_LAVE_MAGIC; st.version = PILI_LAVE_VERSION; st.msgType = PILI_LAVE_MSG_STATUS;
    st.state = g_maqState; st.washType = g_maqWash;
    st.restanteSeg = (g_maqState == PILI_LAVE_ST_LAVANDO && g_maqEndMs > now)
                     ? (g_maqEndMs - now) / 1000 : 0;
    st.ciclosTotal = g_maqCiclos;
    espnowSend(&st, sizeof(st));
  }
}

/* ============================================================
 *  WIFI
 * ============================================================ */
static void onWifiEvent(WiFiEvent_t ev) {
  switch (ev) {
    case ARDUINO_EVENT_WIFI_STA_GOT_IP:
      g_wifiOk = true;
      Serial.printf("WiFi ok: %s (canal %d)\n", WiFi.localIP().toString().c_str(), WiFi.channel());
      configTime(PILI_NTP_TZ_OFFSET, 0, "pool.ntp.org", "a.st1.ntp.br", "time.google.com");
      espnowInit();
      break;
    case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
      g_wifiOk = false;
      break;
    default: break;
  }
}

/* ============================================================
 *  SETUP / LOOP
 * ============================================================ */
void setup() {
  Serial.begin(115200);
  delay(300);
#if PILI_LAVE_ROLE == 1
  Serial.println("PILI LAVE — TOTEM");
#else
  Serial.println("PILI LAVE — MÁQUINA");
  pinMode(PILI_RELAY_GPIO, OUTPUT);
  digitalWrite(PILI_RELAY_GPIO, PILI_RELAY_ATIVO_ALTO ? LOW : HIGH);
#endif

  g_prefs.begin("pililave", false);
  queueLoad();
  countersLoad();
  g_maqCiclos    = g_prefs.getULong("maqCiclos", 0);
  g_maqLastSeqOk = g_prefs.getULong("maqLastSeq", 0);

  /* painel + LVGL */
  Board *board = new Board();
  board->init();
  assert(board->begin());
  lvgl_port_init(board->getLCD(), board->getTouch());

  lvgl_port_lock(-1);
  lv_theme_default_init(lv_disp_get_default(), COL_RED, COL_BLUE, false, F14);
#if PILI_LAVE_ROLE == 1
  buildHome(); buildPin(); buildWash(); buildPay(); buildQr(); buildDone(); buildErr();
  lv_scr_load(scrHome);
#else
  buildMaq();
  lv_scr_load(scrMaq);
#endif
  lv_timer_create(uiTimerCb, 500, NULL);
  lvgl_port_unlock();

  /* WiFi */
  WiFi.onEvent(onWifiEvent);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(PILI_WIFI_SSID, PILI_WIFI_PASS);

  Serial.println("Setup completo");
}

void loop() {
  uint32_t now = millis();

  /* sem WiFi: garante ESP-NOW mesmo assim (canal via scan) */
  if (!g_wifiOk && now - g_lastScanMs > 30000) {
    g_lastScanMs = now;
    if (WiFi.status() != WL_CONNECTED) {
      espnowScanChannel();
      espnowInit();
    }
  }

#if PILI_LAVE_ROLE == 1
  processRequests();
  pollPayment();
  processAck();
  /* reenvia o primeiro da fila enquanto não vier ACK */
  if (g_queueN && now - g_lastStartTxMs > PILI_START_RETRY_MS) sendQueueFront();
#else
  processStart();
  maquinaTick();
#endif

  /* relógio sincronizou? */
  if (!g_timeOk) {
    time_t t = time(NULL);
    if (t > 1700000000) { g_timeOk = true; Serial.println("Hora sincronizada"); }
  }

  delay(20);
}
