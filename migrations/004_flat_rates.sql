-- Meios de pagamento que não têm bandeira nem prazo de recebimento configurável.
-- O PIX é o caso: cai sempre em D+1, não passa por Master/Visa/Elo e não parcela.
-- Por isso ele não cabe na tabela `rates` (que é chaveada por prazo + bandeira) e
-- ganha estrutura própria.
CREATE TABLE IF NOT EXISTS flat_payment_methods (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(60) NOT NULL,
  note VARCHAR(200),
  sort_order INT NOT NULL
);

CREATE TABLE IF NOT EXISTS flat_rates (
  id SERIAL PRIMARY KEY,
  category_id INT NOT NULL REFERENCES categories(id),
  method_id INT NOT NULL REFERENCES flat_payment_methods(id) ON DELETE CASCADE,
  gp4_rate NUMERIC(7,4) NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT now(),
  UNIQUE (category_id, method_id)
);

CREATE INDEX IF NOT EXISTS idx_flat_rates_category ON flat_rates(category_id);
