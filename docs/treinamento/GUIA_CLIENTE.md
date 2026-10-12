# Guia do Cliente — PILI CLEAN

> Como usar o app pra lavar seu carro: cadastro, comprar lavagem, chegar na máquina e acompanhar.

📸 *Espaços `![...](imagens/cliente/arquivo.png)` — salve os prints com esse nome exato dentro de `docs/treinamento/imagens/cliente/`.*

---

## 1. Instalando e abrindo pela primeira vez

Acesse pelo **navegador do celular ou computador**, usando o link que a unidade divulgar — hoje ainda não existe um app pra baixar na loja (Play Store/App Store); tudo funciona direto no navegador, sem instalar nada. Na primeira vez, você cai direto na tela de **Criar conta**.

![Tela de cadastro](imagens/cliente/01-cadastro.png)

Preencha:
- **Nome completo**
- **Telefone**
- **E-mail**
- **Senha** (mínimo 8 caracteres, com letras e números)
- **Confirmar senha**

Toque em **"Criar conta"**. Você já entra automaticamente — não precisa confirmar nada por SMS ou e-mail.

> Já tem conta? Toque em **"Já tenho uma conta"** e entre com e-mail + senha.

---

## 2. Onboarding (só na primeira vez)

Depois de criar a conta, o app mostra 3 telas rápidas explicando como tudo funciona:

![Onboarding passo 1](imagens/cliente/02-onboarding-1.png)
![Onboarding passo 2](imagens/cliente/03-onboarding-2.png)
![Onboarding passo 3](imagens/cliente/04-onboarding-3.png)

1. Como reservar e pagar pelo app.
2. Como a câmera reconhece sua placa sozinha na chegada.
3. O que fazer se a câmera não reconhecer (botão "Cheguei").

No final, o app sugere adicionar créditos — mas isso é **opcional**.

---

## 3. Adicionando saldo (opcional, a qualquer momento)

Escolha o valor e a forma de pagamento (PIX, geralmente) pra colocar saldo na sua carteira do app.

![Tela de recarga](imagens/cliente/05-recarga.png)

> 💡 **Adicionar saldo nunca é obrigatório pra usar o app.** Se a tela de recarga demorar ou o PIX falhar por algum motivo, toque em **"Agora não, quero só olhar o app"** — você entra normalmente nas suas abas e pode navegar, cadastrar veículo, ver unidades, etc. Você só vai precisar ter saldo na carteira **na hora de efetivamente reservar uma lavagem**. Pra recarregar depois, é só ir na aba **Carteira** ou tocar no saldo na tela inicial, quando quiser.

---

## 4. Cadastrando seu veículo

Na tela inicial, toque em **"Adicionar veículo"** e informe a placa (e opcionalmente marca/modelo). É essa placa que a câmera vai reconhecer quando você chegar na máquina.

![Adicionar veículo](imagens/cliente/06-veiculo-novo.png)

Você também pode definir uma **lavagem padrão** pro veículo, tocando nele na lista — é a que vale quando a câmera reconhece a placa automaticamente.

---

## 5. Tela inicial

É o painel principal — mostra:
- Seu **saldo disponível**.
- Se você tem uma **reserva ativa** (esperando, ou já liberada).
- Seus **veículos** cadastrados.

![Tela inicial](imagens/cliente/07-inicio.png)

---

## 6. Escolhendo a unidade

Toque na aba **"Unidades"** (ou no botão **"Reservar lavagem"** da tela inicial, que já leva direto pra lá) pra ver o mapa/lista de endereços disponíveis, com o status de cada um (🟢 Aberto · 🟡 Ocupado · 🔴 Manutenção).

![Tela de unidades](imagens/cliente/08-unidades.png)

Escolher a unidade é **sempre o primeiro passo**, mesmo quando só existe um endereço disponível — cada unidade pode ter um preço diferente pra mesma lavagem, então o app precisa saber onde você vai antes de mostrar valores e liberar a compra.

Toque na unidade desejada pra ver as máquinas dela e o botão **"Reservar lavagem"** (agora sim, o de verdade).

---

## 7. Reservando e pagando uma lavagem

1. Depois de escolher a unidade (passo anterior), toque em **"Reservar lavagem"**.
2. Escolha o veículo e o tipo de lavagem (programa) — os preços mostrados já são os **dessa unidade específica**.
3. Confirme — o valor é debitado do seu saldo na hora e a reserva fica valendo por **1 hora**.

![Escolhendo o programa de lavagem](imagens/cliente/09-nova-lavagem.png)

Depois de reservar, a tela inicial mostra um cronômetro regressivo. **Se você não usar a reserva em 1 hora, o dinheiro volta sozinho pro seu saldo** — não precisa pedir reembolso.

![Reserva com cronômetro](imagens/cliente/10-reserva-ativa.png)

---

## 8. Chegando na máquina

### Caminho normal: a câmera reconhece sozinha
Basta chegar com o carro na máquina. A câmera lê a placa, e se bater com sua reserva, a **luz verde acende** — pode entrar. O app também avisa (notificação + tela muda pra "Pode entrar!").

![Luz verde - pode entrar](imagens/cliente/11-pode-entrar.png)

### Se a câmera não reconhecer
Toque no botão **"Cheguei, liberar manualmente"** que aparece no card da sua reserva.

![Botão Cheguei](imagens/cliente/12-botao-cheguei.png)

Vai aparecer um aviso confirmando que, ao liberar assim, o valor será cobrado normalmente quando a lavagem terminar — toque em **Confirmar**.

**Se o endereço tiver mais de uma máquina**, o app vai perguntar em qual delas você está parado (com os números das máquinas) antes de liberar — só nesse caso.

![Escolher qual máquina (quando há mais de uma)](imagens/cliente/13-escolher-maquina.png)

---

## 9. Acompanhando a lavagem

Enquanto o carro está sendo lavado, a tela mostra o progresso e, **se a máquina tiver câmera disponível naquele momento**, a imagem ao vivo dela (atualiza sozinha a cada poucos segundos). A câmera só é liberada enquanto você tem uma lavagem em andamento — fora disso o espaço fica vazio ("Disponível quando sua lavagem estiver em andamento").

![Progresso da lavagem](imagens/cliente/14-progresso.png)

Ao final, aparece **"Pode sair!"** — a lavagem foi concluída e o valor debitado definitivamente.

---

## 9b. Aspirador de pó (quando a unidade tiver)

Algumas máquinas também têm aspirador de pó próprio, cobrado à parte da lavagem. Tem dois jeitos de usar:

**Junto com uma lavagem**: depois de pagar a lavagem, se a máquina tiver aspirador, aparece uma pergunta: *"Quer liberar o aspirador por X min por R$ Y?"*. Se topar, vai direto pra tela do aspirador (abaixo).

**Sozinho, sem lavar o carro**: na tela da unidade (depois de escolher a unidade, antes de reservar lavagem), aparece um botão separado, tipo **"10 min de aspirador de pó"** — é só tocar nele.

Na tela do aspirador:
1. Toque em **"Comprar"** — o valor é descontado do seu saldo na hora.
2. Quando estiver pronto pra usar (pode ser na hora ou um pouco depois), toque em **"Começar agora"** — é aí que o tempo começa a contar, não no momento da compra.
3. Um cronômetro regressivo mostra quanto tempo falta. Quando zera, aparece "Tempo esgotado" e a tela volta sozinha pro início.

> 💡 O aspirador liga de verdade na máquina só depois que você aperta "Começar agora" — comprar não liga nada sozinho.

---

## 10. Carteira e histórico

- **Carteira**: veja seu saldo e todo o extrato (recargas, lavagens, estornos).
- **Histórico**: lista de todas as lavagens já feitas.

![Tela de carteira](imagens/cliente/15-carteira.png)

---

## 11. Perfil e segurança

Na aba **Perfil**, você pode:
- Editar nome e CPF (o e-mail é fixo, é seu login).
- Ativar **entrar com biometria** (digital/rosto), se seu celular suportar — mais uma trava de segurança além da senha.
- Sair da conta.

![Tela de perfil](imagens/cliente/16-perfil.png)

---

## 12. Também trabalha com lavagem? Vire Lavador, Vendedor ou Aluguel

Além de cliente, você também pode ter uma capacidade extra no sistema — **Lavador** (opera uma máquina), **Vendedor 1**, **Vendedor 2** (comissão) ou **Aluguel** (recebe pelo espaço onde uma máquina fica instalada). Isso é totalmente **opcional** e nunca atrapalha seu uso normal do app como cliente.

- No **cadastro**, você pode marcar quantas dessas opções quiser ao mesmo tempo.
- Se já é cliente há mais tempo e quer pedir agora, vá em **Perfil** → seção **"Também é lavador, vendedor ou aluguel?"** e toque em **Pedir** no tipo desejado. Dá pra pedir mais de um.
- O status de cada pedido aparece ali mesmo: **Pedir** → **Em análise** (esperando o administrador aprovar) → **Aprovado**. Se for rejeitado, aparece **"Pedir de novo"**.
- Enquanto o pedido está em análise, você continua usando o app normalmente — nunca fica bloqueado esperando aprovação.
- Depois de aprovado, aparecem abas novas no app: **"Minha Máquina"** (se Lavador) e/ou **"Comissões"** (se Vendedor/Aluguel), com o relatório do que você tem a receber.

---

## 13. Loja de conveniência (em teste)

> ⚠️ **Em construção.** A loja de conveniência e as telas desta seção funcionam hoje só no ambiente de teste, não no app em produção. Quando forem liberadas, o começo deste guia (cadastro e primeira abertura) será ajustado.

### O que muda ao abrir o app

- **Data de nascimento** no cadastro.
- **Termo de uso**: na primeira abertura é preciso ler e aceitar o termo para usar o app. Quem já tem conta aceita na próxima vez que abrir, e informa a data de nascimento na mesma tela.
- **Tela de escolha**: depois de entrar, o app pergunta o que você quer usar — **Loja conveniência** ou **Lavagem expressa**. A lavagem continua igual a tudo o que este guia descreve. Dá para trocar de um para o outro a qualquer momento.

![Tela de escolha](imagens/cliente/17-escolha.png)

### Primeira vez na loja: sua foto

Ao tocar em **Loja conveniência** pela primeira vez, o app pede uma **foto do seu rosto**. É por ela que o caixa da loja reconhece você na hora de pagar.

1. Toque em **"Tirar foto"**, de frente, em lugar claro, sem boné nem óculos escuros.
2. Marque a caixa autorizando o uso da imagem para esse reconhecimento.
3. Toque em **"Enviar foto"**.

O sistema confere a foto na hora: se não for o rosto de uma pessoa só, de frente e bem visível, ele explica o problema e pede outra.

Quem usa só a lavagem não precisa tirar foto. Para refazer, use **"Trocar minha foto"** na tela da loja.

![Tirando a foto do rosto](imagens/cliente/18-foto.png)

### A tela da loja

- **Seu código de cliente** — um número só seu. É por ele que a loja registra sua entrada.
- **Saldo disponível** — a mesma carteira da lavagem paga as compras da loja.
- **Lojas** — as lojas abertas, com endereço e capacidade.

![Tela da loja de conveniência](imagens/cliente/19-loja.png)

### Como vai funcionar a compra

1. Você abre a porta pelo app. Entra uma pessoa por vez por abertura; ao entrar com criança, é só declarar.
2. A loja comporta **3 pessoas por vez**. Se estiver cheia, o app avisa "Ocupação máxima esgotada, aguarde".
3. Pegue o que quiser e passe cada item no caixa de autoatendimento.
4. Pague com o saldo do app ou no cartão.
5. Saia. A porta sempre abre por dentro.

A loja é filmada o tempo todo, e o sistema confere o que saiu das prateleiras com o que foi pago. Isso está descrito no termo de uso.

### Falar com o suporte da loja

Em cada loja da lista há o botão **"Falar com o suporte"**. Sua mensagem vai para o responsável pela loja, e a resposta aparece na mesma tela, em até 24 horas.

### Se sua entrada for bloqueada

O responsável por uma loja pode bloquear a entrada de alguém por problema de conduta. Nesse caso a loja aparece com o aviso de bloqueio e a orientação de falar com o suporte, pelo mesmo botão. O bloqueio vale só para aquela loja.

### Tem uma loja? Vire Dono de loja

Funciona como os outros pedidos da seção 12: marque **"Sou dono de loja"** no cadastro, ou peça em **Perfil**. Depois de aprovado e com a loja vinculada, aparece o botão **"Minha loja"** na tela da loja de conveniência (ver *Guia do Lojista*).

---

## Resumo rápido

```
Instalar -> Criar conta -> Onboarding -> (Adicionar crédito é opcional)
Cadastrar veículo -> Escolher unidade -> Reservar lavagem (aí sim precisa de saldo)
Chegar na máquina (câmera reconhece, ou "Cheguei" manual) -> luz verde -> lavar -> pronto
Quer só aspirador? -> tela da unidade -> botão "X min de aspirador de pó" -> Comprar -> Começar agora
Quer ser Lavador/Vendedor/Aluguel? -> Perfil -> "Também é lavador, vendedor ou aluguel?" -> Pedir
Loja de conveniência (em teste) -> aceitar o termo -> escolher "Loja conveniência" -> tirar a foto -> ver as lojas
```
