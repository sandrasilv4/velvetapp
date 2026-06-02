-- Migração: guardar URL do contrato assinado junto à verificação da modelo
-- Executar no Supabase SQL Editor

ALTER TABLE modelos_verificacao
  ADD COLUMN IF NOT EXISTS contrato_pdf_url VARCHAR(500);

COMMENT ON COLUMN modelos_verificacao.contrato_pdf_url IS 'Key R2 do PDF do contrato assinado via ZapSign';
