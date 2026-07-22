# GP4 Taxas

Sistema simples para:
1. **Cadastrar as taxas GP4 Pay** (categorias SUB e SITE, prazos D+1 / D+30 / D+0, Débito e Crédito 1x a 24x).
2. **Calculadora de economia** — o vendedor informa as taxas que o cliente já paga hoje e o sistema mostra automaticamente a diferença, a economia no período e a projeção anual, igual ao Excel de referência, mas dinâmico.

Stack: Node.js + Express + PostgreSQL + EJS + JWT (mesmo padrão dos outros sistemas).

## Rodando localmente

```bash
npm install
cp .env.example .env   # edite DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run migrate        # cria as tabelas, semeia categorias/prazos/tipos e as taxas iniciais da planilha, cria o usuário admin
npm start
```

Acesse `http://localhost:3000` e entre com o e-mail/senha definidos em `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Deploy no EasyPanel

1. Suba este projeto num repositório Git (GitHub).
2. No EasyPanel, crie um serviço PostgreSQL (ou use um já existente) e copie a `DATABASE_URL`.
3. Crie um serviço de app a partir do repositório (o `Dockerfile` já está pronto — build automático).
4. Configure as variáveis de ambiente do serviço: `DATABASE_URL`, `JWT_SECRET`, `ADMIN_NAME`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PORT` (opcional, padrão 3000).
5. O `Dockerfile` já roda `node src/migrate.js` antes de subir o servidor — isso cria as tabelas, popula as taxas iniciais (extraídas da sua planilha `Comparativo_de_Taxas_Cliente_03jul26.xlsx`) e cria seu usuário admin no primeiro deploy. Nos deploys seguintes, a migração é segura de rodar de novo (não duplica dados).
6. Aponte o domínio (ex: `taxas.gp4pay.iwamura.com.br` ou o que preferir) e pronto.

## Como usar

### Cadastro de taxas (perfil admin)
Menu **Cadastro de Taxas** → escolha categoria (SUB/SITE) e prazo (D+1/D+30/D+0) → preencha a taxa GP4 (%) de cada tipo de pagamento → Salvar. As taxas já vêm pré-carregadas com os valores da sua planilha de referência — é só ajustar quando precisar.

Obs: percebi que na planilha original o bloco "SITE D+0" usa multiplicador x12 (igual ao D+30) para projetar o valor anual, mesmo sendo "no mesmo dia". Deixei o D+0 configurado no sistema com multiplicador x365 (lógica de "por dia"), que parece ser o correto. Se você quiser manter igual à planilha original, é só me pedir que eu ajusto o multiplicador de D+0 na tabela `prazos`.

### Calculadora (todos os usuários)
Menu **Calculadora** → escolha categoria e prazo → informe o valor médio de vendas do cliente → preencha, para cada tipo de pagamento, a taxa que o cliente já paga hoje. O sistema calcula na hora: diferença, economia no período e economia projetada em 1 ano. Dá pra usar o botão **Imprimir / Salvar PDF** para gerar um resumo limpo pra mostrar ao cliente.

## Estrutura

```
src/
  server.js          → entrada da aplicação
  db.js              → pool de conexão PostgreSQL
  migrate.js         → cria schema + seed (categorias, prazos, tipos, taxas, admin)
  middleware/auth.js → autenticação JWT via cookie
  routes/            → auth, rates (admin), calculator
  views/             → EJS
  public/            → CSS e JS do front
migrations/001_init.sql → schema SQL puro
```

## Usuários adicionais (vendedores)

Por enquanto a criação de novos usuários é manual, via SQL:

```sql
-- gere o hash da senha com bcrypt antes de rodar (ex: usando um script Node com bcryptjs)
INSERT INTO users (name, email, password_hash, role)
VALUES ('Nome do Vendedor', 'vendedor@exemplo.com', '<hash_bcrypt>', 'vendedor');
```

Se preferir, posso adicionar uma tela de gestão de usuários dentro do próprio sistema.
