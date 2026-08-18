require('dotenv').config();

// Valores que vêm no .env.example e nunca devem chegar em produção.
const PLACEHOLDERS = [
  'troque-este-valor-por-algo-bem-aleatorio',
  'troque-esta-senha',
];

const errors = [];
const warnings = [];

const databaseUrl = (process.env.DATABASE_URL || '').trim();
if (!databaseUrl) errors.push('DATABASE_URL não está definida.');

const jwtSecret = (process.env.JWT_SECRET || '').trim();
if (!jwtSecret) {
  errors.push('JWT_SECRET não está definida.');
} else if (PLACEHOLDERS.includes(jwtSecret)) {
  errors.push('JWT_SECRET ainda está com o valor de exemplo do .env.example. Gere um valor aleatório longo.');
} else if (jwtSecret.length < 32) {
  warnings.push(`JWT_SECRET tem apenas ${jwtSecret.length} caracteres. Recomendado: 32 ou mais.`);
}

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  errors.push(`PORT inválida: "${process.env.PORT}".`);
}

const isProduction = process.env.NODE_ENV === 'production';

const adminPassword = (process.env.ADMIN_PASSWORD || '').trim();
if (adminPassword && PLACEHOLDERS.includes(adminPassword)) {
  warnings.push('ADMIN_PASSWORD está com o valor de exemplo. Troque antes de expor o sistema.');
}

if (warnings.length > 0) {
  console.warn('\nAtenção na configuração:');
  warnings.forEach(w => console.warn(`  - ${w}`));
  console.warn('');
}

// Fail-fast: é melhor o container não subir do que subir e quebrar no primeiro login.
if (errors.length > 0) {
  console.error('\nNão foi possível iniciar: configuração inválida.');
  errors.forEach(e => console.error(`  - ${e}`));
  console.error('\nConfira as variáveis de ambiente do serviço (veja .env.example).\n');
  process.exit(1);
}

module.exports = {
  port,
  databaseUrl,
  jwtSecret,
  isProduction,
  tokenMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
  admin: {
    name: process.env.ADMIN_NAME || 'Admin',
    email: (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
    password: adminPassword,
  },
};
