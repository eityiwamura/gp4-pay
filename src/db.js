const { Pool } = require('pg');
const config = require('./config');

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Sem este listener, um erro num cliente ocioso do pool derruba o processo inteiro
// (o 'error' sem handler vira exceção não capturada no Node).
pool.on('error', err => {
  console.error('Erro inesperado em conexão ociosa do PostgreSQL:', err.message);
});

module.exports = pool;
