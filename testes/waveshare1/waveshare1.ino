/*
  waveshare1.ino — Waveshare ESP32-S3-8DI-8DO #1 — CONTROLADORA
  Pili Tecnologia — nova arquitetura: esta placa assume a maquina de estados
  inteira (giro/carrinho/HOME/RS-485 do inversor), ficando sozinha com o
  Delta/SAJ no barramento fisico. O display vira "cliente": só tela + nuvem,
  manda comando e recebe status por ESP-NOW (ver protocolo_w1.h).

  Pasta de testes (wave1_mestre/) — NAO AFETA o que esta gravado hoje em
  lava_car_485/ (display com a maquina de estados, como antes).

  Config Arduino: ESP32S3 Dev Module, 16MB, PSRAM OPI, 240MHz, QIO, CDC On Boot = Enabled.
*/
#include <Arduino.h>
#include <Wire.h>
#include <WiFi.h>
#include <esp_now.h>
#include <esp_wifi.h>
#include <esp_system.h>
#include <esp_task_wdt.h>
#include <nvs_flash.h>
#include <Preferences.h>

#include "controle.h"
#include "maquina_estados.h"   // inclui processos.h no fim

// ===================== HARD RESET no boot (via firmware) =====================
#define HARD_RESET_APAGA_NVS 0
#define HR_MARCA 0x50494C49UL
RTC_NOINIT_ATTR static uint32_t g_hr_marca;
static void hard_reset_fase1(const char* nome) {
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
static void hard_reset_radio() { WiFi.persistent(false); WiFi.mode(WIFI_OFF); delay(50); }
static void i2c_recupera_barramento(int sda, int scl) {
    pinMode(sda, INPUT_PULLUP);
    pinMode(scl, OUTPUT_OPEN_DRAIN); digitalWrite(scl, HIGH); delayMicroseconds(5);
    for (uint8_t i = 0; i < 9 && digitalRead(sda) == LOW; i++) {
        digitalWrite(scl, LOW); delayMicroseconds(5);
        digitalWrite(scl, HIGH); delayMicroseconds(5);
    }
    pinMode(sda, OUTPUT_OPEN_DRAIN); digitalWrite(sda, LOW); delayMicroseconds(5);
    digitalWrite(scl, HIGH); delayMicroseconds(5); digitalWrite(sda, HIGH); delayMicroseconds(5);
    pinMode(sda, INPUT_PULLUP); pinMode(scl, INPUT_PULLUP);
}

void setup() {
    Serial.begin(115200);
    delay(200);
    g_rst_motivo = (uint8_t)esp_reset_reason();   // motivo deste boot (vai no status p/ a tela de testes)
    hard_reset_fase1("WAVE1-MESTRE");
    hard_reset_radio();
    i2c_recupera_barramento(I2C_SDA, I2C_SCL);
    Wire.begin(I2C_SDA, I2C_SCL);

    uint8_t canal_boot = controle_canal_boot();   // le da NVS (ou ESPNOW_CANAL se nunca pareou)

    WiFi.mode(WIFI_STA); WiFi.disconnect();
    esp_wifi_set_mac(WIFI_IF_STA, (uint8_t*)MAC_WAVE1);
    esp_wifi_set_promiscuous(true);
    esp_wifi_set_channel(canal_boot, WIFI_SECOND_CHAN_NONE);
    esp_wifi_set_promiscuous(false);
    if (esp_now_init()!=ESP_OK){ Serial.println("[ESP-NOW] init FALHOU"); }
    esp_now_set_pmk(ESPNOW_PMK);

    controle_init();   // registra o callback de recepcao + peers (display, W2)
    modbus_init();     // RS-485: sobe o barramento, reseta o inversor

    // Watchdog de tarefa — mesma rede de seguranca que o display ja tem.
    esp_task_wdt_config_t twdt_config = { .timeout_ms = 15000, .idle_core_mask = 0, .trigger_panic = true };
    esp_task_wdt_reconfigure(&twdt_config);
    esp_task_wdt_add(NULL);

    g_estado.modo_auto = true;   // esta placa so roda o automatico — o display decide via MSG_AUTO_CMD
    Serial.printf("[WAVE1-MESTRE] pronto (ESP-NOW canal %d, RS-485 Delta/SAJ sozinho)\n", g_canal_atual);
}

void loop() {
    esp_task_wdt_reset();

    { static uint32_t t_ult = 0; uint32_t agora_l = millis();
      if (t_ult) { uint32_t d = agora_l - t_ult; if (d > g_loop_max_ms) g_loop_max_ms = d > 65535 ? 65535 : (uint16_t)d;
        if (d > g_loop_max_5s) g_loop_max_5s = d > 65535 ? 65535 : (uint16_t)d; }
      t_ult = agora_l; }

    processa_comandos();   // executa o que o display pediu (o callback so enfileira)

    static uint32_t t_modbus = 0;
    if (millis() - t_modbus >= 500) { t_modbus = millis(); modbus_tick(); }

    home_tick();
    desloc_tick();
    controle_tick();   // status periodico pro display + alarme da W2

    static unsigned long t_auto = 0;
    if (!recuperacao_ativa() && millis() - t_auto >= 50) {   // sempre ticka (nao depende de "modo_auto", conceito de tela do display)
        t_auto = millis();
        auto_tick();
    }

    led_tick();
}
