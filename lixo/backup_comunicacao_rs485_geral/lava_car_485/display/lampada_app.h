#pragma once
#include <Arduino.h>
#include "tipos.h"
#include "backend_client.h"
// =======================================================================
// lampada_app.h — Controla Y11/Y12 conforme lightState do backend
//
// PRIORIDADE (maior para menor):
//   1. Recuperação de boot (recuperacao_tick gerencia diretamente Y11/Y12)
//   2. Bloqueio de licença (licenca.h apaga as lâmpadas)
//   3. Estado do app (lightState do backend)
//   4. Processo de lavagem (maquina_estados usa Y11/Y12 normalmente)
//
// lampada_app_tick() só age quando não há processo ativo e não há
// recuperação em andamento. O processo de lavagem continua controlando
// Y11/Y12 diretamente como sempre fez.
// =======================================================================
static LampState _lamp_atual   = LAMP_OFF;
static uint32_t  _lamp_t_pisca = 0;
static bool      _lamp_pisca_on = false;
static uint32_t  _lamp_forca_off_ate = 0;   // millis() até quando ignorar a nuvem (força apagada)
// -----------------------------------------------------------------------
// Aplica o padrão de lâmpada — não-bloqueante (millis-based)
// -----------------------------------------------------------------------
static void _lamp_aplicar(LampState estado) {
    uint32_t agora = millis();
    switch (estado) {
        case LAMP_OFF:
            SET_Y11(false); SET_Y12(false);
            break;
        case LAMP_GREEN_SOLID:
            SET_Y11(true);  SET_Y12(false);
            break;
        case LAMP_RED_SOLID:
            SET_Y11(false); SET_Y12(true);
            break;
        case LAMP_GREEN_BLINK:
            if (agora - _lamp_t_pisca >= 500) {
                _lamp_t_pisca = agora;
                _lamp_pisca_on = !_lamp_pisca_on;
                SET_Y11(_lamp_pisca_on); SET_Y12(false);
            }
            break;
        case LAMP_RED_BLINK:
            if (agora - _lamp_t_pisca >= 500) {
                _lamp_t_pisca = agora;
                _lamp_pisca_on = !_lamp_pisca_on;
                SET_Y11(false); SET_Y12(_lamp_pisca_on);
            }
            break;
        case LAMP_RED_GREEN_ALT:
            if (agora - _lamp_t_pisca >= 500) {
                _lamp_t_pisca = agora;
                _lamp_pisca_on = !_lamp_pisca_on;
                SET_Y11(_lamp_pisca_on);
                SET_Y12(!_lamp_pisca_on);
            }
            break;
    }
}
// -----------------------------------------------------------------------
// Tick — chamar no loop() apenas quando:
//   - Não há recuperação ativa (recuperacao_ativa() == false)
//   - Não há ciclo de lavagem em andamento
// -----------------------------------------------------------------------
void lampada_app_tick() {
    if (recuperacao_ativa()) return;   // recuperação gerencia lâmpadas
    // Durante processo de lavagem as lâmpadas são gerenciadas pela
    // maquina_estados — não interferir
    if (g_estado_auto == AUTO_PROCESSO      ||
        g_estado_auto == AUTO_PAUSADO       ||
        g_estado_auto == AUTO_INICIANDO     ||
        g_estado_auto == AUTO_AGUARDA_POS   ||
        g_estado_auto == AUTO_AGUARDA_CARRO ||   // luz verde do auto_iniciar() não pode
        g_estado_auto == AUTO_CARRO_ENTRANDO ||  // ser sobrescrita pelo lightState "velho"
        g_estado_auto == AUTO_HOMING) return;
    // Erro local SEMPRE pisca vermelho, independente do que a nuvem mandou
    // por último — sem isso, a lâmpada ficava presa no último estado do app
    // (ex: verde fixa) mesmo com a máquina travada em erro, sem nenhuma
    // indicação visual de falha pra quem está olhando de fora. Erro é uma
    // condição local; não pode depender da nuvem pra ser visível.
    LampState novo;
    if (g_estado_auto == AUTO_ERRO) {
        novo = LAMP_RED_BLINK;
    } else if ((int32_t)(millis() - _lamp_forca_off_ate) < 0) {
        // Cancelamento recente (botão CANCELAR): força apagada por um tempo
        // curto — a nuvem ainda não soube do cancelamento (só no próximo
        // heartbeat) e continuaria mandando "pode entrar" (verde) até lá,
        // reacendendo a lâmpada na cara do motorista logo depois de cancelar.
        novo = LAMP_OFF;
    } else {
        novo = backend_lamp_state();
    }
    // Reseta timer ao mudar de estado
    if (novo != _lamp_atual) {
        _lamp_atual    = novo;
        _lamp_t_pisca  = 0;
        _lamp_pisca_on = false;
    }
    _lamp_aplicar(_lamp_atual);
}
// Força lâmpada OFF (usado pelo licenca.h ao bloquear)
void lampada_app_off() {
    _lamp_atual = LAMP_OFF;
    SET_Y11(false); SET_Y12(false);
}
// Força a lâmpada apagada por `ms` milissegundos, ignorando o que a nuvem
// mandar nesse meio-tempo — usado pelo botão CANCELAR (tela_auto.h), pra dar
// tempo do heartbeat seguinte informar a nuvem e ela atualizar o lightState.
void lampada_app_forcar_off_temporario(uint32_t ms) {
    _lamp_forca_off_ate = millis() + ms;
    lampada_app_off();
}
