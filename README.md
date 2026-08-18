# GP4 Taxas

Sistema para:
1. **Cadastrar as taxas GP4 Pay** (categorias SUB e SITE, bandeiras Master/Visa/Elo, prazos D+1 / D+30 / D+0, Débito e Crédito 1x a 24x, além do PIX).
2. **Calculadora de economia** — o vendedor informa as taxas que o cliente já paga hoje e o sistema mostra a diferença, a economia no período e a projeção anual.
3. **Gestão de usuários** — cadastro de vendedores com controle de acesso por tela.

Stack: Node.js 20 + Express + PostgreSQL + EJS + JWT.

Análise técnica, pendências e roadmap: [ANALISE.md](ANALISE.md).

## Rodando localmente

```bash
npm install
cp .env.example .env   # edite DATABASE_URL, JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npm run migrate        # cria as tabelas, semeia os cadastros e cria o usuário admin
npm start
```

Acesse `http://localhost:3000` e entre com o e-mail/senha definidos em `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

O servidor **não sobe** se `DATABASE_URL` ou `JWT_SECRET` estiverem faltando, ou se o
`JWT_SECRET` ainda for o texto de exemplo. É proposital: melhor falhar no start, com
mensagem clara, do que quebrar no primeiro login. Gere o segredo com:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Deploy no EasyPanel

1. Suba este projeto num repositório Git.
2. No EasyPanel, crie um serviço PostgreSQL (ou use um existente) e copie a `DATABASE_URL`.
3. Crie um serviço de app a partir do repositório — o `Dockerfile` já está pronto.
4. Configure as variáveis: `DATABASE_URL`, `JWT_SECRET`, `NODE_ENV=production`, `ADMIN_NAME`,
   `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `PORT` (opcional, padrão 3000).
5. Aponte o domínio e pronto.

`NODE_ENV=production` é o que liga o cookie de sessão seguro (só via HTTPS) e o HSTS.
Não deixe de configurá-lo.

### Sobre as migrações

O `Dockerfile` roda `node src/migrate.js` antes de subir o servidor. A migração:

- espera o Postgres ficar disponível (até 20 tentativas) antes de desistir;
- aplica cada arquivo de `migrations/` **uma única vez**, controlado pela tabela `schema_migrations`;
- só aplica a carga inicial de taxas se a tabela `rates` estiver vazia — deploys seguintes
  nunca sobrescrevem taxas ajustadas à mão;
- cria o usuário admin apenas se aquele e-mail ainda não existir.

O primeiro deploy depois desta versão vai aplicar as migrações `003` a `006` e registrar as
antigas. A `006` **remove** as colunas `annual_multiplier` e `period_label` de `prazos`, que
eram código morto (detalhes em ANALISE.md, item 1.4). **Todos os usuários serão desconectados uma vez** (o formato do token
mudou) e precisarão entrar de novo. As taxas já cadastradas são preservadas.

Para uma migração nova, crie `migrations/007_xxx.sql` — ela é detectada e aplicada sozinha.

## Como usar

### Cadastro de taxas
Menu **Cadastro de Taxas** → escolha categoria (SUB/SITE), bandeira e prazo → preencha a taxa
GP4 (%) de cada tipo de pagamento → Salvar. Deixe em branco para remover uma taxa.

Valores precisam ficar entre 0% e 100% e ter **no máximo 2 casas decimais** — é o que o banco
guarda, e recusar é melhor do que arredondar calado um número que vai para a proposta do
cliente. Se qualquer campo estiver inválido, **nada é salvo** e a tela volta com o erro
apontado, preservando o que você digitou.

O campo lê no padrão brasileiro: vírgula é decimal, ponto é milhar. `1,98` é 1,98%; `1.985`
é lido como 1985% e será recusado por estar fora da faixa.

#### Histórico

**Ver histórico** (no topo da tela) mostra toda alteração de taxa já feita: quando, quem
alterou, qual taxa e de quanto para quanto. Dá para filtrar por categoria.

Serve para reconstruir a taxa que valia quando uma proposta antiga foi montada. Cobre também
o PIX. Salvar o formulário sem editar nada não gera registro.

#### PIX e outros meios sem bandeira

O PIX não passa por bandeira nem por prazo: cai sempre em D+1 e não parcela. Por isso ele fica
no card **Outros meios de pagamento**, no fim da tela — uma taxa por categoria, e só. Hoje o PIX
só existe na SUB (é da maquininha), então aparece um campo só.

A taxa dele **nasce em branco**: não há carga inicial, porque nenhum número inventado deve ir
para a proposta do cliente. Enquanto estiver vazia, a calculadora mostra "não cadastrada" na
linha do PIX.

Para acrescentar outro meio sem bandeira no futuro, basta uma linha em `FLAT_METHODS`
(`src/migrate.js`) e, se ele não valer para todas as categorias, a restrição em
`src/lib/flatMethodRules.js`. Não precisa mexer em schema.

### Calculadora
Menu **Calculadora** → escolha categoria, prazo e bandeira → informe o valor médio de vendas →
para cada tipo de pagamento, preencha a taxa que o cliente paga hoje e o **% de Vendas** (a
fatia do faturamento que passa por ali; deixe em branco se ele não usa). O sistema calcula
diferença, economia no período e projeção anual.

O PIX entra como mais uma linha da tabela: participa do rateio de "% de Vendas" e soma nos
totais. Trocar prazo ou bandeira não mexe nele.

O que você digitou **não é apagado** ao trocar categoria, prazo ou bandeira — dá para comparar
D+1 com D+30 para o mesmo cliente sem redigitar tudo.

Se a soma de "% de Vendas" não fechar 100%, aparece um aviso acima dos totais dizendo quanto
falta (ou quanto passou) e o que isso significa para os números. **Esse aviso também sai na
impressão** — proposta calculada sobre rateio errado não deve chegar ao cliente sem
sinalização.

O botão **Imprimir / Salvar PDF** gera um resumo limpo — linhas sem "% de Vendas" preenchido
não aparecem na impressão.

### Usuários
Menu **Usuários** (visível para quem tem a permissão).

- **Administrador** acessa todas as telas, sempre.
- **Usuário comum** acessa apenas as telas marcadas no cadastro dele.

O bloqueio vale no servidor, não só no menu: quem não tem a permissão recebe 403 mesmo
digitando a URL direto.

Regras de proteção:
- ninguém rebaixa ou desativa a própria conta;
- o último administrador ativo não pode ser rebaixado nem excluído;
- um usuário comum com permissão de Usuários gerencia apenas outros usuários comuns — não
  cria nem edita administradores.

Trocar a senha ou desativar uma conta derruba as sessões daquele usuário imediatamente, em
todos os dispositivos. Mudanças de permissão também valem na hora, sem precisar relogar.

Para bloquear alguém temporariamente, desmarque **Conta ativa** em vez de excluir.

## Estrutura

```
src/
  config.js            → valida as variáveis de ambiente e aborta se faltar alguma
  server.js            → entrada da aplicação (helmet, CSP, error handler, /health)
  db.js                → pool de conexão PostgreSQL
  migrate.js           → migrações versionadas + carga inicial
  middleware/auth.js   → sessão JWT, carga do usuário e checagem de permissão
  lib/
    asyncHandler.js    → captura Promise rejeitada nos handlers (Express 4 não faz isso)
    screens.js         → telas do sistema e regra de permissão
    paymentTypeRules.js→ SITE não opera acima de 18x
    prazoRules.js      → SUB não opera D+0
    flatMethodRules.js → PIX só existe na SUB
  routes/              → auth, rates, calculator, users
  views/               → EJS
  public/              → CSS e JS do front
migrations/            → schema SQL, aplicado uma vez cada
```

## Endpoint de saúde

`GET /health` (sem autenticação) responde `200 {"status":"ok"}` ou `503` se o banco não
responder. É o que o `HEALTHCHECK` do container consulta.
