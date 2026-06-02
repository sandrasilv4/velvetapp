CREATE TABLE IF NOT EXISTS newsletter_envios (
  id SERIAL PRIMARY KEY,
  assunto TEXT NOT NULL,
  mensagem TEXT NOT NULL,
  total_enviados INTEGER NOT NULL DEFAULT 0,
  erro TEXT,
  admin_id INTEGER,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
