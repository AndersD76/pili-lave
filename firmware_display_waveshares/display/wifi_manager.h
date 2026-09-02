#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include "tipos.h"        // CabEspNow, ID_MAQUINA, ORIGEM_DISPLAY, MSG_CANAL/REQ/CFG (enum)
#include "nvs_manager.h"
// =======================================================================
// wifi_manager.h — Conexão Wi-Fi + sincronização de canal com ESP-NOW
//                + fornecimento de credenciais para a câmera ESP32-S3-CAM
//
// REGRAS:
//   1. Conecta usando credenciais salvas em NVS.
//   2. Após conectar, lê o canal do roteador, salva em NVS e envia
//      MSG_CANAL broadcast para as Waveshares sincronizarem.
//   3. Se não tiver credenciais, usa canal salvo em NVS (padrão 1).
//   4. Reconexão automática em background — nunca bloqueia o loop.
//   5. Responde a MSG_WIFI_REQ da câmera com MSG_WIFI_CFG (SSID+senha+canal).
//   6. O ESP-NOW já foi iniciado antes (em comm_espnow_init()) —
//      wifi_manager só reconfigura o canal, não reinicia o ESP-NOW.
// =======================================================================
// MSG_CANAL / MSG_WIFI_REQ / MSG_WIFI_CFG vêm do enum em tipos.h (Bloco 9)
// Pacote de sincronização de canal (Waveshares)
typedef struct __attribute__((packed)) {
    CabEspNow cab;
    uint8_t   canal;
} MsgCanal;
// Pacote de pedido de credenciais (câmera → display)
typedef struct __attribute__((packed)) {
    CabEspNow cab;        // tipo = MSG_WIFI_REQ
} MsgWifiReq;
// Pacote de resposta com credenciais (display → câmera)
// ATENÇÃO: ESP-NOW só transmite até 250 bytes. Este struct = 231 bytes (ok).
// NÃO aumentar api_url/dev_key sem recontar (cab4 + ssid33 + pass65 + canal1 + url96 + key32).
typedef struct __attribute__((packed)) {
    CabEspNow cab;        // tipo = MSG_WIFI_CFG
    char      ssid[33];   // SSID (max 32 chars + null)
    char      pass[65];   // senha (max 64 chars + null)
    uint8_t   canal;      // dica de canal (0 = câmera descobre ao conectar)
    char      api_url[96];    // URL do backend (max 95 chars)
    char      dev_key[32];    // device key (max 31 chars)
} MsgWifiCfg;
// MAC lógico da câmera — fixo, definido no firmware dela também
// Byte[3] = ID_MAQUINA, byte[4] = 0x01, byte[5] = 0x04 (câmera)
static const uint8_t MAC_CAMERA[6] = {0x02,0x00,0x00,ID_MAQUINA,0x01,0x04};

// === Opção A: envia as CREDENCIAIS pra CÂMERA (que é quem conecta no Wi-Fi) ===
// O display não conecta — só descobre o canal da rede pelo SCAN (o canal já vem
// no scan, sem conectar) e manda SSID+senha+URL+device-key pra câmera por ESP-NOW,
// VARRENDO 1-13 pra alcançá-la em qualquer canal (config no 1 ou já conectada).
void enviar_cfg_camera(const String& ssid, const String& pass,
                       const String& url, const String& key) {
    // NÃO fazemos scan aqui (WiFi.scanNetworks quebra o ESP-NOW). O canal não é
    // necessário: a câmera descobre ao conectar. Mandamos canal=0.
    MsgWifiCfg m = {};
    m.cab.tipo = MSG_WIFI_CFG; m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem = ORIGEM_DISPLAY; m.cab.seq = 0;
    strncpy(m.ssid,    ssid.c_str(), sizeof(m.ssid)   - 1);
    strncpy(m.pass,    pass.c_str(), sizeof(m.pass)   - 1);
    m.canal = 0;
    strncpy(m.api_url, url.c_str(),  sizeof(m.api_url)- 1);
    strncpy(m.dev_key, key.c_str(),  sizeof(m.dev_key)- 1);

    static const uint8_t BC[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
    esp_now_peer_info_t p = {}; p.channel = 0; p.ifidx = WIFI_IF_STA; p.encrypt = false;
    memcpy(p.peer_addr, MAC_CAMERA, 6); if (!esp_now_is_peer_exist(MAC_CAMERA)) esp_now_add_peer(&p);
    memcpy(p.peer_addr, BC, 6);         if (!esp_now_is_peer_exist(BC))         esp_now_add_peer(&p);

    // Varre 1-13 mandando 3x por canal (broadcast + unicast) pra garantir alcançar
    // a câmera em qualquer canal (config no 1 ou já conectada).
    esp_wifi_set_promiscuous(true);
    for (uint8_t c = 1; c <= 13; c++) {
        esp_wifi_set_channel(c, WIFI_SECOND_CHAN_NONE);
        for (int k = 0; k < 3; k++) {
            esp_now_send((uint8_t*)MAC_CAMERA, (uint8_t*)&m, sizeof(m));
            esp_now_send((uint8_t*)BC,         (uint8_t*)&m, sizeof(m));
            delay(6);
        }
    }
    esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    g_canal_atual = 1;
    g_cam_last_ms = 0;   // força o hunt (a câmera vai reconectar e anunciar o canal novo)
    Serial.printf("[CFG] enviado p/ camera: ssid=%s url=%s\n", ssid.c_str(), url.c_str());
}
// -----------------------------------------------------------------------
// Estado interno
// -----------------------------------------------------------------------
static bool     _wifi_conectado      = false;
static bool     _wifi_canal_enviado  = false;
static uint32_t _wifi_t_ultimo_try   = 0;
static uint32_t _wifi_t_conectou     = 0;
static bool     _wifi_canal_confiavel = false;  // só true após conectar de verdade
static bool     _wifi_canal_conhecido = false;  // já descobrimos o canal do AP (via scan)?
static bool     _wifi_ws_sincronizado = false;  // waveshares já no canal do rádio?
static uint8_t  _wifi_canal_radio     = ESPNOW_CANAL;  // canal onde display+waveshares conversam (I/O)
static uint8_t  _wifi_falhas          = 0;      // tentativas seguidas sem conectar
static bool     _wifi_pausar_auto     = false;  // pausa o auto-connect (tela de config aberta)

// A tela de config chama isto: pausa o auto-connect e libera o rádio p/ o scan da UI.
void wifi_pausar_auto(bool pausar) {
    _wifi_pausar_auto = pausar;
    if (pausar) WiFi.disconnect(false, false);   // solta o rádio p/ scanNetworks funcionar
}

// Handler de eventos do WiFi — imprime o motivo (reason) da desconexão p/ diagnóstico
static void _wifi_on_event(arduino_event_id_t ev, arduino_event_info_t info) {
    switch (ev) {
        case ARDUINO_EVENT_WIFI_STA_CONNECTED:
            Serial.println("[WIFI] associado ao AP (aguardando IP)"); break;
        case ARDUINO_EVENT_WIFI_STA_GOT_IP:
            Serial.println("[WIFI] GOT_IP"); break;
        case ARDUINO_EVENT_WIFI_STA_DISCONNECTED:
            Serial.printf("[WIFI] desconectado reason=%d\n",
                          info.wifi_sta_disconnected.reason); break;
        default: break;
    }
}
#define WIFI_RETRY_MS            10000  // tenta reconectar a cada 10s
#define WIFI_CANAL_BCAST_DELAY_MS 2000  // aguarda 2s após conectar antes de enviar MSG_CANAL
#define WIFI_FALHAS_RESCAN       6      // após 6 falhas (~60s) força novo scan de canal

// -----------------------------------------------------------------------
// REGRA DE SEGURANÇA: a operação manual/automática NUNCA pode ficar
// inacessível. O Wi-Fi (scan/troca de canal do rádio) só pode mexer no
// rádio quando a máquina está OCIOSA — nunca durante um movimento/ciclo,
// senão o comando ESP-NOW p/ as waveshares se perde e o manual "não responde".
// -----------------------------------------------------------------------
static bool _maquina_ocupada() {
    return (g_vfd_mov != 0)              // inversor girando (qualquer movimento)
        || (g_estado_auto != AUTO_IDLE)  // ciclo automático em andamento
        || home_rodando()                // HOME em execução
        || recuperacao_ativa();          // recuperação em execução
}
// -----------------------------------------------------------------------
// Responde ao pedido de credenciais da câmera (MSG_WIFI_REQ)
// -----------------------------------------------------------------------
static void _wifi_responder_camera(const uint8_t* mac_origem) {
    String ssid = nvs_get_wifi_ssid();
    String pass = nvs_get_wifi_pass();
    if (ssid.length() == 0) {
        Serial.println("[WIFI] MSG_WIFI_REQ recebido mas sem credenciais para enviar");
        return;
    }
    MsgWifiCfg m;
    m.cab.tipo       = MSG_WIFI_CFG;
    m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem     = ORIGEM_DISPLAY;
    m.cab.seq        = 0;
    strncpy(m.ssid, ssid.c_str(), sizeof(m.ssid) - 1);
    m.ssid[sizeof(m.ssid)-1] = '\0';
    strncpy(m.pass, pass.c_str(), sizeof(m.pass) - 1);
    m.pass[sizeof(m.pass)-1] = '\0';
    m.canal = nvs_get_wifi_canal();
    // Preenche URL do backend e device key para a camera
    strncpy(m.api_url, nvs_get_api_base().c_str(), sizeof(m.api_url) - 1);
    m.api_url[sizeof(m.api_url)-1] = '\0';
    strncpy(m.dev_key, nvs_get_device_key().c_str(), sizeof(m.dev_key) - 1);  // sem hardcode
    m.dev_key[sizeof(m.dev_key)-1] = '\0';
    // Adiciona peer da câmera temporariamente se não existir (canal 0 = segue o rádio)
    esp_now_peer_info_t p = {};
    p.channel = 0;
    p.ifidx   = WIFI_IF_STA;
    p.encrypt = false;
    memcpy(p.peer_addr, mac_origem, 6);
    if (!esp_now_is_peer_exist(mac_origem)) esp_now_add_peer(&p);
    esp_now_send((uint8_t*)mac_origem, (uint8_t*)&m, sizeof(m));
    Serial.printf("[WIFI] credenciais enviadas para camera (ssid=%s canal=%d)\n",
                  m.ssid, m.canal);
}
// -----------------------------------------------------------------------
// Handler para mensagens ESP-NOW recebidas da câmera
// Chamar dentro do callback espnow_on_recv() já existente em comm_espnow.h
// -----------------------------------------------------------------------
bool wifi_espnow_handle(const uint8_t* mac, const uint8_t* data, int len) {
    if (len < (int)sizeof(CabEspNow)) return false;
    const CabEspNow* cab = (const CabEspNow*)data;
    if (cab->tipo != MSG_WIFI_REQ) return false;
    if (cab->id_maquina != ID_MAQUINA) return false;
    _wifi_responder_camera(mac);
    return true;   // mensagem consumida
}
// -----------------------------------------------------------------------
// Envia MSG_CANAL para as duas Waveshares em broadcast (todos os canais)
// -----------------------------------------------------------------------
static void _wifi_enviar_msg_canal(uint8_t canal, bool varrer) {
    MsgCanal m;
    m.cab.tipo       = MSG_CANAL;
    m.cab.id_maquina = ID_MAQUINA;
    m.cab.origem     = ORIGEM_DISPLAY;
    m.cab.seq        = 0;
    m.canal          = canal;
    static const uint8_t MAC_BC[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
    esp_now_peer_info_t p = {};
    p.channel = 0;                 // 0 = usa o canal atual do rádio
    p.ifidx   = WIFI_IF_STA;
    p.encrypt = false;
    memcpy(p.peer_addr, MAC_BC, 6);
    if (!esp_now_is_peer_exist(MAC_BC)) esp_now_add_peer(&p);
    if (varrer) {
        // 1ª convergência: as waveshares ainda estão noutro canal — varre o rádio
        // 1-13 pra alcançá-las. Só acontece com a máquina OCIOSA (gate no tick).
        for (uint8_t c = 1; c <= 13; c++) {
            esp_wifi_set_channel(c, WIFI_SECOND_CHAN_NONE);
            esp_now_send((uint8_t*)MAC_BC, (uint8_t*)&m, sizeof(m));  // 2x por canal:
            delay(6);
            esp_now_send((uint8_t*)MAC_BC, (uint8_t*)&m, sizeof(m));  // broadcast s/ ACK
            delay(6);
        }
        Serial.printf("[WIFI] MSG_CANAL=%d (varrendo 1-13)\n", canal);
    } else {
        // Já sincronizado: waveshares estão no mesmo canal — manda barato (sem hop).
        for (uint8_t k = 0; k < 3; k++) { esp_now_send((uint8_t*)MAC_BC, (uint8_t*)&m, sizeof(m)); delay(3); }
    }
    // Deixa SEMPRE o rádio no canal alvo (onde as waveshares vão ficar) → I/O ok.
    esp_wifi_set_channel(canal, WIFI_SECOND_CHAN_NONE);
    _wifi_canal_radio = canal;
}
// -----------------------------------------------------------------------
// Reconfigura o canal do ESP-NOW após conectar no Wi-Fi
// -----------------------------------------------------------------------
static void _wifi_sync_canal() {
    // Chamado APÓS conectar: só registra o canal real. NÃO varre canais aqui
    // (varrer com o WiFi conectado derrubaria a conexão). A sincronização das
    // waveshares é feita ANTES de conectar, em _wifi_sync_e_conectar().
    uint8_t canal_novo = (uint8_t)WiFi.channel();
    if (canal_novo >= 1 && canal_novo <= 13) {
        nvs_set_wifi_canal(canal_novo);
        _wifi_canal_radio     = canal_novo;
        _wifi_canal_confiavel = true;   // conectou de verdade: canal salvo é confiável
    }
    Serial.printf("[WIFI] conectado no canal %d (salvo)\n", canal_novo);
    _wifi_canal_enviado = true;
}
// Descobre o canal do AP por SCAN, avisa as waveshares (MSG_CANAL) e alinha o rádio
// ANTES de conectar. Resolve o conflito ESP-NOW x WiFi (rádio único do ESP32).
// permitir_scan=true faz o scan bloqueante (~2s) SÓ quando o canal ainda não é
// confiável. Deve ser chamada APENAS com a máquina ociosa (gate no chamador).
static void _wifi_sync_e_conectar(const String& ssid, const String& pass, bool permitir_scan) {
    uint8_t ch = 0;
    if (_wifi_canal_conhecido) {
        ch = _wifi_canal_radio;             // canal do AP já descoberto — SEM novo scan
    } else if (permitir_scan) {
        int n = WiFi.scanNetworks(false, false, false, 150);  // ~2s (só até achar o canal 1x)
        for (int i = 0; i < n; i++) if (WiFi.SSID(i) == ssid) { ch = (uint8_t)WiFi.channel(i); break; }
        WiFi.scanDelete();
        _wifi_ws_sincronizado = false;      // canal (re)descoberto: reconverge waveshares
    }
    if (ch >= 1 && ch <= 13) {
        _wifi_enviar_msg_canal(ch, !_wifi_ws_sincronizado);  // move waveshares; deixa rádio em ch
        nvs_set_wifi_canal(ch);
        _wifi_ws_sincronizado = true;
        _wifi_canal_conhecido = true;       // lembra o canal p/ NÃO re-scanear (scan aborta a conexão)
        Serial.printf("[WIFI] '%s' canal %d — begin\n", ssid.c_str(), ch);
    } else {
        // Não sabemos o canal ainda: mantém o rádio no canal do ESP-NOW (I/O vivo)
        // e tenta conectar assim mesmo (WiFi.begin varre internamente).
        esp_wifi_set_channel(_wifi_canal_radio, WIFI_SECOND_CHAN_NONE);
        Serial.printf("[WIFI] '%s' canal desconhecido — begin no canal %d\n", ssid.c_str(), _wifi_canal_radio);
    }
    WiFi.disconnect(false, false);          // limpa estado "connecting" p/ um begin limpo
    WiFi.begin(ssid.c_str(), pass.c_str());
    _wifi_t_ultimo_try = millis();
}
// -----------------------------------------------------------------------
// Inicialização — chamar no setup() APÓS comm_espnow_init()
// -----------------------------------------------------------------------
void wifi_init() {
    // === Opção A: o DISPLAY NÃO conecta no Wi-Fi ===
    // O display não tem RAM p/ TLS; quem fala com a nuvem é a CÂMERA (gateway).
    // Aqui só adicionamos o peer da câmera pra trocar heartbeat por ESP-NOW
    // (canal 0 = segue o rádio; o canal é sincronizado pela câmera via MSG_CANAL).
    esp_now_peer_info_t p = {};
    p.channel = 0;
    p.ifidx   = WIFI_IF_STA;
    p.encrypt = false;
    memcpy(p.peer_addr, MAC_CAMERA, 6);
    if (!esp_now_is_peer_exist(MAC_CAMERA)) esp_now_add_peer(&p);
    Serial.println("[WIFI] Opcao A: display SEM Wi-Fi (camera e o gateway). Peer camera ok.");
}
// -----------------------------------------------------------------------
// Tick — chamar no loop() a cada ciclo
// -----------------------------------------------------------------------
void wifi_tick() {
    return;   // === Opção A: display não usa Wi-Fi (a câmera é o gateway) ===
    bool agora_conectado = (WiFi.status() == WL_CONNECTED);
    if (agora_conectado && !_wifi_conectado) {
        _wifi_conectado     = true;
        _wifi_canal_enviado = false;
        _wifi_t_conectou    = millis();
        _wifi_falhas        = 0;
        Serial.printf("[WIFI] conectado! IP: %s\n",
                      WiFi.localIP().toString().c_str());
    }
    if (!agora_conectado && _wifi_conectado) {
        _wifi_conectado     = false;
        _wifi_canal_enviado = false;
        Serial.println("[WIFI] conexao perdida");
    }
    // Envia MSG_CANAL 2s após conectar
    if (_wifi_conectado && !_wifi_canal_enviado &&
        millis() - _wifi_t_conectou >= WIFI_CANAL_BCAST_DELAY_MS) {
        _wifi_sync_canal();
    }
    // Tenta (re)conectar — SOMENTE com a máquina OCIOSA. Enquanto houver
    // movimento/ciclo, o Wi-Fi espera: a operação manual/auto tem prioridade
    // absoluta e o rádio não pode ser desviado do canal do ESP-NOW.
    if (!agora_conectado && !_wifi_pausar_auto &&
        millis() - _wifi_t_ultimo_try >= WIFI_RETRY_MS) {
        if (false /* TESTE: ignora _maquina_ocupada() — display de teste sem waveshares */) {
            _wifi_t_ultimo_try = millis();   // adia: reavalia no próximo intervalo
        } else {
            String ssid = nvs_get_wifi_ssid();
            String pass = nvs_get_wifi_pass();
            if (ssid.length() > 0) {
                _wifi_falhas++;
                if (_wifi_falhas >= WIFI_FALHAS_RESCAN) {   // canal salvo pode ter mudado
                    _wifi_canal_confiavel = false;          // força novo scan
                    _wifi_falhas = 0;
                }
                Serial.println("[WIFI] tentando conectar (maquina ociosa)...");
                _wifi_sync_e_conectar(ssid, pass, true);
            } else {
                _wifi_t_ultimo_try = millis();
            }
        }
    }
}
// -----------------------------------------------------------------------
// Consultas
// -----------------------------------------------------------------------
bool    wifi_conectado()  { return _wifi_conectado; }
int32_t wifi_rssi()       { return _wifi_conectado ? WiFi.RSSI() : -100; }
uint8_t wifi_canal()      { return (uint8_t)WiFi.channel(); }
void wifi_configurar(const String& ssid, const String& pass) {
    nvs_set_wifi_ssid(ssid);
    nvs_set_wifi_pass(pass);
    _wifi_conectado       = false;
    _wifi_canal_enviado   = false;
    _wifi_canal_confiavel = false;   // rede nova: canal desconhecido → scan
    _wifi_canal_conhecido = false;   // redescobre o canal do AP no scan
    _wifi_ws_sincronizado = false;   // reconverge as waveshares
    _wifi_falhas          = 0;
    WiFi.disconnect();
    Serial.printf("[WIFI] nova rede configurada: %s\n", ssid.c_str());
    // Tela de config = máquina ociosa: pode alinhar canal e conectar agora.
    _wifi_sync_e_conectar(ssid, pass, true);   // scan-first: alinha canal e conecta
}
