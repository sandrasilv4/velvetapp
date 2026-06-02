const express = require("express");
const router = express.Router();
const db = require("../db");
const authCliente = require("../middleware/authCliente");
const auth = require("../middleware/auth");

// GET /api/cliente/me
router.get("/me", authCliente, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id AS cliente_id, c.user_id, c.nome, cd.username, cd.avatar, cd.capa, cd.instagram, cd.tiktok, cd.local, cd.bio
       FROM clientes c LEFT JOIN clientes_dados cd ON cd.cliente_id = c.id AND cd.ativo = true
       WHERE c.id = $1 AND c.ativo = true`,
      [req.cliente_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Cliente não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro /api/cliente/me:", err);
    res.status(500).json({ error: "Erro interno" });
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

// POST /api/cliente/dados
router.post("/dados", authCliente, async (req, res) => {
  try {
    const { username, nome_completo, data_nascimento, pais, nome_exibicao, instagram, tiktok, local, bio, avatar, avatar_thumb, capa } = req.body;
    const clienteRes = await db.query(
      `SELECT id FROM clientes WHERE id = $1 AND ativo = true LIMIT 1`, [req.cliente_id]
    );
    if (clienteRes.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado ou desativado" });

    await db.query(
      `INSERT INTO clientes_dados (cliente_id, username, nome_completo, data_nascimento, pais, nome_exibicao, instagram, tiktok, local, bio, avatar, avatar_thumb, capa, ativo, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,NOW(),NOW())
       ON CONFLICT (cliente_id) DO UPDATE SET
         username=EXCLUDED.username, nome_completo=EXCLUDED.nome_completo,
         data_nascimento=EXCLUDED.data_nascimento, pais=EXCLUDED.pais,
         nome_exibicao=EXCLUDED.nome_exibicao, instagram=EXCLUDED.instagram,
         tiktok=EXCLUDED.tiktok, local=EXCLUDED.local, bio=EXCLUDED.bio,
         avatar=EXCLUDED.avatar, avatar_thumb=EXCLUDED.avatar_thumb, capa=EXCLUDED.capa,
         ativo=true, desativado_em=NULL, atualizado_em=NOW()`,
      [req.cliente_id, username||null, nome_completo||null, data_nascimento||null, pais||null,
       nome_exibicao||null, instagram||null, tiktok||null, local||null, bio||null,
       avatar||null, avatar_thumb||null, capa||null]
    );
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro salvar dados cliente:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// PUT /api/cliente/dados
router.put("/dados", authCliente, async (req, res) => {
  try {
    const { username, instagram, tiktok, local, bio } = req.body;
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Username obrigatório." });
    }
    await db.query(
      `INSERT INTO clientes_dados (cliente_id, username, instagram, tiktok, local, bio, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
       ON CONFLICT (cliente_id) DO UPDATE SET
         username=COALESCE(EXCLUDED.username,clientes_dados.username),
         instagram=COALESCE(EXCLUDED.instagram,clientes_dados.instagram),
         tiktok=COALESCE(EXCLUDED.tiktok,clientes_dados.tiktok),
         local=COALESCE(EXCLUDED.local,clientes_dados.local),
         bio=COALESCE(EXCLUDED.bio,clientes_dados.bio),
         atualizado_em=NOW()`,
      [req.cliente_id, username.trim(), instagram||null, tiktok||null, local||null, bio||null]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Erro atualizar dados cliente:", err);
    res.status(500).json({ error: "Erro interno." });
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
