const express = require('express');
const pool = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { allowedPaymentTypes } = require('../lib/paymentTypeRules');
const { allowedPrazos, RESTRICTED_PRAZOS_BY_CATEGORY } = require('../lib/prazoRules');
const { allowedFlatMethods } = require('../lib/flatMethodRules');
const { logActivityBestEffort, logView } = require('../lib/activityLog');

const router = express.Router();

router.use(requireAuth, requirePermission('calculator'));

router.get('/', logView('Calculadora'), asyncHandler(async (req, res) => {
  const categories = (await pool.query('SELECT * FROM categories ORDER BY id')).rows;
  const prazos = (await pool.query('SELECT * FROM prazos ORDER BY id')).rows;
  const brands = (await pool.query('SELECT * FROM payment_brands ORDER BY sort_order')).rows;
  res.render('calculator', {
    categories, prazos, brands,
    restrictedPrazosByCategory: RESTRICTED_PRAZOS_BY_CATEGORY,
  });
}));

// Retorna as taxas GP4 de uma categoria+prazo+bandeira em JSON.
//
// Vêm em duas listas, porque são duas naturezas diferentes:
//   paymentTypes -> Débito e Crédito: dependem de prazo e bandeira;
//   flatMethods  -> PIX: taxa única da categoria, ignora prazo e bandeira.
// Cada linha traz um `key` já namespaced, porque os ids saem de tabelas distintas
// e colidiriam se o front usasse o id cru como chave.
//
// Dispara a cada clique de categoria/prazo/bandeira — não gera log de rastreabilidade
// aqui (seria ruído: dezenas de chamadas por sessão). O sinal de "usou a calculadora de
// verdade" é o endpoint /api/log-simulation, abaixo, disparado só ao imprimir.
router.get('/api/rates/:categoryCode/:prazoCode/:brandCode', asyncHandler(async (req, res) => {
  const { categoryCode, prazoCode, brandCode } = req.params;

  const category = (await pool.query('SELECT * FROM categories WHERE code=$1', [categoryCode])).rows[0];
  const prazo = (await pool.query('SELECT * FROM prazos WHERE code=$1', [prazoCode])).rows[0];
  const brand = (await pool.query('SELECT * FROM payment_brands WHERE code=$1', [brandCode])).rows[0];
  if (!category || !prazo || !brand) {
    return res.status(404).json({ error: 'Categoria, prazo ou bandeira não encontrado.' });
  }

  const allPrazos = (await pool.query('SELECT * FROM prazos')).rows;
  if (!allowedPrazos(category.code, allPrazos).some(p => p.code === prazoCode)) {
    return res.status(404).json({
      error: `O prazo ${prazo.name} não existe para a categoria ${category.name}.`,
    });
  }

  const paymentTypes = allowedPaymentTypes(
    category.code,
    (await pool.query('SELECT * FROM payment_types ORDER BY sort_order')).rows
  );
  const existingRates = (await pool.query(
    `SELECT payment_type_id, gp4_rate FROM rates WHERE category_id=$1 AND prazo_id=$2 AND brand_id=$3`,
    [category.id, prazo.id, brand.id]
  )).rows;
  const rateMap = Object.fromEntries(existingRates.map(r => [r.payment_type_id, Number(r.gp4_rate)]));

  const flatMethods = allowedFlatMethods(
    category.code,
    (await pool.query('SELECT * FROM flat_payment_methods ORDER BY sort_order')).rows
  );
  const flatRates = (await pool.query(
    'SELECT method_id, gp4_rate FROM flat_rates WHERE category_id=$1',
    [category.id]
  )).rows;
  const flatRateMap = Object.fromEntries(flatRates.map(r => [r.method_id, Number(r.gp4_rate)]));

  res.json({
    category: { code: category.code, name: category.name },
    prazo: { code: prazo.code, name: prazo.name },
    brand: { code: brand.code, name: brand.name },
    paymentTypes: paymentTypes.map(pt => ({
      key: `pt-${pt.id}`,
      code: pt.code,
      name: pt.name,
      note: null,
      gp4_rate: rateMap[pt.id] ?? null,
    })),
    flatMethods: flatMethods.map(m => ({
      key: `fm-${m.id}`,
      code: m.code,
      name: m.name,
      note: m.note,
      gp4_rate: flatRateMap[m.id] ?? null,
    })),
  });
}));

// Sinal de "o vendedor fechou uma simulação", disparado pelo front ao clicar em
// Imprimir/Salvar PDF. Só guarda categoria/prazo/bandeira — nunca as taxas do cliente,
// o volume ou o rateio: o usuário decidiu explicitamente não guardar dado de concorrência
// (ver ANALISE.md, item 3.3). Best-effort: não pode atrapalhar a impressão.
router.post('/api/log-simulation', asyncHandler(async (req, res) => {
  const { categoryCode, prazoCode, brandCode } = req.body || {};
  const [category, prazo, brand] = await Promise.all([
    categoryCode ? pool.query('SELECT name FROM categories WHERE code=$1', [categoryCode]) : null,
    prazoCode ? pool.query('SELECT name FROM prazos WHERE code=$1', [prazoCode]) : null,
    brandCode ? pool.query('SELECT name FROM payment_brands WHERE code=$1', [brandCode]) : null,
  ]);

  const parts = [category?.rows[0]?.name, brand?.rows[0]?.name, prazo?.rows[0]?.name].filter(Boolean);
  logActivityBestEffort({
    userId: req.user.id, userName: req.user.name,
    action: 'simulation', detail: parts.join(' · ') || null, ip: req.ip,
  });
  res.status(204).end();
}));

module.exports = router;
