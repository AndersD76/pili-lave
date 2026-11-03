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
void boot_prov_espnow_handle(const uint8_t* data, int len);   // definida em tela_boot.h (incluído depois)
void boot_ident_espnow_handle(const uint8_t* data, int len);
void boot_uni_espnow_handle(const uint8_t* data, int len);
void boot_idpush_espnow_handle(const uint8_t* data, int len);

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
    if (cab->tipo == MSG_PROV_RESP) {
        g_cam_last_ms = millis(); boot_prov_espnow_handle(data, len); return;
    }
    if (cab->tipo == MSG_IDENT_RESP) {
        g_cam_last_ms = millis(); boot_ident_espnow_handle(data, len); return;
    }
    if (cab->tipo == MSG_UNI_RESP) {
        g_cam_last_ms = millis(); boot_uni_espnow_handle(data, len); return;
    }
    if (cab->tipo == MSG_IDPUSH_RESP) {
        g_cam_last_ms = millis(); boot_idpush_espnow_handle(data, len); return;
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

// -----------------------------------------------------------------------
// "Modo caça" — varre os 13 canais ativamente procurando a câmera e trava
// no que responder. Regra combinada: cada canal escolhido (Wi-Fi novo,
// reconfiguração, etc.) é pra ficar TRAVADO ali pros dois lados; só quando
// o botão Buscar é apertado e a câmera está sem contato recente é que faz
// sentido varrer de novo — nunca em background/sozinho, senão qualquer
// ruído passageiro derrubaria o par de um canal que ainda está bom.
// -----------------------------------------------------------------------
#define CAM_SEM_CONTATO_MS 3000UL   // sem ouvir a câmera há mais que isso = "perdida" p/ efeito de caça
bool espnow_camera_perdida() { return (millis() - g_cam_last_ms) > CAM_SEM_CONTATO_MS; }

// Varre canal a canal, ouvindo por um pouco em cada um; para e trava assim
// que a câmera responder (MSG_CANAL/HB/SCAN/etc. — qualquer um atualiza
// g_cam_last_ms no callback já existente). Retorna true se achou.
// A câmera anuncia MSG_CANAL a cada 1s (PILI_CANAL_ANUNCIO_MS) — o tempo de
// espera por canal PRECISA ser maior que isso, senão a chance de bater o
// anúncio é baixa (achado em teste real: com 220ms, a caça terminava as 13
// voltas sem nunca pegar o anúncio, mesmo com a câmera viva e no ar).
// -----------------------------------------------------------------------
// Caça não-bloqueante: varre os 13 canais em background (chamado no
// loop(), sem travar LVGL/toque) e fica repetindo as voltas até achar a
// câmera OU alguém cancelar (ex.: apertou "Voltar"). Achado em teste real:
// a versão bloqueante antiga prendia a tela inteira — nem dava pra sair
// enquanto procurava, e uma volta só às vezes não bastava (o anúncio da
// câmera é a cada 1s, então o tempo por canal precisa ser maior que isso).
// -----------------------------------------------------------------------
#define CACA_MS_POR_CANAL 1300UL
static volatile bool    g_caca_ativa   = false;
static volatile bool    g_caca_achou   = false;
static uint8_t           g_caca_canal   = 1;
static int               g_caca_volta   = 1;
static uint32_t          g_caca_t0      = 0;
static uint32_t          g_caca_marca0  = 0;

static void _caca_ir_canal(uint8_t c) {
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(c, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    g_canal_atual = c;
}

void espnow_cacar_iniciar() {
    g_caca_marca0 = g_cam_last_ms;
    g_caca_volta  = 1;
    g_caca_canal  = 1;
    g_caca_achou  = false;
    g_caca_ativa  = true;
    g_caca_t0     = millis();
    _caca_ir_canal(g_caca_canal);
}
void espnow_cacar_cancelar() { g_caca_ativa = false; }
bool espnow_cacando()        { return g_caca_ativa; }
bool espnow_cacar_achou()    { return g_caca_achou; }
int  espnow_cacar_volta()    { return g_caca_volta; }

// Chamar sempre no loop() (barato: só compara millis() quando ativa).
void espnow_cacar_tick() {
    if (!g_caca_ativa) return;
    if (g_cam_last_ms != g_caca_marca0) {
        g_caca_achou = true;
        g_caca_ativa = false;   // achou — fica travado no canal atual
        return;
    }
    if (millis() - g_caca_t0 >= CACA_MS_POR_CANAL) {
        g_caca_canal++;
        if (g_caca_canal > 13) { g_caca_canal = 1; g_caca_volta++; }
        _caca_ir_canal(g_caca_canal);
        g_caca_t0 = millis();
    }
}

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

    // Canal 1 é só o ponto de partida (câmera nova / config de fábrica) —
    // NÃO uma regra de "sempre volta pra lá" quando perde contato. Ficar
    // parado no 1 esperando passivamente era pior que simplesmente continuar
    // travado onde já estava (o canal continua bom até algo mudar de verdade).
    // A recuperação de canal agora é ativa: técnico aperta Buscar e o
    // display varre os 13 canais de propósito (espnow_cacar_camera), em vez
    // de ficar estacionado esperando um anúncio que pode nunca chegar aqui.
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
