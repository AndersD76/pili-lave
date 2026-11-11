#pragma once
// Redirecionamento: maquina_estados.h inclui "nvs_manager.h", mas as unicas
// funcoes NVS que ele usa (nvs_get_last_res_id/nvs_inc_prog*) agora sao
// stubs em controle.h — a NVS "de verdade" (saldo, licenca, contadores)
// continua no display. So existe pra satisfazer o #include.
