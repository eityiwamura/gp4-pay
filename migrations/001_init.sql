-- Usuários do sistema
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) UNIQUE NOT NULL,
  password_hash VARCHAR(200) NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'vendedor', -- 'admin' ou 'vendedor'
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Categorias GP4 (fixo: SUB e SITE)
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(60) NOT NULL
);

-- Prazos de recebimento (fixo: D+1, D+30, D+0)
CREATE TABLE IF NOT EXISTS prazos (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(60) NOT NULL,
  period_label VARCHAR(40) NOT NULL,   -- ex: 'por dia', 'por mês'
  annual_multiplier NUMERIC(6,2) NOT NULL -- multiplicador para projeção anual
);

-- Tipos de pagamento (Débito + Crédito 1x a 24x)
CREATE TABLE IF NOT EXISTS payment_types (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(40) NOT NULL,
  sort_order INT NOT NULL
);

-- Taxas GP4 cadastradas: uma por (categoria, prazo, tipo de pagamento)
CREATE TABLE IF NOT EXISTS rates (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id),
  prazo_id INT NOT NULL REFERENCES prazos(id),
  payment_type_id INT NOT NULL REFERENCES payment_types(id),
  gp4_rate NUMERIC(7,4), -- taxa em decimal, ex 0.0198 = 1,98%
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE(category_id, prazo_id, payment_type_id)
);

CREATE INDEX IF NOT EXISTS idx_rates_lookup ON rates(category_id, prazo_id);
