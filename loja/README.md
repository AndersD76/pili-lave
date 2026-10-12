# Programa da loja (computador central)

Roda no computador de cada loja de conveniência: produtos, estoque, entradas
de mercadoria. Cada loja tem o seu banco local (`dados/loja.db`, SQLite),
criado sozinho na primeira execução.

```bash
cd loja
npm install
npm run dev        # http://localhost:3100
```

- **Primeiro uso**: busca a cidade e escolhe o endereço da loja (existente
  ou novo). Precisa do servidor da nuvem no ar.
- **Tela principal** (`/`): a do cliente. A gestão fica em `/gestao`, atrás
  do botão "Acesso administrativo" (usuário e senha).
- **Lojista**: entra com o e-mail e a senha do app — o admin precisa tê-lo
  definido como dono da loja em `/admin/lojas` do servidor. **Funcionários**
  são cadastrados pelo lojista em Usuários, com permissões.
- **Configuração** (arquivo `loja/.env`, opcional em desenvolvimento):
  - `NUVEM_URL` — endereço do servidor (padrão `http://localhost:3000`).
  - `SENHA_FABRICA` — o `PROVISION_SECRET` do servidor.
- **Recomeçar do zero** (só em teste): pare o programa e apague `dados/loja.db`.

Decisões e especificação: `PROJETO_LOJA_AUTOSERVICE.md` (etapa 2), na raiz.
