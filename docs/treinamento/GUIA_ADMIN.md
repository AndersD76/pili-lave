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

No topo, o menu vai te levar pras outras seções: **Lavagens**, **Usuários**, **Preços**, **Máquinas**.

---

## 3. Lavagens (`/admin/lavagens`)

Histórico das últimas 200 lavagens compradas, com:
- Quando foi comprada.
- Cliente e placa do veículo.
- Programa e valor.
- **Status**: 🟡 Aguardando (pagou, esperando usar) · 🟢 Liberada (lavagem concluída, é aí que o valor é debitado de verdade) · 🔴 Cancelada (estornada).
- Quem resgatou (se foi validado manualmente no balcão) e o código do voucher.

![Tela de lavagens](imagens/admin/03-lavagens.png)

**Quando usar:** pra conferir se uma lavagem específica de um cliente foi processada, ou pra investigar reclamação ("paguei e não lavou").

> ⚠️ Essa lista mostra só as lavagens compradas **pelo app**. Lavagens pagas em dinheiro na hora (pelos botões da própria máquina) aparecem na tela de Máquinas, coluna "Presencial" (seção 6).

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

Acima da lista de usuários tem abas: **Todos / Cliente / Lavador / Comissão 1 / Comissão 2 / Aluguel / Admin**, cada uma com a contagem de pessoas. Clique numa aba pra filtrar a lista só por aquele tipo — útil quando a lista de usuários está grande e você quer achar, por exemplo, só quem recebe aluguel.

### Como promover alguém direto (sem esperar o pedido)

Se você já sabe que uma pessoa vai ser Lavador, Comissão 1, Comissão 2 ou Aluguel de uma máquina, não precisa esperar ela pedir pelo app — dá pra promover direto:

1. Encontre a pessoa na lista (pelo telefone ou nome).
2. Na coluna de ações, abra o dropdown de papel: **Cliente / Lavador / Parceiro**.
3. Se escolher **Parceiro**, um segundo campo aparece pra você escolher **qual tipo** de parceiro (Comissão 1, Comissão 2 ou Aluguel) — não dá mais pra deixar "Parceiro" sem especificar o tipo.
4. Salve. Agora essa pessoa já pode ser cadastrada como participante de uma máquina (seção 6).

![Promovendo um usuário direto pelo dropdown](imagens/admin/05-promover-lavador.png)

> ⚠️ O usuário precisa **já ter se cadastrado no app antes** (cadastro normal, com e-mail e senha) — o admin não cria a conta da pessoa, só muda o papel/capacidade de quem já existe.

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
- **Participação na máquina** — aqui você cadastra quem ganha o quê naquela máquina, em até 4 tipos: **Lavador**, **Comissão 1**, **Comissão 2** e **Aluguel**. Pra cada tipo, escolha a pessoa numa caixinha (só aparece quem já tem a capacidade correspondente aprovada) e informe o **percentual** dela. Clique em Salvar.
  - **Regra dos 100%**: a soma dos percentuais de todos os participantes cadastrados naquela máquina nunca pode passar de 100%. O que sobrar até 100% fica automaticamente com você (admin) — não precisa cadastrar nada pra isso, o sistema calcula sozinho.
  - Se você tentar salvar um percentual que estoura os 100% (somando com quem já está cadastrado), a tela mostra um aviso de erro e não deixa salvar — ajuste o número e tente de novo.
  - Só quem tem o papel de **Lavador** vê a máquina no app como "Minha Máquina" e recebe notificação automática se ela der erro. Comissão 1, Comissão 2 e Aluguel veem a máquina numa aba separada chamada "Comissões" no app deles, e **não recebem** aviso de falha — só o relatório financeiro.
- **Histórico de lavagens** — as últimas concluídas naquela máquina, com cliente/programa/valor.

![Painel de uma máquina](imagens/admin/07-painel-maquina.png)

**Marcar pago hoje**: zera a contagem de dias sem pagar a licença — clique quando o pagamento for feito.

**Pôr em manutenção**: impede novas reservas naquela máquina até você clicar em "Tirar de manutenção".

---

## 7. Divisão entre participantes

Quando uma máquina tem pelo menos um participante cadastrado (Lavador, Comissão 1, Comissão 2 ou Aluguel), aparece uma seção extra no painel dela: **"Divisão entre participantes"**.

![Tabela de divisão entre participantes](imagens/admin/09-divisao-lavador.png)

A ideia: **presencial** (dinheiro pago na hora, direto na máquina) fica automaticamente na mão do lavador; **app** (pago pela carteira do cliente) cai automaticamente pra conta do admin. Comissão 1, Comissão 2 e Aluguel nunca ficam com o dinheiro em mãos em nenhum dos dois casos — são sempre credores. Como cada um tem seu percentual, alguém sempre fica devendo a diferença pro outro — a tabela mostra, **linha por linha, por participante**, quanto veio do presencial, quanto veio do app, e o **saldo líquido**:

- Se a pessoa tem a receber, aparece **"a receber: R$ X"**.
- Se a pessoa está com dinheiro que precisa repassar (normalmente o lavador, que embolsou o presencial), aparece **"a repassar: R$ X"**.
- O admin também aparece como uma linha calculada automaticamente (o que sobra dos 100%).

Isso poupa você de fazer conta na mão — é só olhar esse número na hora de acertar com cada participante.

---

## 8. O que fazer quando um alerta chegar

Se uma máquina falhar, ficar sem internet, ou a câmera parar de mandar foto, você recebe uma **notificação push** (a mesma que o lavador recebe) com o resumo do problema. O alerta também fica registrado — pra investigar, vá em **Máquinas**, escolha a unidade/máquina certa e confira o status/última batida.

---

## Resumo rápido

```
Login -> Visão geral (números do negócio)
       -> Lavagens (histórico app, investigar reclamação)
       -> Usuários (Cadastros a aprovar, filtro por tipo, promover direto)
       -> Preços (nome dos 4 tipos)
       -> Máquinas (aba por unidade -> preço, status, participação, divisão, histórico)
```
