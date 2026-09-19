# Guia do Cliente — PILI CLEAN

> Como usar o app pra lavar seu carro: cadastro, comprar lavagem, chegar na máquina e acompanhar.

📸 *Espaços `![...](imagens/cliente/arquivo.png)` — salve os prints com esse nome exato dentro de `docs/treinamento/imagens/cliente/`.*

---

## 1. Instalando e abrindo pela primeira vez

Baixe o app (ou acesse pelo navegador, se estiver usando a versão web). Na primeira vez, você cai direto na tela de **Criar conta**.

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

No final, você já cai direto na tela de **adicionar créditos**.

---

## 3. Adicionando saldo

Escolha o valor e a forma de pagamento (PIX, geralmente) pra colocar saldo na sua carteira do app.

![Tela de recarga](imagens/cliente/05-recarga.png)

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

Enquanto o carro está sendo lavado, a tela mostra o progresso e, se disponível, a câmera ao vivo da máquina.

![Progresso da lavagem](imagens/cliente/14-progresso.png)

Ao final, aparece **"Pode sair!"** — a lavagem foi concluída e o valor debitado definitivamente.

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

## Resumo rápido

```
Instalar -> Criar conta -> Onboarding -> Adicionar crédito
Cadastrar veículo -> Escolher unidade -> Reservar lavagem
Chegar na máquina (câmera reconhece, ou "Cheguei" manual) -> luz verde -> lavar -> pronto
```
