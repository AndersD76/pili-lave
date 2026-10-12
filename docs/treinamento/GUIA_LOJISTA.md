# Guia do Lojista — PILI Loja de Conveniência

> Como o dono de uma loja de conveniência autoservice usa o sistema: virar dono, cadastrar a loja no computador dela, cuidar de produtos e estoque, responder clientes e bloquear quem der problema.

> ⚠️ **A loja de conveniência está em construção.** Tudo o que este guia descreve funciona hoje só no ambiente de teste, não no sistema em produção. As partes que ainda não existem estão listadas na seção 15. Este guia é atualizado a cada etapa do projeto.

📸 *Espaços `![...](imagens/lojista/arquivo.png)` — salve os prints com esse nome exato dentro de `docs/treinamento/imagens/lojista/`.*

---

## 1. Como a loja funciona (visão geral)

A loja é um container sem funcionário no caixa:

1. O cliente entra pelo app (a porta abre pelo celular).
2. Pega os produtos nas prateleiras.
3. Passa cada item no totem de autoatendimento, que lê o código de barras.
4. Paga com o saldo da carteira do app ou na maquininha de cartão.
5. Sai. As câmeras conferem o que saiu das prateleiras contra o que foi pago.

Cada loja tem **dois lugares** onde você trabalha:

| Onde | O que você faz ali |
|---|---|
| **Computador da loja** (dentro do container) | Produtos, preços, estoque, entrada de mercadoria. Cada loja tem o seu, independente das outras. |
| **App no celular** (o mesmo dos clientes) | Responder mensagens de clientes e bloquear a entrada de alguém. Futuramente: indicadores e avisos. |

---

## 2. Virando dono de loja

Antes de qualquer coisa, sua conta precisa ser aprovada como **Dono de loja**:

1. Crie sua conta no app normalmente (ver *Guia do Cliente*).
2. Peça o papel de dono: no cadastro, marque **"Sou dono de loja"**; ou depois, em **Perfil** → "Também é lavador, vendedor ou aluguel?" → **Pedir** em "Dono de loja".
3. O administrador aprova o pedido e **vincula a loja ao seu cadastro** (ver *Guia do Administrador*, seção 9).

Enquanto o pedido está em análise, você continua usando o app normalmente como cliente.

![Pedindo o papel de dono de loja](imagens/lojista/01-pedir-dono.png)

> 💡 Ser dono de loja não muda mais nada na sua conta: você continua podendo comprar, lavar o carro e, se for o caso, ser lavador ou parceiro de uma máquina ao mesmo tempo.

---

## 3. Primeira ligada do computador da loja

Na primeira vez que o programa da loja abre, ele mostra a tela **"Cadastro da loja"**. É a mesma ideia do cadastro de uma máquina de lavagem.

![Cadastro da loja no primeiro uso](imagens/lojista/02-primeiro-uso.png)

1. Digite a **cidade** e clique em **Buscar**.
2. Aparecem os endereços que já existem nessa cidade:
   - **Loja já cadastrada, ainda sem computador** — escolha esta se o administrador já criou a loja no painel.
   - **Unidade de lavagem** — escolha esta se a loja fica no mesmo endereço de um lava-rápido.
   - **Loja já cadastrada, com computador vinculado** — só escolha se estiver **trocando o computador** da loja. O sistema pede uma confirmação.
3. Se o endereço não estiver na lista, marque **"Endereço novo"** e digite rua e número.
4. Opcional: dê um **nome** para a loja. Sem ele, fica o endereço.
5. Clique em **"Cadastrar esta loja"**.

Depois disso essa tela não aparece mais, e o computador passa a abrir na **tela do cliente**.

> ⚠️ Esse passo precisa de **internet**, porque a loja é registrada no servidor.

> ⚠️ A loja nova nasce **fechada e sem dono**. Ela só aparece para os clientes depois que o administrador define o dono e marca a loja como aberta.

### Entrando na gestão

A tela que fica aberta no computador é a do cliente. Para entrar na gestão, clique em **"Acesso administrativo"**, no canto inferior direito, e informe usuário e senha.

![Acesso administrativo](imagens/lojista/02b-acesso-administrativo.png)

- **Você (lojista)** entra com o **e-mail e a senha do app**. O administrador precisa ter definido você como dono desta loja; antes disso ninguém entra.
- **Funcionários** entram com o usuário e a senha que você cadastrar (seção 11).

Na primeira vez o computador precisa de **internet** para conferir quem é o dono. Depois disso você consegue entrar mesmo sem internet, com a mesma senha.

A sessão dura **30 minutos**, porque a máquina fica na frente dos clientes. Ao terminar, clique em **Sair** no topo: o programa volta para a tela do cliente.

---

## 4. Painel

É a tela inicial da gestão. Mostra o que precisa de atenção agora:

![Painel da loja](imagens/lojista/03-painel.png)

- **Produtos ativos** — quantos estão à venda.
- **Para comprar** — produtos no estoque mínimo ou abaixo dele. É o seu alerta de compra.
- **Sem preço de venda** — produtos que ainda não podem ser vendidos.
- **Sem percentual** — produtos cujo preço não acompanha o custo. Clicar abre a lista para preencher.
- **Sem reajuste automático** — produtos com preço fixado à mão. Clicar abre a lista.
- **Valor em estoque** — soma do estoque a preço de custo.

Abaixo ficam duas listas:
- **"Para comprar"**: cada produto com o estoque atual, o mínimo e quanto falta para passar do mínimo.
- **"Sem preço de venda"** (quando houver): produtos novos que chegaram por nota. Preencha o percentual de cada um ali mesmo e clique em **Salvar percentuais**.

---

## 5. Produtos e estoque

No menu do topo, **"Produtos e estoque"**.

![Lista de produtos e estoque](imagens/lojista/04-produtos.png)

- **Busca** por nome ou pelo código de barras (dá para usar o leitor: clique no campo e leia o produto).
- A cor do estoque indica a situação: 🟢 acima do mínimo · 🟡 no mínimo ou abaixo · 🔴 zerado.
- Marque **"mostrar inativos"** para ver também os produtos tirados de venda.
- Logo acima da tabela há três botões: **Todos**, **Sem percentual** e **Sem reajuste automático**, cada um com a contagem. Eles filtram a lista (seção 6).
- A coluna **"% de venda"** é editável para quem pode alterar preço: digite o percentual na linha do produto e clique em **Salvar percentuais**, abaixo da tabela. O preço é recalculado na hora, em todo o sistema.

### Cadastrando um produto

No fim da página, em **"Novo produto"**:

| Campo | O que é |
|---|---|
| Nome | Como o produto aparece no caixa e nos relatórios |
| Código de barras | O número lido pelo leitor (8 a 14 dígitos). Dois produtos não podem ter o mesmo |
| Percentual de venda | Quanto você põe em cima do custo: 40 = custo mais 40%. O preço é calculado por ele e acompanha o custo sozinho (ver seção 6) |
| Preço manual | Marque só se quiser fixar o preço à mão; o produto deixa de ser reajustado |
| Custo | Quanto você pagou na última compra |
| Estoque mínimo | Abaixo ou igual a isso, o produto entra na lista "Para comprar". Padrão: 5 |
| Unidade | Normalmente UN |
| Estoque inicial | Quantos você está colocando na prateleira agora |

### Editando um produto

Clique no nome do produto. Na tela dele você muda qualquer campo do cadastro e pode desmarcar **"Produto ativo"** para tirá-lo de venda sem apagar o histórico.

![Tela de um produto](imagens/lojista/05-produto.png)

---

## 6. Preço de venda: percentual e reajuste automático

A regra da loja é: **preço = custo + percentual do produto**.

- Cada produto guarda o seu **percentual de venda**. Com custo de R$ 4,00 e percentual de 50, o preço é R$ 6,00.
- Quando o **custo muda**, o preço é **recalculado sozinho**. Isso acontece ao lançar uma nota fiscal com custo novo, ao dar entrada manual informando o custo, ou ao alterar o custo no cadastro.
- Cada reajuste fica em **Atividades**, por exemplo: "Coca-Cola: R$ 5,90 → R$ 8,00 — reajuste automático (custo R$ 4,00 + 100%; NF 801)".

### Onde definir o percentual

- **Direto na lista de Produtos e estoque**: a coluna "% de venda" tem um campo em cada linha. Quem já tem percentual aparece com o valor preenchido; quem não tem aparece vazio, com a borda laranja. Altere quantos quiser e clique em **Salvar percentuais**. Só é salvo ao clicar no botão, e campo em branco não apaga o percentual.
- **Aba "Sem percentual"**, na mesma tela: filtra só os produtos que ainda não têm percentual. O objetivo é essa lista ficar vazia. O painel mostra quantos faltam.
- **Na conferência da nota**: a coluna **"% de venda"** mostra em cinza o percentual atual de cada produto. Em branco, ele é mantido; digitando, passa a valer o novo. Embaixo do campo aparece o que vai acontecer com o preço ("preço vai de R$ 5,90 para R$ 8,00").
- **Na tela do produto**: campo "Percentual de venda (%)", com o preço calculado ao lado.
- **No painel**, na tabela "Sem preço de venda", para os produtos novos que chegaram por nota.

![Aba Sem percentual](imagens/lojista/05g-sem-percentual.png)

### Preço manual (a exceção)

Se você quiser fixar o preço de um produto à mão, abra o produto e marque **"Preço manual (sem reajuste automático)"**. O sistema pergunta: *"Este item não sofrerá mais reajustes automáticos. Deseja prosseguir?"*. Confirmando, você digita o preço.

- Esse produto **não muda de preço** quando chega nota com custo novo.
- Ele aparece na aba **"Sem reajuste automático"**, em Produtos e estoque, e no cartão de mesmo nome no painel. Confira essa lista de tempos em tempos: são os itens em que a sua margem pode estar encolhendo sem você perceber.
- Para voltar ao automático, desmarque a caixa. O percentual que o produto tinha antes continua guardado.

> 💡 Um funcionário sem a permissão de alterar preço pode lançar uma nota normalmente, e os preços são reajustados pela sua regra. O que ele não pode é mudar o percentual.

## 7. Entrada, perda e contagem de inventário

Na tela de cada produto, em **"Quantidade em estoque"**, há três lançamentos:

- **Dar entrada** — chegou mercadoria. Informe quantas unidades chegaram e o sistema soma ao estoque. Se informar o custo unitário, ele passa a ser o custo do produto.
- **Registrar perda** — produto vencido, quebrado ou furtado. Informe a quantidade perdida e o **motivo** (obrigatório). O estoque baixa nessa quantidade.
- **Contagem de inventário** — você conta quantos há na prateleira e informa esse número. O sistema lança sozinho a diferença, para mais ou para menos. Se a contagem bater com o sistema, nada é lançado.

### Extrato do estoque

Abaixo ficam os últimos 50 movimentos do produto: quando, o tipo (entrada, venda, perda, ajuste), a quantidade e o saldo depois de cada um. Toda mudança de estoque aparece aqui, então dá para conferir de onde veio qualquer número.

> 💡 O saldo pode ficar **negativo**. Se o caixa vender um item que o sistema achava zerado, a venda aconteceu de verdade; o sistema registra e deixa a diferença aparecer, para você investigar.

---

## 8. Entrada de mercadoria por nota fiscal

No menu do topo, **"Entradas"** (para quem tem a permissão de dar entrada).

![Entrada por nota fiscal](imagens/lojista/05d-entradas.png)

1. Em **"Entrada por nota fiscal"**, escolha o arquivo **.xml** da nota do fornecedor e clique em **"Ler nota"**. Tem que ser o XML: o PDF da nota não serve. O fornecedor é obrigado a fornecer o XML.
2. Abre a **conferência**, com o fornecedor, o número e o total da nota, e uma linha para cada item.
3. Em cada item, confira:
   - **Produto na loja** — o sistema já sugere. Ele reconhece pelo código de barras e, quando a nota não traz, pelo que você escolheu na última nota daquele fornecedor. O que ele não reconhece vem como **"Criar produto novo"**. Você pode trocar por um produto existente ou escolher **"Não dar entrada neste item"**.
   - **Unidades** — quantas unidades de venda vão para a prateleira. Se a nota veio em caixas (a coluna "Veio como" mostra, por exemplo, "2 CX"), confira se o número está em unidades.
   - **% de venda** (só para quem pode alterar preço) — opcional. Em cinza aparece o percentual atual do produto; em branco, ele é mantido. Embaixo do campo o sistema mostra o que vai acontecer com o preço. Produto com preço manual aparece como "preço manual" e não é reajustado.
4. Clique em **"Confirmar e dar entrada"**. Só aí o estoque muda.

![Conferência da nota](imagens/lojista/05e-conferencia.png)

O que acontece na confirmação:
- O estoque de cada produto sobe e o extrato mostra a entrada com o número da nota.
- O **custo** do produto passa a ser o total do item dividido pelas unidades.
- O **preço de venda é reajustado** pelo percentual de cada produto (seção 6).
- Produto novo sem percentual informado nasce **sem preço de venda** e aparece no painel até você definir o percentual.
- O sistema guarda qual produto corresponde a cada código daquele fornecedor, para a próxima nota já vir preenchida.

Regras:
- **A mesma nota não entra duas vezes.** Se você enviar de novo, o sistema avisa quando ela entrou.
- Nota enviada e não confirmada fica em **"Notas aguardando conferência"**, para continuar depois ou **descartar**.
- Nada entra pela metade: ou a nota inteira é lançada, ou nada muda.

> 💡 Para treinar, há uma nota fictícia na pasta do programa: `loja/exemplos/nfe-exemplo.xml`.

## 9. Relatórios

No menu do topo, **"Relatórios"** (para o lojista e para quem tem a permissão de ver relatórios).

![Relatórios](imagens/lojista/05f-relatorios.png)

| Relatório | O que mostra |
|---|---|
| **Estoque** | A posição de agora: cada produto com estoque, mínimo, custo, preço e valor; total de unidades e valor do estoque a custo e a preço de venda |
| **Entradas** | O que entrou no período, item a item: nota ou manual, fornecedor, quantidade, custo e quem lançou |
| **Saídas (vendas)** | O que foi vendido no período, por produto, do mais vendido para o menos; número de vendas, total vendido e valor médio por venda |
| **Perdas e ajustes** | Perdas lançadas e diferenças de contagem no período, com motivo e quem lançou |

- Entradas, Saídas e Perdas usam um **período**: escolha as datas em "De" e "Até" e clique em **Aplicar**. Sem escolher, vale do dia 1 do mês até hoje.
- **"Baixar planilha (CSV)"** baixa o relatório que está na tela, para abrir no Excel.
- No relatório de perdas, o valor é calculado pelo custo atual de cada produto. Ajuste negativo é produto que o sistema esperava e não estava na prateleira na contagem.

## 10. O caixa (tela do cliente) e as vendas

A tela que fica aberta no computador é o **caixa de autoatendimento**:

![Caixa de autoatendimento](imagens/lojista/05a-caixa.png)

1. O cliente passa o produto no leitor de código de barras (ou digita o código e toca em **Adicionar**). O produto entra na lista com nome e preço.
2. Passar o mesmo produto de novo soma mais um. Os botões **+** e **−** ajustam a quantidade; com 1 unidade, o botão vira **×** e remove o item.
3. **Pagar** mostra o total; **Confirmar pagamento** fecha a venda e baixa o estoque de cada item.
4. A tela de "Compra concluída" volta sozinha para o início depois de alguns segundos.

Regras do caixa:
- Produto **não cadastrado**, **inativo** ou **sem preço** não entra na compra; o caixa mostra um aviso.
- Compra parada por 3 minutos é cancelada sozinha.
- O preço cobrado é sempre o do cadastro no momento de fechar.

> ⚠️ **O pagamento ainda é simulado.** Nesta fase nada é cobrado: a venda é registrada e o estoque baixa, mas a carteira do app e a maquininha ainda não estão ligadas. As vendas aparecem marcadas como "Simulado (teste)".

No menu da gestão, **"Vendas"** (só o lojista vê) mostra o total vendido no dia e as últimas vendas com os itens. No extrato de cada produto, a venda aparece com "Caixa" na coluna Quem.

## 11. Funcionários e permissões

No menu do topo, **"Usuários"** (só o lojista vê).

![Cadastro de funcionários](imagens/lojista/05b-usuarios.png)

Em **"Novo funcionário"**, informe o nome, o **usuário** que ele vai digitar para entrar (letras sem acento, números, ponto ou traço), uma senha e marque o que ele pode fazer:

| Permissão | O que libera |
|---|---|
| Cadastrar e editar produtos | Criar produto e mudar nome, código de barras, custo, mínimo, unidade, ativar e desativar |
| Alterar preço de venda | Definir o percentual de venda e marcar ou desmarcar preço manual |
| Dar entrada de mercadoria | Lançar quantidade que chegou, à mão ou por nota fiscal |
| Registrar perda | Baixar produto vencido, quebrado ou furtado |
| Fazer contagem de inventário | Ajustar o estoque pelo que foi contado |
| Ver relatórios | Abrir os relatórios e baixar as planilhas |

Ver o painel e consultar produtos e estoque todo funcionário ativo pode. Usuários e Atividades são só seus.

Em cada funcionário já cadastrado você pode mudar o nome, as permissões, trocar a senha ou desmarcar **"Usuário ativo"** para tirar o acesso. A mudança vale na hora, mesmo que ele esteja com a gestão aberta.

> 💡 O funcionário só vê na tela o que pode fazer. Quem tem só "Dar entrada", por exemplo, não vê os cartões de perda e de contagem.

## 12. Atividades: quem fez o quê

No menu do topo, **"Atividades"** (só o lojista vê).

![Registro de atividades](imagens/lojista/05c-atividades.png)

Tudo o que é feito na gestão fica registrado: **quando**, **quem**, **o quê** e o **detalhe**. Por exemplo: "Maria · Alterou preço · Halls: R$ 3,50 → R$ 4,00". Entram aqui as entradas, perdas, contagens, cadastros e alterações de produto, mudanças de preço, cadastro e alteração de funcionários, e cada vez que alguém entra na gestão.

- Use o filtro para ver só as atividades de uma pessoa.
- O registro não pode ser editado nem apagado por ninguém.
- No extrato de cada produto, a coluna **"Quem"** mostra quem fez cada lançamento.

---

## 13. App: área "Minha loja"

No celular, entre em **Loja conveniência**. Para quem é dono aprovado, aparece o botão **"Minha loja (área do dono)"**.

![Área Minha loja no app](imagens/lojista/06-minha-loja.png)

Se aparecer *"Nenhuma loja está vinculada a você ainda"*, o administrador ainda não fez o vínculo da loja com o seu cadastro.

### Mensagens de clientes

Quando um cliente escreve para o suporte da sua loja, você recebe um aviso no celular e a mensagem aparece aqui, com o nome e o código do cliente. Escreva a resposta e toque em **Responder**. O cliente é avisado e vê a resposta na tela da loja.

> ⏱️ O combinado com o cliente é resposta em **até 24 horas**.

### Bloqueando um cliente

Se alguém teve problema de conduta, você pode bloquear a entrada dele **na sua loja**:

1. Informe o **código do cliente** (o número que identifica cada cliente; aparece junto das mensagens dele).
2. Escreva o **motivo**. Ele fica só com você.
3. Toque em **"Bloquear cliente"**.

O cliente passa a ver que a entrada dele está bloqueada e é orientado a falar com o suporte, que é você. Ele **não vê o motivo**.

Para liberar de novo, toque em **Desbloquear** ao lado do nome. O histórico do bloqueio fica guardado.

> ⚠️ Enquanto a porta por celular não estiver instalada (seção 15), o bloqueio só aparece no app; ele ainda não impede fisicamente a entrada.

---

## 14. Regras da loja que você precisa conhecer

- **Capacidade**: 3 pessoas por vez. Com a loja cheia, a porta não abre e o app do cliente mostra "Ocupação máxima esgotada, aguarde".
- **Entrada**: só pelo app, uma pessoa por abertura (mais as crianças que ela declarar).
- **Saída**: a porta sempre abre por dentro. Se alguém sair sem pagar, o sistema registra e avisa você; ninguém fica preso.
- **Divergência de estoque**: qualquer diferença entre o que saiu da prateleira e o que foi pago gera um aviso para você, com as imagens do momento.
- **Pagamento sem internet**: só na maquininha de cartão. As vendas ficam guardadas e sobem quando a conexão voltar.
- **Reconhecimento no caixa**: o cliente é reconhecido pelo rosto (foto tirada no app). Sem reconhecimento, ele indica quem é e confirma a compra no próprio celular.

---

## 15. O que ainda não está disponível

| Recurso | Situação |
|---|---|
| Entrada por nota fiscal a partir do PDF (hoje só o XML) | Depois, com uma nota real para calibrar |
| Pagamento de verdade no caixa (saldo do app e maquininha) e identificação do cliente | A fazer (o caixa já funciona com pagamento simulado) |
| Abertura da porta pelo celular e controle de capacidade | A fazer |
| Modo reposição (loja bloqueada para clientes enquanto um funcionário repõe) | A fazer, junto com a porta |
| Abrir a porta à distância pelo app (só o lojista) | A fazer, junto com a porta |
| Câmeras e aviso de divergência com imagens | A fazer |
| Reconhecimento facial no caixa | A fazer |
| Indicadores no app (faturamento, mais vendidos, faixa etária) e aviso de estoque mínimo no celular | A fazer |
| Nota fiscal das vendas | Depende de definição com o contador |

---

## Resumo rápido

```
Pedir "Dono de loja" no app -> administrador aprova e vincula a loja
Computador da loja, 1a vez -> buscar cidade -> escolher endereço
Entrar na gestão -> "Acesso administrativo" -> e-mail e senha do app (funcionário: usuário e senha)
Dia a dia no computador -> Painel (o que comprar) -> Produtos e estoque -> entrada / perda / contagem
Preço -> percentual na coluna "% de venda" -> Salvar percentuais (o preço acompanha o custo sozinho)
Chegou mercadoria com nota -> Entradas -> enviar o XML -> conferir -> Confirmar e dar entrada
Fechamento -> Relatórios (estoque, entradas, saídas, perdas) -> Baixar planilha
Equipe -> Usuários (cadastrar funcionário e marcar permissões) -> Atividades (quem fez o quê)
Caixa -> é a tela do cliente; as vendas aparecem em Vendas (pagamento ainda simulado)
Dia a dia no app -> Loja conveniência -> Minha loja -> responder mensagens / bloquear cliente
```
