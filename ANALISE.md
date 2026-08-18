# GP4 Taxas — Análise técnica e plano de melhorias

Análise inicial: 17/08/2026 · Última atualização: 17/08/2026 (Fases 1 e 2 + gestão de usuários + PIX)
Escopo: Node 20 + Express 4 + PostgreSQL + EJS + JWT.

---

## Resumo executivo

O sistema é pequeno, coerente e faz o que promete. A modelagem de dados está correta
(`categories × prazos × payment_types × payment_brands → rates`), as regras de negócio
estão isoladas em `src/lib/`, e a migração é idempotente.

Os problemas se concentravam em três frentes:

1. **Robustez** — rotas `async` sem captura de erro travavam a requisição. **Resolvido.**
2. **Operação** — sem gestão de usuários, sem histórico de taxas, migração destrutiva a
   cada deploy. **Resolvido.**
3. **Produto** — a calculadora não salva nada. **Em aberto e reduzido** (Fase 3).

---

## Estado atual

| # | Item | Prioridade | Status |
|---|------|-----------|--------|
| 1.1 | Rotas `async` sem tratamento de erro | Crítico | **Feito** |
| 1.2 | Sem validação de faixa nas taxas | Alto | **Feito** |
| 1.3 | Precisão da taxa limitada a 2 casas | Médio | **Feito** — 2 casas confirmadas, campo recusa mais |
| 1.4 | `annual_multiplier` é código morto | Médio | **Feito** — colunas removidas |
| 1.5 | `migrate.js` apaga dados a cada deploy | Médio | **Feito** |
| 1.6 | Dockerfile ignora lockfile / sem `NODE_ENV` | Baixo | **Feito** |
| 2.1 | Cookie de sessão sem `secure` | Alto | **Feito** |
| 2.2 | Login sem rate limiting | Alto | **Feito** |
| 2.3 | `JWT_SECRET` sem verificação no boot | Médio | **Feito** |
| 2.4 | Sem `helmet`, sem CSP | Médio | **Feito** |
| 2.5 | Token de 7 dias sem revogação | Baixo | **Feito** |
| 2.6 | CSRF | Baixo | Aberto |
| 3.1 | Não existe gestão de usuários | Alto | **Feito** |
| 3.2 | ~~Calculadora trabalha uma bandeira por vez~~ | — | **Descartado** (cliente não usa as 3 juntas) |
| 3.3 | Nenhuma simulação é salva | ~~Alto~~ Médio | Aberto — reduzido; confirmar se ainda vale |
| 3.4 | Sem histórico de alteração de taxas | Médio | **Feito** |
| 3.5 | Faltam meios de pagamento | Médio | **Feito** — PIX entregue, boleto descartado |
| 3.6 | Sem exportação de proposta decente | Médio | Aberto — Fase 3 |
| 4.1 | Cursor pula para o fim a cada tecla | Alto | **Feito** |
| 4.2 | Tabela sem scroll horizontal no celular | Médio | **Feito** |
| 4.3 | Fontes via `@import` | Médio | Aberto — Fase 4 |
| 4.4 | Bloqueio de campos ao atingir 100% | Médio | **Feito** |
| 4.5 | `alert()` para validar rateio | Médio | **Feito** |
| 4.6 | Emojis na interface | Baixo | **Feito** |
| 4.7 | Login retorna 200 em vez de 401 | Baixo | **Feito** |
| 4.8 | Impressão pode estourar para 2ª folha | Médio | **Feito** — shrink-to-fit + título visível |
| 5 | Zero testes / cálculo acoplado ao DOM | — | Aberto — Fase 3 |

---

## 1. Correção e robustez

### 1.1 FEITO — Rotas `async` sem tratamento de erro (Express 4)

Express 4 não captura `Promise` rejeitada dentro de um handler. Nenhuma rota tinha
`try/catch` nas queries de leitura. Se o Postgres reiniciasse, a rejeição virava
`unhandledRejection` e **a resposta nunca era enviada**: o usuário via a página carregando
para sempre e a calculadora ficava presa em "Carregando taxas...".

Corrigido com `src/lib/asyncHandler.js` envolvendo todos os handlers, mais um error handler
global de 4 argumentos em `src/server.js`, que responde 500 com página amigável (ou JSON,
se a rota for de API). Verificado com o banco desligado: a requisição responde em vez de pendurar.

### 1.2 FEITO — Sem validação de faixa nas taxas cadastradas

`parseFloat` aceitava `-5`, `900`, `1e9`. Uma taxa negativa ou de 900% entrava no banco e
ia direto para a proposta mostrada ao cliente.

Agora `src/routes/rates.js` valida **tudo antes de tocar no banco**: cada campo precisa ser
número entre 0% e 100%. Um único campo errado cancela o salvamento inteiro e devolve a tela
com a mensagem e os valores digitados — em vez de gravar metade da tabela.

### 1.3 FEITO — Precisão da taxa

`gp4_rate NUMERIC(7,4)` guarda o valor em decimal, o que dá exatamente **2 casas no
percentual**. Você confirmou que 2 casas bastam comercialmente, então o schema está certo
como está — o problema era outro: digitar `1,985%` gravava 1,99% **sem avisar ninguém**.

Agora o campo recusa. `parseRateField` valida a quantidade de casas antes de gravar e
devolve a tela com a mensagem, preservando o que foi digitado:

> A taxa de Débito aceita no máximo 2 casas decimais (informado: 1,985).

Zeros à direita não perdem precisão, então `1,50` e `1,500` passam; `1,985` não. Vale nas
duas telas de cadastro (taxas comuns e PIX) porque ambas usam o mesmo validador.

Detalhe de formato que fica registrado: o campo lê no padrão pt-BR, onde ponto é separador
de milhar. Digitar `1.985` é lido como 1985% e cai no erro de faixa (0% a 100%), não no de
casas decimais. Quem quer 1,985 tem que usar vírgula — e aí recebe o erro certo.

### 1.4 FEITO — `annual_multiplier` e `period_label` eram código morto

`prazos.annual_multiplier` (365/12/365) foi criada para projetar a economia anual a partir
do prazo de recebimento GP4. Mas a projeção nunca veio daí: vem do período do volume que o
vendedor informa ("o cliente vende R$ 100 mil por mês" → x12). São grandezas independentes —
quanto o cliente fatura por mês não tem relação com a GP4 pagar em D+1 ou D+30.

Ou seja: não era só código não usado, era um campo que **sugeria um comportamento inexistente**.
Quem fosse dar manutenção mexeria nele esperando mudar o cálculo, e não mudaria nada.

`period_label` ('por dia', 'por mês') vinha da mesma confusão e só aparecia no texto dos cards
de Cadastro de Taxas, onde dava a entender que a taxa era cobrada por dia.

As duas colunas foram removidas (migração `006`). O botão "Por dia / Por mês" da calculadora,
que é o modelo correto, continua igual.

Aproveitando o mesmo texto do card: ele dizia "Débito + Crédito 1x a 24x" para as duas
categorias, mas a SITE só vai até 18x. Agora o limite é calculado por categoria.

### 1.5 FEITO — `migrate.js` apagava dados a cada deploy

O `Dockerfile` roda a migração em todo start do container. A cada start ela reaplicava os
`.sql`, reexecutava ~900 inserts do seed e **deletava** as taxas restritas (19x–24x na SITE,
D+0 na SUB) — destrutivo e silencioso.

Agora existe uma tabela `schema_migrations`: cada `.sql` roda **uma vez**, o seed de taxas
só é aplicado se a tabela `rates` estiver vazia, e a limpeza das combinações restritas virou
uma etapa `data/002_limpar_combinacoes_restritas` registrada e executada uma única vez.
A migração também espera o Postgres ficar disponível (20 tentativas) antes de desistir, em
vez de derrubar o container em loop enquanto o banco sobe.

A regra de negócio continua garantida no salvamento — o que mudou é que ela não apaga mais
dados históricos a cada deploy.

### 1.6 FEITO — Dockerfile

`COPY package*.json` + `npm ci --omit=dev` (usa o lockfile), `ENV NODE_ENV=production`,
`USER node` (não roda como root) e `HEALTHCHECK` apontando para `/health`.

---

## 2. Segurança

### 2.1 FEITO — Cookie de sessão sem `secure`
`secure: config.isProduction` no cookie e `app.set('trust proxy', 1)` no servidor —
necessário porque o EasyPanel põe um proxy na frente.

### 2.2 FEITO — Login sem rate limiting
`express-rate-limit`: 10 tentativas por IP a cada 15 minutos, com tela explicando o bloqueio.
Verificado: a 11ª tentativa recebe 429.

O e-mail inexistente agora também passa por um `bcrypt.compare` descartável, para que o tempo
de resposta não revele quais e-mails estão cadastrados.

### 2.3 FEITO — `JWT_SECRET` sem verificação no boot
`src/config.js` valida na inicialização e **aborta** se `DATABASE_URL` ou `JWT_SECRET`
faltarem, ou se o segredo ainda for o texto de exemplo do `.env.example`. Avisa (sem abortar)
se o segredo tiver menos de 32 caracteres.

### 2.4 FEITO — Sem `helmet`, sem CSP
`helmet()` com CSP restritiva. Todos os `<script>` inline e `onclick` foram removidos das
views (a configuração da calculadora agora vai por `data-attribute`), então a CSP **não
precisa liberar script inline**. HSTS ativo só em produção.

### 2.5 FEITO — Token sem revogação
O JWT carrega apenas `{ id, tv }`. Nome, papel e permissões são lidos do banco a cada
requisição, e `tv` é comparado com `users.token_version`. Efeitos:

- desativar uma conta derruba a sessão **na hora**;
- trocar a senha derruba as sessões abertas em todos os dispositivos;
- mudar as permissões de alguém vale imediatamente, sem precisar relogar.

Custo: duas queries triviais por requisição. Irrelevante nesta escala.

### 2.6 ABERTO — CSRF
Os POSTs não têm token CSRF. O `sameSite: 'lax'` bloqueia POST cross-site na prática, então
o risco é baixo — mas é uma proteção que depende de um único mecanismo.

---

## 3. Lacunas funcionais

### 3.1 FEITO — Gestão de usuários

Antes: criar vendedor exigia `INSERT` manual no banco, com hash bcrypt gerado à parte.

Agora existe a tela **Usuários** com criação, edição, troca de senha, ativação/desativação e
exclusão. O modelo de permissão é o que você pediu:

- **Administrador** acessa todas as telas, sempre.
- **Usuário comum** acessa só as telas marcadas pelo administrador (Calculadora, Cadastro de
  Taxas, Gestão de Usuários — a lista cresce sozinha conforme novas telas entrarem em
  `src/lib/screens.js`).

O bloqueio é no servidor, não só no menu: um vendedor que digitar `/rates` na barra de
endereços, ou que montar um POST à mão, recebe 403.

Guardas contra tiro no pé, todas verificadas em teste:

- ninguém rebaixa ou desativa a própria conta;
- o último administrador ativo não pode ser rebaixado nem excluído;
- um usuário comum **com** permissão de Usuários gerencia apenas outros usuários comuns —
  não cria administrador nem edita um. Sem isso, a permissão viraria um caminho livre para
  auto-promoção, que é exatamente o padrão de falha que aparece nos outros sistemas.

### 3.2 DESCARTADO — Mix de bandeiras
Você confirmou que o cliente não transaciona nas três bandeiras ao mesmo tempo. Uma bandeira
por simulação está correto e o item sai do plano.

### 3.3 ABERTO (reduzido) — Nenhuma simulação é salva

A calculadora continua 100% volátil: recarregou a página, perdeu tudo. Não dá para retomar
uma proposta nem reenviá-la com as taxas atualizadas.

**Guardar as taxas da concorrência foi descartado** (decisão de 17/08/2026). Era o
subproduto mais valioso da ideia original — inteligência de mercado sobre o que os
concorrentes praticam por segmento — mas sai do escopo.

O que sobra é a justificativa operacional, e ela é mais modesta: evitar que o vendedor
redigite tudo quando o cliente pede a proposta de novo, ou quando a tabela GP4 muda e a
proposta precisa ser refeita.

**Se sobrar valor, a versão enxuta seria:** tabela `simulations` guardando apenas o
necessário para recarregar a tela (cliente, vendedor, categoria/prazo/bandeira, volume,
taxas informadas, totais) + uma tela "Minhas simulações". Sem relatório, sem cruzamento,
sem análise de concorrência.

**Se não sobrar,** o item cai — e a Fase 3 vira basicamente a 3.6 (proposta apresentável)
mais os testes. Precisa da sua confirmação.

Não confundir com a Rastreabilidade (seção 6, entregue em 17/08/2026): aquela registra *que*
uma simulação aconteceu (categoria/bandeira/prazo, quem, quando), não os dados que dariam para
retomá-la (taxa do cliente, volume, rateio). São independentes — dá para decidir sobre 3.3 sem
mexer na Rastreabilidade.

### 3.4 FEITO — Histórico de alteração de taxas

`rates.updated_at` guardava só o último toque: não dizia quem mexeu nem qual era o valor
anterior. Se uma proposta de março usou 3,28% e hoje a tabela diz 3,71%, não havia como
reconstruir.

Agora existe `rate_history` (migração `005`), append-only, gravada **dentro da mesma
transação** da alteração — não existe mudança sem registro nem registro sem mudança. Guarda
quando, quem, qual taxa, de quanto para quanto. Cobre as taxas comuns e o PIX.

Tela em `/rates/historico` (link no topo do Cadastro de Taxas), com filtro por categoria.
Taxa recém-criada aparece como **nova**; taxa apagada, como **removida**.

Duas decisões de projeto:

- `user_name` e `label` são **denormalizados de propósito**. Um log de auditoria precisa
  preservar o que era verdade na hora do registro — se o usuário for excluído ou um cadastro
  renomeado, o histórico continua legível.
- Salvar o formulário sem editar nada **não gera registro**. Antes, o POST reescrevia todas as
  linhas; agora cada uma é comparada com o valor atual e só as diferentes são tocadas. Sem
  isso, o histórico encheria de ruído e ficaria inútil.

### 3.5 FEITO — Meios de pagamento

Boleto está fora (a GP4 Pay não opera). O **PIX** foi implementado.

O PIX não cabia na tabela `rates`, que é chaveada por prazo **e** bandeira: ele cai sempre
em D+1, não passa por Master/Visa/Elo e não parcela. Forçá-lo ali significaria repetir a
mesma taxa três vezes e mostrar um seletor de bandeira para algo que não tem bandeira.

Optamos pela estrutura à parte — `flat_payment_methods` + `flat_rates` (migração `004`):
uma taxa por categoria, e nada mais. A tabela é genérica, então qualquer meio futuro sem
bandeira e sem prazo entra sem mudar schema.

- **Regra:** PIX só existe na categoria SUB (é da maquininha), seguindo o mesmo padrão de
  `paymentTypeRules` e `prazoRules` — agora em `src/lib/flatMethodRules.js`.
- **Cadastro:** card "Outros meios de pagamento" em `/rates` → `/rates/metodo/PIX`. Mesma
  validação de 0% a 100% das taxas comuns, com o mesmo comportamento de "nada é salvo se
  algum campo estiver inválido".
- **Calculadora:** o PIX entra como uma linha a mais, participa do rateio de "% de Vendas"
  e soma nos totais. Trocar prazo ou bandeira não altera a linha dele.
- **Sem carga inicial:** a taxa do PIX nasce em branco, para o admin preencher — não
  inventamos um número que iria para a proposta do cliente.

Efeito colateral necessário: o que o vendedor já digitou **deixou de ser apagado** ao trocar
prazo, bandeira ou categoria. Antes, todo campo era zerado a cada troca. Com o PIX isso
viraria bug visível (a linha dele não depende de prazo, mas sumiria ao comparar D+1 com
D+30), então as chaves das linhas passaram a ser estáveis e os valores sobrevivem à troca.
Ganho de tabela: comparar dois prazos para o mesmo cliente não exige mais redigitar tudo.

### 3.6 ABERTO — Exportação de proposta

O `window.print()` funciona e o CSS de impressão está bem feito (inclusive escondendo linhas
sem alocação). Mas o resultado tem cara de página impressa, não de proposta comercial: sem
nome/CNPJ do cliente, sem data, sem nome do vendedor, sem validade.

Um bloco "Dados do cliente" no topo (que também alimenta a `simulations` da 3.3) resolve 80%
disso sem precisar gerar PDF no servidor.

---

## 4. Interface e experiência

### 4.1 FEITO — Cursor pulava para o fim a cada tecla
`renderTable()` reconstrói a tabela a cada `input` e forçava o cursor para o final do campo.
Corrigir o **meio** de um número era impossível. Agora a posição real do cursor é capturada
antes do re-render e devolvida depois. Verificado no navegador.

### 4.2 FEITO — Tabela sem scroll horizontal no celular
As tabelas largas ganharam um wrapper `.table-scroll`. Verificado em 375px: a página não rola
mais na horizontal; só a tabela rola dentro do card.

### 4.3 ABERTO — Fontes via `@import` no CSS
`@import` de Google Fonts dentro do CSS é o pior caso de performance (downloads em série,
bloqueando a renderização). Hospedar as duas fontes localmente também fecharia a última
dependência externa da CSP.

### 4.4 FEITO — Bloqueio de campos e aviso de rateio

Duas coisas ligadas, resolvidas juntas.

Os campos de "% de Vendas" vazios eram desabilitados ao chegar em 100%. Para redistribuir era
preciso zerar outra linha antes — travava a edição sem ganho nenhum. Agora tudo segue
editável (só campo de taxa não cadastrada continua desabilitado, o que faz sentido).

Mais grave: **não havia aviso quando a alocação não fechava 100%**. Alocando 60%, os totais
apareciam normalmente, só que 40% menores, e a proposta podia ser impressa assim. O único
indício era a cor do número — sutil demais para algo que vai ao cliente.

Agora há um aviso explícito acima dos totais, em dois tons:

- **incompleto:** "O rateio soma 60,00% — faltam 40,00%. Os totais abaixo consideram só a
  parte alocada, então a economia real do cliente é maior do que a mostrada."
- **acima de 100%:** "O rateio soma 130,00%, acima de 100%. Os totais abaixo estão
  superestimados em 30,00%. Revise antes de apresentar ao cliente."

Em 100% exatos o aviso some. **O aviso sai também na impressão**, de propósito: uma proposta
calculada sobre rateio errado não deve chegar ao cliente sem sinalização. Se incomodar, é uma
linha de CSS para escondê-lo — mas o padrão seguro é avisar.

### 4.5 FEITO — Fim do `alert()`
Passar de 100% abria um `alert()` nativo que bloqueava a página **e apagava o que a pessoa
tinha acabado de digitar**. Agora o valor é aceito e o aviso da 4.4 assume o recado.

### 4.6 FEITO — Emojis na interface
Todos os emojis (🏠 🧮 ⚙️ 📋 🖨️ 👋) foram trocados por SVG monocromáticos inline
(`src/views/partials/icon.ejs`), que herdam a cor do contexto. Além de renderizarem igual em
qualquer sistema, não deixam mais cara amadora no PDF que vai para o cliente.

### 4.8 FEITO — Impressão sempre em 1 folha A4

O CSS de impressão já era compacto, mas era uma aposta, não uma garantia: com todos os 26
tipos de pagamento preenchidos (pior caso), o conteúdo ficava com 1719px de altura contra
1047px de página útil — estouraria para uma 2ª folha.

Agora `calculator.js` escuta `beforeprint`/`afterprint`: mede a altura real do `.container`
no momento de imprimir e, só se não couber, aplica `transform: scale()` com compensação de
largura (`width: 100/scale%`) para encolher tudo proporcionalmente e caber em uma página.
Nunca amplia — conteúdo curto imprime no tamanho normal.

Verificado nos dois extremos: com poucas linhas o scale fica em 1.000 (sem encolher); com as
26 linhas preenchidas, o cálculo fecha em ~0.61, dentro do que o navegador consegue aplicar
via `transform`. Não deu para automatizar o diálogo de impressão real do navegador aqui —
recomendo um teste manual (Ctrl+P → Salvar como PDF) antes de confiar de olhos fechados.

De quebra, corrigi um bug: o título "Comparativo por tipo de pagamento" estava dentro do
mesmo bloco `no-print` que o botão de imprimir, então sumia da folha impressa — o cliente via
a tabela sem saber o que ela representava. Separado agora; só o botão fica oculto.

### 4.7 FEITO — Detalhes de login
Credencial errada agora retorna 401 (era 200) e o e-mail digitado é repopulado. Conta
desativada recebe mensagem própria em vez de "e-mail ou senha inválidos".

---

## 5. Qualidade de código — ABERTO

- **Zero testes no repositório.** O cálculo de economia é a razão de existir do sistema e não
  tem verificação automática. (As mudanças desta rodada foram validadas por scripts de teste
  temporários — 47 verificações ponta a ponta, incluindo permissões, validação de taxas e
  invalidação de sessão — mas esses scripts não ficaram no projeto porque exigem uma
  dependência de banco em memória. Vale trazê-los para dentro na Fase 3.)
- **Lógica de cálculo acoplada ao DOM.** `renderTable()` faz parse, cálculo, formatação e
  renderização na mesma função. Extrair `calcularEconomia(entrada) → saída` deixaria o cálculo
  testável e reaproveitável no servidor — necessário para 3.3 e 3.6.
- **Sem linter/formatter**, sem CI.

---

## 6. Rastreabilidade — funcionalidade nova, fora do plano original (17/08/2026)

Pedido do usuário, não fazia parte do levantamento inicial: uma tela só para administradores
mostrando as ações de todos os usuários — login, navegação, simulações, alterações de
cadastro.

**Modelagem:** tabela `activity_log` (migração `007`), append-only, mesmo padrão do
`rate_history` (7.4): `user_name` denormalizado para o registro continuar legível mesmo se o
usuário for excluído depois; `user_id` com `ON DELETE SET NULL`.

**Acesso:** deliberadamente **não** é uma permissão concedível como Calculadora/Cadastro de
Taxas/Usuários. Passa por `requireAdmin` (papel = admin), não por `requirePermission` +
`user_permissions`. Motivo: essa tela expõe o IP e o comportamento de todo mundo, inclusive de
outros administradores — bem diferente de liberar alguém para usar a Calculadora. Se isso
virasse uma permissão concedível, um usuário comum promovido por engano (ou por um admin
descuidado) passaria a espionar os colegas.

**O que é registrado**, com quem, quando e IP: login (sucesso e falha, inclusive tentativa em
conta desativada — user_id fica nulo e o e-mail tentado vira `user_name`, útil para detectar
força bruta), logout, toda tela acessada, simulação concluída na calculadora, alteração de
taxas (com contagem — nada é gravado se o formulário for salvo sem mudanças), criação/edição/
exclusão de usuário, e tentativa de acesso sem permissão.

**O que deliberadamente NÃO é registrado**, e por quê:
- **As chamadas de `/calculator/api/rates/...`** (uma a cada clique de categoria/prazo/
  bandeira) não geram log de navegação — seriam dezenas por sessão e afogariam o sinal útil.
  O evento que representa "usou a calculadora de verdade" é outro, abaixo.
- **A simulação** (endpoint `POST /calculator/api/log-simulation`, disparado ao clicar em
  Imprimir/Salvar PDF) grava só `categoria · bandeira · prazo`. **Nunca** a taxa que o cliente
  paga hoje, o volume informado, nem o rateio. Essa é a mesma linha que você já tinha puxado
  em 17/08/2026 ao decidir não guardar taxa de concorrência (ver 3.3) — a Rastreabilidade
  não reabre essa decisão, só registra *que* uma simulação aconteceu, não o conteúdo dela.
  Se no futuro você quiser reconsiderar 3.3 (guardar a simulação inteira para retomar depois),
  são coisas independentes: dá para ligar uma sem a outra.

**Verificado:** 46 testes ponta a ponta (login/logout, as 6 telas de navegação, alteração de
taxa comum e de PIX com contagem certa, criação/edição/exclusão de usuário, o endpoint de
simulação confirmando que a tabela nunca teve coluna de taxa/volume, bloqueio de vendedor
tanto por `requirePermission` quanto por `requireAdmin`, filtro por usuário na tela, e que
excluir um usuário preserva o nome no rastro em vez de apagá-lo). No navegador: o clique real
no botão Imprimir gerou a linha "Fez uma simulação · SUB · Master · D+1" na tela.

---

## 7. O que vem a seguir

**Fase 2 — Operação** — concluída.

**Fase 3 — Produto** (próxima)
1. Extrair o cálculo para módulo puro + trazer os testes para o repositório
2. Bloco de dados do cliente e proposta apresentável (3.6)
3. *(a confirmar)* Salvar simulações, versão enxuta — só para retomar proposta (3.3)

**Fase 4 — Acabamento**
4. Fontes locais (4.3), token CSRF (2.6)

---

## Decisões que ainda dependem de você

1. **Salvar simulações ainda vale, mesmo sem os dados de concorrência?** (3.3) — sobraria só
   o "retomar proposta sem redigitar". Se não valer, o item sai e a Fase 3 encolhe.
2. **Quantos vendedores vão usar?** Ajuda a calibrar o limite de tentativas de login (hoje 10
   a cada 15 min por IP — se todos saírem do mesmo escritório, dividem o mesmo IP).
3. **O aviso de rateio deve mesmo sair na impressão?** Hoje sai (ver 4.4). É o padrão seguro,
   mas se a proposta for muito formal talvez você prefira escondê-lo.
