const jwt = require('jsonwebtoken');
const pool = require('../db');
const config = require('../config');
const { can } = require('../lib/screens');
const { logActivityBestEffort } = require('../lib/activityLog');

// O token carrega só o id e a versão. Nome, papel e permissões vêm do banco a cada
// requisição — assim, mudar a permissão de alguém (ou desativar a conta) tem efeito
// imediato, sem depender de o usuário fazer login de novo.
async function loadUser(id) {
  const { rows } = await pool.query(
    'SELECT id, name, email, role, active, token_version FROM users WHERE id = $1',
    [id]
  );
  const user = rows[0];
  if (!user) return null;

  const perms = await pool.query(
    'SELECT screen FROM user_permissions WHERE user_id = $1 ORDER BY screen',
    [id]
  );
  user.permissions = perms.rows.map(r => r.screen);
  return user;
}

function wantsJson(req) {
  return req.originalUrl.includes('/api/');
}

function rejectUnauthenticated(req, res) {
  res.clearCookie('token');
  if (wantsJson(req)) return res.status(401).json({ error: 'Sessão expirada. Entre novamente.' });
  return res.redirect('/login');
}

async function requireAuth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return rejectUnauthenticated(req, res);

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch (err) {
    return rejectUnauthenticated(req, res);
  }

  let user;
  try {
    user = await loadUser(payload.id);
  } catch (err) {
    return next(err); // banco fora do ar: erro 500 honesto, não "faça login de novo"
  }

  // Conta apagada, desativada, ou token emitido antes da última troca de senha.
  if (!user || !user.active || user.token_version !== payload.tv) {
    return rejectUnauthenticated(req, res);
  }

  req.user = user;
  res.locals.user = user;
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    logActivityBestEffort({
      userId: req.user?.id, userName: req.user?.name,
      action: 'access_denied', detail: req.originalUrl, ip: req.ip,
    });
    return res.status(403).render('error', { message: 'Acesso restrito ao administrador.' });
  }
  next();
}

// Bloqueia a tela inteira quando o usuário comum não tem aquela permissão.
function requirePermission(screenKey) {
  return function (req, res, next) {
    if (can(req.user, screenKey)) return next();
    logActivityBestEffort({
      userId: req.user?.id, userName: req.user?.name,
      action: 'access_denied', detail: screenKey, ip: req.ip,
    });
    if (wantsJson(req)) return res.status(403).json({ error: 'Você não tem acesso a esta função.' });
    return res.status(403).render('error', {
      message: 'Você não tem acesso a esta tela. Fale com o administrador.',
    });
  };
}

module.exports = { requireAuth, requireAdmin, requirePermission, loadUser };
