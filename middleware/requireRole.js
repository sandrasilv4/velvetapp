// middleware/requireRole.js
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Não autenticado" });
    }

    if (!rolesPermitidos.includes(req.user.role)) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    next();
  };
}

module.exports = requireRole;
