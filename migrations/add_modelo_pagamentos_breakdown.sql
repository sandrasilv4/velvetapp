-- Migração: breakdown completo do recibo de pagamento das modelos
-- Executar no Supabase SQL Editor

ALTER TABLE modelo_pagamentos
  ADD COLUMN IF NOT EXISTS taxa_agencia  NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS chargebacks   NUMERIC(10,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN modelo_pagamentos.taxa_agencia  IS 'Valor retido pela agência (calculado automaticamente ao marcar como pago)';
COMMENT ON COLUMN modelo_pagamentos.chargebacks   IS 'Valor de chargebacks/estornos deduzidos do pagamento à modelo';
