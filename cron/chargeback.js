const cron = require("node-cron");
const db   = require("../db");

cron.schedule("0 3 * * *", async () => {
  console.log("Verificando clientes com chargeback...");

  const { rows } = await db.query(`
    SELECT
      cliente_id,
      COUNT(*) AS total,
      SUM(valor_bruto) AS valor,
      MAX(created_at) AS ultimo
    FROM transacoes_agency
    WHERE status = 'chargeback'
      AND created_at >= NOW() - INTERVAL '60 days'
    GROUP BY cliente_id
    HAVING COUNT(*) >= 2
  `);

  for (const c of rows) {
    let nivel = "atencao";
    if (c.total >= 5 || Number(c.valor) >= 50) nivel = "critico";
    else if (c.total >= 3) nivel = "alto";

    await db.query(`
      INSERT INTO chargeback_alertas
        (cliente_id, nivel, total_chargebacks, valor_total, ultimo_chargeback)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (cliente_id)
      DO UPDATE SET
        nivel = EXCLUDED.nivel,
        total_chargebacks = EXCLUDED.total_chargebacks,
        valor_total = EXCLUDED.valor_total,
        ultimo_chargeback = EXCLUDED.ultimo_chargeback,
        ativo = true
    `, [c.cliente_id, nivel, c.total, c.valor, c.ultimo]);
  }
});
