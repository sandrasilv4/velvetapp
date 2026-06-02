-- Migração: adicionar colunas de compliance fiscal aos pagamentos de modelos
-- Executar no Supabase SQL Editor

ALTER TABLE modelo_pagamentos
  ADD COLUMN IF NOT EXISTS comissao_velvet NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS valor_liquido   NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS admin_id        INTEGER,
  ADD COLUMN IF NOT EXISTS pago_por        VARCHAR(100);

-- Índice para facilitar auditorias por admin
CREATE INDEX IF NOT EXISTS idx_modelo_pagamentos_admin_id ON modelo_pagamentos(admin_id);

-- Comentários para documentação da tabela
COMMENT ON COLUMN modelo_pagamentos.comissao_velvet IS 'Comissão retida pela Velvet (valor bruto - valor líquido)';
COMMENT ON COLUMN modelo_pagamentos.valor_liquido   IS 'Valor líquido efectivamente pago à modelo';
COMMENT ON COLUMN modelo_pagamentos.admin_id        IS 'ID do admin que processou o pagamento';
COMMENT ON COLUMN modelo_pagamentos.pago_por        IS 'Email/nome do admin que processou o pagamento';
