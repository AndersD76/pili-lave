// W2_TESTE_LINK — firmware SO DE TESTE do cabo W1<->W2 (UART0: TXD=GPIO43, RXD=GPIO44). Nao controla a maquina.
// FQBN: esp32:esp32:esp32s3:PSRAM=opi,CPUFreq=240,FlashMode=qio,FlashSize=16M,CDCOnBoot=cdc   (W2 = COM10)
// Toda a logica esta em link_proto.h (identico na W1). A W2 segue o anuncio de fase da W1.
#define LADO 2
#include "link_proto.h"

void setup() { link_setup(); }
void loop()  { link_loop(); }
