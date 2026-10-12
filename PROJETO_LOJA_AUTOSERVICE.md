# Projeto Loja de Conveniência Autoservice — Container

> Atualizado em 12/10/2026 com as decisões tomadas na discussão com o Claude Code.
> Onde este documento e uma versão anterior divergirem, vale este.

## Conceito

Loja de conveniência em container (6 m x 2,4 m), sem caixa humano. O cliente
entra pelo app Pili, pega os produtos, passa no totem de autoatendimento, paga
e sai. Câmeras auditam o que saiu das prateleiras contra o que foi pago.

A loja roda **no mesmo app e no mesmo backend do Pili Clean** (lava-rápido),
como produto paralelo. Ao abrir o app, o cliente escolhe entre
**"Loja conveniência"** e **"Lavagem expressa"**. A lavagem continua como está.

---

## Decisões fechadas

### App e cadastro
- Tela inicial com as duas opções (loja / lavagem).
- **Termo de uso obrigatório** para usar o app. Quem já tem conta aceita na próxima vez que abrir.
- **Data de nascimento** no cadastro (para o indicador de faixa etária).
- **Código único do cliente** (numérico), usado para registrar a entrada na loja.
- **Foto do rosto obrigatória ao escolher "Loja conveniência"** pela primeira vez, com autorização específica de uso da imagem. Quem usa só a lavagem não precisa da foto.
- E-mail obrigatório (já é o login atual). A nota fiscal será enviada por e-mail.
- O app nativo (com BLE) está em processo de publicação nas lojas. A PWA continua atendendo a lavagem.

### Entrada
- Só pelo app, por **BLE**. Sem reconhecimento facial na porta, sem catraca, sem tag.
- **Funciona sem internet**: o app apresenta o código do cliente mais uma credencial assinada pela nuvem (renovada sozinha quando há internet); o computador local confere sem precisar de rede.
- Cada abertura libera **uma pessoa** (mais as crianças declaradas) e cria uma **visita**.
- **Capacidade máxima: 3 pessoas por vez**, com aviso fixado na porta. Loja cheia: o app mostra "Ocupação máxima esgotada, aguarde". Essa resposta vem do computador local **por BLE**, porque pode não haver internet.
- Acompanhantes: o app pergunta "Entrando com criança(s)?" — Não / Sim 1 / Sim 2. Adulto não declarado = alarme.
- **Bloqueio pelo dono**: o dono da loja pode bloquear a entrada de um cliente por problema de conduta, pelo app, informando o código do cliente e o motivo. O cliente não vê o motivo; vê que está bloqueado e a orientação de falar com o suporte.
- **Suporte**: o cliente escreve num formulário no app, a mensagem chega no app do dono (com aviso), e o dono responde por lá em até 24 h.
- **Dono de loja**: papel pedido pelo usuário no cadastro ou no perfil e aprovado pelo admin, como já acontece com o lavador. Depois de aprovar, o admin vincula a loja ao dono no painel.

### Interior e auditoria
- Câmeras IP PoE no teto, apontadas para as prateleiras.
- **SKU-110K só para presença/ausência** de produto na prateleira, não para classificar.
- Auditoria por **comparação de prateleira por zona** (o que sumiu de cada zona, e quando).
- Rastreamento de pessoas só por câmera (YOLO + ByteTrack). **BLE interno descartado** (container metálico).
- **UWB retirado da primeira versão**; fica registrado para implementação futura.
- A auditoria não depende de saber com certeza quem pegou cada item:
  - evento com uma única visita na zona é atribuído a ela;
  - evento com duas visitas na mesma zona fica marcado como ambíguo e não gera aviso no totem;
  - **fechamento por período** (de loja vazia até loja vazia): o total que saiu das prateleiras tem que bater com o total pago por todas as visitas.
- **Qualquer divergência de estoque avisa o dono da loja com as imagens do momento.**
- Cobrança automática nunca acontece por divergência sem dono claro; vai para revisão do dono.

### Totem (self-checkout)
- Produto identificado **só pelo código de barras**.
- **Identificação do cliente por reconhecimento facial** na câmera do totem, comparando apenas entre as pessoas que estão dentro da loja naquele momento (no máximo 3). Sem rosto na imagem: "Fique em frente à tela para reconhecimento facial".
- O computador local mantém, em segundo plano, uma cópia atualizada do banco de imagens dos clientes, para ter a foto mesmo sem internet.
- Sem imagem para conferir: o totem pergunta "Você é: João, Maria ou Pedro?" (as pessoas que estão dentro) e a pessoa indica quem é. **A escolha do nome não fecha a compra sozinha**: abre uma confirmação no app daquela pessoa, e é ela que finaliza o pagamento. Assim ninguém gasta o saldo de outro tocando no nome dele.
- As imagens dos clientes guardadas no computador local ficam **criptografadas** (ver "Proteção das imagens no computador local").

### Pagamento
- Gestão pelo computador central da loja.
- **Com internet**: desconta dos créditos da carteira do app, ou paga na maquininha, à escolha do cliente.
- **Sem internet**: só maquininha. A venda fica na fila local e sincroniza quando a conexão voltar.
- A maquininha fica ligada ao computador central (integração local, com chip próprio), para o sistema saber se foi pago pelo app ou pelo cartão.

### Saída
- Porta com barra antipânico ou botão de emergência: **abre sempre por dentro**, com ou sem pagamento.
- Saída sem pagamento é registrada e notifica o dono. Ninguém fica preso.

### Cadastro da loja
- **Mesma lógica da máquina de lavagem**: no primeiro uso, o computador central da loja gera a própria identidade e o técnico busca a cidade, escolhe um endereço que já existe (outra loja ou uma unidade de lavagem no mesmo lugar) ou digita um novo. O endereço digitado é comparado ignorando acento, maiúscula e "Rua/Av.", para não duplicar.
- Loja nova nasce **fechada e sem dono**. O admin define o dono e abre a loja no painel quando ela estiver pronta.
- Trocar o computador de uma loja que já tem um vinculado pede confirmação (equivale ao "trocou o display" da lavagem).
- O cadastro manual no admin continua existindo como alternativa.

### Usuários do computador da loja
- A tela principal do computador é sempre **a do cliente** (o caixa). Num canto fica o botão **"Acesso administrativo"**, que pede usuário e senha.
- **Lojista**: o dono da loja, definido pelo admin. Tem acesso total. Entra com o e-mail e a senha do app; com internet, quem confere é o servidor, e sem internet vale a senha guardada no último acesso.
- **Funcionário**: cadastrado pelo lojista no próprio computador, com as permissões que ele marcar. Hoje: cadastrar e editar produtos, alterar preço de venda, dar entrada de mercadoria (manual e por nota), registrar perda, fazer contagem de inventário, ver relatórios. Outras entram conforme o programa cresce.
- **Toda ação fica registrada** com quem fez, quando e o quê (inclusive o valor antes e depois, em preço e cadastro). Só o lojista vê o registro, e ninguém edita nem apaga.
- A sessão dura 30 minutos, porque a máquina fica na frente dos clientes.
- Tirar uma permissão ou desativar um funcionário vale na hora, mesmo que ele esteja logado.

### Reposição de estoque e abertura remota (a construir com a porta e as câmeras)
- **Modo reposição**: o funcionário entra pelo app como qualquer pessoa, faz o acesso administrativo no computador e inicia a reposição. É uma permissão própria ("Fazer reposição"), marcada pelo lojista.
- **Durante a reposição a loja fica bloqueada para clientes.** Quem tentar entrar vê no app: "Em reposição de estoque. Por favor aguarde um pouco". Como a mensagem de lotação, ela vem do computador local por BLE.
- Tudo o que mudar nas prateleiras nesse período é atribuído a quem está repondo e não gera aviso de divergência. Início e fim ficam no registro de atividades.
- **Abertura remota da porta**: só o lojista, pelo app (entregador sem cadastro, cliente que precisa voltar). Cada abertura fica registrada no nome dele.

### Gestão
- **Cada loja tem gestão própria e independente no computador local**: itens cadastrados, estoque, entrada de mercadoria, estoque mínimo, alerta de compra.
- A nuvem guarda usuário, carteira e as vendas sincronizadas. O app mostra **indicadores** para o dono (faturamento, itens mais vendidos, faixa etária de consumo e outros a definir).
- **Backup diário** do banco local para a nuvem.
- Nota fiscal: loja e lavagens vão emitir, enviada por e-mail. O formato está em discussão com o contador e será implementado depois.

### Desenvolvimento
- Tudo é construído e testado **apenas na rede local**, sem mexer no que está em produção (banco de produção e Railway intocados).
- Segue os mesmos moldes do app da lavagem (Next.js + Prisma no servidor, Expo no app nativo). Python fica só com as câmeras.

---

## Proteção das imagens no computador local

Plano para a etapa 6 (rostos de todos os clientes num equipamento que pode ser furtado):

1. **Disco inteiro criptografado** com o BitLocker do Windows, preso ao chip TPM da placa-mãe: o disco tirado do computador não abre em outra máquina.
2. **Banco de imagens criptografado à parte** (AES-256), com a chave guardada no cofre do Windows preso ao mesmo TPM, e não em arquivo ao lado dos dados.
3. **Guardar a "assinatura" do rosto em vez da foto** sempre que possível: são os números que o reconhecimento usa, e não dá para reconstruir a foto a partir deles. A foto só ficaria na nuvem.
4. **Só o necessário**: a cópia local traz apenas clientes que aceitaram a loja, e apaga quem cancelar a conta ou a autorização na sincronização seguinte.
5. **Apagar à distância**: se a loja for dada como furtada, a nuvem deixa de entregar dados para aquela chave e manda apagar o banco local no próximo contato.

O item 1 depende de o computador da loja ter Windows Pro e TPM, o que deve entrar na escolha do equipamento.

---

## Pontos em aberto

1. **Maquininha**: Stone ou Cielo, escolhida pelo critério de integração local com o computador.
2. **Leitor de código de barras**: DT008 vs EVAWGIB vs GM66.
3. **Texto jurídico** do termo de uso e da política de privacidade (o app hoje mostra um rascunho) e da autorização de biometria — revisão de advogado.
4. **Contador**: NFC-e da loja, NFS-e das lavagens, provedor de e-mail.
5. Saída de emergência e alvará: validar com bombeiros.
6. Proteção intelectual: revisar ao fim do projeto.
7. Como o dono identifica quem bloquear: hoje é pelo código do cliente digitado; quando houver registro de visitas e divergências (etapas 4 e 5), o bloqueio poderá ser feito direto a partir delas.

---

## Ordem de construção

| # | Etapa | Situação |
|---|---|---|
| 1 | **Nuvem e app**: termo de uso, data de nascimento, código do cliente, foto do rosto, tela de escolha, cadastro de lojas no admin, dono de loja, bloqueio e suporte | Construída no ambiente local; falta testar no celular |
| 2 | **Gestão local**: produtos, estoque, entrada de mercadoria, alerta de compra | Construída, exceto a leitura de nota em PDF: primeiro uso, usuários com permissões, registro de atividades, painel, produtos e estoque, entrada por nota fiscal em XML e relatórios por período com planilha. O PDF fica para quando houver uma nota real para calibrar; o aviso de estoque mínimo no celular depende da sincronização |
| 3 | **Totem**: carrinho por código de barras, carteira e maquininha, fila offline e sincronização | Em andamento (priorizado em 12/10, antes da nota fiscal): carrinho por código de barras, fechamento da venda e baixa de estoque prontos, com **pagamento simulado**; faltam carteira, maquininha, identificação do cliente e sincronização |
| 4 | **Entrada**: porta por BLE, credencial offline, capacidade, mensagem de lotação (firmware da trava: Giovani) | A fazer |
| 5 | **Câmeras**: zonas de prateleira, rastreamento, divergência com imagens para o dono | A fazer |
| 6 | **Reconhecimento facial no totem** e cópia local do banco de imagens | A fazer |
| 7 | **Indicadores** no app e no admin; nota fiscal quando o contador definir | A fazer |

### Etapa 1 — o que já existe (branch `loja-conveniencia`, só banco local)

Feito no servidor e na PWA:
- Banco: `User.codigoCliente`, `User.nascimento`, `User.termosVersao`, `User.termosAceitosEm` e a tabela `FotoRosto` (migration `20261011150000_loja_cadastro_cliente`, aplicada só no Postgres local).
- `POST /api/termos` (aceite, exige data de nascimento) e `POST /api/me/foto` (foto com autorização específica).
- `/api/me`, login e cadastro devolvem `codigoCliente`, `nascimento`, `termosAceitos`, `temFoto`.
- A foto do rosto é conferida por IA antes de ser aceita: precisa ser uma pessoa só, de frente, com o rosto visível. Sem a chave da IA configurada (caso do ambiente local hoje), a foto é aceita e fica marcada como "não conferida".
- Telas da PWA: `/app/escolha`, `/app/termos`, `/app/loja`, `/app/loja/foto`; data de nascimento no cadastro. Testadas no servidor local (chamadas da API e carregamento das páginas).
- As mesmas telas no app nativo (`mobile/`: `escolha`, `termos`, `loja`, `loja-foto`). O código compila, mas **ainda não foi testado num celular**.

- Banco: tabelas `Loja`, `LojaBloqueio`, `LojaMensagem` e o tipo `DONO_LOJA` nos pedidos de papel (migration `20261012100000_loja_dono_bloqueio`, só no Postgres local).
- Admin: `/admin/lojas` (cadastrar loja, capacidade, dono, abrir/fechar); pedido de Dono de loja aparece em `/admin/usuarios` para aprovar.
- App (PWA e nativo): lista de lojas na home da loja, com aviso de bloqueio e formulário de suporte; área **"Minha loja"** do dono, com mensagens para responder e bloqueio/desbloqueio de clientes; opção "Sou dono de loja" no cadastro e no perfil.
- Auto-cadastro da loja: `GET /api/loja/unidades?cidade=` e `POST /api/loja/provisionar` (migration `20261012150000_loja_provisionamento`, só no Postgres local). A tela de primeiro uso que chama essas rotas será feita na etapa 2, junto com o programa do computador da loja.
- Testado no servidor local de ponta a ponta: pedido e aprovação do dono, bloqueio pelo código, mensagem de suporte, resposta, desbloqueio, e as recusas (quem não é dono não bloqueia, não responde e não desbloqueia).

Falta na etapa 1:
- Testar o app nativo no celular (principalmente a tela da foto e a área do dono).
- Aplicar as quatro migrations em produção quando for a hora (não foi feito).

### Etapa 2 — especificação do programa do computador da loja

Parte do prompt original de controle de estoque (feito no Claude web), ajustada às decisões acima.

**O que foi mantido do prompt original**
- Banco local no próprio computador (SQLite), criado sozinho na primeira execução.
- Cadastro de produtos com código de barras, custo, preço de venda, estoque atual e estoque mínimo.
- Entrada de mercadoria por nota fiscal, com tela de conferência dos itens antes de dar entrada.
- Produto que não existe é criado na entrada, com estoque mínimo padrão de 5.
- Baixa por venda, perda e ajuste de inventário.
- Alerta de produtos abaixo do mínimo e relatórios (estoque, críticos, entradas e saídas por período).
- Interface web local, em português.

**O que mudou**
| Prompt original | Como fica | Por quê |
|---|---|---|
| Python + Flask + Bootstrap | Next.js + Prisma, com o mesmo visual do painel admin | Mesmos moldes do resto do sistema; o totem (etapa 3) reaproveita tudo. Python fica só com as câmeras. |
| Abre direto no painel | **Primeiro uso**: escolhe o endereço da loja (existente ou novo). Depois, a tela principal é a do cliente | Cadastro da loja com a mesma lógica da máquina de lavagem. |
| Sem senha | Gestão com usuário e senha por pessoa (lojista e funcionários com permissões) e registro de tudo o que cada um faz | O computador fica num container; o totem roda na mesma máquina, e é preciso saber quem fez cada lançamento. |
| Tabela `saidas` | Tabela única de **movimentações** (entrada, venda, perda, ajuste), com o saldo depois de cada uma | É o extrato do estoque, no mesmo padrão do extrato da carteira; permite auditar e sincronizar. |
| Leitura de **PDF** da NF-e | **XML da NF-e como forma principal**; PDF como alternativa, sempre com conferência | O PDF (DANFE) normalmente não traz o código de barras dos produtos, só o código interno do fornecedor. O XML traz. |
| Casar item da nota pelo EAN | Pelo EAN quando existir; senão, o sistema **lembra** qual produto corresponde a cada código daquele fornecedor | Na segunda nota do mesmo fornecedor a conferência já vem preenchida. |
| Produto criado pela nota já pode ser vendido | Nasce **sem preço de venda** e aparece em destaque até o preço ser definido | A nota traz o custo, não o preço de venda. |
| Valores em reais com vírgula | Valores guardados em centavos (inteiros) | Evita erro de arredondamento; é como o resto do sistema guarda dinheiro. |
| 5 produtos de exemplo automáticos | Botão "carregar exemplos", só para teste | Uma loja de verdade não pode nascer com produto falso no estoque. |
| Mesma nota pode entrar duas vezes | A chave da NF-e é única: a segunda tentativa é recusada | Evita duplicar estoque. |

**O que fica para depois (já previsto no desenho)**
- Baixa automática pela venda no totem (etapa 3).
- Aviso de estoque mínimo no app do dono e indicadores, que dependem da sincronização com a nuvem (etapas 3 e 7).
- Backup diário para a nuvem.

**Onde fica**: pasta `loja/` do repositório, rodando no computador da loja em `http://localhost:3100`.

---

## Hardware

### Comprado
- 4x ESP32-S3 N8R2 com antena IPEX — R$ 33,89 cada. Com o BLE interno descartado: 1 para trava e sirene da porta, os demais como reserva.

### A comprar
| Item | Modelo | Qtd | Preço unit. | Total |
|---|---|---|---|---|
| Câmera IP PoE (teto) | Intelbras VIPC 1230 D G2 | 3 (6 m) | R$ 180 | R$ 540 |
| Switch PoE 16 portas | TP-Link TL-SG1016P | 1 | R$ 450 | R$ 450 |
| Tablet entrada | Android 10" anti-vandal | 1 | R$ 1.200 | R$ 1.200 |
| Monitor touchscreen 15" | K-Mex LP-1503 | 1 | R$ 1.400 | R$ 1.400 |
| Leitor código de barras | EVAWGIB 2D-CMOS-USB | 1 | R$ 137 | R$ 137 |
| Mini PC totem | Intel i5 SSD Windows | 1 | R$ 1.500 | R$ 1.500 |
| PC servidor central | RTX 4070 + i7 + 32GB RAM | 1 | R$ 8.000 | R$ 8.000 |
| Cabo ethernet Cat6 | Rolo 100m | 2 | R$ 200 | R$ 400 |
| Trava elétrica | Porta entrada + porta saída | 2 | R$ 150 | R$ 300 |
| Sensor infravermelho | Barreira de luz porta | 1 | R$ 80 | R$ 80 |
| Sirene 12V | — | 1 | R$ 50 | R$ 50 |
| ESP32 dedicado porta | ESP32 (trava + sirene) | 1 | R$ 30 | R$ 30 |
| Maquininha cartão | Stone ou Cielo | 1 | R$ 0 | R$ 0 |
| **Total estimado** | | | | **R$ 14.087** |

A revisar com as decisões acima: o tablet da entrada (sem reconhecimento facial na porta, pode bastar um ponto BLE com uma tela simples) e a câmera do totem para o reconhecimento facial.

### Câmeras e visão
- Intelbras VIPC 1230 D G2 (lente 2,8 mm, 99° horizontal, 55° vertical), no teto, em zigue-zague cruzado, cada ponto coberto por 2 câmeras.
- Container 6 m: 3 câmeras. Container 12 m: 6 câmeras.
- Câmeras em suporte travado, IP fixo, alerta se desalinhar.
- Software: Python 3.10 + OpenCV + Ultralytics YOLO, no computador central.

### Segurança da porta
- YOLO + sensor físico (barreira de luz) monitoram a porta; os dois precisam confirmar.
- Invasão: sirene imediata + notificação em loop no app do dono até confirmar a leitura, com o vídeo anexado.
- Sirene desliga 30 s após a pessoa sair do campo de visão; se voltar nesse intervalo, o contador reinicia.
- Log salvo localmente, independente de internet.

---

## Ambiente de desenvolvimento
- Notebook Giovani: Windows, Intel i7-8750H, 16GB RAM, NVIDIA GTX 1050 Ti 4GB.
- Python 3.10 + CUDA 11.8 + PyTorch GPU + OpenCV + Ultralytics YOLO instalados; YOLO testado pela webcam (`projetos/projeto YOLO/teste_webcam.py`).
- Servidor do app: `server/` com Postgres local (`pililave_dev`).

## Divisão de trabalho
- **Giovani**: firmware ESP32 (trava, sirene, BLE), hardware físico, cabeamento, supervisão geral.
- **Claude Code**: todo o software.
- **Freelancer Python**: banco de dados avançado + lógica de auditoria (estimativa R$ 8.000–15.000).

---
*Última atualização: 12/10/2026*
