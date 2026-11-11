# Guia do Administrador — PILI CLEAN

> Como usar o painel administrativo: acompanhar vendas, gerenciar usuários, definir preços, cadastrar lavadores e cuidar das máquinas.

**Endereço:** `https://pili-lave-production.up.railway.app/admin`

📸 *Cada seção abaixo tem um espaço `![...](imagens/admin/arquivo.png)` — quando for tirar os prints, salve com esse nome exato dentro de `docs/treinamento/imagens/admin/` que a imagem aparece sozinha aqui.*

---

## 1. Entrando no painel

Abra o endereço acima. Vai pedir **usuário** e **senha** (as credenciais que você já tem).

![Tela de login do admin](imagens/admin/01-login.png)

Depois de entrar, você cai na **Visão geral** — é a tela inicial do admin.

---

## 2. Visão geral (`/admin`)

Mostra o retrato da operação:
- Vendas de hoje, dos últimos 7 dias e dos últimos 30 dias.
- Lavagens resgatadas (concluídas) hoje e no mês.
- Recargas de saldo feitas pelos clientes.
- **Passivo**: quanto de saldo os clientes têm guardado (dinheiro que ainda vai ser usado).
- Total de usuários e veículos cadastrados.
- Lavagens por tipo de programa.
- Lista das últimas transações.

![Visão geral do admin](imagens/admin/02-visao-geral.png)

No topo, o menu vai te levar pras outras seções: **Lavagens**, **Usuários**, **Máquinas**, **Lojas**, **Preços**, **Repasses**.

---

## 3. Lavagens (`/admin/lavagens`)

No topo, uma tabela **por tipo de lavagem x origem**: **Presencial** (dinheiro nos botões da máquina), **App** (compra pela carteira), **Sócios** (mensalistas) e **Bônus** (promoção), com o total de cada coluna. Abaixo, as **últimas 300 lavagens de todas as origens**, misturadas por data, com:
- Quando foi feita e a **Origem** (etiqueta colorida).
- Cliente e placa (no app); nas presenciais/sócios/bônus aparece a máquina e o tipo.
- Programa e valor (sócio e bônus têm valor R$ 0,00).
- **Status**: 🟡 Aguardando (pagou, esperando usar) · 🟢 Concluída (é aí que o valor é debitado de verdade) · 🔴 Cancelada (estornada).
- Detalhe: quem resgatou no balcão ou o código do voucher (app).

![Tela de lavagens](imagens/admin/03-lavagens.png)

**Quando usar:** pra conferir se uma lavagem específica de um cliente foi processada, pra investigar reclamação ("paguei e não lavou") e pra ver quantas lavagens vieram de cada origem.

**Contadores diferentes (acerto):** o display da máquina é a referência. Se os números dele (por modelo: presencial, app, sócios, bônus, desde o último acerto) forem diferentes dos da nuvem em duas conferências seguidas (a cada ~15 min), chega o alerta **"Contadores diferentes"** e, no topo desta tela, aparece um cartão com a tabela **Display × Nuvem** e dois botões — **você escolhe qual lista vale**:
- **Usar a lista do display:** o que o display tem a mais em presencial, sócios e bônus é registrado agora como lavagem (presencial ao preço atual da unidade; sócio e bônus com valor R$ 0,00) e entra no fechamento. Diferenças no app, ou a nuvem ter mais que o display, ficam só como ajuste aceito: nada é apagado.
- **Manter a lista da nuvem:** o display continua com os números dele até o próximo acerto na máquina; o aviso é encerrado.

> ℹ️ As presenciais só são registradas na nuvem a partir de 02/11/2026; o contador por modelo do display da máquina (Presencial/Aplicativo/Sócios/Bônus) é de outra janela ("desde o último acerto") e pode ser maior. O fechamento financeiro por máquina continua na tela de **Máquinas** (seção 6).

---

## 4. Usuários (`/admin/usuarios`)

Lista todos os usuários cadastrados: telefone, nome, papel (Cliente/Lavador/Parceiro/Admin), saldo, quantas lavagens já fez, quantos veículos tem, e desde quando é cadastrado.

![Tela de usuários](imagens/admin/04-usuarios.png)

### Cadastros a aprovar

No topo dessa tela fica a seção **"Cadastros a aprovar"** — é aqui que aparecem os pedidos das pessoas que marcaram, no próprio app (no cadastro ou depois, pelo Perfil), que também são **Lavador**, **Vendedor 1**, **Vendedor 2** ou que **recebem aluguel** de alguma máquina.

- Cada linha mostra telefone, nome, **o tipo pedido** e a data do pedido.
- Uma mesma pessoa pode ter mais de um pedido pendente ao mesmo tempo (por exemplo: pediu Lavador e Aluguel juntos) — cada pedido é aprovado ou rejeitado **separadamente**, não em bloco.
- Clique em **Aprovar** ou **Rejeitar** na linha do pedido.
- Se rejeitar, a pessoa pode pedir de novo mais tarde pelo app.
- Enquanto o pedido está pendente, a pessoa continua usando o app normalmente como cliente — ela nunca fica travada esperando sua aprovação.

Um **número vermelho** ao lado do link "Usuários", no menu do topo, mostra quantos pedidos estão esperando aprovação — assim dá pra saber de longe que tem algo pra revisar.

![Cadastros a aprovar](imagens/admin/04b-cadastros-aprovar.png)

> ⚠️ Regra importante: aprovar um pedido nunca tira uma capacidade que a pessoa já tinha. Por exemplo, se ela já é Parceiro (por causa de um Aluguel aprovado antes) e agora você aprova o pedido de Lavador dela também, ela passa a ser Lavador **sem perder** o Aluguel — as duas coisas continuam valendo ao mesmo tempo.

### Filtrando por tipo de cadastro

Acima da lista de usuários tem abas: **Todos / Cliente / Lavador / Comissão 1 / Comissão 2 / Aluguel / Dono de loja / Admin**, cada uma com a contagem de pessoas. Clique numa aba pra filtrar a lista só por aquele tipo — útil quando a lista de usuários está grande e você quer achar, por exemplo, só quem recebe aluguel.

### Como promover alguém direto (sem esperar o pedido)

Se você já sabe que uma pessoa vai ser Lavador, Comissão 1, Comissão 2 ou Aluguel de uma máquina, não precisa esperar ela pedir pelo app — dá pra promover direto:

1. Encontre a pessoa na lista (pelo telefone ou nome).
2. Na coluna de ações, abra o dropdown de papel: **Cliente / Lavador / Parceiro**.
3. Se escolher **Parceiro**, um segundo campo aparece pra você escolher **qual tipo** de parceiro (Comissão 1, Comissão 2 ou Aluguel) — não dá mais pra deixar "Parceiro" sem especificar o tipo.
4. Salve. Agora essa pessoa já pode ser cadastrada como participante de uma máquina (seção 6).

![Promovendo um usuário direto pelo dropdown](imagens/admin/05-promover-lavador.png)

> ⚠️ O usuário precisa **já ter se cadastrado no app antes** (cadastro normal, com e-mail e senha) — o admin não cria a conta da pessoa, só muda o papel/capacidade de quem já existe.

> 💡 Ao promover direto pra **Lavador** ou **Parceiro** por esse atalho, o sistema já registra automaticamente o pedido correspondente como "Aprovado" — assim o Perfil da própria pessoa mostra certinho que ela tem aquela capacidade, em vez de continuar mostrando "Pedir" mesmo já promovida.

> 💡 O "app" citado aqui é, na prática hoje, o **PWA** (acessado pelo navegador) — o app de celular ainda não foi publicado nas lojas, então clientes, lavadores e parceiros usam o sistema pelo link no navegador. A barra de navegação de baixo do PWA tem a mesma estrutura do app de celular, incluindo as abas condicionais "Minha Máq." e "Comissões" pra quem tem a capacidade aprovada.

---

## 5. Preços (`/admin/precos`)

Essa aba só define o **nome** dos 4 tipos de lavagem (ex.: "Limpeza leve/Poeira", "Limpeza média/chassi"...) — o nome vale igual pra todas as unidades. **Não tem preço nenhum aqui.**

![Tela de preços — nomes dos tipos](imagens/admin/08-precos-nomes.png)

O valor em R$ de cada tipo é definido **dentro de cada unidade**, na tela de Máquinas (próxima seção) — porque cada unidade pode cobrar um valor diferente pela mesma lavagem.

---

## 6. Máquinas (`/admin/maquinas`)

A tela mais importante pro dia a dia. No topo, cards mostram o resumo: total de máquinas, quantas estão offline agora, quantas em manutenção, quantas com licença bloqueada.

![Cards de resumo no topo](imagens/admin/06-maquinas-resumo.png)

Embaixo, uma **aba por unidade** (endereço) — a primeira aba, **"Resumo geral"**, mostra o total de todas as unidades juntas, por tipo de lavagem.

![Abas por unidade](imagens/admin/06-maquinas-abas.png)

Quando uma unidade tem **mais de uma máquina**, aparecem sub-abas (Máquina 1, Máquina 2...) — clique pra ver cada uma separadamente.

![Sub-abas de máquinas na mesma unidade](imagens/admin/06-maquinas-subabas.png)

### Dentro de cada unidade

- **Preços da unidade**: os 4 tipos com um campo pra preencher o valor em R$ — cada unidade começa vazia, você define quanto ela cobra.
- **Status da máquina selecionada**: Livre / Lavando / OFFLINE (sem contato há mais de 1 min) / Manutenção, e a licença (🟢 em dia · 🟡 aviso 40+ dias · 🔴 bloqueada 50+ dias).
- **Valor acumulado desde o último fechamento** — soma tudo (presencial + app) desde a última vez que você clicou em "Marcar pago hoje".
- **Aspirador de pó** — checkbox "Esta máquina tem aspirador" + preço (R$) + duração (minutos). Só aparece como opção pro cliente no app nas máquinas onde isso estiver marcado (ver seção 6b).
- **Participação na máquina — Lavagens** — aqui você cadastra quem ganha o quê **nas lavagens** daquela máquina, em até 4 tipos: **Lavador**, **Comissão 1**, **Comissão 2** e **Aluguel**. Pra cada tipo, escolha a pessoa numa caixinha (só aparece quem já tem a capacidade correspondente aprovada) e informe o **percentual** dela. Clique em Salvar.
  - **Regra dos 100%**: a soma dos percentuais de todos os participantes cadastrados naquela máquina **nesse escopo** nunca pode passar de 100%. O que sobrar até 100% fica automaticamente com você (admin) — não precisa cadastrar nada pra isso, o sistema calcula sozinho.
  - Se você tentar salvar um percentual que estoura os 100% (somando com quem já está cadastrado), a tela mostra um aviso de erro e não deixa salvar — ajuste o número e tente de novo.
  - Só quem tem o papel de **Lavador** vê a máquina no app como "Minha Máquina" e recebe notificação automática se ela der erro. Comissão 1, Comissão 2 e Aluguel veem a máquina numa aba separada chamada "Comissões" no app deles, e **não recebem** aviso de falha — só o relatório financeiro.
- **Participação na máquina — Aspirador de pó** — tabela **separada** da de lavagens, com os mesmos 4 tipos e a mesma regra dos 100%, mas **totalmente independente**. Por exemplo: dá pra deixar o aspirador 100% com o lavador e sem nenhuma comissão, mesmo que as lavagens dessa máquina sejam divididas com Comissão 1/2 — um percentual não afeta o outro.
- **Histórico de lavagens** — as últimas concluídas naquela máquina, com cliente/programa/valor.

![Painel de uma máquina](imagens/admin/07-painel-maquina.png)

**Marcar pago hoje**: zera a contagem de dias sem pagar a licença — clique quando o pagamento for feito.

**Pôr em manutenção**: impede novas reservas naquela máquina até você clicar em "Tirar de manutenção".

---

### Resumo no fim de cada máquina

No **fim da aba de cada máquina** (página Máquinas) há o **Resumo (desde o último fechamento)**: uma tabela com cada **tipo de lavagem** e quantas foram **Presencial** (dinheiro na máquina), **App**, **Sócios** e **Bônus**, com o total e o valor. Sócios e bônus não geram dinheiro na hora, então têm valor R$ 0,00. Logo abaixo está o **Relatório do lavador (a pagar / a receber)**: "Deve repassar R$ X" (ele ficou com o dinheiro do presencial e deve a parte dos outros) ou "A receber R$ X".

> Sócios e bônus só aparecem separados depois que a máquina receber a atualização do firmware que informa o tipo da lavagem. Até lá todos entram em Presencial.

---

## 6b. Aspirador de pó — ativando numa máquina

A máquina de aspirar pó fica ligada a um relé separado (DO8) e é controlada pelo mesmo app do cliente. Pra ativar:

1. Vá em **Máquinas** → escolha a unidade/máquina → seção **"Aspirador de pó"**.
2. Marque **"Esta máquina tem aspirador"**.
3. Preencha o **preço** (R$) e a **duração** (minutos) daquele ciclo.
4. Salve.

A partir daí, o botão do aspirador aparece pro cliente na tela daquela unidade — mostrando os minutos configurados (ex.: "10 min de aspirador de pó"). Se desmarcar a caixinha, a opção some do app na hora.

> 💡 Cada máquina tem seu próprio preço/duração — não existe um valor "padrão" pra todas.

---

## 7. Divisão entre participantes

Quando uma máquina tem pelo menos um participante cadastrado (Lavador, Comissão 1, Comissão 2 ou Aluguel) em qualquer um dos dois escopos, aparece uma seção extra no painel dela pra cada escopo: **"Divisão entre participantes"** (lavagens) e **"Divisão entre participantes — Aspirador"**.

![Tabela de divisão entre participantes](imagens/admin/09-divisao-lavador.png)

A ideia é a mesma nos dois casos: **presencial** (dinheiro pago na hora, direto na máquina — só existe pras lavagens, o aspirador nunca é pago em espécie) fica automaticamente na mão do lavador; **app/carteira** cai automaticamente pra conta do admin. Comissão 1, Comissão 2 e Aluguel nunca ficam com o dinheiro em mãos em nenhum dos dois casos — são sempre credores. Como cada um tem seu percentual (lembrando: o percentual do aspirador é **separado** do das lavagens, seção 6), alguém sempre fica devendo a diferença pro outro — a tabela mostra, **linha por linha, por participante**, quanto veio de cada origem, e o **saldo líquido**:

- Se a pessoa tem a receber, aparece **"a receber: R$ X"**.
- Se a pessoa está com dinheiro que precisa repassar (normalmente o lavador, que embolsou o presencial), aparece **"a repassar: R$ X"**.
- O admin também aparece como uma linha calculada automaticamente (o que sobra dos 100% daquele escopo).

Isso poupa você de fazer conta na mão — é só olhar esse número na hora de acertar com cada participante.

---

## 8. O que fazer quando um alerta chegar

Se uma máquina falhar, ficar sem internet, ou a câmera parar de mandar foto, você recebe **uma** notificação push (a mesma que o lavador recebe) com o resumo do problema. **O aviso não se repete enquanto o problema durar.** Quando a situação normaliza chega **um segundo aviso, "voltou"**, dizendo quanto tempo ficou com o problema. No painel (Alertas — 24h) o "voltou" aparece com ✓.

### Visão geral: máquinas em abas, status e histórico de alertas

A **Visão geral** abre com as **máquinas em abas**, no mesmo desenho da página Máquinas: uma aba por **unidade** (com um ponto colorido por máquina: verde = ok, amarelo = manutenção, vermelho = offline ou falha) e, quando a unidade tem mais de uma máquina, as **sub-abas** "Máquina 1", "Máquina 2"... A aba em que você está fica **destacada** (borda vermelha mais forte).

Ao clicar em uma máquina você vê **só os dados dela**:
- **Status:** cartões Máquina (OK, lavando, manutenção, falha, offline) e Display (segundos desde o último contato). O estado da câmera por máquina entra numa próxima etapa.
- **Abertos agora:** o que está com problema neste momento (display fora, câmera fora, falha), desde quando.
- **Histórico de alertas:** tudo o que já aconteceu, **sem apagar nada**, com filtros de **período** (24 h, 7 dias, 30 dias, tudo) e de **tipo** (câmera, display, falha, carro não posicionou, só os "voltou"), em páginas de 50 ("mais antigos →").

Abaixo ficam os números gerais do negócio ("Resumo do negócio"). O antigo item **Alertas** do menu foi incorporado aqui. O **menu de cima** também destaca em qual página você está (linha vermelha embaixo do nome).

### Reinícios das placas (fim da página Máquinas)

Embaixo das abas aparece **"Reinícios das placas (30 dias)"**: quantas vezes a placa controladora (**W1**) e a das entradas/saídas (**W2**) reiniciaram, e quantas dessas foram **no meio de uma lavagem**. A tabela mostra quando, em qual máquina, por quê (queda de tensão, travou e o watchdog reiniciou, erro interno, "energia ligada" = a máquina foi religada, por exemplo depois do botão de emergência), em que estado a máquina estava e há quanto tempo estava ligada.

- Reinício com a máquina **parada** ou que voltou ao normal só fica registrado.
- Reinício **no meio de uma lavagem** é uma parada: você e o lavador da máquina recebem na hora um aviso no celular ("A máquina parou: placa reiniciou"). Confira a máquina e faça o **HOME no display**.
- Se a placa que reiniciou foi a **W1** e havia uma lavagem do app em andamento, ela é **cancelada e o valor é devolvido ao saldo do cliente automaticamente**, e ele recebe um aviso. Não é reagendada: se quiser, o cliente reserva de novo pelo app. Se a que reiniciou foi a **W2**, a máquina pausa e retoma sozinha, e nada é cancelado.
- Muitos "queda de tensão" apontam para fonte ou ruído elétrico; muitos "travou" apontam para o programa. Se a mesma máquina reinicia toda semana, avise o suporte.
- A hora é a do reinício (a máquina pega a hora na internet). Se ela ainda estava sem relógio, aparece a hora em que o aviso chegou na nuvem.
- A coluna **Etapa** mostra em que ponto da lavagem a máquina estava (processo, giro, sensores acesos). Se a energia caiu, aparece "ciclo em andamento antes da queda de energia". Os números "bordas X14/X15" mostram se o sensor de carro mudou enquanto só a W1 estava fora (útil para saber se um carro saiu ou entrou).

### Ocorrências observadas

Logo abaixo aparece **"Ocorrências observadas (30 dias)"**: situações em que dois sensores se contradizem (por exemplo, o X10 apagou sem a máquina andar). Por enquanto a máquina **só anota**, não age. Servem para afinar as regras de retomada da lavagem depois de uma queda. Se uma mesma ocorrência se repetir muito numa máquina, avise o suporte.

---

## 9. Lojas de conveniência (`/admin/lojas`)

> ⚠️ **Em construção.** A loja de conveniência funciona hoje só no ambiente de teste, não em produção. Esta seção é atualizada a cada etapa do projeto.

A loja de conveniência é um produto novo, no mesmo app da lavagem. O dia a dia de cada loja (produtos, estoque, mensagens de clientes) é do **dono da loja** — ver o *Guia do Lojista*. O seu papel como administrador é aprovar os donos e cuidar do cadastro das lojas.

### Aprovando um dono de loja

O pedido de **Dono de loja** chega como os outros, em **Usuários** → "Cadastros a aprovar" (seção 4). A pessoa pede no cadastro ("Sou dono de loja") ou depois, pelo Perfil.

- Aprovar **não muda o papel** da pessoa: ela continua Cliente (ou Lavador/Parceiro, se já era). O que muda é que ela passa a poder ser escolhida como dono de uma loja.
- Em Usuários, a aba de filtro **"Dono de loja"** mostra quem já foi aprovado.

### A página Lojas

![Página de lojas no admin](imagens/admin/10-lojas.png)

Cada loja aparece num cartão com:
- **Nome, endereço, cidade e UF**.
- **Capacidade** — quantas pessoas cabem ao mesmo tempo (padrão: 3).
- **Dono** — a lista só mostra quem tem o pedido de Dono de loja aprovado.
- **Loja aberta (aparece no app)** — desmarcada, a loja some da lista dos clientes.
- Uma linha de situação: se o computador da loja já está vinculado, quantos clientes estão bloqueados e quantas mensagens de suporte estão sem resposta.

### Como uma loja nova chega aqui

O caminho normal é a loja **aparecer sozinha**: quando o computador dela é ligado pela primeira vez, o técnico escolhe o endereço na tela e a loja é criada, **fechada e sem dono**. Você então:

1. Abre **Lojas** e encontra a loja nova.
2. Escolhe o **Dono**.
3. Confere a **capacidade**.
4. Marca **"Loja aberta"** quando ela estiver pronta para receber clientes.
5. Clica em **Salvar**.

Também dá para cadastrar a loja à mão, no formulário **"Nova loja"** no fim da página. Nesse caso ela fica "sem computador vinculado" até o técnico ligar o computador e escolher essa loja na lista.

### Indicadores de cada loja

Clicando numa loja em **Lojas** abre a página dela (`/admin/lojas/[id]`), com os indicadores do período escolhido: faturamento, número de vendas e ticket médio, itens mais vendidos, vendas por hora e por dia da semana, por forma de pagamento e por faixa etária. São os mesmos números que o dono vê em "Minha loja" no app.

- Venda de teste do caixa e venda cancelada não contam.
- A faixa etária só existe para compra paga pela carteira do app; compra no cartão aparece como "Sem identificação".

> ⚠️ Página construída em 10/11/2026 e ainda não conferida em tela. Se algo aparecer estranho, avise.

### Avisos da loja

A loja manda avisos ao dono (estoque mínimo, divergência de estoque, saída sem pagar, invasão). **Se a loja ainda não tem dono, esses avisos chegam para os administradores.**

### O que o administrador não faz

- **Estoque e produtos**: ficam no computador de cada loja, não no painel.
- **Bloquear cliente e responder suporte**: é o dono que faz, pelo app. Se a loja ainda não tem dono, as mensagens de suporte dela chegam como aviso para os administradores.

---

## Resumo rápido

```
Login -> Visão geral (números do negócio)
       -> Lavagens (histórico app, investigar reclamação)
       -> Usuários (Cadastros a aprovar, filtro por tipo, promover direto)
       -> Preços (nome dos 4 tipos)
       -> Máquinas (aba por unidade -> preço, status, aspirador, participação (lavagem + aspirador), divisão, histórico)
       -> Lojas (em teste: aprovar dono em Usuários -> definir dono, capacidade e abrir a loja)
```
