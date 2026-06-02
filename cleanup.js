const { Pool } = require("pg");

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function limparModelos() {
  console.log("🧹 Iniciando limpeza...");

  const result = await db.query(`
  SELECT m.id AS modelo_id, m.user_id
  FROM modelos m
  WHERE m.verificada = false
  AND m.prazo_validacao < NOW()
`);

  for (const modelo of result.rows) {

    await db.query("BEGIN");

    await db.query(
      "DELETE FROM modelo_dados_bancarios WHERE modelo_id = $1",
      [modelo.modelo_id]
    );

    await db.query(
      "DELETE FROM modelos_dados WHERE modelo_id = $1",
      [modelo.modelo_id]
    );

    await db.query(
      "DELETE FROM modelos WHERE id = $1",
      [modelo.modelo_id]
    );

    await db.query(
      "DELETE FROM users WHERE id = $1",
      [modelo.user_id]
    );

    await db.query("COMMIT");

    console.log(`❌ Modelo ${modelo.modelo_id} removido`);
  }

  console.log("✅ Limpeza finalizada");
  process.exit();
}

limparModelos();