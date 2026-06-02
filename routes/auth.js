const express = require("express");
const router = express.Router();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const db = require("../db");
const { resend } = require("../config/services");
const { authLimiter } = require("../config/rateLimiters");
const { otpPreRegistro } = require("../state");
const { emailValido } = require("../utils/validators");
const auth = require("../middleware/auth");
const {
  enviarEmailBoasVindasCliente,
  enviarEmailBoasVindasModelo,
  enviarEmailOTP
} = require("../email");

// GET /api/me
router.get("/me", auth, async (req, res) => {
  try {
    if (req.user.role === "modelo") {
      const result = await db.query(
        `SELECT m.id AS modelo_id, m.nome_exibicao, m.avatar, m.capa, m.bio, m.local
         FROM modelos m WHERE m.user_id = $1 AND m.ativo = true`,
        [req.user.id]
      );
      if (!result.rows.length) return res.json({ role: "modelo" });
      return res.json({
        user_id: req.user.id,
        modelo_id: result.rows[0].modelo_id,
        role: "modelo",
        avatar: result.rows[0].avatar,
        capa: result.rows[0].capa,
        bio: result.rows[0].bio || "",
        nome: result.rows[0].nome_exibicao || "Modelo",
        local: result.rows[0].local || ""
      });
    }
    if (req.user.role === "cliente") {
      const clienteRes = await db.query(
        `SELECT id FROM clientes WHERE user_id = $1 AND ativo = true LIMIT 1`,
        [req.user.id]
      );
      if (!clienteRes.rows.length) return res.status(403).json({ error: "Conta desativada" });
    }
    return res.json({ user_id: req.user.id, role: req.user.role });
  } catch (err) {
    console.error("Erro /api/me:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// POST /api/pre-registro/enviar-codigo
router.post("/pre-registro/enviar-codigo", authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const emailNormalizado = email?.trim().toLowerCase();
    if (!emailNormalizado || !emailValido(emailNormalizado)) {
      return res.status(400).json({ erro: "Email inválido" });
    }
    const check = await db.query(
      "SELECT id FROM users WHERE email = $1 AND ativo IS DISTINCT FROM false",
      [emailNormalizado]
    );
    if (check.rowCount > 0) {
      return res.status(409).json({ erro: "Este email já tem uma conta registada. Faz login." });
    }
    const existing = otpPreRegistro.get(emailNormalizado);
    if (existing && existing.enviadoEm && (Date.now() - existing.enviadoEm) < 60_000) {
      return res.status(429).json({ erro: "Aguarda 1 minuto antes de solicitar um novo código." });
    }
    const codigo = Math.floor(100_000 + Math.random() * 900_000).toString();
    otpPreRegistro.set(emailNormalizado, {
      codigo,
      expiresAt:  Date.now() + 15 * 60 * 1_000,
      enviadoEm:  Date.now(),
      tentativas: 0,
      verificado: false,
      preToken:   null
    });
    await enviarEmailOTP(emailNormalizado, codigo);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao enviar OTP:", err);
    return res.status(500).json({ erro: "Erro ao enviar email de verificação." });
  }
});

// POST /api/pre-registro/verificar-codigo
router.post("/pre-registro/verificar-codigo", authLimiter, async (req, res) => {
  try {
    const { email, codigo } = req.body;
    const emailNormalizado = email?.trim().toLowerCase();
    if (!emailNormalizado || !codigo) {
      return res.status(400).json({ erro: "Email e código são obrigatórios." });
    }
    const entry = otpPreRegistro.get(emailNormalizado);
    if (!entry) return res.status(400).json({ erro: "Nenhum código foi enviado para este email." });
    if (Date.now() > entry.expiresAt) {
      otpPreRegistro.delete(emailNormalizado);
      return res.status(400).json({ erro: "Código expirado. Solicita um novo." });
    }
    if (entry.tentativas >= 5) {
      otpPreRegistro.delete(emailNormalizado);
      return res.status(400).json({ erro: "Muitas tentativas incorretas. Solicita um novo código." });
    }
    if (entry.codigo !== codigo.trim()) {
      entry.tentativas++;
      const restantes = 5 - entry.tentativas;
      return res.status(400).json({
        erro: restantes > 0
          ? `Código incorreto. ${restantes} tentativa${restantes > 1 ? "s" : ""} restante${restantes > 1 ? "s" : ""}.`
          : "Código incorreto."
      });
    }
    const preToken = crypto.randomBytes(24).toString("hex");
    entry.verificado = true;
    entry.preToken   = preToken;
    entry.expiresAt  = Date.now() + 30 * 60 * 1_000;
    return res.json({ ok: true, preToken });
  } catch (err) {
    console.error("Erro ao verificar OTP:", err);
    return res.status(500).json({ erro: "Erro interno." });
  }
});

// POST /api/register
router.post("/register", authLimiter, async (req, res) => {
  try {
    const { email, senha, role, nome_completo, data_nascimento, ageConfirmed, preToken, ref, src } = req.body;
    const emailNormalizado = email?.trim().toLowerCase();

    if (!emailNormalizado || !senha || !role || !nome_completo || !data_nascimento) {
      return res.status(400).json({ erro: "Todos os campos obrigatórios devem ser preenchidos" });
    }
    if (!emailValido(emailNormalizado)) return res.status(400).json({ erro: "Email inválido" });
    if (!preToken) return res.status(400).json({ erro: "Verificação de email obrigatória." });

    const otpEntry = otpPreRegistro.get(emailNormalizado);
    if (!otpEntry || !otpEntry.verificado || otpEntry.preToken !== preToken || Date.now() > otpEntry.expiresAt) {
      return res.status(400).json({ erro: "Sessão de verificação expirada ou inválida." });
    }
    if (!["modelo", "cliente"].includes(role)) return res.status(400).json({ erro: "Tipo de conta inválido" });
    if (ageConfirmed !== true) return res.status(400).json({ erro: "Confirmação de idade obrigatória (+18)" });

    const nascimento = new Date(data_nascimento);
    const hoje = new Date();
    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const mesDiff = hoje.getMonth() - nascimento.getMonth();
    if (mesDiff < 0 || (mesDiff === 0 && hoje.getDate() < nascimento.getDate())) idade--;
    if (idade < 18) return res.status(400).json({ erro: "É necessário ter 18 anos ou mais" });

    const emailCheck = await db.query(
      `SELECT id, ativo, motivo_desativacao, autoexcluida_em FROM users WHERE email = $1`,
      [emailNormalizado]
    );
    if (emailCheck.rowCount > 0) {
      const existing = emailCheck.rows[0];
      if (existing.ativo !== false) return res.status(409).json({ erro: "Email já registrado" });
      if (existing.motivo_desativacao !== "autoexclusao" || !existing.autoexcluida_em) {
        return res.status(409).json({ erro: "Email já registrado" });
      }
      const diasDesdeExclusao = Math.floor(
        (Date.now() - new Date(existing.autoexcluida_em).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diasDesdeExclusao < 30) {
        const diasRestantes = 30 - diasDesdeExclusao;
        return res.status(409).json({
          erro: `Conta excluída recentemente. Nova conta disponível em ${diasRestantes} dia${diasRestantes > 1 ? "s" : ""}.`
        });
      }
      await db.query(`UPDATE users SET email = $1 WHERE id = $2`, [`deleted_${existing.id}@velvet.lat`, existing.id]);
    }

    const hash = await bcrypt.hash(senha, 10);
    const userResult = await db.query(
      `INSERT INTO public.users (email, password_hash, role, age_confirmed, age_confirmed_at, email_verificado)
       VALUES ($1, $2, $3, true, NOW(), TRUE) RETURNING id, token_version`,
      [emailNormalizado, hash, role]
    );
    const userId = userResult.rows[0].id;
    const tokenVersion = userResult.rows[0].token_version;
    const nomePublico = nome_completo.split(" ")[0];
    let modeloId = null;
    let clienteId = null;

    if (role === "modelo") {
      const modeloResult = await db.query(
        `INSERT INTO public.modelos (user_id, nome, verificada, email_enviado_em, prazo_validacao)
         VALUES ($1, $2, 'false', NOW(), NOW() + INTERVAL '14 days') RETURNING id`,
        [userId, nomePublico]
      );
      modeloId = modeloResult.rows[0].id;
      await db.query(
        `INSERT INTO public.modelos_dados (modelo_id, nome_completo, data_nascimento, criado_em, atualizado_em)
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [modeloId, nome_completo, data_nascimento]
      );
      await enviarEmailBoasVindasModelo(emailNormalizado, nome_completo);
    }
    if (role === "cliente") {
      const clienteResult = await db.query(
        `INSERT INTO public.clientes (user_id, nome, origem_trafego, ref_modelo) VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, nomePublico, src || null, ref ? Number(ref) : null]
      );
      clienteId = clienteResult.rows[0].id;
      await db.query(
        `INSERT INTO public.clientes_dados (cliente_id, username, nome_completo, data_nascimento, criado_em, atualizado_em)
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [clienteId, nomePublico, nome_completo, data_nascimento]
      );
      await enviarEmailBoasVindasCliente(emailNormalizado, nome_completo);
    }

    otpPreRegistro.delete(emailNormalizado);

    const token = jwt.sign(
      { id: userId, email: emailNormalizado, role, tv: tokenVersion },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );
    return res.status(201).json({ token, role, modelo_id: modeloId, cliente_id: clienteId });
  } catch (err) {
    console.error("ERRO REGISTER:", err);
    if (err.code === "23505") return res.status(409).json({ erro: "Email já registrado" });
    return res.status(500).json({ erro: "Erro interno no servidor" });
  }
});

// POST /api/login
router.post("/login", authLimiter, async (req, res) => {
  try {
    let { email, senha } = req.body;
    email = email?.trim().toLowerCase();
    senha = senha?.trim();
    if (!email || !senha) return res.status(400).json({ error: "Dados incompletos" });

    const result = await db.query(
      `SELECT id, email, password_hash, role, ativo, token_version FROM public.users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
      [email]
    );
    if (result.rowCount === 0) return res.status(401).json({ error: "Usuário não encontrado" });

    const user = result.rows[0];
    if (user.ativo === false) return res.status(403).json({ error: "Conta desativada" });

    const senhaOk = await bcrypt.compare(senha, user.password_hash);
    if (!senhaOk) return res.status(401).json({ error: "Senha incorreta" });

    const role = String(user.role || "").toLowerCase();

    if (role === "modelo") {
      const modeloRes = await db.query(
        `SELECT id, ativo FROM modelos WHERE user_id = $1 LIMIT 1`, [user.id]
      );
      if (modeloRes.rowCount === 0) return res.status(400).json({ error: "Modelo não encontrado" });
      if (modeloRes.rows[0].ativo === false) return res.status(403).json({ error: "Conta desativada" });
      const token = jwt.sign(
        { id: user.id, email: user.email, role, tv: user.token_version },
        process.env.JWT_SECRET, { expiresIn: "30d" }
      );
      return res.json({ token, role, modelo_id: modeloRes.rows[0].id });
    }
    if (role === "cliente") {
      const clienteRes = await db.query(
        `SELECT id, ativo FROM clientes WHERE user_id = $1 LIMIT 1`, [user.id]
      );
      if (clienteRes.rowCount === 0) return res.status(400).json({ error: "Cliente não encontrado" });
      if (clienteRes.rows[0].ativo === false) return res.status(403).json({ error: "Conta desativada" });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role, tv: user.token_version },
      process.env.JWT_SECRET, { expiresIn: "30d" }
    );
    return res.json({ token, role });
  } catch (err) {
    console.error("ERRO LOGIN:", err);
    return res.status(500).json({ error: "Erro interno no login" });
  }
});

// POST /api/logout
router.post("/logout", auth, async (req, res) => {
  try {
    await db.query(`UPDATE users SET token_version = token_version + 1 WHERE id = $1`, [req.user.id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro logout:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// POST /api/password/forgot
router.post("/password/forgot", async (req, res) => {
  const client = await db.connect();
  try {
    let { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email obrigatório" });
    email = email.trim().toLowerCase();
    await client.query("BEGIN");

    const userRes = await client.query(
      `SELECT id FROM users WHERE email = $1 AND ativo = true LIMIT 1`, [email]
    );
    if (userRes.rowCount === 0) { await client.query("COMMIT"); return res.json({ ok: true }); }

    const userId = userRes.rows[0].id;
    await client.query(`DELETE FROM password_resets WHERE user_id = $1`, [userId]);
    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000);
    await client.query(
      `INSERT INTO password_resets (user_id, codigo, expires_at, criado_em) VALUES ($1, $2, $3, NOW())`,
      [userId, codigo, expires]
    );
    await client.query("COMMIT");

    await resend.emails.send({
      from: "Velvet <contato@velvet.lat>",
      to: [email],
      subject: "Recuperação de senha – Velvet",
      html: `<div style="font-family:Arial,sans-serif;background:#f6f3fb;padding:24px;"><div style="max-width:600px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;"><h2 style="color:#6f42c1;text-align:center;">Recuperação de senha 🔐</h2><p>Olá,</p><p>Use o código abaixo para redefinir sua senha:</p><div style="background:#f8f4ff;padding:24px;border-radius:10px;text-align:center;margin:20px 0;"><p style="font-size:36px;font-weight:bold;color:#6f42c1;letter-spacing:8px;">${codigo}</p></div><p style="font-size:13px;color:#7a1f52;">⏳ Expira em 15 minutos.</p><p style="text-align:center;color:#6b5a7d;">Equipe Velvet 💜</p></div></div>`
    });
    return res.json({ ok: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ERRO PASSWORD FORGOT:", error);
    return res.status(500).json({ error: "Erro ao enviar código" });
  } finally {
    client.release();
  }
});

// POST /api/password/reset
router.post("/password/reset", async (req, res) => {
  const client = await db.connect();
  try {
    let { email, codigo, novaSenha } = req.body;
    if (!email || !codigo || !novaSenha) return res.status(400).json({ error: "Dados incompletos" });
    if (novaSenha.length < 6) return res.status(400).json({ error: "Senha muito curta" });
    email = email.trim().toLowerCase();
    await client.query("BEGIN");

    const userRes = await client.query(
      `SELECT id FROM users WHERE email = $1 AND ativo = true LIMIT 1`, [email]
    );
    if (userRes.rowCount === 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Código inválido" }); }

    const userId = userRes.rows[0].id;
    const resetRes = await client.query(
      `SELECT id FROM password_resets WHERE user_id = $1 AND codigo = $2 AND usado = false AND expires_at > NOW() ORDER BY criado_em DESC LIMIT 1`,
      [userId, codigo]
    );
    if (resetRes.rowCount === 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Código inválido ou expirado" }); }

    const senhaHash = await bcrypt.hash(novaSenha, 10);
    await client.query(`UPDATE users SET password_hash = $1 WHERE id = $2 AND ativo = true`, [senhaHash, userId]);
    await client.query(`UPDATE password_resets SET usado = true WHERE id = $1`, [resetRes.rows[0].id]);
    await client.query("COMMIT");
    return res.json({ success: true });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("ERRO PASSWORD RESET:", error);
    return res.status(500).json({ error: "Erro ao redefinir senha" });
  } finally {
    client.release();
  }
});

// DELETE /api/conta/excluir
router.delete("/conta/excluir", auth, async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  const senhaInformada = req.body.senha;

  if (!senhaInformada) return res.status(400).json({ error: "Senha obrigatória" });

  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
  const userAgent = req.headers["user-agent"] || null;
  const client = await db.connect();

  try {
    const userRes = await client.query(`SELECT id, password_hash, ativo FROM users WHERE id = $1`, [userId]);
    if (userRes.rowCount === 0) return res.status(404).json({ error: "Usuário não encontrado" });

    const usuario = userRes.rows[0];
    if (usuario.ativo === false) return res.status(400).json({ error: "Conta já desativada" });

    const senhaOk = await bcrypt.compare(senhaInformada, usuario.password_hash);
    if (!senhaOk) return res.status(401).json({ error: "Senha inválida" });

    await client.query("BEGIN");
    let modelo_id = null;
    let cliente_id = null;
    let agencia_id = null;

    if (role === "modelo") {
      const modeloRes = await client.query(`SELECT id FROM modelos WHERE user_id = $1`, [userId]);
      if (modeloRes.rowCount > 0) {
        modelo_id = modeloRes.rows[0].id;
        await client.query(`UPDATE messages SET deletada = true WHERE modelo_id = $1`, [modelo_id]);
        await client.query(`UPDATE vip_subscriptions SET ativo = false, updated_at = NOW() WHERE modelo_id = $1 AND ativo = true`, [modelo_id]);
        await client.query(`UPDATE conteudos SET ativo = false, desativado_em = NOW() WHERE modelo_id = $1`, [modelo_id]);
        await client.query(`UPDATE modelos_dados SET ativo = false, desativado_em = NOW() WHERE modelo_id = $1`, [modelo_id]);
        await client.query(`UPDATE modelos SET ativo = false, desativado_em = NOW() WHERE id = $1`, [modelo_id]);
      }
    }
    if (role === "cliente") {
      const clienteRes = await client.query(`SELECT id FROM clientes WHERE user_id = $1`, [userId]);
      if (clienteRes.rowCount > 0) {
        cliente_id = clienteRes.rows[0].id;
        await client.query(`UPDATE messages SET deletada = true WHERE cliente_id = $1`, [cliente_id]);
        await client.query(`UPDATE vip_subscriptions SET ativo = false, updated_at = NOW() WHERE cliente_id = $1 AND ativo = true`, [cliente_id]);
        await client.query(`UPDATE clientes_dados SET ativo = false, desativado_em = NOW() WHERE cliente_id = $1`, [cliente_id]);
        await client.query(`UPDATE clientes SET ativo = false, desativado_em = NOW() WHERE id = $1`, [cliente_id]);
      }
    }
    if (role === "agencia") {
      const agenciaRes = await client.query(`SELECT id FROM agencias WHERE user_id = $1`, [userId]);
      if (agenciaRes.rowCount > 0) {
        agencia_id = agenciaRes.rows[0].id;
        await client.query(`UPDATE agencias SET ativo = false, desativado_em = NOW() WHERE id = $1`, [agencia_id]);
      }
    }

    await client.query(
      `UPDATE users SET ativo = false, desativado_em = NOW(), autoexcluida_em = NOW(), motivo_desativacao = $2, desativado_por = $3 WHERE id = $1`,
      [userId, "autoexclusao", "proprio_usuario"]
    );
    await client.query(
      `INSERT INTO conta_exclusoes_log (user_id, role, modelo_id, cliente_id, motivo, solicitado_em, ip, user_agent, origem, detalhes)
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)`,
      [userId, role, modelo_id, cliente_id, "autoexclusao", ip, userAgent, "/api/conta/excluir", JSON.stringify({ desativacao_logica: true })]
    );
    await client.query("COMMIT");
    return res.json({ ok: true, message: "Conta desativada com sucesso" });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO DESATIVAR CONTA:", err);
    return res.status(500).json({ error: "Erro ao desativar conta" });
  } finally {
    client.release();
  }
});

module.exports = router;
