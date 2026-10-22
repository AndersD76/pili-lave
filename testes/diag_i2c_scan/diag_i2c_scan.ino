// DIAGNOSTICO (nao faz parte do projeto): varre o I2C do display Waveshare ESP32-S3-Touch-LCD-7 (SDA=8, SCL=9)
// antes e depois de resetar o GT911 pelo CH422G, com INT em nivel baixo (endereco 0x5D) e alto (0x14).
// Sem LVGL, sem Board, sem ESP-NOW. Saida em 115200 baud.
#include <Arduino.h>
#include <Wire.h>

#define PIN_SDA 8
#define PIN_SCL 9
#define PIN_INT 4

static uint8_t g_saida = 0xFF;          // ultimo byte escrito nas saidas do CH422G

static bool ch_escreve(uint8_t addr, uint8_t v) {
    Wire.beginTransmission(addr); Wire.write(v);
    return Wire.endTransmission() == 0;
}
static void ch_saidas(uint8_t v) { g_saida = v; Serial.printf("  CH422G saidas (0x38) = 0x%02X -> %s\n", v, ch_escreve(0x38, v) ? "ACK" : "SEM ACK"); }

static void scan(const char* titulo) {
    Serial.printf("--- scan I2C: %s\n", titulo);
    int n = 0;
    for (uint8_t a = 1; a < 127; a++) {
        Wire.beginTransmission(a);
        if (Wire.endTransmission() == 0) { Serial.printf("   achou 0x%02X\n", a); n++; }
    }
    if (!n) Serial.println("   NENHUM dispositivo respondeu");
}

static bool gt_responde(uint8_t a) { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }

static void gt911_reset(bool int_alto) {
    // bit1 = TP_RST, bit2 = luz de fundo, bit3 = LCD_RST (mesmos indices da definicao da biblioteca)
    pinMode(PIN_INT, OUTPUT); digitalWrite(PIN_INT, int_alto ? HIGH : LOW);
    delay(10);
    ch_saidas(g_saida & ~0x02);  delay(100);      // TP_RST = 0
    ch_saidas(g_saida |  0x02);  delay(200);      // TP_RST = 1
    pinMode(PIN_INT, INPUT);     delay(50);
    Serial.printf("  reset com INT %s: 0x5D %s | 0x14 %s | INT lido = %d\n", int_alto ? "ALTO" : "BAIXO",
                  gt_responde(0x5D) ? "RESPONDE" : "mudo", gt_responde(0x14) ? "RESPONDE" : "mudo", digitalRead(PIN_INT));
}

void setup() {
    Serial.begin(115200); delay(1500);
    Serial.println("\n=== DIAG I2C (display Touch-LCD-7) ===");
    Wire.begin(PIN_SDA, PIN_SCL, 100000);
    scan("ao ligar, sem mexer em nada");

    Serial.println("-- liga as saidas do CH422G (0x24 = 0x01) e a luz de fundo");
    Serial.printf("  CH422G modo (0x24) = 0x01 -> %s\n", ch_escreve(0x24, 0x01) ? "ACK" : "SEM ACK");
    ch_saidas(0xFF & ~0x02);   // tudo ligado, TP_RST em 0 de partida
    delay(50);
    scan("saidas ligadas, GT911 em reset");

    gt911_reset(false); scan("depois do reset com INT baixo");
    gt911_reset(true);  scan("depois do reset com INT alto");
    Serial.println("=== fim. repete a cada 10 s ===");
}

void loop() {
    delay(10000);
    scan("repeticao");
}
