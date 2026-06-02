-- Migração: Termo Digital de Aceite para Modelos
-- Executar no Supabase SQL Editor

-- ============================================================
-- 1. Tabela de registo auditável (evidência jurídica completa)
-- ============================================================
CREATE TABLE IF NOT EXISTS modelo_aceite_termos (
  id                  SERIAL PRIMARY KEY,
  modelo_id           INTEGER NOT NULL REFERENCES modelos(id) ON DELETE CASCADE,
  versao              VARCHAR(20) NOT NULL DEFAULT '2026-05',

  -- As 5 declarações obrigatórias
  aceite_maioridade   BOOLEAN NOT NULL DEFAULT false,  -- Declaração de maioridade (+18)
  aceite_conteudo     BOOLEAN NOT NULL DEFAULT false,  -- Consentimento de conteúdo
  aceite_tributario   BOOLEAN NOT NULL DEFAULT false,  -- Responsabilidade tributária
  aceite_independente BOOLEAN NOT NULL DEFAULT false,  -- Relação independente (sem vínculo)
  aceite_financeiro   BOOLEAN NOT NULL DEFAULT false,  -- Política financeira (comissão)

  -- Evidência forense do aceite
  aceite_ip           VARCHAR(100),
  aceite_user_agent   TEXT,
  aceite_em           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT uq_modelo_aceite_versao UNIQUE (modelo_id, versao)
);

CREATE INDEX IF NOT EXISTS idx_modelo_aceite_termos_modelo_id
  ON modelo_aceite_termos(modelo_id);

COMMENT ON TABLE  modelo_aceite_termos                        IS 'Registo auditável do aceite digital dos termos por modelos — evidência jurídica';
COMMENT ON COLUMN modelo_aceite_termos.versao                 IS 'Versão dos termos — permite forçar re-aceite quando os termos mudam';
COMMENT ON COLUMN modelo_aceite_termos.aceite_maioridade      IS 'Declaração de maioridade (+18 anos)';
COMMENT ON COLUMN modelo_aceite_termos.aceite_conteudo        IS 'Consentimento: todo o conteúdo pertence ou tem autorização legal';
COMMENT ON COLUMN modelo_aceite_termos.aceite_tributario      IS 'Responsabilidade tributária no país de residência';
COMMENT ON COLUMN modelo_aceite_termos.aceite_independente    IS 'Relação independente — sem vínculo empregatício com a Velvet';
COMMENT ON COLUMN modelo_aceite_termos.aceite_financeiro      IS 'Autorização de intermediação e retenção de comissão pela Velvet';
COMMENT ON COLUMN modelo_aceite_termos.aceite_ip              IS 'IP no momento do aceite — evidência legal';
COMMENT ON COLUMN modelo_aceite_termos.aceite_user_agent      IS 'User-Agent do browser — evidência legal';

-- ============================================================
-- 2. Colunas de atalho em modelos (para queries rápidas)
-- ============================================================
ALTER TABLE modelos
  ADD COLUMN IF NOT EXISTS termos_aceites BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS termos_versao  VARCHAR(20);

COMMENT ON COLUMN modelos.termos_aceites IS 'true se a modelo aceitou a versão atual dos termos';
COMMENT ON COLUMN modelos.termos_versao  IS 'Versão dos termos aceites pela modelo';
