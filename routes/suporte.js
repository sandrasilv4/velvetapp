const express = require("express");
const router = express.Router();
const db = require("../db");
const authCliente = require("../middleware/authCliente");
const auth = require("../middleware/auth");
const authAdmin = require("../middleware/authAdmin");

// ─── CLIENTE: abre ou retoma conversa ───────────────────────────────────────
router.post("/conversa", async (req, res) => {
  try {
    const { nome, email, conversa_id } = req.body;

    // Retoma conversa existente
    if (conversa_id) {
      const { rows } = await db.query(
        "SELECT id, status FROM suporte_conversas WHERE id = $1",
        [conversa_id]
      );
      if (rows.length) return res.json({ conversa_id: rows[0].id, status: rows[0].status });
    }

    // Tenta identificar cliente logado via token opcional
    let cliente_id = null;
    try {
      const jwt = require("jsonwebtoken");
      const token = req.headers.authorization?.split(" ")[1];
      if (token) {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        if (decoded?.id) {
          const { rows } = await db.query(
            "SELECT id FROM clientes WHERE user_id = $1",
            [decoded.id]
          );
          if (rows.length) cliente_id = rows[0].id;
        }
      }
    } catch (_) {}

    const { rows } = await db.query(
      `INSERT INTO suporte_conversas (cliente_id, nome_visitante, email_visitante)
       VALUES ($1, $2, $3) RETURNING id`,
      [cliente_id, nome || null, email || null]
    );

    res.json({ conversa_id: rows[0].id, status: "aberta" });
  } catch (err) {
    console.error("Erro ao criar conversa de suporte:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── CLIENTE: envia mensagem ─────────────────────────────────────────────────
router.post("/conversa/:id/mensagem", async (req, res) => {
  try {
    const conversa_id = parseInt(req.params.id);
    const { texto } = req.body;

    if (!texto?.trim()) return res.status(400).json({ error: "Mensagem vazia" });

    const { rows: conv } = await db.query(
      "SELECT id FROM suporte_conversas WHERE id = $1 AND status != 'fechada'",
      [conversa_id]
    );
    if (!conv.length) return res.status(404).json({ error: "Conversa não encontrada" });

    const { rows } = await db.query(
      `INSERT INTO suporte_mensagens (conversa_id, remetente, texto)
       VALUES ($1, 'cliente', $2) RETURNING *`,
      [conversa_id, texto.trim()]
    );

    await db.query(
      "UPDATE suporte_conversas SET updated_at = NOW(), status = 'aberta' WHERE id = $1",
      [conversa_id]
    );

    // Notifica admin em tempo real via socket (injetado no app)
    const io = req.app.get("io");
    if (io) {
      io.to("suporte_admin").emit("suporte:nova_mensagem", {
        conversa_id,
        mensagem: rows[0]
      });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao enviar mensagem suporte:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── CLIENTE: lista mensagens da conversa ────────────────────────────────────
router.get("/conversa/:id/mensagens", async (req, res) => {
  try {
    const conversa_id = parseInt(req.params.id);
    const { rows } = await db.query(
      "SELECT * FROM suporte_mensagens WHERE conversa_id = $1 ORDER BY criado_em ASC",
      [conversa_id]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── CLIENTE: auto-resposta automática (sem auth, salva como admin) ──────────
router.post("/conversa/:id/auto-resposta", async (req, res) => {
  try {
    const conversa_id = parseInt(req.params.id);
    const { texto } = req.body;

    if (!texto?.trim()) return res.status(400).json({ error: "Mensagem vazia" });

    const { rows: conv } = await db.query(
      "SELECT id FROM suporte_conversas WHERE id = $1 AND status != 'fechada'",
      [conversa_id]
    );
    if (!conv.length) return res.status(404).json({ error: "Conversa não encontrada" });

    const { rows } = await db.query(
      `INSERT INTO suporte_mensagens (conversa_id, remetente, texto)
       VALUES ($1, 'admin', $2) RETURNING *`,
      [conversa_id, texto.trim()]
    );

    await db.query(
      "UPDATE suporte_conversas SET updated_at = NOW(), status = 'respondida' WHERE id = $1",
      [conversa_id]
    );

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao salvar auto-resposta:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── ADMIN: lista todas as conversas ─────────────────────────────────────────
router.get("/admin/conversas", auth, authAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        sc.id, sc.status, sc.created_at, sc.updated_at,
        sc.nome_visitante, sc.email_visitante, sc.cliente_id,
        (SELECT COUNT(*) FROM suporte_mensagens sm WHERE sm.conversa_id = sc.id AND sm.lida = false AND sm.remetente = 'cliente') AS nao_lidas,
        (SELECT texto FROM suporte_mensagens sm WHERE sm.conversa_id = sc.id ORDER BY sm.criado_em DESC LIMIT 1) AS ultima_mensagem
      FROM suporte_conversas sc
      ORDER BY sc.updated_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("Erro ao listar conversas suporte:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── ADMIN: mensagens de uma conversa ────────────────────────────────────────
router.get("/admin/conversa/:id/mensagens", auth, authAdmin, async (req, res) => {
  try {
    const conversa_id = parseInt(req.params.id);
    const { rows } = await db.query(
      "SELECT * FROM suporte_mensagens WHERE conversa_id = $1 ORDER BY criado_em ASC",
      [conversa_id]
    );

    // Marca como lidas
    await db.query(
      "UPDATE suporte_mensagens SET lida = true WHERE conversa_id = $1 AND remetente = 'cliente'",
      [conversa_id]
    );

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── ADMIN: responde ─────────────────────────────────────────────────────────
router.post("/admin/conversa/:id/responder", auth, authAdmin, async (req, res) => {
  try {
    const conversa_id = parseInt(req.params.id);
    const { texto } = req.body;

    if (!texto?.trim()) return res.status(400).json({ error: "Mensagem vazia" });

    const { rows } = await db.query(
      `INSERT INTO suporte_mensagens (conversa_id, remetente, texto)
       VALUES ($1, 'admin', $2) RETURNING *`,
      [conversa_id, texto.trim()]
    );

    await db.query(
      "UPDATE suporte_conversas SET updated_at = NOW(), status = 'respondida' WHERE id = $1",
      [conversa_id]
    );

    const io = req.app.get("io");
    if (io) {
      io.to(`suporte_${conversa_id}`).emit("suporte:resposta", rows[0]);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao responder suporte:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ─── ADMIN: fecha conversa ───────────────────────────────────────────────────
router.patch("/admin/conversa/:id/fechar", auth, authAdmin, async (req, res) => {
  try {
    await db.query(
      "UPDATE suporte_conversas SET status = 'fechada', updated_at = NOW() WHERE id = $1",
      [parseInt(req.params.id)]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
