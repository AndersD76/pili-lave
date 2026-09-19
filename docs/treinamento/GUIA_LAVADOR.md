# Guia do Lavador — PILI CLEAN

> Como acompanhar a(s) máquina(s) que você administra: status, avisos de erro, lavagens feitas (dinheiro na hora e pelo app) e quanto você tem a receber.

📸 *Espaços `![...](imagens/lavador/arquivo.png)` — salve os prints com esse nome exato dentro de `docs/treinamento/imagens/lavador/`.*

---

## 1. Pré-requisito: sua conta precisa ser vinculada

Antes de você ver qualquer coisa, o **administrador** precisa ter feito 2 coisas (ver *Guia do Administrador*, seções 4 e 6):
1. Promovido seu usuário pro papel **Lavador**.
2. Vinculado sua conta à máquina que você administra.

Se você entrar no app e a aba "Minha Máquina" aparecer vazia com a mensagem *"Nenhuma máquina vinculada ao seu usuário ainda"*, é porque esse segundo passo ainda não foi feito — fale com o administrador.

---

## 2. Onde acessar

É no **mesmo app do celular** que o cliente usa (não precisa instalar nada diferente). Assim que sua conta é promovida a Lavador, uma aba nova aparece no menu de baixo: **"Minha Máquina"** (ícone de ferramenta 🔧).

![Aba Minha Máquina no menu do app](imagens/lavador/01-aba-menu.png)

Se essa aba não aparecer, confira se você está logado com a conta certa (a que o admin promoveu).

---

## 3. A tela "Minha Máquina"

Ao abrir, você vê um cartão pra cada máquina que administra (a maioria dos casos é só uma).

![Tela Minha Máquina](imagens/lavador/02-tela-principal.png)

### Escolhendo o período

No topo, três botões:
- **Hoje** (padrão ao abrir).
- **Escolher período** — abre um calendário pra você escolher a data inicial e final.
- **Não acertado ainda** — mostra tudo que ainda não foi fechado com o admin (desde a última vez que ele marcou "pago" no painel dele).

![Botões de período e calendário](imagens/lavador/04-periodo.png)

### O cartão da máquina

- **Cabeçalho**: Cidade — Rua · Número da máquina (ex: "Erechim — Rua João Carlon · Máquina 1").
- **Status ao vivo**, com uma bolinha colorida:
  - 🟢 **Livre** — pronta pra próxima lavagem.
  - 🔵 **Lavando** — um carro está sendo lavado agora.
  - 🟡 **Em manutenção** — foi colocada em manutenção pelo admin.
  - 🔴 **EM FALHA** ou **OFFLINE** — precisa da sua atenção (ver seção 5).
- **Total no período** — soma bruta (dinheiro + app) de tudo que a máquina faturou no período escolhido.
- **Tabela por tipo de lavagem**, com duas colunas — **Presencial** (pago em dinheiro, direto na máquina) e **App** (pago pela carteira do cliente). O valor mostrado em cada coluna **já é a sua parte** — não o total bruto daquela lavagem. No rodapé da tabela, a soma de cada coluna.
- **Sua participação**: o valor final que você tem a receber (ou já tem em mãos, no caso do presencial) somando as duas colunas.

Puxe a tela pra baixo (arrastar) pra atualizar os números na hora.

> 💡 Como funciona por trás: no **presencial** o dinheiro já fica com você na hora — a parte que sobra é o que você deve repassar ao admin. No **app** o dinheiro cai direto pro admin — a parte que aparece aqui é o que ele te deve. O acerto final entre vocês dois é calculado automaticamente (o admin vê o resultado líquido no painel dele).

---

## 4. Perguntas comuns

**"A máquina apareceu como OFFLINE mas está ligada — o que houve?"**
Provavelmente perdeu conexão de internet (a câmera é quem fala com a nuvem). Confira o Wi-Fi/roteador do local.

**"Fiz uma lavagem manual no botão físico, ela conta nas estatísticas?"**
Sim — conta na coluna **Presencial**, separada da coluna **App**.

**"Posso ver o histórico de mais de 30 dias?"**
Sim — use o botão **"Escolher período"** e coloque a data que quiser.

**"O que significa 'Não acertado ainda'?"**
É tudo que aconteceu desde a última vez que o administrador marcou o pagamento em dia no painel dele — assim que ele acerta com você, essa lista some (o próximo período começa do zero).

---

## 5. Quando dá problema — o que você recebe e o que fazer

Se a sua máquina:
- **reportar falha** (parou sozinha por erro do inversor/sensor),
- **ficar sem internet** (a câmera para de mandar foto),
- ou **o display parar de responder** (queda de energia, por exemplo),

você recebe uma **notificação no celular na hora**, mesmo com o app fechado — algo como *"Sua máquina precisa de atenção"* ou *"Sua máquina parou por falha"*.

![Notificação de falha no celular](imagens/lavador/03-notificacao-falha.png)

**O que fazer:**
1. Vá até a máquina fisicamente e olhe a tela do display — ela mostra a mensagem exata do erro (ex: "Carro travado (X0)", "Braço fora de posição").
2. Se for falha simples (carro mal posicionado, trava de sensor), normalmente dá pra resolver reposicionando o carro e usando o botão **"LIMPAR ERRO"** no próprio display.
3. Se for falha de energia/internet, confira o cabo/roteador do local.
4. Se o cliente estava lavando na hora do erro, **o dinheiro dele já foi devolvido automaticamente** — você não precisa fazer nada em relação ao pagamento, só resolver o problema físico.

---

## Resumo rápido

```
Abrir app -> aba "Minha Máquina" -> escolher período (Hoje / período / não acertado)
          -> ver status + Presencial x App por tipo + Sua participação
Notificação de erro chegou? -> ir até a máquina -> ler a mensagem no display -> resolver
```
