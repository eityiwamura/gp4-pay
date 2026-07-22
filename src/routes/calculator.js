const express = require('express');
const pool = require('../db');
const { requireAuth } = require('../middleware/auth');
const { allowedPaymentTypes } = require('../lib/paymentTypeRules');
const { allowedPrazos, RESTRICTED_PRAZOS_BY_CATEGORY } = require('../lib/prazoRules');

const router = express.Router();

router.get('/', requireAuth, async (req, res) => {
  const categories = (await pool.query('SELECT * FROM categories ORDER BY id')).rows;
  const prazos = (await pool.query('SELECT * FROM prazos ORDER BY id')).rows;
  const brands = (await pool.query('SELECT * FROM payment_brands ORDER BY sort_order')).rows;
  res.render('calculator', { categories, prazos, brands, restrictedPrazosByCategory: RESTRICTED_PRAZOS_BY_CATEGORY });
});

// Retorna as taxas GP4 cadastradas para uma categoria+prazo+bandeira, em formato JSON
router.get('/api/rates/:categoryCode/:prazoCode/:brandCode', requireAuth, async (req, res) => {
  const { categoryCode, prazoCode, brandCode } = req.params;

  const category = (await pool.query('SELECT * FROM categories WHERE code=$1', [categoryCode])).rows[0];
  const prazo = (await pool.query('SELECT * FROM prazos WHERE code=$1', [prazoCode])).rows[0];
  const brand = (await pool.query('SELECT * FROM payment_brands WHERE code=$1', [brandCode])).rows[0];
  if (!category || !prazo || !brand) return res.status(404).json({ error: 'Categoria, prazo ou bandeira não encontrado.' });

  const allPrazos = (await pool.query('SELECT * FROM prazos')).rows;
  if (!allowedPrazos(category.code, allPrazos).some(p => p.code === prazoCode)) {
    return res.status(404).json({ error: `O prazo ${prazo.name} não existe para a categoria ${category.name}.` });
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

  res.json({
    category: { code: category.code, name: category.name },
    prazo: { code: prazo.code, name: prazo.name, period_label: prazo.period_label, annual_multiplier: Number(prazo.annual_multiplier) },
    brand: { code: brand.code, name: brand.name },
    paymentTypes: paymentTypes.map(pt => ({
      id: pt.id,
      code: pt.code,
      name: pt.name,
      gp4_rate: rateMap[pt.id] ?? null,
    })),
  });
});

module.exports = router;
