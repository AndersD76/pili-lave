# Programa da loja (computador central)

Roda no computador de cada loja de conveniência. Cada loja tem o seu banco
local (`dados/loja.db`, SQLite), criado sozinho na primeira execução e
independente das outras lojas.

```bash
cd loja
npm install
npm run dev        # http://localhost:3100
```

Precisa do servidor da nuvem (`server/`) no ar para o primeiro uso e para o
primeiro acesso do lojista.

## O que existe

| Endereço | O que é | Quem acessa |
|---|---|---|
| `/` | **Caixa de autoatendimento** (tela do cliente): código de barras, carrinho, pagamento **simulado** | Cliente, sem login |
| `/primeiro-uso` | Cadastro da loja: busca a cidade e escolhe o endereço (existente ou novo) | Só enquanto a loja não está cadastrada |
| `/entrar` | Acesso administrativo (usuário e senha) | Lojista e funcionários |
| `/gestao` | Painel: para comprar, sem preço, sem percentual, sem reajuste automático | Qualquer usuário ativo |
| `/gestao/produtos` | Produtos e estoque, com as abas "Sem percentual" e "Sem reajuste automático" | Qualquer usuário ativo |
| `/gestao/compras` | Lista de compras: marcar produtos (abaixo do mínimo ou todos), imprimir ou baixar | Permissão de compras |
| `/gestao/entradas` | Entrada por nota fiscal (XML) e conferência | Permissão de entrada |
| `/gestao/relatorios` | Estoque, entradas, saídas e perdas por período, com planilha CSV | Permissão de relatórios |
| `/gestao/vendas`, `/usuarios`, `/atividades` | Vendas do caixa, funcionários e permissões, registro de quem fez o quê | Só o lojista |

## Usuários

- **Lojista**: entra com o e-mail e a senha do app. O admin precisa tê-lo
  definido como dono da loja em `/admin/lojas` do servidor. Depois do
  primeiro acesso, entra também sem internet.
- **Funcionários**: cadastrados pelo lojista em Usuários, com as permissões
  marcadas (produtos, preço, entrada, perda, inventário, relatórios, compras).
- A sessão dura 30 minutos.

## Preço de venda

Preço = custo + percentual do produto. O preço é recalculado sozinho quando
o custo muda (nota fiscal, entrada manual com custo, alteração no cadastro).
Produto com "preço manual" não é reajustado.

## Configuração

Arquivo `loja/.env`, opcional em desenvolvimento:

- `NUVEM_URL` — endereço do servidor (padrão `http://localhost:3000`).
- `SENHA_FABRICA` — o `PROVISION_SECRET` do servidor.

## Para testar

- `exemplos/nfe-exemplo.xml` e `exemplos/nfe-exemplo-2.xml`: notas fiscais
  **fictícias** para testar a entrada por nota.
- Em Produtos e estoque, com o cadastro vazio, o lojista tem o botão
  "Carregar 5 produtos de exemplo".
- **Recomeçar do zero**: pare o programa e apague `dados/loja.db`.
- **Cuidado**: `dados/loja.db` guarda o estoque de verdade daquela loja e
  não vai para o Git. Faça uma cópia antes de qualquer teste que apague dados.

Decisões e especificação: `PROJETO_LOJA_AUTOSERVICE.md`, na raiz. Uso no dia
a dia: `docs/treinamento/GUIA_LOJISTA.md`. Detalhes técnicos: seção 6.11 do
`GUIA_TECNICO_COMPLETO.md`.
