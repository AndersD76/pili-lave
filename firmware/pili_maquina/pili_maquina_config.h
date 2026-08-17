/************************************************************
 * PILI LAVE — Máquina (ESP32 + CLP + lâmpada bicolor)
 * ----------------------------------------------------------
 * Edite este arquivo antes de gravar a placa.
 * Um ESP32 por máquina; cada um com seu DEVICE_KEY próprio
 * (multi-máquina pronto — o backend resolve pela chave).
 ************************************************************/
#ifndef PILI_MAQUINA_CONFIG_H
#define PILI_MAQUINA_CONFIG_H

/* ================= WIFI ================= */
#define PILI_WIFI_SSID  "SUA_REDE_WIFI"
#define PILI_WIFI_PASS  "SUA_SENHA_WIFI"

/* ================= BACKEND ================= */
/* URL base SEM barra no final. Ex.: "https://pili-lave.up.railway.app" */
#define PILI_API_BASE   "https://SEU_APP"
/* Machine.deviceKey desta máquina (seed cria a primeira; ver painel/DB) */
#define PILI_DEVICE_KEY "dev_xxxxxxxx"

/* ================= TEMPOS ================= */
#define PILI_HB_MS        10000UL   // heartbeat: a cada 10 s
#define PILI_FAILSAFE_MS  60000UL   // sem 200 OK por 60 s -> lâmpada OFF
#define PILI_RETRY_MS      5000UL   // reenvio da fila de eventos
#define PILI_HTTP_TIMEOUT 15000     // timeout HTTP (ms)

/* ================= GPIO — CLP ================= */
/* Pulso que dispara o início do ciclo no CLP (relé). */
#define PILI_RELAY_GPIO       6
#define PILI_RELAY_ATIVO_ALTO 1     // 1 = pulso HIGH, 0 = pulso LOW
#define PILI_RELAY_PULSO_MS   1000

/* X14 — sensor de entrada do CLP (mesma linha que dispara
 * AUTO_AGUARDA_CARRO -> AUTO_CARRO_ENTRANDO). Via optoacoplador. */
#define PILI_X14_GPIO         7
#define PILI_X14_ATIVO_ALTO   1     // nível quando o carro está presente
#define PILI_X14_DEBOUNCE_MS  300

/* Saídas do CLP lidas pelo ESP32 (via optoacoplador).
 * Use -1 para "não ligado": DONE cai no timer interno (duracaoSeg do
 * backend) e ERRO fica desativado. LIGUE OS DOIS assim que possível —
 * o timer interno é só um fallback de bancada. */
#define PILI_CLP_DONE_GPIO    8     // AUTO_CONCLUIDO
#define PILI_CLP_DONE_ATIVO   1
#define PILI_CLP_ERRO_GPIO    9     // AUTO_ERRO
#define PILI_CLP_ERRO_ATIVO   1

/* ================= GPIO — LÂMPADA BICOLOR ================= */
/* Uma lâmpada, dois canais (relé verde + relé vermelho). */
#define PILI_LAMP_G_GPIO      10
#define PILI_LAMP_R_GPIO      11
#define PILI_LAMP_ATIVO_ALTO  1
#define PILI_LAMP_BLINK_MS    500   // meio período do pisca (1 Hz)

#endif // PILI_MAQUINA_CONFIG_H
