const express = require("express");
const router  = express.Router();
const bcrypt  = require("bcrypt");
const jwt     = require("jsonwebtoken");
const db      = require("../db");
const auth    = require("../middleware/auth");
const authAdmin = require("../middleware/authAdmin");

// POST /api/admin/login
router.post("/login", async (req, res) => {
  const { email, senha } = req.body;
  try {
    const admin = await db.query("SELECT * FROM admin WHERE email=$1", [email]);
    if (!admin.rowCount) return res.status(400).json({ error: "Admin não encontrado" });
    const adminData = admin.rows[0];
    const senhaValida = await bcrypt.compare(senha, adminData.senha);
    if (!senhaValida) return res.status(400).json({ error: "Senha inválida" });
    const token = jwt.sign({ id: adminData.id, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "12h" });
    res.json({ token });
  } catch (err) {
    console.error("Erro login admin:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// GET /api/admin/modelo/:id/historico-bancario
router.get("/modelo/:id/historico-bancario", auth, authAdmin, async (req, res) => {
  const { id } = req.params;
  const page   = Number(req.query.page) || 1;
  const limit  = 10;
  const offset = (page - 1) * limit;
  try {
    const totalRes = await db.query(`SELECT COUNT(*) FROM modelo_dados_bancarios WHERE modelo_id=$1`, [id]);
    const total      = Number(totalRes.rows[0].count);
    const totalPages = Math.ceil(total / limit);
    const result = await db.query(
      `SELECT titular_nome, banco, agencia, conta, pix_chave, status, criado_em FROM modelo_dados_bancarios WHERE modelo_id=$1 ORDER BY criado_em DESC LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );
    res.json({ dados: result.rows, page, totalPages });
  } catch (err) {
    console.error("Erro histórico bancário:", err);
    res.status(500).json({ error: "Erro ao buscar histórico" });
  }
});

// GET /api/admin/agencias
router.get("/agencias", auth, authAdmin, async (req, res) => {
  try {
    const result = await db.query(`SELECT id, nome FROM agencias ORDER BY nome ASC`);
    res.json(result.rows);
  } catch (err) {
    console.error("Erro buscar agências:", err);
    res.status(500).json({ error: "Erro ao buscar agências" });
  }
});

module.exports = router;
