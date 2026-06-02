const jwt = require("jsonwebtoken");

function authAgencia(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  
  if (!token) {
    return res.status(401).json({ erro: "Token não fornecido" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "agencia") {
      return res.status(403).json({ erro: "Acesso negado. Apenas agências podem acessar." });
    }

    req.agencia = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role
    };
    
    next();

  } catch (err) {
    console.error("Erro auth agência:", err.message);
    return res.status(401).json({ erro: "Token inválido ou expirado" });
  }
}

module.exports = authAgencia;