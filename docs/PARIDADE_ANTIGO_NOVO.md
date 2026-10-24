# Paridade: firmware antigo (`lava_car_485/`, display mestre) x novo (`testes/`, W1 mestre)

Análise de 2026-10-24, feita lendo o código dos dois e o `GUIA_TECNICO_COMPLETO.md`. Serve para decidir **o que falta** antes de o novo
poder substituir o antigo. Legenda: ✅ já tem · ⚠️ tem pela metade / não rodou · ❌ não tem.

## 1. Arquitetura

| | Antigo | Novo |
|---|---|---|
| Quem manda na máquina | **Display** (máquina de estados no display) | **W1** (máquina de estados na W1) |
| W1 / W2 | Só E/S, por Modbus RS-485 | W1 mestre; W1↔W2 por ESP-NOW; **RS-485 só com o Delta** |
| Display | Mestre + tela + nuvem (via câmera) | **Cliente fino**: tela e comandos por ESP-NOW |
| SAJ | No RS-485 | Fora do RS-485 (frequência fixa), até o filtro chegar |
| Se o display travar/apagar | A máquina para | A máquina continua e o **painel físico** (X1..X6) opera |
| Falha única crítica | Display ou barramento RS-485 | **W1** |

Motivo da mudança: o ruído do RS-485 (inversor SAJ) derrubava a comunicação; tirando o SAJ do barramento e deixando só o Delta, a taxa de falha caiu
de 71–80% para 0–9%.

## 2. O novo já faz (e o antigo não fazia)
- Segurança do giro/carrinho: comando de parada com prioridade, falhas de escrita no Delta viram erro, saídas da W2 desligadas no boot e conferência comandado × real.
- Homem-morto no manual, HOME e INICIAR protegidos, modo SEM/COM X10, padrão ao ligar COM X10 + BOMBA ON.
- Painel físico e controle remoto operando sem o display; aviso de fim de ciclo; saídas manuais; BOMBA TESTE.
- Configuração persistente na W1 (velocidades, esperas por etapa, atrasos, giro, sequência dos modelos), planilha por tipo (presencial/app/sócio/bônus), acerto local.
- Luzes da máquina (DO7), pressão da água por processo (pronta para quando o SAJ voltar), Cera d'água = Spray.
- Migração de canal de rádio explícita (display → câmera → W1/W2), com rollback — **lado da câmera ainda não feito**.

## 3. O antigo fazia e o novo AINDA NÃO faz

> **Atualização de 2026-10-24 (tarde):** os itens 1 a 7 e 10 abaixo agora estão **escritos e compilados** (display `nuvem_display.h` + W1 `nuvem_w1.h` só operação, câmera v5), **mas nada foi gravado nem testado**. Falta o item 8 (cadastro da máquina). Ver `testes/PENDENCIAS_NA_MAQUINA.md`.

### 3.1 Para o novo substituir o antigo (bloqueantes)
| # | Função do antigo | No novo | O que falta |
|---|---|---|---|
| 1 | **Início de lavagem pelo app** (reserva paga → comando `start` com `reservationId` no heartbeat → `auto_iniciar`) | ❌ | Receber `start` da câmera e iniciar o ciclo na W1, guardando a reserva |
| 2 | **Heartbeat para a nuvem** (estado FREE/WASHING a cada 5 s e resposta `MSG_HB_RESP`: luz, licença, `start`, aspirador) | ❌ | Quem fala com a câmera: W1 ou display? Hoje só o display fala com ela, e só de Wi-Fi |
| 3 | **Eventos para o backend** (carro entrou, lavagem concluída, falha), com **fila na NVS e ACK** para nunca perder débito/comissão | ❌ (são funções vazias `backend_evt_*`) | Reimplementar na W1 |
| 4 | **Origem da lavagem** (app × presencial) alimentando a nuvem | ⚠️ conta por tipo só localmente | Mandar ao backend e usar o `source` correto |
| 5 | **Licença/bloqueio** (aviso 40 d, bloqueio 50 d sem pagar; 15 d sem comunicação) | ❌ (`licenca_bloqueada()` sempre falso) | Portar `licenca.h` |
| 6 | **Lâmpada do app** (`lightState`, prioridades) e **vermelho piscando em erro** | ⚠️ verde/vermelho só nos estados do ciclo; sem erro piscando; sem estado do app | Portar `lampada_app.h` |
| 7 | **Aspirador (DO8) pelo app** (`vacuum_seg`) | ⚠️ só existe o macro `SET_ASPIRADOR` | Ligar ao heartbeat |
| 8 | **Cadastro da máquina** (NOVA, trocou display, trocou câmera, `deviceKey`) | ❌ | Portar `tela_boot.h` e a identidade |
| 9 | **Recuperação no boot** (HOME automático depois de queda de energia, com lâmpadas) | ⚠️ **ligada em 2026-10-24 (compilada, não gravada)**; antes `recuperacao_tick()` nunca era chamada | **Gravar e testar na máquina** (a queda de energia de 2026-10-23 mostrou que importa) |
| 10 | **Câmera**: aceitar "vai para o canal N", responder "oi", re-sync automático | ❌ | Firmware da câmera (em andamento) |

### 3.2 Importantes, mas não bloqueantes
- Alarme "câmera sem contato" (60 s) no display; o da W2 já existe.
- OTA do display via relay da câmera (já estava pendente no antigo).
- **Hard reset único no boot do display** (o antigo reiniciava o chip uma vez para evitar tela branca no boot frio): o display novo não tem. Verificar se aparece tela branca.
- "Horas no manual" (contador persistente e tela): só existe a variável.
- Diagnóstico completo dos 16 sensores na tela manual (hoje a TECNICO mostra a maior parte).
- Tela Config da produção com atraso inicial, tempos de espuma, sobrecarga: não são usados no novo (omitidos de propósito).

## 4. Riscos do desenho novo (para decidir com os olhos abertos)
1. **A W1 virou ponto único de falha.** Se ela travar, nada opera (antes o display era esse ponto). Mitigação: o painel físico e o watchdog dela; o RS-485 agora só tem o Delta.
2. **O código novo da W1 é bem mais jovem** que o antigo (que rodou em produção). Falta tempo de bancada: o primeiro ciclo completo com carro só foi feito hoje.
3. **A lógica de canal é crítica e ainda não foi testada com a câmera.** Se ela falhar, display, W1 e W2 podem ficar em canais diferentes (já aconteceu hoje: a W2 foi arrastada para o canal 6).
4. A "fila esperando" para as luzes e para o app **ainda não chega à máquina** (depende dos itens 1 e 2).
5. A senha do banco de produção está em `server/lib/prisma.ts` e já está no GitHub: trocar no Neon e remover o fallback.

## 5. Decisão arquitetural que destrava os itens 1–7
**Quem conversa com a câmera: a W1 ou o display?**
- **W1 fala com a câmera** (recomendado): os eventos de ciclo nascem na W1, então ela os envia com a fila na NVS. Não depende do display estar ligado. O display fica só com tela e a configuração de Wi-Fi.
- **Display faz de ponte**: menos mudança na câmera, mas todo evento passa pelo display; se ele estiver desligado, o débito do app não sai.
Em qualquer caso a câmera precisa aceitar a W1 como interlocutora (hoje ela só fala com o display).

## 6. Ordem sugerida
1. **Sem câmera, na máquina:** ligar e testar a recuperação de boot; luz vermelha piscando em erro; hard reset do display; horas no manual.
2. **Câmera + protocolo:** canal (firmware da câmera), depois heartbeat, `start` do app, eventos com fila e ACK, licença, lâmpada, aspirador.
3. **Cadastro da máquina** (nova / trocou display / trocou câmera).
4. Só então: validar tudo em conjunto e decidir se `testes/` substitui `lava_car_485/`.
Até o item 2 estar pronto e testado, **o antigo continua sendo o firmware de produção do app**; o novo roda bem para operação local.
