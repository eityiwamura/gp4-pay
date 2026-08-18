// Job de carga única: cadastra a equipe informada pelo Eity em 17/08/2026.
//
// Roda uma vez, manualmente (não faz parte do migrate.js nem do boot do container).
// Idempotente: e-mail que já existe é pulado e não é tocado — não sobrescreve senha
// nem permissões de alguém que já ajustou a própria conta. Rodar de novo é seguro.
//
// Uso:
//   node src/scripts/seed-team.js        (ou: npm run seed:team)
// Precisa das mesmas variáveis de ambiente do servidor (DATABASE_URL, JWT_SECRET).
require('../config'); // valida as variáveis de ambiente e aborta se faltar alguma
const bcrypt = require('bcryptjs');
const pool = require('../db');

// Senha padrão pedida para todo mundo. ATENÇÃO: tem 6 caracteres — abaixo do mínimo de
// 8 que o próprio sistema exige ao trocar senha pela tela de Usuários (MIN_PASSWORD em
// src/routes/users.js). Funciona para o cadastro inicial porque esta gravação não passa
// por aquela validação, mas symptomático: se um admin abrir o cadastro de um desses
// usuários e tentar salvar sem preencher nova senha, tudo bem (campo vazio = mantém a
// atual); só dá erro se alguém tentar redefinir para outra senha curta.
const DEFAULT_PASSWORD = 'Gp1234';

const TEAM = [
  { name: 'Luiz Assis', email: 'lassiscr@gmail.com', role: 'admin' },
  { name: 'Gustavo Pereira', email: 'gustavo.pereira0412@gmail.com', role: 'admin' },
  { name: 'Claudia Vasquez', email: 'gp4pay@gmail.com', role: 'admin' },

  { name: 'Léo Poli', email: 'livetvfic@gmail.com', role: 'vendedor' },
  { name: 'Camila Campanilli', email: 'camilacampanilli8909@gmail.com', role: 'vendedor' },
  { name: 'Mariana Barros', email: 'mariiibarros0208@gmail.com', role: 'vendedor' },
  { name: 'Maryellen', email: 'maryellensara17@gmail.com', role: 'vendedor' },
  { name: 'Silas Augusto', email: 'silasaugustoda99fm@gmail.com', role: 'vendedor' },
  { name: 'Pedro', email: 'pdrao.en@gmail.com', role: 'vendedor' },
  { name: 'Elisangela', email: 'eans.adm@gmail.com', role: 'vendedor' },
  { name: 'Lucas Mateus', email: 'lucas.mateusewz@gmail.com', role: 'vendedor' },
  { name: 'Bruna Tavares', email: 'bruna.gta1347@gmail.com', role: 'vendedor' },
  { name: 'Ana Claudia', email: 'anaclaudiaagon89@gmail.com', role: 'vendedor' },
  { name: 'Gabriel', email: 'gabrieelvieiraa10@gmail.com', role: 'vendedor' },
  { name: 'Paulo', email: 'paulowendell2222@gmail.com', role: 'vendedor' },
  // e-mail original veio com V maiúsculo; o sistema sempre grava em minúsculas.
  { name: 'Vivian', email: 'vivianhelena8@gmail.com', role: 'vendedor' },
];

// Só a Calculadora, como pedido — nada de Cadastro de Taxas nem Gestão de Usuários.
const VENDEDOR_PERMISSIONS = ['calculator'];

async function run() {
  const client = await pool.connect();
  try {
    const hash = await bcrypt.hash(DEFAULT_PASSWORD, 10);
    let created = 0, skipped = 0;

    for (const person of TEAM) {
      const existing = await client.query('SELECT id FROM users WHERE email = $1', [person.email]);
      if (existing.rows.length > 0) {
        console.log(`  já existe, pulando: ${person.email}`);
        skipped++;
        continue;
      }

      await client.query('BEGIN');
      try {
        const inserted = await client.query(
          `INSERT INTO users (name, email, password_hash, role, active) VALUES ($1, $2, $3, $4, true) RETURNING id`,
          [person.name, person.email, hash, person.role]
        );
        if (person.role === 'vendedor') {
          for (const screen of VENDEDOR_PERMISSIONS) {
            await client.query(
              'INSERT INTO user_permissions (user_id, screen) VALUES ($1, $2)',
              [inserted.rows[0].id, screen]
            );
          }
        }
        await client.query('COMMIT');
        console.log(`  criado (${person.role}): ${person.name} <${person.email}>`);
        created++;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log(`\n${created} usuário(s) criado(s), ${skipped} já existiam. Senha inicial: ${DEFAULT_PASSWORD}`);
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch(err => {
  console.error('Erro ao cadastrar a equipe:', err);
  process.exit(1);
});
