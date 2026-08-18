-- Usuário pode ser desativado sem perder o histórico.
ALTER TABLE users ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT true;

-- Incrementado a cada troca de senha / desativação: invalida os tokens já emitidos.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INT NOT NULL DEFAULT 0;

ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT now();

-- E-mail é sempre gravado em minúsculas (ver src/routes/users.js), então o UNIQUE
-- existente já basta para impedir "Joao@x.com" e "joao@x.com" ao mesmo tempo.

-- Telas liberadas para usuários comuns. Administrador não usa esta tabela: vê tudo.
CREATE TABLE IF NOT EXISTS user_permissions (
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  screen VARCHAR(40) NOT NULL,
  PRIMARY KEY (user_id, screen)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);

-- Usuários que já existiam antes das permissões existirem ficariam sem acesso a nada.
-- Libera a Calculadora para todos eles (é o mínimo para um vendedor trabalhar).
INSERT INTO user_permissions (user_id, screen)
SELECT id, 'calculator' FROM users WHERE role <> 'admin'
ON CONFLICT DO NOTHING;
