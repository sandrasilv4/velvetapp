// Mapas de presença online (socket.io)
const onlineModelos = new Map();
const onlineClientes = new Map();

// OTP pré-registro em memória (TTL 15 min)
const otpPreRegistro = new Map();

setInterval(() => {
  const agora = Date.now();
  for (const [email, entry] of otpPreRegistro.entries()) {
    if (agora > entry.expiresAt) otpPreRegistro.delete(email);
  }
}, 10 * 60 * 1000);

module.exports = { onlineModelos, onlineClientes, otpPreRegistro };
