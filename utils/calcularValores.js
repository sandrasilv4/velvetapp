const db = require("../db");

async function calcularValores({ modelo_id, valor_bruto, taxa_gateway }) {
  const regraRes = await db.query(`
    SELECT
      COALESCE(a.percentual_modelo, 0.70) AS percentual_modelo,
      COALESCE(a.percentual_agencia, 0) AS percentual_agencia,
      COALESCE(a.percentual_plataforma, 0.30) AS percentual_plataforma
    FROM modelos m
    LEFT JOIN agencias a ON a.id = m.agencia_id
    WHERE m.id = $1
  `, [modelo_id]);

  const regra = regraRes.rows[0];
  const bruto = Number(valor_bruto);
  const gateway = Number(taxa_gateway || 0);

  const valorModelo    = bruto * Number(regra.percentual_modelo);
  const valorAgencia   = bruto * Number(regra.percentual_agencia);
  const valorVelvet    = bruto * Number(regra.percentual_plataforma);

  return {
    valor_modelo: Number(valorModelo.toFixed(2)),
    agency_fee:   Number(valorAgencia.toFixed(2)),
    velvet_fee:   Number(valorVelvet.toFixed(2)),
    taxa_gateway: gateway
  };
}

module.exports = { calcularValores };
