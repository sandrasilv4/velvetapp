const express = require("express");
const router = express.Router();
const path = require("path");
const db = require("../db");
const auth = require("../middleware/auth");
const authModelo = require("../middleware/authModelo");
const authCliente = require("../middleware/authCliente");
const { uploadB2, supabaseStorage } = require("../config/storage");
const { uploadAvatarLimiter } = require("../config/rateLimiters");

// GET /api/usuario/dados
router.get("/dados", auth, async (req, res) => {
  try {
    let result;
    if (req.user.role === "modelo") {
      const modeloRes = await db.query(
        `SELECT id FROM modelos WHERE user_id = $1 AND ativo = true`, [req.user.id]
      );
      if (!modeloRes.rows.length) return res.json({});
      result = await db.query(
        `SELECT md.*, (SELECT v.status FROM modelos_verificacao v WHERE v.modelo_id = md.modelo_id ORDER BY v.criado_em DESC LIMIT 1) AS status
         FROM modelos_dados md WHERE md.modelo_id = $1 AND md.ativo = true`,
        [modeloRes.rows[0].id]
      );
    } else if (req.user.role === "cliente") {
      const clienteRes = await db.query(
        `SELECT id FROM clientes WHERE user_id = $1 AND ativo = true`, [req.user.id]
      );
      if (!clienteRes.rows.length) return res.json({});
      result = await db.query(
        `SELECT * FROM clientes_dados WHERE cliente_id = $1 AND ativo = true`, [clienteRes.rows[0].id]
      );
    } else {
      return res.json({});
    }
    res.json(result.rows[0] || {});
  } catch (err) {
    console.error("ERRO GET /api/usuario/dados:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// PUT /api/usuario/dados
router.put("/dados", auth, async (req, res) => {
  try {
    const { nome_completo, data_nascimento, telefone, endereco, estado, cidade, pais } = req.body;
    const userId = req.user.id;

    if (req.user.role === "modelo") {
      const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id = $1", [userId]);
      if (!modeloRes.rowCount) return res.status(404).json({ erro: "Modelo não encontrado" });
      const modelo_id = modeloRes.rows[0].id;

      const verificacao = await db.query(
        `SELECT status FROM modelos_verificacao WHERE modelo_id = $1 ORDER BY criado_em DESC LIMIT 1`, [modelo_id]
      );
      if (verificacao.rowCount > 0 && verificacao.rows[0].status === "aprovado") {
        return res.status(403).json({ erro: "Dados pessoais já aprovados e não podem ser alterados" });
      }
      await db.query(
        `INSERT INTO modelos_dados (modelo_id, nome_completo, data_nascimento, telefone, endereco, estado, cidade, pais, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (modelo_id) DO UPDATE SET
           nome_completo = EXCLUDED.nome_completo, data_nascimento = EXCLUDED.data_nascimento,
           telefone = EXCLUDED.telefone, endereco = EXCLUDED.endereco,
           estado = EXCLUDED.estado, cidade = EXCLUDED.cidade,
           pais = EXCLUDED.pais, atualizado_em = NOW()`,
        [modelo_id, nome_completo?.trim() || null, data_nascimento || null, telefone?.trim() || null,
         endereco?.trim() || null, estado?.trim() || null, cidade?.trim() || null, pais?.trim() || null]
      );
      return res.json({ sucesso: true });
    }
    if (req.user.role === "cliente") {
      const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id = $1", [userId]);
      if (!clienteRes.rowCount) return res.status(404).json({ erro: "Cliente não encontrado" });
      const cliente_id = clienteRes.rows[0].id;

      const verificacao = await db.query(
        `SELECT status FROM clientes_verificacao WHERE cliente_id = $1 ORDER BY criado_em DESC LIMIT 1`, [cliente_id]
      );
      if (verificacao.rowCount > 0 && verificacao.rows[0].status === "aprovado") {
        return res.status(403).json({ erro: "Dados pessoais já aprovados e não podem ser alterados" });
      }
      await db.query(
        `INSERT INTO clientes_dados (cliente_id, nome_completo, data_nascimento, telefone, endereco, estado, cidade, pais, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (cliente_id) DO UPDATE SET
           nome_completo = EXCLUDED.nome_completo, data_nascimento = EXCLUDED.data_nascimento,
           telefone = EXCLUDED.telefone, endereco = EXCLUDED.endereco,
           estado = EXCLUDED.estado, cidade = EXCLUDED.cidade,
           pais = EXCLUDED.pais, atualizado_em = NOW()`,
        [cliente_id, nome_completo?.trim() || null, data_nascimento || null, telefone?.trim() || null,
         endereco?.trim() || null, estado?.trim() || null, cidade?.trim() || null, pais?.trim() || null]
      );
      return res.json({ sucesso: true });
    }
    return res.status(403).json({ erro: "Role inválida" });
  } catch (err) {
    console.error("ERRO PUT /api/usuario/dados:", err);
    res.status(500).json({ erro: err.message });
  }
});

// GET /api/usuario/perfil
router.get("/perfil", auth, async (req, res) => {
  try {
    let result;
    if (req.user.role === "modelo") {
      const modeloRes = await db.query(`SELECT id FROM modelos WHERE user_id = $1 AND ativo = true`, [req.user.id]);
      if (!modeloRes.rows.length) return res.json({});
      result = await db.query(
        `SELECT m.nome_exibicao, m.local, m.bio, md.instagram, md.tiktok
         FROM modelos m LEFT JOIN modelos_dados md ON md.modelo_id = m.id AND md.ativo = true
         WHERE m.id = $1 AND m.ativo = true`,
        [modeloRes.rows[0].id]
      );
    } else if (req.user.role === "cliente") {
      const clienteRes = await db.query(`SELECT id FROM clientes WHERE user_id = $1 AND ativo = true`, [req.user.id]);
      if (!clienteRes.rows.length) return res.json({});
      result = await db.query(
        `SELECT cd.username, cd.instagram, cd.tiktok, cd.local, cd.bio
         FROM clientes_dados cd WHERE cd.cliente_id = $1 AND cd.ativo = true`,
        [clienteRes.rows[0].id]
      );
    }
    if (!result) return res.status(403).json({});
    const perfil = result.rows[0] || {};
    res.json({
      nome_exibicao: perfil.nome_exibicao || "",
      instagram: perfil.instagram || "",
      tiktok: perfil.tiktok || "",
      local: perfil.local || "",
      bio: perfil.bio || ""
    });
  } catch (err) {
    console.error("ERRO GET /api/usuario/perfil:", err);
    res.status(500).json({ erro: "Erro ao buscar perfil" });
  }
});

// PUT /api/usuario/perfil
router.put("/perfil", auth, async (req, res) => {
  try {
    const { nome_exibicao, instagram, tiktok, local, bio } = req.body;

    if (req.user.role === "cliente") {
      const clienteRes = await db.query(`SELECT id FROM clientes WHERE user_id = $1`, [req.user.id]);
      if (!clienteRes.rows.length) return res.status(404).json({ erro: "Cliente não encontrado" });
      await db.query(
        `INSERT INTO clientes_dados (cliente_id, username, instagram, tiktok, local, bio, atualizado_em)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (cliente_id) DO UPDATE SET
           username = EXCLUDED.username, instagram = EXCLUDED.instagram,
           tiktok = EXCLUDED.tiktok, local = EXCLUDED.local,
           bio = EXCLUDED.bio, atualizado_em = NOW()`,
        [clienteRes.rows[0].id, nome_exibicao, instagram || null, tiktok || null, local || null, bio || null]
      );
      return res.json({ ok: true });
    }
    if (req.user.role === "modelo") {
      const modeloRes = await db.query(`SELECT id FROM modelos WHERE user_id = $1`, [req.user.id]);
      if (!modeloRes.rows.length) return res.status(404).json({ erro: "Modelo não encontrado" });
      const modeloId = modeloRes.rows[0].id;
      await db.query(
        `UPDATE modelos SET nome_exibicao = COALESCE($1, nome_exibicao), local = COALESCE($2, local), bio = COALESCE($3, bio), atualizado_em = NOW() WHERE id = $4`,
        [nome_exibicao ?? null, local ?? null, bio ?? null, modeloId]
      );
      const existeDados = await db.query(`SELECT id FROM modelos_dados WHERE modelo_id = $1`, [modeloId]);
      if (existeDados.rows.length > 0) {
        await db.query(
          `UPDATE modelos_dados SET instagram = COALESCE($1, instagram), tiktok = COALESCE($2, tiktok), atualizado_em = NOW() WHERE modelo_id = $3`,
          [instagram ?? null, tiktok ?? null, modeloId]
        );
      } else {
        await db.query(
          `INSERT INTO modelos_dados (modelo_id, instagram, tiktok) VALUES ($1, $2, $3)`,
          [modeloId, instagram ?? null, tiktok ?? null]
        );
      }
      return res.json({ ok: true });
    }
    return res.status(403).json({ erro: "Tipo de usuário inválido" });
  } catch (err) {
    console.error("ERRO PUT /api/usuario/perfil:", err);
    res.status(500).json({ erro: "Erro ao salvar perfil" });
  }
});

// POST /uploadAvatar
router.post("/uploadAvatar", auth, uploadAvatarLimiter, uploadB2.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    const userId = req.user.id;
    const { mimetype, originalname, buffer } = req.file;
    const ext = originalname.split(".").pop();
    const caminho = `${userId}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabaseStorage.storage
      .from("avatars").upload(caminho, buffer, { contentType: mimetype, upsert: true });
    if (uploadErr) throw uploadErr;
    const { data: { publicUrl: avatarUrl } } = supabaseStorage.storage.from("avatars").getPublicUrl(caminho);

    if (req.user.role === "modelo") {
      const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id = $1", [userId]);
      if (!modeloRes.rowCount) return res.status(404).json({ error: "Modelo não encontrado" });
      await db.query("UPDATE modelos SET avatar = $1 WHERE id = $2", [avatarUrl, modeloRes.rows[0].id]);
    } else if (req.user.role === "cliente") {
      const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id = $1", [userId]);
      if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
      await db.query(`UPDATE clientes_dados SET avatar = $1, atualizado_em = NOW() WHERE cliente_id = $2`, [avatarUrl, clienteRes.rows[0].id]);
    } else {
      return res.status(403).json({ error: "Role inválida" });
    }
    res.json({ avatar: avatarUrl });
  } catch (err) {
    console.error("Erro upload avatar:", err);
    res.status(500).json({ error: "Erro ao atualizar avatar" });
  }
});

// POST /uploadCapa
router.post("/uploadCapa", auth, uploadAvatarLimiter, uploadB2.single("capa"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    const userId = req.user.id;
    const { mimetype, originalname, buffer } = req.file;
    const ext = originalname.split(".").pop();
    const caminho = `${userId}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabaseStorage.storage
      .from("capas").upload(caminho, buffer, { contentType: mimetype, upsert: true });
    if (uploadErr) throw uploadErr;
    const { data: { publicUrl: url } } = supabaseStorage.storage.from("capas").getPublicUrl(caminho);

    if (req.user.role === "modelo") {
      await db.query("UPDATE modelos SET capa = $1 WHERE user_id = $2", [url, userId]);
    } else if (req.user.role === "cliente") {
      const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id = $1", [userId]);
      if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
      await db.query(`UPDATE clientes_dados SET capa = $1, atualizado_em = NOW() WHERE cliente_id = $2`, [url, clienteRes.rows[0].id]);
    } else {
      return res.status(403).json({ error: "Role inválida" });
    }
    res.json({ capa: url });
  } catch (err) {
    console.error("Erro upload capa:", err);
    res.status(500).json({ error: "Erro ao atualizar capa" });
  }
});

module.exports = router;
