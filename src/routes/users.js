const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { SCREENS, parseScreens } = require('../lib/screens');

const router = express.Router();

const MIN_PASSWORD = 8;
const ROLES = ['admin', 'vendedor'];

router.use(requireAuth, requirePermission('users'));

async function listUsers() {
  const users = (await pool.query(
    `SELECT id, name, email, role, active, created_at FROM users ORDER BY active DESC, name`
  )).rows;

  const perms = (await pool.query('SELECT user_id, screen FROM user_permissions ORDER BY screen')).rows;
  const byUser = new Map();
  for (const p of perms) {
    if (!byUser.has(p.user_id)) byUser.set(p.user_id, []);
    byUser.get(p.user_id).push(p.screen);
  }

  return users.map(u => ({ ...u, permissions: byUser.get(u.id) || [] }));
}

async function findUser(id) {
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return null;

  const { rows } = await pool.query(
    'SELECT id, name, email, role, active FROM users WHERE id = $1',
    [numericId]
  );
  const user = rows[0];
  if (!user) return null;

  const perms = await pool.query(
    'SELECT screen FROM user_permissions WHERE user_id = $1 ORDER BY screen',
    [numericId]
  );
  user.permissions = perms.rows.map(r => r.screen);
  return user;
}

async function countActiveAdmins(client = pool, exceptId = null) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM users WHERE role = 'admin' AND active = true AND ($1::int IS NULL OR id <> $1)`,
    [exceptId]
  );
  return rows[0].n;
}

// Valida o formulário. Devolve { data, errors } — nunca lança.
function readForm(req, { isNew }) {
  const errors = [];
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const role = ROLES.includes(req.body.role) ? req.body.role : 'vendedor';
  const active = req.body.active === 'on' || req.body.active === 'true';
  const permissions = parseScreens(req.body.screens);

  if (name.length < 2) errors.push('Informe o nome do usuário.');
  if (name.length > 120) errors.push('O nome pode ter no máximo 120 caracteres.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Informe um e-mail válido.');
  if (email.length > 160) errors.push('O e-mail pode ter no máximo 160 caracteres.');

  if (isNew || password !== '') {
    if (password.length < MIN_PASSWORD) {
      errors.push(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres.`);
    }
  }

  // Só administrador cria ou promove outro administrador. Um usuário comum com acesso
  // à tela de usuários gerencia apenas usuários comuns — senão a permissão vira um
  // caminho livre para virar admin.
  if (role === 'admin' && req.user.role !== 'admin') {
    errors.push('Apenas um administrador pode criar ou promover outro administrador.');
  }

  if (role === 'vendedor' && permissions.length === 0) {
    errors.push('Selecione pelo menos uma tela para o usuário acessar.');
  }

  return {
    data: { name, email, password, role, active, permissions },
    errors,
  };
}

async function replacePermissions(client, userId, role, permissions) {
  await client.query('DELETE FROM user_permissions WHERE user_id = $1', [userId]);
  // Admin vê tudo por definição; guardar linhas para ele só criaria estado contraditório.
  if (role === 'admin') return;
  // São no máximo 3 telas: um INSERT por linha é mais simples de ler e de conferir
  // do que montar array e dar unnest.
  for (const screen of permissions) {
    await client.query(
      'INSERT INTO user_permissions (user_id, screen) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [userId, screen]
    );
  }
}

function renderForm(res, status, { user, errors, saved }) {
  return res.status(status).render('users-form', {
    screens: SCREENS,
    formUser: user,
    errors: errors || [],
    saved: saved || false,
    minPassword: MIN_PASSWORD,
  });
}

router.get('/', asyncHandler(async (req, res) => {
  res.render('users-index', {
    users: await listUsers(),
    screens: SCREENS,
    created: req.query.created === '1',
    updated: req.query.updated === '1',
    deleted: req.query.deleted === '1',
  });
}));

router.get('/new', (req, res) => {
  renderForm(res, 200, {
    user: { id: null, name: '', email: '', role: 'vendedor', active: true, permissions: ['calculator'] },
  });
});

router.post('/', asyncHandler(async (req, res) => {
  const { data, errors } = readForm(req, { isNew: true });

  if (errors.length > 0) {
    return renderForm(res, 400, { user: { id: null, ...data }, errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hash = await bcrypt.hash(data.password, 10);
    const inserted = await client.query(
      `INSERT INTO users (name, email, password_hash, role, active) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [data.name, data.email, hash, data.role, data.active]
    );
    await replacePermissions(client, inserted.rows[0].id, data.role, data.permissions);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return renderForm(res, 409, {
        user: { id: null, ...data },
        errors: ['Já existe um usuário com este e-mail.'],
      });
    }
    throw err;
  } finally {
    client.release();
  }

  res.redirect('/users?created=1');
}));

router.get('/:id/edit', asyncHandler(async (req, res) => {
  const target = await findUser(req.params.id);
  if (!target) return res.status(404).render('error', { message: 'Usuário não encontrado.' });
  if (target.role === 'admin' && req.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Apenas um administrador pode editar outro administrador.' });
  }
  renderForm(res, 200, { user: target, saved: req.query.saved === '1' });
}));

router.post('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const target = await findUser(id);
  if (!target) return res.status(404).render('error', { message: 'Usuário não encontrado.' });
  if (target.role === 'admin' && req.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Apenas um administrador pode editar outro administrador.' });
  }

  const { data, errors } = readForm(req, { isNew: false });
  const isSelf = id === req.user.id;

  // Evita que alguém se tranque para fora do próprio sistema.
  if (isSelf && (!data.active || data.role !== target.role)) {
    errors.push('Você não pode alterar o seu próprio papel nem desativar a sua própria conta.');
  }

  // E que o último administrador ativo desapareça.
  if (target.role === 'admin' && (data.role !== 'admin' || !data.active)) {
    if (await countActiveAdmins(pool, id) === 0) {
      errors.push('Este é o último administrador ativo. Promova outro usuário antes de alterar este.');
    }
  }

  if (errors.length > 0) {
    return renderForm(res, 400, { user: { id, ...data }, errors });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Trocar a senha ou desativar a conta derruba as sessões abertas daquele usuário.
    const invalidateSessions = data.password !== '' || (target.active && !data.active);

    if (data.password !== '') {
      const hash = await bcrypt.hash(data.password, 10);
      await client.query(
        `UPDATE users SET name=$1, email=$2, role=$3, active=$4, password_hash=$5,
                          token_version = token_version + 1, updated_at = now()
         WHERE id=$6`,
        [data.name, data.email, data.role, data.active, hash, id]
      );
    } else {
      await client.query(
        `UPDATE users SET name=$1, email=$2, role=$3, active=$4,
                          token_version = token_version + $5, updated_at = now()
         WHERE id=$6`,
        [data.name, data.email, data.role, data.active, invalidateSessions ? 1 : 0, id]
      );
    }

    await replacePermissions(client, id, data.role, data.permissions);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return renderForm(res, 409, {
        user: { id, ...data },
        errors: ['Já existe um usuário com este e-mail.'],
      });
    }
    throw err;
  } finally {
    client.release();
  }

  res.redirect(`/users/${id}/edit?saved=1`);
}));

router.post('/:id/delete', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const target = await findUser(id);
  if (!target) return res.status(404).render('error', { message: 'Usuário não encontrado.' });

  if (id === req.user.id) {
    return res.status(400).render('error', { message: 'Você não pode excluir a sua própria conta.' });
  }
  if (target.role === 'admin' && req.user.role !== 'admin') {
    return res.status(403).render('error', { message: 'Apenas um administrador pode excluir outro administrador.' });
  }
  if (target.role === 'admin' && target.active && await countActiveAdmins(pool, id) === 0) {
    return res.status(400).render('error', {
      message: 'Este é o último administrador ativo. Promova outro usuário antes de excluí-lo.',
    });
  }

  // ON DELETE CASCADE em user_permissions cuida das permissões.
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  res.redirect('/users?deleted=1');
}));

module.exports = router;
