#pragma once
#include <Arduino.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include "tipos.h"

// =======================================================================
// comm_espnow.h — Display <-> CÂMERA por ESP-NOW. SÓ a câmera (Opção A:
// ela é o gateway de internet). As waveshares saíram do rádio e foram pro
// RS-485 (ver modbus_waveshares.h) — esse arquivo não fala mais com elas.
// =======================================================================

static uint8_t g_seq = 0;   // sequência dos pacotes ESP-NOW (câmera)

// -----------------------------------------------------------------------
// Callback de recepcao — só mensagens da câmera passam por aqui agora.
// -----------------------------------------------------------------------
void alarme_modbus(const char* msg);   // definida em modbus_waveshares.h (incluído depois)
bool wifi_espnow_handle(const uint8_t* mac, const uint8_t* data, int len);
bool backend_espnow_handle(const uint8_t* mac, const uint8_t* data, int len);
bool espnow_pode_varrer();
void wifi_scan_espnow_handle(const uint8_t* data, int len);

static volatile uint8_t  g_canal_novo   = 0;   // Opção A: canal pedido pela câmera (aplica no loop)
static volatile uint32_t g_cam_last_ms  = 0;   // última vez que ouvimos a câmera (p/ o alarme)
static uint8_t           g_canal_atual  = ESPNOW_CANAL;  // canal em que o rádio está agora

static void espnow_on_recv(const esp_now_recv_info_t* info, const uint8_t* data, int len) {
    if (info->src_addr[3] != ID_MAQUINA) return;        // isola maquinas vizinhas
    if (len < (int)sizeof(CabEspNow)) return;
    const CabEspNow* cab = (const CabEspNow*)data;
    if (cab->id_maquina != ID_MAQUINA) return;

    if (cab->tipo == MSG_WIFI_REQ) { wifi_espnow_handle(info->src_addr, data, len); return; }
    if (cab->tipo == MSG_HB_RESP || cab->tipo == MSG_EVT_ACK) {
        g_cam_last_ms = millis(); backend_espnow_handle(info->src_addr, data, len); return;
    }
    if (cab->tipo == MSG_SCAN_RESP) {
        g_cam_last_ms = millis(); wifi_scan_espnow_handle(data, len); return;
    }
    // Opção A: a CÂMERA é a mestre de canal (Wi-Fi dela, não tem relação com
    // o barramento RS-485 das waveshares). MSG_CANAL avisa o canal do
    // roteador -> o display SEGUE (troca o canal do rádio).
    if (cab->tipo == MSG_CANAL && len >= (int)sizeof(CabEspNow) + 1) {
        uint8_t canal = data[sizeof(CabEspNow)];
        Serial.printf("[ESP-NOW] MSG_CANAL recebido: canal=%d (atual=%d)\n", canal, g_canal_atual);
        if (canal >= 1 && canal <= 13) g_canal_novo = canal;
        g_cam_last_ms = millis();
        return;
    }
}

// -----------------------------------------------------------------------
// Alarme de câmera sem contato — bem mais simples que a rotina de resgate
// que existia pras waveshares (a câmera continua no rádio, então a lógica
// de "acompanha o canal / estaciona no canal 1 se sumir" continua fazendo
// sentido SÓ pra ela).
// -----------------------------------------------------------------------
#define CAM_ALARME_MS   60000UL
#define CAM_ISOLADA_MS 300000UL
static bool g_alarme_cam_ativo = false;

void comm_espnow_canal_tick() {
    if (g_canal_novo) {
        uint8_t ch = g_canal_novo; g_canal_novo = 0;
        if (ch != g_canal_atual) {
            esp_wifi_set_promiscuous(true);
            esp_wifi_set_channel(ch, WIFI_SECOND_CHAN_NONE);
            esp_wifi_set_promiscuous(false);
            g_canal_atual = ch;
            Serial.printf("[ESP-NOW] display travou no canal %d (camera)\n", ch);
        }
        return;
    }
    uint32_t desde_camera = millis() - g_cam_last_ms;

    // So escreve a mensagem se nao houver um erro REAL ja ativo (AUTO_ERRO) —
    // senao ficava reescrevendo "Camera sem contato" por cima da mensagem
    // verdadeira a cada volta do loop, mascarando a causa real de uma parada
    // (achado num teste real: a lavagem parou por outro motivo durante o
    // retorno do carrinho, e a tela só mostrou "Camera sem contato" porque
    // esse alarme, puramente informativo, ficou sobrescrevendo sem parar).
    if (desde_camera > CAM_ALARME_MS) {
        if (g_estado_auto != AUTO_ERRO) alarme_modbus("Camera sem contato");
        g_alarme_cam_ativo = true;
    } else if (g_alarme_cam_ativo) {
        g_alarme_cam_ativo = false;
        if (g_estado_auto != AUTO_ERRO) g_estado.alarme = false;
    }

    if (desde_camera > CAM_ISOLADA_MS && g_canal_atual != 1 && espnow_pode_varrer()) {
        g_canal_atual = 1;
        esp_wifi_set_promiscuous(true);
        esp_wifi_set_channel(1, WIFI_SECOND_CHAN_NONE);
        esp_wifi_set_promiscuous(false);
        Serial.println("[ESP-NOW] isolado da camera ha muito tempo -> estacionando no canal 1 (aguardando reencontro)");
    }
}

// -----------------------------------------------------------------------
// Inicializacao ESP-NOW (WiFi STA, MAC logico, canal fixo, PMK/LMK) — só
// peer da câmera; as waveshares não usam mais ESP-NOW.
// -----------------------------------------------------------------------
void comm_espnow_init() {
    WiFi.mode(WIFI_STA);
    WiFi.disconnect();
    esp_wifi_set_mac(WIFI_IF_STA, (uint8_t*)MAC_DISPLAY);
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(ESPNOW_CANAL, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    if (esp_now_init() != ESP_OK) { Serial.println("[ESP-NOW] init FALHOU"); return; }
    esp_now_set_pmk(ESPNOW_PMK);
    esp_now_register_recv_cb(espnow_on_recv);

    // Peer de broadcast SEM criptografia — a câmera manda MSG_CANAL pra
    // FF:FF:FF:FF:FF:FF; sem esse peer registrado o recv de broadcast pode
    // não disparar de forma confiável.
    static const uint8_t MAC_BCAST[6] = {0xFF,0xFF,0xFF,0xFF,0xFF,0xFF};
    esp_now_peer_info_t pb = {};
    pb.channel = 0; pb.ifidx = WIFI_IF_STA; pb.encrypt = false;
    memcpy(pb.peer_addr, MAC_BCAST, 6);
    if (!esp_now_is_peer_exist(MAC_BCAST)) esp_now_add_peer(&pb);

    Serial.println("[ESP-NOW] display pronto (so camera — waveshares em RS-485)");
}
