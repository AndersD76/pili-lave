#pragma once
/*
  hard_reset.h — HARD RESET no boot, disparado pelo PROPRIO FIRMWARE.

  Por que: ao energizar, os trilhos de 3V3/5V sobem devagar e periféricos
  (LCD RGB, touch, expansor I/O, sensor da câmera, rádio) às vezes iniciam
  em estado inconsistente. Um reset de sistema completo disparado por software
  (esp_restart -> RTC_CNTL_SW_SYS_RST: reinicia CPU + TODOS os periféricos
  digitais) com a alimentação já estável resolve isso de forma determinística.

  Fase 1  hard_reset_fase1()  — PRIMEIRA coisa do setup(). Se o chip acabou de
          ser ENERGIZADO (POWERON) ou caiu por BROWNOUT, reinicia UMA vez.
          Depois do reset o motivo vira ESP_RST_SW e a marca em RTC confirma
          que já foi feito: NUNCA entra em loop de reset.
  Fase 2  hard_reset_radio()  — antes de qualquer init: ESP-NOW/Wi-Fi
          desligados e zerados, para o rádio subir do zero.

  HARD_RESET_APAGA_NVS = 1 -> alem do reset, APAGA toda a NVS (reset de
  FABRICA: senhas, contadores, saldo, programacao, credenciais). Fica 0 no
  uso normal; ligue so para zerar uma placa, grave, e volte para 0.
*/
#include <Arduino.h>
#include <WiFi.h>
#include <esp_system.h>
#include <esp_wifi.h>
#include <esp_now.h>
#include <nvs_flash.h>

#ifndef HARD_RESET_APAGA_NVS
#define HARD_RESET_APAGA_NVS 0
#endif

#define HR_MARCA 0x50494C49UL   // "PILI" — sobrevive ao esp_restart, indefinida ao energizar
RTC_NOINIT_ATTR static uint32_t g_hr_marca;

static const char* hard_reset_motivo(esp_reset_reason_t r) {
    switch (r) {
        case ESP_RST_POWERON:  return "POWERON";
        case ESP_RST_SW:       return "SW";
        case ESP_RST_PANIC:    return "PANIC";
        case ESP_RST_INT_WDT:  return "INT_WDT";
        case ESP_RST_TASK_WDT: return "TASK_WDT";
        case ESP_RST_WDT:      return "WDT";
        case ESP_RST_BROWNOUT: return "BROWNOUT";
        case ESP_RST_EXT:      return "EXT";
        case ESP_RST_DEEPSLEEP:return "DEEPSLEEP";
        default:               return "OUTRO";
    }
}

// Fase 1 — chamar como PRIMEIRA linha util do setup() (depois de Serial.begin).
static void hard_reset_fase1(const char* nome) {
    esp_reset_reason_t r = esp_reset_reason();
    bool energizou = (r == ESP_RST_POWERON || r == ESP_RST_BROWNOUT || r == ESP_RST_UNKNOWN);
    if (energizou && g_hr_marca != HR_MARCA) {
        g_hr_marca = HR_MARCA;
#if HARD_RESET_APAGA_NVS
        Serial.printf("[%s] HARD RESET: apagando NVS (reset de fabrica)\n", nome);
        nvs_flash_erase();
        nvs_flash_init();
#endif
        Serial.printf("[%s] HARD RESET: motivo=%s -> reiniciando o chip inteiro (uma vez)\n",
                      nome, hard_reset_motivo(r));
        Serial.flush();
        delay(100);
        esp_restart();   // nao retorna
    }
    Serial.printf("[%s] boot limpo (motivo=%s, hard reset ja feito)\n", nome, hard_reset_motivo(r));
}

// Fase 2 — radio do zero: ESP-NOW e Wi-Fi desligados antes de qualquer init.
static void hard_reset_radio() {
    esp_now_deinit();          // ESP_ERR_ESPNOW_NOT_INIT se nunca iniciou: ok
    WiFi.persistent(false);    // nao grava/le config de AP na NVS do Wi-Fi
    WiFi.mode(WIFI_OFF);
    delay(50);
}
