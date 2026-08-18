const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const config = require('./config');
const pool = require('./db');
const { RESTRICTED_CODES_BY_CATEGORY } = require('./lib/paymentTypeRules');
const { RESTRICTED_PRAZOS_BY_CATEGORY } = require('./lib/prazoRules');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

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

// Sem period_label / annual_multiplier: eram código morto e enganavam (ver 006).
// A projeção anual vem do período do volume informado, não do prazo de recebimento.
const PRAZOS = [
  { code: 'D1', name: 'D+1' },
  { code: 'D30', name: 'D+30' },
  { code: 'D0', name: 'D+0' },
];

const BRANDS = [
  { code: 'MASTER', name: 'Master', sort_order: 0 },
  { code: 'VISA', name: 'Visa', sort_order: 1 },
  { code: 'ELO', name: 'Elo', sort_order: 2 },
];

// Meios sem bandeira e sem prazo. O PIX cai sempre em D+1 e não parcela, então não
// cabe na tabela `rates` — mora em flat_rates. A taxa em si NÃO é semeada: quem
// preenche é o admin, na tela de Cadastro de Taxas.
const FLAT_METHODS = [
  { code: 'PIX', name: 'PIX', note: 'Recebimento em D+1', sort_order: 0 },
];

// Taxas GP4 extraídas do "Comparativo_de_Taxas_Cliente_03jul26.xlsx" (planilha de referência).
// Carga inicial apenas: só é aplicada quando a tabela `rates` está vazia.
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

// O container sobe junto com o Postgres; nos primeiros segundos a conexão ainda falha.
async function waitForDatabase(attempts = 20, delayMs = 3000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (i === attempts) throw err;
      console.log(`Banco ainda não respondeu (${i}/${attempts}). Nova tentativa em ${delayMs / 1000}s...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(200) PRIMARY KEY,
      applied_at TIMESTAMP NOT NULL DEFAULT now()
    )
  `);
}

async function alreadyApplied(client, name) {
  const { rows } = await client.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [name]);
  return rows.length > 0;
}

// Executa uma etapa exatamente uma vez na vida do banco, registrando-a em schema_migrations.
async function runOnce(client, name, fn) {
  if (await alreadyApplied(client, name)) return false;
  await client.query('BEGIN');
  try {
    await fn(client);
    await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [name]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function applySqlMigrations(client) {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await runOnce(client, file, async c => {
      console.log(`  aplicando ${file}...`);
      await c.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));
    });
    if (!applied) console.log(`  ${file} já aplicada, pulando.`);
  }
}

async function seedLookups(client) {
  for (const c of CATEGORIES) {
    await client.query(
      `INSERT INTO categories (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [c.code, c.name]
    );
  }
  for (const p of PRAZOS) {
    await client.query(
      `INSERT INTO prazos (code, name) VALUES ($1, $2)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name`,
      [p.code, p.name]
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
  for (const m of FLAT_METHODS) {
    await client.query(
      `INSERT INTO flat_payment_methods (code, name, note, sort_order) VALUES ($1, $2, $3, $4)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, note = EXCLUDED.note,
                                        sort_order = EXCLUDED.sort_order`,
      [m.code, m.name, m.note, m.sort_order]
    );
  }
}

async function seedRatesIfEmpty(client) {
  const { rows } = await client.query('SELECT count(*)::int AS n FROM rates');
  if (rows[0].n > 0) {
    console.log(`Tabela de taxas já tem ${rows[0].n} registro(s) — carga inicial não será aplicada.`);
    return;
  }

  console.log('Tabela de taxas vazia: aplicando a carga inicial da planilha de referência...');
  const ids = async (table) => Object.fromEntries(
    (await client.query(`SELECT id, code FROM ${table}`)).rows.map(r => [r.code, r.id])
  );
  const catId = await ids('categories');
  const prazoId = await ids('prazos');
  const ptId = await ids('payment_types');
  const brandId = await ids('payment_brands');

  let inserted = 0;
  await client.query('BEGIN');
  try {
    for (const brand of BRANDS) {
      for (const [catCode, prazos] of Object.entries(SEED_RATES)) {
        for (const [prazoCode, rates] of Object.entries(prazos)) {
          for (const [ptCode, rate] of Object.entries(rates)) {
            const r = await client.query(
              `INSERT INTO rates (category_id, prazo_id, payment_type_id, brand_id, gp4_rate)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (category_id, prazo_id, payment_type_id, brand_id) DO NOTHING`,
              [catId[catCode], prazoId[prazoCode], ptId[ptCode], brandId[brand.code], rate]
            );
            inserted += r.rowCount;
          }
        }
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  console.log(`  ${inserted} taxa(s) carregada(s).`);
}

async function ensureAdminUser(client) {
  const { email, password, name } = config.admin;
  if (!email || !password) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM users WHERE role='admin' AND active`);
    if (rows[0].n === 0) {
      console.warn('ATENÇÃO: não há administrador ativo e ADMIN_EMAIL/ADMIN_PASSWORD não foram definidos.');
    }
    return;
  }

  const existing = await client.query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows.length > 0) {
    console.log('Usuário admin já existe, pulando criação.');
    return;
  }

  console.log(`Criando usuário admin inicial (${email})...`);
  const hash = await bcrypt.hash(password, 10);
  await client.query(
    `INSERT INTO users (name, email, password_hash, role, active) VALUES ($1, $2, $3, 'admin', true)`,
    [name, email, hash]
  );
}

async function run() {
  await waitForDatabase();

  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);

    console.log('Aplicando migrações SQL...');
    await applySqlMigrations(client);

    console.log('Semeando categorias, prazos, bandeiras e meios de pagamento...');
    await seedLookups(client);

    // Taxas cadastradas antes da bandeira existir (brand_id nulo) viram "Master",
    // preservando ajustes já feitos manualmente. Roda uma única vez.
    await runOnce(client, 'data/001_taxas_sem_bandeira_viram_master', async c => {
      const { rowCount } = await c.query(
        `UPDATE rates SET brand_id = (SELECT id FROM payment_brands WHERE code='MASTER')
         WHERE brand_id IS NULL`
      );
      if (rowCount > 0) console.log(`  ${rowCount} taxa(s) sem bandeira migrada(s) para Master.`);
    });

    // Limpeza das combinações que a regra de negócio não permite (19x-24x na SITE,
    // D+0 na SUB). É destrutiva, então roda uma única vez — e não a cada deploy.
    await runOnce(client, 'data/002_limpar_combinacoes_restritas', async c => {
      for (const [catCode, codes] of Object.entries(RESTRICTED_CODES_BY_CATEGORY)) {
        if (codes.length === 0) continue;
        const del = await c.query(
          `DELETE FROM rates WHERE category_id = (SELECT id FROM categories WHERE code=$1)
           AND payment_type_id IN (SELECT id FROM payment_types WHERE code = ANY($2))`,
          [catCode, codes]
        );
        if (del.rowCount > 0) console.log(`  ${del.rowCount} taxa(s) removida(s) de ${catCode} (tipo restrito).`);
      }
      for (const [catCode, codes] of Object.entries(RESTRICTED_PRAZOS_BY_CATEGORY)) {
        if (codes.length === 0) continue;
        const del = await c.query(
          `DELETE FROM rates WHERE category_id = (SELECT id FROM categories WHERE code=$1)
           AND prazo_id IN (SELECT id FROM prazos WHERE code = ANY($2))`,
          [catCode, codes]
        );
        if (del.rowCount > 0) console.log(`  ${del.rowCount} taxa(s) removida(s) de ${catCode} (prazo restrito).`);
      }
    });

    await seedRatesIfEmpty(client);
    await ensureAdminUser(client);

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
