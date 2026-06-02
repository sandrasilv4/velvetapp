// middleware/authModelo.js
const jwt = require("jsonwebtoken");
const db = require("../db");

module.exports = async function authModelo(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "modelo") {
      return res.status(403).json({ error: "Apenas modelo" });
    }

    const result = await db.query(
      `SELECT m.id, m.termos_aceites, m.termos_versao,
              u.ativo, u.bloqueado, u.token_version
       FROM modelos m
       JOIN users u ON u.id = m.user_id
       WHERE m.user_id = $1`,
      [decoded.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Modelo não encontrado" });
    }

    const { id, ativo, bloqueado, token_version, termos_aceites, termos_versao } = result.rows[0];

    if (!ativo) {
      return res.status(403).json({ error: "Conta desativada" });
    }

    if (bloqueado) {
      return res.status(403).json({ error: "Conta bloqueada" });
    }

    if (decoded.tv !== token_version) {
      return res.status(401).json({ error: "Sessão expirada. Faça login novamente." });
    }

    req.user = decoded;
    req.modelo_id = id;
    req.termos_aceites = termos_aceites;

    next();

  } catch (err) {
    console.error("Erro authModelo:", err);
    return res.status(401).json({ error: "Token inválido" });
  }
};
