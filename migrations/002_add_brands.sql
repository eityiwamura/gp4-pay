-- Bandeiras de cartão (Master, Visa, Elo)
CREATE TABLE IF NOT EXISTS payment_brands (
  id SERIAL PRIMARY KEY,
  code VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(40) NOT NULL,
  sort_order INT NOT NULL
);

-- Adiciona a coluna de bandeira nas taxas (nullable por enquanto, para não quebrar dados existentes)
ALTER TABLE rates ADD COLUMN IF NOT EXISTS brand_id INT REFERENCES payment_brands(id);

-- Remove a constraint antiga (categoria+prazo+tipo, sem bandeira), se existir
ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_category_id_prazo_id_payment_type_id_key;

-- Nova constraint incluindo a bandeira
ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_category_prazo_type_brand_key;
ALTER TABLE rates ADD CONSTRAINT rates_category_prazo_type_brand_key
  UNIQUE (category_id, prazo_id, payment_type_id, brand_id);
