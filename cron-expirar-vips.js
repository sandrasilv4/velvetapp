const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    const preview = await pool.query(`
      SELECT id, cliente_id, modelo_id, expiration_at
      FROM vip_subscriptions
      WHERE ativo = true
        AND expiration_at < NOW()
    `);

    if (preview.rowCount === 0) {
      console.log("[cron-expirar-vips] Nenhuma assinatura a expirar.");
      process.exit(0);
    }

    console.log(`[cron-expirar-vips] ${preview.rowCount} assinatura(s) a expirar:`);
    preview.rows.forEach(r =>
      console.log(`  id=${r.id} cliente=${r.cliente_id} modelo=${r.modelo_id} expiration_at=${r.expiration_at}`)
    );

    const result = await pool.query(`
      UPDATE vip_subscriptions
      SET ativo = false
      WHERE ativo = true
        AND expiration_at < NOW()
    `);

    console.log(`[cron-expirar-vips] VIPs expirados: ${result.rowCount}`);
    process.exit(0);
  } catch (err) {
    console.error("[cron-expirar-vips] Erro:", err);
    process.exit(1);
  }
})();