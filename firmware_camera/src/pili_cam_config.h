#pragma once
// ============================================================
// pili_cam_config.h — parâmetros da câmera (arquitetura simplificada / Opção A)
//   A câmera é o GATEWAY: conecta no Wi-Fi com credenciais recebidas do
//   display (NVS), é a MESTRE DE CANAL, faz todo o HTTPS (heartbeat + LPR)
//   e manda foto pra nuvem em intervalo fixo, sem detectar nada sozinha
//   (sem sensor, sem análise de imagem — a nuvem decide). O display fica
//   só ESP-NOW.
// ============================================================

// ── Placa (mapa de pinos) — escolha UMA ─────────────────────
#define CAMERA_MODEL_AI_THINKER
// #define CAMERA_MODEL_XIAO_ESP32S3

// ── ESP-NOW — DEVE bater com o display (tipos.h da máquina) ──
#define ID_MAQUINA     1        // mesmo ID do display
#define ESPNOW_CANAL   1        // canal inicial (a câmera sincroniza tudo depois)
#define ORIGEM_CAMERA  3        // origem da câmera no header ESP-NOW

// ── Credenciais ─────────────────────────────────────────────
//   NÃO ficam aqui: a máquina sai SEM rede. SSID/senha/URL/device-key vêm do
//   DISPLAY por ESP-NOW (MSG_WIFI_CFG) e ficam salvos no NVS da câmera.
//   Os PADRÕES editáveis (URL/device-key pré-preenchidos) ficam na tela do display.

// ── Cadastro de máquina (Nova/Substituição) ──────────────────
//   Senha de FÁBRICA — a MESMA em todo firmware que vocês gravam (não é por
//   instalação). Autoriza o POST /api/machine/provisionar; sem ela, qualquer
//   um com uma câmera destas poderia plantar máquina falsa no seu sistema.
//   Deixe vazio só em bancada de teste — igual PROVISION_SECRET vazio no
//   servidor.
#define PILI_PROVISION_SECRET ""

// ── LPR ─────────────────────────────────────────────────────
//   Sempre ativo, sem detecção: a câmera manda 1 foto pro backend
//   (/api/lpr/frame) a cada PILI_ENVIO_INTERVALO_MS, o tempo todo (tenha
//   carro ou não). O LPR (leitura da placa, decidir se tem carro) roda
//   na nuvem, não aqui.
#define PILI_LPR_PATH        "/api/lpr/frame"
#define PILI_HB_PATH         "/api/machine/heartbeat"
#define PILI_JPEG_QUALITY    12
#define PILI_HTTP_TIMEOUT    15000  // ms
#define PILI_HB_INTERVALO_MS 10000  // heartbeat a cada 10s
#define PILI_CANAL_ANUNCIO_MS 1000  // anuncia MSG_CANAL no canal atual a cada 1s
                                    // (frequente: um display em varredura precisa captar)

// ── Envio periódico de fotos ──────────────────────────────────
//   3s dava exaustão de recursos TLS (WiFiClientSecure sem keep-alive
//   competindo com o anúncio ESP-NOW de canal a cada 1s no mesmo rádio) ->
//   falhas crescentes e frames perdidos. 8s dá fôlego pro handshake.
#define PILI_ENVIO_INTERVALO_MS 8000

// ── LPR: não-bloqueante, mas SEM cortar o timeout ─────────────
//   Tentativa de otimização que deu errado (03/09): tinha posto esse timeout
//   em 6000ms achando que "liberava o rádio mais rápido" — só que o handshake
//   TLS com o Railway pra ~50KB de imagem às vezes passa legitimamente de 6s
//   (mas quase sempre fica dentro de 15s). Resultado: matava handshakes que
//   iam funcionar, e o LPR passou a falhar quase sempre (heartbeat, que ficou
//   com 15s, continuava funcionando de vez em quando — foi essa diferença que
//   entregou o bug). Voltou a bater com PILI_HTTP_TIMEOUT porque a máquina de
//   estados em enviarFotoPeriodica() (uma tentativa por passagem de loop())
//   já resolve o problema de travar o rádio por várias tentativas empilhadas
//   — não precisa mais cortar o timeout de UMA tentativa pra isso.
#define PILI_LPR_HTTP_TIMEOUT   PILI_HTTP_TIMEOUT  // 15000ms, igual ao heartbeat
#define PILI_LPR_RETRY_DELAY_MS  800  // ms, multiplicado pelo nº da tentativa
