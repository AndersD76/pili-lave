# Programa da loja (computador central)

Roda no computador de cada loja de conveniência: produtos, estoque, entradas
de mercadoria. Cada loja tem o seu banco local (`dados/loja.db`, SQLite),
criado sozinho na primeira execução.

```bash
cd loja
npm install
npm run dev        # http://localhost:3100
```

- **Primeiro uso**: busca a cidade, escolhe o endereço da loja (existente ou
  novo) e cria a senha de gestão. Precisa do servidor da nuvem no ar.
- **Configuração** (arquivo `loja/.env`, opcional em desenvolvimento):
  - `NUVEM_URL` — endereço do servidor (padrão `http://localhost:3000`).
  - `SENHA_FABRICA` — o `PROVISION_SECRET` do servidor.
- **Recomeçar do zero** (só em teste): pare o programa e apague `dados/loja.db`.

Decisões e especificação: `PROJETO_LOJA_AUTOSERVICE.md` (etapa 2), na raiz.
