// link_proto.h — TESTE do link W1<->W2 por CABO (UART0: TXD = GPIO43, RXD = GPIO44, 3,3 V, sem isolacao).
// IDENTICO nas duas pastas (w1_teste_link e w2_teste_link): o .ino de cada lado so define LADO (1 = W1, 2 = W2) e chama link_setup()/link_loop().
//
// Objetivo UNICO: provar o cabo e medir qualidade e ruido, tudo pelo monitor serial USB (115200). NENHUM sinal nas saidas: no boot desliga UMA
// vez as saidas do expansor com o valor de "tudo desligado" da producao (lógica invertida: registrador de saida = 0xFF), confere por leitura
// de volta e NUNCA mais escreve nas saidas. Sem RS-485 (GPIO17/18/21 inativos), sem Wi-Fi e sem ESP-NOW.
//
// QUADRO (binario):  A5 5A | tipo | seq(2, little-endian) | len | payload[len] | CRC16(2, little-endian)
//   CRC16-CCITT (poly 0x1021, init 0xFFFF) sobre: tipo, seq, len e payload (NAO inclui os dois bytes de inicio).
//   tipo: 1 = OI (iniciador -> respondedor), 2 = RESP (respondedor -> iniciador, ecoa o padrao), 4 = FASE (W1 -> W2: "esta e a fase n"),
//         5 = FASE_ACK (W2 -> W1).
//   payload de OI/RESP: [fase][pat_id][pat_len][Cont do REMETENTE (90 bytes)][padrao: pat_len bytes]
//   padroes (pat_id): 0 = 0x00, 1 = 0xFF, 2 = 0x55, 3 = 0xAA, 4 = incremental, 5 = pseudo-aleatorio (semente = seq), 6 = A5 5A A5 5A... (estressa
//   a sincronizacao do receptor). pat_len varia de 8 a 32 conforme a seq.
//
// FASES: W1 manda o ritmo. Fase par: W1 e o iniciador (manda OI, W2 responde). Fase impar: INVERTE (W2 manda OI, W1 responde). Cada fase dura
//   T_FASE_S segundos e depois alterna, sem parar. Ao fim de cada fase imprime o RESUMO.
// Cada lado manda os seus contadores dentro de cada quadro, entao UM unico monitor mostra as duas visoes.
#pragma once
#include <Arduino.h>
#include <Wire.h>
#include <HardwareSerial.h>

#ifndef LADO
#error "defina LADO (1 = W1, 2 = W2) antes de incluir link_proto.h"
#endif

// ---------------------------------------------------------------- constantes (mude aqui; -DLINK_BAUD=460800 para comparar) --------------
#ifndef LINK_BAUD
#define LINK_BAUD 115200UL
#endif
#define LINK_TX_PIN        43      // borne TXD (confirmar com o loopback 'L': a doc oficial da Waveshare nao da esse mapeamento)
#define LINK_RX_PIN        44      // borne RXD
#define T_FASE_S           30      // duracao de cada fase (s)
#define PERIODO_OI_MS      50      // intervalo entre OIs do iniciador (20 por segundo)
#define TMO_RESP_MS        30      // espera pela RESP antes de contar timeout
#define TMO_BYTE_MS        20      // quadro parado no meio por mais que isso = truncado
#define BOOT_JANELA_MS     3000    // lixo de boot (ROM do vizinho) nos primeiros 3 s nao conta como espurio
#define REL_PERIODO_MS     5000    // relatorio a cada 5 s
#define RAJADA_RUIM        3       // 3 falhas seguidas = RUIM
#define LIMITE_ERRO_PCT    0.1f    // 0,1 % ou mais = RUIM
#define EVT_MAX_POR_JANELA 30      // limite de linhas de erro por relatorio (o resto vira "+N suprimidos")
#define SYNC1 0xA5
#define SYNC2 0x5A
#define MAXP  128
enum : uint8_t { T_OI = 1, T_RESP = 2, T_FASE = 4, T_FASE_ACK = 5 };

// ---------------------------------------------------------------- saidas do expansor (igual a producao) -------------------------------
#define I2C_SDA 42
#define I2C_SCL 41
#define PCA9554_ADDR 0x20
#define PCA9554_REG_OUTPUT 0x01
#define PCA9554_REG_CONFIG 0x03
#define EXP_TUDO_DESLIGADO 0xFF    // DO_LOGICA_INVERTIDA = 1 na producao (W1 e W2): bit 1 = rele desligado
#define LED_PIN 38

// ---------------------------------------------------------------- contadores (a visao de QUEM ENVIA o quadro) ---------------------------
struct __attribute__((packed)) Cont {
    uint32_t t_ms;                                        // millis() do remetente
    uint32_t enviados, ok, crc, tmo, fora;                // como INICIADOR: OIs enviados; RESP validas; quadros ruins; timeouts; RESP fora de hora
    uint32_t rx_ok, rx_crc, perdidos, dup, fora_ord;      // como RESPONDEDOR: OIs validos; ruins; saltos de seq; duplicados; fora de ordem
    uint32_t trunc, espurios, boot_bytes, conteudo;       // quadro truncado; bytes fora de quadro (apos o boot); lixo de boot; eco diferente
    uint32_t u_brk, u_frm, u_par, u_fifo, u_buf;          // erros da UART: break, frame, paridade, estouro de FIFO, buffer cheio
    uint16_t rtt_min_us, rtt_med_us, rtt_max_us;          // ida e volta
    uint16_t sil_max_ms, rajada_max;                      // maior silencio entre quadros validos; maior rajada de falhas
};
static_assert(sizeof(Cont) == 90, "Cont mudou de tamanho");

static HardwareSerial& LINK = Serial0;                    // UART0 (a USB nativa e o Serial; a UART0 esta livre com CDCOnBoot=cdc)
static Cont g_c;                                          // fase atual
static Cont g_tot;                                        // acumulado desde o boot (fases encerradas)
static Cont g_rem;                                        // ultimo Cont recebido do vizinho
static uint32_t g_rem_ms = 0;
static volatile uint32_t g_u_brk = 0, g_u_frm = 0, g_u_par = 0, g_u_fifo = 0, g_u_buf = 0;

static uint8_t  g_fase = 0;                               // numero da fase (par: W1 inicia; impar: W2 inicia)
static bool     g_fase_ativa = false;
static uint32_t g_fase_t0 = 0;
static uint16_t g_seq_tx = 0;                             // seq dos OIs que ESTE lado envia
static int32_t  g_seq_rx_ult = -1;                        // ultimo seq de OI visto (como respondedor)
static bool     g_pend = false; static uint16_t g_pend_seq = 0; static uint32_t g_pend_us = 0, g_pend_ms = 0; static bool g_pend_falha = false;
static uint8_t  g_pend_pat[32]; static uint8_t g_pend_patlen = 0, g_pend_patid = 0;
static uint32_t g_t_ult_oi = 0, g_t_rel = 0, g_t_fase_tx = 0, g_t_keep = 0, g_ult_valido_ms = 0, g_boot_ms = 0;
static uint32_t g_falhas_seguidas = 0;
static uint64_t g_rtt_soma = 0; static uint32_t g_rtt_n = 0;
static uint16_t g_sil_jan = 0; static uint32_t g_falhas_jan_ant = 0;
static uint16_t g_rtt_min_jan = 0xFFFF, g_rtt_max_jan = 0; static uint64_t g_rtt_soma_jan = 0; static uint32_t g_rtt_n_jan = 0;
static uint32_t g_evt_jan = 0, g_evt_sup = 0;
static bool     g_loopback = false;

static inline bool sou_w1() { return LADO == 1; }
static inline bool sou_iniciador() { return (g_fase % 2 == 0) ? sou_w1() : !sou_w1(); }

// ---------------------------------------------------------------- utilidades --------------------------------------------------------
static uint16_t crc_upd(uint16_t crc, uint8_t b) {
    crc ^= (uint16_t)b << 8;
    for (uint8_t i = 0; i < 8; i++) crc = (crc & 0x8000) ? (uint16_t)((crc << 1) ^ 0x1021) : (uint16_t)(crc << 1);
    return crc;
}
static uint16_t crc16(const uint8_t* b, size_t n) { uint16_t c = 0xFFFF; for (size_t i = 0; i < n; i++) c = crc_upd(c, b[i]); return c; }

static void evento(const char* fmt, ...) {               // linha de erro propria, com o instante em ms (limitada por janela)
    if (g_evt_jan >= EVT_MAX_POR_JANELA) { g_evt_sup++; return; }
    g_evt_jan++;
    char b[160]; va_list ap; va_start(ap, fmt); vsnprintf(b, sizeof(b), fmt, ap); va_end(ap);
    Serial.printf("[%10lu ms] ERRO %s\n", (unsigned long)millis(), b);
}
static void falha() {                                    // conta uma falha na rajada
    g_falhas_seguidas++;
    if (g_falhas_seguidas > g_c.rajada_max) g_c.rajada_max = (uint16_t)(g_falhas_seguidas > 65535 ? 65535 : g_falhas_seguidas);
}
static void sucesso() { g_falhas_seguidas = 0; }

static void descarta(uint8_t n, uint8_t b) {             // bytes fora de quadro
    if (millis() - g_boot_ms < BOOT_JANELA_MS) { g_c.boot_bytes += n; return; }
    g_c.espurios += n;
    evento("byte_espurio 0x%02X (fora de quadro)", b);
}

static void padrao_gerar(uint8_t id, uint16_t seq, uint8_t* out, uint8_t n) {
    uint32_t x = 0x9E3779B9u ^ ((uint32_t)seq * 2654435761u);
    for (uint8_t i = 0; i < n; i++) {
        switch (id) {
            case 0: out[i] = 0x00; break;
            case 1: out[i] = 0xFF; break;
            case 2: out[i] = 0x55; break;
            case 3: out[i] = 0xAA; break;
            case 4: out[i] = (uint8_t)(i + seq); break;
            case 5: x ^= x << 13; x ^= x >> 17; x ^= x << 5; out[i] = (uint8_t)x; break;
            default: out[i] = (i & 1) ? SYNC2 : SYNC1; break;
        }
    }
}

// ---------------------------------------------------------------- transmissao -------------------------------------------------------
static void quadro_enviar(uint8_t tipo, uint16_t seq, const uint8_t* pl, uint8_t len) {
    uint8_t b[8 + MAXP];
    b[0] = SYNC1; b[1] = SYNC2; b[2] = tipo; b[3] = (uint8_t)(seq & 0xFF); b[4] = (uint8_t)(seq >> 8); b[5] = len;
    if (len) memcpy(&b[6], pl, len);
    uint16_t c = crc16(&b[2], 4 + len);
    b[6 + len] = (uint8_t)(c & 0xFF); b[7 + len] = (uint8_t)(c >> 8);
    LINK.write(b, 8 + len);
}
static void cont_montar(Cont& c) {                       // fotografia dos contadores com os campos derivados
    c = g_c; c.t_ms = millis();
    c.u_brk = g_u_brk; c.u_frm = g_u_frm; c.u_par = g_u_par; c.u_fifo = g_u_fifo; c.u_buf = g_u_buf;
    c.rtt_med_us = g_rtt_n ? (uint16_t)min<uint64_t>(g_rtt_soma / g_rtt_n, 65535) : 0;
    if (c.rtt_min_us == 0xFFFF) c.rtt_min_us = 0;
}
static void oi_ou_resp_enviar(uint8_t tipo, uint16_t seq, uint8_t patid, uint8_t patlen, const uint8_t* pat) {
    uint8_t pl[MAXP]; Cont c; cont_montar(c);
    pl[0] = g_fase; pl[1] = patid; pl[2] = patlen;
    memcpy(&pl[3], &c, sizeof(Cont));
    memcpy(&pl[3 + sizeof(Cont)], pat, patlen);
    quadro_enviar(tipo, seq, pl, (uint8_t)(3 + sizeof(Cont) + patlen));
}

// ---------------------------------------------------------------- veredito e relatorio ---------------------------------------------------
static uint32_t falhas_de(const Cont& c) { return c.crc + c.tmo + c.fora + c.conteudo + c.rx_crc + c.perdidos + c.dup + c.fora_ord + c.trunc; }
static uint32_t tentativas_de(const Cont& c, bool inic) { return inic ? c.enviados : (c.rx_ok + c.rx_crc + c.perdidos); }
static const char* veredito(const Cont& c, bool inic, uint8_t* nivel) {
    uint32_t f = falhas_de(c), t = tentativas_de(c, inic);
    float pct = 100.0f * f / (t ? t : 1);
    uint32_t u = c.u_brk + c.u_frm + c.u_par + c.u_fifo + c.u_buf;
    bool ruido = (c.espurios > 0) || (u > 0);
    const char* v; uint8_t n;
    if (!t) { v = "SEM TRAFEGO"; n = 2; }
    else if (pct >= LIMITE_ERRO_PCT || c.rajada_max >= RAJADA_RUIM) { v = "RUIM"; n = 2; }
    else if (f > 0 || ruido) { v = "ATENCAO"; n = 1; }
    else { v = "OK"; n = 0; }
    if (nivel) *nivel = n;
    static char buf[40]; snprintf(buf, sizeof(buf), "%s%s", v, ruido ? " | RUIDO PROVAVEL" : "");
    return buf;
}
static void led_nivel(uint8_t n) { if (n == 0) rgbLedWrite(LED_PIN, 0, 25, 0); else if (n == 1) rgbLedWrite(LED_PIN, 25, 15, 0); else rgbLedWrite(LED_PIN, 30, 0, 0); }

static void relatorio_linha(const char* quem, const Cont& c, bool inic, bool janela) {
    uint8_t nv = 0; const char* v = veredito(c, inic, &nv);
    uint32_t u = c.u_brk + c.u_frm + c.u_par + c.u_fifo + c.u_buf;
    if (inic)
        Serial.printf("  %-26s enviados=%lu ok=%lu crc=%lu tmo=%lu fora=%lu eco=%lu trunc=%lu | rajada_max=%u | espurios=%lu boot=%lu uart_err=%lu (brk%lu frm%lu par%lu fifo%lu buf%lu) | %s\n",
            quem, (unsigned long)c.enviados, (unsigned long)c.ok, (unsigned long)c.crc, (unsigned long)c.tmo, (unsigned long)c.fora, (unsigned long)c.conteudo,
            (unsigned long)c.trunc, c.rajada_max, (unsigned long)c.espurios, (unsigned long)c.boot_bytes, (unsigned long)u,
            (unsigned long)c.u_brk, (unsigned long)c.u_frm, (unsigned long)c.u_par, (unsigned long)c.u_fifo, (unsigned long)c.u_buf, v);
    else
        Serial.printf("  %-26s recebidos_ok=%lu crc=%lu perdidos=%lu dup=%lu fora_ord=%lu trunc=%lu | rajada_max=%u | espurios=%lu boot=%lu uart_err=%lu (brk%lu frm%lu par%lu fifo%lu buf%lu) | %s\n",
            quem, (unsigned long)c.rx_ok, (unsigned long)c.rx_crc, (unsigned long)c.perdidos, (unsigned long)c.dup, (unsigned long)c.fora_ord,
            (unsigned long)c.trunc, c.rajada_max, (unsigned long)c.espurios, (unsigned long)c.boot_bytes, (unsigned long)u,
            (unsigned long)c.u_brk, (unsigned long)c.u_frm, (unsigned long)c.u_par, (unsigned long)c.u_fifo, (unsigned long)c.u_buf, v);
    (void)janela;
}
static void relatorio(bool resumo) {
    Cont c; cont_montar(c);
    bool inic = sou_iniciador();
    uint8_t nv = 0; veredito(c, inic, &nv);
    Serial.printf("%s FASE %u  (%s inicia)  t=%lus  baud=%lu\n", resumo ? "== RESUMO" : "[5 s]", g_fase, (g_fase % 2 == 0) ? "W1" : "W2",
                  (unsigned long)((millis() - g_fase_t0) / 1000UL), (unsigned long)LINK_BAUD);
    relatorio_linha(sou_w1() ? "W1 (minha visao):" : "W2 (minha visao):", c, inic, false);
    if (g_rem_ms) {
        Cont r = g_rem;
        relatorio_linha(sou_w1() ? "W2 (visao dela, ha ms):" : "W1 (visao dela, ha ms):", r, !inic, false);
        Serial.printf("  (visao do vizinho recebida ha %lu ms)\n", (unsigned long)(millis() - g_rem_ms));
    } else Serial.println("  (ainda sem quadro do vizinho)");
    if (inic) {
        uint32_t med = g_rtt_n_jan ? (uint32_t)(g_rtt_soma_jan / g_rtt_n_jan) : 0;
        Serial.printf("  ida e volta (janela 5 s): min=%.2f med=%.2f max=%.2f ms | fase inteira: min=%.2f med=%.2f max=%.2f ms\n",
            g_rtt_n_jan ? g_rtt_min_jan / 1000.0f : 0.0f, med / 1000.0f, g_rtt_n_jan ? g_rtt_max_jan / 1000.0f : 0.0f,
            c.rtt_min_us / 1000.0f, c.rtt_med_us / 1000.0f, c.rtt_max_us / 1000.0f);
    }
    uint32_t f = falhas_de(c);
    Serial.printf("  maior silencio entre quadros validos: janela=%u ms, fase=%u ms | falhas novas na janela=%lu\n",
                  g_sil_jan, c.sil_max_ms, (unsigned long)(f - g_falhas_jan_ant));
    if (g_evt_sup) Serial.printf("  (+%lu linhas de erro suprimidas nesta janela)\n", (unsigned long)g_evt_sup);
    g_falhas_jan_ant = f; g_sil_jan = 0; g_evt_jan = 0; g_evt_sup = 0;
    g_rtt_min_jan = 0xFFFF; g_rtt_max_jan = 0; g_rtt_soma_jan = 0; g_rtt_n_jan = 0;
    led_nivel(nv);
}
static void cont_somar(Cont& t, const Cont& c) {         // acumula uma fase encerrada em g_tot
    t.enviados += c.enviados; t.ok += c.ok; t.crc += c.crc; t.tmo += c.tmo; t.fora += c.fora;
    t.rx_ok += c.rx_ok; t.rx_crc += c.rx_crc; t.perdidos += c.perdidos; t.dup += c.dup; t.fora_ord += c.fora_ord;
    t.trunc += c.trunc; t.espurios += c.espurios; t.boot_bytes += c.boot_bytes; t.conteudo += c.conteudo;
    if (c.rajada_max > t.rajada_max) t.rajada_max = c.rajada_max;
    if (c.sil_max_ms > t.sil_max_ms) t.sil_max_ms = c.sil_max_ms;
}
static void fase_zerar() {
    memset(&g_c, 0, sizeof(g_c)); g_c.rtt_min_us = 0xFFFF;
    g_rtt_soma = 0; g_rtt_n = 0; g_falhas_seguidas = 0; g_seq_rx_ult = -1; g_pend = false; g_falhas_jan_ant = 0;
    g_t_ult_oi = millis(); g_ult_valido_ms = 0; g_sil_jan = 0;
}
static void fase_encerrar() {                            // imprime o RESUMO da fase e acumula
    relatorio(true);
    Cont c; cont_montar(c); cont_somar(g_tot, c);
}
static void fase_iniciar(uint8_t id) {
    g_fase = id; g_fase_ativa = true; g_fase_t0 = millis(); fase_zerar(); g_t_rel = millis();
    Serial.printf("\n=== FASE %u INICIADA: %s manda 'oi', %s responde (baud %lu, 8N1, TXD=GPIO%d RXD=GPIO%d) ===\n", id,
                  (id % 2 == 0) ? "W1" : "W2", (id % 2 == 0) ? "W2" : "W1", (unsigned long)LINK_BAUD, LINK_TX_PIN, LINK_RX_PIN);
}

// ---------------------------------------------------------------- recepcao: maquina de estados do quadro ------------------------------
static struct { uint8_t st, tipo, len, pos; uint16_t seq, crc, crc_rx; uint8_t pl[MAXP]; uint32_t t_ult; } rx = {};

static void quadro_valido(uint8_t tipo, uint16_t seq, const uint8_t* pl, uint8_t len) {
    uint32_t agora = millis();
    if (g_ult_valido_ms && g_fase_ativa) {                // maior silencio entre quadros validos
        uint32_t gap = agora - g_ult_valido_ms;
        if (gap > 65535) gap = 65535;
        if (gap > g_c.sil_max_ms) g_c.sil_max_ms = (uint16_t)gap;
        if (gap > g_sil_jan) g_sil_jan = (uint16_t)gap;
    }
    g_ult_valido_ms = agora;

    if (tipo == T_FASE && len >= 1) {                     // W2: a W1 anuncia a fase
        if (!sou_w1()) {
            uint8_t id = pl[0];
            if (!g_fase_ativa || id != g_fase) { if (g_fase_ativa) fase_encerrar(); fase_iniciar(id); }
            uint8_t a = id; quadro_enviar(T_FASE_ACK, seq, &a, 1);
        }
        return;
    }
    if (tipo == T_FASE_ACK && len >= 1) {                 // W1: a W2 confirmou
        if (sou_w1() && !g_fase_ativa && pl[0] == g_fase) fase_iniciar(g_fase);
        return;
    }
    if ((tipo != T_OI && tipo != T_RESP) || len < 3 + sizeof(Cont)) return;
    uint8_t patid = pl[1], patlen = pl[2];
    if (patlen > 32 || len < 3 + sizeof(Cont) + patlen) { g_c.rx_crc++; evento("payload inconsistente (pat_len=%u len=%u)", patlen, len); falha(); return; }
    Cont r; memcpy(&r, &pl[3], sizeof(Cont));
    if (g_rem_ms && r.t_ms + 1000 < g_rem.t_ms) evento("VIZINHO REINICIOU (t_ms voltou de %lu para %lu)", (unsigned long)g_rem.t_ms, (unsigned long)r.t_ms);
    g_rem = r; g_rem_ms = agora;
    if (!g_fase_ativa) return;
    const uint8_t* pat = &pl[3 + sizeof(Cont)];

    if (tipo == T_OI) {                                   // sou o RESPONDEDOR
        if (sou_iniciador()) return;
        int32_t esp = (g_seq_rx_ult < 0) ? (int32_t)seq : (int32_t)((g_seq_rx_ult + 1) & 0xFFFF);
        if (g_seq_rx_ult >= 0) {
            int16_t d = (int16_t)(seq - (uint16_t)esp);
            if (d > 0) { g_c.perdidos += d; evento("seq perdido (esperava %ld, veio %u, faltaram %d)", (long)esp, seq, d); falha(); }
            else if (d < 0 && seq == (uint16_t)g_seq_rx_ult) { g_c.dup++; evento("seq duplicado %u", seq); falha(); }
            else if (d < 0) { g_c.fora_ord++; evento("seq fora de ordem (esperava %ld, veio %u)", (long)esp, seq); falha(); }
        }
        if (g_seq_rx_ult < 0 || (int16_t)(seq - (uint16_t)g_seq_rx_ult) > 0) g_seq_rx_ult = seq;
        g_c.rx_ok++; sucesso();
        oi_ou_resp_enviar(T_RESP, seq, patid, patlen, pat);    // eco do mesmo padrao
    } else {                                              // T_RESP: sou o INICIADOR
        if (!sou_iniciador()) return;
        if (g_pend && seq == g_pend_seq) {
            uint32_t rtt = micros() - g_pend_us; if (rtt > 65535) rtt = 65535;
            if (patlen != g_pend_patlen || memcmp(pat, g_pend_pat, patlen) != 0) {
                g_c.conteudo++; evento("eco diferente do enviado (seq %u, pat %u)", seq, patid); falha();
            } else {
                g_c.ok++; sucesso();
                if (rtt < g_c.rtt_min_us) g_c.rtt_min_us = (uint16_t)rtt;
                if (rtt > g_c.rtt_max_us) g_c.rtt_max_us = (uint16_t)rtt;
                g_rtt_soma += rtt; g_rtt_n++;
                if (rtt < g_rtt_min_jan) g_rtt_min_jan = (uint16_t)rtt;
                if (rtt > g_rtt_max_jan) g_rtt_max_jan = (uint16_t)rtt;
                g_rtt_soma_jan += rtt; g_rtt_n_jan++;
            }
            g_pend = false;
        } else { g_c.fora++; evento("resposta fora de hora (seq %u, esperava %u)", seq, g_pend ? g_pend_seq : 0); falha(); }
    }
}

static void rx_byte(uint8_t b) {
    uint32_t agora = millis();
    if (rx.st > 0 && (agora - rx.t_ult) > TMO_BYTE_MS) {  // quadro parado no meio
        g_c.trunc++; evento("quadro truncado (parado no estado %u)", rx.st); falha(); if (g_pend) g_pend_falha = true; rx.st = 0;
    }
    rx.t_ult = agora;
    switch (rx.st) {
        case 0: if (b == SYNC1) rx.st = 1; else descarta(1, b); break;
        case 1: if (b == SYNC2) { rx.st = 2; rx.crc = 0xFFFF; } else { descarta(1, SYNC1); rx.st = 0; if (b == SYNC1) rx.st = 1; else descarta(1, b); } break;
        case 2: rx.tipo = b; rx.crc = crc_upd(rx.crc, b); rx.st = 3; break;
        case 3: rx.seq = b; rx.crc = crc_upd(rx.crc, b); rx.st = 4; break;
        case 4: rx.seq |= (uint16_t)b << 8; rx.crc = crc_upd(rx.crc, b); rx.st = 5; break;
        case 5:
            if (b > MAXP) { descarta(6, b); rx.st = 0; break; }          // tamanho impossivel: era lixo
            rx.len = b; rx.pos = 0; rx.crc = crc_upd(rx.crc, b); rx.st = b ? 6 : 7; break;
        case 6: rx.pl[rx.pos++] = b; rx.crc = crc_upd(rx.crc, b); if (rx.pos >= rx.len) rx.st = 7; break;
        case 7: rx.crc_rx = b; rx.st = 8; break;
        case 8:
            rx.crc_rx |= (uint16_t)b << 8; rx.st = 0;
            if (rx.crc_rx == rx.crc) quadro_valido(rx.tipo, rx.seq, rx.pl, rx.len);
            else {
                if (sou_iniciador() && g_fase_ativa) g_c.crc++; else g_c.rx_crc++;
                evento("CRC ruim (tipo %u seq %u len %u)", rx.tipo, rx.seq, rx.len); falha(); if (g_pend) g_pend_falha = true;
            }
            break;
    }
}

// ---------------------------------------------------------------- expansor: desliga UMA vez e confere ------------------------------------
static uint8_t pca_ler(uint8_t reg) {
    Wire.beginTransmission(PCA9554_ADDR); Wire.write(reg);
    if (Wire.endTransmission(false) != 0) return 0xEE;
    if (Wire.requestFrom((uint8_t)PCA9554_ADDR, (uint8_t)1) != 1) return 0xEE;
    return Wire.read();
}
static void expansor_tudo_desligado() {
    Wire.begin(I2C_SDA, I2C_SCL);
    // Ordem segura: grava o valor "tudo desligado" no registrador de SAIDA enquanto os pinos ainda sao entradas, e so depois configura como saida
    // (a producao grava CONFIG primeiro; o estado final e o mesmo, mas assim nunca ha um instante em que um valor antigo apareca nos reles).
    Wire.beginTransmission(PCA9554_ADDR); Wire.write(PCA9554_REG_OUTPUT); Wire.write(EXP_TUDO_DESLIGADO); uint8_t e1 = Wire.endTransmission();
    Wire.beginTransmission(PCA9554_ADDR); Wire.write(PCA9554_REG_CONFIG); Wire.write((uint8_t)0x00);      uint8_t e2 = Wire.endTransmission();
    uint8_t out = pca_ler(PCA9554_REG_OUTPUT), cfg = pca_ler(PCA9554_REG_CONFIG);
    bool ok = (e1 == 0 && e2 == 0 && out == EXP_TUDO_DESLIGADO && cfg == 0x00);
    Serial.printf("[EXP] saidas desligadas UMA vez (saida=0x%02X, direcao=0x%02X); leitura de volta: saida=0x%02X direcao=0x%02X -> %s\n",
                  EXP_TUDO_DESLIGADO, 0x00, out, cfg, ok ? "OK" : "FALHA (confira o expansor 0x20 / I2C 41,42)");
    // DAQUI EM DIANTE ESTE FIRMWARE NUNCA MAIS ESCREVE NO EXPANSOR.
}

// ---------------------------------------------------------------- loopback ('L'): jumper TXD(43) <-> RXD(44) na PROPRIA placa -------------
static void loopback() {
    Serial.println("\n[LOOPBACK] teste na propria placa. Precisa do jumper GPIO43 (TXD) <-> GPIO44 (RXD) e SEM a outra placa ligada. Enviando 100 quadros...");
    g_loopback = true;
    uint32_t ok = 0, crc = 0, tmo = 0, difer = 0, esp = 0;
    while (LINK.available()) LINK.read();
    for (uint16_t i = 0; i < 100; i++) {
        uint8_t pat[32]; uint8_t id = i % 7, n = 8 + (i % 4) * 8; padrao_gerar(id, i, pat, n);
        uint8_t pl[MAXP]; pl[0] = 0; pl[1] = id; pl[2] = n; memset(&pl[3], 0, sizeof(Cont)); memcpy(&pl[3 + sizeof(Cont)], pat, n);
        quadro_enviar(T_OI, i, pl, (uint8_t)(3 + sizeof(Cont) + n));
        uint32_t t0 = millis(); bool got = false;
        memset(&rx, 0, sizeof(rx));
        uint32_t ok_ant = g_c.espurios;
        while (millis() - t0 < 60 && !got) {
            while (LINK.available()) {
                uint8_t b = LINK.read();
                // parser local simplificado: acumula ate fechar um quadro e confere
                static uint8_t buf[8 + MAXP]; static uint16_t k = 0; if (k == 0 && b != SYNC1) { esp++; continue; }
                if (k >= sizeof(buf)) { k = 0; esp++; continue; }       // protecao: tamanho impossivel
                buf[k++] = b;
                if (k >= 6 && buf[5] > MAXP) { k = 0; esp++; continue; }
                if (k >= 6 && k >= (uint16_t)(8 + buf[5])) {
                    uint16_t c = crc16(&buf[2], 4 + buf[5]); uint16_t cr = buf[6 + buf[5]] | ((uint16_t)buf[7 + buf[5]] << 8);
                    if (c == cr) { if (memcmp(&buf[6 + 3 + sizeof(Cont)], pat, n) == 0) ok++; else difer++; } else crc++;
                    k = 0; got = true; break;
                }
            }
        }
        (void)ok_ant;
        if (!got) tmo++;
        delay(5);
    }
    g_loopback = false;
    memset(&rx, 0, sizeof(rx));
    Serial.printf("[LOOPBACK] 100 enviados: ok=%lu crc_ruim=%lu eco_diferente=%lu sem_eco=%lu bytes_estranhos=%lu\n",
                  (unsigned long)ok, (unsigned long)crc, (unsigned long)difer, (unsigned long)tmo, (unsigned long)esp);
    if (ok == 100) Serial.println("[LOOPBACK] RESULTADO: OK — GPIO43 e GPIO44 sao mesmo TXD/RXD da UART0 e o hardware esta bom.");
    else if (tmo == 100) Serial.println("[LOOPBACK] RESULTADO: SEM ECO — confira o jumper TXD<->RXD (GPIO43<->GPIO44) ou o mapeamento dos bornes (a doc oficial da Waveshare nao o confirma).");
    else Serial.println("[LOOPBACK] RESULTADO: FALHOU em parte — ha perda/ruido ate no jumper curto; olhe a fiacao/resistores.");
}

// ---------------------------------------------------------------- inicializacao e loop ---------------------------------------------------
static void uart_erro_cb(hardwareSerial_error_t e) {
    switch (e) {
        case UART_BREAK_ERROR:       g_u_brk++;  break;
        case UART_FRAME_ERROR:       g_u_frm++;  break;
        case UART_PARITY_ERROR:      g_u_par++;  break;
        case UART_FIFO_OVF_ERROR:    g_u_fifo++; break;
        case UART_BUFFER_FULL_ERROR: g_u_buf++;  break;
        default: break;
    }
}
static void link_setup() {
    Serial.begin(115200);
    Serial.setTxTimeoutMs(0);                             // monitor USB fechado nao pode travar o teste
    g_boot_ms = millis();
    delay(300);
    Serial.printf("\n\n[%s-TESTE-LINK] firmware de teste do cabo W1<->W2 | UART0 %lu 8N1 TXD=GPIO%d RXD=GPIO%d | fase de %d s | comandos: L=loopback R=zera S=resumo\n",
                  sou_w1() ? "W1" : "W2", (unsigned long)LINK_BAUD, LINK_TX_PIN, LINK_RX_PIN, T_FASE_S);
    Serial.printf("[%s] motivo do reset=%d | RS-485 (GPIO17/18/21), Wi-Fi e ESP-NOW inativos\n", sou_w1() ? "W1" : "W2", (int)esp_reset_reason());
    expansor_tudo_desligado();
    LINK.setRxBufferSize(1024);
    LINK.onReceiveError(uart_erro_cb);
    LINK.begin(LINK_BAUD, SERIAL_8N1, LINK_RX_PIN, LINK_TX_PIN);
    rgbLedWrite(LED_PIN, 0, 0, 25);                       // azul = esperando o vizinho
    memset(&g_tot, 0, sizeof(g_tot)); g_tot.rtt_min_us = 0xFFFF;
    fase_zerar(); g_fase_ativa = false; g_fase = 0; g_t_fase_tx = 0;
    Serial.println(sou_w1() ? "[W1] aguardando a W2 (anuncio da fase 0 a cada 100 ms)..." : "[W2] aguardando o anuncio de fase da W1...");
}

static void link_loop() {
    uint32_t agora = millis();
    if (g_loopback) return;
    while (LINK.available()) rx_byte((uint8_t)LINK.read());

    while (Serial.available()) {                          // comandos do monitor
        int ch = Serial.read();
        if (ch == 'L' || ch == 'l') loopback();
        else if (ch == 'R' || ch == 'r') { fase_zerar(); memset(&g_tot, 0, sizeof(g_tot)); g_tot.rtt_min_us = 0xFFFF; g_u_brk = g_u_frm = g_u_par = g_u_fifo = g_u_buf = 0; Serial.println("[contadores zerados]"); }
        else if (ch == 'S' || ch == 's') { if (g_fase_ativa) relatorio(false); else Serial.println("[sem fase ativa ainda]"); }
    }

    if (sou_w1()) {                                       // W1 manda o ritmo das fases
        if (!g_fase_ativa) {
            if (agora - g_t_fase_tx >= 100) { g_t_fase_tx = agora; uint8_t a = g_fase; quadro_enviar(T_FASE, g_seq_tx++, &a, 1); }
        } else {
            if (agora - g_t_keep >= 2000) { g_t_keep = agora; uint8_t a = g_fase; quadro_enviar(T_FASE, g_seq_tx++, &a, 1); }   // mantem a W2 sincronizada
            if (agora - g_fase_t0 >= (uint32_t)T_FASE_S * 1000UL) { fase_encerrar(); g_fase++; g_fase_ativa = false; g_t_fase_tx = 0; }
        }
    }

    if (g_fase_ativa && sou_iniciador()) {                // iniciador: manda OI e confere a RESP
        if (g_pend && (agora - g_pend_ms) >= TMO_RESP_MS) {
            if (!g_pend_falha) { g_c.tmo++; evento("timeout (sem resposta ao seq %u)", g_pend_seq); falha(); }
            g_pend = false;
        }
        if (!g_pend && (agora - g_t_ult_oi) >= PERIODO_OI_MS) {
            g_t_ult_oi = agora;
            g_pend_seq = g_seq_tx++; g_pend_patid = g_pend_seq % 7; g_pend_patlen = 8 + (g_pend_seq % 4) * 8;
            padrao_gerar(g_pend_patid, g_pend_seq, g_pend_pat, g_pend_patlen);
            g_pend = true; g_pend_falha = false; g_pend_ms = agora; g_pend_us = micros();
            g_c.enviados++;
            oi_ou_resp_enviar(T_OI, g_pend_seq, g_pend_patid, g_pend_patlen, g_pend_pat);
        }
    }

    if (g_fase_ativa && (agora - g_t_rel) >= REL_PERIODO_MS) { g_t_rel = agora; relatorio(false); }
}
