// DIAGNOSTICO 2: o GT911 nao responde em 0x5D/0x14 usando EXIO1 como reset. Esta versao testa TODAS as
// saidas do CH422G (bits 0..7) como possivel reset do toque, com INT baixo e alto, e tambem os estados fixos
// (tudo em 0 / tudo em 1). Para cada tentativa imprime se 0x5D ou 0x14 responderam. Sem LVGL/Board.
#include <Arduino.h>
#include <Wire.h>

#define PIN_SDA 8
#define PIN_SCL 9
#define PIN_INT 4

static bool ch_w(uint8_t a, uint8_t v) { Wire.beginTransmission(a); Wire.write(v); return Wire.endTransmission() == 0; }
static bool resp(uint8_t a)            { Wire.beginTransmission(a); return Wire.endTransmission() == 0; }
static void estado(const char* t) {
    Serial.printf("  %-44s 0x5D:%s 0x14:%s INT=%d\n", t, resp(0x5D) ? "RESPONDE" : "mudo", resp(0x14) ? "RESPONDE" : "mudo", digitalRead(PIN_INT));
}

void setup() {
    Serial.begin(115200); delay(1500);
    Serial.println("\n=== DIAG 2: qual saida do CH422G libera o GT911? ===");
    Wire.begin(PIN_SDA, PIN_SCL, 100000);
    ch_w(0x24, 0x01);                       // saidas habilitadas
    char t[64];
    ch_w(0x38, 0xFF); delay(300); pinMode(PIN_INT, INPUT); estado("tudo em 1 (parado)");
    ch_w(0x38, 0x00); delay(300); estado("tudo em 0 (parado)");
    ch_w(0x38, 0xFF); delay(300);
    for (int modo = 0; modo < 2; modo++) {
        Serial.printf("-- INT %s durante o reset\n", modo ? "ALTO" : "BAIXO");
        for (int b = 0; b < 8; b++) {
            pinMode(PIN_INT, OUTPUT); digitalWrite(PIN_INT, modo);
            ch_w(0x38, 0xFF);               delay(10);
            ch_w(0x38, 0xFF & ~(1 << b));   delay(100);   // so o bit b em 0
            ch_w(0x38, 0xFF);               delay(200);
            pinMode(PIN_INT, INPUT);        delay(50);
            snprintf(t, sizeof t, "pulso baixo no bit %d (EXIO%d)", b, b);
            estado(t);
        }
    }
    Serial.println("=== fim ===");
}
void loop() { delay(1000); }
