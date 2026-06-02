-- Adiciona token_version na tabela users para revogação de JWT
-- Executar uma vez no banco de produção

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
