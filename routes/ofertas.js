const express = require("express");
const router = express.Router();
const db = require("../db");
const authModelo = require("../middleware/authModelo");

router.get("/", authModelo, async (req, res) => {
  try {
    await db.query("SELECT encerrar_ofertas_expiradas()");
    const result = await db.query(
      `SELECT * FROM ofertas WHERE modelo_id = $1 ORDER BY created_at DESC LIMIT 5`,
      [req.modelo_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erro buscar ofertas:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/ativa/:modelo_id", async (req, res) => {
  try {
    const modelo_id = Number(req.params.modelo_id);
    if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
      return res.status(400).json({ ativa: false });
    }
    const ofertaRes = await db.query(
      `SELECT id, modelo_id, nome, desconto_percentual, valor_base, valor_promocional, data_fim
       FROM ofertas
       WHERE modelo_id = $1 AND ativa = true AND data_fim > NOW()
       LIMIT 1`,
      [modelo_id]
    );
    if (ofertaRes.rowCount) {
      return res.json({ ativa: true, oferta: ofertaRes.rows[0] });
    }
    const precoRes = await db.query(`
      SELECT COALESCE(NULLIF(mp.valor_mensal, 0), NULLIF(md.vip_preco, 0), 20.00) AS valor_base
      FROM modelos m
      LEFT JOIN modelos_planos mp ON mp.modelo_id = m.id
      LEFT JOIN modelos_dados md ON md.modelo_id = m.id
      WHERE m.id = $1 LIMIT 1
    `, [modelo_id]);
    const valorBase = precoRes.rowCount ? Number(precoRes.rows[0].valor_base) : 20.00;
    return res.json({ ativa: false, valor_base: valorBase });
  } catch (err) {
    console.error("Erro buscar oferta ativa:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.post("/", authModelo, async (req, res) => {
  try {
    const userId = req.user.id;
    const modeloRes = await db.query(`SELECT id FROM modelos WHERE user_id = $1`, [userId]);
    if (modeloRes.rowCount === 0) return res.status(404).json({ erro: "Modelo não encontrado" });
    const modeloId = modeloRes.rows[0].id;

    const planoRes = await db.query(
      `SELECT valor_mensal FROM modelos_planos WHERE modelo_id = $1`, [modeloId]
    );
    if (planoRes.rowCount === 0) {
      return res.status(400).json({ erro: "Defina primeiro o plano de assinatura." });
    }
    const VALOR_BASE = Number(planoRes.rows[0].valor_mensal);
    const VALOR_MINIMO = Number((VALOR_BASE * 0.5).toFixed(2));
    const { nome, limite, dias, desconto } = req.body;
    const limiteNum = Number(limite);
    const diasNum = Number(dias);
    const descontoNum = Number(desconto);

    if (
      !nome || !Number.isFinite(limiteNum) || limiteNum <= 0 ||
      !Number.isFinite(diasNum) || diasNum <= 0 ||
      !Number.isFinite(descontoNum) || descontoNum < 0 || descontoNum > 50
    ) {
      return res.status(400).json({ erro: "Dados inválidos" });
    }

    let valorPromocional = Number((VALOR_BASE * (1 - descontoNum / 100)).toFixed(2));
    if (valorPromocional < VALOR_MINIMO) valorPromocional = VALOR_MINIMO;

    const dataFim = new Date();
    dataFim.setDate(dataFim.getDate() + diasNum);
    await db.query(`UPDATE ofertas SET ativa = false WHERE modelo_id = $1`, [modeloId]);

    const result = await db.query(
      `INSERT INTO ofertas (modelo_id, nome, limite_assinaturas, assinaturas_usadas, desconto_percentual, valor_base, valor_promocional, data_inicio, data_fim, ativa)
       VALUES ($1,$2,$3,0,$4,$5,$6,NOW(),$7,true) RETURNING *`,
      [modeloId, nome, limiteNum, descontoNum, VALOR_BASE, valorPromocional, dataFim]
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro ao criar oferta:", err);
    res.status(500).json({ erro: "Erro interno ao criar oferta" });
  }
});

router.put("/:id/encerrar", authModelo, async (req, res) => {
  try {
    const ofertaId = Number(req.params.id);
    if (!Number.isInteger(ofertaId) || ofertaId <= 0) {
      return res.status(400).json({ erro: "ID inválido" });
    }
    const result = await db.query(
      `UPDATE ofertas SET ativa = false, data_fim = NOW()
       WHERE id = $1 AND modelo_id = $2 AND ativa = true RETURNING *`,
      [ofertaId, req.modelo_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ erro: "Oferta não encontrada ou já encerrada" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Erro encerrar oferta:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.patch("/:id/encerrar", authModelo, async (req, res) => {
  try {
    const ofertaId = Number(req.params.id);
    const userId = req.user.id;
    if (!Number.isInteger(ofertaId) || ofertaId <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }
    const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id = $1", [userId]);
    if (modeloRes.rowCount === 0) return res.status(404).json({ error: "Modelo não encontrado" });
    const modelo_id = modeloRes.rows[0].id;

    const result = await db.query(
      `UPDATE ofertas SET ativa = false, atualizado_em = NOW()
       WHERE id = $1 AND modelo_id = $2 RETURNING *`,
      [ofertaId, modelo_id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Oferta não encontrada" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro encerrar oferta:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
