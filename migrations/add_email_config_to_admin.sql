-- Adicionar coluna email_config à tabela admin
ALTER TABLE admin ADD COLUMN IF NOT EXISTS email_config JSONB;

-- Comentário explicativo
COMMENT ON COLUMN admin.email_config IS 'Configuração de email IMAP/SMTP armazenada em JSON';
