# Guia do Lojista — PILI Loja de Conveniência

> Como o dono de uma loja de conveniência autoservice usa o sistema: virar dono, cadastrar a loja no computador dela, cuidar de produtos e estoque, responder clientes e bloquear quem der problema.

> ⚠️ **A loja de conveniência está em construção.** Tudo o que este guia descreve funciona hoje só no ambiente de teste, não no sistema em produção. As partes que ainda não existem estão listadas na seção 9. Este guia é atualizado a cada etapa do projeto.

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
5. Crie a **senha de gestão** (mínimo 6 caracteres) e repita.
6. Clique em **"Cadastrar esta loja"**.

Depois disso essa tela não aparece mais, e o computador abre direto no painel.

> ⚠️ Esse passo precisa de **internet**, porque a loja é registrada no servidor.

> ⚠️ A loja nova nasce **fechada e sem dono**. Ela só aparece para os clientes depois que o administrador define o dono e marca a loja como aberta.

### A senha de gestão

Protege o estoque e os cadastros. O computador fica num lugar sem funcionário, e o caixa dos clientes roda nele: quem não tem a senha só usa o caixa. A sessão dura 12 horas; depois o programa pede a senha de novo. Para sair antes, use o botão **Sair** no topo.

---

## 4. Painel

É a tela inicial da gestão. Mostra o que precisa de atenção agora:

![Painel da loja](imagens/lojista/03-painel.png)

- **Produtos ativos** — quantos estão à venda.
- **Para comprar** — produtos no estoque mínimo ou abaixo dele. É o seu alerta de compra.
- **Sem preço de venda** — produtos que ainda não podem ser vendidos.
- **Valor em estoque** — soma do estoque a preço de custo.

Abaixo, a lista **"Para comprar"** mostra cada produto com o estoque atual, o mínimo e quanto falta para passar do mínimo.

---

## 5. Produtos e estoque

No menu do topo, **"Produtos e estoque"**.

![Lista de produtos e estoque](imagens/lojista/04-produtos.png)

- **Busca** por nome ou pelo código de barras (dá para usar o leitor: clique no campo e leia o produto).
- A cor do estoque indica a situação: 🟢 acima do mínimo · 🟡 no mínimo ou abaixo · 🔴 zerado.
- Marque **"mostrar inativos"** para ver também os produtos tirados de venda.

### Cadastrando um produto

No fim da página, em **"Novo produto"**:

| Campo | O que é |
|---|---|
| Nome | Como o produto aparece no caixa e nos relatórios |
| Código de barras | O número lido pelo leitor (8 a 14 dígitos). Dois produtos não podem ter o mesmo |
| Preço de venda | Quanto o cliente paga. Obrigatório no cadastro feito à mão. Só fica "sem preço" o produto criado por uma nota de entrada, até você definir o valor |
| Custo | Quanto você pagou na última compra |
| Estoque mínimo | Abaixo ou igual a isso, o produto entra na lista "Para comprar". Padrão: 5 |
| Unidade | Normalmente UN |
| Estoque inicial | Quantos você está colocando na prateleira agora |

### Editando um produto

Clique no nome do produto. Na tela dele você muda qualquer campo do cadastro e pode desmarcar **"Produto ativo"** para tirá-lo de venda sem apagar o histórico.

![Tela de um produto](imagens/lojista/05-produto.png)

---

## 6. Perda e contagem de inventário

Na tela de cada produto há dois lançamentos:

- **Registrar perda** — produto vencido, quebrado ou furtado. Informe a quantidade perdida e o **motivo** (obrigatório). O estoque baixa nessa quantidade.
- **Contagem de inventário** — você conta quantos há na prateleira e informa esse número. O sistema lança sozinho a diferença, para mais ou para menos. Se a contagem bater com o sistema, nada é lançado.

### Extrato do estoque

Abaixo ficam os últimos 50 movimentos do produto: quando, o tipo (entrada, venda, perda, ajuste), a quantidade e o saldo depois de cada um. Toda mudança de estoque aparece aqui, então dá para conferir de onde veio qualquer número.

> 💡 O saldo pode ficar **negativo**. Se o caixa vender um item que o sistema achava zerado, a venda aconteceu de verdade; o sistema registra e deixa a diferença aparecer, para você investigar.

---

## 7. App: área "Minha loja"

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

> ⚠️ Enquanto a porta por celular não estiver instalada (seção 9), o bloqueio só aparece no app; ele ainda não impede fisicamente a entrada.

---

## 8. Regras da loja que você precisa conhecer

- **Capacidade**: 3 pessoas por vez. Com a loja cheia, a porta não abre e o app do cliente mostra "Ocupação máxima esgotada, aguarde".
- **Entrada**: só pelo app, uma pessoa por abertura (mais as crianças que ela declarar).
- **Saída**: a porta sempre abre por dentro. Se alguém sair sem pagar, o sistema registra e avisa você; ninguém fica preso.
- **Divergência de estoque**: qualquer diferença entre o que saiu da prateleira e o que foi pago gera um aviso para você, com as imagens do momento.
- **Pagamento sem internet**: só na maquininha de cartão. As vendas ficam guardadas e sobem quando a conexão voltar.
- **Reconhecimento no caixa**: o cliente é reconhecido pelo rosto (foto tirada no app). Sem reconhecimento, ele indica quem é e confirma a compra no próprio celular.

---

## 9. O que ainda não está disponível

| Recurso | Situação |
|---|---|
| Entrada de mercadoria por nota fiscal (arquivo XML ou PDF) | Próximo passo |
| Relatórios por período (entradas, saídas, estoque) | Próximo passo |
| Caixa de autoatendimento (totem) e baixa automática por venda | A fazer |
| Abertura da porta pelo celular e controle de capacidade | A fazer |
| Câmeras e aviso de divergência com imagens | A fazer |
| Reconhecimento facial no caixa | A fazer |
| Indicadores no app (faturamento, mais vendidos, faixa etária) e aviso de estoque mínimo no celular | A fazer |
| Nota fiscal das vendas | Depende de definição com o contador |

---

## Resumo rápido

```
Pedir "Dono de loja" no app -> administrador aprova e vincula a loja
Computador da loja, 1a vez -> buscar cidade -> escolher endereço -> criar senha de gestão
Dia a dia no computador -> Painel (o que comprar) -> Produtos e estoque -> perda / contagem
Dia a dia no app -> Loja conveniência -> Minha loja -> responder mensagens / bloquear cliente
```
