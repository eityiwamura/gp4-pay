const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { rateLimit } = require('express-rate-limit');
const pool = require('../db');
const config = require('../config');
const asyncHandler = require('../lib/asyncHandler');

const router = express.Router();

// Hash descartável usado quando o e-mail não existe. Sem ele, a resposta volta na hora
// (não passa pelo bcrypt) e a diferença de tempo revela quais e-mails estão cadastrados.
const DUMMY_HASH = bcrypt.hash('gp4-taxas-conta-inexistente', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res) => {
    res.status(429).render('login', {
      error: 'Muitas tentativas de login. Aguarde 15 minutos e tente novamente.',
      email: req.body?.email || '',
    });
  },
});

router.get('/login', (req, res) => {
  if (req.cookies.token) return res.redirect('/');
  res.render('login', { error: null, email: '' });
});

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  const fail = () => res.status(401).render('login', {
    error: 'E-mail ou senha inválidos.',
    email,
  });

  const result = await pool.query(
    'SELECT id, name, email, password_hash, role, active, token_version FROM users WHERE email = $1',
    [email]
  );
  const user = result.rows[0];

  if (!user) {
    await bcrypt.compare(password, await DUMMY_HASH);
    return fail();
  }

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return fail();

  if (!user.active) {
    return res.status(403).render('login', {
      error: 'Esta conta está desativada. Fale com o administrador.',
      email,
    });
  }

  const token = jwt.sign({ id: user.id, tv: user.token_version }, config.jwtSecret, {
    expiresIn: '7d',
  });

  res.cookie('token', token, {
    httpOnly: true,
    maxAge: config.tokenMaxAgeMs,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
  });
  res.redirect('/');
}));

router.post('/logout', (req, res) => {
  res.clearCookie('token', { path: '/' });
  res.redirect('/login');
});

module.exports = router;
