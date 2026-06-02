const express = require("express");
const router = express.Router();
const path = require("path");
const db = require("../db");
const auth = require("../middleware/auth");
const authModelo = require("../middleware/authModelo");
const { uploadB2 } = require("../config/storage");
const { uploadLimiter } = require("../config/rateLimiters");
const { uploadToSupabase } = require("../utils/upload");

// GET /api/conteudos (lista mídias para popup no chat)
router.get("/", authModelo, async (req, res) => {
  const { page = 1, limit = 10 } = req.query;
  try {
    const pagina = Number(page);
    const limite = Number(limit);
    const offset = (pagina - 1) * limite;

    const result = await db.query(
      `SELECT c.id, c.modelo_id, c.tipo, c.tipo_conteudo, c.url, c.thumbnail_url, c.criado_em
       FROM conteudos c WHERE c.modelo_id=$1 AND c.ativo=TRUE AND c.tipo_conteudo='venda'
       ORDER BY c.criado_em DESC LIMIT $2 OFFSET $3`,
      [req.modelo_id, limite, offset]
    );
    const totalRes = await db.query(
      `SELECT COUNT(*) FROM conteudos c WHERE c.modelo_id=$1 AND c.ativo=TRUE AND c.tipo_conteudo='venda'`,
      [req.modelo_id]
    );
    const total = Number(totalRes.rows[0].count);
    res.json({ conteudos: result.rows, total, totalPaginas: Math.ceil(total / limite), paginaAtual: pagina });
  } catch (err) {
    console.error("Erro listar conteúdos:", err);
    res.status(500).json({ error: "Erro ao listar conteúdos" });
  }
});

// POST /api/conteudos (upload de mídias para venda)
router.post("/", authModelo, uploadLimiter, uploadB2.array("file", 10), async (req, res) => {
  const userId = req.user.id;
  const { preco, descricao } = req.body;
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: "Arquivo obrigatório" });
  try {
    const modeloRes = await db.query("SELECT id, verificada FROM modelos WHERE user_id = $1", [userId]);
    if (modeloRes.rowCount === 0) return res.status(404).json({ error: "Modelo não encontrado" });
    if (!modeloRes.rows[0].verificada) return res.status(403).json({ error: "Conta não verificada. Apenas modelos verificadas podem fazer upload." });
    const modelo_id = modeloRes.rows[0].id;
    const resultados = [];

    for (const file of req.files) {
      const { mimetype, originalname, buffer } = file;
      let tipo;
      if (mimetype.startsWith("image/")) tipo = "imagem";
      else if (mimetype.startsWith("video/")) tipo = "video";
      else continue;

      const uploadResult = await uploadToSupabase(buffer, mimetype, originalname, "venda");
      const result = await db.query(
        `INSERT INTO conteudos (modelo_id, url, thumbnail_url, tipo, tipo_conteudo, preco, descricao, criado_em)
         VALUES ($1,$2,$3,$4,'venda',$5,$6,NOW()) RETURNING *`,
        [modelo_id, uploadResult.url, uploadResult.thumb_url, tipo, preco || 0, descricao || null]
      );
      resultados.push(result.rows[0]);
    }
    res.json(resultados);
  } catch (err) {
    console.error("Erro upload múltiplo:", err);
    res.status(500).json({ error: "Erro ao carregar conteúdo" });
  }
});

// POST /api/upload (upload de mídias para feed/venda)
router.post("/upload", auth, authModelo, uploadLimiter, uploadB2.array("file", 10), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) return res.status(400).json({ error: "Arquivo não enviado" });

    const modeloRes = await db.query(`SELECT id, verificada FROM modelos WHERE user_id = $1`, [req.user.id]);
    if (modeloRes.rowCount === 0) return res.status(404).json({ error: "Modelo não encontrado" });
    if (!modeloRes.rows[0].verificada) return res.status(403).json({ error: "Conta não verificada." });
    const modelo_id = modeloRes.rows[0].id;
    const { tipo_conteudo, preco, descricao } = req.body;
    const tipoFinal = tipo_conteudo || "feed";

    for (const file of req.files) {
      const mimetype = file.mimetype || "";
      let tipo;
      if (mimetype.startsWith("image/")) tipo = "imagem";
      else if (mimetype.startsWith("video/")) tipo = "video";
      else continue;

      const bucket = tipoFinal === "venda" ? "venda" : "feed";
      const result = await uploadToSupabase(file.buffer, file.mimetype, file.originalname, bucket);

      await db.query(
        `INSERT INTO conteudos (modelo_id, url, thumbnail_url, tipo, tipo_conteudo, preco, descricao) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [modelo_id, result.url, result.thumb_url, tipo, tipoFinal, preco ? Number(preco) : null, descricao || null]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Erro /api/upload:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// DELETE /api/conteudos/:id
router.delete("/:id", authModelo, async (req, res) => {
  const conteudo_id = Number(req.params.id);
  try {
    const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id = $1", [req.user.id]);
    if (modeloRes.rowCount === 0) return res.status(404).json({ error: "Modelo não encontrado" });
    const modelo_id = modeloRes.rows[0].id;

    const result = await db.query(
      `UPDATE conteudos SET ativo=FALSE, deletado_em=NOW() WHERE id=$1 AND modelo_id=$2 RETURNING id`,
      [conteudo_id, modelo_id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: "Conteúdo não encontrado" });
    res.json({ success: true });
  } catch (err) {
    console.error("Erro desativar conteúdo:", err);
    res.status(500).json({ error: "Erro ao desativar conteúdo" });
  }
});

// GET /conteudos.html
router.get("/html", authModelo, (req, res) => {
  res.sendFile(path.join(__dirname, "../public", "conteudos.html"));
});

module.exports = router;
