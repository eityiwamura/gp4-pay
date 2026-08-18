const express = require('express');
const pool = require('../db');
const asyncHandler = require('../lib/asyncHandler');
const { requireAuth, requirePermission } = require('../middleware/auth');
const { allowedPaymentTypes, RESTRICTED_CODES_BY_CATEGORY } = require('../lib/paymentTypeRules');
const { allowedPrazos, RESTRICTED_PRAZOS_BY_CATEGORY } = require('../lib/prazoRules');
const { allowedFlatMethods, allowedCategoriesForMethod } = require('../lib/flatMethodRules');
const { logActivity, logActivityBestEffort, logView } = require('../lib/activityLog');

const router = express.Router();

// Uma taxa fora dessa faixa não é erro de digitação inofensivo: vai direto para a
// proposta que o vendedor mostra ao cliente.
const MIN_RATE_PERCENT = 0;
const MAX_RATE_PERCENT = 100;
// gp4_rate é NUMERIC(7,4) e guarda o decimal, o que dá exatamente 2 casas no percentual.
// Mais que isso o banco arredondaria em silêncio — num número que vai para a proposta do
// cliente, é melhor recusar e deixar quem digitou decidir.
const MAX_RATE_DECIMALS = 2;

const HISTORY_PAGE_SIZE = 100;

async function getLookups() {
  const categories = (await pool.query('SELECT * FROM categories ORDER BY id')).rows;
  const prazos = (await pool.query('SELECT * FROM prazos ORDER BY id')).rows;
  const brands = (await pool.query('SELECT * FROM payment_brands ORDER BY sort_order')).rows;
  const flatMethods = (await pool.query('SELECT * FROM flat_payment_methods ORDER BY sort_order')).rows;
  return { categories, prazos, brands, flatMethods };
}

// Lê um campo de taxa do formulário e devolve { value, display, error }.
// value vem em percentual (não decimal), ou null quando o campo veio vazio.
function parseRateField(raw, label) {
  if (raw === undefined || (typeof raw === 'string' && raw.trim() === '')) {
    return { value: null, display: '', error: null };
  }
  if (typeof raw !== 'string') {
    return { value: null, display: '', error: `Valor inválido para ${label}.` };
  }

  const display = raw.trim();
  // Formato pt-BR: ponto é separador de milhar, vírgula é decimal.
  const normalized = display.replace(/\./g, '').replace(',', '.');
  const percentValue = Number(normalized);

  if (!Number.isFinite(percentValue)) {
    return { value: null, display, error: `"${display}" não é um número válido (${label}).` };
  }
  if (percentValue < MIN_RATE_PERCENT || percentValue > MAX_RATE_PERCENT) {
    return {
      value: null,
      display,
      error: `A taxa de ${label} precisa ficar entre ${MIN_RATE_PERCENT}% e ${MAX_RATE_PERCENT}% (informado: ${display}%).`,
    };
  }

  // Zeros à direita não perdem precisão nenhuma, então "1,50" e "1,500" passam;
  // "1,985" não, porque viraria 1,99 sem ninguém perceber.
  const fraction = (normalized.split('.')[1] || '').replace(/0+$/, '');
  if (fraction.length > MAX_RATE_DECIMALS) {
    return {
      value: null,
      display,
      error: `A taxa de ${label} aceita no máximo ${MAX_RATE_DECIMALS} casas decimais (informado: ${display}).`,
    };
  }

  return { value: percentValue, display, error: null };
}

function formatRate(decimal) {
  return decimal != null ? (Number(decimal) * 100).toFixed(2).replace('.', ',') : '';
}

// NUMERIC volta do pg como string. Comparar em 4 casas (a precisão da coluna) evita
// tanto ruído de ponto flutuante quanto registrar "alteração" onde nada mudou.
function sameRate(a, b) {
  const norm = v => (v === null || v === undefined ? null : Number(v).toFixed(4));
  return norm(a) === norm(b);
}

// Grava uma linha no log de auditoria. Sempre chamada dentro da mesma transação da
// escrita, para não existir alteração sem registro (nem registro sem alteração).
async function recordRateChange(client, entry) {
  await client.query(
    `INSERT INTO rate_history
       (user_id, user_name, kind, label, category_id, prazo_id, brand_id,
        payment_type_id, method_id, old_rate, new_rate)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      entry.userId, entry.userName, entry.kind, entry.label,
      entry.categoryId, entry.prazoId ?? null, entry.brandId ?? null,
      entry.paymentTypeId ?? null, entry.methodId ?? null,
      entry.oldRate, entry.newRate,
    ]
  );
}

// Resolve categoria/prazo/bandeira da URL e valida a combinação.
// Devolve null (e já respondeu 404) quando algo não bate.
async function resolveTarget(req, res) {
  const { categoryCode, prazoCode, brandCode } = req.params;
  const { categories, prazos, brands } = await getLookups();

  const category = categories.find(c => c.code === categoryCode);
  const prazo = prazos.find(p => p.code === prazoCode);
  const brand = brands.find(b => b.code === brandCode);

  if (!category || !prazo || !brand) {
    res.status(404).render('error', { message: 'Categoria, prazo ou bandeira não encontrado.' });
    return null;
  }
  if (!allowedPrazos(category.code, prazos).some(p => p.code === prazoCode)) {
    res.status(404).render('error', {
      message: `O prazo ${prazo.name} não existe para a categoria ${category.name}.`,
    });
    return null;
  }

  const paymentTypes = allowedPaymentTypes(
    category.code,
    (await pool.query('SELECT * FROM payment_types ORDER BY sort_order')).rows
  );

  return { categories, prazos, brands, category, prazo, brand, paymentTypes };
}

router.get('/rates', requireAuth, requirePermission('rates'), logView('Cadastro de Taxas'), asyncHandler(async (req, res) => {
  const { categories, prazos, brands, flatMethods } = await getLookups();
  const paymentTypes = (await pool.query('SELECT * FROM payment_types ORDER BY sort_order')).rows;

  // Cada categoria parcela até um limite diferente (SITE para em 18x), então o texto
  // do card é calculado em vez de fixo.
  const installmentsLabel = Object.fromEntries(categories.map(c => {
    const codes = allowedPaymentTypes(c.code, paymentTypes)
      .filter(pt => pt.code.startsWith('C'))
      .map(pt => Number(pt.code.slice(1)));
    const max = codes.length > 0 ? Math.max(...codes) : 0;
    return [c.code, max > 0 ? `Débito + Crédito 1x a ${max}x` : 'Débito'];
  }));

  res.render('rates-index', {
    categories, prazos, brands, flatMethods, installmentsLabel,
    allowedPrazosFn: allowedPrazos,
    allowedFlatMethodsFn: allowedFlatMethods,
  });
}));

// --- Histórico de alteração de taxas -----------------------------------------

router.get('/rates/historico', requireAuth, requirePermission('rates'), logView('Histórico de Taxas'), asyncHandler(async (req, res) => {
  const { categories } = await getLookups();
  const category = categories.find(c => c.code === req.query.categoria) || null;

  const params = [];
  let where = '';
  if (category) {
    params.push(category.id);
    where = 'WHERE category_id = $1';
  }

  // Busca uma linha a mais do que cabe na página só para saber se há mais além dela.
  params.push(HISTORY_PAGE_SIZE + 1);
  const rows = (await pool.query(
    `SELECT changed_at, user_name, kind, label, old_rate, new_rate
     FROM rate_history ${where}
     ORDER BY changed_at DESC, id DESC
     LIMIT $${params.length}`,
    params
  )).rows;

  const hasMore = rows.length > HISTORY_PAGE_SIZE;

  res.render('rates-history', {
    categories,
    category,
    hasMore,
    limit: HISTORY_PAGE_SIZE,
    entries: rows.slice(0, HISTORY_PAGE_SIZE).map(r => ({
      changed_at: r.changed_at,
      user_name: r.user_name,
      label: r.label,
      old: formatRate(r.old_rate),
      new: formatRate(r.new_rate),
    })),
  });
}));

// --- Meios sem bandeira e sem prazo (PIX) ------------------------------------
// Moram em flat_rates: uma taxa por categoria, e mais nada. Rota separada porque a
// tela de taxas comuns é toda chaveada por prazo + bandeira, que aqui não existem.

async function resolveFlatMethod(req, res) {
  const { categories, flatMethods } = await getLookups();
  const method = flatMethods.find(m => m.code === req.params.methodCode);

  if (!method) {
    res.status(404).render('error', { message: 'Meio de pagamento não encontrado.' });
    return null;
  }

  const allowedCategories = allowedCategoriesForMethod(method.code, categories);
  if (allowedCategories.length === 0) {
    res.status(404).render('error', {
      message: `${method.name} não está disponível em nenhuma categoria.`,
    });
    return null;
  }

  return { method, allowedCategories };
}

router.get('/rates/metodo/:methodCode', requireAuth, requirePermission('rates'), asyncHandler(async (req, res) => {
  const target = await resolveFlatMethod(req, res);
  if (!target) return;
  const { method, allowedCategories } = target;

  const existing = (await pool.query(
    'SELECT category_id, gp4_rate FROM flat_rates WHERE method_id = $1',
    [method.id]
  )).rows;
  const rateMap = Object.fromEntries(existing.map(r => [r.category_id, r.gp4_rate]));

  logActivityBestEffort({
    userId: req.user.id, userName: req.user.name,
    action: 'view_screen', detail: `Cadastro de Taxas · ${method.name}`, ip: req.ip,
  });

  res.render('rates-flat-edit', {
    method,
    rows: allowedCategories.map(c => ({ category: c, value: formatRate(rateMap[c.id]) })),
    saved: req.query.saved === '1',
    errors: [],
  });
}));

router.post('/rates/metodo/:methodCode', requireAuth, requirePermission('rates'), asyncHandler(async (req, res) => {
  const target = await resolveFlatMethod(req, res);
  if (!target) return;
  const { method, allowedCategories } = target;

  const errors = [];
  const parsed = allowedCategories.map(category => {
    const field = parseRateField(req.body[`rate_${category.id}`], `${method.name} · ${category.name}`);
    if (field.error) errors.push(field.error);
    return { category, ...field };
  });

  if (errors.length > 0) {
    return res.status(400).render('rates-flat-edit', {
      method,
      rows: parsed.map(p => ({ category: p.category, value: p.display })),
      saved: false,
      errors,
    });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = (await client.query(
      'SELECT category_id, gp4_rate FROM flat_rates WHERE method_id = $1',
      [method.id]
    )).rows;
    const beforeMap = Object.fromEntries(before.map(r => [r.category_id, r.gp4_rate]));

    let changedCount = 0;
    for (const { category, value } of parsed) {
      const oldRate = beforeMap[category.id] ?? null;
      const newRate = value === null ? null : value / 100;

      // Salvar sem editar nada não deve gerar escrita nem poluir o histórico.
      if (sameRate(oldRate, newRate)) continue;
      changedCount++;

      if (newRate === null) {
        await client.query(
          'DELETE FROM flat_rates WHERE category_id=$1 AND method_id=$2',
          [category.id, method.id]
        );
      } else {
        await client.query(
          `INSERT INTO flat_rates (category_id, method_id, gp4_rate, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (category_id, method_id)
           DO UPDATE SET gp4_rate = EXCLUDED.gp4_rate, updated_at = now()`,
          [category.id, method.id, newRate]
        );
      }

      await recordRateChange(client, {
        userId: req.user.id,
        userName: req.user.name,
        kind: 'flat',
        label: `${category.name} · ${method.name}`,
        categoryId: category.id,
        methodId: method.id,
        oldRate,
        newRate,
      });
    }

    if (changedCount > 0) {
      await logActivity({
        userId: req.user.id, userName: req.user.name, action: 'rate_saved',
        detail: `${method.name} (${changedCount} taxa(s) alterada(s))`, ip: req.ip,
      }, client);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.redirect(`/rates/metodo/${method.code}?saved=1`);
}));

// --- Taxas comuns (categoria + prazo + bandeira) ------------------------------

router.get('/rates/:categoryCode/:prazoCode/:brandCode', requireAuth, requirePermission('rates'), asyncHandler(async (req, res) => {
  const target = await resolveTarget(req, res);
  if (!target) return;
  const { categories, prazos, brands, category, prazo, brand, paymentTypes } = target;

  const existingRates = (await pool.query(
    `SELECT payment_type_id, gp4_rate FROM rates WHERE category_id = $1 AND prazo_id = $2 AND brand_id = $3`,
    [category.id, prazo.id, brand.id]
  )).rows;
  const rateMap = Object.fromEntries(existingRates.map(r => [r.payment_type_id, r.gp4_rate]));

  const rows = paymentTypes.map(pt => ({
    ...pt,
    value: formatRate(rateMap[pt.id]),
  }));

  logActivityBestEffort({
    userId: req.user.id, userName: req.user.name,
    action: 'view_screen',
    detail: `Cadastro de Taxas · ${category.name} · ${brand.name} · ${prazo.name}`,
    ip: req.ip,
  });

  res.render('rates-edit', {
    categories, prazos, brands, category, prazo, brand, rows,
    allowedPrazosFn: allowedPrazos,
    saved: req.query.saved === '1',
    errors: [],
  });
}));

router.post('/rates/:categoryCode/:prazoCode/:brandCode', requireAuth, requirePermission('rates'), asyncHandler(async (req, res) => {
  const target = await resolveTarget(req, res);
  if (!target) return;
  const { categories, prazos, brands, category, prazo, brand, paymentTypes } = target;

  // Passo 1: ler e validar tudo antes de tocar no banco. Um único campo errado
  // cancela o salvamento inteiro, em vez de gravar metade da tabela.
  const errors = [];
  const parsed = paymentTypes.map(pt => {
    const field = parseRateField(req.body[`rate_${pt.id}`], pt.name);
    if (field.error) errors.push(field.error);
    return { paymentType: pt, ...field };
  });

  if (errors.length > 0) {
    return res.status(400).render('rates-edit', {
      categories, prazos, brands, category, prazo, brand,
      rows: parsed.map(p => ({ ...p.paymentType, value: p.display })),
      allowedPrazosFn: allowedPrazos,
      saved: false,
      errors,
    });
  }

  // Passo 2: gravar.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Reforça a regra: remove qualquer taxa restrita para esta categoria (ex: 19x-24x na SITE,
    // D+0 na SUB), mesmo que tenha sido cadastrada antes dessa regra existir. Não entra no
    // histórico porque são combinações inalcançáveis pela interface, limpas de uma vez na
    // migração — aqui é só uma rede de segurança.
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

    const before = (await client.query(
      'SELECT payment_type_id, gp4_rate FROM rates WHERE category_id=$1 AND prazo_id=$2 AND brand_id=$3',
      [category.id, prazo.id, brand.id]
    )).rows;
    const beforeMap = Object.fromEntries(before.map(r => [r.payment_type_id, r.gp4_rate]));

    let changedCount = 0;
    for (const { paymentType, value } of parsed) {
      const oldRate = beforeMap[paymentType.id] ?? null;
      const newRate = value === null ? null : value / 100;

      // Salvar sem editar nada não deve gerar escrita nem poluir o histórico.
      if (sameRate(oldRate, newRate)) continue;
      changedCount++;

      if (newRate === null) {
        await client.query(
          'DELETE FROM rates WHERE category_id=$1 AND prazo_id=$2 AND payment_type_id=$3 AND brand_id=$4',
          [category.id, prazo.id, paymentType.id, brand.id]
        );
      } else {
        await client.query(
          `INSERT INTO rates (category_id, prazo_id, payment_type_id, brand_id, gp4_rate, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())
           ON CONFLICT (category_id, prazo_id, payment_type_id, brand_id)
           DO UPDATE SET gp4_rate = EXCLUDED.gp4_rate, updated_at = now()`,
          [category.id, prazo.id, paymentType.id, brand.id, newRate]
        );
      }

      await recordRateChange(client, {
        userId: req.user.id,
        userName: req.user.name,
        kind: 'rate',
        label: `${category.name} · ${brand.name} · ${prazo.name} · ${paymentType.name}`,
        categoryId: category.id,
        prazoId: prazo.id,
        brandId: brand.id,
        paymentTypeId: paymentType.id,
        oldRate,
        newRate,
      });
    }

    if (changedCount > 0) {
      await logActivity({
        userId: req.user.id, userName: req.user.name, action: 'rate_saved',
        detail: `${category.name} · ${brand.name} · ${prazo.name} (${changedCount} taxa(s) alterada(s))`,
        ip: req.ip,
      }, client);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.redirect(`/rates/${category.code}/${prazo.code}/${brand.code}?saved=1`);
}));

module.exports = router;
