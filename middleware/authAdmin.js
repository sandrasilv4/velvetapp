const db = require("../db");

async function authAdmin(req, res, next) {

  if (!req.user) {
    return res.status(401).json({ error: "Não autenticado" });
  }

  try {

    const admin = await db.query(
      "SELECT id FROM admin WHERE id = $1 LIMIT 1",
      [req.user.id]
    );

    if (!admin.rowCount) {
      return res.status(403).json({ error: "Acesso restrito ao administrador" });
    }

    next();

  } catch (err) {
    console.error("Erro authAdmin:", err);
    return res.status(500).json({ error: "Erro interno de autenticação" });
  }
}

module.exports = authAdmin;