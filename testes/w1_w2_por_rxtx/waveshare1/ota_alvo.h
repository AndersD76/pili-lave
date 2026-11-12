#pragma once
// =======================================================================
// ota_alvo.h — LADO QUE RECEBE a atualizacao remota (display e W1). IDENTICO nas duas pastas.
// O sketch define ANTES de incluir:  OTA_MEU_ALVO (OTA_ALVO_DISPLAY/W1), OTA_MEU_ORIGEM, OTA_FW_VERSAO (inteiro; SOBE a cada firmware publicado),
//   static bool ota_pode_agora();                      -> true so com a maquina parada (nada em movimento, sem ciclo)
//   static void ota_tx_ack(const MsgOtaAck* a);        -> manda o ACK (display: direto a camera; W1: ao display, que repassa)
// e chama ota_on_recv() no callback do ESP-NOW (so copia o pacote), ota_tick() e ota_validar_tick() em CADA volta do loop().
//
// SEGURANCA: (1) so inicia com a maquina parada e ABORTA se ela sair do repouso; (2) o firmware so e trocado depois de gravar TUDO e o MD5 conferir;
// (3) rollback: o bootloader desta placa tem o rollback ligado (CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE). A imagem nova nasce "pendente"; se a placa
// reiniciar (travou, panico, falta de energia) ANTES de ota_validar_tick() confirma-la (60 s de uptime), o bootloader volta SOZINHO ao firmware anterior.
// =======================================================================
#include <Update.h>
#include <esp_ota_ops.h>
#include "ota_msg.h"

extern "C" bool verifyRollbackLater() { return true; }   // o core NAO confirma sozinho no boot: a confirmacao e ota_validar_tick()

#define OTA_SESSAO_TIMEOUT_MS 90000UL
enum : uint8_t { OTA_OCIOSO = 0, OTA_RECEBENDO = 1 };
static volatile bool g_ota_rx_novo = false;
static uint8_t       g_ota_rx[sizeof(MsgOtaDados)];
static volatile int  g_ota_rx_len = 0;
static uint8_t  g_ota_est = OTA_OCIOSO;
static uint32_t g_ota_tam = 0, g_ota_prox = 0, g_ota_ult_ms = 0, g_ota_reiniciar_ms = 0;
static char     g_ota_md5[33] = "";
static bool     g_ota_reiniciar = false;

bool ota_ativa() { return g_ota_est == OTA_RECEBENDO; }

// Callback do ESP-NOW: so copia (1 pacote por vez; o remetente espera o ACK e reenvia se este for descartado).
static void ota_on_recv(const uint8_t* data, int len) {
    if (g_ota_rx_novo || len < (int)sizeof(CabEspNow) + 1) return;
    if (len > (int)sizeof(g_ota_rx)) len = (int)sizeof(g_ota_rx);
    memcpy(g_ota_rx, data, len);
    g_ota_rx_len = len;
    g_ota_rx_novo = true;
}

static void ota_ack(uint8_t status, uint8_t erro) {
    MsgOtaAck a = {};
    a.cab.tipo = MSG_OTA_ACK; a.cab.id_maquina = ID_MAQUINA; a.cab.origem = OTA_MEU_ORIGEM; a.cab.seq = 0;
    a.alvo = OTA_MEU_ALVO; a.status = status; a.prox = g_ota_prox; a.erro = erro; a.versao_atual = (uint16_t)OTA_FW_VERSAO;
    ota_tx_ack(&a);
}
static void ota_abortar(const char* motivo) {
    if (g_ota_est != OTA_RECEBENDO) return;
    Update.abort(); g_ota_est = OTA_OCIOSO;
    Serial.printf("[OTA] sessao abortada: %s (recebidos %lu de %lu bytes)\n", motivo, (unsigned long)g_ota_prox, (unsigned long)g_ota_tam);
}

static void ota_tick() {
    uint32_t agora = millis();
    if (g_ota_reiniciar && (int32_t)(agora - g_ota_reiniciar_ms) >= 0) { Serial.println("[OTA] reiniciando no firmware novo"); Serial.flush(); delay(50); esp_restart(); }
    if (g_ota_est == OTA_RECEBENDO) {
        if ((int32_t)(agora - g_ota_ult_ms) >= (int32_t)OTA_SESSAO_TIMEOUT_MS) ota_abortar("sem pacotes por 90 s");
        else if (!ota_pode_agora()) ota_abortar("a maquina saiu do repouso");
    }
    if (!g_ota_rx_novo) return;
    uint8_t b[sizeof(MsgOtaDados)]; int n = g_ota_rx_len; if (n > (int)sizeof(b)) n = (int)sizeof(b);
    memcpy(b, g_ota_rx, n); g_ota_rx_novo = false;
    const CabEspNow* c = (const CabEspNow*)b;
    if (b[sizeof(CabEspNow)] != OTA_MEU_ALVO) return;

    if (c->tipo == MSG_OTA_INICIO && n >= (int)sizeof(MsgOtaInicio)) {
        const MsgOtaInicio* m = (const MsgOtaInicio*)b;
        if (g_ota_est == OTA_RECEBENDO && m->tamanho == g_ota_tam && strncmp(m->md5, g_ota_md5, 32) == 0) { g_ota_ult_ms = agora; ota_ack(OTA_ST_OK, 0); return; }   // INICIO repetido
        if (g_ota_est == OTA_RECEBENDO) ota_abortar("novo inicio");
        if ((int)m->versao <= (int)OTA_FW_VERSAO) { ota_ack(OTA_ST_JA_ATUALIZADO, 0); return; }
        if (!ota_pode_agora()) { ota_ack(OTA_ST_OCUPADO, 0); return; }
        if (m->tamanho < 100000UL || m->tamanho > 3UL * 1024UL * 1024UL) { ota_ack(OTA_ST_ERRO, 6); return; }
        char md5[33]; memcpy(md5, m->md5, 32); md5[32] = 0;
        if (!Update.begin(m->tamanho)) { Serial.printf("[OTA] Update.begin falhou: %s\n", Update.errorString()); ota_ack(OTA_ST_ERRO, 1); return; }
        if (!Update.setMD5(md5)) { Update.abort(); ota_ack(OTA_ST_ERRO, 3); return; }
        strncpy(g_ota_md5, md5, sizeof(g_ota_md5) - 1); g_ota_md5[32] = 0;
        g_ota_tam = m->tamanho; g_ota_prox = 0; g_ota_ult_ms = agora; g_ota_est = OTA_RECEBENDO;
        Serial.printf("[OTA] recebendo versao %u (%lu bytes)\n", (unsigned)m->versao, (unsigned long)g_ota_tam);
        ota_ack(OTA_ST_OK, 0);
    } else if (c->tipo == MSG_OTA_DADOS && n >= (int)offsetof(MsgOtaDados, dados)) {
        const MsgOtaDados* m = (const MsgOtaDados*)b;
        if (g_ota_est != OTA_RECEBENDO) { ota_ack(OTA_ST_ERRO, 5); return; }
        g_ota_ult_ms = agora;
        if (m->offset < g_ota_prox) { ota_ack(OTA_ST_OK, 0); return; }                                    // pedaco repetido: so confirma de novo
        if (m->offset != g_ota_prox || m->n == 0 || m->n > OTA_DADOS_MAX || n < (int)offsetof(MsgOtaDados, dados) + (int)m->n || g_ota_prox + m->n > g_ota_tam) {
            ota_abortar("pedaco fora de ordem"); ota_ack(OTA_ST_ERRO, 4); return;
        }
        if (Update.write((uint8_t*)m->dados, m->n) != m->n) { Serial.printf("[OTA] gravacao falhou: %s\n", Update.errorString()); ota_abortar("falha ao gravar"); ota_ack(OTA_ST_ERRO, 2); return; }
        g_ota_prox += m->n;
        ota_ack(OTA_ST_OK, 0);
    } else if (c->tipo == MSG_OTA_FIM) {
        if (g_ota_est != OTA_RECEBENDO || g_ota_prox != g_ota_tam) { ota_abortar("fim com o arquivo incompleto"); ota_ack(OTA_ST_ERRO, 4); return; }
        bool ok = Update.end(true);   // confere o MD5 e so entao marca a particao nova como a de boot
        g_ota_est = OTA_OCIOSO;
        if (!ok) { Serial.printf("[OTA] Update.end falhou: %s\n", Update.errorString()); ota_ack(OTA_ST_ERRO, 3); return; }
        Serial.println("[OTA] gravado e conferido (MD5 ok): reinicia em 1,5 s");
        ota_ack(OTA_ST_CONCLUIDO, 0);
        g_ota_reiniciar = true; g_ota_reiniciar_ms = agora + 1500UL;
    }
}

// Confirma o firmware como bom depois de 60 s de uptime. Antes disso, qualquer reinicio faz o bootloader VOLTAR ao firmware anterior.
static void ota_validar_tick() {
    static bool feito = false;
    if (feito || millis() < 60000UL) return;
    feito = true;
    esp_err_t r = esp_ota_mark_app_valid_cancel_rollback();
    Serial.printf("[OTA] firmware v%d confirmado como bom (rollback cancelado, r=%d)\n", (int)OTA_FW_VERSAO, (int)r);
}
