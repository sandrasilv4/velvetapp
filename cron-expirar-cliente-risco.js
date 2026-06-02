const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

(async () => {
  try {
    console.log("🧹 Iniciando limpeza de clientes de risco expirados...");

    // 🔹 BUSCAR CLIENTES EXPIRADOS
    const expirados = await pool.query(`
      SELECT cliente_id, ip, cpf, fingerprint
      FROM cliente_risco
      WHERE ativo = true
        AND expira_em IS NOT NULL
        AND expira_em <= NOW()
    `);

    if (expirados.rowCount === 0) {
      console.log("✅ Nenhum cliente de risco expirado");
      process.exit(0);
      return;
    }

    console.log(`⏰ Encontrados ${expirados.rowCount} cliente(s) expirado(s)`);

    for (const risco of expirados.rows) {
      const { cliente_id, ip, cpf, fingerprint } = risco;

      try {
        await pool.query("BEGIN");

        // Desativar cliente risco
        await pool.query(
          "UPDATE cliente_risco SET ativo = false WHERE cliente_id = $1",
          [cliente_id]
        );

        // Remover IP bloqueado
        if (ip) {
          await pool.query(
            "DELETE FROM ips_bloqueados WHERE ip = $1 AND cliente_id = $2",
            [ip, cliente_id]
          );
        }

        // Remover CPF bloqueado
        if (cpf) {
          await pool.query(
            "DELETE FROM cpfs_bloqueados WHERE cpf = $1 AND cliente_id = $2",
            [cpf, cliente_id]
          );
        }

        // Remover fingerprint bloqueado
        if (fingerprint) {
          await pool.query(
            "DELETE FROM fingerprint_bloqueados WHERE fingerprint = $1 AND cliente_id = $2",
            [fingerprint, cliente_id]
          );
        }

        // Registrar no log
        await pool.query(
          `INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
           VALUES ($1, $2, NOW(), $3, $4, $5)`,
          [
            null,
            `Cliente #${cliente_id} removido automaticamente - Risco expirado`,
            cliente_id,
            'cliente',
            'cliente_risco_expirado_removido'
          ]
        );

        await pool.query("COMMIT");
        console.log(`✓ Cliente #${cliente_id} removido`);

      } catch (err) {
        await pool.query("ROLLBACK");
        console.error(`❌ Erro cliente #${cliente_id}:`, err.message);
      }
    }

    console.log(`✅ Limpeza finalizada: ${expirados.rowCount} cliente(s) removido(s)`);
    process.exit(0);

  } catch (err) {
    console.error("Erro:", err);
    process.exit(1);
  }
})();