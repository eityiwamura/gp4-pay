require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./db');
const { RESTRICTED_CODES_BY_CATEGORY } = require('./lib/paymentTypeRules');
const { RESTRICTED_PRAZOS_BY_CATEGORY } = require('./lib/prazoRules');

const PAYMENT_TYPES = [
  { code: 'DEB', name: 'Débito', sort_order: 0 },
  ...Array.from({ length: 24 }, (_, i) => ({
    code: `C${i + 1}`,
    name: `Créd.${i + 1}x`,
    sort_order: i + 1,
  })),
];

const CATEGORIES = [
  { code: 'SUB', name: 'SUB' },
  { code: 'SITE', name: 'SITE' },
];

const PRAZOS = [
  { code: 'D1', name: 'D+1', period_label: 'por dia', annual_multiplier: 365 },
  { code: 'D30', name: 'D+30', period_label: 'por mês', annual_multiplier: 12 },
  { code: 'D0', name: 'D+0', period_label: 'no mesmo dia', annual_multiplier: 365 },
];

const BRANDS = [
  { code: 'MASTER', name: 'Master', sort_order: 0 },
  { code: 'VISA', name: 'Visa', sort_order: 1 },
  { code: 'ELO', name: 'Elo', sort_order: 2 },
];

// Taxas GP4 extraídas do "Comparativo_de_Taxas_Cliente_03jul26.xlsx" (planilha de referência do Eity)
// Usadas apenas como carga inicial (mesmo valor para as 3 bandeiras) - podem ser editadas por bandeira na tela de Cadastro de Taxas.
const SEED_RATES = {
  SUB: {
    D1: {
      DEB: 0.0198, C1: 0.0438, C2: 0.0559, C3: 0.0625, C4: 0.0695, C5: 0.0765,
      C6: 0.0839, C7: 0.0935, C8: 0.1005, C9: 0.1075, C10: 0.1149, C11: 0.1219,
      C12: 0.1298, C13: 0.1395, C14: 0.1469, C15: 0.1545, C16: 0.1625, C17: 0.1699,
      C18: 0.1775, C19: 0.1775, C20: 0.1775, C21: 0.1775, C22: 0.1775, C23: 0.1775, C24: 0.1775,
    },
    D30: {
      DEB: 0.0198, C1: 0.0328, C2: 0.0371, C3: 0.0371, C4: 0.0371, C5: 0.0371,
      C6: 0.0371, C7: 0.0391, C8: 0.0391, C9: 0.0391, C10: 0.0391, C11: 0.0391,
      C12: 0.0391, C13: 0.0391, C14: 0.0391, C15: 0.0391, C16: 0.0391, C17: 0.0391,
      C18: 0.0391, C19: 0.0391, C20: 0.0391, C21: 0.0391, C22: 0.0391, C23: 0.0391, C24: 0.0391,
    },
  },
  SITE: {
    D1: {
      DEB: 0.0099, C1: 0.0299, C2: 0.0428, C3: 0.0498, C4: 0.057, C5: 0.0639,
      C6: 0.0708, C7: 0.0777, C8: 0.0844, C9: 0.0911, C10: 0.0978, C11: 0.1044,
      C12: 0.1109, C13: 0.1173, C14: 0.1237, C15: 0.1301, C16: 0.1364, C17: 0.1426, C18: 0.1487,
    },
    D30: {
      DEB: 0.0099, C1: 0.0215, C2: 0.025, C3: 0.025, C4: 0.025, C5: 0.025,
      C6: 0.025, C7: 0.028, C8: 0.028, C9: 0.028, C10: 0.028, C11: 0.028,
      C12: 0.028, C13: 0.0285, C14: 0.0285, C15: 0.0285, C16: 0.0285, C17: 0.0285, C18: 0.0285,
    },
    D0: {
      DEB: 0.0139, C1: 0.0305, C2: 0.0503, C3: 0.057, C4: 0.0638, C5: 0.0705,
      C6: 0.077, C7: 0.0891, C8: 0.0956, C9: 0.102, C10: 0.1084, C11: 0.1147,
      C12: 0.1209, C13: 0.1271, C14: 0.1333, C15: 0.1393, C16: 0.1453, C17: 0.1513, C18: 0.1573,
    },
  },
};

async function run() {
  const client = await pool.connect();
  try {
    console.log('Aplicando schema (001_init)...');
    const sql001 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '001_init.sql'), 'utf8');
    await client.query(sql001);

    console.log('Aplicando schema (002_add_brands)...');
    const sql002 = fs.readFileSync(path.join(__dirname, '..', 'migrations', '002_add_brands.sql'), 'utf8');
    await client.query(sql002);

    console.log('Semeando categorias, prazos, bandeiras e tipos de pagamento...');
    for (const c of CATEGORIES) {
      await client.query(
        `INSERT INTO categories (code, name) VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
        [c.code, c.name]
      );
    }
    for (const p of PRAZOS) {
      await client.query(
        `INSERT INTO prazos (code, name, period_label, annual_multiplier) VALUES ($1, $2, $3, $4)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, period_label = EXCLUDED.period_label, annual_multiplier = EXCLUDED.annual_multiplier`,
        [p.code, p.name, p.period_label, p.annual_multiplier]
      );
    }
    for (const b of BRANDS) {
      await client.query(
        `INSERT INTO payment_brands (code, name, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
        [b.code, b.name, b.sort_order]
      );
    }
    for (const pt of PAYMENT_TYPES) {
      await client.query(
        `INSERT INTO payment_types (code, name, sort_order) VALUES ($1, $2, $3)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order`,
        [pt.code, pt.name, pt.sort_order]
      );
    }

    const catRows = await client.query('SELECT id, code FROM categories');
    const prazoRows = await client.query('SELECT id, code FROM prazos');
    const ptRows = await client.query('SELECT id, code FROM payment_types');
    const brandRows = await client.query('SELECT id, code FROM payment_brands');
    const catId = Object.fromEntries(catRows.rows.map(r => [r.code, r.id]));
    const prazoId = Object.fromEntries(prazoRows.rows.map(r => [r.code, r.id]));
    const ptId = Object.fromEntries(ptRows.rows.map(r => [r.code, r.id]));
    const brandId = Object.fromEntries(brandRows.rows.map(r => [r.code, r.id]));

    // Taxas cadastradas ANTES da bandeira existir (brand_id nulo) viram "Master" automaticamente,
    // preservando qualquer ajuste que já tenha sido feito manualmente na tela de Cadastro de Taxas.
    const orphanCount = await client.query('SELECT count(*) FROM rates WHERE brand_id IS NULL');
    if (Number(orphanCount.rows[0].count) > 0) {
      console.log(`Migrando ${orphanCount.rows[0].count} taxa(s) existente(s) para a bandeira Master...`);
      await client.query('UPDATE rates SET brand_id = $1 WHERE brand_id IS NULL', [brandId.MASTER]);
    }

    console.log('Removendo taxas restritas (ex: 19x-24x na categoria SITE)...');
    for (const [catCode, restrictedCodes] of Object.entries(RESTRICTED_CODES_BY_CATEGORY)) {
      if (!catId[catCode] || restrictedCodes.length === 0) continue;
      const del = await client.query(
        `DELETE FROM rates WHERE category_id = $1
         AND payment_type_id IN (SELECT id FROM payment_types WHERE code = ANY($2))`,
        [catId[catCode], restrictedCodes]
      );
      if (del.rowCount > 0) console.log(`  ${del.rowCount} taxa(s) removida(s) de ${catCode}.`);
    }

    console.log('Removendo prazos restritos (ex: D+0 na categoria SUB)...');
    for (const [catCode, restrictedPrazoCodes] of Object.entries(RESTRICTED_PRAZOS_BY_CATEGORY)) {
      if (!catId[catCode] || restrictedPrazoCodes.length === 0) continue;
      const del = await client.query(
        `DELETE FROM rates WHERE category_id = $1
         AND prazo_id IN (SELECT id FROM prazos WHERE code = ANY($2))`,
        [catId[catCode], restrictedPrazoCodes]
      );
      if (del.rowCount > 0) console.log(`  ${del.rowCount} taxa(s) removida(s) de ${catCode}.`);
    }

    console.log('Carregando taxas GP4 iniciais por bandeira (a partir da planilha de referência)...');
    for (const brand of BRANDS) {
      for (const [catCode, prazos] of Object.entries(SEED_RATES)) {
        for (const [prazoCode, rates] of Object.entries(prazos)) {
          for (const [ptCode, rate] of Object.entries(rates)) {
            await client.query(
              `INSERT INTO rates (category_id, prazo_id, payment_type_id, brand_id, gp4_rate)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (category_id, prazo_id, payment_type_id, brand_id) DO NOTHING`,
              [catId[catCode], prazoId[prazoCode], ptId[ptCode], brandId[brand.code], rate]
            );
          }
        }
      }
    }

    if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [process.env.ADMIN_EMAIL]);
      if (existing.rows.length === 0) {
        console.log('Criando usuário admin inicial...');
        const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
        await client.query(
          `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')`,
          [process.env.ADMIN_NAME || 'Admin', process.env.ADMIN_EMAIL, hash]
        );
      } else {
        console.log('Usuário admin já existe, pulando criação.');
      }
    }

    console.log('Migração concluída com sucesso.');
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Erro na migração:', err);
  process.exit(1);
});
