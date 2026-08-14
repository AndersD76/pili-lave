# PILI LAVE — Direção de Marca

> Fonte da verdade para o app mobile, painel admin e materiais.
> Nada de copiar o app de referência: identidade própria, premium, dark-first.

## Conceito

**"Verniz molhado."** A sensação de carro recém-lavado à noite: pintura escura
profunda, reflexos de água, um brilho ciano de jato de alta pressão. O app é
escuro por padrão (pátio, uso ao ar livre, contraste alto), com o vermelho da
casa PILI usado de forma cirúrgica — assinatura, não tinta de parede.

Uma única animação-assinatura: a **onda d'água** no sucesso (pagamento
aprovado, lavagem liberada). Todo o resto é sóbrio e rápido.

## Paleta

| Token | Hex | Uso |
|---|---|---|
| `verniz` | `#0B1418` | Fundo escuro profundo (pintura molhada). Ground do dark. |
| `verniz2` | `#122029` | Superfícies/cards sobre o verniz. |
| `cromo` | `#EAF4F6` | Texto principal sobre escuro. |
| `jato` | `#25CFDE` | **Primária.** CTAs, foco, brilhos, links no dark. |
| `jatoInk` | `#0B7C89` | Primária utilizável sobre fundo claro (texto/ícone). |
| `pili` | `#E23D2E` | Vermelho da casa. Logo, selo, momentos de marca. Raro. |
| `aco` | `#54666C` | Texto secundário no claro. |
| `acoDark` | `#8FA3A9` | Texto secundário no escuro. |
| `espuma` | `#F4F9FA` | Fundo claro (modo claro). |
| `linha` | `rgba(37,207,222,.14)` | Bordas/divisores no dark (1px). |
| `ok` | `#2FBF71` | Sucesso (pago, liberada). |
| `atencao` | `#E9A23B` | Atenção (pendente, fila). |
| `erro` | `#C9403C` | Erro. (Não confundir com `pili`.) |

Regras: `jato` nunca como texto pequeno sobre `espuma` (usa `jatoInk`);
`pili` nunca em botões comuns; QR sempre sobre card claro, mesmo no dark.

## Tipografia

- **Display: Sora** (700/800) — títulos, números grandes (saldo, preços).
  Geométrica com terminais de gota; é a voz visual da marca.
- **Texto: Public Sans** (400/600) — corpo, labels, componentes.
- Valores monetários: Sora 700, `tabular-nums`, "R$" em 55% do tamanho.
- Labels/uppercase: Public Sans 600, letter-spacing 0.08em, 12px.

Escala (mobile): 34/28/22 display · 17 corpo · 15 secundário · 12 label.

## Componentes (linguagem)

- **Card verniz**: raio 20, fundo `verniz2` com gradiente vertical sutil
  (+4% de luz no topo, efeito verniz), borda 1px `linha`.
- **CTA primário**: pílula 56px, fundo `jato`, texto `verniz` 600. Pressed:
  escurece 8%. Nunca dois CTAs primários na mesma tela.
- **Saldo**: Sora 800 34px `cromo` sobre card verniz; ação "Adicionar" como
  botão fantasma com borda `linha`.
- **Card de veículo**: placa em destaque (Public Sans 600, espaçada tipo
  placa Mercosul), modelo em `acoDark`, lavagem padrão como chip.
- **Voucher QR**: card `espuma` com raio 24 flutuando sobre o verniz, QR
  preto, tipo da lavagem em Sora 700 abaixo, borda pontilhada = "destacável".
- **Chips de estado**: `atencao` Pendente · `ok` Pago/Liberada · `aco` Usado.
- **Ícones**: traço 1.75px arredondado (base Lucide), sem emoji na UI.
- **Motion**: 200–250ms ease-out; onda d'água só no sucesso; respeitar
  reduce-motion.

## Voz

Direta e calorosa, sem diminutivo e sem jargão de sistema:
"Lavagem liberada" · "Saldo adicionado" · "Mostre este código ao lavador" ·
erros dizem o que fazer: "Pagamento não confirmado ainda — verifique o app
do banco".
