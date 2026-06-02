const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas tentativas. Tente novamente em alguns minutos." }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitos uploads. Aguarde alguns minutos e tente novamente." }
});

const uploadAvatarLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas atualizações de perfil. Tente novamente em alguns minutos." }
});

const uploadVerificacaoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite de envio de documentos atingido. Tente novamente em 1 hora." }
});

const contratoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Limite de geração de contrato atingido. Tente novamente em 1 hora." }
});

module.exports = {
  authLimiter,
  uploadLimiter,
  uploadAvatarLimiter,
  uploadVerificacaoLimiter,
  contratoLimiter
};
