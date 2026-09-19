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

Lista todos os usuários cadastrados: telefone, nome, papel (Cliente/Lavador/Admin), saldo, quantas lavagens já fez, quantos veículos tem, e desde quando é cadastrado.

![Tela de usuários](imagens/admin/04-usuarios.png)

### Como promover alguém a Lavador

1. Encontre a pessoa na lista (pelo telefone ou nome).
2. Na coluna de ações, clique no botão pra alternar o papel dela entre **Cliente** e **Lavador**.
3. Pronto — agora essa pessoa já pode ser vinculada a uma máquina (seção 6).

![Promovendo um usuário a lavador](imagens/admin/05-promover-lavador.png)

> ⚠️ O usuário precisa **já ter se cadastrado no app antes** (cadastro normal, com e-mail e senha) — o admin não cria a conta da pessoa, só muda o papel de quem já existe.

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
- **Lavador responsável** — escolha na caixinha (só aparecem quem já é Lavador) e clique em Salvar. A partir daí essa pessoa vê a máquina no app dela e recebe notificação automática se ela der erro.
- **Histórico de lavagens** — as últimas concluídas naquela máquina, com cliente/programa/valor.

![Painel de uma máquina](imagens/admin/07-painel-maquina.png)

**Marcar pago hoje**: zera a contagem de dias sem pagar a licença — clique quando o pagamento for feito.

**Pôr em manutenção**: impede novas reservas naquela máquina até você clicar em "Tirar de manutenção".

---

## 7. Divisão com o lavador

Quando uma máquina tem um lavador designado, aparece uma seção extra no painel dela: **"Divisão com o lavador"**.

![Tabela de divisão admin/lavador](imagens/admin/09-divisao-lavador.png)

A ideia: **presencial** (dinheiro pago na hora, direto na máquina) fica automaticamente na mão do lavador; **app** (pago pela carteira do cliente) cai automaticamente pra conta do admin. Como o percentual de cada um é dividido (por enquanto uma regra fixa, ainda em fase de simulação), alguém sempre fica devendo a diferença pro outro — a tela já mostra esse **resultado líquido final**:

- Se o valor da coluna App (que ficou com o admin) supera o que o lavador teria direito, aparece **"Admin deve pagar o lavador: R$ X"**.
- Se o valor da coluna Presencial (que ficou com o lavador) supera o que o admin teria direito, aparece **"Lavador deve repassar pro admin: R$ X"**.

Isso poupa você de fazer conta na mão — é só olhar esse número na hora de acertar com cada lavador.

---

## 8. O que fazer quando um alerta chegar

Se uma máquina falhar, ficar sem internet, ou a câmera parar de mandar foto, você recebe uma **notificação push** (a mesma que o lavador recebe) com o resumo do problema. O alerta também fica registrado — pra investigar, vá em **Máquinas**, escolha a unidade/máquina certa e confira o status/última batida.

---

## Resumo rápido

```
Login -> Visão geral (números do negócio)
       -> Lavagens (histórico app, investigar reclamação)
       -> Usuários (promover a Lavador)
       -> Preços (nome dos 4 tipos)
       -> Máquinas (aba por unidade -> preço, status, lavador, divisão, histórico)
```
