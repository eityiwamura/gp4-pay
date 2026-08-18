-- Trilha de auditoria: quem fez o quê e quando. Tela em /rastreabilidade.
--
-- Só administrador acessa (ver requireAdmin em src/middleware/auth.js) — de propósito,
-- NÃO é uma permissão concedível como as de user_permissions. Conceder isso a um usuário
-- comum deixaria ele ver o IP e o comportamento de todo mundo, inclusive de outros
-- administradores, o que é bem diferente de "deixar ele usar a Calculadora".
--
-- user_name é denormalizado pelo mesmo motivo do rate_history (migração 005): o registro
-- precisa continuar legível mesmo se o usuário for excluído depois. Em login malsucedido,
-- user_id fica nulo e user_name guarda o e-mail que foi tentado.
CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  occurred_at TIMESTAMP NOT NULL DEFAULT now(),
  user_id INT REFERENCES users(id) ON DELETE SET NULL,
  user_name VARCHAR(160) NOT NULL,
  action VARCHAR(30) NOT NULL,
  detail VARCHAR(200),
  ip_address VARCHAR(45)
);

CREATE INDEX IF NOT EXISTS idx_activity_log_recente ON activity_log(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id, occurred_at DESC);
