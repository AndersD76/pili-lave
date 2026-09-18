# Guia do Lavador — PILI CLEAN

> Como acompanhar a(s) máquina(s) que você administra: status, avisos de erro, lavagens feitas e faturamento.

📸 *Espaços `![...](imagens/lavador/arquivo.png)` — salve os prints com esse nome exato dentro de `docs/treinamento/imagens/lavador/`.*

---

## 1. Pré-requisito: sua conta precisa ser vinculada

Antes de você ver qualquer coisa, o **administrador** precisa ter feito 2 coisas (ver *Guia do Administrador*, seções 4 e 5):
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

Ao abrir, você vê um cartão pra cada máquina que administra (a maioria dos casos é só uma), com:

![Tela Minha Máquina](imagens/lavador/02-tela-principal.png)

- **Cabeçalho**: Cidade — Rua · Número da máquina (ex: "Erechim — Rua João Carlon · Máquina 1").
- **Status ao vivo**, com uma bolinha colorida:
  - 🟢 **Livre** — pronta pra próxima lavagem.
  - 🔵 **Lavando** — um carro está sendo lavado agora.
  - 🟡 **Em manutenção** — foi colocada em manutenção pelo admin.
  - 🔴 **EM FALHA** ou **OFFLINE** — precisa da sua atenção (ver seção 4).
- **Hoje / Últimos 7 dias / Últimos 30 dias**: quantas lavagens foram feitas e quanto faturou em cada período.

Puxe a tela pra baixo (arrastar) pra atualizar os números na hora.

---

## 4. Quando dá problema — o que você recebe e o que fazer

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

## 5. Perguntas comuns

**"A máquina apareceu como OFFLINE mas está ligada — o que houve?"**
Provavelmente perdeu conexão de internet (a câmera é quem fala com a nuvem). Confira o Wi-Fi/roteador do local.

**"Fiz uma lavagem manual no botão físico, ela conta nas estatísticas?"**
Sim — o contador conta qualquer lavagem concluída pela máquina, seja iniciada pelo app do cliente ou pelo painel físico.

**"Posso ver o histórico de mais de 30 dias?"**
Hoje a tela mostra só hoje/7 dias/30 dias. Pra relatórios maiores, peça ao administrador (ele tem acesso ao histórico completo no painel admin).

---

## Resumo rápido

```
Abrir app -> aba "Minha Máquina" -> ver status + lavagens/faturamento
Notificação de erro chegou? -> ir até a máquina -> ler a mensagem no display -> resolver
```
