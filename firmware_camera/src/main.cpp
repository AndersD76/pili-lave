/*******************************************************************
 * PILI LAVE — Firmware da CÂMERA (arquitetura simplificada / Opção A)
 * -----------------------------------------------------------------
 * A CÂMERA é o gateway de nuvem e a mestre de canal. As credenciais
 * (SSID/senha/URL/device-key) NÃO são fixas: vêm do DISPLAY por ESP-NOW
 * (MSG_WIFI_CFG) e ficam salvas no NVS. Máquina sai SEM rede — configura
 * na 1ª vez pela tela do display.
 *
 * LPR: a câmera é "burra de propósito" — SEM detecção de chegada e SEM
 * sensor: manda uma foto crua pro backend (/api/lpr/frame) a cada
 * PILI_ENVIO_INTERVALO_MS, sempre, tenha carro ou não. Toda a inteligência
 * (ler a placa, decidir se tem carro, liberar) roda na NUVEM. A resposta
 * {plate, light} é só logada aqui — quem repassa o resultado pro DISPLAY
 * é o heartbeat de sempre (MSG_HB_RESP, que já carrega lightState/start).
 *
 * Estados:
 *   CONECTADA : tem creds válidas -> conecta no roteador (canal X), anuncia
 *               MSG_CANAL(X), faz HTTPS (heartbeat/LPR), ouve MSG_WIFI_CFG.
 *   CONFIG    : sem creds / não conecta -> vai pro canal 1, anuncia
 *               MSG_CANAL(1) e ouve MSG_WIFI_CFG (o display entrega a rede).
 *
 * LED (GPIO33 AI-Thinker, ativo LOW):
 *   piscando lento = CONFIG (sem rede) / conectando
 *   2 piscadas/10s = NUVEM OK (heartbeat 200)
 *   4 piscadas/10s = Wi-Fi ok, POST falhou
 *   1 piscada  = frame LPR enviado
 *   3 piscadas = erro no envio do frame LPR
 *******************************************************************/
#include <Arduino.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <Preferences.h>
#include "esp_camera.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include <esp_system.h>
#include <nvs_flash.h>
#include "pili_cam_config.h"

/* ===================== HARD RESET no boot (via firmware) =====================
 * Ao ENERGIZAR, reinicia o chip inteiro UMA vez (CPU + todos os periféricos) com a
 * alimentação já estável (a ESP32-CAM é conhecida por subir com o OV2640/PSRAM
 * em estado inconsistente no boot frio). Depois sobe com o rádio zerado e o
 * sensor da câmera com ciclo de energia (PWDN). Motivo SW + marca em RTC: nunca
 * entra em loop. HARD_RESET_APAGA_NVS=1 apaga a NVS junto (credenciais/canal
 * — reset de fábrica); normal é 0. */
#ifndef HARD_RESET_APAGA_NVS
#define HARD_RESET_APAGA_NVS 0
#endif
#define HR_MARCA 0x50494C49UL
RTC_NOINIT_ATTR static uint32_t g_hr_marca;
static void hardResetFase1(const char* nome) {
  esp_reset_reason_t r = esp_reset_reason();
  bool energizou = (r == ESP_RST_POWERON || r == ESP_RST_BROWNOUT || r == ESP_RST_UNKNOWN);
  if (energizou && g_hr_marca != HR_MARCA) {
    g_hr_marca = HR_MARCA;
#if HARD_RESET_APAGA_NVS
    nvs_flash_erase(); nvs_flash_init();
#endif
    Serial.printf("[%s] HARD RESET: motivo=%d -> reiniciando o chip inteiro (uma vez)\n", nome, (int)r);
    Serial.flush(); delay(100);
    esp_restart();
  }
  Serial.printf("[%s] boot limpo (motivo=%d, hard reset ja feito)\n", nome, (int)r);
}
/* (sem esp_now_deinit: antes do Wi-Fi existir ele derruba o chip com LoadProhibited) */
static void hardResetRadio() { WiFi.persistent(false); WiFi.mode(WIFI_OFF); delay(50); }

/* ===== Mapa de pinos ===== */
#if defined(CAMERA_MODEL_AI_THINKER)
  #define PWDN_GPIO 32
  #define RESET_GPIO -1
  #define XCLK_GPIO 0
  #define SIOD_GPIO 26
  #define SIOC_GPIO 27
  #define Y9_GPIO 35
  #define Y8_GPIO 34
  #define Y7_GPIO 39
  #define Y6_GPIO 36
  #define Y5_GPIO 21
  #define Y4_GPIO 19
  #define Y3_GPIO 18
  #define Y2_GPIO 5
  #define VSYNC_GPIO 25
  #define HREF_GPIO 23
  #define PCLK_GPIO 22
  #define LED_STATUS 33
#elif defined(CAMERA_MODEL_XIAO_ESP32S3)
  #define PWDN_GPIO -1
  #define RESET_GPIO -1
  #define XCLK_GPIO 10
  #define SIOD_GPIO 40
  #define SIOC_GPIO 39
  #define Y9_GPIO 48
  #define Y8_GPIO 11
  #define Y7_GPIO 12
  #define Y6_GPIO 14
  #define Y5_GPIO 16
  #define Y4_GPIO 18
  #define Y3_GPIO 17
  #define Y2_GPIO 15
  #define VSYNC_GPIO 38
  #define HREF_GPIO 47
  #define PCLK_GPIO 13
  #define LED_STATUS 21
#else
  #error "Escolha a placa em pili_cam_config.h"
#endif

/* ===================================================================
 * ESP-NOW — tipos DEVEM bater com o tipos.h do display
 * =================================================================== */
#define MSG_CANAL     4   // câmera -> display+waveshares: canal atual
#define MSG_WIFI_REQ  5   // câmera -> display: pede credenciais (modo CONFIG)
#define MSG_WIFI_CFG  6   // display -> câmera: credenciais (SSID/senha/URL/key)
#define MSG_HB_STATE  7   // display -> câmera: estado da máquina p/ heartbeat
#define MSG_HB_RESP   8   // câmera -> display: resposta do backend
#define MSG_EVT       9   // display -> câmera: evento p/ a nuvem (car-entered/wash-complete/fault)
#define MSG_EVT_ACK  10   // câmera -> display: confirmação do evento (200 OK)
#define MSG_SCAN_REQ 11   // display -> câmera: "escaneia as redes e me diga"
#define MSG_SCAN_RESP 12  // câmera -> display: uma página da lista de redes encontradas
#define MSG_PROV_REQ  13  // display -> câmera: cadastra máquina NOVA (unidade+número)
#define MSG_PROV_RESP 14  // câmera -> display: resultado do cadastro
#define MSG_IDENT_REQ 15  // display -> câmera: "quem é você?" (troca de peça)
#define MSG_IDENT_RESP 16 // câmera -> display: identidade já conhecida (ou nenhuma)

typedef struct __attribute__((packed)) {
  uint8_t tipo, id_maquina, origem, seq;
} CabEspNow;

typedef struct __attribute__((packed)) { CabEspNow cab; } MsgWifiReq;

// Relay de eventos (o display não tem RAM p/ TLS; a câmera POSTa por ele)
typedef struct __attribute__((packed)) {
  CabEspNow cab;       // MSG_EVT
  uint8_t   evt_tipo;  // 1=car-entered 2=wash-complete 3=fault
  uint8_t   prog;      // programId (wash-complete)
  char      res[40];   // reservationId ("" = sem reserva)
  char      source[8]; // "" (app) ou "remote"
  char      errcode[64]; // código/msg do erro (só usado em fault; "" senão) — era
                          // 24, curto demais pras mensagens reais de auto_erro()
} MsgEvt;

typedef struct __attribute__((packed)) {
  CabEspNow cab;       // MSG_EVT_ACK
  uint8_t   evt_tipo;
  uint8_t   ok;        // 1 = backend aceitou (200)
  char      res[40];   // ecoa o reservationId (casamento no display)
} MsgEvtAck;

typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t canal; } MsgCanal;

typedef struct __attribute__((packed)) { CabEspNow cab; } MsgScanReq;

// Cadastro de máquina NOVA — DEVE bater byte a byte com tipos.h do display.
typedef struct __attribute__((packed)) {
  CabEspNow cab;          // MSG_PROV_REQ
  char      deviceKey[24];
  char      cidade[32];
  char      rua[40];
  uint16_t  numero;
  char      stationId[28];
} MsgProvReq;
typedef struct __attribute__((packed)) {
  CabEspNow cab;          // MSG_PROV_RESP
  uint8_t   ok;
  uint16_t  numero;
  char      cidade[32];
  char      rua[40];
  char      erro[48];
} MsgProvResp;

// Identidade (troca de peça) — a câmera responde com o que já tem salvo,
// sem precisar de internet nem consultar o backend de novo.
typedef struct __attribute__((packed)) { CabEspNow cab; } MsgIdentReq;
typedef struct __attribute__((packed)) {
  CabEspNow cab;          // MSG_IDENT_RESP
  uint8_t   temIdentidade;
  char      deviceKey[24];
  uint16_t  numero;
  char      cidade[32];
  char      rua[40];
} MsgIdentResp;

// Lista de redes achadas no scan, paginada (ESP-NOW <= 250 bytes por pacote).
// Só a câmera varre canais pra montar isso — o display nunca escaneia, só
// fica parado no canal 1 recebendo essa lista e o MSG_CANAL de sempre.
#define SCAN_SSID_LEN 24
#define SCAN_POR_PAGINA 4
typedef struct __attribute__((packed)) {
  char    ssid[SCAN_SSID_LEN];
  uint8_t canal;
  int8_t  rssi;
} ScanEntry;
typedef struct __attribute__((packed)) {
  CabEspNow cab;                        // tipo = MSG_SCAN_RESP
  uint8_t   pagina;                     // 0-based
  uint8_t   total_paginas;              // 0 = nenhuma rede encontrada
  uint8_t   n;                          // entradas válidas nesta página
  ScanEntry redes[SCAN_POR_PAGINA];
} MsgScanResp;   // sizeof = 4+3+4*26 = 111 bytes

// ESP-NOW <= 250 bytes. Este struct = 231 bytes (DEVE bater com o display).
typedef struct __attribute__((packed)) {
  CabEspNow cab;
  char      ssid[33];
  char      pass[65];
  uint8_t   canal;          // 0 = câmera descobre ao conectar
  char      api_url[96];
  char      dev_key[32];
} MsgWifiCfg;

typedef struct __attribute__((packed)) {
  CabEspNow cab;
  char      state[12];
  uint32_t  restanteSeg;
} MsgHbState;

typedef struct __attribute__((packed)) {
  CabEspNow cab;
  uint8_t   ok;
  uint8_t   lightState;
  uint16_t  lic_days;
  uint8_t   lic_blocked;
  uint8_t   start_valido;
  uint8_t   start_prog;
  uint32_t  start_dur;
  char      start_res[40];
} MsgHbResp;

static uint8_t _light_code(const String& s) {
  if (s == "GREEN_SOLID")   return 1;
  if (s == "GREEN_BLINK")   return 2;
  if (s == "RED_SOLID")     return 3;
  if (s == "RED_BLINK")     return 4;
  if (s == "RED_GREEN_ALT") return 5;
  return 0; // OFF
}

// MACs lógicos (byte[3] = ID_MAQUINA)
static const uint8_t MAC_CAMERA[6]    = {0x02, 0x00, 0x00, ID_MAQUINA, 0x01, 0x04};
static const uint8_t MAC_DISPLAY[6]   = {0x02, 0x00, 0x00, ID_MAQUINA, 0x01, 0x01};
static const uint8_t MAC_BROADCAST[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

/* ===== Estado / credenciais (NVS) ===== */
static Preferences   prefs;
static String        g_ssid, g_pass, g_api_url, g_dev_key;
static uint8_t       g_canal_radio = ESPNOW_CANAL;   // canal atual do rádio (1 em CONFIG)
static bool          g_cam_ok      = false;          // módulo da câmera inicializado?
static volatile bool g_cfg_novo    = false;          // recebeu MSG_WIFI_CFG (aplica no loop)
static volatile bool g_scan_pedido = false;          // recebeu MSG_SCAN_REQ (faz no loop)

// Estado recebido do display p/ o heartbeat
static volatile char     g_hb_state[12] = "FREE";
static volatile uint32_t g_hb_restante  = 0;

// Evento pendente recebido do display (1 slot; o display reenvia até o ACK)
static volatile bool     g_evt_pende = false;
static volatile MsgEvt   g_evt;

// Buffers voláteis p/ passar do callback (onRecv) pro loop
static volatile char     g_cfg_ssid[33] = {0};
static volatile char     g_cfg_pass[65] = {0};
static volatile char     g_cfg_url[128] = {0};
static volatile char     g_cfg_key[64]  = {0};

// Identidade da máquina (cadastro Nova/Substituição) — persistida na NVS,
// sobrevive a troca de display (é a câmera que fica com a "memória boa").
static String        g_cidade, g_rua;
static uint16_t      g_numero = 0;
static bool          g_identificada = false;   // já foi cadastrada com sucesso alguma vez?

static volatile bool g_prov_pedido = false;    // recebeu MSG_PROV_REQ (faz o POST no loop)
static volatile MsgProvReq g_prov_req;
static volatile bool g_ident_pedido = false;   // recebeu MSG_IDENT_REQ (responde no loop)

/* ===== LED ===== */
static void blink(int n, int ms = 120) {
#ifdef LED_STATUS
  for (int i = 0; i < n; i++) {
    digitalWrite(LED_STATUS, LOW);  delay(ms);
    digitalWrite(LED_STATUS, HIGH); delay(ms);
  }
#endif
}

/* ===== NVS ===== */
static void nvsCarregar() {
  prefs.begin("cam", true);
  g_ssid    = prefs.getString("ssid",   "");
  g_pass    = prefs.getString("pass",   "");
  g_api_url = prefs.getString("apiurl", "");
  g_dev_key = prefs.getString("devkey", "");
  g_cidade       = prefs.getString("cidade", "");
  g_rua          = prefs.getString("rua",    "");
  g_numero       = prefs.getUShort("numero", 0);
  g_identificada = prefs.getBool("identific", false);
  prefs.end();
}
static void nvsSalvar() {
  prefs.begin("cam", false);
  prefs.putString("ssid",   g_ssid);
  prefs.putString("pass",   g_pass);
  prefs.putString("apiurl", g_api_url);
  prefs.putString("devkey", g_dev_key);
  prefs.end();
}
// Salva só a identidade (separado de nvsSalvar pra não reescrever wifi
// toda vez que reconfirmar/recadastrar a máquina).
static void nvsSalvarIdentidade() {
  prefs.begin("cam", false);
  prefs.putString("cidade", g_cidade);
  prefs.putString("rua", g_rua);
  prefs.putUShort("numero", g_numero);
  prefs.putBool("identific", g_identificada);
  prefs.putString("devkey", g_dev_key);   // mesma chave usada como x-device-key nas outras rotas
  prefs.end();
}
static bool temCreds() { return g_ssid.length() > 0; }

/* ===== ESP-NOW recv (core 2.x e 3.x) ===== */
static void onRecvImpl(const uint8_t* mac, const uint8_t* data, int len) {
  if (len < (int)sizeof(CabEspNow)) return;
  const CabEspNow* cab = (const CabEspNow*)data;
  if (cab->id_maquina != ID_MAQUINA) return;
  if (cab->tipo == MSG_HB_STATE && len >= (int)sizeof(MsgHbState)) {
    const MsgHbState* m = (const MsgHbState*)data;
    strncpy((char*)g_hb_state, m->state, sizeof(g_hb_state) - 1);
    g_hb_state[sizeof(g_hb_state) - 1] = '\0';
    g_hb_restante = m->restanteSeg;
  } else if (cab->tipo == MSG_EVT && len >= (int)sizeof(MsgEvt)) {
    if (!g_evt_pende) {                       // 1 por vez; o display reenvia a cada 10s
      memcpy((void*)&g_evt, data, sizeof(MsgEvt));
      g_evt_pende = true;
    }
  } else if (cab->tipo == MSG_SCAN_REQ) {
    g_scan_pedido = true;   // faz o scan de verdade no loop (é lento, não trava callback)
  } else if (cab->tipo == MSG_WIFI_CFG && len >= (int)sizeof(MsgWifiCfg)) {
    const MsgWifiCfg* m = (const MsgWifiCfg*)data;
    strncpy((char*)g_cfg_ssid, m->ssid,    sizeof(g_cfg_ssid) - 1);
    strncpy((char*)g_cfg_pass, m->pass,    sizeof(g_cfg_pass) - 1);
    strncpy((char*)g_cfg_url,  m->api_url, sizeof(g_cfg_url)  - 1);
    strncpy((char*)g_cfg_key,  m->dev_key, sizeof(g_cfg_key)  - 1);
    g_cfg_novo = true;   // aplica no loop (fora do callback)
  } else if (cab->tipo == MSG_PROV_REQ && len >= (int)sizeof(MsgProvReq)) {
    if (!g_prov_pedido) {   // 1 por vez; se travar, técnico manda de novo pela tela
      memcpy((void*)&g_prov_req, data, sizeof(MsgProvReq));
      g_prov_pedido = true;
    }
  } else if (cab->tipo == MSG_IDENT_REQ) {
    g_ident_pedido = true;   // resposta é local (NVS já carregada), mas ainda assim só no loop
  }
}
#if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
static void onRecv(const esp_now_recv_info_t* info, const uint8_t* data, int len) { onRecvImpl(info->src_addr, data, len); }
#else
static void onRecv(const uint8_t* mac, const uint8_t* data, int len) { onRecvImpl(mac, data, len); }
#endif

static void espnowInit() {
  WiFi.mode(WIFI_STA);
  WiFi.setTxPower(WIFI_POWER_11dBm);
  esp_wifi_set_mac(WIFI_IF_STA, (uint8_t*)MAC_CAMERA);
  esp_wifi_set_channel(g_canal_radio, WIFI_SECOND_CHAN_NONE);
  if (esp_now_init() != ESP_OK) { Serial.println("[espnow] init FALHOU"); return; }
  esp_now_register_recv_cb(onRecv);
  esp_now_peer_info_t p = {};
  p.ifidx = WIFI_IF_STA; p.encrypt = false; p.channel = 0;
  memcpy(p.peer_addr, MAC_DISPLAY, 6);   if (!esp_now_is_peer_exist(MAC_DISPLAY))   esp_now_add_peer(&p);
  memcpy(p.peer_addr, MAC_BROADCAST, 6); if (!esp_now_is_peer_exist(MAC_BROADCAST)) esp_now_add_peer(&p);
  Serial.println("[espnow] pronto");
}

/* Em CONFIG: pede as credenciais ao display (ele responde MSG_WIFI_CFG).
 * Sem isto, uma câmera com NVS vazio ficaria esperando para sempre — o
 * display só envia as credenciais quando pedido (ou no salvar da tela). */
static void pedirCredenciais() {
  MsgWifiReq m; m.cab.tipo = MSG_WIFI_REQ; m.cab.id_maquina = ID_MAQUINA;
  m.cab.origem = ORIGEM_CAMERA; m.cab.seq = 0;
  esp_now_send((uint8_t*)MAC_DISPLAY,   (uint8_t*)&m, sizeof(m));
  esp_now_send((uint8_t*)MAC_BROADCAST, (uint8_t*)&m, sizeof(m));
}

/* Relay de eventos do display -> nuvem (car-entered/wash-complete/fault).
 * POSTa no endpoint certo e devolve MSG_EVT_ACK; o display só tira o evento
 * da fila NVS quando o ACK chega (garantia de entrega do DÉBITO). */
static void processarEvento() {
  if (!g_evt_pende) return;
  if (WiFi.status() != WL_CONNECTED || g_api_url.length() < 8) return;

  MsgEvt ev; memcpy(&ev, (const void*)&g_evt, sizeof(ev));

  const char* path = (ev.evt_tipo == 1) ? "/api/machine/car-entered"
                   : (ev.evt_tipo == 2) ? "/api/machine/wash-complete"
                   : (ev.evt_tipo == 3) ? "/api/machine/fault" : nullptr;
  if (!path) { g_evt_pende = false; return; }

  String body = "{";
  bool sep = false;
  if (strlen(ev.res)) { body += String("\"reservationId\":\"") + ev.res + "\""; sep = true; }
  if (ev.evt_tipo == 2 && ev.prog >= 1 && ev.prog <= 4) {
    if (sep) body += ",";
    body += String("\"programId\":") + ev.prog; sep = true;
  }
  if (strlen(ev.source)) { if (sep) body += ","; body += String("\"source\":\"") + ev.source + "\""; sep = true; }
  if (ev.evt_tipo == 3 && strlen(ev.errcode)) {   // fault: código/msg do erro
    if (sep) body += ",";
    body += String("\"errorCode\":\"") + ev.errcode + "\"";
  }
  body += "}";

  HTTPClient http; http.setTimeout(PILI_HTTP_TIMEOUT);
  WiFiClientSecure tls; tls.setInsecure();
  int code = -1;
  if (http.begin(tls, g_api_url + path)) {
    http.addHeader("Content-Type", "application/json");
    if (g_dev_key.length()) http.addHeader("x-device-key", g_dev_key);
    code = http.POST(body);
    http.end();
  }
  bool ok = (code >= 200 && code < 300);
  Serial.printf("[evt] %s -> %d %s\n", path, code, ok ? "OK" : "(retenta no proximo)");

  if (ok) {
    MsgEvtAck a = {};
    a.cab.tipo = MSG_EVT_ACK; a.cab.id_maquina = ID_MAQUINA; a.cab.origem = ORIGEM_CAMERA; a.cab.seq = 0;
    a.evt_tipo = ev.evt_tipo; a.ok = 1;
    strncpy(a.res, ev.res, sizeof(a.res) - 1);
    esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&a, sizeof(a));
  }
  g_evt_pende = false;   // falhou? o display reenvia no próximo ciclo de heartbeat
}

/* Cadastro de máquina NOVA: o display manda cidade/rua/número (ou stationId
 * de uma unidade já existente) + a identidade que ele mesmo gerou; a câmera
 * só faz o POST porque é quem tem HTTPS. Usa x-provision-secret (senha de
 * fábrica, NÃO é o x-device-key — a máquina ainda não existe no backend). */
static void processarProvisionamento() {
  if (!g_prov_pedido) return;
  g_prov_pedido = false;
  MsgProvReq req; memcpy(&req, (const void*)&g_prov_req, sizeof(req));

  MsgProvResp resp = {};
  resp.cab.tipo = MSG_PROV_RESP; resp.cab.id_maquina = ID_MAQUINA;
  resp.cab.origem = ORIGEM_CAMERA; resp.cab.seq = 0;

  if (WiFi.status() != WL_CONNECTED || g_api_url.length() < 8) {
    strncpy(resp.erro, "Camera sem internet no momento", sizeof(resp.erro) - 1);
    esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&resp, sizeof(resp));
    return;
  }

  String body = "{\"deviceKey\":\"" + String(req.deviceKey) + "\"";
  if (strlen(req.stationId)) body += ",\"stationId\":\"" + String(req.stationId) + "\"";
  else {
    body += ",\"cidade\":\"" + String(req.cidade) + "\"";
    body += ",\"rua\":\"" + String(req.rua) + "\"";
  }
  if (req.numero > 0) body += ",\"numero\":" + String(req.numero);
  body += "}";

  HTTPClient http; http.setTimeout(PILI_HTTP_TIMEOUT);
  WiFiClientSecure tls; tls.setInsecure();
  int code = -1; String respBody;
  if (http.begin(tls, g_api_url + "/api/machine/provisionar")) {
    http.addHeader("Content-Type", "application/json");
    if (strlen(PILI_PROVISION_SECRET)) http.addHeader("x-provision-secret", PILI_PROVISION_SECRET);
    code = http.POST(body);
    respBody = http.getString();
    http.end();
  }
  Serial.printf("[prov] -> %d %s\n", code, respBody.substring(0, 160).c_str());

  if (code >= 200 && code < 300) {
    StaticJsonDocument<384> doc;
    if (deserializeJson(doc, respBody) == DeserializationError::Ok) {
      resp.ok = 1;
      resp.numero = doc["numero"] | 0;
      String cidade = doc["unidade"]["cidade"] | "";
      String rua    = doc["unidade"]["rua"]    | "";
      strncpy(resp.cidade, cidade.c_str(), sizeof(resp.cidade) - 1);
      strncpy(resp.rua,    rua.c_str(),    sizeof(resp.rua)    - 1);
      // Sucesso: esta câmera passa a se identificar com essa deviceKey daqui
      // pra frente (heartbeat, LPR, eventos) — igual o dev_key vindo do
      // MSG_WIFI_CFG normal, só que agora gerado pelo próprio display.
      g_dev_key      = String(req.deviceKey);
      g_cidade       = resp.cidade;
      g_rua          = resp.rua;
      g_numero       = resp.numero;
      g_identificada = true;
      nvsSalvarIdentidade();
    } else {
      strncpy(resp.erro, "Resposta da nuvem invalida", sizeof(resp.erro) - 1);
    }
  } else {
    StaticJsonDocument<192> doc;
    if (deserializeJson(doc, respBody) == DeserializationError::Ok && doc["error"].is<const char*>())
      strncpy(resp.erro, (const char*)doc["error"], sizeof(resp.erro) - 1);
    else
      strncpy(resp.erro, "Falha ao cadastrar (sem detalhe)", sizeof(resp.erro) - 1);
  }
  esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&resp, sizeof(resp));
}

/* Substituição de peça: o display NOVO (NVS em branco) pergunta "quem é
 * você?" — responde com o que JÁ ESTÁ SALVO localmente, sem tocar na nuvem.
 * Sem resposta = câmera fora do alcance do rádio (outra máquina, prédio,
 * cidade); é essa distância física que impede pegar a máquina errada. */
static void responderIdentidade() {
  if (!g_ident_pedido) return;
  g_ident_pedido = false;

  MsgIdentResp resp = {};
  resp.cab.tipo = MSG_IDENT_RESP; resp.cab.id_maquina = ID_MAQUINA;
  resp.cab.origem = ORIGEM_CAMERA; resp.cab.seq = 0;
  resp.temIdentidade = g_identificada ? 1 : 0;
  if (g_identificada) {
    strncpy(resp.deviceKey, g_dev_key.c_str(), sizeof(resp.deviceKey) - 1);
    resp.numero = g_numero;
    strncpy(resp.cidade, g_cidade.c_str(), sizeof(resp.cidade) - 1);
    strncpy(resp.rua, g_rua.c_str(), sizeof(resp.rua) - 1);
  }
  esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&resp, sizeof(resp));
}

/* Anuncia MSG_CANAL no canal atual (pacote minúsculo, não mexe no Wi-Fi). */
// Watchdog do ESP-NOW — encontrado em teste real: a câmera continuava 100%
// normal no Wi-Fi/streaming/nuvem, mas o ESP-NOW simplesmente parou de sair
// (display nunca mais recebia MSG_CANAL nem heartbeat). Como esp_now_send()
// era "manda e esquece" (sem checar retorno), isso não deixava rastro
// nenhum — só um reset manual resolvia. Agora conta falhas consecutivas de
// envio; se ficar tempo demais sem NENHUM envio bem-sucedido, reinicia o
// chip sozinho (esp_restart() limpa qualquer estado de rádio corrompido).
#define ESPNOW_WD_MS 60000UL   // sem nenhum envio OK por esse tempo -> reinicia
static uint32_t g_espnow_ultimo_ok = 0;

static void anunciarCanal() {
  MsgCanal m; m.cab.tipo = MSG_CANAL; m.cab.id_maquina = ID_MAQUINA;
  m.cab.origem = ORIGEM_CAMERA; m.cab.seq = 0; m.canal = g_canal_radio;
  esp_err_t r = esp_now_send((uint8_t*)MAC_BROADCAST, (uint8_t*)&m, sizeof(m));
  if (r == ESP_OK) {
    if (g_espnow_ultimo_ok == 0) Serial.println("[ESP-NOW-WD] voltou a enviar OK");
    g_espnow_ultimo_ok = millis();
  } else {
    Serial.printf("[ESP-NOW-WD] falha ao enviar MSG_CANAL: 0x%x\n", (int)r);
  }
}

// Chamar 1x/loop. Só age se JÁ tivemos pelo menos 1 envio OK desde o boot
// (evita reiniciar em loop se o rádio nunca chegou a subir de verdade —
// esse caso já tem o próprio hard-reset de boot cuidando).
static void espnowWatchdogTick() {
  if (g_espnow_ultimo_ok == 0) return;
  if (millis() - g_espnow_ultimo_ok > ESPNOW_WD_MS) {
    Serial.printf("[ESP-NOW-WD] sem envio OK ha %lums -> reiniciando\n",
                  (unsigned long)(millis() - g_espnow_ultimo_ok));
    Serial.flush();
    delay(100);
    esp_restart();
  }
}

static void irParaCanal(uint8_t ch) {
  if (ch == g_canal_radio) return;
  esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
  g_canal_radio = ch;
}

/* Descobre o canal da rede por SCAN (NÃO conecta, não move o rádio de canal
 * de forma permanente) e anuncia MSG_CANAL(X) ainda no canal atual (1, onde
 * display/waveshares já estão esperando) ANTES de sair pra conectar de
 * verdade. Sem isso, WiFi.begin() já pula fisicamente pro canal do roteador
 * antes de qualquer anúncio sair — o handoff dependia só de sorte de hunt. */
/* Retorna o canal encontrado (1-13) ou -1 se a rede não apareceu no scan. */
static int8_t anunciarCanalAntesDeConectar() {
  Serial.printf("[wifi] escaneando %s...\n", g_ssid.c_str());
  int n = WiFi.scanNetworks();
  int8_t canalAlvo = -1;
  for (int i = 0; i < n; i++) {
    if (WiFi.SSID(i) == g_ssid) { canalAlvo = WiFi.channel(i); break; }
  }
  WiFi.scanDelete();
  if (canalAlvo < 1 || canalAlvo > 13) {
    Serial.println("[wifi] rede nao apareceu no scan -> conecta direto (sem handoff)");
    return -1;
  }
  // O scan pode ter deixado o radio em outro canal — volta pro canal atual
  // (ESPNOW_CANAL/g_canal_radio) antes de anunciar, pra display+waveshares
  // (que comecam nesse mesmo canal) ouvirem. O radio NÃO sai do canal 1 até
  // aqui — só depois de anunciar é que migra, e migra DIRETO pro canal certo
  // (sem passar pelos outros: nem no scan — que so LÊ os beacons de todos os
  // canais sem entrar neles de fato — nem depois, indo direto pro alvo).
  esp_wifi_set_channel(g_canal_radio, WIFI_SECOND_CHAN_NONE);
  Serial.printf("[wifi] rede encontrada no canal %d (scan) -> anunciando no canal %d antes de migrar\n",
                canalAlvo, g_canal_radio);
  MsgCanal m; m.cab.tipo = MSG_CANAL; m.cab.id_maquina = ID_MAQUINA;
  m.cab.origem = ORIGEM_CAMERA; m.cab.seq = 0; m.canal = (uint8_t)canalAlvo;
  for (int i = 0; i < 5; i++) {   // repete pra dar chance de quem estiver ouvindo pegar
    esp_now_send((uint8_t*)MAC_BROADCAST, (uint8_t*)&m, sizeof(m));
    delay(200);
  }
  irParaCanal((uint8_t)canalAlvo);   // agora sim migra o proprio radio, DIRETO pro alvo
  return canalAlvo;
}

static bool conectarWifi(uint32_t timeout_ms) {
  if (!temCreds()) return false;
  int8_t canalAlvo = anunciarCanalAntesDeConectar();
  Serial.printf("[wifi] conectando em %s\n", g_ssid.c_str());
  WiFi.setSleep(false);
  WiFi.setAutoReconnect(true);
  // Passa o canal já descoberto pro WiFi.begin() — sem isso, o driver faz o
  // PRÓPRIO scan interno pra achar o roteador, podendo passear por outros
  // canais durante a associação (quebra a garantia de "vai direto pro canal
  // certo"). Com o canal na mão, ele associa direto, sem procurar de novo.
  if (canalAlvo >= 1 && canalAlvo <= 13) WiFi.begin(g_ssid.c_str(), g_pass.c_str(), canalAlvo);
  else                                   WiFi.begin(g_ssid.c_str(), g_pass.c_str());
  uint32_t t = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - t < timeout_ms) { blink(1, 250); Serial.print("."); delay(250); }
  if (WiFi.status() == WL_CONNECTED) {
    g_canal_radio = WiFi.channel();
    Serial.printf("\n[wifi] ok: %s canal %d\n", WiFi.localIP().toString().c_str(), g_canal_radio);
    return true;
  }
  Serial.println("\n[wifi] FALHOU");
  return false;
}

/* Atende um MSG_SCAN_REQ do display: escaneia as redes (só a câmera escaneia
 * — o display nunca mexe no próprio rádio pra isso) e manda a lista de volta
 * paginada por ESP-NOW. Roda no loop (fora do callback), é lento (~2-4s). */
static void atenderScanRequest() {
  Serial.println("[scan] pedido do display -> escaneando...");
  int n = WiFi.scanNetworks();
  uint8_t totalPaginas = (n <= 0) ? 0 : (uint8_t)((n + SCAN_POR_PAGINA - 1) / SCAN_POR_PAGINA);
  if (totalPaginas == 0) totalPaginas = 1;  // manda 1 página vazia pra avisar "nada encontrado"

  for (uint8_t pg = 0; pg < totalPaginas; pg++) {
    MsgScanResp r = {};
    r.cab.tipo = MSG_SCAN_RESP; r.cab.id_maquina = ID_MAQUINA;
    r.cab.origem = ORIGEM_CAMERA; r.cab.seq = 0;
    r.pagina = pg; r.total_paginas = totalPaginas;
    uint8_t cnt = 0;
    for (int i = pg * SCAN_POR_PAGINA; i < n && cnt < SCAN_POR_PAGINA; i++) {
      strncpy(r.redes[cnt].ssid, WiFi.SSID(i).c_str(), SCAN_SSID_LEN - 1);
      r.redes[cnt].canal = (uint8_t)WiFi.channel(i);
      r.redes[cnt].rssi  = (int8_t)WiFi.RSSI(i);
      cnt++;
    }
    r.n = cnt;
    esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&r, sizeof(r));
    delay(50);   // não afoga o rádio mandando tudo de uma vez
  }
  WiFi.scanDelete();
  // O scan pode deixar o rádio "esquecido" em outro canal (ex: parado no
  // último visitado, tipicamente 13) se a câmera não estiver 100% estável
  // no momento — sem isso, ela para de anunciar o canal certo pro
  // display/waveshares até cair e reconectar de novo. Garante explicitamente,
  // como já é feito em anunciarCanalAntesDeConectar().
  esp_wifi_set_channel(g_canal_radio, WIFI_SECOND_CHAN_NONE);
  Serial.printf("[scan] %d rede(s) encontrada(s), enviado em %d pagina(s)\n", n < 0 ? 0 : n, totalPaginas);
}

static uint32_t g_tReconn = 0;   // usado pelo loop() (!conectada) e por aplicarCfgNovo() p/ forçar retry imediato

/* Aplica credenciais novas recebidas do display (MSG_WIFI_CFG). */
static void aplicarCfgNovo() {
  g_ssid = String((const char*)g_cfg_ssid);
  g_pass = String((const char*)g_cfg_pass);
  if (strlen((const char*)g_cfg_url) > 0) g_api_url = String((const char*)g_cfg_url);
  if (strlen((const char*)g_cfg_key) > 0) g_dev_key = String((const char*)g_cfg_key);
  nvsSalvar();
  Serial.printf("[cfg] novas credenciais: ssid='%s' (pass_len=%d) url='%s'\n",
                g_ssid.c_str(), g_pass.length(), g_api_url.c_str());
  // NÃO conecta aqui de forma bloqueante (isso travava o loop() por até ~24s —
  // scan + espera de conexão — deixando o rádio mudo sem anunciar MSG_CANAL,
  // e o display mostrava "sem contato" mesmo sem ter perdido o canal de
  // verdade). Só desconecta e força o mecanismo de retry do loop() (que já
  // existe, limitado a 8s por tentativa) a tentar já na próxima passagem.
  WiFi.disconnect();
  g_tReconn = 0;   // "vencido" -> o ramo (!conectada) do loop() tenta de novo imediatamente
}

/* Heartbeat: POST <url>/api/machine/heartbeat com o estado vindo do display. */
static void fazerHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (g_api_url.length() < 8) return;
  String url = g_api_url + PILI_HB_PATH;
  HTTPClient http; http.setTimeout(PILI_HTTP_TIMEOUT);
  WiFiClientSecure tls; tls.setInsecure();
  if (!http.begin(tls, url)) return;
  http.addHeader("Content-Type", "application/json");
  if (g_dev_key.length()) http.addHeader("x-device-key", g_dev_key);
  String body = String("{\"state\":\"") + (const char*)g_hb_state +
                "\",\"restanteSeg\":" + String((uint32_t)g_hb_restante) + "}";
  int code = http.POST(body);
  String resp = (code == 200) ? http.getString() : String();
  http.end();

  MsgHbResp r = {};
  r.cab.tipo = MSG_HB_RESP; r.cab.id_maquina = ID_MAQUINA; r.cab.origem = ORIGEM_CAMERA; r.cab.seq = 0;
  if (code == 200) {
    StaticJsonDocument<512> doc;
    if (deserializeJson(doc, resp) == DeserializationError::Ok) {
      r.ok = 1;
      if (doc.containsKey("lightState")) r.lightState = _light_code(doc["lightState"].as<String>());
      if (doc.containsKey("license")) {
        r.lic_days    = doc["license"]["daysWithoutPayment"] | 0;
        r.lic_blocked = doc["license"]["blocked"] | 0;
      }
      if (doc.containsKey("start") && !doc["start"].isNull()) {
        String resId = doc["start"]["reservationId"] | "";
        uint8_t  pid = doc["start"]["programId"] | 0;
        uint32_t dur = doc["start"]["duracaoSeg"] | 0;
        if (resId.length() > 0 && pid >= 1 && pid <= 4) {
          r.start_valido = 1; r.start_prog = pid; r.start_dur = dur;
          strncpy(r.start_res, resId.c_str(), sizeof(r.start_res) - 1);
        }
      }
      Serial.printf("[hb] 200 state=%s lamp=%d dias=%d blk=%d start=%d\n",
                    (const char*)g_hb_state, r.lightState, r.lic_days, r.lic_blocked, r.start_valido);
      blink(2, 60);
    }
  } else {
    Serial.printf("[hb] falha code=%d | rssi=%d heap=%u max_bloco=%u\n",
                  code, (int)WiFi.RSSI(), (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
    blink(4, 60);
  }
  esp_now_send((uint8_t*)MAC_DISPLAY, (uint8_t*)&r, sizeof(r));
}

/* ===================== LPR (captura + envio p/ nuvem) =====================
 * Sem detecção local, sem sensor: a câmera manda um frame cru pro backend
 * (/api/lpr/frame) a cada PILI_ENVIO_INTERVALO_MS, sempre — o LPR (leitura
 * da placa, decidir se tem carro) roda na NUVEM, não aqui. A resposta
 * {plate, light} da nuvem é só logada; quem manda o resultado pro DISPLAY
 * é o heartbeat de sempre (MSG_HB_RESP já carrega lightState/start, porque
 * o que a nuvem decidiu entra no mesmo estado que o heartbeat lê).
 * =========================================================================*/
static bool cameraInit() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0; c.ledc_timer = LEDC_TIMER_0;
  c.pin_pwdn = PWDN_GPIO;  c.pin_reset = RESET_GPIO;
  c.pin_xclk = XCLK_GPIO;  c.pin_sccb_sda = SIOD_GPIO; c.pin_sccb_scl = SIOC_GPIO;
  c.pin_d7 = Y9_GPIO; c.pin_d6 = Y8_GPIO; c.pin_d5 = Y7_GPIO; c.pin_d4 = Y6_GPIO;
  c.pin_d3 = Y5_GPIO; c.pin_d2 = Y4_GPIO; c.pin_d1 = Y3_GPIO; c.pin_d0 = Y2_GPIO;
  c.pin_vsync = VSYNC_GPIO; c.pin_href = HREF_GPIO; c.pin_pclk = PCLK_GPIO;
  c.xclk_freq_hz = 20000000; c.pixel_format = PIXFORMAT_JPEG;
  c.frame_size = psramFound() ? FRAMESIZE_UXGA : FRAMESIZE_XGA; // 1600x1200: caracteres da placa legíveis
  c.jpeg_quality = PILI_JPEG_QUALITY;
  c.fb_count = psramFound() ? 2 : 1; // 2 buffers na PSRAM evitam FB-OVF em UXGA
  c.grab_mode = CAMERA_GRAB_LATEST;
  Serial.printf("[cam] iniciando (psram=%d, heap=%u max_bloco=%u)...\n",
                psramFound(), (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) { Serial.printf("[cam] esp_camera_init FALHOU: 0x%x\n", err); return false; }
  Serial.printf("[cam] iniciada OK (heap=%u max_bloco=%u)\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());

  sensor_t *s = esp_camera_sensor_get();
  if (s) { // placa refletiva: reforça contraste/nitidez
    // hmirror NÃO mexido — o backend (vision.ts) já é calibrado pra câmera
    // SEM espelho (rot=90 sem flop lê 0.996 pra essa montagem física; foi
    // até testado com a placa RYD1E43, medido ao vivo). Ligar o hmirror
    // aqui inverte o que o LPR já esperava, e ele passa a não reconhecer
    // nada até estourar o orçamento de tentativas de orientação por foto.
    s->set_contrast(s, 2);
    s->set_sharpness(s, 2);
    s->set_saturation(s, 0);
    s->set_whitebal(s, 1);
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);           // exposição mais estável em contraluz
    s->set_gainceiling(s, GAINCEILING_4X);
    s->set_lenc(s, 1);           // correção de lente
  }
  return true;
}

/* Envia o frame cru pro /api/lpr/frame; resposta {plate, light} é só logada.
 * Timeout curto (PILI_LPR_HTTP_TIMEOUT) de propósito: quem controla as
 * tentativas/repouso é a máquina de estados em enviarFotoPeriodica(), que
 * nunca deixa isso travar o loop() por muito tempo de uma vez. */
static bool enviarFrame(camera_fb_t *fb) {
  if (WiFi.status() != WL_CONNECTED) return false;
  if (g_api_url.length() < 8) return false;
  WiFiClientSecure client;
  client.setInsecure();               // TODO produção: pinning
  HTTPClient http;
  http.setTimeout(PILI_LPR_HTTP_TIMEOUT);
  if (!http.begin(client, g_api_url + PILI_LPR_PATH)) return false;
  http.addHeader("Content-Type", "image/jpeg");
  if (g_dev_key.length()) http.addHeader("x-device-key", g_dev_key.c_str());

  Serial.printf("[dbg] heap %u (max_bloco=%u) | frame %uKB\n",
                (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap(), (unsigned)(fb->len / 1024));
  int code = http.POST(fb->buf, fb->len);
  bool ok = (code >= 200 && code < 300); // 202 = aceito p/ análise em segundo plano
  if (ok) Serial.printf("[lpr] %uKB -> %s\n", (unsigned)(fb->len / 1024), http.getString().substring(0, 140).c_str());
  else    Serial.printf("[lpr] envio falhou (%d: %s) | rssi=%d heap=%u max_bloco=%u\n",
                         code, http.errorToString(code).c_str(), (int)WiFi.RSSI(),
                         (unsigned)ESP.getFreeHeap(), (unsigned)ESP.getMaxAllocHeap());
  http.end();
  blink(ok ? 1 : 3);
  return ok;
}

/* Sem detecção de chegada, sem sensor: manda uma foto a cada PILI_ENVIO_INTERVALO_MS,
 * sempre. A nuvem decide o que fazer com cada frame (tem carro, tem placa, etc).
 *
 * Máquina de estados NÃO-BLOQUEANTE: no máximo UMA tentativa HTTP por
 * passagem de loop(). Entre tentativas o loop() volta a rodar inteiro
 * (anunciarCanal/heartbeat/etc continuam vivos) — antes disso, até 3
 * tentativas de 15s + delays cabiam numa única chamada e podiam travar o
 * rádio por ~47s, fazendo o display "perder contato" sem o canal ter
 * mudado de verdade. */
static bool     g_lprEmAndamento = false;
static camera_fb_t *g_lprFb      = nullptr;
static int      g_lprTentativa   = 0;
static uint32_t g_lprProxTentativaMs = 0;

static void enviarFotoPeriodica() {
  static uint32_t tUltimoEnvio = 0;

  if (!g_lprEmAndamento) {
    if (millis() - tUltimoEnvio < PILI_ENVIO_INTERVALO_MS) return;
    tUltimoEnvio = millis();
    g_lprFb = esp_camera_fb_get();
    if (!g_lprFb) return;
    g_lprTentativa = 0;
    g_lprProxTentativaMs = millis();     // primeira tentativa: já, mas só na próxima volta do loop()
    g_lprEmAndamento = true;
    return;
  }

  if ((int32_t)(millis() - g_lprProxTentativaMs) < 0) return;   // ainda não é hora desta tentativa

  bool ok = enviarFrame(g_lprFb);
  g_lprTentativa++;
  if (ok || g_lprTentativa >= 3) {
    esp_camera_fb_return(g_lprFb);
    g_lprFb = nullptr;
    g_lprEmAndamento = false;
  } else {
    g_lprProxTentativaMs = millis() + (PILI_LPR_RETRY_DELAY_MS * g_lprTentativa);
  }
}

/* HARD RESET do sensor: ciclo de energia via PWDN (alto = desligado -> baixo) e
 * pulso em RESET quando o pino existir (AI-Thinker: PWDN=32, RESET nao ligado). */
static void hardResetSensor() {
  if (PWDN_GPIO >= 0) {
    pinMode(PWDN_GPIO, OUTPUT);
    digitalWrite(PWDN_GPIO, HIGH); delay(100);
    digitalWrite(PWDN_GPIO, LOW);  delay(100);
  }
  if (RESET_GPIO >= 0) {
    pinMode(RESET_GPIO, OUTPUT);
    digitalWrite(RESET_GPIO, LOW);  delay(20);
    digitalWrite(RESET_GPIO, HIGH); delay(20);
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);
  Serial.begin(115200);
#ifdef LED_STATUS
  pinMode(LED_STATUS, OUTPUT); digitalWrite(LED_STATUS, HIGH);
#endif
  Serial.println("\nPILI LAVE — Camera GATEWAY + LPR (Opcao A, creds do display via NVS)");

  // HARD RESET via firmware: reinicia 1x ao energizar; rádio zerado; sensor com ciclo de energia
  hardResetFase1("CAM");
  hardResetRadio();
  hardResetSensor();

  nvsCarregar();
  espnowInit();

  if (temCreds()) {
    Serial.printf("[boot] creds no NVS: ssid='%s' (pass_len=%d) url='%s'\n",
                  g_ssid.c_str(), g_pass.length(), g_api_url.c_str());
    conectarWifi(20000);
  } else {
    Serial.println("[boot] SEM credenciais -> MODO CONFIG (canal 1, aguardando o display)");
    irParaCanal(1);
  }
}

void loop() {
  static uint32_t tHb = 0, tCanal = 0;

  // (0) Aplica credenciais novas que chegaram do display
  if (g_cfg_novo) { g_cfg_novo = false; aplicarCfgNovo(); }
  // (0b) Display pediu a lista de redes (tela de config) -> escaneia e responde
  if (g_scan_pedido) { g_scan_pedido = false; atenderScanRequest(); }
  // (0c) Substituição de peça: responde de imediato, SEM depender de Wi-Fi/
  // internet — é a câmera local, não a nuvem, que confirma a identidade.
  responderIdentidade();

  bool conectada = (WiFi.status() == WL_CONNECTED);

  // (1) Anuncia o canal SEMPRE (conectada = canal do roteador; config = canal 1),
  //     pra display+waveshares acharem a câmera pelo hunt.
  if (millis() - tCanal >= PILI_CANAL_ANUNCIO_MS) { tCanal = millis(); anunciarCanal(); }
  espnowWatchdogTick();   // reinicia sozinha se o ESP-NOW parar de sair (ver comentario acima)

  if (!conectada) {
    // MODO CONFIG (sem credenciais): rádio no canal 1, anunciando, PEDINDO
    // credenciais e ouvindo MSG_WIFI_CFG. Só vale ir pro canal 1 aqui —
    // se JÁ TEM credenciais e só caiu passageiramente (sinal fraco, por
    // exemplo), ir pro canal 1 é um bug: muda o que anunciarCanal() manda
    // pra "canal=1" a cada 1s, arrancando o display (que estava travado
    // certo no canal do roteador) pra um canal errado, mesmo a queda sendo
    // curta e a câmera prestes a reconectar no MESMO canal de sempre.
    static uint32_t tReq = 0;
    blink(1, 250);
    if (!temCreds()) irParaCanal(1);
    if (!temCreds() && millis() - tReq > 3000) { tReq = millis(); pedirCredenciais(); }
    if (temCreds() && millis() - g_tReconn > 15000) {   // tem creds mas caiu -> retenta
      g_tReconn = millis();
      conectarWifi(8000);
    }
    return;
  }

  // CONECTADA: heartbeat + LPR + relay de eventos.
  if (millis() - tHb >= PILI_HB_INTERVALO_MS) { tHb = millis(); fazerHeartbeat(); }
  processarEvento();
  processarProvisionamento();

  if (!g_cam_ok) {
    static uint32_t tCamRetry = 0;
    if (millis() - tCamRetry < 5000) return;   // evita retry em loop apertado / spam de log
    tCamRetry = millis();
    g_cam_ok = cameraInit();
    if (!g_cam_ok) return;
  }
  enviarFotoPeriodica();
  delay(5);
}
