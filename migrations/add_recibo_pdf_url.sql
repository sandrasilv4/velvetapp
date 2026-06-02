-- Migração: separar coluna do PDF gerado do comprovativo de transferência
-- Executar no Supabase SQL Editor

ALTER TABLE modelo_pagamentos
  ADD COLUMN IF NOT EXISTS recibo_pdf_url VARCHAR(500);

COMMENT ON COLUMN modelo_pagamentos.recibo_url     IS 'Key R2 do comprovativo de transferência/PIX carregado pelo admin';
COMMENT ON COLUMN modelo_pagamentos.recibo_pdf_url IS 'Key R2 do PDF de recibo gerado automaticamente ao marcar como pago';
