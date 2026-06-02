const express = require("express");
const router = express.Router();
const jwt = require("jsonwebtoken");
const db = require("../db");
const auth = require("../middleware/auth");
const authModelo = require("../middleware/authModelo");
const authCliente = require("../middleware/authCliente");
const { uploadB2 } = require("../config/storage");
const { uploadLimiter } = require("../config/rateLimiters");
const { uploadToSupabase } = require("../utils/upload");

// GET /api/modelo/publico/:modelo_id/premium
router.get("/publico/:modelo_id", async (req, res) => {
  try {
    const modelo_id = Number(req.params.modelo_id);
    if (!Number.isInteger(modelo_id) || modelo_id <= 0) return res.status(400).json({ error: "modelo_id inválido" });

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
    let role = null;
    let userId = 0;
    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        role = decoded?.role || null;
        userId = Number(decoded?.id || 0);
      } catch (_) {}
    }

    let ehDona = false;
    let cliente_id = null;

    if (role === "modelo" && userId) {
      const modeloRes = await db.query(`SELECT id FROM modelos WHERE user_id = $1 LIMIT 1`, [userId]);
      const modeloLogado = Number(modeloRes.rows[0]?.id || 0);
      ehDona = modeloLogado === modelo_id;
    }
    if (role === "cliente" && userId) {
      const clienteRes = await db.query(`SELECT id FROM clientes WHERE user_id = $1 LIMIT 1`, [userId]);
      cliente_id = Number(clienteRes.rows[0]?.id || 0) || null;
    }

    const result = await db.query(
      `SELECT p.id, p.modelo_id, p.preco, p.descricao, p.created_at,
              CASE WHEN $2=true THEN true WHEN $3::bigint IS NOT NULL AND EXISTS (SELECT 1 FROM premium_unlocks pu WHERE pu.premium_post_id=p.id AND pu.cliente_id=$3 AND pu.status='pago') THEN true ELSE false END AS liberado,
              COALESCE(json_agg(json_build_object('id',pm.id,'url',CASE WHEN $2=true THEN pm.url WHEN $3::bigint IS NOT NULL AND EXISTS (SELECT 1 FROM premium_unlocks pu WHERE pu.premium_post_id=p.id AND pu.cliente_id=$3 AND pu.status='pago') THEN pm.url ELSE NULL END,'thumb_url',pm.thumb_url,'tipo',pm.tipo,'ordem',pm.ordem) ORDER BY pm.ordem ASC,pm.id ASC) FILTER (WHERE pm.id IS NOT NULL),'[]'::json) AS midias
       FROM premium_posts p
       LEFT JOIN premium_post_midias pm ON pm.premium_post_id=p.id AND pm.ativo=true
       WHERE p.modelo_id=$1 AND p.ativo=true GROUP BY p.id ORDER BY p.created_at DESC`,
      [modelo_id, ehDona, cliente_id]
    );
    const rows = result.rows.map(item => {
      const midias = Array.isArray(item.midias) ? item.midias : [];
      const primeiraMidia = midias[0] || null;
      return { id: item.id, modelo_id: item.modelo_id, preco: item.preco, descricao: item.descricao, created_at: item.created_at, liberado: item.liberado, thumb_url: primeiraMidia?.thumb_url || null, tipo: primeiraMidia?.tipo || null, url: item.liberado ? (primeiraMidia?.url || null) : null, midias };
    });
    return res.json(rows);
  } catch (err) {
    console.error("Erro listar premium:", err);
    return res.status(500).json({ error: "Erro ao carregar premium" });
  }
});

// GET /api/premium/:premium_post_id/status
router.get("/:premium_post_id/status", authCliente, async (req, res) => {
  try {
    const premium_post_id = Number(req.params.premium_post_id);
    const userId = Number(req.user?.id || 0);
    if (!Number.isInteger(premium_post_id) || premium_post_id <= 0) return res.status(400).json({ error: "premium_post_id inválido" });

    const clienteRes = await db.query(`SELECT id FROM clientes WHERE user_id = $1 LIMIT 1`, [userId]);
    if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
    const cliente_id = Number(clienteRes.rows[0].id);

    const result = await db.query(
      `SELECT status, metodo_pagamento, gateway, pagarme_order_id, pagarme_charge_id, stripe_payment_intent_id, stripe_charge_id, stripe_checkout_session_id, modelo_id, pago_em, updated_at
       FROM premium_unlocks WHERE premium_post_id=$1 AND cliente_id=$2
       ORDER BY updated_at DESC NULLS LAST, pago_em DESC NULLS LAST LIMIT 1`,
      [premium_post_id, cliente_id]
    );
    if (!result.rows.length) {
      return res.json({ premium_post_id, liberado: false, status: "nao_encontrado", metodo_pagamento: null, gateway: null, pagarme_order_id: null, pagarme_charge_id: null, stripe_payment_intent_id: null, stripe_charge_id: null, stripe_checkout_session_id: null, modelo_id: null, pago_em: null, updated_at: null });
    }
    const row = result.rows[0];
    const status = String(row.status || "").toLowerCase().trim();
    return res.json({ premium_post_id, liberado: status === "pago", status, metodo_pagamento: row.metodo_pagamento || null, gateway: row.gateway || null, pagarme_order_id: row.pagarme_order_id || null, pagarme_charge_id: row.pagarme_charge_id || null, stripe_payment_intent_id: row.stripe_payment_intent_id || null, stripe_charge_id: row.stripe_charge_id || null, stripe_checkout_session_id: row.stripe_checkout_session_id || null, modelo_id: row.modelo_id || null, pago_em: row.pago_em || null, updated_at: row.updated_at || null });
  } catch (err) {
    console.error("Erro status premium:", err);
    return res.status(500).json({ error: "Erro ao consultar status" });
  }
});

// POST /api/premium
router.post("/", auth, authModelo, uploadLimiter, uploadB2.array("files", 10), async (req, res) => {
  const client = await db.connect();
  try {
    const userId = Number(req.user?.id || 0);
    const { descricao, preco } = req.body;
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: "Envie ao menos uma mídia" });
    const precoNum = Number(preco);
    if (!precoNum || precoNum <= 0) return res.status(400).json({ error: "Preço inválido" });

    const modeloRes = await client.query(`SELECT id, verificada FROM modelos WHERE user_id = $1 LIMIT 1`, [userId]);
    if (!modeloRes.rowCount) return res.status(404).json({ error: "Modelo não encontrado" });
    if (!modeloRes.rows[0].verificada) return res.status(403).json({ error: "Conta não verificada." });
    const modelo_id = Number(modeloRes.rows[0].id);

    await client.query("BEGIN");
    const postRes = await client.query(
      `INSERT INTO premium_posts (modelo_id, url, thumb_url, tipo, tipo_conteudo, preco, descricao, ativo, created_at, updated_at)
       VALUES ($1, NULL, NULL, NULL, $2, $3, $4, true, NOW(), NOW())
       RETURNING id, modelo_id, url, thumb_url, tipo, tipo_conteudo, preco, descricao, ativo, created_at, updated_at`,
      [modelo_id, "premium", precoNum, descricao || null]
    );
    const premium_post_id = Number(postRes.rows[0].id);
    const midiasCriadas = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const mimetype = file.mimetype || "";
      const tipo = mimetype.startsWith("video") ? "video" : "foto";
      const uploadResult = await uploadToSupabase(file.buffer, file.mimetype, file.originalname || `premium-${Date.now()}-${i}.${tipo === "video" ? "mp4" : "jpg"}`, "premium");
      if (!uploadResult.url) throw new Error(`Falha ao enviar arquivo ${i + 1}`);

      const midiaRes = await client.query(
        `INSERT INTO premium_post_midias (premium_post_id, url, thumb_url, tipo, ordem, ativo, created_at)
         VALUES ($1,$2,$3,$4,$5,true,NOW()) RETURNING id, premium_post_id, url, thumb_url, tipo, ordem`,
        [premium_post_id, uploadResult.url, uploadResult.thumb_url, tipo, i]
      );
      midiasCriadas.push(midiaRes.rows[0]);
    }

    const primeiraMidia = midiasCriadas[0] || null;
    await client.query(
      `UPDATE premium_posts SET url=$1, thumb_url=$2, tipo=$3, updated_at=NOW() WHERE id=$4`,
      [primeiraMidia?.url || null, primeiraMidia?.thumb_url || null, primeiraMidia?.tipo || null, premium_post_id]
    );
    await client.query("COMMIT");

    return res.json({ ...postRes.rows[0], url: primeiraMidia?.url || null, thumb_url: primeiraMidia?.thumb_url || null, tipo: primeiraMidia?.tipo || null, tipo_conteudo: "premium", midias: midiasCriadas });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro criar premium:", err.message);
    return res.status(500).json({ error: "Erro ao criar premium", debug: err.message });
  } finally {
    client.release();
  }
});

// DELETE /api/premium/:id
router.delete("/:id", auth, authModelo, async (req, res) => {
  try {
    const premiumId = Number(req.params.id);
    const userId = Number(req.user?.id || 0);
    if (!Number.isInteger(premiumId) || premiumId <= 0) return res.status(400).json({ error: "ID inválido" });

    const modeloRes = await db.query(`SELECT id FROM modelos WHERE user_id = $1 LIMIT 1`, [userId]);
    if (!modeloRes.rowCount) return res.status(404).json({ error: "Modelo não encontrada" });
    const modelo_id = Number(modeloRes.rows[0].id);

    const premiumRes = await db.query(
      `SELECT id, modelo_id FROM premium_posts WHERE id = $1 AND ativo = true LIMIT 1`, [premiumId]
    );
    if (!premiumRes.rowCount) return res.status(404).json({ error: "Postagem premium não encontrada" });
    if (Number(premiumRes.rows[0].modelo_id) !== modelo_id) return res.status(403).json({ error: "Sem permissão" });

    await db.query(`UPDATE premium_posts SET ativo = false WHERE id = $1`, [premiumId]);
    await db.query(`UPDATE premium_post_midias SET ativo = false WHERE premium_post_id = $1`, [premiumId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao excluir premium:", err);
    return res.status(500).json({ error: "Erro ao excluir premium" });
  }
});

module.exports = router;
