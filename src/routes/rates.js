const express = require('express');
const pool = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { allowedPaymentTypes, RESTRICTED_CODES_BY_CATEGORY } = require('../lib/paymentTypeRules');
const { allowedPrazos, RESTRICTED_PRAZOS_BY_CATEGORY } = require('../lib/prazoRules');

const router = express.Router();

async function getLookups() {
  const categories = (await pool.query('SELECT * FROM categories ORDER BY id')).rows;
  const prazos = (await pool.query('SELECT * FROM prazos ORDER BY id')).rows;
  const brands = (await pool.query('SELECT * FROM payment_brands ORDER BY sort_order')).rows;
  return { categories, prazos, brands };
}

router.get('/rates', requireAuth, requireAdmin, async (req, res) => {
  const { categories, prazos, brands } = await getLookups();
  res.render('rates-index', { categories, prazos, brands, allowedPrazosFn: allowedPrazos });
});

router.get('/rates/:categoryCode/:prazoCode/:brandCode', requireAuth, requireAdmin, async (req, res) => {
  const { categoryCode, prazoCode, brandCode } = req.params;
  const { categories, prazos, brands } = await getLookups();

  const category = categories.find(c => c.code === categoryCode);
  const prazo = prazos.find(p => p.code === prazoCode);
  const brand = brands.find(b => b.code === brandCode);
  if (!category || !prazo || !brand) return res.status(404).render('error', { message: 'Categoria, prazo ou bandeira não encontrado.' });
  if (!allowedPrazos(category.code, prazos).some(p => p.code === prazoCode)) {
    return res.status(404).render('error', { message: `O prazo ${prazo.name} não existe para a categoria ${category.name}.` });
  }

  const paymentTypes = allowedPaymentTypes(
    category.code,
    (await pool.query('SELECT * FROM payment_types ORDER BY sort_order')).rows
  );
  const existingRates = (await pool.query(
    `SELECT payment_type_id, gp4_rate FROM rates WHERE category_id = $1 AND prazo_id = $2 AND brand_id = $3`,
    [category.id, prazo.id, brand.id]
  )).rows;
  const rateMap = Object.fromEntries(existingRates.map(r => [r.payment_type_id, r.gp4_rate]));

  const rows = paymentTypes.map(pt => ({
    ...pt,
    gp4_rate: rateMap[pt.id] != null ? Number(rateMap[pt.id]) * 100 : null,
  }));

  res.render('rates-edit', { categories, prazos, brands, category, prazo, brand, rows, allowedPrazosFn: allowedPrazos, saved: req.query.saved === '1' });
});

router.post('/rates/:categoryCode/:prazoCode/:brandCode', requireAuth, requireAdmin, async (req, res) => {
  const { categoryCode, prazoCode, brandCode } = req.params;
  const { categories, prazos, brands } = await getLookups();
  const category = categories.find(c => c.code === categoryCode);
  const prazo = prazos.find(p => p.code === prazoCode);
  const brand = brands.find(b => b.code === brandCode);
  if (!category || !prazo || !brand) return res.status(404).render('error', { message: 'Categoria, prazo ou bandeira não encontrado.' });
  if (!allowedPrazos(category.code, prazos).some(p => p.code === prazoCode)) {
    return res.status(404).render('error', { message: `O prazo ${prazo.name} não existe para a categoria ${category.name}.` });
  }

  const paymentTypes = allowedPaymentTypes(
    category.code,
    (await pool.query('SELECT * FROM payment_types ORDER BY sort_order')).rows
  );

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Reforça a regra: remove qualquer taxa restrita para esta categoria (ex: 19x-24x na SITE,
    // D+0 na SUB), mesmo que tenha sido cadastrada antes dessa regra existir.
    const restrictedCodes = RESTRICTED_CODES_BY_CATEGORY[category.code] || [];
    if (restrictedCodes.length > 0) {
      await client.query(
        `DELETE FROM rates WHERE category_id=$1 AND brand_id=$2
         AND payment_type_id IN (SELECT id FROM payment_types WHERE code = ANY($3))`,
        [category.id, brand.id, restrictedCodes]
      );
    }
    const restrictedPrazoCodes = RESTRICTED_PRAZOS_BY_CATEGORY[category.code] || [];
    if (restrictedPrazoCodes.length > 0) {
      await client.query(
        `DELETE FROM rates WHERE category_id=$1 AND brand_id=$2
         AND prazo_id IN (SELECT id FROM prazos WHERE code = ANY($3))`,
        [category.id, brand.id, restrictedPrazoCodes]
      );
    }

    for (const pt of paymentTypes) {
      const raw = req.body[`rate_${pt.id}`];
      if (raw === undefined || raw === '') {
        await client.query('DELETE FROM rates WHERE category_id=$1 AND prazo_id=$2 AND payment_type_id=$3 AND brand_id=$4', [category.id, prazo.id, pt.id, brand.id]);
        continue;
      }
      const percentValue = parseFloat(raw.replace(',', '.'));
      if (Number.isNaN(percentValue)) continue;
      const decimalValue = percentValue / 100;
      await client.query(
        `INSERT INTO rates (category_id, prazo_id, payment_type_id, brand_id, gp4_rate, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (category_id, prazo_id, payment_type_id, brand_id)
         DO UPDATE SET gp4_rate = EXCLUDED.gp4_rate, updated_at = now()`,
        [category.id, prazo.id, pt.id, brand.id, decimalValue]
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    return res.status(500).render('error', { message: 'Erro ao salvar taxas.' });
  } finally {
    client.release();
  }

  res.redirect(`/rates/${categoryCode}/${prazoCode}/${brandCode}?saved=1`);
});

module.exports = router;
