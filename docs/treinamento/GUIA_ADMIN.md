# Guia do Administrador — PILI CLEAN

> Como usar o painel administrativo: acompanhar vendas, gerenciar usuários, cadastrar lavadores e cuidar das máquinas.

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
- Lavagens por tipo de programa (Simples, Completa, etc.).
- Lista das últimas transações.

![Visão geral do admin](imagens/admin/02-visao-geral.png)

No topo, o menu vai te levar pras outras 3 seções: **Lavagens**, **Usuários**, **Máquinas**.

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

---

## 4. Usuários (`/admin/usuarios`)

Lista todos os usuários cadastrados: telefone, nome, papel (Cliente/Lavador/Admin), saldo, quantas lavagens já fez, quantos veículos tem, e desde quando é cadastrado.

![Tela de usuários](imagens/admin/04-usuarios.png)

### Como promover alguém a Lavador

1. Encontre a pessoa na lista (pelo telefone ou nome).
2. Na coluna de ações, clique no botão pra alternar o papel dela entre **Cliente** e **Lavador**.
3. Pronto — agora essa pessoa já pode ser vinculada a uma máquina (próximo passo, na tela de Máquinas).

![Promovendo um usuário a lavador](imagens/admin/05-promover-lavador.png)

> ⚠️ O usuário precisa **já ter se cadastrado no app antes** (cadastro normal, com e-mail e senha) — o admin não cria a conta da pessoa, só muda o papel de quem já existe.

---

## 5. Máquinas (`/admin/maquinas`)

A tela mais importante pro dia a dia. Mostra, por máquina:

| Coluna | O que significa |
|---|---|
| Unidade | Cidade + Rua onde a máquina está instalada |
| Nº | Número da máquina naquele endereço (1, 2, 3… quando há mais de uma no mesmo lugar) |
| Status | Livre / Lavando / **OFFLINE** (sem contato há mais de 1 min) / Manutenção |
| Última batida | Há quanto tempo a máquina "avisou" que está viva (deve ser sempre poucos segundos) |
| Sensores | Estado dos sensores de presença de carro (X14/X15) e tempo restante de ciclo |
| Licença | Situação de pagamento: 🟢 em dia · 🟡 aviso (40+ dias sem marcar pagamento) · 🔴 bloqueada (50+ dias) |
| **Lavador** | Quem é o responsável por essa máquina (ver abaixo) |
| Ações | Marcar pagamento em dia / Pôr ou tirar de manutenção |

![Tela de máquinas](imagens/admin/06-maquinas.png)

### Como vincular um lavador a uma máquina

1. Na linha da máquina, ache a coluna **Lavador**.
2. Escolha o nome na caixinha de seleção (só aparecem ali usuários que já têm o papel Lavador — ver seção 4).
3. Clique em **Salvar**.

A partir daí, essa pessoa:
- Passa a ver essa máquina no app dela, na aba **"Minha Máquina"** (ver o *Guia do Lavador*).
- Recebe **notificação no celular automaticamente** se a máquina der erro, ficar offline, ou parar de funcionar — mesmo que você (admin) não esteja de olho no painel.

![Vinculando lavador a uma máquina](imagens/admin/07-vincular-lavador.png)

### Marcar pagamento em dia

Quando o lavador/dono da máquina fizer o pagamento da licença/taxa, clique em **"Marcar pago hoje"** na linha dela. Isso zera a contagem de dias sem pagar (evita o bloqueio automático aos 50 dias).

### Pôr em manutenção

Se precisar tirar a máquina de operação temporariamente (manutenção física, por exemplo), clique em **"Pôr em manutenção"**. Isso impede novas reservas naquela máquina até você clicar em **"Tirar de manutenção"**.

---

## 6. O que fazer quando um alerta chegar

Se uma máquina falhar, ficar sem internet, ou a câmera parar de mandar foto, você recebe uma **notificação push** (a mesma que o lavador recebe) com o resumo do problema. O alerta também fica registrado — pra investigar, vá em **Máquinas** e confira o status/última batida daquela unidade específica.

---

## Resumo rápido

```
Login -> Visão geral (números do negócio)
       -> Lavagens (histórico, investigar reclamação)
       -> Usuários (promover a Lavador)
       -> Máquinas (status, licença, vincular lavador)
```
