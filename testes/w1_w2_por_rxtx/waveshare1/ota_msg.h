#pragma once
// =======================================================================
// ota_msg.h — ATUALIZACAO REMOTA DE FIRMWARE do DISPLAY e da W1 (2026-11-09).
// IDENTICO em testes/display/, testes/w1_w2_por_rxtx/waveshare1/ e firmware_camera/src/ (manter iguais; o CabEspNow vem antes, de cada projeto).
//
// Quem manda e a CAMERA (ela tem Wi-Fi): baixa o .bin do servidor, confere o MD5 e entrega em pedacos de 200 bytes por ESP-NOW, UM por vez, esperando o
// MSG_OTA_ACK de cada um (parar-e-esperar; reenvia se o ACK nao vier). Tudo passa pelo DISPLAY: para a W1 o display e so um RELE (camera -> display ->
// W1 e de volta; o display reescreve a origem para ORIGEM_DISPLAY, que a W1 aceita). O 1o byte depois do cabecalho de TODA mensagem OTA e o 'alvo'.
//
// Quem recebe (display ou W1) grava na particao OTA reserva (Update), confere o MD5 no fim e so entao troca de firmware e reinicia. Se o firmware novo
// nao se mantiver de pe por 60 s, o bootloader volta SOZINHO ao anterior (rollback do ESP-IDF; ver ota_alvo.h).
// =======================================================================
#define OTA_ALVO_DISPLAY 1
#define OTA_ALVO_W1      2
#define OTA_DADOS_MAX    200

enum : uint8_t { MSG_OTA_INICIO = 50, MSG_OTA_DADOS = 51, MSG_OTA_FIM = 52, MSG_OTA_ACK = 53 };
// status do ACK
enum : uint8_t { OTA_ST_OK = 0,            // pronto / pedaco gravado (prox = proximo offset esperado)
                 OTA_ST_OCUPADO = 1,       // a maquina esta em uso (ciclo, teste, manual, HOME): tente mais tarde
                 OTA_ST_JA_ATUALIZADO = 2, // a versao oferecida nao e maior que a que esta rodando
                 OTA_ST_ERRO = 3,          // ver 'erro'
                 OTA_ST_CONCLUIDO = 4 };   // gravou, conferiu o MD5 e vai reiniciar em ~1,5 s
// codigos de erro: 1 sem espaco/Update.begin falhou, 2 falha ao gravar, 3 MD5 nao confere, 4 pedaco fora de ordem / incompleto, 5 sem sessao, 6 tamanho invalido
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t alvo; uint16_t versao; uint32_t tamanho; char md5[33]; } MsgOtaInicio;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t alvo; uint32_t offset; uint8_t n; uint8_t dados[OTA_DADOS_MAX]; } MsgOtaDados;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t alvo; } MsgOtaFim;
typedef struct __attribute__((packed)) { CabEspNow cab; uint8_t alvo; uint8_t status; uint32_t prox; uint8_t erro; uint16_t versao_atual; } MsgOtaAck;
static_assert(sizeof(MsgOtaDados) <= 250 && sizeof(MsgOtaInicio) <= 250 && sizeof(MsgOtaAck) <= 250, "mensagem OTA passou de 250 bytes");
