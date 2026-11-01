// link_cfg.h — CHAVE E CONSTANTES do link W1<->W2. IDENTICO nas pastas waveshare1 e waveshare2 (confira com cmp).
//
//   LINK_W1_W2_UART = 1 : a W1 e a W2 conversam por CABO (UART0: TXD = GPIO43, RXD = GPIO44, 3,3 V, 115200 8N1). A W2 NAO usa Wi-Fi nem
//                         ESP-NOW. O radio fica so na W1 (display e camera, como sempre).
//   LINK_W1_W2_UART = 0 : volta ao ESP-NOW antigo entre W1 e W2 (o codigo antigo continua no arquivo, dentro do #else). Com 0 o comportamento
//                         e IDENTICO ao firmware de producao anterior. Para voltar: troque o 1 por 0 aqui nas DUAS pastas, recompile e regrave
//                         W1 e W2 (ou use o backup em backup_atual/). Tambem da para testar sem editar: --build-property
//                         "compiler.cpp.extra_flags=-DLINK_W1_W2_UART=0".
#pragma once
#ifndef LINK_W1_W2_UART
#define LINK_W1_W2_UART 1
#endif

#define LINK_UART_BAUD     115200UL   // validado na Fase 1 (teste_link). Os dois lados precisam ter o mesmo valor.
#define LINK_UART_TX_PIN   43         // borne TXD
#define LINK_UART_RX_PIN   44         // borne RXD
#define LINK_KEEP_MS       200        // W1 -> W2: sinal de vida a cada 200 ms (alimenta o fail-safe da W2)
#define LINK_FAILSAFE_MS   2000       // W2: sem NENHUM quadro da W1 por este tempo, desliga as saidas (menos as luzes, canal 7 / indice 6)
#define LINK_LUZES_IDX     6          // DO7 (luzes da maquina): o fail-safe NAO a desliga
