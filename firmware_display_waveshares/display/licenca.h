#pragma once
#include <Arduino.h>
#include "nvs_manager.h"
#include "backend_client.h"
#include "lampada_app.h"
// =======================================================================
// licenca.h — Duas travas independentes de licença
//
// Trava 1 — Pagamento:
//   - 40-49 dias: aviso no display (máquina funciona)
//   - 50+ dias ou blocked=true: tela bloqueante
//
// Trava 2 — Comunicação:
//   - 15 dias sem heartbeat 200 OK: tela bloqueante
//   - Só começa a contar após o PRIMEIRO heartbeat OK (lastOk em NVS)
//   - Hotspot do celular reinicia o contador
//
// Qualquer trava bloqueia auto_iniciar e o controle remoto.
// O heartbeat continua rodando mesmo bloqueado (para desbloquear sozinho).
// =======================================================================
#define LIC_AVISO_DIAS      40    // dias para começar a avisar
#define LIC_BLOQUEIO_DIAS   50    // dias para bloquear
#define LIC_COMM_DIAS       15    // dias sem comunicação para bloquear
#define SECS_POR_DIA     86400UL
static bool     _lic_bloqueada       = false;
static bool     _lic_aviso_ativo     = false;
static uint16_t _lic_dias_sem_pag    = 0;
static uint32_t _lic_dias_sem_comm   = 0;
// Referência de tempo Unix aproximado (segundos desde boot + offset)
// O ESP32 não tem RTC real — usamos millis()/1000 como delta desde o boot.
// O lastOk é salvo como timestamp Unix aproximado pelo backend_client.
static uint32_t _lic_now_unix() {
    // Retorna segundos desde que o último heartbeat OK foi recebido
    // mais o tempo decorrido desde então
    uint32_t last_ok_unix = nvs_get_last_hb_ok();
    if (last_ok_unix == 0) return 0;
    uint32_t delta_ms  = millis() - backend_last_ok_ms();
    return last_ok_unix + (delta_ms / 1000);
}
// -----------------------------------------------------------------------
// Verifica as duas travas e atualiza estado
// -----------------------------------------------------------------------
void licenca_tick() {
    bool bloqueada_antes = _lic_bloqueada;
    // --- Trava 1: pagamento ---
    _lic_dias_sem_pag = nvs_get_lic_days();
    bool blocked      = nvs_get_lic_blocked();
    bool trava1 = blocked || (_lic_dias_sem_pag >= LIC_BLOQUEIO_DIAS);
    _lic_aviso_ativo = (!trava1) && (_lic_dias_sem_pag >= LIC_AVISO_DIAS);
    // --- Trava 2: comunicação ---
    bool trava2 = false;
    if (nvs_has_last_hb_ok()) {
        uint32_t last_ok_unix = nvs_get_last_hb_ok();
        uint32_t now_unix     = _lic_now_unix();
        if (now_unix > last_ok_unix) {
            _lic_dias_sem_comm = (now_unix - last_ok_unix) / SECS_POR_DIA;
            trava2 = (_lic_dias_sem_comm >= LIC_COMM_DIAS);
        }
    }
    _lic_bloqueada = trava1 || trava2;
    // Ao bloquear: apaga lâmpadas
    if (_lic_bloqueada && !bloqueada_antes) {
        lampada_app_off();
        Serial.printf("[LIC] BLOQUEADA t1=%d t2=%d dias_pag=%d dias_comm=%lu\n",
                      (int)trava1, (int)trava2,
                      _lic_dias_sem_pag, _lic_dias_sem_comm);
    }
    // Ao desbloquear
    if (!_lic_bloqueada && bloqueada_antes) {
        Serial.println("[LIC] desbloqueada");
    }
}
// -----------------------------------------------------------------------
// Consultas usadas por maquina_estados e display.ino
// -----------------------------------------------------------------------
bool licenca_bloqueada()   { return _lic_bloqueada; }
bool licenca_aviso()       { return _lic_aviso_ativo; }
uint16_t licenca_dias_pag(){ return _lic_dias_sem_pag; }
uint32_t licenca_dias_comm(){ return _lic_dias_sem_comm; }
