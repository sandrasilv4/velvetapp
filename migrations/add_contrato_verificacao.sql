-- Migração: suporte ao contrato digital ZapSign no onboarding da modelo
-- Executar no Supabase SQL Editor

ALTER TABLE modelos
  ADD COLUMN IF NOT EXISTS contrato_token         VARCHAR(200),
  ADD COLUMN IF NOT EXISTS contrato_signer_token  VARCHAR(200),
  ADD COLUMN IF NOT EXISTS contrato_sign_url      TEXT,
  ADD COLUMN IF NOT EXISTS contrato_assinado      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contrato_assinado_em   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS contrato_pdf_url       VARCHAR(500);

COMMENT ON COLUMN modelos.contrato_token         IS 'Token do documento no ZapSign';
COMMENT ON COLUMN modelos.contrato_signer_token  IS 'Token do signatário no ZapSign (usado para construir URL de assinatura)';
COMMENT ON COLUMN modelos.contrato_sign_url      IS 'URL de assinatura do ZapSign (iframe ou redirect)';
COMMENT ON COLUMN modelos.contrato_assinado      IS 'true quando ZapSign confirma assinatura via webhook ou polling';
COMMENT ON COLUMN modelos.contrato_assinado_em   IS 'Timestamp da confirmação de assinatura';
COMMENT ON COLUMN modelos.contrato_pdf_url       IS 'Key R2 do PDF assinado guardado após webhook ZapSign';
