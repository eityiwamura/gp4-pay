const config = require('./config'); // valida as variáveis de ambiente e aborta se faltar alguma
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');

const pool = require('./db');
const authRoutes = require('./routes/auth');
const ratesRoutes = require('./routes/rates');
const calculatorRoutes = require('./routes/calculator');
const usersRoutes = require('./routes/users');
const { requireAuth } = require('./middleware/auth');
const { can } = require('./lib/screens');

const app = express();

// O EasyPanel coloca um proxy na frente. Sem isso, o rate limit enxerga o IP do proxy
// (um só para todo mundo) e o cookie `secure` não é avaliado corretamente.
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      // As views usam muito atributo style="..." inline; scripts inline foram todos removidos.
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      upgradeInsecureRequests: config.isProduction ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
}));

app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: config.isProduction ? '7d' : 0 }));

app.use((req, res, next) => {
  res.locals.user = null;
  res.locals.can = can; // usado pela sidebar e pelo dashboard para esconder o que não é permitido
  next();
});

// Usado pelo healthcheck do container: não exige login e confirma que o banco responde.
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: 'banco indisponível' });
  }
});

app.use(authRoutes);
app.use(ratesRoutes);
app.use('/calculator', calculatorRoutes);
app.use('/users', usersRoutes);

app.get('/', requireAuth, (req, res) => {
  res.render('dashboard');
});

app.use((req, res) => {
  res.status(404).render('error', { message: 'Página não encontrada.' });
});

// Rede de segurança: qualquer erro (inclusive Promise rejeitada capturada pelo
// asyncHandler) termina aqui, com resposta de verdade em vez de requisição pendurada.
app.use((err, req, res, next) => {
  console.error('Erro não tratado:', err);
  if (res.headersSent) return next(err);
  if (req.originalUrl.includes('/api/')) {
    return res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  }
  res.status(500).render('error', {
    message: 'Tivemos um problema ao processar esta página. Tente novamente em instantes.',
  });
});

const server = app.listen(config.port, () => {
  console.log(`GP4 Taxas rodando na porta ${config.port} (NODE_ENV=${process.env.NODE_ENV || 'development'})`);
});

// O EasyPanel manda SIGTERM no redeploy: fecha o que está em andamento antes de sair.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    console.log(`${signal} recebido, encerrando...`);
    server.close(() => pool.end().then(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
