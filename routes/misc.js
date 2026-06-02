const express = require("express");
const router = express.Router();
const path = require("path");
const db = require("../db");
const auth = require("../middleware/auth");

router.get("/health/db", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("DB ERROR:", err);
    res.status(500).json({ status: "error" });
  }
});

router.get("/push/public-key", (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: "Chave pública não configurada" });
  }
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

router.get("/stripe/pk", (req, res) => {
  const key = process.env.STRIPE_PUBLIC_KEY || "";
  if (!key) return res.status(500).json({ error: "Chave pública Stripe não configurada." });
  res.json({ key });
});

router.get("/app/state-v2", auth, (req, res) => {
  if (!req.user || !req.user.role) return res.status(401).json({ next: "logout" });
  if (req.user.role === "modelo") return res.json({ next: "modelo" });
  if (req.user.role === "cliente") return res.json({ next: "cliente" });
  return res.json({ next: "logout" });
});

router.get("/contato", async (req, res) => {
  res.json({ ok: true });
});

router.post("/contato", async (req, res) => {
  const { resend } = require("../config/services");
  try {
    let { nome, email, assunto, mensagem } = req.body;
    if (!nome || !email || !assunto || !mensagem) {
      return res.status(400).json({ error: "Dados incompletos" });
    }
    nome = nome.trim().slice(0, 100);
    email = email.trim().toLowerCase().slice(0, 150);
    assunto = assunto.trim().slice(0, 150);
    mensagem = mensagem.trim().slice(0, 2000);

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Email inválido" });
    }
    const escape = (str) =>
      str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;").replace(/'/g, "&#039;");

    await resend.emails.send({
      from: "Velvet <contato@velvet.lat>",
      to: [process.env.EMAIL_TO],
      replyTo: email,
      subject: `[Contato] ${escape(assunto)}`,
      html: `<h3>Novo contato pelo site</h3><p><b>Nome:</b> ${escape(nome)}</p><p><b>Email:</b> ${escape(email)}</p><p><b>Assunto:</b> ${escape(assunto)}</p><p><b>Mensagem:</b></p><p>${escape(mensagem).replace(/\n/g, "<br>")}</p>`
    });
    return res.json({ success: true });
  } catch (error) {
    console.error("Erro contato:", error);
    return res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

module.exports = router;
