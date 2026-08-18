-- Histórico de alteração de taxas (append-only).
--
-- `rates.updated_at` só guardava o último toque: não dizia quem mexeu nem qual era o
-- valor anterior. Sem isso não dá para reconstruir a taxa que valia quando uma proposta
-- antiga foi feita.
--
-- Campos denormalizados de propósito (`user_name`, `label`): um log de auditoria precisa
-- preservar o que era verdade na hora do registro, mesmo que o usuário seja excluído ou
-- que um cadastro seja renomeado depois.
CREATE TABLE IF NOT EXISTS rate_history (
  id SERIAL PRIMARY KEY,
  changed_at TIMESTAMP NOT NULL DEFAULT now(),

  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  user_name VARCHAR(120) NOT NULL,

  -- 'rate' = taxa comum (categoria+prazo+bandeira+tipo)
  -- 'flat' = meio sem bandeira, ex. PIX (categoria+meio)
  kind VARCHAR(10) NOT NULL,
  label VARCHAR(160) NOT NULL,

  category_id INT REFERENCES categories(id),
  prazo_id INT REFERENCES prazos(id),
  brand_id INT REFERENCES payment_brands(id),
  payment_type_id INT REFERENCES payment_types(id),
  method_id INT REFERENCES flat_payment_methods(id),

  -- NULL em old_rate = a taxa não existia (cadastro novo)
  -- NULL em new_rate = a taxa foi removida
  old_rate NUMERIC(7,4),
  new_rate NUMERIC(7,4)
);

CREATE INDEX IF NOT EXISTS idx_rate_history_recente ON rate_history(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_rate_history_categoria ON rate_history(category_id, changed_at DESC);
