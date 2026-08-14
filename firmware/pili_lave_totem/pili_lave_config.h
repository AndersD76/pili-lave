/************************************************************
 * PILI LAVE - Configuração do firmware
 * ----------------------------------------------------------
 * Edite este arquivo antes de gravar cada placa.
 * O MESMO sketch serve para as duas placas; mude apenas
 * PILI_LAVE_ROLE (e, se quiser, o resto fica igual).
 ************************************************************/
#ifndef PILI_LAVE_CONFIG_H
#define PILI_LAVE_CONFIG_H

/* ================= PAPEL DESTA PLACA =================
 * 1 = TOTEM   (interface cliente/lavador + pagamento)
 * 2 = MÁQUINA (recebe a liberação e inicia a lavagem)   */
#define PILI_LAVE_ROLE  1

/* ================= WIFI =================
 * O TOTEM precisa de internet (API Asaas).
 * A MÁQUINA não precisa de internet, mas conectar as duas
 * no MESMO roteador garante que fiquem no mesmo canal WiFi
 * (exigência do ESP-NOW). Se a máquina ficar sem WiFi, ela
 * escaneia o SSID abaixo só para descobrir o canal.        */
#define PILI_WIFI_SSID  "SUA_REDE_WIFI"
#define PILI_WIFI_PASS  "SUA_SENHA_WIFI"

/* ================= ASAAS =================
 * Sandbox (testes):  https://api-sandbox.asaas.com/v3
 * Produção:          https://api.asaas.com/v3
 * A chave é gerada no painel Asaas em Integrações > API.   */
#define PILI_ASAAS_BASE_URL  "https://api-sandbox.asaas.com/v3"
#define PILI_ASAAS_API_KEY   "COLE_AQUI_SUA_CHAVE_ASAAS"

/* Cliente Asaas usado nas cobranças do totem.
 * Opção A: crie um cliente "Totem" no painel e cole o id
 *          (ex.: "cus_000005113026") em PILI_ASAAS_CUSTOMER_ID.
 * Opção B: deixe "" e o firmware cria automaticamente um
 *          cliente com o nome/CPF-CNPJ abaixo na primeira
 *          venda e guarda o id na memória flash.           */
#define PILI_ASAAS_CUSTOMER_ID    ""
#define PILI_ASAAS_CUSTOMER_NAME  "Totem Pili Lave"
#define PILI_ASAAS_CUSTOMER_CPF   "00000000000"   // CPF/CNPJ válido do dono da conta

/* Forma de cobrança dos botões de cartão.
 * O totem não tem maquininha: o cartão é pago pelo CELULAR
 * do cliente, via QR do checkout Asaas (invoiceUrl).
 * CREDIT_CARD = só cartão | UNDEFINED = cliente escolhe no checkout */
#define PILI_BILLING_DEBITO   "UNDEFINED"
#define PILI_BILLING_CREDITO  "CREDIT_CARD"

/* ================= PROGRAMAS DE LAVAGEM =================
 * Preço em CENTAVOS, duração em MINUTOS.                   */
#define PILI_PROG1_NOME  "Simples"
#define PILI_PROG1_PRECO 1500
#define PILI_PROG1_MIN   15
#define PILI_PROG2_NOME  "Completa"
#define PILI_PROG2_PRECO 2500
#define PILI_PROG2_MIN   25
#define PILI_PROG3_NOME  "Premium"
#define PILI_PROG3_PRECO 4000
#define PILI_PROG3_MIN   35
#define PILI_PROG4_NOME  "VIP"
#define PILI_PROG4_PRECO 5500
#define PILI_PROG4_MIN   45

/* ================= LAVADOR =================
 * PIN numérico pedido quando o operador escolhe "Lavador". */
#define PILI_LAVADOR_PIN  "1234"

/* ================= PAGAMENTO =================            */
#define PILI_PAY_POLL_MS      3000    // intervalo de consulta do status
#define PILI_PAY_TIMEOUT_S    300     // desiste do QR após 5 min
#define PILI_DONE_AUTOHOME_S  12      // tela "liberada" volta ao início

/* ================= MÁQUINA (ROLE=2) =================
 * GPIO que dispara o início da lavagem (relé/CLP).
 * GPIO6 = pino "AD" do conector "Sensor AD" da Waveshare
 * ESP32-S3-Touch-LCD-7 (3V3 | GND | AD).                  */
#define PILI_RELAY_GPIO       6
#define PILI_RELAY_ATIVO_ALTO 1       // 1 = pulso HIGH, 0 = pulso LOW
#define PILI_RELAY_PULSO_MS   1000    // duração do pulso de partida

/* ================= BACKEND (opcional) =================
 * Se preenchido, o totem envia um POST JSON a cada evento
 * (lavagem liberada / registrada) para o seu sistema:
 *   { "evento":"lavagem", "origem":"cliente|lavador",
 *     "tipo":1..4, "programa":"...", "valorCent":1500,
 *     "pagamento":"pix|debito|credito|nenhum",
 *     "paymentId":"pay_xxx", "seq":123 }
 * Deixe "" para desativar.                                 */
#define PILI_BACKEND_URL    ""
#define PILI_BACKEND_TOKEN  ""

/* ================= AVANÇADO =================             */
#define PILI_NTP_TZ_OFFSET  (-3 * 3600)   // America/Sao_Paulo
#define PILI_HTTP_TIMEOUT_MS 15000
#define PILI_START_RETRY_MS  5000   // reenvio do START enquanto sem ACK

#endif // PILI_LAVE_CONFIG_H
