const express = require("express");
const router = express.Router();

const bcrypt = require("bcrypt"); // ou bcryptjs
const jwt = require("jsonwebtoken");
const db = require("../db");
const auth = require("../middleware/auth"); // ✅ ESSA LINHA

router.get("/me", auth, (req, res) => {
  res.json({
    id: req.user.id,
    role: req.user.role
  });
});


router.post("/login", async (req, res) => {
  const { email, senha } = req.body;

  if (!email || !senha) {
    return res.status(400).json({ error: "Email e senha obrigatórios" });
  }

  try {
    const result = await db.query(
      "SELECT id, senha_hash, role FROM users WHERE email = $1",
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const user = result.rows[0];

    const senhaOk = await bcrypt.compare(senha, user.senha_hash);
    if (!senhaOk) {
      return res.status(401).json({ error: "Credenciais inválidas" });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      role: user.role
    });

  } catch (err) {
    console.error("Erro login:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

module.exports = router;
