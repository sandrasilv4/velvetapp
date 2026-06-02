const express = require("express");
const router = express.Router();
const axios = require("axios");
const db = require("../db");
const auth = require("../middleware/auth");
const { uploadVerificacao } = require("../config/storage");
const { uploadVerificacaoLimiter, contratoLimiter } = require("../config/rateLimiters");
const { enviarEmailValidacao, enviarEmailContratoModelos } = require("../email");
const { gerarContratoPDFBuffer, enviarContratoZapSign, descarregarPDFAssinadoZapSign } = require("../utils/contrato");

// GET /api/verificacao/status
router.get("/status", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id = $1", [userId]);
    if (modeloRes.rows.length) {
      const modeloId = modeloRes.rows[0].id;
      const modeloVerificacao = await db.query(
        `SELECT status, motivo_rejeicao FROM modelos_verificacao WHERE modelo_id=$1 ORDER BY criado_em DESC LIMIT 1`,
        [modeloId]
      );
      if (modeloVerificacao.rows.length) return res.json(modeloVerificacao.rows[0]);
    }
    const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id = $1", [userId]);
    if (clienteRes.rows.length) {
      const clienteId = clienteRes.rows[0].id;
      const clienteVerificacao = await db.query(
        `SELECT status, motivo_rejeicao FROM clientes_verificacao WHERE cliente_id=$1 ORDER BY criado_em DESC LIMIT 1`,
        [clienteId]
      );
      if (clienteVerificacao.rows.length) return res.json(clienteVerificacao.rows[0]);
    }
    return res.json({ status: "pendente", motivo: null });
  } catch (err) {
    console.error("Erro status verificação:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// POST /api/verificacao
router.post(
  "/",
  auth,
  uploadVerificacaoLimiter,
  uploadVerificacao.fields([
    { name: "doc_frente", maxCount: 1 },
    { name: "doc_verso", maxCount: 1 },
    { name: "selfie", maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
      const docFrente = req.files?.doc_frente?.[0];
      const docVerso  = req.files?.doc_verso?.[0];
      const selfie    = req.files?.selfie?.[0];

      if (!docFrente || !docVerso || !selfie) {
        return res.status(400).json({ erro: "doc_frente, doc_verso e selfie são obrigatórios" });
      }

      const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id = $1", [userId]);
      if (!modeloRes.rowCount) return res.status(404).json({ erro: "Modelo não encontrado" });
      const modeloId = modeloRes.rows[0].id;

      const existente = await db.query(
        `SELECT status FROM modelos_verificacao WHERE modelo_id=$1 ORDER BY criado_em DESC LIMIT 1`, [modeloId]
      );
      if (existente.rowCount > 0 && ["pendente", "aprovado"].includes(existente.rows[0].status)) {
        return res.status(409).json({ erro: "Verificação já enviada ou aprovada" });
      }

      await db.query(
        `INSERT INTO modelos_verificacao (modelo_id, doc_frente_url, doc_verso_url, selfie_url, status, criado_em, ip_submissao)
         VALUES ($1,$2,$3,$4,'pendente',NOW(),$5)`,
        [modeloId, docFrente.location || docFrente.key, docVerso.location || docVerso.key, selfie.location || selfie.key, ip]
      );

      try { await enviarEmailValidacao(req.user.email); } catch (e) {}
      return res.json({ ok: true });
    } catch (err) {
      console.error("Erro verificação:", err);
      return res.status(500).json({ erro: "Erro ao enviar verificação" });
    }
  }
);

// GET /api/verificacao/contrato/status
router.get("/contrato/status", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const modeloRes = await db.query(
      `SELECT id, contrato_assinado, contrato_sign_url, contrato_assinado_em, contrato_token, contrato_signer_token
       FROM modelos WHERE user_id = $1`,
      [userId]
    );
    if (modeloRes.rowCount === 0) return res.status(404).json({ erro: "Modelo não encontrado" });
    const m = modeloRes.rows[0];

    const pdfRes = await db.query("SELECT contrato_pdf_url FROM modelos WHERE id = $1", [m.id]);
    const jaTemPdf = !!pdfRes.rows[0]?.contrato_pdf_url;

    if (m.contrato_assinado) {
      if (!jaTemPdf && m.contrato_token) {
        descarregarPDFAssinadoZapSign(m.contrato_token, m.id).catch(() => {});
      }
      return res.json({ assinado: true, assinado_em: m.contrato_assinado_em });
    }

    if (m.contrato_signer_token && process.env.ZAPSIGN_API_TOKEN) {
      try {
        const zapResp = await axios.get(
          `https://api.zapsign.com.br/api/v1/signers/${m.contrato_signer_token}/`,
          { headers: { Authorization: `Bearer ${process.env.ZAPSIGN_API_TOKEN}` }, timeout: 10000 }
        );
        if (zapResp.data?.status === "signed") {
          await db.query("UPDATE modelos SET contrato_assinado=true, contrato_assinado_em=NOW() WHERE id=$1", [m.id]);
          if (m.contrato_token) await descarregarPDFAssinadoZapSign(m.contrato_token, m.id);
          return res.json({ assinado: true, assinado_em: new Date().toISOString() });
        }
      } catch (pollErr) {
        console.warn("[ZapSign] Erro ao pollar status:", pollErr.message);
      }
    }
    return res.json({ assinado: false, sign_url: m.contrato_sign_url || null, tem_contrato: !!m.contrato_token });
  } catch (err) {
    console.error("Erro ao verificar status contrato:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// POST /api/verificacao/contrato
router.post("/contrato", auth, contratoLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    const modeloRes = await db.query(
      `SELECT id, contrato_assinado FROM modelos WHERE user_id = $1`, [userId]
    );
    if (!modeloRes.rowCount) return res.status(404).json({ erro: "Modelo não encontrada" });
    const modeloId = modeloRes.rows[0].id;
    if (modeloRes.rows[0].contrato_assinado) {
      return res.status(409).json({ erro: "Contrato já assinado." });
    }

    const dadosRes = await db.query(
      `SELECT md.nome_completo, u.email, m.nome_exibicao
       FROM modelos m JOIN users u ON u.id = m.user_id LEFT JOIN modelos_dados md ON md.modelo_id = m.id
       WHERE m.id = $1`,
      [modeloId]
    );
    if (!dadosRes.rowCount) return res.status(400).json({ erro: "Dados da modelo incompletos." });
    const { nome_completo, email, nome_exibicao } = dadosRes.rows[0];
    if (!nome_completo || !email) return res.status(400).json({ erro: "Nome completo e email são obrigatórios." });

    const dataHoje = new Date().toLocaleDateString("pt-BR");
    const pdfBuffer = await gerarContratoPDFBuffer({ nome: nome_completo, email, dataHoje });
    const { token, signerToken, signUrl } = await enviarContratoZapSign(pdfBuffer, nome_completo || nome_exibicao || "Modelo", email);

    await db.query(
      `UPDATE modelos SET contrato_token=$1, contrato_signer_token=$2, contrato_sign_url=$3 WHERE id=$4`,
      [token, signerToken, signUrl, modeloId]
    );

    try { await enviarEmailContratoModelos(email, nome_completo || nome_exibicao || "Modelo", signUrl); } catch (e) {}
    return res.json({ ok: true, sign_url: signUrl });
  } catch (err) {
    console.error("Erro ao gerar contrato:", err);
    return res.status(500).json({ erro: "Erro ao gerar contrato: " + err.message });
  }
});

module.exports = router;
