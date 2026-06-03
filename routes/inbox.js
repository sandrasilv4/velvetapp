const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");


// ===============================
// 📥 GET /api/chat/inbox
// ===============================
router.get("/inbox", auth, async (req, res) => {
  try {
    const modeloId = req.user.id;

    const result = await db.query(`
      SELECT DISTINCT ON (c.id)
        c.id AS cliente_id,
        c.nome,
        NULL AS avatar,
        m.text        AS ultima_mensagem,
        m.created_at AS ultima_hora,
        (
          SELECT COUNT(*)
          FROM messages mx
          WHERE mx.cliente_id = c.id
            AND mx.modelo_id = $1
            AND mx.sender = 'cliente'
            AND mx.lida = false
        ) AS nao_lidas
      FROM clientes c
      LEFT JOIN messages m
        ON m.cliente_id = c.id
       AND m.modelo_id = $1
      LEFT JOIN clientes_dados cd
        ON cd.user_id = c.user_id
      ORDER BY c.id, m.created_at DESC NULLS LAST;
    `, [modeloId]);

    res.json(
      result.rows.map(r => ({
        cliente_id: r.cliente_id,
        nome: r.nome,
        foto: r.avatar || null,
        ultima_mensagem: r.ultima_mensagem || "",
        hora: r.ultima_hora
          ? new Date(r.ultima_hora).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit"
            })
          : "",
        nao_lidas: Number(r.nao_lidas || 0)
      }))
    );
  } catch (err) {
    console.error("🔥 ERRO INBOX:", err.message);
    res.status(500).json({ error: "Erro inbox" });
  }
});


// ===============================
// 💬 GET /api/chat/:cliente_id
// ===============================
router.get("/:cliente_id", auth, async (req, res) => {
  const cliente_id = req.params.cliente_id;
  const modelo_id = req.user.id;

  try {
    const result = await db.query(`
      SELECT *
      FROM messages
      WHERE cliente_id = $1
        AND modelo_id = $2
      ORDER BY created_at ASC
    `, [cliente_id, modelo_id]);

    // 🔹 marca mensagens do CLIENTE como lidas
    await db.query(`
      UPDATE messages
      SET lida = true
      WHERE cliente_id = $1
        AND modelo_id = $2
        AND sender = 'cliente'
        AND lida = false
    `, [cliente_id, modelo_id]);

    // 🔹 marca mensagens do MODELO como vistas
    await db.query(`
      UPDATE messages
      SET visto = true
      WHERE cliente_id = $1
        AND modelo_id = $2
        AND sender = 'modelo'
        AND visto IS DISTINCT FROM true
    `, [cliente_id, modelo_id]);

    // ⚠️ NÃO emitimos refreshInbox aqui
    // abrir chat não muda a inbox

    res.json(result.rows);
  } catch (err) {
    console.error("Erro chat:", err);
    res.status(500).json({ error: "Erro ao carregar chat" });
  }
});


// ===============================
// ✉️ POST /api/chat/send
// ===============================
router.post("/send", auth, async (req, res) => {
  const { cliente_id, modelo_id, text, sender } = req.body;

  if (!cliente_id || !modelo_id || !text || !sender) {
    return res.status(400).json({ error: "Mensagem inválida" });
  }

  try {
    await db.query(`
      INSERT INTO messages
      (cliente_id, modelo_id, text, sender, lida)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      cliente_id,
      modelo_id,
      text,
      sender,
      sender === "cliente" ? false : true
    ]);

    const io = req.app.get("io");

    // 🔔 inbox do MODELO (sempre!)
    io.to(`inbox_${modelo_id}`).emit("inboxMessage", {
      cliente_id,
      modelo_id,
      text,
      sender,
      created_at: new Date()
    });

    // fallback
    io.to(`inbox_${modelo_id}`).emit("refreshInbox");

    res.json({ ok: true });
  } catch (err) {
    console.error("Erro enviar:", err);
    res.status(500).json({ error: "Erro ao enviar" });
  }
});

module.exports = router;
