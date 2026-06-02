// middleware/authCliente.js
const jwt = require("jsonwebtoken");
const db = require("../db");

module.exports = async function authCliente(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: "Token não fornecido" });
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "cliente") {
      return res.status(403).json({ error: "Apenas cliente" });
    }

    const result = await db.query(
      `SELECT c.id, u.ativo, u.bloqueado, u.token_version
       FROM clientes c
       JOIN users u ON u.id = c.user_id
       WHERE c.user_id = $1`,
      [decoded.id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const { id, ativo, bloqueado, token_version } = result.rows[0];

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
    req.cliente_id = id;

    next();

  } catch (err) {
    console.error("Erro authCliente:", err);
    return res.status(401).json({ error: "Token inválido" });
  }
};
