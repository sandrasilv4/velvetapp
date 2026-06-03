const express = require("express");
const router  = express.Router();
const bcrypt  = require("bcrypt");
const jwt     = require("jsonwebtoken");
const db      = require("../db");
const authAgencia = require("../middleware/authAgencia");

// POST /api/agencia/login
router.post("/login", async (req, res) => {
  try {
    const { email, senha } = req.body;
    const result = await db.query("SELECT * FROM agencias WHERE email = $1", [email]);
    if (!result.rowCount) return res.status(401).json({ erro: "Agência não encontrada" });

    const agencia = result.rows[0];
    const senhaValida = await bcrypt.compare(senha, agencia.senha);
    if (!senhaValida) return res.status(401).json({ erro: "Senha inválida" });

    const token = jwt.sign(
      { id: agencia.id, email: agencia.email, role: "agencia" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );
    res.json({ token, agencia: { id: agencia.id, nome: agencia.nome, email: agencia.email } });
  } catch (err) {
    console.error("Erro login agência:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// GET /api/agencia/me
router.get("/me", authAgencia, async (req, res) => {
  const result = await db.query("SELECT id, nome FROM agencias WHERE id = $1", [req.agencia.id]);
  if (!result.rowCount) return res.sendStatus(404);
  res.json(result.rows[0]);
});

// GET /api/agencia/modelos
router.get("/modelos", authAgencia, async (req, res) => {
  try {
    const result = await db.query(
      "SELECT id, nome FROM modelos WHERE agencia_id = $1 ORDER BY nome",
      [req.agencia.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar modelos" });
  }
});

// GET /api/agencia/modelo/:id
router.get("/modelo/:id", authAgencia, async (req, res) => {
  try {
    const modelo_id = Number(req.params.id);
    if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
      return res.status(400).json({ error: "Modelo inválida" });
    }
    const result = await db.query(`
      SELECT
        m.id, m.nome,
        COALESCE(SUM(CASE WHEN ta.data_sp=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date THEN ta.valor_modelo END),0) AS modelo_dia,
        COALESCE(SUM(CASE WHEN ta.data_sp=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date THEN ta.agency_fee END),0) AS agencia_dia,
        COALESCE(SUM(CASE WHEN ta.data_sp=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date THEN ta.velvet_fee END),0) AS velvet_dia,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('month',ta.data_sp)=DATE_TRUNC('month',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) THEN ta.valor_modelo END),0) AS modelo_mes,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('month',ta.data_sp)=DATE_TRUNC('month',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) THEN ta.agency_fee END),0) AS agencia_mes,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('month',ta.data_sp)=DATE_TRUNC('month',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) THEN ta.velvet_fee END),0) AS velvet_mes,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('year',ta.data_sp)=DATE_TRUNC('year',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) THEN ta.valor_modelo END),0) AS modelo_ano,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('year',ta.data_sp)=DATE_TRUNC('year',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) THEN ta.agency_fee END),0) AS agencia_ano,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('year',ta.data_sp)=DATE_TRUNC('year',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) THEN ta.velvet_fee END),0) AS velvet_ano
      FROM modelos m
      LEFT JOIN (
        SELECT modelo_id, valor_modelo, velvet_fee, agency_fee,
               (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS data_sp
        FROM transacoes_agency WHERE status='pago'
      ) ta ON ta.modelo_id=m.id
      WHERE m.agencia_id=$1 AND m.id=$2
      GROUP BY m.id, m.nome
    `, [req.agencia.id, modelo_id]);

    if (result.rowCount === 0) return res.status(404).json({ error: "Modelo não encontrada" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("ERRO /agencia/modelo/:id:", err);
    res.status(500).json({ error: "Erro ao buscar dados da modelo" });
  }
});

// GET /api/agencia/pagamentos
router.get("/pagamentos", authAgencia, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT p.id, p.referencia_mes, p.valor_midias, p.valor_assinaturas,
             p.valor_total, p.data_pagamento, m.nome AS modelo_nome
      FROM pagamentos_agencia p JOIN modelos m ON m.id=p.modelo_id
      WHERE p.agencia_id=$1 ORDER BY p.data_pagamento DESC
    `, [req.agencia.id]);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar pagamentos" });
  }
});

// GET /api/agencia/dashboard
router.get("/dashboard", authAgencia, async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN data_sp=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date AND tipo='midia' THEN agency_fee END),0) AS midias_hoje,
        COALESCE(SUM(CASE WHEN data_sp=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date AND tipo='assinatura' THEN agency_fee END),0) AS assinaturas_hoje,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('month',data_sp)=DATE_TRUNC('month',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AND tipo='midia' THEN agency_fee END),0) AS midias_mes,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('month',data_sp)=DATE_TRUNC('month',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) AND tipo='assinatura' THEN agency_fee END),0) AS assinaturas_mes,
        COALESCE(SUM(CASE WHEN data_sp=(NOW() AT TIME ZONE 'America/Sao_Paulo')::date THEN agency_fee END),0) AS total_hoje,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('month',data_sp)=DATE_TRUNC('month',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) THEN agency_fee END),0) AS total_mes,
        COALESCE(SUM(CASE WHEN DATE_TRUNC('year',data_sp)=DATE_TRUNC('year',(NOW() AT TIME ZONE 'America/Sao_Paulo')::date) THEN agency_fee END),0) AS total_ano
      FROM (
        SELECT ta.tipo, ta.agency_fee, (ta.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS data_sp
        FROM transacoes_agency ta
        INNER JOIN modelos m ON m.id=ta.modelo_id
        WHERE ta.status='pago' AND m.agencia_id=$1
      ) dados
    `, [req.agencia.id]);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro dashboard agência:", err);
    res.status(500).json({ error: "Erro ao carregar dashboard" });
  }
});

module.exports = router;
