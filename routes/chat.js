const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const authModelo = require("../middleware/authModelo");
const authCliente = require("../middleware/authCliente");
const { buscarUnreadCliente, buscarUnreadModelo, buscarConteudosJaPossuidosPorCliente } = require("../utils/helpers");

// GET /api/chat/unread/cliente
router.get("/unread/cliente", authCliente, async (req, res) => {
  try {
    const ids = await buscarUnreadCliente(req.cliente_id);
    res.json(ids);
  } catch (err) {
    console.error("Erro unread cliente:", err);
    res.status(500).json([]);
  }
});

// GET /api/chat/unread/modelo
router.get("/unread/modelo", authModelo, async (req, res) => {
  try {
    const ids = await buscarUnreadModelo(req.modelo_id);
    res.json(ids);
  } catch (err) {
    console.error("Erro unread modelo:", err);
    res.status(500).json([]);
  }
});

// GET /api/chat/cliente (inbox cliente)
router.get("/cliente", authCliente, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT m.id AS modelo_id, m.nome_exibicao, m.avatar AS avatar,
             msg.text AS ultima_mensagem, msg.created_at AS ultima_mensagem_em, msg.lida, msg.sender
      FROM vip_subscriptions v
      JOIN modelos m ON m.id = v.modelo_id
      LEFT JOIN LATERAL (
        SELECT text, created_at, lida, sender FROM messages
        WHERE messages.cliente_id = v.cliente_id AND messages.modelo_id = v.modelo_id
        ORDER BY created_at DESC LIMIT 1
      ) msg ON true
      WHERE v.cliente_id = $1 AND v.ativo = true AND v.expiration_at > NOW()
      ORDER BY CASE WHEN msg.sender='modelo' AND COALESCE(msg.lida,false)=false THEN 1 ELSE 2 END, msg.created_at DESC NULLS LAST
    `, [req.cliente_id]);
    res.json(rows);
  } catch (err) {
    console.error("Erro chat cliente:", err);
    res.status(500).json([]);
  }
});

// GET /api/chat/modelo (inbox modelo)
router.get("/modelo", authModelo, async (req, res) => {
  try {
    const userId = req.user.id;
    const modeloResult = await db.query("SELECT id FROM modelos WHERE user_id = $1", [userId]);
    if (modeloResult.rowCount === 0) return res.status(404).json({ error: "Modelo não encontrada" });
    const modeloId = modeloResult.rows[0].id;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows } = await db.query(
      `SELECT c.id AS cliente_id, c.nome, NULL AS username, NULL AS avatar,
              COALESCE(cnm.resumo_curto,'') AS resumo_curto,
              msg.text AS ultima_mensagem, msg.created_at AS ultima_mensagem_em,
              msg.sender AS ultimo_sender,
              COALESCE(msg.visto,false) AS visto, COALESCE(msg.lida,false) AS lida,
              COALESCE(g.total_gasto,0) AS total_gasto,
              CASE WHEN COALESCE(g.total_gasto,0)>=300 THEN '$$$' WHEN COALESCE(g.total_gasto,0)>=200 THEN '$$' WHEN COALESCE(g.total_gasto,0)>100 THEN '$' ELSE '' END AS spend_level,
              CASE WHEN msg.sender='cliente' AND COALESCE(msg.lida,false)=false THEN true ELSE false END AS nao_lido,
              CASE WHEN msg.sender='cliente' AND COALESCE(msg.lida,false)=true THEN true ELSE false END AS por_responder,
              CASE WHEN msg.sender='modelo' AND COALESCE(msg.visto,false)=true THEN true ELSE false END AS cliente_visualizou
       FROM vip_subscriptions v
       JOIN clientes c ON c.id = v.cliente_id
       LEFT JOIN cliente_notas_modelo cnm ON cnm.cliente_id=c.id AND cnm.modelo_id=$1
       LEFT JOIN LATERAL (
         SELECT text, created_at, visto, lida, sender FROM messages
         WHERE messages.cliente_id=c.id AND messages.modelo_id=$1
         ORDER BY created_at DESC LIMIT 1
       ) msg ON true
       LEFT JOIN LATERAL (
         SELECT SUM(valor_bruto) AS total_gasto FROM transacoes_agency t
         WHERE t.cliente_id=c.id AND t.modelo_id=$1 AND t.status='pago' AND t.tipo IN ('midia','assinatura')
       ) g ON true
       WHERE v.modelo_id=$1 AND v.ativo=true AND v.expiration_at>NOW()
       ORDER BY CASE WHEN msg.sender='cliente' AND COALESCE(msg.lida,false)=false THEN 1 WHEN msg.sender='cliente' AND COALESCE(msg.lida,false)=true THEN 2 WHEN msg.sender='modelo' AND COALESCE(msg.visto,false)=true THEN 3 WHEN msg.sender='modelo' AND COALESCE(msg.visto,false)=false THEN 4 ELSE 5 END, msg.created_at DESC NULLS LAST, c.id DESC
       LIMIT $2 OFFSET $3`,
      [modeloId, limit, offset]
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar chats da modelo:", err);
    res.status(500).json({ error: "Erro ao buscar chats" });
  }
});

// GET /api/chat/cliente/:cliente_id (info do cliente para modelo)
router.get("/cliente/:cliente_id", authModelo, async (req, res) => {
  const cliente_id = Number(req.params.cliente_id);
  if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
    return res.status(400).json({ error: "cliente_id inválido" });
  }
  try {
    const result = await db.query(
      `SELECT c.id AS cliente_id, c.nome, c.last_seen, NULL AS username, NULL AS avatar
       FROM clientes c WHERE c.id = $1 AND c.ativo = true LIMIT 1`,
      [cliente_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Cliente não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro buscar cliente:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// GET /api/chat/cliente/:cliente_id/anotacoes
router.get("/cliente/:cliente_id/anotacoes", authModelo, async (req, res) => {
  try {
    const cliente_id = Number(req.params.cliente_id);
    if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
      return res.status(400).json({ error: "cliente_id inválido" });
    }
    const modeloRes = await db.query(`SELECT id FROM modelos WHERE user_id = $1 LIMIT 1`, [req.user.id]);
    if (!modeloRes.rowCount) return res.status(403).json({ error: "Modelo não encontrada" });
    const modelo_id = Number(modeloRes.rows[0].id);

    const result = await db.query(
      `SELECT resumo_curto, nota_privada, updated_at FROM cliente_notas_modelo
       WHERE modelo_id = $1 AND cliente_id = $2 LIMIT 1`,
      [modelo_id, cliente_id]
    );
    if (!result.rowCount) return res.json({ resumo_curto: "", nota_privada: "", updated_at: null });
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao buscar anotações do cliente:", err);
    return res.status(500).json({ error: "Erro interno ao buscar anotações" });
  }
});

// PUT /api/chat/cliente/:cliente_id/anotacoes
router.put("/cliente/:cliente_id/anotacoes", authModelo, async (req, res) => {
  try {
    const cliente_id = Number(req.params.cliente_id);
    if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
      return res.status(400).json({ error: "cliente_id inválido" });
    }
    let { resumo_curto, nota_privada } = req.body || {};
    resumo_curto = String(resumo_curto || "").trim();
    nota_privada = String(nota_privada || "").trim();
    if (resumo_curto.length > 120) return res.status(400).json({ error: "Resumo curto deve ter no máximo 120 caracteres" });

    const modeloRes = await db.query(`SELECT id FROM modelos WHERE user_id = $1 LIMIT 1`, [req.user.id]);
    if (!modeloRes.rowCount) return res.status(403).json({ error: "Modelo não encontrada" });
    const modelo_id = Number(modeloRes.rows[0].id);

    const result = await db.query(
      `INSERT INTO cliente_notas_modelo (modelo_id, cliente_id, resumo_curto, nota_privada, updated_at)
       VALUES ($1,$2,$3,$4,NOW())
       ON CONFLICT (modelo_id, cliente_id) DO UPDATE SET
         resumo_curto=EXCLUDED.resumo_curto, nota_privada=EXCLUDED.nota_privada, updated_at=NOW()
       RETURNING resumo_curto, nota_privada, updated_at`,
      [modelo_id, cliente_id, resumo_curto || null, nota_privada || null]
    );
    return res.json({ ok: true, ...result.rows[0] });
  } catch (err) {
    console.error("Erro ao salvar anotações do cliente:", err);
    return res.status(500).json({ error: "Erro interno ao salvar anotações" });
  }
});

// GET /api/chat/conteudo/:message_id
router.get("/conteudo/:message_id", authCliente, async (req, res) => {
  const message_id = Number(req.params.message_id);
  if (!Number.isInteger(message_id) || message_id <= 0) {
    return res.status(400).json({ error: "message_id inválido" });
  }
  try {
    const messageCheck = await db.query(
      `SELECT id, visto, preco, modelo_id, pacote_id, tipo FROM messages WHERE id = $1 AND cliente_id = $2`,
      [message_id, req.cliente_id]
    );
    if (!messageCheck.rowCount) return res.status(403).json({ error: "Acesso negado" });

    const mensagem = messageCheck.rows[0];
    const preco = Number(mensagem.preco || 0);
    const pagoRes = await db.query(
      `SELECT 1 FROM conteudo_pacotes WHERE message_id = $1 AND cliente_id = $2 AND status = 'pago' LIMIT 1`,
      [message_id, req.cliente_id]
    );
    const pacotePago = !!pagoRes.rowCount;
    const mensagemLiberada = mensagem.visto === true || pacotePago;

    const result = await db.query(
      `SELECT mc.conteudo_id, c.url, c.tipo AS tipo_media, c.thumbnail_url
       FROM messages_conteudos mc JOIN conteudos c ON c.id = mc.conteudo_id
       WHERE mc.message_id = $1`,
      [message_id]
    );

    if (preco <= 0 || mensagemLiberada) {
      return res.json(result.rows.map(row => ({
        conteudo_id: Number(row.conteudo_id), url: row.url,
        tipo_media: row.tipo_media, thumbnail_url: row.thumbnail_url,
        liberado: true, bloqueado: false, ja_possuia: true
      })));
    }

    const ehMass = mensagem.tipo === "conteudo_ppv_mass";
    if (!ehMass) return res.status(403).json({ error: "Conteúdo não liberado" });

    const conteudosPossuidosSet = await buscarConteudosJaPossuidosPorCliente(db, {
      cliente_id: req.cliente_id, modelo_id: Number(mensagem.modelo_id)
    });
    const midias = result.rows.map(row => {
      const conteudoId = Number(row.conteudo_id);
      const jaPossuia = conteudosPossuidosSet.has(conteudoId);
      return { conteudo_id: conteudoId, url: row.url, tipo_media: row.tipo_media, thumbnail_url: row.thumbnail_url, ja_possuia: jaPossuia, liberado: jaPossuia, bloqueado: !jaPossuia };
    });
    if (!midias.some(m => m.liberado)) return res.status(403).json({ error: "Conteúdo não liberado" });
    return res.json(midias);
  } catch (err) {
    console.error("Erro buscar conteúdo liberado:", err);
    res.status(500).json([]);
  }
});

// GET /api/chat/conteudo-status/:message_id
router.get("/conteudo-status/:message_id", authCliente, async (req, res) => {
  const message_id = Number(req.params.message_id);
  if (!Number.isInteger(message_id) || message_id <= 0) return res.json({ liberado: false });
  try {
    const msg = await db.query(`SELECT visto, preco FROM messages WHERE id = $1 AND cliente_id = $2`, [message_id, req.cliente_id]);
    if (!msg.rowCount) return res.json({ liberado: false });
    if (msg.rows[0].visto === true) return res.json({ liberado: true });
    const pago = await db.query(
      `SELECT 1 FROM conteudo_pacotes WHERE message_id = $1 AND cliente_id = $2 AND status = 'pago' LIMIT 1`,
      [message_id, req.cliente_id]
    );
    return res.json({ liberado: !!pago.rowCount });
  } catch (err) {
    console.error("Erro conteudo-status:", err);
    return res.status(500).json({ liberado: false });
  }
});

// GET /api/chat/conteudos-vistos/:cliente_id
router.get("/conteudos-vistos/:cliente_id", authModelo, async (req, res) => {
  const cliente_id = Number(req.params.cliente_id);
  if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
    return res.status(400).json({ error: "cliente_id inválido" });
  }
  try {
    const result = await db.query(
      `SELECT DISTINCT mc.conteudo_id FROM messages m
       JOIN messages_conteudos mc ON mc.message_id = m.id
       WHERE m.modelo_id = $1 AND m.cliente_id = $2 AND m.visto = true`,
      [req.modelo_id, cliente_id]
    );
    res.json(result.rows.map(r => r.conteudo_id));
  } catch (err) {
    console.error("Erro buscar conteudos vistos:", err);
    res.status(500).json([]);
  }
});

// POST /api/chat/modelo/marcar-lido/:cliente_id
router.post("/modelo/marcar-lido/:cliente_id", authModelo, async (req, res) => {
  const cliente_id = Number(req.params.cliente_id);
  if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
    return res.status(400).json({ error: "cliente_id inválido" });
  }
  try {
    const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id = $1", [req.user.id]);
    if (modeloRes.rowCount === 0) return res.status(404).json({ error: "Modelo não encontrado" });
    const modelo_id = modeloRes.rows[0].id;

    const updateRes = await db.query(
      `UPDATE messages SET lida = true WHERE cliente_id=$1 AND modelo_id=$2 AND sender='cliente' AND COALESCE(lida,false)=false`,
      [cliente_id, modelo_id]
    );
    await db.query(`UPDATE modelos SET last_seen = NOW() WHERE id = $1`, [modelo_id]);
    return res.json({ success: true, atualizadas: updateRes.rowCount });
  } catch (err) {
    console.error("Erro marcar lido:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// POST /api/chat/cliente/marcar-lido/:modelo_id
router.post("/cliente/marcar-lido/:modelo_id", authCliente, async (req, res) => {
  const modelo_id = Number(req.params.modelo_id);
  if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
    return res.status(400).json({ error: "modelo_id inválido" });
  }
  try {
    const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id = $1", [req.user.id]);
    if (clienteRes.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
    const cliente_id = clienteRes.rows[0].id;

    const updateRes = await db.query(
      `UPDATE messages SET lida = true WHERE cliente_id=$1 AND modelo_id=$2 AND sender='modelo' AND COALESCE(lida,false)=false`,
      [cliente_id, modelo_id]
    );
    await db.query(`UPDATE clientes SET last_seen = NOW() WHERE id = $1`, [cliente_id]);
    return res.json({ success: true, atualizadas: updateRes.rowCount });
  } catch (err) {
    console.error("Erro marcar lido cliente:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// POST /api/conteudo/visto
router.post("/conteudo/visto", auth, async (req, res) => {
  const { message_id } = req.body;
  const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id = $1", [req.user.id]);
  if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
  const cliente_id = clienteRes.rows[0].id;
  await db.query(
    `UPDATE messages SET visto = true, updated_at = NOW() WHERE id = $1 AND cliente_id = $2`,
    [message_id, cliente_id]
  );
  res.json({ ok: true });
});

// DELETE /api/chat/pacote/:message_id
router.delete("/pacote/:message_id", authModelo, async (req, res) => {
  const message_id = Number(req.params.message_id);
  if (!Number.isInteger(message_id)) return res.status(400).json({ error: "message_id inválido" });
  try {
    const msgRes = await db.query(`SELECT id, modelo_id, cliente_id, visto FROM messages WHERE id = $1`, [message_id]);
    if (!msgRes.rowCount) return res.status(404).json({ error: "Mensagem não encontrada" });
    const mensagem = msgRes.rows[0];
    if (mensagem.modelo_id !== req.modelo_id) return res.status(403).json({ error: "Acesso negado" });
    if (mensagem.visto === true) return res.status(400).json({ error: "Conteúdo já visualizado não pode ser excluído." });

    const pagoRes = await db.query(
      `SELECT 1 FROM conteudo_pacotes WHERE message_id = $1 AND status = 'pago' LIMIT 1`, [message_id]
    );
    if (pagoRes.rowCount > 0) return res.status(400).json({ error: "Conteúdo já pago não pode ser excluído." });

    await db.query(`UPDATE messages SET deletada = true WHERE id = $1`, [message_id]);

    const io = req.app.get("io");
    if (io) io.to(`chat_${mensagem.cliente_id}_${mensagem.modelo_id}`).emit("mensagemExcluida", { id: message_id });
    res.json({ success: true });
  } catch (err) {
    console.error("Erro excluir pacote:", err);
    res.status(500).json({ error: "Erro ao excluir pacote" });
  }
});

module.exports = router;
