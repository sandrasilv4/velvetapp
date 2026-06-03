const express = require("express");
const router = express.Router();
const db = require("../db");
const authCliente = require("../middleware/authCliente");
const auth = require("../middleware/auth");

// Helper: upsert sem depender de UNIQUE constraint
async function upsertClienteDados(cliente_id, campos) {
  const keys   = Object.keys(campos);
  const values = Object.values(campos);

  if (keys.length === 0) {
    // Apenas confirma que o registo existe
    const upd = await db.query(
      `UPDATE clientes_dados SET atualizado_em=NOW() WHERE cliente_id=$1 RETURNING id`,
      [cliente_id]
    );
    if (upd.rowCount === 0) {
      await db.query(
        `INSERT INTO clientes_dados (cliente_id, atualizado_em) VALUES ($1, NOW())`,
        [cliente_id]
      );
    }
    return;
  }

  const setClauses = keys.map((k, i) => `${k}=$${i + 2}`).join(", ");
  const upd = await db.query(
    `UPDATE clientes_dados SET ${setClauses}, atualizado_em=NOW() WHERE cliente_id=$1 RETURNING id`,
    [cliente_id, ...values]
  );

  if (upd.rowCount === 0) {
    const cols    = ["cliente_id", ...keys, "atualizado_em"].join(", ");
    const params  = ["$1", ...keys.map((_, i) => `$${i + 2}`), "NOW()"].join(", ");
    await db.query(
      `INSERT INTO clientes_dados (${cols}) VALUES (${params})`,
      [cliente_id, ...values]
    );
  }
}

// GET /api/cliente/me
router.get("/me", authCliente, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id AS cliente_id, c.user_id, c.nome,
              cd.username, cd.nome_completo, cd.data_nascimento,
              cd.avatar, cd.capa
       FROM clientes c
       LEFT JOIN clientes_dados cd ON cd.cliente_id = c.id
       WHERE c.id = $1 AND c.ativo = true LIMIT 1`,
      [req.cliente_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Cliente não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    // Fallback sem JOIN caso clientes_dados tenha colunas diferentes
    try {
      const r = await db.query(
        `SELECT id AS cliente_id, user_id, nome FROM clientes WHERE id=$1 AND ativo=true`,
        [req.cliente_id]
      );
      if (!r.rows.length) return res.status(404).json({ error: "Cliente não encontrado" });
      res.json(r.rows[0]);
    } catch (e) {
      console.error("Erro /api/cliente/me:", e);
      res.status(500).json({ error: "Erro interno" });
    }
  }
});

// GET /api/cliente/modelos (modelos com vip ativo)
router.get("/modelos", authCliente, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.id AS modelo_id, m.nome_exibicao
       FROM vip_subscriptions v JOIN modelos m ON m.id = v.modelo_id
       WHERE v.cliente_id = $1 AND v.ativo = true AND v.expiration_at > NOW() AND m.ativo = true
       ORDER BY m.nome_exibicao`,
      [req.cliente_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erro modelos chat cliente:", err);
    res.status(500).json([]);
  }
});

// POST /api/cliente/dados  — salva os campos que existem na tabela
router.post("/dados", authCliente, async (req, res) => {
  try {
    const { username, nome_completo, data_nascimento } = req.body;

    const campos = {};
    if (username        != null) campos.username         = username || null;
    if (nome_completo   != null) campos.nome_completo    = nome_completo || null;
    if (data_nascimento != null) campos.data_nascimento  = data_nascimento || null;

    await upsertClienteDados(req.cliente_id, campos);
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro salvar dados cliente:", err);
    return res.status(500).json({ error: "Erro interno: " + err.message });
  }
});

// PUT /api/cliente/dados
router.put("/dados", authCliente, async (req, res) => {
  try {
    const { username } = req.body;
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Username obrigatório." });
    }
    await upsertClienteDados(req.cliente_id, { username: username.trim() });
    res.json({ success: true });
  } catch (err) {
    console.error("Erro atualizar dados cliente:", err);
    res.status(500).json({ error: "Erro interno: " + err.message });
  }
});

// PUT /api/cliente/subscricoes/:id/cancelar
router.put("/subscricoes/:id/cancelar", auth, async (req, res) => {
  try {
    const subscriptionId = req.params.id;
    const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id = $1", [req.user.id]);
    if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado." });
    const clienteId = clienteRes.rows[0].id;

    const subRes = await db.query(
      `SELECT id, ativo FROM vip_subscriptions WHERE id = $1 AND cliente_id = $2`,
      [subscriptionId, clienteId]
    );
    if (!subRes.rowCount) return res.status(403).json({ error: "Subscrição inválida." });
    if (!subRes.rows[0].ativo) return res.status(400).json({ error: "Esta subscrição já está cancelada." });

    await db.query(`UPDATE vip_subscriptions SET recorrente = false, ativo = false WHERE id = $1`, [subscriptionId]);
    return res.status(200).json({ success: true, message: "Subscrição cancelada com sucesso." });
  } catch (err) {
    console.error("Erro ao cancelar:", err);
    return res.status(500).json({ error: "Erro interno ao cancelar subscrição." });
  }
});

module.exports = router;
