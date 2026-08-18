const express = require('express');
const pool = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { ACTIONS, logView } = require('../lib/activityLog');

const router = express.Router();
const PAGE_SIZE = 200;

// Admin-only de propósito — NÃO passa por requirePermission/user_permissions como as
// outras telas. Isso é intencional: dar essa tela a um usuário comum deixaria ele ver o
// IP e o comportamento de todo mundo, inclusive de outros administradores. Ver migração
// 007_activity_log.sql.
router.use(requireAuth, requireAdmin);

router.get('/rastreabilidade', logView('Rastreabilidade'), asyncHandler(async (req, res) => {
  const users = (await pool.query('SELECT id, name FROM users ORDER BY name')).rows;

  const filterUserId = Number(req.query.usuario);
  const hasFilter = Number.isInteger(filterUserId) && filterUserId > 0;

  const params = [];
  let where = '';
  if (hasFilter) {
    params.push(filterUserId);
    where = 'WHERE user_id = $1';
  }

  // Busca uma linha a mais do que cabe na página só para saber se há mais além dela.
  params.push(PAGE_SIZE + 1);
  const rows = (await pool.query(
    `SELECT occurred_at, user_name, action, detail, ip_address
     FROM activity_log ${where}
     ORDER BY occurred_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  )).rows;

  const hasMore = rows.length > PAGE_SIZE;

  res.render('trace-index', {
    users,
    filterUserId: hasFilter ? filterUserId : null,
    hasMore,
    limit: PAGE_SIZE,
    actionLabels: ACTIONS,
    entries: rows.slice(0, PAGE_SIZE),
  });
}));

module.exports = router;
