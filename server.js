console.log("SERVIDOR INICIADO - O SENHOR EH MEU PASTOR E NADA ME FALTARA!")

// ===============================
// VARIAVEIS
// ===============================

require("dotenv").config();      //PRIMEIRO
const http = require("http");
const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.error("⚠️  JWT_SECRET não configurado!");

const cors = require("cors");
const helmet = require("helmet");
const express = require("express");
const db = require("./db");
const bcrypt = require("bcrypt");
const path = require("path");
const fs = require("fs");
const app = express();
const FormData = require("form-data");
const webpush = require("web-push");
const admin = require("firebase-admin");

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
  } catch (e) {
    console.warn("Firebase Admin não inicializado:", e.message);
  }
}

const os = require("os");
const { exec } = require("child_process");
const ffmpeg = require("fluent-ffmpeg");


const server = http.createServer(app);
const multer = require("multer");
const onlineModelos = new Map();
const onlineClientes = new Map();
const AWS = require("aws-sdk");
const multerS3 = require("multer-s3");

const ffmpegPath = require("ffmpeg-static");
const authCliente = require("./middleware/authCliente");
const authModelo = require("./middleware/authModelo");
const auth = require("./middleware/auth");

// Supabase Storage (avatar e capa)
const { createClient } = require("@supabase/supabase-js");
const supabaseStorage = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const crypto = require("crypto");
const axios = require("axios");
const PDFDocument = require("pdfkit");

// ── OTP pré-registo (em memória, TTL 15 min) ──────────────────────────────────
const otpPreRegistro = new Map();
// Limpar entradas expiradas a cada 10 minutos
setInterval(() => {
  const agora = Date.now();
  for (const [email, entry] of otpPreRegistro.entries()) {
    if (agora > entry.expiresAt) otpPreRegistro.delete(email);
  }
}, 10 * 60 * 1000);
// ──────────────────────────────────────────────────────────────────────────────

const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { enviarEmailValidacao, enviarEmailBoasVindasCliente, enviarEmailBoasVindasModelo, enviarEmailContratoModelos, enviarEmailNotificacaoContratoAssinado, enviarEmailVerificacao, enviarEmailOTP } = require("./email");
const rateLimit = require("express-rate-limit");
const compression = require('compression');


app.set("trust proxy", 1);
ffmpeg.setFfmpegPath(ffmpegPath);

const allowedOrigins = [
  "https://www.velvet.lat",
  "https://velvet-test-production.up.railway.app",
  "https://velvet-app-production.up.railway.app",
  "https://velvet-app.onrender.com",
  "https://velvet-chatbox-test.onrender.com",
  "https://bio.mypagess.workers.dev",
  "http://localhost:3000",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5500"
];

app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false
}));

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS bloqueado: " + origin));
  },
  credentials: true
}));

const io = new Server(server, {
  cors: {
    origin: [
      "https://www.velvet.lat",
      "https://velvet-app.onrender.com",
      "https://velvet-app-production.up.railway.app",
      "https://velvet-test-production.up.railway.app"
    ],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ["websocket"],
  
});

// ===========================
// WEBPUSH
// ===========================
if (
  process.env.VAPID_SUBJECT &&
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log("VAPID configurado com sucesso");
} else {
  console.warn("VAPID não configurado. Push desativado por enquanto.");
}

// ===============================
// CLOUDFLARE R2 (UPLOAD)
// ===============================
const s3 = new AWS.S3({
  endpoint: new AWS.Endpoint(process.env.R2_ENDPOINT),
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: "auto",
  signatureVersion: "v4",
  s3ForcePathStyle: true
});

const s3Privado = new AWS.S3({
  endpoint: new AWS.Endpoint(process.env.R2_ENDPOINT),
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: "auto",
  signatureVersion: "v4",
  s3ForcePathStyle: true
});

const uploadB2 = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 200 * 1024 * 1024 
  }
});

// ===============================
// CLOUDFLARE R2 (VERIFICAÇÃO - PRIVADO)
// ===============================
const uploadVerificacao = multer({
  storage: multerS3({
    s3: s3Privado,
    bucket: process.env.R2_BUCKET_PRIVATE,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = file.originalname.split(".").pop();
      const nome = `verificacao/${req.user.id}/${Date.now()}-${file.fieldname}.${ext}`;
      cb(null, nome);
    }
  }),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB
  }
});

// ===============================
// MODO MANUTENÇÃO
// ===============================
app.use((req, res, next) => {
  const MANUTENCAO = false; // mude para false para reativar o site

  if (!MANUTENCAO) return next();

  // Permite: página de manutenção, rotas de admin, webhooks críticos
  const liberados = [
    "/manutencao.html",
    "/api/webhook/",
    "/api/admin/",
    "/admin/",
    "/public/admin/",
  ];
  if (liberados.some((p) => req.path.startsWith(p))) return next();

  // Retorna a página de manutenção
  return res.status(503).sendFile(path.join(__dirname, "manutencao.html"));
});

// ===============================
// WEBHOOKS
// ===============================

// ===============================
// WEBHOOK ZAPSIGN — Contrato assinado
// ===============================

app.post("/api/webhook/zapsign", express.json(), async (req, res) => {
  try {
    console.log("[ZapSign Webhook]", JSON.stringify(req.body).slice(0, 400));
    const event = req.body;

    // ZapSign envia: { event_type: "sign_doc" | "signer_signed" | ..., document: { token, ... }, signer: { token, ... } }
    const eventType = event?.event_type || event?.type || "";
    const docToken = event?.document?.token || event?.doc?.token || event?.token || null;
    const signerStatus = event?.signer?.status || event?.document?.status || "";

    // Considera assinatura completa quando o documento fica "signed" ou o signatário "signed"
    const foiAssinado =
      eventType === "sign_doc" ||
      eventType === "signer_signed" ||
      signerStatus === "signed" ||
      event?.document?.status === "signed";

    if (!foiAssinado || !docToken) {
      return res.status(200).json({ ok: true, ignorado: true });
    }

    // Actualiza a modelo correspondente
    const upd = await db.query(
      `UPDATE modelos
          SET contrato_assinado = true,
              contrato_assinado_em = NOW()
        WHERE contrato_token = $1
       RETURNING id`,
      [docToken]
    );

    if (upd.rowCount === 0) {
      console.warn(`[ZapSign] Webhook: nenhuma modelo com token ${docToken}`);
      return res.status(200).json({ ok: true });
    }

    const modeloId = upd.rows[0].id;
    console.log(`[ZapSign] Contrato assinado — modelo id ${modeloId}`);

    // Descarregar o PDF assinado do ZapSign e guardar no R2, depois notificar admin
    if (typeof descarregarPDFAssinadoZapSign === "function") {
      descarregarPDFAssinadoZapSign(docToken, modeloId)
        .then(async (pdfR2Key) => {
          try {
            // Buscar dados da modelo para o email de notificação
            const mInfo = await db.query(
              `SELECT m.nome_completo, m.nome_exibicao, u.email, m.contrato_assinado_em
                 FROM modelos m
                 JOIN users u ON u.id = m.user_id
                WHERE m.id = $1`,
              [modeloId]
            );
            const info = mInfo.rows[0] || {};
            await enviarEmailNotificacaoContratoAssinado({
              nomeCompleto:  info.nome_completo,
              nomeExibicao:  info.nome_exibicao,
              emailModelo:   info.email,
              modeloId,
              assinadoEm:    info.contrato_assinado_em,
              pdfR2Key
            });
            console.log(`[ZapSign] Notificação de contrato assinado enviada para contato@velvet.lat`);
          } catch (emailErr) {
            console.warn(`[ZapSign Webhook] Falha ao enviar email de notificação: ${emailErr.message}`);
          }
        })
        .catch(err =>
          console.warn(`[ZapSign Webhook] Falha ao descarregar PDF: ${err.message}`)
        );
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[ZapSign Webhook] Erro:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ===============================
// WEBHOOK ASAAS
// ===============================

app.post("/api/webhook/asaas", express.json(), async (req, res) => {
  console.log("======================================");
  console.log("🔥 WEBHOOK ASAAS RECEBIDO");

  // ── Verificação do token configurado no painel Asaas ──
  if (process.env.ASAAS_WEBHOOK_TOKEN) {
    const tokenRecebido =
      req.headers["access_token"] ||
      req.headers["asaas-access-token"] || "";
    if (tokenRecebido !== process.env.ASAAS_WEBHOOK_TOKEN) {
      console.warn("🚨 Webhook Asaas: token inválido");
      return res.status(401).send("unauthorized");
    }
  }

  const event       = req.body;
  const eventType   = String(event?.event || "").toUpperCase();
  const payment     = event?.payment || {};
  const asaasPaymentId = payment?.id || null;
  const valorPago   = Number(payment.value || 0);

  console.log("Evento:", eventType, "| PaymentID:", asaasPaymentId);

  if (!asaasPaymentId) return res.status(200).send("ok");

  const isPaidEvent = [
    "PAYMENT_RECEIVED",
    "PAYMENT_CONFIRMED"
  ].includes(eventType);

  const isFailedEvent = [
    "PAYMENT_OVERDUE",
    "PAYMENT_DELETED",
    "PAYMENT_REFUNDED",
    "PAYMENT_CHARGEBACK_REQUESTED",
    "PAYMENT_CHARGEBACK_DISPUTE"
  ].includes(eventType);

  if (!isPaidEvent && !isFailedEvent) return res.status(200).send("ok");

  const novoStatus = isPaidEvent ? "pago" : "falhou";

  // calcularValores é carregado após as rotas globais; acedemos via app.get
  // como fallback seguro caso ainda não esteja disponível
  const calcularValores =
    req.app.get("calcularValores") ||
    (async ({ valor_bruto }) => ({
      valor_modelo: valor_bruto * 0.7,
      agency_fee: valor_bruto * 0.1,
      velvet_fee: valor_bruto * 0.05
    }));

  const client = await db.connect();
  let dadosParaEmitir = null;

  try {
    await client.query("BEGIN");

    /* =======================================================
       1. BUSCAR REGISTRO — prioridade: premium_unlocks →
          pagamentos_pix → pagamentos_cartao
    ======================================================= */

    // ── PREMIUM (PIX ou Cartão) ──────────────────────────
    const premiumRes = await client.query(
      `SELECT * FROM premium_unlocks
       WHERE pagarme_order_id = $1::text
          OR stripe_payment_intent_id = $1::text
       LIMIT 1 FOR UPDATE`,
      [asaasPaymentId]
    );

    if (premiumRes.rowCount > 0) {
      const row = premiumRes.rows[0];

      if (row.status === "pago") {
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      await client.query(
        `UPDATE premium_unlocks
         SET status = $1::text, pago_em = CASE WHEN $1::text = 'pago' THEN NOW() ELSE pago_em END,
             updated_at = NOW()
         WHERE id = $2`,
        [novoStatus, row.id]
      );

      if (isPaidEvent) {
        const cliente_id      = Number(row.cliente_id);
        const modelo_id       = Number(row.modelo_id);
        const premium_post_id = Number(row.premium_post_id);
        const valorBase       = Number(row.valor_base || valorPago);

        const taxaGateway = Number((1.99 + valorBase * 0.10).toFixed(2));

        const valores = await calcularValores({
          modelo_id,
          valor_bruto: valorBase,
          taxa_gateway: taxaGateway
        });

        await client.query(
          `INSERT INTO transacoes_agency
             (modelo_id, cliente_id, tipo, valor_bruto,
              valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at)
           VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
          [
            modelo_id, cliente_id, valorBase,
            Number(valores.valor_modelo || 0),
            Number(valores.agency_fee   || 0),
            Number(valores.velvet_fee   || 0),
            taxaGateway
          ]
        );

        dadosParaEmitir = {
          tipo: "premium",
          cliente_id,
          modelo_id,
          premium_post_id,
          payment_id: asaasPaymentId
        };
      }

      await client.query("COMMIT");

      if (dadosParaEmitir) {
        try {
          const io = req.app.get("io");
          if (io) {
            io.to(`user_${dadosParaEmitir.cliente_id}`).emit("pagamento_confirmado", {
              tipo: "premium",
              premium_post_id: dadosParaEmitir.premium_post_id,
              modelo_id: dadosParaEmitir.modelo_id,
              payment_id: dadosParaEmitir.payment_id
            });
          }
        } catch (e) { console.error("Erro socket premium webhook:", e); }
      }

      console.log("✅ WEBHOOK ASAAS PREMIUM FINALIZADO");
      return res.status(200).send("ok");
    }

    // ── PIX (VIP ou Mídia) ───────────────────────────────
    const pixRes = await client.query(
      `SELECT * FROM pagamentos_pix
       WHERE pagarme_order_id = $1
       LIMIT 1 FOR UPDATE`,
      [asaasPaymentId]
    );

    if (pixRes.rowCount > 0) {
      const row = pixRes.rows[0];

      if (row.status === "pago") {
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      await client.query(
        `UPDATE pagamentos_pix SET status = $1 WHERE pagarme_order_id = $2`,
        [novoStatus, asaasPaymentId]
      );

      if (isPaidEvent) {
        const cliente_id = Number(row.cliente_id);
        const modelo_id  = Number(row.modelo_id);
        const message_id = row.message_id ? Number(row.message_id) : null;
        const isVip      = !message_id;   // VIP não tem message_id
        // pagamentos_pix.valor armazena valorTotal (bruto cobrado ao cliente, ex: 34.99).
        // Os splits devem ser calculados sobre o valor base da mídia/assinatura (ex: 30.00).
        // Fórmula taxa Asaas: total = base * 1.10 + 1.99 → base = (total - 1.99) / 1.10
        const valorBrutoTotal = Number(row.valor || valorPago);
        const valorBase   = Number(((valorBrutoTotal - 1.99) / 1.10).toFixed(2));
        const taxaGateway = Number((valorBrutoTotal - valorBase).toFixed(2));

        const valores = await calcularValores({
          modelo_id,
          valor_bruto: valorBase,
          taxa_gateway: taxaGateway
        });

        if (isVip) {
          /* ── VIP PIX ── */
          const vipExistente = await client.query(
            `SELECT id, ativo, expiration_at
             FROM vip_subscriptions
             WHERE cliente_id = $1 AND modelo_id = $2
             LIMIT 1 FOR UPDATE`,
            [cliente_id, modelo_id]
          );

          const primeiraAssinatura = vipExistente.rowCount === 0;

          let novaExpiracao;
          if (
            vipExistente.rowCount > 0 &&
            vipExistente.rows[0].expiration_at &&
            new Date(vipExistente.rows[0].expiration_at) > new Date()
          ) {
            novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
            novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
          } else {
            novaExpiracao = new Date();
            novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
          }

          if (vipExistente.rowCount > 0) {
            await client.query(
              `UPDATE vip_subscriptions
               SET ativo = true, updated_at = NOW(), expiration_at = $3,
                   valor_assinatura = $4, taxa_transacao = $5, taxa_plataforma = 0,
                   valor_total = $6, recorrente = false,
                   gateway_subscription_id = $7,
                   aviso_7_dias_enviado = false, aviso_24h_enviado = false
               WHERE cliente_id = $1 AND modelo_id = $2`,
              [cliente_id, modelo_id, novaExpiracao,
               valorBase, taxaGateway, valorPago, asaasPaymentId]
            );
          } else {
            await client.query(
              `INSERT INTO vip_subscriptions
                 (cliente_id, modelo_id, ativo, created_at, updated_at,
                  expiration_at, valor_assinatura, taxa_transacao, taxa_plataforma,
                  valor_total, recorrente, gateway_subscription_id)
               VALUES ($1,$2,true,NOW(),NOW(),$3,$4,$5,0,$6,false,$7)`,
              [cliente_id, modelo_id, novaExpiracao,
               valorBase, taxaGateway, valorPago, asaasPaymentId]
            );
          }

          await client.query(
            `INSERT INTO transacoes_agency
               (modelo_id, cliente_id, tipo, valor_bruto,
                valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at)
             VALUES ($1,$2,'assinatura',$3,$4,$5,$6,$7,'pago',NOW())`,
            [
              modelo_id, cliente_id, valorBase,
              Number(valores.valor_modelo || 0),
              Number(valores.agency_fee   || 0),
              Number(valores.velvet_fee   || 0),
              taxaGateway
            ]
          );

          if (primeiraAssinatura) {
            await client.query(
              `INSERT INTO messages
                 (cliente_id, modelo_id, text, sender, tipo,
                  created_at, lida, visto, deletada)
               VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)`,
              [cliente_id, modelo_id, "Oii!! Bem vindo(a), qual seu nome?🥰"]
            );
          }

          dadosParaEmitir = { tipo: "vip", cliente_id, modelo_id };

        } else {
          /* ── MÍDIA PIX ── */
          await client.query(
            `INSERT INTO conteudo_pacotes
               (message_id, cliente_id, modelo_id, preco, valor_base,
                valor_total, status, metodo_pagamento, pago_em, currency,
                valor_cobrado, taxa_cambio)
             VALUES ($1,$2,$3,$4,$4,$5,'pago','pix',NOW(),'brl',$5,NULL)
             ON CONFLICT (message_id, cliente_id) DO UPDATE
               SET status='pago', metodo_pagamento='pix',
                   pago_em=NOW(), valor_total=$5`,
            [message_id, cliente_id, modelo_id, valorBase, valorPago]
          );

          const conteudo_ids =
            await marcarConteudoComoLiberadoPorPagamento(client, {
              message_id,
              cliente_id,
              modelo_id
            });

          await client.query(
            `INSERT INTO transacoes_agency
               (modelo_id, cliente_id, tipo, valor_bruto,
                valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at)
             VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
            [
              modelo_id, cliente_id, valorBase,
              Number(valores.valor_modelo || 0),
              Number(valores.agency_fee   || 0),
              Number(valores.velvet_fee   || 0),
              taxaGateway
            ]
          );

          dadosParaEmitir = {
            tipo: "conteudo",
            cliente_id,
            modelo_id,
            message_id,
            conteudo_ids
          };
        }
      }

      await client.query("COMMIT");

      // ── Emite socket para PIX ──
      if (dadosParaEmitir) {
        try {
          const io = req.app.get("io");
          if (io) {
            if (dadosParaEmitir.tipo === "conteudo") {
              const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;
              io.to(sala).emit("conteudoLiberado", {
                message_id:   Number(dadosParaEmitir.message_id),
                conteudo_ids: dadosParaEmitir.conteudo_ids || []
              });
            }
            if (dadosParaEmitir.tipo === "vip") {
              const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;
              io.to(sala).emit("vipAtivado", {
                cliente_id: Number(dadosParaEmitir.cliente_id),
                modelo_id:  Number(dadosParaEmitir.modelo_id)
              });
            }
          }
        } catch (e) { console.error("Erro socket pix webhook:", e); }
      }

      console.log("✅ WEBHOOK ASAAS PIX FINALIZADO");
      return res.status(200).send("ok");

    } // else: cartão
    {
      // ── CARTÃO (VIP, Mídia ou Premium) ──────────────────
      const cartaoRes = await client.query(
        `SELECT * FROM pagamentos_cartao
         WHERE gateway_payment_id = $1
            OR stripe_payment_intent_id = $1
         LIMIT 1 FOR UPDATE`,
        [asaasPaymentId]
      );

      if (cartaoRes.rowCount === 0) {
        await client.query("ROLLBACK");
        console.warn("Asaas webhook: pagamento não encontrado em nenhuma tabela:", asaasPaymentId);
        return res.status(200).send("ok");
      }

      const row        = cartaoRes.rows[0];
      const tipoPag    = String(row.tipo || "").toLowerCase();
      const cliente_id = Number(row.cliente_id);
      const modelo_id  = Number(row.modelo_id);

      if (row.status === "pago") {
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      await client.query(
        `UPDATE pagamentos_cartao
         SET status = $1::text, pago_em = CASE WHEN $1::text = 'pago' THEN NOW() ELSE pago_em END,
             updated_at = NOW()
         WHERE gateway_payment_id = $2`,
        [novoStatus, asaasPaymentId]
      );

      if (isPaidEvent) {
        const valorBase   = Number(row.valor_brl || row.valor || valorPago);
        const taxaGateway = Number((1.99 + valorBase * 0.10).toFixed(2));

        const valores = await calcularValores({
          modelo_id,
          valor_bruto: valorBase,
          taxa_gateway: taxaGateway
        });

        if (tipoPag === "vip") {
          /* ── VIP CARTÃO ── */
          const vipExistente = await client.query(
            `SELECT id, ativo, expiration_at
             FROM vip_subscriptions
             WHERE cliente_id = $1 AND modelo_id = $2
             LIMIT 1 FOR UPDATE`,
            [cliente_id, modelo_id]
          );

          const primeiraAssinatura = vipExistente.rowCount === 0;

          let novaExpiracao;
          if (
            vipExistente.rowCount > 0 &&
            vipExistente.rows[0].expiration_at &&
            new Date(vipExistente.rows[0].expiration_at) > new Date()
          ) {
            novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
            novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
          } else {
            novaExpiracao = new Date();
            novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
          }

          if (vipExistente.rowCount > 0) {
            await client.query(
              `UPDATE vip_subscriptions
               SET ativo = true, updated_at = NOW(), expiration_at = $3,
                   valor_assinatura = $4, taxa_transacao = $5, taxa_plataforma = 0,
                   valor_total = $6, recorrente = false,
                   gateway_subscription_id = $7,
                   aviso_7_dias_enviado = false, aviso_24h_enviado = false
               WHERE cliente_id = $1 AND modelo_id = $2`,
              [cliente_id, modelo_id, novaExpiracao,
               valorBase, taxaGateway, valorPago, asaasPaymentId]
            );
          } else {
            await client.query(
              `INSERT INTO vip_subscriptions
                 (cliente_id, modelo_id, ativo, created_at, updated_at,
                  expiration_at, valor_assinatura, taxa_transacao, taxa_plataforma,
                  valor_total, recorrente, gateway_subscription_id)
               VALUES ($1,$2,true,NOW(),NOW(),$3,$4,$5,0,$6,false,$7)`,
              [cliente_id, modelo_id, novaExpiracao,
               valorBase, taxaGateway, valorPago, asaasPaymentId]
            );
          }

          await client.query(
            `INSERT INTO transacoes_agency
               (modelo_id, cliente_id, tipo, valor_bruto,
                valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at)
             VALUES ($1,$2,'assinatura',$3,$4,$5,$6,$7,'pago',NOW())`,
            [
              modelo_id, cliente_id, valorBase,
              Number(valores.valor_modelo || 0),
              Number(valores.agency_fee   || 0),
              Number(valores.velvet_fee   || 0),
              taxaGateway
            ]
          );

          if (primeiraAssinatura) {
            await client.query(
              `INSERT INTO messages
                 (cliente_id, modelo_id, text, sender, tipo,
                  created_at, lida, visto, deletada)
               VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)`,
              [cliente_id, modelo_id, "Oii!! Bem vindo(a), qual seu nome?🥰"]
            );
          }

          dadosParaEmitir = { tipo: "vip", cliente_id, modelo_id };

        } else if (tipoPag === "conteudo" || tipoPag === "midia") {
          /* ── MÍDIA CARTÃO ── */
          const message_id = Number(row.message_id || row.conteudo_id || 0) || null;

          if (message_id) {
            await client.query(
              `INSERT INTO conteudo_pacotes
                 (message_id, cliente_id, modelo_id, preco, valor_base,
                  valor_total, status, metodo_pagamento, pago_em, currency,
                  valor_cobrado, taxa_cambio)
               VALUES ($1,$2,$3,$4,$4,$5,'pago','cartao',NOW(),'brl',$5,NULL)
               ON CONFLICT (message_id, cliente_id) DO UPDATE
                 SET status='pago', metodo_pagamento='cartao',
                     pago_em=NOW(), valor_total=$5`,
              [message_id, cliente_id, modelo_id, valorBase, valorPago]
            );

            const conteudo_ids =
              await marcarConteudoComoLiberadoPorPagamento(client, {
                message_id,
                cliente_id,
                modelo_id
              });

            dadosParaEmitir = {
              tipo: "conteudo",
              cliente_id,
              modelo_id,
              message_id,
              conteudo_ids
            };
          }

          await client.query(
            `INSERT INTO transacoes_agency
               (modelo_id, cliente_id, tipo, valor_bruto,
                valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at)
             VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
            [
              modelo_id, cliente_id, valorBase,
              Number(valores.valor_modelo || 0),
              Number(valores.agency_fee   || 0),
              Number(valores.velvet_fee   || 0),
              taxaGateway
            ]
          );

        } else if (tipoPag === "premium") {
          /* ── PREMIUM CARTÃO ── */
          const premium_post_id = Number(row.premium_post_id || 0) || null;

          if (premium_post_id) {
            await client.query(
              `UPDATE premium_unlocks
               SET status = 'pago', pago_em = NOW(), updated_at = NOW()
               WHERE premium_post_id = $1 AND cliente_id = $2`,
              [premium_post_id, cliente_id]
            );

            await client.query(
              `INSERT INTO transacoes_agency
                 (modelo_id, cliente_id, tipo, valor_bruto,
                  valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at)
               VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
              [
                modelo_id, cliente_id, valorBase,
                Number(valores.valor_modelo || 0),
                Number(valores.agency_fee   || 0),
                Number(valores.velvet_fee   || 0),
                taxaGateway
              ]
            );

            dadosParaEmitir = {
              tipo: "premium",
              cliente_id,
              modelo_id,
              premium_post_id,
              payment_id: asaasPaymentId
            };
          }
        }
      }

      await client.query("COMMIT");
    }

    /* =======================================================
       SOCKET — emite após COMMIT
    ======================================================= */
    if (dadosParaEmitir) {
      try {
        const io = req.app.get("io");
        if (io) {
          if (dadosParaEmitir.tipo === "conteudo") {
            const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;
            io.to(sala).emit("conteudoLiberado", {
              message_id:   Number(dadosParaEmitir.message_id),
              conteudo_ids: dadosParaEmitir.conteudo_ids || []
            });
          }

          if (dadosParaEmitir.tipo === "vip") {
            const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;
            io.to(sala).emit("vipAtivado", {
              cliente_id: Number(dadosParaEmitir.cliente_id),
              modelo_id:  Number(dadosParaEmitir.modelo_id)
            });
          }

          if (dadosParaEmitir.tipo === "premium") {
            io.to(`user_${dadosParaEmitir.cliente_id}`).emit("pagamento_confirmado", {
              tipo:             "premium",
              premium_post_id:  dadosParaEmitir.premium_post_id,
              modelo_id:        dadosParaEmitir.modelo_id,
              payment_id:       dadosParaEmitir.payment_id
            });
          }
        }
      } catch (e) {
        console.error("Erro socket webhook Asaas:", e);
      }
    }

    console.log("✅ WEBHOOK ASAAS FINALIZADO");
    return res.status(200).send("ok");

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("🔥 ERRO WEBHOOK ASAAS:", err);
    return res.status(500).send("erro");
  } finally {
    client.release();
  }
});

// ── WEBHOOK WOOVI (OpenPix) ──────────────────────────────────────────────────
app.post("/api/webhook/abacatepay", express.json(), async (req, res) => {
  console.log("======================================");
  console.log("🔥 WEBHOOK ABACATEPAY RECEBIDO");

  // Verificação de token — configure ABACATEPAY_WEBHOOK_SECRET no Render
  console.log("Webhook headers:", JSON.stringify({
    authorization: req.headers["authorization"],
    "x-abacatepay-token": req.headers["x-abacatepay-token"]
  }));
  if (process.env.ABACATEPAY_WEBHOOK_SECRET) {
    const tokenRecebido =
      req.headers["authorization"] ||
      req.headers["x-abacatepay-token"] || "";
    const esperado = process.env.ABACATEPAY_WEBHOOK_SECRET;
    const tokenLimpo = tokenRecebido.replace(/^Bearer\s+/i, "");
    console.log("Token recebido:", tokenLimpo);
    console.log("Token esperado:", esperado);
    if (tokenLimpo !== esperado) {
      console.warn("🚨 Webhook AbacatePay: token inválido");
      return res.status(401).send("unauthorized");
    }
  }

  const body      = req.body;
  const eventType = String(body?.event || "");

  // AbacatePay v2 payload: { event: "transparent.completed", data: { transparent: { id, externalId, amount, paidAmount, status } } }
  const transparent   = body?.data?.transparent || {};
  const correlationID = transparent?.id || null;
  const valorCentavos = Number(transparent?.paidAmount || transparent?.amount || 0);
  const valorPago     = valorCentavos > 0 ? valorCentavos / 100 : 0;

  console.log("Evento:", eventType, "| CorrelationID:", correlationID, "| Valor:", valorPago);

  if (!correlationID) return res.status(200).send("ok");

  const isPaidEvent   = eventType === "transparent.completed";
  const isFailedEvent = ["transparent.refunded", "transparent.disputed"].includes(eventType);

  if (!isPaidEvent && !isFailedEvent) return res.status(200).send("ok");

  const novoStatus = isPaidEvent ? "pago" : "falhou";

  const calcularValores =
    req.app.get("calcularValores") ||
    (async ({ valor_bruto }) => ({
      valor_modelo: valor_bruto * 0.7,
      agency_fee:   valor_bruto * 0.1,
      velvet_fee:   valor_bruto * 0.05
    }));

  const client = await db.connect();
  let dadosParaEmitir = null;

  try {
    await client.query("BEGIN");

    /* =====================================================
       1. PREMIUM PIX
    ===================================================== */
    const premiumRes = await client.query(
      `SELECT * FROM premium_unlocks
       WHERE pagarme_order_id = $1::text
       LIMIT 1 FOR UPDATE`,
      [correlationID]
    );

    if (premiumRes.rowCount > 0) {
      const row = premiumRes.rows[0];

      if (row.status === "pago") {
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      await client.query(
        `UPDATE premium_unlocks
         SET status = $1::text, pago_em = CASE WHEN $1::text = 'pago' THEN NOW() ELSE pago_em END,
             updated_at = NOW()
         WHERE id = $2`,
        [novoStatus, row.id]
      );

      if (isPaidEvent) {
        const cliente_id      = Number(row.cliente_id);
        const modelo_id       = Number(row.modelo_id);
        const premium_post_id = Number(row.premium_post_id);
        const valorBase       = Number(row.valor_base || valorPago);
        const taxaGateway     = Number((valorBase * 0.15).toFixed(2));

        const valores = await calcularValores({
          modelo_id,
          valor_bruto: valorBase,
          taxa_gateway: taxaGateway
        });

        await client.query(
          `INSERT INTO transacoes_agency
             (modelo_id, cliente_id, tipo, valor_bruto,
              valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at)
           VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
          [
            modelo_id, cliente_id, valorBase,
            Number(valores.valor_modelo || 0),
            Number(valores.agency_fee   || 0),
            Number(valores.velvet_fee   || 0),
            taxaGateway
          ]
        );

        dadosParaEmitir = {
          tipo: "premium",
          cliente_id,
          modelo_id,
          premium_post_id,
          payment_id: correlationID
        };
      }

      await client.query("COMMIT");

      if (dadosParaEmitir) {
        try {
          const io = req.app.get("io");
          if (io) {
            io.to(`user_${dadosParaEmitir.cliente_id}`).emit("pagamento_confirmado", {
              tipo:            "premium",
              premium_post_id: dadosParaEmitir.premium_post_id,
              modelo_id:       dadosParaEmitir.modelo_id,
              payment_id:      dadosParaEmitir.payment_id
            });
          }
        } catch (e) { console.error("Erro socket premium webhook AbacatePay:", e); }
      }

      console.log("✅ WEBHOOK ABACATEPAY PREMIUM FINALIZADO");
      return res.status(200).send("ok");
    }

    /* =====================================================
       2. PIX — VIP ou Mídia
    ===================================================== */
    const pixRes = await client.query(
      `SELECT * FROM pagamentos_pix
       WHERE pagarme_order_id = $1
       LIMIT 1 FOR UPDATE`,
      [correlationID]
    );

    if (pixRes.rowCount === 0) {
      await client.query("ROLLBACK");
      console.warn("AbacatePay webhook: pagamento não encontrado:", correlationID);
      return res.status(200).send("ok");
    }

    const row = pixRes.rows[0];

    if (row.status === "pago") {
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    await client.query(
      `UPDATE pagamentos_pix SET status = $1 WHERE pagarme_order_id = $2`,
      [novoStatus, correlationID]
    );

    if (isPaidEvent) {
      const cliente_id      = Number(row.cliente_id);
      const modelo_id       = Number(row.modelo_id);
      const message_id      = row.message_id ? Number(row.message_id) : null;
      const isVip           = !message_id;
      // valor armazenado é valorTotal (base * 1.15); recupera o base
      const valorBrutoTotal = Number(row.valor || valorPago);
      const valorBase       = Number((valorBrutoTotal / 1.15).toFixed(2));
      const taxaGateway     = Number((valorBrutoTotal - valorBase).toFixed(2));

      const valores = await calcularValores({
        modelo_id,
        valor_bruto: valorBase,
        taxa_gateway: taxaGateway
      });

      if (isVip) {
        /* ── VIP PIX ── */
        const vipExistente = await client.query(
          `SELECT id, ativo, expiration_at
           FROM vip_subscriptions
           WHERE cliente_id = $1 AND modelo_id = $2
           LIMIT 1 FOR UPDATE`,
          [cliente_id, modelo_id]
        );

        const primeiraAssinatura = vipExistente.rowCount === 0;

        let novaExpiracao;
        if (
          vipExistente.rowCount > 0 &&
          vipExistente.rows[0].expiration_at &&
          new Date(vipExistente.rows[0].expiration_at) > new Date()
        ) {
          novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
          novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
        } else {
          novaExpiracao = new Date();
          novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
        }

        if (vipExistente.rowCount > 0) {
          await client.query(
            `UPDATE vip_subscriptions
             SET ativo = true, updated_at = NOW(), expiration_at = $3,
                 valor_assinatura = $4, taxa_transacao = $5, taxa_plataforma = 0,
                 valor_total = $6, recorrente = false,
                 gateway_subscription_id = $7,
                 aviso_7_dias_enviado = false, aviso_24h_enviado = false
             WHERE cliente_id = $1 AND modelo_id = $2`,
            [cliente_id, modelo_id, novaExpiracao,
             valorBase, taxaGateway, valorBrutoTotal, correlationID]
          );
        } else {
          await client.query(
            `INSERT INTO vip_subscriptions
               (cliente_id, modelo_id, ativo, created_at, updated_at,
                expiration_at, valor_assinatura, taxa_transacao, taxa_plataforma,
                valor_total, recorrente, gateway_subscription_id)
             VALUES ($1,$2,true,NOW(),NOW(),$3,$4,$5,0,$6,false,$7)`,
            [cliente_id, modelo_id, novaExpiracao,
             valorBase, taxaGateway, valorBrutoTotal, correlationID]
          );
        }

        await client.query(
          `INSERT INTO transacoes_agency
             (modelo_id, cliente_id, tipo, valor_bruto,
              valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at)
           VALUES ($1,$2,'assinatura',$3,$4,$5,$6,$7,'pago',NOW())`,
          [
            modelo_id, cliente_id, valorBase,
            Number(valores.valor_modelo || 0),
            Number(valores.agency_fee   || 0),
            Number(valores.velvet_fee   || 0),
            taxaGateway
          ]
        );

        if (primeiraAssinatura) {
          await client.query(
            `INSERT INTO messages
               (cliente_id, modelo_id, text, sender, tipo,
                created_at, lida, visto, deletada)
             VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)`,
            [cliente_id, modelo_id, "Oii!! Bem vindo(a), qual seu nome?🥰🔥"]
          );
        }

        dadosParaEmitir = { tipo: "vip", cliente_id, modelo_id };

      } else {
        /* ── MÍDIA PIX ── */
        await client.query(
          `INSERT INTO conteudo_pacotes
             (message_id, cliente_id, modelo_id, preco, valor_base,
              valor_total, status, metodo_pagamento, pago_em, currency,
              valor_cobrado, taxa_cambio)
           VALUES ($1,$2,$3,$4,$4,$5,'pago','pix',NOW(),'brl',$5,NULL)
           ON CONFLICT (message_id, cliente_id) DO UPDATE
             SET status='pago', metodo_pagamento='pix',
                 pago_em=NOW(), valor_total=$5`,
          [message_id, cliente_id, modelo_id, valorBase, valorBrutoTotal]
        );

        const conteudo_ids =
          await marcarConteudoComoLiberadoPorPagamento(client, {
            message_id,
            cliente_id,
            modelo_id
          });

        await client.query(
          `INSERT INTO transacoes_agency
             (modelo_id, cliente_id, tipo, valor_bruto,
              valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at)
           VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
          [
            modelo_id, cliente_id, valorBase,
            Number(valores.valor_modelo || 0),
            Number(valores.agency_fee   || 0),
            Number(valores.velvet_fee   || 0),
            taxaGateway
          ]
        );

        dadosParaEmitir = {
          tipo: "conteudo",
          cliente_id,
          modelo_id,
          message_id,
          conteudo_ids
        };
      }
    }

    await client.query("COMMIT");

    if (dadosParaEmitir) {
      try {
        const io = req.app.get("io");
        if (io) {
          if (dadosParaEmitir.tipo === "conteudo") {
            const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;
            io.to(sala).emit("conteudoLiberado", {
              message_id:   Number(dadosParaEmitir.message_id),
              conteudo_ids: dadosParaEmitir.conteudo_ids || []
            });
          }
          if (dadosParaEmitir.tipo === "vip") {
            const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;
            io.to(sala).emit("vipAtivado", {
              cliente_id: Number(dadosParaEmitir.cliente_id),
              modelo_id:  Number(dadosParaEmitir.modelo_id)
            });
          }
        }
      } catch (e) { console.error("Erro socket webhook AbacatePay:", e); }
    }

    console.log("✅ WEBHOOK ABACATEPAY FINALIZADO");
    return res.status(200).send("ok");

  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("🔥 ERRO WEBHOOK ABACATEPAY:", err);
    return res.status(500).send("erro");
  } finally {
    client.release();
  }
});

// ── PLACEHOLDER para o antigo webhook pagarme (removido) ──
app.post("/api/webhook/pagarme_REMOVED", express.raw({ type: "*/*" }), async (req, res) => {
  console.log("======================================");
  console.log("🔥 WEBHOOK PAGARME RECEBIDO");
  console.log("URL:", req.originalUrl);
  console.log("METHOD:", req.method);

  let event = null;

  try {
    const raw = req.body?.toString("utf8") || "";
    event = raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error("Erro parse webhook:", err);
    return res.status(400).send("invalid body");
  }

  if (!event || typeof event !== "object") {
    console.log("Evento inválido (sem objeto)");
    return res.status(200).send("ok");
  }

  if (!event.type) {
    console.log("Evento sem type:", event);
    return res.status(200).send("ok");
  }

  console.log("Evento:", event.type);
  console.log("EventID:", event.id);

  const eventId = event.id || null;
  const eventType = String(event.type || "").toLowerCase();

  if (!eventId) {
    console.log("🚨 event.id ausente");
    return res.status(200).send("ok");
  }

  const data = event.data || {};
  const isOrderEvent = eventType.startsWith("order.");
  const isChargeEvent = eventType.startsWith("charge.");

  const order = isOrderEvent ? data : (data.order || null);
  const charge = isChargeEvent ? data : (data.charges?.[0] || null);

  const orderId = order?.id || charge?.order?.id || null;
  const chargeId = charge?.id || null;
  const metadata = order?.metadata || charge?.metadata || charge?.order?.metadata || {};

  console.log("OrderID:", orderId);
  console.log("ChargeID:", chargeId);
  console.log("Metadata:", metadata);

  if (!orderId) {
    console.log("🚨 orderId ausente");
    return res.status(200).send("ok");
  }

  const gatewayStatus = String(charge?.status || order?.status || "").toLowerCase();

  const isPaidEvent =
    eventType === "order.paid" ||
    eventType === "charge.paid" ||
    ["paid"].includes(gatewayStatus);

  const isFailedEvent =
    eventType === "order.payment_failed" ||
    eventType === "charge.payment_failed" ||
    eventType === "charge.failed" ||
    eventType === "order.canceled" ||
    eventType === "charge.canceled";

  const isRefundedEvent =
    eventType === "charge.refunded";

  const isChargebackEvent =
    eventType === "charge.chargedback";

  const amountCentavos = Number(charge?.amount ?? order?.amount ?? 0);
  const valorPago = amountCentavos / 100;

  console.log("Valor pago:", valorPago);

  const client = await db.connect();
  let dadosParaEmitir = null;

  try {
    console.log("🔹 BEGIN");
    await client.query("BEGIN");

    /* =====================================================
       IDEMPOTÊNCIA
    ===================================================== */

    console.log("🔎 Verificando evento duplicado");

    const jaProcessado = await client.query(
      `
      SELECT 1
      FROM pagarme_events
      WHERE id = $1
      FOR UPDATE
      `,
      [eventId]
    );

    console.log("Evento já processado?", jaProcessado.rowCount);

    if (jaProcessado.rowCount > 0) {
      console.log("Evento já existia, ignorando");
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

await client.query(
  `
  INSERT INTO pagarme_events (id, type, payload, received_at)
  VALUES ($1, $2, $3::jsonb, NOW())
  `,
  [eventId, event.type, JSON.stringify(event)]
);

    console.log("Evento registrado em pagarme_events");

    /* =====================================================
       BUSCAR PAGAMENTO LOCAL (SOMENTE PIX)
    ===================================================== */

    let pagamento = null;
    let tabelaPagamento = null;
    let metodoPagamento = "pix";

    // 1) PREMIUM PIX
    const premiumRes = await client.query(
      `
      SELECT *
      FROM premium_unlocks
      WHERE pagarme_order_id = $1
      FOR UPDATE
      `,
      [orderId]
    );

    if (premiumRes.rowCount > 0) {
      pagamento = premiumRes.rows[0];
      tabelaPagamento = "premium_unlocks";
      metodoPagamento = pagamento.metodo_pagamento || "pix";
    } else {
      // 2) PIX geral
      const pagamentoPixRes = await client.query(
        `
        SELECT *
        FROM pagamentos_pix
        WHERE gateway = 'pagarme'
          AND pagarme_order_id = $1
        FOR UPDATE
        `,
        [orderId]
      );

      if (pagamentoPixRes.rowCount > 0) {
        pagamento = pagamentoPixRes.rows[0];
        tabelaPagamento = "pagamentos_pix";
        metodoPagamento = "pix";
      }
    }

    if (!pagamento) {
      console.log("🚨 Pagamento não encontrado:", orderId);
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    console.log("Pagamento encontrado em", tabelaPagamento, pagamento);

    const cliente_id = Number(
      pagamento.cliente_id || metadata.cliente_id || 0
    ) || null;

    const modelo_id = Number(
      pagamento.modelo_id || metadata.modelo_id || 0
    ) || null;

    const message_id = Number(
      pagamento.message_id ||
      pagamento.conteudo_id ||
      metadata.message_id ||
      0
    ) || null;

    const premium_post_id = Number(
      pagamento.premium_post_id ||
      metadata.premium_post_id ||
      0
    ) || null;

    const valorEsperado = Number(
      pagamento.valor_total ||
      pagamento.valor ||
      metadata.valor_total ||
      0
    );

    const tipoPagamento = String(
      metadata.tipo ||
      pagamento.tipo ||
      ""
    ).toLowerCase().trim();

    let fluxoProcessado = false;

    console.log("cliente_id:", cliente_id);
    console.log("modelo_id:", modelo_id);
    console.log("valor esperado:", valorEsperado);
    console.log("message_id:", message_id);
    console.log("premium_post_id:", premium_post_id);
    console.log("tipoPagamento:", tipoPagamento);

    /* =====================================================
       EVENTOS DE FALHA / ESTORNO / CHARGEBACK
    ===================================================== */

    if (isFailedEvent) {
      console.log("❌ Evento de falha");

      if (tabelaPagamento === "premium_unlocks") {
        await client.query(
          `
          UPDATE premium_unlocks
          SET status = 'falhou',
              updated_at = NOW()
          WHERE id = $1
          `,
          [pagamento.id]
        );
      } else if (tabelaPagamento === "pagamentos_pix") {
        await client.query(
          `
          UPDATE pagamentos_pix
          SET status = 'falhou'
          WHERE id = $1
          `,
          [pagamento.id]
        );
      }

      await client.query("COMMIT");
      return res.status(200).send("ok");
    }

    if (isRefundedEvent) {
      console.log("↩️ Evento de estorno");

      if (tabelaPagamento === "premium_unlocks") {
        await client.query(
          `
          UPDATE premium_unlocks
          SET status = 'estornado',
              updated_at = NOW()
          WHERE id = $1
          `,
          [pagamento.id]
        );
      } else if (tabelaPagamento === "pagamentos_pix") {
        await client.query(
          `
          UPDATE pagamentos_pix
          SET status = 'estornado'
          WHERE id = $1
          `,
          [pagamento.id]
        );
      }

      await client.query("COMMIT");
      return res.status(200).send("ok");
    }

    if (isChargebackEvent) {
      console.log("🚨 Evento de chargeback");

      if (tabelaPagamento === "premium_unlocks") {
        await client.query(
          `
          UPDATE premium_unlocks
          SET status = 'chargeback',
              updated_at = NOW()
          WHERE id = $1
          `,
          [pagamento.id]
        );
      } else if (tabelaPagamento === "pagamentos_pix") {
        await client.query(
          `
          UPDATE pagamentos_pix
          SET status = 'chargeback'
          WHERE id = $1
          `,
          [pagamento.id]
        );
      }

      await client.query("COMMIT");
      return res.status(200).send("ok");
    }

    if (!isPaidEvent) {
      console.log("Evento não é de pagamento confirmado, ignorando:", eventType);
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    /* =====================================================
       JÁ PAGO
    ===================================================== */

    const statusLocal = String(pagamento.status || "").toLowerCase().trim();
    const pagamentoJaFinalizado = ["pago"].includes(statusLocal);

    if (pagamentoJaFinalizado) {
      console.log("Pagamento já estava pago");
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    /* =====================================================
       VALIDAÇÃO DE VALOR
    ===================================================== */

    if (valorEsperado > 0 && Math.abs(Number(valorPago) - Number(valorEsperado)) > 0.01) {
      console.log("🚨 Valor divergente", valorPago, valorEsperado);
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    console.log("Valor validado");

    /* =====================================================
       MIDIA PIX
    ===================================================== */

    if (tipoPagamento === "conteudo" || tipoPagamento === "conteudo_pix") {
      console.log("💰 Processando compra de mídia PIX");

      const conteudoRes = await client.query(
        `
        SELECT preco
        FROM messages
        WHERE id = $1
        LIMIT 1
        `,
        [message_id]
      );

      if (!conteudoRes.rowCount) {
        console.log("🚨 mensagem não encontrada:", message_id);
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      const valorBase = Number(Number(conteudoRes.rows[0].preco).toFixed(2));
      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valorBruto = valorBase;

      const valores = await calcularValores({
        modelo_id,
        valor_bruto: valorBase,
        taxa_gateway: taxaGateway
      });

      console.log("Valores calculados:", valores);

      await client.query(
        `
        INSERT INTO conteudo_pacotes (
          message_id,
          cliente_id,
          modelo_id,
          preco,
          valor_base,
          valor_total,
          status,
          metodo_pagamento,
          pago_em
        )
        VALUES ($1,$2,$3,$4,$4,$5,'pago',$6,NOW())
        ON CONFLICT (message_id,cliente_id)
        DO UPDATE SET
          status='pago',
          metodo_pagamento=$6,
          pago_em=NOW(),
          valor_total=$5
        `,
        [
          message_id,
          cliente_id,
          modelo_id,
          valorBase,
          valorPago,
          metodoPagamento
        ]
      );

      console.log("conteudo_pacotes atualizado");

      const conteudo_ids =
        await marcarConteudoComoLiberadoPorPagamento(client, {
          message_id,
          cliente_id,
          modelo_id
        });

      console.log("Conteúdos liberados:", conteudo_ids);

      await client.query(
        `
        INSERT INTO transacoes_agency (
          modelo_id,
          cliente_id,
          tipo,
          valor_bruto,
          valor_modelo,
          agency_fee,
          velvet_fee,
          taxa_gateway,
          status,
          created_at
        )
        VALUES (
          $1,$2,'midia',
          $3,$4,$5,$6,$7,'pago',NOW()
        )
        `,
        [
          modelo_id,
          cliente_id,
          valorBruto,
          Number(valores.valor_modelo || 0),
          Number(valores.agency_fee || 0),
          Number(valores.velvet_fee || 0),
          taxaGateway
        ]
      );

      console.log("transacoes_agency (midia) inserido");

      dadosParaEmitir = {
        tipo: "conteudo",
        cliente_id,
        modelo_id,
        message_id,
        conteudo_ids
      };

      fluxoProcessado = true;
      console.log("✅ Conteúdo atualizado com sucesso");
    }

    /* =====================================================
       PREMIUM PIX
    ===================================================== */

    if (
      tabelaPagamento === "premium_unlocks" ||
      ["premium", "premium_pix"].includes(tipoPagamento)
    ) {
      console.log("💎 Processando premium PIX");

      if (!premium_post_id || !cliente_id || !modelo_id) {
        console.log("🚨 premium sem premium_post_id, cliente_id ou modelo_id");
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      if (tabelaPagamento !== "premium_unlocks") {
        console.log("🚨 metadata premium recebida, mas pagamento não veio de premium_unlocks");
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      const premiumPostRes = await client.query(
        `
        SELECT preco
        FROM premium_posts
        WHERE id = $1
        LIMIT 1
        `,
        [premium_post_id]
      );

      if (!premiumPostRes.rowCount) {
        console.log("🚨 premium_post não encontrado:", premium_post_id);
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      const valorBase = Number(Number(premiumPostRes.rows[0].preco).toFixed(2));

      if (!Number.isFinite(valorBase) || valorBase <= 0) {
        console.log("🚨 valorBase premium inválido:", valorBase);
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valorBruto = valorBase;

      const valores = await calcularValores({
        modelo_id,
        valor_bruto: valorBase,
        taxa_gateway: taxaGateway
      });

      await client.query(
        `
        UPDATE premium_unlocks
        SET status = 'pago',
            pago_em = NOW(),
            pagarme_order_id = $1,
            pagarme_charge_id = $2,
            updated_at = NOW()
        WHERE id = $3
        `,
        [orderId, chargeId, pagamento.id]
      );

      await client.query(
        `
        INSERT INTO transacoes_agency (
          modelo_id,
          cliente_id,
          tipo,
          valor_bruto,
          valor_modelo,
          agency_fee,
          velvet_fee,
          taxa_gateway,
          status,
          created_at
        )
        VALUES (
          $1,$2,'midia',
          $3,$4,$5,$6,$7,'pago',NOW()
        )
        `,
        [
          modelo_id,
          cliente_id,
          valorBruto,
          Number(valores.valor_modelo || 0),
          Number(valores.agency_fee || 0),
          Number(valores.velvet_fee || 0),
          taxaGateway
        ]
      );

      fluxoProcessado = true;
      console.log("✅ Premium atualizado com sucesso");
    }

    /* =====================================================
       VIP PIX
    ===================================================== */

    if (tipoPagamento === "vip" || tipoPagamento === "vip_pix") {
      console.log("⭐ Processando VIP PIX");

      const vipExistente = await client.query(
        `
        SELECT id, ativo, expiration_at
        FROM vip_subscriptions
        WHERE cliente_id = $1
          AND modelo_id = $2
        LIMIT 1
        FOR UPDATE
        `,
        [cliente_id, modelo_id]
      );

      const primeiraAssinatura = vipExistente.rowCount === 0;

      let valorBase = Number(
        metadata.valor_assinatura ??
        metadata.valor_base ??
        pagamento.valor ??
        0
      );

      if (!Number.isFinite(valorBase) || valorBase <= 0) {
        console.log(
          "🚨 valorBase inválido:",
          metadata.valor_assinatura,
          metadata.valor_base,
          pagamento.valor
        );
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      valorBase = Number(valorBase.toFixed(2));

      const taxaTransacao = Number(metadata.taxa_transacao || 0);
      const taxaPlataforma = Number(metadata.taxa_plataforma || 0);

      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valorBruto = valorBase;

      const valores = await calcularValores({
        modelo_id,
        valor_bruto: valorBase,
        taxa_gateway: taxaGateway
      });

      const valorModelo = Number(valores.valor_modelo || 0);
      const agencyFee = Number(valores.agency_fee || 0);
      const velvetFee = Number(valores.velvet_fee || 0);

      console.log("Valores VIP:", {
        valorBruto,
        valorModelo,
        agencyFee,
        velvetFee,
        taxaGateway
      });

      let novaExpiracao;

      if (
        vipExistente.rowCount > 0 &&
        vipExistente.rows[0].expiration_at &&
        new Date(vipExistente.rows[0].expiration_at) > new Date()
      ) {
        novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
        novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
        console.log("Renovando VIP ativo. Nova expiração:", novaExpiracao);
      } else {
        novaExpiracao = new Date();
        novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
        console.log("Ativando/Reativando VIP. Nova expiração:", novaExpiracao);
      }

      if (vipExistente.rowCount > 0) {
        await client.query(
          `
          UPDATE vip_subscriptions
          SET
            ativo = true,
            updated_at = NOW(),
            expiration_at = $3,
            valor_assinatura = $4,
            taxa_transacao = $5,
            taxa_plataforma = $6,
            valor_total = $7,
            recorrente = false,
            gateway_subscription_id = $8
          WHERE cliente_id = $1
            AND modelo_id = $2
          `,
          [
            cliente_id,
            modelo_id,
            novaExpiracao,
            valorBase,
            taxaTransacao,
            taxaPlataforma,
            valorPago,
            orderId
          ]
        );

        console.log("vip_subscriptions atualizado (UPDATE)");
      } else {
        await client.query(
          `
          INSERT INTO vip_subscriptions (
            cliente_id,
            modelo_id,
            ativo,
            created_at,
            updated_at,
            expiration_at,
            valor_assinatura,
            taxa_transacao,
            taxa_plataforma,
            valor_total,
            recorrente,
            gateway_subscription_id
          )
          VALUES (
            $1, $2, true,
            NOW(), NOW(),
            $3, $4, $5, $6, $7,
            false, $8
          )
          `,
          [
            cliente_id,
            modelo_id,
            novaExpiracao,
            valorBase,
            taxaTransacao,
            taxaPlataforma,
            valorPago,
            orderId
          ]
        );

        console.log("vip_subscriptions atualizado (INSERT)");
      }

      await client.query(
        `
        INSERT INTO transacoes_agency (
          modelo_id,
          cliente_id,
          tipo,
          valor_bruto,
          valor_modelo,
          agency_fee,
          velvet_fee,
          taxa_gateway,
          status,
          created_at
        )
        VALUES (
          $1,$2,'assinatura',
          $3,$4,$5,$6,$7,'pago',NOW()
        )
        `,
        [
          modelo_id,
          cliente_id,
          valorBruto,
          valorModelo,
          agencyFee,
          velvetFee,
          taxaGateway
        ]
      );

      console.log("transacoes_agency (vip) inserido");

      if (primeiraAssinatura) {
        await client.query(
          `
          INSERT INTO messages (
            cliente_id,
            modelo_id,
            text,
            sender,
            tipo,
            created_at,
            lida,
            visto,
            deletada
          )
          VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)
          `,
          [
            cliente_id,
            modelo_id,
            "Oii!! Bem vindo(a), qual seu nome?🥰"
          ]
        );
        console.log("Mensagem de boas-vindas enviada");
      }

      dadosParaEmitir = {
        tipo: "vip",
        cliente_id,
        modelo_id
      };

      fluxoProcessado = true;
      console.log("✅ Bloco VIP finalizado com sucesso");
    }

    /* =====================================================
       MARCAR PAGAMENTO COMO PAGO
    ===================================================== */

    if (!fluxoProcessado) {
      console.log("🚨 Nenhum fluxo de negócio foi processado para este pagamento:", {
        tabelaPagamento,
        tipoPagamento,
        metadata
      });
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    console.log("Marcando pagamento como pago");

    if (tabelaPagamento === "pagamentos_pix") {
      await client.query(
        `
        UPDATE pagamentos_pix
        SET status = 'pago',
            pago_em = NOW(),
            pagarme_order_id = COALESCE(pagarme_order_id, $2)
        WHERE id = $1
        `,
        [pagamento.id, orderId]
      );
    } else if (tabelaPagamento === "premium_unlocks") {
      console.log("premium_unlocks já foi atualizado no bloco premium");
    }

    console.log("Pagamento atualizado");

    /* =====================================================
       COMMIT
    ===================================================== */

    await client.query("COMMIT");
    console.log("COMMIT realizado");

    /* =====================================================
       SOCKET
    ===================================================== */

    try {
      console.log("Emitindo eventos socket");

      if (dadosParaEmitir?.tipo === "conteudo") {
        const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;

        console.log("Emitindo conteudoLiberado para", sala);

        io.to(sala).emit("conteudoLiberado", {
          message_id: Number(dadosParaEmitir.message_id),
          conteudo_ids: dadosParaEmitir.conteudo_ids || []
        });
      }

      if (dadosParaEmitir?.tipo === "vip") {
        const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;

        console.log("Emitindo vipAtivado para", sala);

        io.to(sala).emit("vipAtivado", {
          cliente_id: Number(dadosParaEmitir.cliente_id),
          modelo_id: Number(dadosParaEmitir.modelo_id)
        });
      }

    } catch (e) {
      console.error("Erro emitir socket:", e);
    }

    console.log("✅ PAGAMENTO FINALIZADO");
    return res.status(200).send("ok");

  } catch (err) {
    await client.query("ROLLBACK");

    console.error("🔥 ERRO WEBHOOK PAGARME:", err);

    return res.status(500).send("erro");

  } finally {
    client.release();
    console.log("🔚 conexão liberada");
  }
});

app.post("/api/webhook/stripe", express.raw({ type: "application/json" }), async (req, res) => {
  console.log("======================================");
  console.log("🔥 WEBHOOK STRIPE RECEBIDO");
  console.log("URL:", req.originalUrl);
  console.log("METHOD:", req.method);

  let event = null;

  try {
    const signature = req.headers["stripe-signature"];

    if (!signature) {
      console.log("🚨 stripe-signature ausente");
      return res.status(400).send("missing signature");
    }

    // Stripe webhook removed - gateway migrated to Asaas
    throw new Error("Stripe webhook disabled - use /api/webhook/asaas instead");
  } catch (err) {
    console.error("Erro validando assinatura do webhook Stripe:", err.message);
    return res.status(400).send("invalid signature");
  }

  if (!event || typeof event !== "object") {
    console.log("Evento inválido");
    return res.status(200).send("ok");
  }

  if (!event.type) {
    console.log("Evento sem type:", event);
    return res.status(200).send("ok");
  }

  console.log("Evento:", event.type);
  console.log("EventID:", event.id);

  const eventId = event.id || null;
  const eventType = String(event.type || "").toLowerCase();

  if (!eventId) {
    console.log("🚨 event.id ausente");
    return res.status(200).send("ok");
  }

  const obj = event.data?.object || {};

  /* =====================================================
     NORMALIZAÇÃO STRIPE
  ===================================================== */

  let paymentIntentId = null;
  let chargeId = null;
  let metadata = {};
  let amountCentavos = 0;
  let gatewayStatus = "";
  let currency = null;

  if (eventType === "checkout.session.completed") {
    currency = obj.currency || null;
    paymentIntentId = obj.payment_intent || null;
    metadata = obj.metadata || {};
    amountCentavos = Number(obj.amount_total || 0);
    gatewayStatus = String(obj.payment_status || "").toLowerCase();
  } else if (eventType.startsWith("payment_intent.")) {
    currency = obj.currency || null;
    paymentIntentId = obj.id || null;
    metadata = obj.metadata || {};
    amountCentavos = Number(obj.amount_received || obj.amount || 0);
    gatewayStatus = String(obj.status || "").toLowerCase();
    chargeId =
      obj.latest_charge ||
      obj.charges?.data?.[0]?.id ||
      null;
  } else if (eventType.startsWith("charge.")) {
    currency = obj.currency || null;
    chargeId = obj.id || null;
    paymentIntentId = obj.payment_intent || null;
    metadata = obj.metadata || {};
    amountCentavos = Number(obj.amount || 0);
    gatewayStatus = String(obj.status || "").toLowerCase();
  }

  console.log("PaymentIntentID:", paymentIntentId);
  console.log("ChargeID:", chargeId);
  console.log("Metadata inicial:", metadata);

  const client = await db.connect();
  let dadosParaEmitir = null;

  try {
    console.log("🔹 BEGIN");
    await client.query("BEGIN");

    /* =====================================================
       IDEMPOTÊNCIA
    ===================================================== */

    console.log("🔎 Verificando evento duplicado");

    const jaProcessado = await client.query(
      `
      SELECT 1
      FROM stripe_events
      WHERE id = $1
      FOR UPDATE
      `,
      [eventId]
    );

    console.log("Evento já processado?", jaProcessado.rowCount);

    if (jaProcessado.rowCount > 0) {
      console.log("Evento já existia, ignorando");
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    await client.query(
      `
      INSERT INTO stripe_events (id, type)
      VALUES ($1, $2)
      `,
      [eventId, event.type]
    );

    console.log("Evento registrado em stripe_events");

    /* =====================================================
       BUSCAR PAGAMENTO LOCAL
    ===================================================== */

    let pagamento = null;
    let tabelaPagamento = null;
    let metodoPagamento = "cartao";

    // 1) PREMIUM
    const premiumRes = await client.query(
      `
      SELECT *
      FROM premium_unlocks
      WHERE (
        stripe_payment_intent_id = $1
        OR stripe_charge_id = $2
        OR stripe_checkout_session_id = $3
      )
      FOR UPDATE
      `,
      [
        paymentIntentId,
        chargeId,
        eventType === "checkout.session.completed" ? obj.id : null
      ]
    );

    if (premiumRes.rowCount > 0) {
      pagamento = premiumRes.rows[0];
      tabelaPagamento = "premium_unlocks";
      metodoPagamento = pagamento.metodo_pagamento || "cartao";
    } else {
      // 2) CARTÃO
      const pagamentoCartaoRes = await client.query(
        `
        SELECT *
        FROM pagamentos_cartao
        WHERE gateway = 'stripe'
          AND (
            stripe_payment_intent_id = $1
            OR stripe_charge_id = $2
            OR stripe_checkout_session_id = $3
          )
        FOR UPDATE
        `,
        [
          paymentIntentId,
          chargeId,
          eventType === "checkout.session.completed" ? obj.id : null
        ]
      );

      if (pagamentoCartaoRes.rowCount > 0) {
        pagamento = pagamentoCartaoRes.rows[0];
        tabelaPagamento = "pagamentos_cartao";
        metodoPagamento = pagamento.metodo_pagamento || "cartao";
      }
    }

    if (!pagamento) {
      console.log("🚨 Pagamento não encontrado:", {
        paymentIntentId,
        chargeId,
        checkoutSessionId: eventType === "checkout.session.completed" ? obj.id : null
      });
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    console.log("Pagamento encontrado em", tabelaPagamento, pagamento);

    metadata = {
      ...(metadata || {}),
      ...(pagamento.metadata || {})
    };

    const cliente_id = Number(
      pagamento.cliente_id || metadata.cliente_id || 0
    ) || null;

    const modelo_id = Number(
      pagamento.modelo_id || metadata.modelo_id || 0
    ) || null;

    const message_id = Number(
      pagamento.message_id ||
      pagamento.conteudo_id ||
      metadata.message_id ||
      0
    ) || null;

    const premium_post_id = Number(
      pagamento.premium_post_id ||
      metadata.premium_post_id ||
      0
    ) || null;

    const valorEsperado = Number(
      pagamento.valor_total ||
      pagamento.valor ||
      metadata.valor_total ||
      0
    );

    const tipoPagamento = String(
      metadata.tipo ||
      pagamento.tipo ||
      ""
    ).toLowerCase().trim();

    const valorPago = Number(amountCentavos || 0) / 100;

    let fluxoProcessado = false;

    console.log("cliente_id:", cliente_id);
    console.log("modelo_id:", modelo_id);
    console.log("valor esperado:", valorEsperado);
    console.log("message_id:", message_id);
    console.log("premium_post_id:", premium_post_id);
    console.log("tipoPagamento:", tipoPagamento);
    console.log("valorPago:", valorPago);

    /* =====================================================
       MAPA DE EVENTOS STRIPE
    ===================================================== */

    const isPaidEvent =
      eventType === "checkout.session.completed" ||
      eventType === "payment_intent.succeeded" ||
      eventType === "charge.succeeded" ||
      gatewayStatus === "paid" ||
      gatewayStatus === "succeeded";

    const isFailedEvent =
      eventType === "payment_intent.payment_failed" ||
      eventType === "charge.failed";

    const isRefundedEvent =
      eventType === "charge.refunded";

    const isChargebackEvent =
      eventType === "charge.dispute.created";

    /* =====================================================
       EVENTOS DE FALHA / ESTORNO / CHARGEBACK
    ===================================================== */

    if (isFailedEvent) {
      console.log("❌ Evento de falha");

      if (tabelaPagamento === "premium_unlocks") {
        await client.query(
          `
          UPDATE premium_unlocks
          SET status = 'falhou',
              updated_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
              stripe_charge_id = COALESCE($3, stripe_charge_id)
          WHERE id = $1
          `,
          [pagamento.id, paymentIntentId, chargeId]
        );
      } else {
        await client.query(
          `
          UPDATE pagamentos_cartao
          SET status = 'falhou',
              updated_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
              stripe_charge_id = COALESCE($3, stripe_charge_id)
          WHERE id = $1
          `,
          [pagamento.id, paymentIntentId, chargeId]
        );
      }

      await client.query("COMMIT");
      return res.status(200).send("ok");
    }

    if (isRefundedEvent) {
      console.log("↩️ Evento de estorno");

      if (tabelaPagamento === "premium_unlocks") {
        await client.query(
          `
          UPDATE premium_unlocks
          SET status = 'estornado',
              updated_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
              stripe_charge_id = COALESCE($3, stripe_charge_id)
          WHERE id = $1
          `,
          [pagamento.id, paymentIntentId, chargeId]
        );
      } else {
        await client.query(
          `
          UPDATE pagamentos_cartao
          SET status = 'estornado',
              updated_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
              stripe_charge_id = COALESCE($3, stripe_charge_id)
          WHERE id = $1
          `,
          [pagamento.id, paymentIntentId, chargeId]
        );
      }

      await client.query("COMMIT");
      return res.status(200).send("ok");
    }

    if (isChargebackEvent) {
      console.log("🚨 Evento de chargeback");

      if (tabelaPagamento === "premium_unlocks") {
        await client.query(
          `
          UPDATE premium_unlocks
          SET status = 'chargeback',
              updated_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
              stripe_charge_id = COALESCE($3, stripe_charge_id)
          WHERE id = $1
          `,
          [pagamento.id, paymentIntentId, chargeId]
        );
      } else {
        await client.query(
          `
          UPDATE pagamentos_cartao
          SET status = 'chargeback',
              updated_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
              stripe_charge_id = COALESCE($3, stripe_charge_id)
          WHERE id = $1
          `,
          [pagamento.id, paymentIntentId, chargeId]
        );
      }

      await client.query("COMMIT");
      return res.status(200).send("ok");
    }

    if (!isPaidEvent) {
      console.log("Evento não é de pagamento confirmado, ignorando:", eventType);
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    /* =====================================================
       JÁ PAGO
    ===================================================== */

    const statusLocal = String(pagamento.status || "").toLowerCase().trim();
    const pagamentoJaFinalizado = ["pago"].includes(statusLocal);

    if (pagamentoJaFinalizado) {
      console.log("Pagamento já estava pago");
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    /* =====================================================
       VALIDAÇÃO DE VALOR
    ===================================================== */

const moedaEsperada = String(pagamento.currency || metadata.currency || "").toLowerCase();
const moedaRecebida = String(currency || "").toLowerCase();

if (moedaEsperada && moedaRecebida && moedaEsperada !== moedaRecebida) {
  console.log("🚨 Moeda divergente:", moedaRecebida, moedaEsperada);
  await client.query("ROLLBACK");
  return res.status(200).send("ok");
}

if (valorEsperado > 0 && Math.abs(Number(valorPago) - Number(valorEsperado)) > 0.01) {
  console.log("🚨 Valor divergente", valorPago, valorEsperado);
  await client.query("ROLLBACK");
  return res.status(200).send("ok");
}

    console.log("Valor validado");

    /* =====================================================
       MIDIA
    ===================================================== */

    if (tipoPagamento === "conteudo" || tipoPagamento === "conteudo_cartao") {
      console.log("💰 Processando compra de mídia");

      const conteudoRes = await client.query(
        `
        SELECT preco
        FROM messages
        WHERE id = $1
        LIMIT 1
        `,
        [message_id]
      );

      if (!conteudoRes.rowCount) {
        console.log("🚨 mensagem não encontrada:", message_id);
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      const valorBase = Number(Number(conteudoRes.rows[0].preco).toFixed(2));
      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valorBruto = valorBase;

      const valores = await calcularValores({
        modelo_id,
        valor_bruto: valorBase,
        taxa_gateway: taxaGateway
      });

      const taxaCambioMeta = Number(metadata?.taxa_cambio) || null;
      const currencyPago = String(pagamento?.currency || metadata?.currency || 'brl').toLowerCase();
      const valorTotalBrl = taxaCambioMeta
        ? Number((valorPago * taxaCambioMeta).toFixed(2))
        : valorPago;

      await client.query(
        `
        INSERT INTO conteudo_pacotes (
          message_id,
          cliente_id,
          modelo_id,
          preco,
          valor_base,
          valor_total,
          status,
          metodo_pagamento,
          pago_em,
          currency,
          valor_cobrado,
          taxa_cambio
        )
        VALUES ($1,$2,$3,$4,$4,$5,'pago',$6,NOW(),$7,$8,$9)
        ON CONFLICT (message_id,cliente_id)
        DO UPDATE SET
          status='pago',
          metodo_pagamento=$6,
          pago_em=NOW(),
          valor_total=$5,
          currency=$7,
          valor_cobrado=$8,
          taxa_cambio=$9
        `,
        [
          message_id,
          cliente_id,
          modelo_id,
          valorBase,
          valorTotalBrl,
          metodoPagamento,
          currencyPago,
          valorPago,
          taxaCambioMeta
        ]
      );

      const conteudo_ids =
        await marcarConteudoComoLiberadoPorPagamento(client, {
          message_id,
          cliente_id,
          modelo_id
        });

      await client.query(
        `
        INSERT INTO transacoes_agency (
          modelo_id,
          cliente_id,
          tipo,
          valor_bruto,
          valor_modelo,
          agency_fee,
          velvet_fee,
          taxa_gateway,
          status,
          created_at
        )
        VALUES (
          $1,$2,'midia',
          $3,$4,$5,$6,$7,'pago',NOW()
        )
        `,
        [
          modelo_id,
          cliente_id,
          valorBruto,
          Number(valores.valor_modelo || 0),
          Number(valores.agency_fee || 0),
          Number(valores.velvet_fee || 0),
          taxaGateway
        ]
      );

      dadosParaEmitir = {
        tipo: "conteudo",
        cliente_id,
        modelo_id,
        message_id,
        conteudo_ids
      };

      fluxoProcessado = true;
      console.log("✅ Conteúdo atualizado com sucesso");
    }

    /* =====================================================
       PREMIUM
    ===================================================== */

    if (
      tabelaPagamento === "premium_unlocks" ||
      ["premium", "premium_cartao"].includes(tipoPagamento)
    ) {
      console.log("💎 Processando premium");

      if (!premium_post_id || !cliente_id || !modelo_id) {
        console.log("🚨 premium sem premium_post_id, cliente_id ou modelo_id");
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      const premiumPostRes = await client.query(
        `
        SELECT preco
        FROM premium_posts
        WHERE id = $1
        LIMIT 1
        `,
        [premium_post_id]
      );

      if (!premiumPostRes.rowCount) {
        console.log("🚨 premium_post não encontrado:", premium_post_id);
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      const valorBase = Number(Number(premiumPostRes.rows[0].preco).toFixed(2));

      if (!Number.isFinite(valorBase) || valorBase <= 0) {
        console.log("🚨 valorBase premium inválido:", valorBase);
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valorBruto = valorBase;

      const valores = await calcularValores({
        modelo_id,
        valor_bruto: valorBase,
        taxa_gateway: taxaGateway
      });

      await client.query(
        `
        UPDATE premium_unlocks
        SET status = 'pago',
            pago_em = NOW(),
            stripe_payment_intent_id = COALESCE($1, stripe_payment_intent_id),
            stripe_charge_id = COALESCE($2, stripe_charge_id),
            stripe_checkout_session_id = COALESCE($3, stripe_checkout_session_id),
            updated_at = NOW()
        WHERE id = $4
        `,
        [
          paymentIntentId,
          chargeId,
          eventType === "checkout.session.completed" ? obj.id : null,
          pagamento.id
        ]
      );

      await client.query(
        `
        INSERT INTO transacoes_agency (
          modelo_id,
          cliente_id,
          tipo,
          valor_bruto,
          valor_modelo,
          agency_fee,
          velvet_fee,
          taxa_gateway,
          status,
          created_at
        )
        VALUES (
          $1,$2,'midia',
          $3,$4,$5,$6,$7,'pago',NOW()
        )
        `,
        [
          modelo_id,
          cliente_id,
          valorBruto,
          Number(valores.valor_modelo || 0),
          Number(valores.agency_fee || 0),
          Number(valores.velvet_fee || 0),
          taxaGateway
        ]
      );

      fluxoProcessado = true;
      console.log("✅ Premium atualizado com sucesso");
    }

    /* =====================================================
       VIP
    ===================================================== */

    if (tipoPagamento === "vip" || tipoPagamento === "vip_cartao") {
      console.log("⭐ Processando VIP");

      const vipExistente = await client.query(
        `
        SELECT id, ativo, expiration_at
        FROM vip_subscriptions
        WHERE cliente_id = $1
          AND modelo_id = $2
        LIMIT 1
        FOR UPDATE
        `,
        [cliente_id, modelo_id]
      );

      const primeiraAssinatura = vipExistente.rowCount === 0;

      // valor_base_brl é sempre o preço original em BRL, independente da moeda cobrada
      let valorBase = Number(
        metadata.valor_base_brl ??
        metadata.valor_assinatura ??
        metadata.valor_base ??
        pagamento.valor_brl ??
        pagamento.valor ??
        0
      );

      if (!Number.isFinite(valorBase) || valorBase <= 0) {
        console.log("🚨 valorBase inválido:", valorBase);
        await client.query("ROLLBACK");
        return res.status(200).send("ok");
      }

      valorBase = Number(valorBase.toFixed(2));

      const taxaCambioVip = Number(metadata.taxa_cambio) || null;
      const taxaTransacao = Number(metadata.taxa_transacao || 0);
      const taxaPlataforma = Number(metadata.taxa_plataforma || 0);

      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valorBruto = valorBase;
      const valorTotalBrl = taxaCambioVip
        ? Number((valorPago * taxaCambioVip).toFixed(2))
        : valorPago;

      const valores = await calcularValores({
        modelo_id,
        valor_bruto: valorBase,
        taxa_gateway: taxaGateway
      });

      const valorModelo = Number(valores.valor_modelo || 0);
      const agencyFee = Number(valores.agency_fee || 0);
      const velvetFee = Number(valores.velvet_fee || 0);

      let novaExpiracao;

      if (
        vipExistente.rowCount > 0 &&
        vipExistente.rows[0].expiration_at &&
        new Date(vipExistente.rows[0].expiration_at) > new Date()
      ) {
        novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
        novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
      } else {
        novaExpiracao = new Date();
        novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
      }

      if (vipExistente.rowCount > 0) {
        await client.query(
          `
          UPDATE vip_subscriptions
          SET
            ativo = true,
            updated_at = NOW(),
            expiration_at = $3,
            valor_assinatura = $4,
            taxa_transacao = $5,
            taxa_plataforma = $6,
            valor_total = $7,
            recorrente = false,
            gateway_subscription_id = $8,
             aviso_7_dias_enviado = false,
             aviso_24h_enviado = false
          WHERE cliente_id = $1
            AND modelo_id = $2
          `,
          [
            cliente_id,
            modelo_id,
            novaExpiracao,
            valorBase,
            taxaTransacao,
            taxaPlataforma,
            valorTotalBrl,
            paymentIntentId || chargeId
          ]
        );
      } else {
        await client.query(
          `
          INSERT INTO vip_subscriptions (
            cliente_id,
            modelo_id,
            ativo,
            created_at,
            updated_at,
            expiration_at,
            valor_assinatura,
            taxa_transacao,
            taxa_plataforma,
            valor_total,
            recorrente,
            gateway_subscription_id
          )
          VALUES (
            $1, $2, true,
            NOW(), NOW(),
            $3, $4, $5, $6, $7,
            false, $8
          )
          `,
          [
            cliente_id,
            modelo_id,
            novaExpiracao,
            valorBase,
            taxaTransacao,
            taxaPlataforma,
            valorTotalBrl,
            paymentIntentId || chargeId
          ]
        );
      }

      await client.query(
        `
        INSERT INTO transacoes_agency (
          modelo_id,
          cliente_id,
          tipo,
          valor_bruto,
          valor_modelo,
          agency_fee,
          velvet_fee,
          taxa_gateway,
          status,
          created_at
        )
        VALUES (
          $1,$2,'assinatura',
          $3,$4,$5,$6,$7,'pago',NOW()
        )
        `,
        [
          modelo_id,
          cliente_id,
          valorBruto,
          valorModelo,
          agencyFee,
          velvetFee,
          taxaGateway
        ]
      );

      if (primeiraAssinatura) {
        await client.query(
          `
          INSERT INTO messages (
            cliente_id,
            modelo_id,
            text,
            sender,
            tipo,
            created_at,
            lida,
            visto,
            deletada
          )
          VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)
          `,
          [
            cliente_id,
            modelo_id,
            "Oii!! Bem vindo(a), qual seu nome?🥰"
          ]
        );
      }

      dadosParaEmitir = {
        tipo: "vip",
        cliente_id,
        modelo_id
      };

      fluxoProcessado = true;
      console.log("✅ Bloco VIP finalizado com sucesso");
    }

    /* =====================================================
       MARCAR PAGAMENTO COMO PAGO
    ===================================================== */

    if (!fluxoProcessado) {
      console.log("🚨 Nenhum fluxo de negócio foi processado para este pagamento:", {
        tabelaPagamento,
        tipoPagamento,
        metadata
      });
      await client.query("ROLLBACK");
      return res.status(200).send("ok");
    }

    console.log("Marcando pagamento como pago");

    if (tabelaPagamento === "pagamentos_cartao") {
      const taxaCambioWebhook = Number(metadata?.taxa_cambio) || null;
      const valorBrlWebhook = taxaCambioWebhook
        ? Number((valorPago * taxaCambioWebhook).toFixed(2))
        : valorPago;

      await client.query(
        `
        UPDATE pagamentos_cartao
        SET status = 'pago',
            pago_em = NOW(),
            updated_at = NOW(),
            stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
            stripe_charge_id = COALESCE($3, stripe_charge_id),
            stripe_checkout_session_id = COALESCE($4, stripe_checkout_session_id),
            valor_brl = COALESCE(valor_brl, $5),
            taxa_cambio = COALESCE(taxa_cambio, $6)
        WHERE id = $1
        `,
        [
          pagamento.id,
          paymentIntentId,
          chargeId,
          eventType === "checkout.session.completed" ? obj.id : null,
          valorBrlWebhook,
          taxaCambioWebhook
        ]
      );
    } else if (tabelaPagamento === "premium_unlocks") {
      console.log("premium_unlocks já foi atualizado no bloco premium");
    }

    console.log("Pagamento atualizado");

    /* =====================================================
       COMMIT
    ===================================================== */

    await client.query("COMMIT");
    console.log("COMMIT realizado");

    /* =====================================================
       SOCKET
    ===================================================== */

    try {
      console.log("Emitindo eventos socket");

      if (dadosParaEmitir?.tipo === "conteudo") {
        const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;

        io.to(sala).emit("conteudoLiberado", {
          message_id: Number(dadosParaEmitir.message_id),
          conteudo_ids: dadosParaEmitir.conteudo_ids || []
        });
      }

      if (dadosParaEmitir?.tipo === "vip") {
        const sala = `chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`;

        io.to(sala).emit("vipAtivado", {
          cliente_id: Number(dadosParaEmitir.cliente_id),
          modelo_id: Number(dadosParaEmitir.modelo_id)
        });
      }

    } catch (e) {
      console.error("Erro emitir socket:", e);
    }

    console.log("✅ PAGAMENTO FINALIZADO");
    return res.status(200).send("ok");

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("🔥 ERRO WEBHOOK STRIPE:", err);
    return res.status(500).send("erro");
  } finally {
    client.release();
    console.log("🔚 conexão liberada");
  }
});

// ===============================
// ROTAS GLOBAIS
// ===============================

app.use(express.json());
const { router: servercontentRouter, calcularValores } = require('./servercontent');
app.use("/api", servercontentRouter);
app.set("calcularValores", calcularValores); // disponível no webhook Asaas
const adminDashboardRouter = require('./routes/adminDashboard');
const agencyDashboardRouter = require('./routes/agencyDashboard');
const adminEmailRouter = require('./routes/adminEmail');
const suporteRouter = require('./routes/suporte');
const authAdmin = require('./middleware/authAdmin');

app.get("/api/stripe/pk", (req, res) => {
  const key = process.env.STRIPE_PUBLIC_KEY || "";
  if (!key) return res.status(500).json({ error: "Chave pública Stripe não configurada." });
  res.json({ key });
});

app.use("/admin/dashboard", adminDashboardRouter);
app.use('/agency/dashboard', agencyDashboardRouter);
app.use('/api/admin/email', auth, authAdmin, adminEmailRouter);
app.use('/api/suporte', suporteRouter);
app.set('io', io);
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use(express.static(path.join(__dirname, "public")));
app.use("/icons", express.static(path.join(__dirname, "icons")));
app.use(express.urlencoded({ extended: true }));
app.use("/app", express.static("app"));
app.use(express.static("public"));
app.use((req, res, next) => {
  console.log("➡️ REQ:", req.method, req.url);
  next();
});
app.use(compression());



app.use((err, req, res, next) => {

  const isProduction = process.env.NODE_ENV === "production";

  console.error("🔥 ERRO GLOBAL:", {
    message: err.message,
    path: req.originalUrl,
    method: req.method,
    stack: isProduction ? undefined : err.stack
  });

  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: err.message
    });
  }

  return res.status(500).json({
    error: "Erro interno do servidor"
  });
});

process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled Rejection:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught Exception:", err);
  process.exit(1);
});

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

// app.use("/api", manutencaoClientes);
// const MANUTENCAO_CLIENTES = true;
// const EXCECOES_MANUTENCAO = [
//   "emersondoido@gmail.com",
//   "emersondoido92@gmail.com"
// ];

// ===============================
// FUNÇÕES
// ===============================

async function marcarConteudoComoLiberadoPorPagamento(
  client,
  { message_id, cliente_id, modelo_id }
) {
  const mid = Number(message_id);
  const cid = Number(cliente_id);
  const moid = Number(modelo_id);

  if (!Number.isInteger(mid) || mid <= 0) throw new Error("message_id inválido");
  if (!Number.isInteger(cid) || cid <= 0) throw new Error("cliente_id inválido");
  if (!Number.isInteger(moid) || moid <= 0) throw new Error("modelo_id inválido");

  const up = await client.query(
`
UPDATE messages
SET visto = true,
    updated_at = NOW()
WHERE id = $1
AND cliente_id = $2
AND modelo_id = $3
RETURNING id
`,
[mid, cid, moid]
);

  if (!up.rowCount) {
    throw new Error("messages não encontrada / não pertence ao cliente/modelo");
  }

  const conteudos = await client.query(
    `
    SELECT mc.conteudo_id
      FROM messages_conteudos mc
     WHERE mc.message_id = $1
    `,
    [mid]
  );

  return conteudos.rows
    .map((r) => Number(r.conteudo_id))
    .filter((n) => Number.isInteger(n) && n > 0);
}

// ===========================
// EMAIL E CPF VALIDO
// ===========================

function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validarCPF(cpf) {
const cpfLimpo = String(cpf || "").replace(/\D/g, "");

  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

  let soma = 0;
  let resto;

  for (let i = 1; i <= 9; i++)
    soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);

  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;
  if (resto !== parseInt(cpf.substring(9, 10))) return false;

  soma = 0;
  for (let i = 1; i <= 10; i++)
    soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);

  resto = (soma * 10) % 11;
  if (resto === 10 || resto === 11) resto = 0;

  return resto === parseInt(cpf.substring(10, 11));
}

// ===========================
// MSG NÃO LIDA 
// ===========================

async function buscarUnreadCliente(cliente_id) {

  if (!cliente_id || !Number.isInteger(cliente_id)) {
    throw new Error("cliente_id inválido");
  }

  const result = await db.query(
    `
    SELECT u.modelo_id
    FROM unread u
    JOIN vip_subscriptions v
      ON v.cliente_id = u.cliente_id
     AND v.modelo_id  = u.modelo_id
     AND v.ativo = true
     AND v.expiration_at > NOW()
    WHERE u.cliente_id  = $1
      AND u.unread_for  = 'cliente'
      AND u.has_unread  = true
    `,
    [cliente_id]
  );

  return result.rows.map(r => r.modelo_id);
}

async function buscarUnreadModelo(modelo_id) {

  if (!modelo_id || !Number.isInteger(modelo_id)) {
    throw new Error("modelo_id inválido");
  }

  const result = await db.query(
    `
    SELECT u.cliente_id
    FROM unread u
    JOIN vip_subscriptions v
      ON v.cliente_id = u.cliente_id
     AND v.modelo_id  = u.modelo_id
     AND v.ativo = true
     AND v.expiration_at > NOW()
    WHERE u.modelo_id  = $1
      AND u.unread_for = 'modelo'
      AND u.has_unread = true
    `,
    [modelo_id]
  );

  return result.rows.map(r => r.cliente_id);
}

// ===========================
// ATUALIZACAO INBOX
// ===========================

function emitirInboxUpdate(io, { cliente_id, modelo_id, sender, text, created_at }) {
  const payload = {
    cliente_id,
    modelo_id,
    ultima_mensagem: text,
    ultima_mensagem_em: created_at,
    sender,
    visto: false,
    lida: false
  };

  io.to(`inbox_modelo_${modelo_id}`).emit("inboxMessage", payload);
  io.to(`inbox_cliente_${cliente_id}`).emit("inboxMessage", payload);
}

// ===========================
// UPLOAD MIDIAS
// ===========================

// ===========================
// UPLOAD SUPABASE STORAGE
// ===========================

async function uploadToSupabase(buffer, mimetype, originalname, bucket) {
  if (!supabaseStorage) throw new Error("Supabase Storage não configurado");
  const ext = (originalname || "file").split(".").pop().split("?")[0] || "bin";
  const caminho = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabaseStorage.storage
    .from(bucket)
    .upload(caminho, buffer, { contentType: mimetype, upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabaseStorage.storage
    .from(bucket)
    .getPublicUrl(caminho);
  return { url: publicUrl, thumb_url: publicUrl };
}

async function uploadCloudflareImage(fileBuffer, filename, bucket = "feed") {
  const result = await uploadToSupabase(fileBuffer, "image/jpeg", filename, bucket);
  return { variants: [result.url] };
}

async function uploadVideoCloudflare(buffer, filename, bucket = "feed") {
  const result = await uploadToSupabase(buffer, "video/mp4", filename, bucket);
  return { uid: null, url: result.url, thumbnail: result.thumb_url, _publicUrl: result.url };
}

// ===========================
// MARCAR MIDIA VISTA
// ===========================

async function buscarConteudosJaPossuidosPorCliente(client, { cliente_id, modelo_id }) {
  const result = await client.query(
    `
    SELECT DISTINCT mc.conteudo_id
    FROM messages m
    JOIN messages_conteudos mc
      ON mc.message_id = m.id
    WHERE m.modelo_id = $1
      AND m.cliente_id = $2
      AND m.visto = true
      AND m.deletada IS NOT TRUE
    `,
    [modelo_id, cliente_id]
  );

  return new Set(
    result.rows
      .map(r => Number(r.conteudo_id))
      .filter(id => Number.isInteger(id) && id > 0)
  );
}

// ===========================
// ENVIAR PUSH
// ===========================

async function enviarPush(subscription, mensagem, url = "/inbox.html", remetente = "Nova mensagem") {
  const payload = JSON.stringify({
    title: remetente,
    body: mensagem,
    url
  });
  await webpush.sendNotification(subscription, payload);
}

async function enviarFCM(deviceToken, titulo, mensagem, url) {
  if (!admin.apps.length) return;
  await admin.messaging().send({
    token: deviceToken,
    notification: { title: titulo, body: mensagem },
    data: { url: url || "/inbox.html" },
    android: { priority: "high" },
    apns: { payload: { aps: { sound: "default" } } }
  });
}

async function notificarNovaMensagem(userIdDestino, textoMensagem, url = "/inbox.html", remetente = "Nova mensagem") {
  const erros = [];

  // Web push (navegador)
  if (process.env.VAPID_SUBJECT && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      const subRes = await db.query(
        `SELECT subscription_json FROM push_subscriptions WHERE user_id = $1 LIMIT 1`,
        [userIdDestino]
      );
      if (subRes.rowCount > 0) {
        await enviarPush(subRes.rows[0].subscription_json, textoMensagem, url, remetente);
        console.log("Web push enviado para user_id:", userIdDestino);
      }
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [userIdDestino]);
      } else {
        erros.push(err);
      }
    }
  }

  // FCM push (app Android/iOS)
  if (admin.apps.length) {
    try {
      const tokRes = await db.query(
        `SELECT token, platform FROM device_push_tokens WHERE user_id = $1`,
        [userIdDestino]
      );
      for (const row of tokRes.rows) {
        try {
          await enviarFCM(row.token, remetente, textoMensagem, url);
          console.log(`FCM enviado (${row.platform}) para user_id:`, userIdDestino);
        } catch (err) {
          if (err.code === "messaging/registration-token-not-registered") {
            await db.query(
              `DELETE FROM device_push_tokens WHERE user_id = $1 AND platform = $2`,
              [userIdDestino, row.platform]
            );
          } else {
            erros.push(err);
          }
        }
      }
    } catch (err) {
      erros.push(err);
    }
  }

  if (erros.length) {
    console.error("Erros ao enviar push:", erros);
  }
}

// ===========================
// CONVERSAO MOEDA R$/$
// ===========================
let _rateCache = { rate: null, at: 0 };

async function getBRLtoUSDRate() {
  const age = Date.now() - _rateCache.at;
  if (_rateCache.rate && age < 4 * 60 * 60 * 1000) return _rateCache.rate;
  const resp = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
  if (!resp.ok) throw new Error("Falha ao buscar taxa de câmbio");
  const data = await resp.json();
  const rate = data.rates?.BRL;
  if (!rate) throw new Error("Taxa BRL não encontrada na resposta de câmbio");
  _rateCache = { rate, at: Date.now() };
  return rate;
}

async function calcAsaasAmount(valorBRL, currency) {
  if (currency !== "usd") {
    return { valorReais: valorBRL, valorConvertido: valorBRL, taxaCambio: null };
  }
  const rate = await getBRLtoUSDRate();
  const valorUSD = valorBRL / rate;
  return {
    valorReais: valorBRL,
    valorConvertido: Number(valorUSD.toFixed(2)),
    taxaCambio: rate
  };
}

/**
 * Calcula a taxa de transação Asaas: R$ 1,99 fixo + 10% do valor base.
 * Garante valorTotal >= R$ 5,00 (mínimo exigido pela Asaas).
 * @param {number} valorBase  Valor do produto já com desconto aplicado (BRL).
 * @returns {{ taxaTransacao: number, taxaPlataforma: number, valorTotal: number }}
 */
function calcTaxaAsaas(valorBase) {
  const taxaCalculada = Number((1.99 + valorBase * 0.10).toFixed(2));
  const totalBruto    = Number((valorBase + taxaCalculada).toFixed(2));

  // Asaas exige mínimo de R$ 5,00 por cobrança
  const MINIMO_ASAAS  = 5.00;
  const valorTotal    = Number(Math.max(MINIMO_ASAAS, totalBruto).toFixed(2));
  const taxaTransacao = Number((valorTotal - valorBase).toFixed(2));

  return { taxaTransacao, taxaPlataforma: 0, valorTotal };
}

function calcTaxaStripe(valorBase) {
  const taxaTransacao = Number((valorBase * 0.15).toFixed(2));
  const valorTotal    = Number((valorBase + taxaTransacao).toFixed(2));
  return { taxaTransacao, taxaPlataforma: 0, valorTotal };
}

// ── Asaas helpers ──────────────────────────────────────────────────────────
const ASAAS_BASE = process.env.NODE_ENV === "production"
  ? "https://api.asaas.com/v3"
  : "https://sandbox.asaas.com/api/v3";

async function asaasRequest(method, path, body) {
  const res = await axios({
    method,
    url: `${ASAAS_BASE}${path}`,
    data: body,
    headers: {
      "access_token": process.env.ASAAS_API_KEY,
      "Content-Type": "application/json",
      "User-Agent": "Velvet/1.0"
    }
  });
  return res.data;
}

const ABACATEPAY_BASE = "https://api.abacatepay.com/v2";

async function abacatePayRequest(method, path, body) {
  console.log(`[AbacatePay] ${method} ${path} body:`, JSON.stringify(body));
  console.log(`[AbacatePay] API_KEY set:`, !!process.env.ABACATEPAY_API_KEY);
  const res = await axios({
    method,
    url: `${ABACATEPAY_BASE}${path}`,
    data: body,
    headers: {
      "Authorization": `Bearer ${process.env.ABACATEPAY_API_KEY}`,
      "Content-Type": "application/json"
    }
  });
  return res.data;
}

async function criarOuBuscarClienteAsaas(cpfCnpj, nome, email, telefone) {
  try {
    const search = await asaasRequest("GET", `/customers?cpfCnpj=${cpfCnpj}&limit=1`);
    if (search.data?.length > 0) return search.data[0].id;
  } catch (_) {}
  const customer = await asaasRequest("POST", "/customers", {
    name: nome,
    cpfCnpj,
    email,
    mobilePhone: telefone || undefined
  });
  return customer.id;
}

// function manutencaoClientes(req, res, next) {
//   if (!MANUTENCAO_CLIENTES) return next();
//   if (!req.user) return next();
//   if (req.user.role !== "cliente") return next();
//   if (EXCECOES_MANUTENCAO.includes(req.user.email)) {
//     return next();
//   }
//   return res.status(503).json({
//     error: "Plataforma em atualização. Aguarde alguns minutos e tente novamente."
//   });
// }

// // 📦 FEED CANÔNICO (FONTE ÚNICA)
// async function buscarFeedCompletoPorModeloId(modelo_id) {
//   const result = await db.query(
//     `
//     SELECT
//       id,
//       url,
//       tipo,
//       tipo_conteudo,
//       preco,
//       descricao,
//       thumbnail_url,
//       criado_em
//     FROM conteudos
//     WHERE modelo_id = $1
//       AND ativo = TRUE   -- 🔥 FILTRO QUE FALTAVA
//       AND (
//         tipo_conteudo != 'venda'
//         OR (tipo_conteudo = 'venda' AND COALESCE(preco, 0) > 0)
//       )
//     ORDER BY id DESC
//     `,
//     [modelo_id]
//   );

//   return result.rows;
// }


// ===========================
// SOCKETS
// ===========================

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;

    if (!token) {
      return next(new Error("Sem token"));
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded?.id || !decoded?.role) {
      return next(new Error("Token inválido"));
    }

    socket.user = {
      id: decoded.id,
      role: decoded.role
    };

    return next();
  } catch (err) {
    console.error("❌ Erro auth socket:", err);
    return next(new Error("Falha na autenticação"));
  }
});

io.on("connection", (socket) => {
  console.log("🔥 Socket conectado:", socket.id, socket.user);

  // ─── SUPORTE AO CLIENTE ──────────────────────────────────────────────────
  socket.on("suporte:entrar", ({ conversa_id }) => {
    if (conversa_id) socket.join(`suporte_${conversa_id}`);
  });

  socket.on("suporte:admin_entrar", () => {
    if (socket.user?.role === "admin") socket.join("suporte_admin");
  });

  socket.on("suporte:admin_entrar_conversa", ({ conversa_id }) => {
    if (socket.user?.role === "admin" && conversa_id) {
      socket.join(`suporte_${conversa_id}`);
    }
  });

  socket.on("suporte:typing", ({ conversa_id }) => {
    if (socket.user?.role === "admin" && conversa_id) {
      io.to(`suporte_${conversa_id}`).emit("suporte:typing");
    }
  });
  // ────────────────────────────────────────────────────────────────────────

  socket.on("loginModelo", async () => {
    try {
      if (!socket.user || socket.user.role !== "modelo") {
        return socket.disconnect();
      }

      const result = await db.query(
        "SELECT id FROM modelos WHERE user_id = $1",
        [socket.user.id]
      );

      if (result.rowCount === 0) return;

      const modeloIdReal = result.rows[0].id;

      socket.modelo_id = modeloIdReal;

      if (!onlineModelos.has(modeloIdReal)) {
        onlineModelos.set(modeloIdReal, new Set());
      }

      onlineModelos.get(modeloIdReal).add(socket.id);

      console.log("🟣 Modelo online:", modeloIdReal);
    } catch (err) {
      console.error("❌ Erro loginModelo:", err);
    }
  });




// 📥 ENTRAR NA SALA DO CHAT

socket.on("joinChat", async ({ cliente_id, modelo_id } = {}, callback) => {
    try {
      if (!socket.user) {
        callback?.({ ok: false, error: "Usuário não autenticado" });
        return;
      }

      cliente_id = Number(cliente_id);
      modelo_id = Number(modelo_id);

      if (
        !Number.isInteger(cliente_id) ||
        !Number.isInteger(modelo_id)
      ) {
        callback?.({ ok: false, error: "IDs inválidos" });
        return;
      }

      if (socket.user.role === "cliente") {
        const clienteRes = await db.query(
          "SELECT id FROM clientes WHERE user_id = $1",
          [socket.user.id]
        );

        if (clienteRes.rowCount === 0) {
          callback?.({ ok: false, error: "Cliente não encontrado" });
          return;
        }

        const clienteIdReal = clienteRes.rows[0].id;

        if (clienteIdReal !== cliente_id) {
          callback?.({ ok: false, error: "Cliente inválido" });
          return;
        }

        // 🔒 VIP check — cliente só pode entrar na sala se tiver VIP ativo
        const vipRes = await db.query(
          `SELECT 1 FROM vip_subscriptions
           WHERE cliente_id = $1 AND modelo_id = $2
             AND ativo = true AND expiration_at > NOW()
           LIMIT 1`,
          [clienteIdReal, modelo_id]
        );
        if (vipRes.rowCount === 0) {
          callback?.({ ok: false, error: "vip_required" });
          return;
        }

      } else if (socket.user.role === "modelo") {
        const modeloRes = await db.query(
          "SELECT id FROM modelos WHERE user_id = $1",
          [socket.user.id]
        );

        if (modeloRes.rowCount === 0) {
          callback?.({ ok: false, error: "Modelo não encontrado" });
          return;
        }

        const modeloIdReal = modeloRes.rows[0].id;

        if (modeloIdReal !== modelo_id) {
          callback?.({ ok: false, error: "Modelo inválido" });
          return;
        }
      } else {
        callback?.({ ok: false, error: "Role inválida" });
        return;
      }

      const sala = `chat_${cliente_id}_${modelo_id}`;
      socket.join(sala);

      console.log("🟪 Entrou na sala segura:", sala);
      callback?.({ ok: true, sala });
    } catch (err) {
      console.error("❌ Erro no joinChat:", err);
      callback?.({ ok: false, error: "Erro interno ao entrar no chat" });
    }
  });


socket.on("joinInbox", async (payload, callback) => {
    try {
      if (typeof payload === "function") {
        callback = payload;
        payload = {};
      }

      if (!socket.user) {
        callback?.({ ok: false, error: "Usuário não autenticado" });
        return;
      }

      if (socket.user.role === "cliente") {
        const clienteRes = await db.query(
          "SELECT id FROM clientes WHERE user_id = $1",
          [socket.user.id]
        );

        if (!clienteRes.rowCount) {
          callback?.({ ok: false, error: "Cliente não encontrado" });
          return;
        }

        const cliente_id = clienteRes.rows[0].id;
        const sala = `inbox_cliente_${cliente_id}`;

        socket.join(sala);
        console.log("📬 Inbox cliente conectada:", sala);
        callback?.({ ok: true, sala, tipo: "cliente" });
        return;
      }

      if (socket.user.role === "modelo") {
        const modeloRes = await db.query(
          "SELECT id FROM modelos WHERE user_id = $1",
          [socket.user.id]
        );

        if (!modeloRes.rowCount) {
          callback?.({ ok: false, error: "Modelo não encontrado" });
          return;
        }

        const modelo_id = modeloRes.rows[0].id;
        const sala = `inbox_modelo_${modelo_id}`;

        socket.join(sala);
        console.log("📬 Inbox modelo conectada:", sala);
        callback?.({ ok: true, sala, tipo: "modelo" });
        return;
      }

      callback?.({ ok: false, error: "Role inválida" });
    } catch (err) {
      console.error("❌ Erro no joinInbox:", err);
      callback?.({ ok: false, error: "Erro interno ao entrar na inbox" });
    }
  });

   socket.on("loginCliente", async () => {
    try {
      if (!socket.user || socket.user.role !== "cliente") {
        return socket.disconnect();
      }

      const clienteRes = await db.query(
        "SELECT id FROM clientes WHERE user_id = $1",
        [socket.user.id]
      );

      if (!clienteRes.rowCount) return;

      const clienteIdReal = clienteRes.rows[0].id;
      socket.cliente_id = clienteIdReal;

      if (!onlineClientes.has(clienteIdReal)) {
        onlineClientes.set(clienteIdReal, new Set());
      }

      onlineClientes.get(clienteIdReal).add(socket.id);

      console.log("🟢 Cliente online:", clienteIdReal, socket.id);
      
    } catch (err) {
      console.error("❌ Erro loginCliente:", err);
    }
  });

  socket.on("disconnect", async () => {
    console.log("🔴 Socket desconectado:", socket.id);

    try {
      if (socket.cliente_id) {
        const set = onlineClientes.get(socket.cliente_id);

        if (set) {
          set.delete(socket.id);

          if (set.size === 0) {
            onlineClientes.delete(socket.cliente_id);

            await db.query(
              `UPDATE clientes SET last_seen = NOW() WHERE id = $1`,
              [socket.cliente_id]
            );

            console.log("⚫ Cliente offline:", socket.cliente_id);
          }
        }
      }

      if (socket.modelo_id) {
        const set = onlineModelos.get(socket.modelo_id);

        if (set) {
          set.delete(socket.id);

          if (set.size === 0) {
            onlineModelos.delete(socket.modelo_id);

            await db.query(
              `UPDATE modelos SET last_seen = NOW() WHERE id = $1`,
              [socket.modelo_id]
            );

            console.log("⚫ Modelo offline:", socket.modelo_id);
          }
        }
      }
    } catch (err) {
      console.error("❌ Erro no disconnect:", err);
    }
  });

// 💬 ENVIAR MENSAGEM (ÚNICO)
socket.on("sendMessage", async (data, callback) => {
  const { cliente_id, modelo_id, text, tempId } = data || {};

  const clienteIdNum = Number(cliente_id);
  const modeloIdNum = Number(modelo_id);

  if (!socket.user) {
    console.log("❌ Socket sem usuário");
    callback?.({ ok: false });
    return;
  }

  if (
    !Number.isInteger(clienteIdNum) ||
    !Number.isInteger(modeloIdNum) ||
    !text ||
    typeof text !== "string"
  ) {
    console.log("❌ sendMessage inválido");
    callback?.({ ok: false });
    return;
  }

  try {
    // 🔒 VALIDAR IDENTIDADE REAL
    if (socket.user.role === "cliente") {
      const clienteRes = await db.query(
        "SELECT id FROM clientes WHERE user_id = $1",
        [socket.user.id]
      );

      if (!clienteRes.rowCount) {
        callback?.({ ok: false });
        return;
      }

      const clienteIdReal = clienteRes.rows[0].id;

      if (clienteIdReal !== clienteIdNum) {
        callback?.({ ok: false });
        return;
      }

      // 🔒 VIP check — cliente só pode enviar mensagem se tiver VIP ativo
      const vipCheck = await db.query(
        `SELECT 1 FROM vip_subscriptions
         WHERE cliente_id = $1 AND modelo_id = $2
           AND ativo = true AND expiration_at > NOW()
         LIMIT 1`,
        [clienteIdReal, modeloIdNum]
      );
      if (vipCheck.rowCount === 0) {
        callback?.({ ok: false, error: "vip_required" });
        return;
      }

    } else if (socket.user.role === "modelo") {
      const modeloRes = await db.query(
        "SELECT id FROM modelos WHERE user_id = $1",
        [socket.user.id]
      );

      if (!modeloRes.rowCount) {
        callback?.({ ok: false });
        return;
      }

      const modeloIdReal = modeloRes.rows[0].id;

      if (modeloIdReal !== modeloIdNum) {
        callback?.({ ok: false });
        return;
      }

    } else {
      callback?.({ ok: false });
      return;
    }

    const sala = `chat_${clienteIdNum}_${modeloIdNum}`;
    const sender = socket.user.role;
    const unreadFor = sender === "cliente" ? "modelo" : "cliente";

    // 1️⃣ SALVAR NO BANCO
    const result = await db.query(
      `
      INSERT INTO messages
        (cliente_id, modelo_id, sender, tipo, text, visto)
      VALUES ($1, $2, $3, 'texto', $4, false)
      RETURNING id, created_at
      `,
      [clienteIdNum, modeloIdNum, sender, text]
    );

    const message = result.rows[0];

    // 2️⃣ MARCAR COMO NÃO LIDA
    await db.query(
      `
      INSERT INTO unread (cliente_id, modelo_id, unread_for, has_unread)
      VALUES ($1, $2, $3, true)
      ON CONFLICT (cliente_id, modelo_id)
      DO UPDATE SET
        unread_for = EXCLUDED.unread_for,
        has_unread = true
      `,
      [clienteIdNum, modeloIdNum, unreadFor]
    );

    // 3️⃣ REALTIME CHAT
    io.to(sala).emit("newMessage", {
      id: message.id,
      tempId,
      cliente_id: clienteIdNum,
      modelo_id: modeloIdNum,
      sender,
      tipo: "texto",
      text,
      visto: false,
      created_at: message.created_at
    });

    // 4️⃣ ATUALIZAR INBOX
    emitirInboxUpdate(io, {
      cliente_id: clienteIdNum,
      modelo_id: modeloIdNum,
      sender,
      text,
      created_at: message.created_at
    });

// 5️⃣ PUSH NOTIFICATION
try {
  let userIdDestino = null;
  let pushUrl = "/inbox.html";
  let remetente = "Nova mensagem";

  if (sender === "cliente") {
    const modeloDestinoRes = await db.query(
      `SELECT user_id FROM modelos WHERE id = $1 LIMIT 1`,
      [modeloIdNum]
    );
    userIdDestino = modeloDestinoRes.rows[0]?.user_id || null;
    pushUrl = "/inbox.html";

    const nomeRes = await db.query(
      `SELECT nome FROM clientes WHERE id = $1 LIMIT 1`,
      [clienteIdNum]
    );
    remetente = nomeRes.rows[0]?.nome || "Cliente";

  } else if (sender === "modelo") {
    const clienteDestinoRes = await db.query(
      `SELECT user_id FROM clientes WHERE id = $1 LIMIT 1`,
      [clienteIdNum]
    );
    userIdDestino = clienteDestinoRes.rows[0]?.user_id || null;
    pushUrl = "/inboxc.html";

    const nomeRes = await db.query(
      `SELECT nome_exibicao FROM modelos WHERE id = $1 LIMIT 1`,
      [modeloIdNum]
    );
    remetente = nomeRes.rows[0]?.nome_exibicao || "Mensagem";
  }

  console.log("[push] sender:", sender);
  console.log("[push] cliente_id:", clienteIdNum);
  console.log("[push] modelo_id:", modeloIdNum);
  console.log("[push] userIdDestino:", userIdDestino);

  if (userIdDestino) {
    await notificarNovaMensagem(
      userIdDestino,
      text.trim() ? text.trim().slice(0, 120) : "Você recebeu uma nova mensagem",
      pushUrl,
      remetente
    );
  }
} catch (pushErr) {
  console.error("Erro ao disparar push de mensagem:", pushErr);
}
    callback?.({
      ok: true,
      message_id: message.id,
      tempId
    });

  } catch (err) {
    console.error("🔥 ERRO AO SALVAR MENSAGEM:", err);
    callback?.({ ok: false });
  }
});

// 📜 HISTÓRICO DO CHAT

socket.on("getHistory", async ({ cliente_id, modelo_id, offset = 0, limit = 20 } = {}) => {
  const clienteIdNum = Number(cliente_id);
  const modeloIdNum = Number(modelo_id);
  const offsetNum = Number(offset);
  const limitNum = Number(limit);

  if (!socket.user) return;

  if (
    !Number.isInteger(clienteIdNum) ||
    !Number.isInteger(modeloIdNum) ||
    !Number.isInteger(offsetNum) ||
    !Number.isInteger(limitNum)
  ) return;

  try {
    // 🔒 VALIDAR IDENTIDADE REAL
    if (socket.user.role === "cliente") {
      const clienteRes = await db.query(
        "SELECT id FROM clientes WHERE user_id = $1",
        [socket.user.id]
      );

      if (!clienteRes.rowCount) return;

      const clienteIdReal = clienteRes.rows[0].id;

      if (clienteIdReal !== clienteIdNum) return;

    } else if (socket.user.role === "modelo") {
      const modeloRes = await db.query(
        "SELECT id FROM modelos WHERE user_id = $1",
        [socket.user.id]
      );

      if (!modeloRes.rowCount) return;

      const modeloIdReal = modeloRes.rows[0].id;

      if (modeloIdReal !== modeloIdNum) return;

    } else {
      return;
    }

    // 1️⃣ LIMPAR UNREAD
    await db.query(
      `
      UPDATE unread
      SET has_unread = false
      WHERE cliente_id = $1
        AND modelo_id = $2
        AND unread_for = $3
      `,
      [clienteIdNum, modeloIdNum, socket.user.role]
    );

     if (socket.user.role === "modelo") {
       await db.query(
    `UPDATE messages
     SET lida = true
     WHERE cliente_id = $1
       AND modelo_id = $2
       AND sender = 'cliente'
       AND lida = false`,
    [clienteIdNum, modeloIdNum]
  );
      io.to(`inbox_modelo_${modeloIdNum}`).emit("unreadUpdate");
    }

    // 2️⃣ MARCAR COMO LIDA (SE CLIENTE)
    if (socket.user.role === "cliente") {
      await db.query(
        `
        UPDATE messages
        SET lida = true
        WHERE cliente_id = $1
          AND modelo_id = $2
          AND sender = 'modelo'
          AND lida = false
        `,
        [clienteIdNum, modeloIdNum]
      );

       await db.query(
    `
    UPDATE clientes
    SET last_seen = NOW()
    WHERE id = $1
    `,
    [clienteIdNum]
  );

      io.to(`inbox_modelo_${modeloIdNum}`).emit("mensagemLida", {
        cliente_id: clienteIdNum,
        modelo_id: modeloIdNum
      });
    }

    // 3️⃣ BUSCAR HISTÓRICO
    const result = await db.query(
      `
      SELECT
        id,
        cliente_id,
        modelo_id,
        sender,
        text,
        tipo,
        preco,
        visto,
        conteudo_id,
        pacote_id,
        created_at
      FROM messages
      WHERE cliente_id = $1
        AND modelo_id = $2
        AND deletada IS NOT TRUE
      ORDER BY created_at DESC
      LIMIT $3 OFFSET $4
      `,
      [clienteIdNum, modeloIdNum, limitNum, offsetNum]
    );

    const mensagens = result.rows.reverse();

    // 4️⃣ TRATAR MENSAGENS DE CONTEÚDO
    const mensagensConteudo = mensagens.filter(
      m => m.tipo === "conteudo" || m.tipo === "conteudo_ppv_mass"
    );

    const messageIds = mensagensConteudo.map(m => m.id);

    if (messageIds.length > 0) {
      const midiasRes = await db.query(
        `
        SELECT
          mc.message_id,
          mc.conteudo_id,
          c.url,
          c.thumbnail_url,
          c.tipo AS tipo_media
        FROM messages_conteudos mc
        JOIN conteudos c ON c.id = mc.conteudo_id
        WHERE mc.message_id = ANY($1)
        `,
        [messageIds]
      );

      const mapaMidias = {};

      for (const row of midiasRes.rows) {
        if (!mapaMidias[row.message_id]) {
          mapaMidias[row.message_id] = [];
        }

        mapaMidias[row.message_id].push({
          conteudo_id: Number(row.conteudo_id),
          url: row.url,
          thumbnail_url: row.thumbnail_url,
          tipo_media: row.tipo_media
        });
      }

      const pagosRes = await db.query(
        `
        SELECT message_id
        FROM conteudo_pacotes
        WHERE message_id = ANY($1)
          AND cliente_id = $2
          AND status = 'pago'
        `,
        [messageIds, clienteIdNum]
      );

      const pagosSet = new Set(
        pagosRes.rows.map(r => Number(r.message_id))
      );

      const conteudosPossuidosSet = await buscarConteudosJaPossuidosPorCliente(db, {
        cliente_id: clienteIdNum,
        modelo_id: modeloIdNum
      });

      for (const msg of mensagensConteudo) {
        const midias = mapaMidias[msg.id] || [];
        const pago = Number(msg.preco) > 0 ? pagosSet.has(Number(msg.id)) : true;
        const ehPPVMass = msg.tipo === "conteudo_ppv_mass";

        msg.midias = midias.map(midia => {
          const jaPossuia = ehPPVMass
            ? conteudosPossuidosSet.has(Number(midia.conteudo_id))
            : false;

          return {
            ...midia,
            ja_possuia: jaPossuia,
            liberado: pago || jaPossuia,
            bloqueado: !(pago || jaPossuia)
          };
        });

        msg.quantidade = msg.midias.length;

        if (Number(msg.preco) > 0) {
          msg.liberado = pago;
          msg.bloqueado = !pago;
          msg.tem_parcial_liberado = msg.midias.some(m => m.liberado);
          msg.tem_parcial_bloqueado = msg.midias.some(m => m.bloqueado);
        } else {
          msg.liberado = true;
          msg.bloqueado = false;
          msg.tem_parcial_liberado = msg.midias.length > 0;
          msg.tem_parcial_bloqueado = false;
        }
      }
    }

    // 5️⃣ ENVIAR APENAS PARA QUEM PEDIU
    socket.emit("chatHistory", mensagens);

  } catch (err) {
    console.error("❌ Erro getHistory:", err);
  }
});

socket.on("sendConteudo", async ({
  cliente_id,
  modelo_id,
  conteudos_ids,
  preco
} = {}) => {
  const clienteIdNum = Number(cliente_id);
  const modeloIdNum = Number(modelo_id);

  try {
    if (!socket.user || socket.user.role !== "modelo") {
      return;
    }

    if (
      !Number.isInteger(clienteIdNum) ||
      !Number.isInteger(modeloIdNum)
    ) return;

    if (!Array.isArray(conteudos_ids)) return;

    // 🔒 1️⃣ VALIDAR MODELO REAL
    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [socket.user.id]
    );

    if (!modeloRes.rowCount) return;

    const modeloIdReal = modeloRes.rows[0].id;

    if (modeloIdReal !== modeloIdNum) return;

    // 🔒 2️⃣ SANITIZAR IDS
    const conteudosIdsNum = conteudos_ids
      .map(id => Number(id))
      .filter(id => Number.isInteger(id) && id > 0);

    if (conteudosIdsNum.length === 0) return;

    // 🔒 3️⃣ VALIDAR QUE OS CONTEÚDOS PERTENCEM À MODELO
    const validosRes = await db.query(
      `
      SELECT id
      FROM conteudos
      WHERE id = ANY($1)
        AND modelo_id = $2
      `,
      [conteudosIdsNum, modeloIdNum]
    );

    const idsValidos = validosRes.rows.map(r => r.id);

    if (idsValidos.length === 0) return;

    let precoNum = Number(preco);

    if (!Number.isFinite(precoNum) || precoNum < 0) {
      precoNum = 0;
    }

    precoNum = Number(precoNum.toFixed(2));

    const sala = `chat_${clienteIdNum}_${modeloIdNum}`;

    // 4️⃣ CRIAR MENSAGEM
    const msgRes = await db.query(
      `
      INSERT INTO messages
        (cliente_id, modelo_id, sender, tipo, preco, visto, created_at)
      VALUES
        ($1, $2, 'modelo', 'conteudo', $3, false, NOW())
      RETURNING id, created_at
      `,
      [clienteIdNum, modeloIdNum, precoNum]
    );

    const message = msgRes.rows[0];

    // 5️⃣ ASSOCIAR MÍDIAS
    const values = idsValidos
      .map((_, i) => `($1, $${i + 2})`)
      .join(",");

    await db.query(
      `
      INSERT INTO messages_conteudos (message_id, conteudo_id)
      VALUES ${values}
      `,
      [message.id, ...idsValidos]
    );

    // 6️⃣ BUSCAR MÍDIAS
    const midiasRes = await db.query(
      `
      SELECT url, thumbnail_url, tipo AS tipo_media
      FROM conteudos
      WHERE id = ANY($1)
      ORDER BY array_position($1, id)
      `,
      [idsValidos]
    );

    const midias = midiasRes.rows;

    // 7️⃣ MARCAR UNREAD PARA CLIENTE
    await db.query(
      `
      INSERT INTO unread (cliente_id, modelo_id, unread_for, has_unread)
      VALUES ($1, $2, 'cliente', true)
      ON CONFLICT (cliente_id, modelo_id)
      DO UPDATE SET has_unread = true
      `,
      [clienteIdNum, modeloIdNum]
    );

    // 🔥 CHAT
    io.to(sala).emit("newMessage", {
      id: message.id,
      cliente_id: clienteIdNum,
      modelo_id: modeloIdNum,
      sender: "modelo",
      tipo: "conteudo",
      preco: precoNum,
      visto: false,
      quantidade: midias.length,
      midias,
      bloqueado: precoNum > 0,
      created_at: message.created_at
    });

    // 🔔 INBOX MODELO
    io.to(`inbox_modelo_${modeloIdNum}`).emit("inboxMessage", {
      cliente_id: clienteIdNum,
      modelo_id: modeloIdNum,
      sender: "modelo",
      tipo: "conteudo",
      textoPreview:
        precoNum > 0
          ? `📦 Conteúdo pago (${midias.length})`
          : `📦 Conteúdo (${midias.length})`,
      created_at: message.created_at
    });

    // 🔔 INBOX CLIENTE
    io.to(`inbox_cliente_${clienteIdNum}`).emit("inboxMessage", {
      cliente_id: clienteIdNum,
      modelo_id: modeloIdNum,
      sender: "modelo",
      tipo: "conteudo",
      textoPreview:
        precoNum > 0
          ? `📦 Conteúdo pago (${midias.length})`
          : `📦 Conteúdo (${midias.length})`,
      created_at: message.created_at
    });

  } catch (err) {
    console.error("❌ Erro sendConteudo:", err);
  }
});

socket.on("marcarConteudoVisto", async ({
  message_id,
  cliente_id,
  modelo_id
} = {}) => {
  const messageIdNum = Number(message_id);
  const clienteIdNum = Number(cliente_id);
  const modeloIdNum = Number(modelo_id);

  try {
    if (!socket.user || socket.user.role !== "cliente") {
      return socket.disconnect();
    }

    if (
      !Number.isInteger(messageIdNum) ||
      !Number.isInteger(clienteIdNum) ||
      !Number.isInteger(modeloIdNum)
    ) return;

    // 🔒 CONVERTER users.id → cliente_id real
    const clienteRes = await db.query(
      "SELECT id FROM clientes WHERE user_id = $1",
      [socket.user.id]
    );

    if (!clienteRes.rowCount) return;

    const clienteIdReal = clienteRes.rows[0].id;

    if (clienteIdReal !== clienteIdNum) return;

    // ✅ marcar como visto
    await db.query(
      `
      UPDATE messages
      SET visto = true
      WHERE id = $1
        AND cliente_id = $2
        AND modelo_id = $3
      `,
      [messageIdNum, clienteIdNum, modeloIdNum]
    );

    // 🔥 avisar sala
    const sala = `chat_${clienteIdNum}_${modeloIdNum}`;

    io.to(sala).emit("conteudoVisto", {
      message_id: messageIdNum
    });

  } catch (err) {
    console.error("❌ Erro marcarConteudoVisto:", err);
  }
});

socket.on("editarMensagem", async ({ id, text } = {}) => {
  try {

    if (!socket.user || socket.user.role !== "modelo") {
      return;
    }

    const messageId = Number(id);

if (
  !Number.isInteger(messageId) ||
  !text ||
  typeof text !== "string" ||
  text.trim().length === 0
) return;


    // 🔒 converter users.id → modelo_id
    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [socket.user.id]
    );

    if (!modeloRes.rowCount) return;

    const modeloIdReal = modeloRes.rows[0].id;

    // 🔒 verificar se a mensagem pertence à modelo
    const msgRes = await db.query(
      `
      SELECT cliente_id, modelo_id
      FROM messages
      WHERE id = $1
        AND sender = 'modelo'
      `,
      [messageId]
    );

    if (!msgRes.rowCount) return;

    const { cliente_id, modelo_id } = msgRes.rows[0];

    if (modelo_id !== modeloIdReal) return;

    // 🔒 opcional: limitar edição a 15 minutos
    await db.query(
      `
      UPDATE messages
      SET text = $1,
          updated_at = NOW()
      WHERE id = $2
        AND modelo_id = $3
      `,
      [text.trim(), messageId, modeloIdReal]
    );

    const sala = `chat_${cliente_id}_${modelo_id}`;

    io.to(sala).emit("mensagemEditada", {
  id: messageId,
  text: text.trim()
});

  } catch (err) {
    console.error("Erro ao editar mensagem:", err);
  }
});


socket.on("excluirMensagem", async ({ id } = {}) => {
  try {

    if (!socket.user || socket.user.role !== "modelo") return;

    const messageId = Number(id);
    if (!Number.isInteger(messageId)) return;

    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [socket.user.id]
    );

    if (!modeloRes.rowCount) return;

    const modeloIdReal = modeloRes.rows[0].id;

    const msgRes = await db.query(`
      SELECT cliente_id, modelo_id
      FROM messages
      WHERE id = $1
      AND sender = 'modelo'
    `,[messageId]);

    if (!msgRes.rowCount) return;

    const { cliente_id, modelo_id } = msgRes.rows[0];

    if (modelo_id !== modeloIdReal) return;

    const del = await db.query(`
      UPDATE messages
      SET deletada = true
      WHERE id = $1
      AND modelo_id = $2
      AND sender = 'modelo'
    `,[messageId, modeloIdReal]);

    if (del.rowCount === 0) return;

    console.log("DELETE rows:", del.rowCount);

    const sala = `chat_${cliente_id}_${modelo_id}`;

    io.to(sala).emit("mensagemExcluida", {
      id: messageId
    });

  } catch (err) {
    console.error("Erro ao excluir mensagem:", err);
  }
});

});

// ===============================
// ROTAS GET - BUSCA DE DADOS
// ===============================

// ===========================
// HEALTH DB
// ===========================

app.get("/api/health/db", async (req, res) => {
  try {
    await db.query("SELECT 1");
    res.json({
      status: "ok",
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error("❌ DB ERROR:", err);
    res.status(500).json({
      status: "error"
    });
  }
});

// ===========================
// MANIFEST
// ===========================

app.get("/manifest.json", (req, res) => {
  res.sendFile(path.join(__dirname, "manifest.json"));
});

// ===========================
// PUBLIC KEY
// ===========================

app.get("/api/push/public-key", (req, res) => {
  if (!process.env.VAPID_PUBLIC_KEY) {
    return res.status(500).json({ error: "Chave pública não configurada" });
  }

  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// ===========================
// VALOR ASSINATURA
// ===========================

app.get("/api/modelo/planos/me", auth, authModelo, async (req, res) => {
  try {

    const plano = await db.query(
  `SELECT COALESCE(valor_mensal, 20.00) AS valor_mensal
   FROM modelos_planos
   WHERE modelo_id = $1
   LIMIT 1`,
  [req.modelo_id]
);

res.json(plano.rows[0] || { valor_mensal: 20 });

  } catch (err) {
    console.error("Erro buscar plano:", err);
    res.status(500).json({ erro: "Erro ao buscar plano" });
  }
});

// ===========================
// INFO MODELO NO CHAT
// ===========================

app.get("/api/modelo/chat/:id", auth, async (req, res) => {
  const modelo_id = Number(req.params.id);

  if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
    return res.status(400).json({ error: "modelo_id inválido" });
  }

  try {
    const result = await db.query(
      `
      SELECT
        id,
        nome_exibicao,
        avatar AS avatar_url,
        last_seen
      FROM modelos
      WHERE id = $1
        AND ativo = true
      `,
      [modelo_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Modelo não encontrado" });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Erro buscar modelo chat:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// DADOS.HTML
// ===========================

app.get("/api/usuario/dados", auth, async (req, res) => {
  try {
    let result;

    if (req.user.role === "modelo") {
      const modeloRes = await db.query(
        `SELECT id
         FROM modelos
         WHERE user_id = $1
           AND ativo = true`,
        [req.user.id]
      );

      if (!modeloRes.rows.length) {
        return res.json({});
      }

      const modelo_id = modeloRes.rows[0].id;

      result = await db.query(
        `
        SELECT
          md.*,
          (
            SELECT v.status
            FROM modelos_verificacao v
            WHERE v.modelo_id = md.modelo_id
            ORDER BY v.criado_em DESC
            LIMIT 1
          ) AS status
        FROM modelos_dados md
        WHERE md.modelo_id = $1
          AND md.ativo = true
        `,
        [modelo_id]
      );

    } else if (req.user.role === "cliente") {
      const clienteRes = await db.query(
        `SELECT id
         FROM clientes
         WHERE user_id = $1
           AND ativo = true`,
        [req.user.id]
      );

      if (!clienteRes.rows.length) {
        return res.json({});
      }

      const cliente_id = clienteRes.rows[0].id;

      result = await db.query(
        `SELECT *
         FROM clientes_dados
         WHERE cliente_id = $1
           AND ativo = true`,
        [cliente_id]
      );

    } else {
      return res.json({});
    }

    res.json(result.rows[0] || {});

  } catch (err) {
    console.error("ERRO GET /api/usuario/dados:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ===========================
// PERFIL.HTML
// ===========================

app.get("/api/usuario/perfil", auth, async (req, res) => {
  try {
    let result;

    if (req.user.role === "modelo") {
      const modeloRes = await db.query(
        `SELECT id
         FROM modelos
         WHERE user_id = $1
           AND ativo = true`,
        [req.user.id]
      );

      if (!modeloRes.rows.length) {
        return res.json({});
      }

      const modelo_id = modeloRes.rows[0].id;

      result = await db.query(
        `
        SELECT
          m.nome_exibicao,
          m.local,
          m.bio,
          md.instagram,
          md.tiktok
        FROM modelos m
        LEFT JOIN modelos_dados md
          ON md.modelo_id = m.id
         AND md.ativo = true
        WHERE m.id = $1
          AND m.ativo = true
        `,
        [modelo_id]
      );
    }

    if (req.user.role === "cliente") {
      const clienteRes = await db.query(
        `SELECT id
         FROM clientes
         WHERE user_id = $1
           AND ativo = true`,
        [req.user.id]
      );

      if (!clienteRes.rows.length) {
        return res.json({});
      }

      const cliente_id = clienteRes.rows[0].id;

      result = await db.query(
        `
        SELECT
          cd.username,
          cd.instagram,
          cd.tiktok,
          cd.local,
          cd.bio
        FROM clientes_dados cd
        WHERE cd.cliente_id = $1
          AND cd.ativo = true
        `,
        [cliente_id]
      );
    }

    if (!result) {
      return res.status(403).json({});
    }

    const perfil = result.rows[0] || {};

    res.json({
      nome_exibicao: perfil.nome_exibicao || "",
      instagram: perfil.instagram || "",
      tiktok: perfil.tiktok || "",
      local: perfil.local || "",
      bio: perfil.bio || ""
    });

  } catch (err) {
    console.error("ERRO GET /api/usuario/perfil:", err);
    res.status(500).json({ erro: "Erro ao buscar perfil" });
  }
});

// ===========================
// VIPS.HTML
// ===========================

app.get("/api/modelo/me/vip-count", auth, async (req, res) => {
  try {
    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [req.user.id]
    );

    if (!modeloRes.rows.length) {
      return res.json({ total: 0 });
    }

    const modelo_id = modeloRes.rows[0].id;

const result = await db.query(
  `
  SELECT COUNT(*)::int AS total
  FROM vip_subscriptions
  WHERE modelo_id = $1
    AND ativo = true
    AND expiration_at > NOW()
  `,
  [modelo_id]
);

    res.json({ total: result.rows[0]?.total || 0 });

  } catch (err) {
    console.error("Erro contar VIPs:", err);
    res.status(500).json({ total: 0 });
  }
});

// ===========================
// OFERTAS ENCERRADAS
// ===========================

app.get("/api/ofertas", authModelo, async (req, res) => {
  try {

    await db.query("SELECT encerrar_ofertas_expiradas()");

    const result = await db.query(
      `
      SELECT *
      FROM ofertas
      WHERE modelo_id = $1
      ORDER BY created_at DESC
      LIMIT 5
      `,
      [req.modelo_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("Erro buscar ofertas:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ===========================
// OFERTA ATIVAS
// ===========================

app.get("/api/ofertas/ativa/:modelo_id", async (req, res) => {
  try {
    const modelo_id = Number(req.params.modelo_id);

    if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
      return res.status(400).json({ ativa: false });
    }

    const ofertaRes = await db.query(
      `
      SELECT
        id,
        modelo_id,
        nome,
        desconto_percentual,
        valor_base,
        valor_promocional,
        data_fim
      FROM ofertas
      WHERE modelo_id = $1
        AND ativa = true
        AND data_fim > NOW()
      LIMIT 1
      `,
      [modelo_id]
    );

     if (ofertaRes.rowCount) {
      return res.json({
        ativa: true,
        oferta: ofertaRes.rows[0]
      });
    }

    // ===============================
    // 🔥 2️⃣ NÃO TEM OFERTA → BUSCAR PREÇO BASE
    // ===============================

    const precoRes = await db.query(`
      SELECT
        COALESCE(
          NULLIF(mp.valor_mensal, 0),
          NULLIF(md.vip_preco, 0),
          20.00
        ) AS valor_base
      FROM modelos m
      LEFT JOIN modelos_planos mp
        ON mp.modelo_id = m.id
      LEFT JOIN modelos_dados md
        ON md.modelo_id = m.id
      WHERE m.id = $1
      LIMIT 1
    `, [modelo_id]);

    const valorBase =
      precoRes.rowCount
        ? Number(precoRes.rows[0].valor_base)
        : 20.00;

    return res.json({
      ativa: false,
      valor_base: valorBase
    });

  } catch (err) {
    console.error("Erro buscar oferta ativa:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ===========================
// STATUS VIP
// ===========================

app.get("/api/vip/status/:modelo_id", authCliente, async (req, res) => {
  try {

    const modelo_id = Number(req.params.modelo_id);

    if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
      return res.status(400).json({ error: "modelo_id inválido" });
    }

    const result = await db.query(
      `
      SELECT expiration_at
      FROM vip_subscriptions
      WHERE cliente_id = $1
      AND modelo_id = $2
      AND ativo = true
      AND expiration_at > NOW()
      ORDER BY expiration_at DESC
      LIMIT 1
      `,
      [req.cliente_id, modelo_id]
    );

    res.json({
      vip: result.rowCount > 0,
      expiration_at: result.rows[0]?.expiration_at || null
    });

  } catch (err) {
    console.error("Erro buscar status VIP:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// PWA
// ===========================

app.get("/api/app/state-v2", auth, (req, res) => {
  if (!req.user || !req.user.role) {
    return res.status(401).json({ next: "logout" });
  }

  if (req.user.role === "modelo") {
    return res.json({ next: "modelo" });
  }

  if (req.user.role === "cliente") {
    return res.json({ next: "cliente" });
  }

  return res.json({ next: "logout" });
});

// ===========================
// PERFIL MODELO
// ===========================

app.get("/api/me", auth, async (req, res) => {
  try {
    if (req.user.role === "modelo") {
      const result = await db.query(
        `
        SELECT
          m.id AS modelo_id,
          m.nome_exibicao,
          m.avatar,
          m.capa,
          m.bio,
          m.local
        FROM modelos m
        WHERE m.user_id = $1
          AND m.ativo = true
        `,
        [req.user.id]
      );

      if (!result.rows.length) {
        return res.json({ role: "modelo" });
      }

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
        `
        SELECT id
        FROM clientes
        WHERE user_id = $1
          AND ativo = true
        LIMIT 1
        `,
        [req.user.id]
      );

      if (!clienteRes.rows.length) {
        return res.status(403).json({ error: "Conta desativada" });
      }
    }

    return res.json({
      user_id: req.user.id,
      role: req.user.role
    });

  } catch (err) {
    console.error("Erro /api/me:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});


// ===========================
// FEED DO PERFIL
// ===========================

app.get("/api/modelo/publico/:id/feed", async (req, res) => {
  const modeloId = Number(req.params.id);

  const { rows } = await db.query(
    `
    SELECT c.id, c.url, c.thumbnail_url, c.tipo, c.tipo_conteudo, c.preco, c.descricao
    FROM conteudos c
    JOIN modelos m
      ON m.id = c.modelo_id
    WHERE c.modelo_id = $1
      AND m.ativo = true
      AND c.ativo = true
      AND c.tipo_conteudo = 'feed'
      AND (c.preco IS NULL OR c.preco = 0)
    ORDER BY c.id DESC
    `,
    [modeloId]
  );

  res.json(rows);
});

// ===========================
// PERFIL MODELO VERIFICADA
// ===========================

app.get("/api/modelo/me", authModelo, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT
        m.id AS modelo_id,
        m.user_id,
        m.nome_exibicao,
        m.bio,
        m.avatar,
        m.capa,
        m.local,
        m.verificada,
        md.instagram,
        md.tiktok
      FROM modelos m
      LEFT JOIN modelos_dados md
        ON md.modelo_id = m.id
       AND md.ativo = true
      WHERE m.id = $1
        AND m.ativo = true
      `,
      [req.modelo_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({
        error: "Perfil não encontrado"
      });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Erro /api/modelo/me:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// FEED.HTML
// ===========================

app.get("/api/modelos", auth, async (req, res) => {
  try {
    if (!["cliente", "modelo"].includes(req.user.role)) {
      return res.status(403).json([]);
    }

    const clienteId = req.user.role === "cliente" ? req.user.id : null;

    const result = await db.query(`
      SELECT
        m.id AS modelo_id,
        m.nome_exibicao,
        m.avatar,
        m.capa,
        m.bio,

        COALESCE(r.ganhos_mes, 0) AS ganhos_total,

        ver.verificado_em AS aprovado_em,

        CASE
          WHEN ver.verificado_em >= NOW() - INTERVAL '14 days'
          THEN true ELSE false
        END AS is_new,

        -- total de fãs (assinantes ativos)
        COALESCE(fas.total, 0) AS total_fas,

        -- responsiva: >70% das msgs de clientes respondidas nos últimos 7 dias
        CASE
          WHEN COALESCE(resp.total_recebidas, 0) >= 5
           AND COALESCE(resp.total_respondidas, 0)::float
             / NULLIF(resp.total_recebidas, 0) >= 0.7
          THEN true ELSE false
        END AS responsiva,

        -- ativa no conteúdo: postou nos últimos 7 dias ou tem conteúdo premium
        CASE
          WHEN COALESCE(cont.recente, 0) > 0 OR COALESCE(cont.premium, 0) > 0
          THEN true ELSE false
        END AS ativa_conteudo,

        COALESCE(cont.premium, 0) AS total_premium,

        -- recomendada para este cliente (tem interação prévia ou assinatura ativa)
        CASE
          WHEN $1::int IS NOT NULL AND (
            COALESCE(inter.msgs, 0) > 0
            OR COALESCE(assin.ativa, false) = true
          )
          THEN true ELSE false
        END AS recomendada

      FROM modelos m

      JOIN LATERAL (
        SELECT status, verificado_em
        FROM modelos_verificacao
        WHERE modelo_id = m.id
        ORDER BY verificado_em DESC
        LIMIT 1
      ) ver ON true

      LEFT JOIN LATERAL (
        SELECT SUM(valor_modelo) AS ganhos_mes
        FROM transacoes_agency t
        WHERE t.modelo_id = m.id
          AND date_trunc('month', t.created_at) = date_trunc('month', NOW())
      ) r ON true

      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS total
        FROM vip_subscriptions v
        WHERE v.modelo_id = m.id AND v.ativo = true AND v.expiration_at > NOW()
      ) fas ON true

      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE sender = 'cliente') AS total_recebidas,
          COUNT(*) FILTER (
            WHERE sender = 'modelo'
            AND EXISTS (
              SELECT 1 FROM messages m2
              WHERE m2.modelo_id = m.id
                AND m2.cliente_id = messages.cliente_id
                AND m2.sender = 'cliente'
                AND m2.created_at < messages.created_at
                AND m2.created_at >= NOW() - INTERVAL '7 days'
            )
          ) AS total_respondidas
        FROM messages
        WHERE modelo_id = m.id
          AND created_at >= NOW() - INTERVAL '7 days'
          AND deletada IS NOT TRUE
      ) resp ON true

      LEFT JOIN LATERAL (
        SELECT
          COUNT(*) FILTER (WHERE criado_em >= NOW() - INTERVAL '7 days') AS recente,
          COUNT(*) FILTER (WHERE tipo_conteudo = 'venda' AND preco > 0) AS premium
        FROM conteudos
        WHERE modelo_id = m.id
      ) cont ON true

      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS msgs
        FROM messages
        WHERE modelo_id = m.id AND cliente_id = $1
          AND deletada IS NOT TRUE
        LIMIT 1
      ) inter ON ($1::int IS NOT NULL)

      LEFT JOIN LATERAL (
        SELECT true AS ativa
        FROM vip_subscriptions
        WHERE modelo_id = m.id AND cliente_id = $1
          AND ativo = true AND expiration_at > NOW()
        LIMIT 1
      ) assin ON ($1::int IS NOT NULL)

      WHERE ver.status = 'aprovado'
        AND m.feed = true
        AND m.ativo = true
    `,
    [clienteId]
    );

    const modelos = result.rows;
    const onlineIds = new Set(onlineModelos.keys());

    // marca online
    modelos.forEach(m => {
      m.online = onlineIds.has(Number(m.modelo_id));
    });

    // seções
    const online      = modelos.filter(m => m.online);
    const novas       = modelos.filter(m => m.is_new);
    const emAlta      = [...modelos].sort((a, b) => b.ganhos_total - a.ganhos_total).slice(0, 20);
    const recomendadas = clienteId
      ? modelos.filter(m => m.recomendada)
      : [...modelos].sort(() => Math.random() - 0.5).slice(0, 10);

    // badges top1/2/3 na seção em alta
    emAlta.forEach((m, i) => {
      if (i === 0) m.top1 = true;
      if (i === 1) m.top2 = true;
      if (i === 2) m.top3 = true;
    });

    // Secção "Descubra mais": modelos que não aparecem em nenhuma outra secção
    const idsDestaque = new Set([
      ...online.map(m => m.modelo_id),
      ...novas.map(m => m.modelo_id),
      ...emAlta.map(m => m.modelo_id),
      ...recomendadas.map(m => m.modelo_id)
    ]);
    const descubraMais = modelos
      .filter(m => !idsDestaque.has(m.modelo_id))
      .sort((a, b) => (a.nome_exibicao || "").localeCompare(b.nome_exibicao || "", "pt-BR"));

    res.json({ online, novas, emAlta, recomendadas, descubraMais });

  } catch (err) {
    console.error("Erro feed modelos:", err);
    res.status(500).json({ online: [], novas: [], emAlta: [], recomendadas: [] });
  }
});

// ===========================
// PERFIL PUBLICO MODELO
// ===========================

app.get("/api/modelo/publico/:modelo_id", async (req, res) => {
  const modelo_id = Number(req.params.modelo_id);

  if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
    return res.status(400).json({ error: "modelo_id inválido" });
  }

  try {
    const result = await db.query(
      `
      SELECT
        m.id AS modelo_id,
        m.nome_exibicao,
        m.bio,
        m.avatar,
        m.capa,
        m.local,
        COALESCE(
          NULLIF(mp.valor_mensal, 0),
          NULLIF(md.vip_preco, 0),
          20.00
        ) AS valor_assinatura,
        md.instagram,
        md.tiktok
      FROM modelos m
      JOIN LATERAL (
        SELECT status
        FROM modelos_verificacao
        WHERE modelo_id = m.id
        ORDER BY criado_em DESC
        LIMIT 1
      ) v ON true
      LEFT JOIN modelos_dados md
        ON md.modelo_id = m.id
       AND md.ativo = true
      LEFT JOIN modelos_planos mp
        ON mp.modelo_id = m.id
      WHERE m.id = $1
        AND m.ativo = true
        AND v.status = 'aprovado'
      LIMIT 1
      `,
      [modelo_id]
    );

    if (!result.rows.length) {
      return res.status(403).json({
        error: "Perfil indisponível no momento"
      });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Erro perfil público:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// INFO MODELOS NO CHAT CLT
// ===========================

app.get("/api/cliente/modelos", authCliente, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT
        m.id AS modelo_id,
        m.nome_exibicao
      FROM vip_subscriptions v
      JOIN modelos m
        ON m.id = v.modelo_id
      WHERE v.cliente_id = $1
        AND v.ativo = true
        AND v.expiration_at > NOW()
        AND m.ativo = true
      ORDER BY m.nome_exibicao
      `,
      [req.cliente_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("Erro modelos chat cliente:", err);
    res.status(500).json([]);
  }
});
// ===========================
// NÃO LIDAS CLIENTE
// ===========================

app.get("/api/chat/unread/cliente", authCliente, async (req, res) => {
  try {

    const ids = await buscarUnreadCliente(req.cliente_id);

    res.json(ids);

  } catch (err) {
    console.error("Erro unread cliente:", err);
    res.status(500).json([]);
  }
});

// ===========================
// MSG NÃO LIDA - MODELOS
// ===========================

app.get("/api/chat/unread/modelo", authModelo, async (req, res) => {
  try {

    const ids = await buscarUnreadModelo(req.modelo_id);

    res.json(ids);

  } catch (err) {
    console.error("Erro unread modelo:", err);
    res.status(500).json([]);
  }
});

// ===========================
// INFOS CLIENTE
// ===========================

app.get("/api/cliente/me", authCliente, async (req, res) => {
  try {
    const result = await db.query(
      `
      SELECT
        c.id AS cliente_id,
        c.user_id,
        c.nome,
        cd.username,
        cd.avatar,
        cd.capa,
        cd.instagram,
        cd.tiktok,
        cd.local,
        cd.bio
      FROM clientes c
      LEFT JOIN clientes_dados cd
        ON cd.cliente_id = c.id
       AND cd.ativo = true
      WHERE c.id = $1
        AND c.ativo = true
      `,
      [req.cliente_id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Erro /api/cliente/me:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// LISTA VIPS
// ===========================

app.get("/api/modelo/vips", authModelo, async (req, res) => {
  try {

    const result = await db.query(
      `
      SELECT 
        c.id AS cliente_id,
        c.nome
      FROM vip_subscriptions v
      JOIN clientes c 
        ON c.id = v.cliente_id
      WHERE v.modelo_id = $1
      AND v.ativo = true
      AND v.expiration_at > NOW()
      ORDER BY c.nome
      `,
      [req.modelo_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("Erro listar VIPs:", err);
    res.status(500).json([]);
  }
});

// ===========================
// CONTEUDOS.HTML
// ===========================

app.get( "/conteudos.html", authModelo, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "conteudos.html"));
  }
);

// =============================
// LISTA INBOX CLIENTE
// =============================

app.get("/api/chat/cliente", authCliente, async (req, res) => {
  try {

    const { rows } = await db.query(`
      SELECT
        m.id AS modelo_id,
        m.nome_exibicao,
        m.avatar AS avatar,

        msg.text        AS ultima_mensagem,
        msg.created_at  AS ultima_mensagem_em,
        msg.lida,
        msg.sender

      FROM vip_subscriptions v

      JOIN modelos m 
        ON m.id = v.modelo_id  -- 🔥 corrigido

      LEFT JOIN LATERAL (
        SELECT text, created_at, lida, sender
        FROM messages
        WHERE messages.cliente_id = v.cliente_id
          AND messages.modelo_id  = v.modelo_id
        ORDER BY created_at DESC
        LIMIT 1
      ) msg ON true

      WHERE v.cliente_id = $1
        AND v.ativo = true
        AND v.expiration_at > NOW()
      ORDER BY
        CASE WHEN msg.sender = 'modelo' AND COALESCE(msg.lida, false) = false THEN 1 ELSE 2 END,
        msg.created_at DESC NULLS LAST
    `, [req.cliente_id]);

    res.json(rows);

  } catch (err) {
    console.error("Erro chat cliente:", err);
    res.status(500).json([]);
  }
});

/// ===========================
// LISTA INBOX MODELO
// ============================

app.get("/api/chat/modelo", authModelo, async (req, res) => {
  try {
    const userId = req.user.id;

    const modeloResult = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [userId]
    );

    if (modeloResult.rowCount === 0) {
      return res.status(404).json({ error: "Modelo não encontrada" });
    }

    const modeloId = modeloResult.rows[0].id;
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const { rows } = await db.query(
      `
      SELECT
        c.id AS cliente_id,
        c.nome,
        cd.username,
        cd.avatar AS avatar,
        COALESCE(cnm.resumo_curto, '') AS resumo_curto,

        msg.text       AS ultima_mensagem,
        msg.created_at AS ultima_mensagem_em,
        msg.sender     AS ultimo_sender,
        COALESCE(msg.visto, false) AS visto,
        COALESCE(msg.lida, false)  AS lida,

        COALESCE(g.total_gasto, 0) AS total_gasto,

        CASE
          WHEN COALESCE(g.total_gasto, 0) >= 300 THEN '$$$'
          WHEN COALESCE(g.total_gasto, 0) >= 200 THEN '$$'
          WHEN COALESCE(g.total_gasto, 0) > 100 THEN '$'
          ELSE ''
        END AS spend_level,

        CASE
          WHEN msg.sender = 'cliente' AND COALESCE(msg.lida, false) = false THEN true
          ELSE false
        END AS nao_lido,

        CASE
          WHEN msg.sender = 'cliente' AND COALESCE(msg.lida, false) = true THEN true
          ELSE false
        END AS por_responder,

        CASE
          WHEN msg.sender = 'modelo' AND COALESCE(msg.visto, false) = true THEN true
          ELSE false
        END AS cliente_visualizou

      FROM vip_subscriptions v
      JOIN clientes c
        ON c.id = v.cliente_id

      LEFT JOIN clientes_dados cd
        ON cd.cliente_id = c.id

      LEFT JOIN cliente_notas_modelo cnm
      ON cnm.cliente_id = c.id
      AND cnm.modelo_id = $1

      LEFT JOIN LATERAL (
        SELECT text, created_at, visto, lida, sender
        FROM messages
        WHERE messages.cliente_id = c.id
          AND messages.modelo_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      ) msg ON true

      LEFT JOIN LATERAL (
        SELECT SUM(valor_bruto) AS total_gasto
        FROM transacoes_agency t
        WHERE t.cliente_id = c.id
          AND t.modelo_id = $1
          AND t.status = 'pago'
          AND t.tipo IN ('midia', 'assinatura')
      ) g ON true

      WHERE v.modelo_id = $1
        AND v.ativo = true
        AND v.expiration_at > NOW()

      ORDER BY
        CASE
          WHEN msg.sender = 'cliente' AND COALESCE(msg.lida,  false) = false THEN 1
          WHEN msg.sender = 'cliente' AND COALESCE(msg.lida,  false) = true  THEN 2
          WHEN msg.sender = 'modelo'  AND COALESCE(msg.visto, false) = true  THEN 3
          WHEN msg.sender = 'modelo'  AND COALESCE(msg.visto, false) = false THEN 4
          ELSE 5
        END,
        msg.created_at DESC NULLS LAST,
        c.id DESC

      LIMIT $2 OFFSET $3
      `,
      [modeloId, limit, offset]
    );

    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar chats da modelo:", err);
    res.status(500).json({ error: "Erro ao buscar chats" });
  }
});

// ===========================
// INFO CLIENTE CHAT
// ===========================

app.get("/api/chat/cliente/:cliente_id", authModelo, async (req, res) => {

  const cliente_id = Number(req.params.cliente_id);

  if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
    return res.status(400).json({ error: "cliente_id inválido" });
  }

  try {
    const result = await db.query(`
      SELECT
        c.id AS cliente_id,
        c.nome,
        c.last_seen,
        cd.username,
        cd.avatar
      FROM clientes c
      LEFT JOIN clientes_dados cd
        ON cd.cliente_id = c.id
      WHERE c.id = $1
      AND c.ativo = true
      LIMIT 1
    `, [cliente_id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Erro buscar cliente:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// MENSAGEM COM CONTEUDO
// ===========================

app.get("/api/chat/conteudo/:message_id", authCliente, async (req, res) => {
  const message_id = Number(req.params.message_id);

  if (!Number.isInteger(message_id) || message_id <= 0) {
    return res.status(400).json({ error: "message_id inválido" });
  }

  try {
    const messageCheck = await db.query(
      `
      SELECT id, visto, preco, modelo_id, pacote_id, tipo
      FROM messages
      WHERE id = $1
        AND cliente_id = $2
      `,
      [message_id, req.cliente_id]
    );

    if (!messageCheck.rowCount) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    const mensagem = messageCheck.rows[0];
    const preco = Number(mensagem.preco || 0);

    const pagoRes = await db.query(
      `
      SELECT 1
      FROM conteudo_pacotes
      WHERE message_id = $1
        AND cliente_id = $2
        AND status = 'pago'
      LIMIT 1
      `,
      [message_id, req.cliente_id]
    );

    const pacotePago = !!pagoRes.rowCount;
    const mensagemLiberada = mensagem.visto === true || pacotePago;

    const result = await db.query(
      `
      SELECT
        mc.conteudo_id,
        c.url,
        c.tipo AS tipo_media,
        c.thumbnail_url
      FROM messages_conteudos mc
      JOIN conteudos c ON c.id = mc.conteudo_id
      WHERE mc.message_id = $1
      `,
      [message_id]
    );

    // conteúdo grátis ou mensagem totalmente liberada
    if (preco <= 0 || mensagemLiberada) {
      return res.json(
        result.rows.map(row => ({
          conteudo_id: Number(row.conteudo_id),
          url: row.url,
          tipo_media: row.tipo_media,
          thumbnail_url: row.thumbnail_url,
          liberado: true,
          bloqueado: false,
          ja_possuia: true
        }))
      );
    }

    // daqui pra baixo: mensagem paga e ainda não liberada por completo

    const ehMass = mensagem.tipo === "conteudo_ppv_mass";
    // envio pago normal continua igual
    if (!ehMass) {
      return res.status(403).json({ error: "Conteúdo não liberado" });
    }

    // PPV mass: libera individualmente o que o cliente já possuía
    const conteudosPossuidosSet = await buscarConteudosJaPossuidosPorCliente(db, {
      cliente_id: req.cliente_id,
      modelo_id: Number(mensagem.modelo_id)
    });

    const midias = result.rows.map(row => {
      const conteudoId = Number(row.conteudo_id);
      const jaPossuia = conteudosPossuidosSet.has(conteudoId);

      return {
        conteudo_id: conteudoId,
        url: row.url,
        tipo_media: row.tipo_media,
        thumbnail_url: row.thumbnail_url,
        ja_possuia: jaPossuia,
        liberado: jaPossuia,
        bloqueado: !jaPossuia
      };
    });

    const algumaLiberada = midias.some(m => m.liberado);

    if (!algumaLiberada) {
      return res.status(403).json({ error: "Conteúdo não liberado" });
    }

    return res.json(midias);

  } catch (err) {
    console.error("Erro buscar conteúdo liberado:", err);
    res.status(500).json([]);
  }
});

// ===========================
// CHAT CONTEUDOS JA VISTOS
// ===========================

app.get("/api/chat/conteudos-vistos/:cliente_id", authModelo, async (req, res) => {

  const cliente_id = Number(req.params.cliente_id);

  if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
    return res.status(400).json({ error: "cliente_id inválido" });
  }

  try {
    const result = await db.query(`
      SELECT DISTINCT mc.conteudo_id
      FROM messages m
      JOIN messages_conteudos mc 
        ON mc.message_id = m.id
      WHERE m.modelo_id = $1
        AND m.cliente_id = $2
        AND m.visto = true
    `, [req.modelo_id, cliente_id]);

    res.json(result.rows.map(r => r.conteudo_id));

  } catch (err) {
    console.error("Erro buscar conteudos vistos:", err);
    res.status(500).json([]);
  }
});

// ===========================
// CHAT STATUS CONTEUDO
// ===========================

app.get("/api/chat/conteudo-status/:message_id", authCliente, async (req, res) => {
  const message_id = Number(req.params.message_id);
  if (!Number.isInteger(message_id) || message_id <= 0) {
    return res.status(400).json({ liberado: false });
  }

  try {
    const msg = await db.query(
      `SELECT visto, preco FROM messages WHERE id = $1 AND cliente_id = $2`,
      [message_id, req.cliente_id]
    );
    if (!msg.rowCount) return res.json({ liberado: false });

    const { visto } = msg.rows[0];

    if (visto === true) return res.json({ liberado: true });

    const pago = await db.query(
      `
      SELECT 1
      FROM conteudo_pacotes
      WHERE message_id = $1 AND cliente_id = $2 AND status = 'pago'
      LIMIT 1
      `,
      [message_id, req.cliente_id]
    );

    return res.json({ liberado: !!pago.rowCount });
  } catch (err) {
    console.error("Erro conteudo-status:", err);
    return res.status(500).json({ liberado: false });
  }
});

// ===========================
// MIDIAS NO POPUP CHAT
// ===========================

app.get("/api/conteudos", authModelo, async (req, res) => {

  const { page = 1, limit = 10 } = req.query;

  try {

    const pagina = Number(page);
    const limite = Number(limit);
    const offset = (pagina - 1) * limite;

    const params = [req.modelo_id, limite, offset];

    const result = await db.query(
      `
      SELECT
        c.id,
        c.modelo_id,
        c.tipo,
        c.tipo_conteudo,
        c.url,
        c.thumbnail_url,
        c.criado_em
      FROM conteudos c
      WHERE
        c.modelo_id = $1
        AND c.ativo = TRUE
        AND c.tipo_conteudo = 'venda'
      ORDER BY c.criado_em DESC
      LIMIT $2
      OFFSET $3
      `,
      params
    );

    const totalRes = await db.query(
      `
      SELECT COUNT(*)
      FROM conteudos c
      WHERE
        c.modelo_id = $1
        AND c.ativo = TRUE
        AND c.tipo_conteudo = 'venda'
      `,
      [req.modelo_id]
    );

    const total = Number(totalRes.rows[0].count);
    const totalPaginas = Math.ceil(total / limite);

    res.json({
      conteudos: result.rows,
      total,
      totalPaginas,
      paginaAtual: pagina
    });

  } catch (err) {
    console.error("Erro listar conteúdos:", err);
    res.status(500).json({ error: "Erro ao listar conteúdos" });
  }

});


// ===========================
// STATUS INBOX/CHAT
// ===========================

app.get("/api/verificacao/status", auth, async (req, res) => {
  try {

    const userId = req.user.id;

    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [userId]
    );

    if (modeloRes.rows.length) {

      const modeloId = modeloRes.rows[0].id;

      const modeloVerificacao = await db.query(
        `
        SELECT status, motivo_rejeicao
        FROM modelos_verificacao
        WHERE modelo_id = $1
        ORDER BY criado_em DESC
        LIMIT 1
        `,
        [modeloId]
      );

      if (modeloVerificacao.rows.length) {
        return res.json(modeloVerificacao.rows[0]);
      }
    }

    const clienteRes = await db.query(
      "SELECT id FROM clientes WHERE user_id = $1",
      [userId]
    );

    if (clienteRes.rows.length) {

      const clienteId = clienteRes.rows[0].id;

      const clienteVerificacao = await db.query(
        `
        SELECT status, motivo_rejeicao
        FROM clientes_verificacao
        WHERE cliente_id = $1
        ORDER BY criado_em DESC
        LIMIT 1
        `,
        [clienteId]
      );

      if (clienteVerificacao.rows.length) {
        return res.json(clienteVerificacao.rows[0]);
      }
    }

    return res.json({ status: "pendente", motivo: null });

  } catch (err) {
    console.error("Erro status verificação:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ===========================
// RELATORIO.HTML
// ===========================

app.get("/modelo/relatorio", authModelo, (req, res) => {
  res.sendFile(
    path.join(process.cwd(), "admin-pages", "relatorio.html")
  );
});

// ===========================
// VIPS.HTML - LISTA
// ===========================

app.get("/api/modelo/assinantes", authModelo, async (req, res) => {
  try {
    const result = await db.query(
      `
      WITH vip_ativos AS (
        SELECT
          v.cliente_id,
          v.modelo_id,
          MAX(v.expiration_at) AS expiration_at
        FROM vip_subscriptions v
        WHERE v.modelo_id = $1
          AND v.ativo = true
          AND v.expiration_at > NOW()
        GROUP BY v.cliente_id, v.modelo_id
      ),
      financeiros AS (
        SELECT
          t.cliente_id,
          t.modelo_id,

          COALESCE(SUM(
            CASE
              WHEN LOWER(COALESCE(t.tipo, '')) = 'assinatura'
               AND t.status = 'pago'
              THEN COALESCE(t.valor_modelo, 0)
              ELSE 0
            END
          ), 0)::numeric(10,2) AS total_assinaturas,

          COALESCE(SUM(
            CASE
              WHEN LOWER(COALESCE(t.tipo, '')) IN ('conteudo', 'midia')
               AND t.status = 'pago'
              THEN COALESCE(t.valor_modelo, 0)
              ELSE 0
            END
          ), 0)::numeric(10,2) AS total_midias

        FROM transacoes_agency t
        WHERE t.modelo_id = $1
        GROUP BY t.cliente_id, t.modelo_id
      )
      SELECT
        c.id AS cliente_id,
        c.nome AS nome_cliente,
        va.expiration_at,
        COALESCE(f.total_assinaturas, 0)::numeric(10,2) AS total_assinaturas,
        COALESCE(f.total_midias, 0)::numeric(10,2) AS total_midias

      FROM vip_ativos va
      JOIN clientes c
        ON c.id = va.cliente_id
      LEFT JOIN financeiros f
        ON f.cliente_id = va.cliente_id
       AND f.modelo_id = va.modelo_id

      ORDER BY va.expiration_at ASC, c.nome ASC
      `,
      [req.modelo_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("Erro listar assinantes:", err);
    res.status(500).json({ erro: "Erro ao listar assinantes" });
  }
});

// =============================
// STATUS PAGAMENTOS VIP/MIDIAS/PREMIUM
// ============================

app.get("/api/pagamento/status/:paymentRef", auth, async (req, res) => {
  try {
    const { paymentRef } = req.params;

    if (!paymentRef || String(paymentRef).trim() === "") {
      return res.status(400).json({ error: "paymentRef inválido" });
    }

    function normalizarStatusLocal(status) {
      const s = String(status || "").toLowerCase().trim();

      if (s === "pago") return "pago";

      if (
        [
          "falhou",
          "failed",
          "refused",
          "denied",
          "cancelled",
          "canceled",
          "requires_payment_method"
        ].includes(s)
      ) {
        return "falhou";
      }

      if (["expired", "expirado"].includes(s)) {
        return "expirado";
      }

      if (
        [
          "chargedback",
          "chargeback",
          "refunded",
          "estornado"
        ].includes(s)
      ) {
        return "falhou";
      }

      if (
        [
          "requires_action",
          "requires_confirmation",
          "processing",
          "pending",
          "pendente",
          "iniciado"
        ].includes(s)
      ) {
        return "pendente";
      }

      if (s === "succeeded") {
        return "pendente";
      }

      return "pendente";
    }

    /* =========================================
       1) PREMIUM (PIX ou CARTAO)
    ========================================= */
    const premiumRes = await db.query(
      `
      SELECT
        status,
        premium_post_id,
        modelo_id,
        metodo_pagamento AS metodo,
        'premium' AS tipo,
        gateway,
        currency
      FROM premium_unlocks
      WHERE pagarme_order_id = $1
         OR stripe_payment_intent_id = $1
      LIMIT 1
      `,
      [paymentRef]
    );

    if (premiumRes.rowCount > 0) {
      const row = premiumRes.rows[0];

      return res.json({
        status: normalizarStatusLocal(row.status),
        raw_status: row.status,
        tipo: row.tipo,
        metodo: row.metodo || null,
        gateway: row.gateway || null,
        currency: row.currency || null,
        message_id: null,
        premium_post_id: row.premium_post_id || null,
        modelo_id: row.modelo_id || null
      });
    }

    /* =========================================
       2) VIP PIX
    ========================================= */
    const vipPixRes = await db.query(
      `
      SELECT
        status,
        modelo_id,
        'pix' AS metodo,
        'vip' AS tipo,
        gateway,
        currency
      FROM pagamentos_pix
      WHERE pagarme_order_id = $1
        AND message_id IS NULL
      LIMIT 1
      `,
      [paymentRef]
    );

    if (vipPixRes.rowCount > 0) {
      const row = vipPixRes.rows[0];

      return res.json({
        status: normalizarStatusLocal(row.status),
        raw_status: row.status,
        tipo: row.tipo,
        metodo: row.metodo,
        gateway: row.gateway || "pagarme",
        currency: row.currency || null,
        message_id: null,
        premium_post_id: null,
        modelo_id: row.modelo_id || null
      });
    }

    /* =========================================
       3) VIP CARTAO STRIPE
    ========================================= */
    const vipCartaoRes = await db.query(
      `
      SELECT
        status,
        modelo_id,
        'cartao' AS metodo,
        'vip' AS tipo,
        gateway,
        currency
      FROM pagamentos_cartao
      WHERE (
        stripe_payment_intent_id = $1
        OR gateway_payment_id = $1
      )
        AND conteudo_id IS NULL
        AND tipo = 'vip'
      LIMIT 1
      `,
      [paymentRef]
    );

    if (vipCartaoRes.rowCount > 0) {
      const row = vipCartaoRes.rows[0];

      return res.json({
        status: normalizarStatusLocal(row.status),
        raw_status: row.status,
        tipo: row.tipo,
        metodo: row.metodo,
        gateway: row.gateway || "stripe",
        currency: row.currency || null,
        message_id: null,
        premium_post_id: null,
        modelo_id: row.modelo_id || null
      });
    }

    /* =========================================
       4) MIDIA PIX
    ========================================= */
    const pixRes = await db.query(
      `
      SELECT
        status,
        message_id,
        modelo_id,
        'pix' AS metodo,
        'midia' AS tipo,
        gateway,
        currency
      FROM pagamentos_pix
      WHERE pagarme_order_id = $1
        AND message_id IS NOT NULL
      LIMIT 1
      `,
      [paymentRef]
    );

    if (pixRes.rowCount > 0) {
      const row = pixRes.rows[0];

      return res.json({
        status: normalizarStatusLocal(row.status),
        raw_status: row.status,
        tipo: row.tipo,
        metodo: row.metodo,
        gateway: row.gateway || "pagarme",
        currency: row.currency || null,
        message_id: row.message_id || null,
        premium_post_id: null,
        modelo_id: row.modelo_id || null
      });
    }

    /* =========================================
       5) MIDIA CARTAO STRIPE
    ========================================= */
    const cartaoRes = await db.query(
      `
      SELECT
        status,
        conteudo_id AS message_id,
        modelo_id,
        'cartao' AS metodo,
        'midia' AS tipo,
        gateway,
        currency
      FROM pagamentos_cartao
      WHERE (
        stripe_payment_intent_id = $1
        OR gateway_payment_id = $1
      )
        AND conteudo_id IS NOT NULL
      LIMIT 1
      `,
      [paymentRef]
    );

    if (cartaoRes.rowCount > 0) {
      const row = cartaoRes.rows[0];

      return res.json({
        status: normalizarStatusLocal(row.status),
        raw_status: row.status,
        tipo: row.tipo,
        metodo: row.metodo,
        gateway: row.gateway || "stripe",
        currency: row.currency || null,
        message_id: row.message_id || null,
        premium_post_id: null,
        modelo_id: row.modelo_id || null
      });
    }

    /* =========================================
       6) NAO ENCONTRADO
    ========================================= */
    return res.json({
      status: "pendente",
      raw_status: null,
      tipo: null,
      metodo: null,
      gateway: null,
      currency: null,
      message_id: null,
      premium_post_id: null,
      modelo_id: null
    });

  } catch (err) {
    console.error("Erro status pagamento:", err);
    return res.status(500).json({ error: "erro ao consultar status" });
  }
});

// =============================
// ANOTACOES DO CLIENTE CHAT
// ============================

app.get("/api/chat/cliente/:cliente_id/anotacoes", authModelo, async (req, res) => {
  try {
    const cliente_id = Number(req.params.cliente_id);
    const userId = req.user.id;

    if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
      return res.status(400).json({ error: "cliente_id inválido" });
    }

    const modeloRes = await db.query(
      `SELECT id FROM modelos WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (!modeloRes.rowCount) {
      return res.status(403).json({ error: "Modelo não encontrada" });
    }

    const modelo_id = Number(modeloRes.rows[0].id);

    const result = await db.query(
      `
      SELECT
        resumo_curto,
        nota_privada,
        updated_at
      FROM cliente_notas_modelo
      WHERE modelo_id = $1
        AND cliente_id = $2
      LIMIT 1
      `,
      [modelo_id, cliente_id]
    );

    if (!result.rowCount) {
      return res.json({
        resumo_curto: "",
        nota_privada: "",
        updated_at: null
      });
    }

    return res.json(result.rows[0]);

  } catch (err) {
    console.error("Erro ao buscar anotações do cliente:", err);
    return res.status(500).json({ error: "Erro interno ao buscar anotações" });
  }
});

// ===========================
// FEED PREMIUM
// ===========================

app.get("/api/modelo/publico/:modelo_id/premium", async (req, res) => {
  try {
    const modelo_id = Number(req.params.modelo_id);

    if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
      return res.status(400).json({ error: "modelo_id inválido" });
    }

    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7)
      : null;

    let role = null;
    let userId = 0;

    if (token) {
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        role = decoded?.role || null;
        userId = Number(decoded?.id || 0);
      } catch (err) {
        role = null;
        userId = 0;
      }
    }

    let ehDona = false;
    let cliente_id = null;

    if (role === "modelo" && userId) {
      const modeloRes = await db.query(
        `
        SELECT id
        FROM modelos
        WHERE user_id = $1
        LIMIT 1
        `,
        [userId]
      );

      const modeloLogado = Number(modeloRes.rows[0]?.id || 0);
      ehDona = modeloLogado === modelo_id;
    }

    if (role === "cliente" && userId) {
      const clienteRes = await db.query(
        `
        SELECT id
        FROM clientes
        WHERE user_id = $1
        LIMIT 1
        `,
        [userId]
      );

      cliente_id = Number(clienteRes.rows[0]?.id || 0) || null;
    }

    const result = await db.query(
      `
      SELECT
        p.id,
        p.modelo_id,
        p.preco,
        p.descricao,
        p.created_at,
        CASE
          WHEN $2 = true THEN true
          WHEN $3::bigint IS NOT NULL AND EXISTS (
            SELECT 1
            FROM premium_unlocks pu
            WHERE pu.premium_post_id = p.id
              AND pu.cliente_id = $3
              AND pu.status = 'pago'
          ) THEN true
          ELSE false
        END AS liberado,
        COALESCE(
          json_agg(
            json_build_object(
              'id', pm.id,
              'url', CASE
                WHEN $2 = true THEN pm.url
                WHEN $3::bigint IS NOT NULL AND EXISTS (
                  SELECT 1
                  FROM premium_unlocks pu
                  WHERE pu.premium_post_id = p.id
                    AND pu.cliente_id = $3
                    AND pu.status = 'pago'
                ) THEN pm.url
                ELSE NULL
              END,
              'thumb_url', pm.thumb_url,
              'tipo', pm.tipo,
              'ordem', pm.ordem
            )
            ORDER BY pm.ordem ASC, pm.id ASC
          ) FILTER (WHERE pm.id IS NOT NULL),
          '[]'::json
        ) AS midias
      FROM premium_posts p
      LEFT JOIN premium_post_midias pm
        ON pm.premium_post_id = p.id
       AND pm.ativo = true
      WHERE p.modelo_id = $1
        AND p.ativo = true
      GROUP BY p.id
      ORDER BY p.created_at DESC
      `
      ,
      [modelo_id, ehDona, cliente_id]
    );

    const rows = result.rows.map(item => {
      const midias = Array.isArray(item.midias) ? item.midias : [];
      const primeiraMidia = midias[0] || null;

      return {
        id: item.id,
        modelo_id: item.modelo_id,
        preco: item.preco,
        descricao: item.descricao,
        created_at: item.created_at,
        liberado: item.liberado,
        thumb_url: primeiraMidia?.thumb_url || null,
        tipo: primeiraMidia?.tipo || null,
        url: item.liberado ? (primeiraMidia?.url || null) : null,
        midias
      };
    });

    return res.json(rows);
  } catch (err) {
    console.error("Erro listar premium:", err);
    return res.status(500).json({ error: "Erro ao carregar premium" });
  }
});

// ===========================
// PREMIUM REVALIDAR PGMTOS
// ===========================

app.get("/api/premium/:premium_post_id/status", authCliente, async (req, res) => {
  try {
    const premium_post_id = Number(req.params.premium_post_id);
    const userId = Number(req.user?.id || 0);

    if (!Number.isInteger(premium_post_id) || premium_post_id <= 0) {
      return res.status(400).json({ error: "premium_post_id inválido" });
    }

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Usuário inválido" });
    }

    const clienteRes = await db.query(
      `
      SELECT id
      FROM clientes
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (!clienteRes.rowCount) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const cliente_id = Number(clienteRes.rows[0].id);

    const result = await db.query(
      `
      SELECT
        status,
        metodo_pagamento,
        gateway,
        pagarme_order_id,
        pagarme_charge_id,
        stripe_payment_intent_id,
        stripe_charge_id,
        stripe_checkout_session_id,
        modelo_id,
        pago_em,
        updated_at
      FROM premium_unlocks
      WHERE premium_post_id = $1
        AND cliente_id = $2
      ORDER BY updated_at DESC NULLS LAST, pago_em DESC NULLS LAST
      LIMIT 1
      `,
      [premium_post_id, cliente_id]
    );

    if (!result.rows.length) {
      return res.json({
        premium_post_id,
        liberado: false,
        status: "nao_encontrado",
        metodo_pagamento: null,
        gateway: null,
        pagarme_order_id: null,
        pagarme_charge_id: null,
        stripe_payment_intent_id: null,
        stripe_charge_id: null,
        stripe_checkout_session_id: null,
        modelo_id: null,
        pago_em: null,
        updated_at: null
      });
    }

    const row = result.rows[0];
    const status = String(row.status || "").toLowerCase().trim();

    return res.json({
      premium_post_id,
      liberado: status === "pago",
      status,
      metodo_pagamento: row.metodo_pagamento || null,
      gateway: row.gateway || null,
      pagarme_order_id: row.pagarme_order_id || null,
      pagarme_charge_id: row.pagarme_charge_id || null,
      stripe_payment_intent_id: row.stripe_payment_intent_id || null,
      stripe_charge_id: row.stripe_charge_id || null,
      stripe_checkout_session_id: row.stripe_checkout_session_id || null,
      modelo_id: row.modelo_id || null,
      pago_em: row.pago_em || null,
      updated_at: row.updated_at || null
    });
  } catch (err) {
    console.error("Erro status premium:", err);
    return res.status(500).json({ error: "Erro ao consultar status" });
  }
});

// ==================================
// ROTAS PUT - ATUALIZAR DADOS
// ==================================

// ===========================
// ALTERAR PLANO ASSINATURA
// ===========================

app.put("/api/modelo/planos", authModelo, async (req, res) => {
  try {

    const { valor_mensal, desconto_trimestral } = req.body;

    const mensal = Number(valor_mensal);
    const desconto = Number(desconto_trimestral) || 0;

    if (!mensal || mensal < 20) {
      return res.status(400).json({ erro: "Valor mínimo R$ 20" });
    }

    if (desconto < 0 || desconto > 30) {
      return res.status(400).json({ erro: "Desconto inválido" });
    }

    const valorTrimestral = (mensal * 3) * (1 - desconto / 100);

    // 🔥 verificar se já existe plano
    const existe = await db.query(
      `SELECT modelo_id FROM modelos_planos WHERE modelo_id = $1`,
      [req.modelo_id]
    );

    if (existe.rows.length > 0) {
      await db.query(`
        UPDATE modelos_planos
        SET valor_mensal = $1,
            desconto_trimestral = $2,
            valor_trimestral = $3,
            updated_at = NOW()
        WHERE modelo_id = $4
      `, [mensal, desconto, valorTrimestral, req.modelo_id]);
    } else {
      await db.query(`
        INSERT INTO modelos_planos
        (modelo_id, valor_mensal, desconto_trimestral, valor_trimestral)
        VALUES ($1, $2, $3, $4)
      `, [req.modelo_id, mensal, desconto, valorTrimestral]);
    }

    res.json({ sucesso: true });

  } catch (err) {
    console.error("Erro salvar plano:", err);
    res.status(500).json({ erro: "Erro ao salvar plano" });
  }
});

// ===========================
// ALTERAR OFERTAS
// ===========================

app.put("/api/ofertas/:id/encerrar", authModelo, async (req, res) => {
  try {

    const ofertaId = Number(req.params.id);

    if (!Number.isInteger(ofertaId) || ofertaId <= 0) {
      return res.status(400).json({ erro: "ID inválido" });
    }

    const result = await db.query(
      `
      UPDATE ofertas
      SET ativa = false,
          data_fim = NOW()
      WHERE id = $1
        AND modelo_id = $2
        AND ativa = true
      RETURNING *
      `,
      [ofertaId, req.modelo_id]   // 🔥 usa direto
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ erro: "Oferta não encontrada ou já encerrada" });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("Erro encerrar oferta:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ===========================
// ALTERAR INFOS PERFIL
// ===========================

app.put("/api/modelo/me", authModelo, async (req, res) => {
  try {

    const { nome_exibicao, instagram, tiktok, local, bio } = req.body;

    if (!nome_exibicao || !nome_exibicao.trim()) {
      return res.status(400).json({
        error: "nome_exibicao é obrigatório"
      });
    }

    const nomeFinal   = nome_exibicao.trim();
    const localFinal  = local?.trim()   || null;
    const bioFinal    = bio?.trim()     || null;
    const instaFinal  = instagram?.trim() || null;
    const tiktokFinal = tiktok?.trim()   || null;

    // 🔥 Atualiza tabela modelos
    await db.query(
      `
      UPDATE modelos
      SET
        nome_exibicao = $1,
        local = $2,
        bio   = $3
      WHERE id = $4
      `,
      [nomeFinal, localFinal, bioFinal, req.modelo_id]
    );

    // 🔥 Atualiza tabela modelos_dados usando modelo_id
    await db.query(
      `
      INSERT INTO modelos_dados (modelo_id, instagram, tiktok)
      VALUES ($1, $2, $3)
      ON CONFLICT (modelo_id)
      DO UPDATE SET
        instagram = EXCLUDED.instagram,
        tiktok = EXCLUDED.tiktok
      `,
      [req.modelo_id, instaFinal, tiktokFinal]
    );

    res.json({ sucesso: true });

  } catch (err) {
    console.error("ERRO PUT /api/modelo/me:", err);
    res.status(500).json({
      erro: "Erro ao salvar dados da modelo"
    });
  }
});

// ===========================
// EDITAR CONTEUDOS?
// ===========================

// app.put("/api/conteudos/:id", authModelo, async (req, res) => {
//   const conteudo_id = Number(req.params.id);

//   if (!Number.isInteger(conteudo_id) || conteudo_id <= 0) {
//     return res.status(400).json({ error: "ID inválido" });
//   }

//   const { tipo, url, thumbnail_url } = req.body;

//   if (!tipo || !url) {
//     return res.status(400).json({
//       error: "Campos obrigatórios: tipo e url"
//     });
//   }

//   try {
//     const result = await db.query(
//       `
//       UPDATE conteudos
//       SET
//         tipo = $1,
//         url = $2,
//         thumbnail_url = $3
//       WHERE id = $4
//         AND modelo_id = $5
//       RETURNING
//         id,
//         tipo,
//         url,
//         thumbnail_url,
//         modelo_id
//       `,
//       [tipo, url, thumbnail_url || null, conteudo_id, req.modelo_id]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({
//         error: "Conteúdo não encontrado"
//       });
//     }

//     res.json(result.rows[0]);

//   } catch (err) {
//     console.error("Erro editar conteúdo:", err);
//     res.status(500).json({ error: "Erro ao editar conteúdo" });
//   }
// });


// ===========================
// EDITAR DADOS DO PERFIL
// ===========================

app.put("/api/usuario/perfil", auth, async (req, res) => {
  try {

    const {
      nome_exibicao,
      instagram,
      tiktok,
      local,
      bio
    } = req.body;


    // CLIENTE
    if (req.user.role === "cliente") {

  const clienteRes = await db.query(
    `SELECT id FROM clientes WHERE user_id = $1`,
    [req.user.id]
  );

  if (!clienteRes.rows.length) {
    return res.status(404).json({ erro: "Cliente não encontrado" });
  }

  const clienteId = clienteRes.rows[0].id;

await db.query(`
  INSERT INTO clientes_dados (
    cliente_id,
    username,
    instagram,
    tiktok,
    local,
    bio,
    atualizado_em
  )
  VALUES ($1, $2, $3, $4, $5, $6, NOW())
  ON CONFLICT (cliente_id)
  DO UPDATE SET
    username      = EXCLUDED.username,
    instagram     = EXCLUDED.instagram,
    tiktok        = EXCLUDED.tiktok,
    local         = EXCLUDED.local,
    bio           = EXCLUDED.bio,
    atualizado_em = NOW()
`, [
  clienteId,
  nome_exibicao,
  instagram || null,
  tiktok || null,
  local || null,
  bio || null
]);

  return res.json({ ok: true });
}

// MODELO

    if (req.user.role === "modelo") {

      const modeloRes = await db.query(
        `SELECT id FROM modelos WHERE user_id = $1`,
        [req.user.id]
      );

      if (!modeloRes.rows.length) {
        return res.status(404).json({ erro: "Modelo não encontrado" });
      }

      const modeloId = modeloRes.rows[0].id;

      await db.query(
        `
        UPDATE modelos
        SET
          nome_exibicao = COALESCE($1, nome_exibicao),
          local         = COALESCE($2, local),
          bio           = COALESCE($3, bio),
          atualizado_em = NOW()
        WHERE id = $4
        `,
        [
          nome_exibicao ?? null,
          local ?? null,
          bio ?? null,
          modeloId
        ]
      );

const existeDados = await db.query(
  `SELECT id FROM modelos_dados WHERE modelo_id = $1`,
  [modeloId]
);

if (existeDados.rows.length > 0) {

  // UPDATE
  await db.query(
    `
    UPDATE modelos_dados
    SET
      instagram     = COALESCE($1, instagram),
      tiktok        = COALESCE($2, tiktok),
      atualizado_em = NOW()
    WHERE modelo_id = $3
    `,
    [
      instagram ?? null,
      tiktok ?? null,
      modeloId
    ]
  );

} else {

  await db.query(
    `
    INSERT INTO modelos_dados (modelo_id, instagram, tiktok)
    VALUES ($1, $2, $3)
    `,
    [
      modeloId,
      instagram ?? null,
      tiktok ?? null
    ]
  );
}
      return res.json({ ok: true });
    }

    return res.status(403).json({ erro: "Tipo de usuário inválido" });

  } catch (err) {
    console.error("ERRO PUT /api/usuario/perfil:", err);
    res.status(500).json({ erro: "Erro ao salvar perfil" });
  }
});

// ===========================
// ATUALIZAR DADOS
// ===========================

app.put("/api/usuario/dados", auth, async (req, res) => {
  try {
    const {
      nome_completo,
      data_nascimento,
      telefone,
      endereco,
      estado,
      cidade,
      pais
    } = req.body;

    const userId = req.user.id;

 // MODELO
    if (req.user.role === "modelo") {

      const modeloRes = await db.query(
        "SELECT id FROM modelos WHERE user_id = $1",
        [userId]
      );

      if (!modeloRes.rowCount) {
        return res.status(404).json({ erro: "Modelo não encontrado" });
      }

      const modelo_id = modeloRes.rows[0].id;

      const verificacao = await db.query(`
        SELECT status
        FROM modelos_verificacao
        WHERE modelo_id = $1
        ORDER BY criado_em DESC
        LIMIT 1
      `, [modelo_id]);

      if (
        verificacao.rowCount > 0 &&
        verificacao.rows[0].status === "aprovado"
      ) {
        return res.status(403).json({
          erro: "Dados pessoais já aprovados e não podem ser alterados"
        });
      }

      await db.query(`
        INSERT INTO modelos_dados
          (modelo_id, nome_completo, data_nascimento, telefone, endereco, estado, cidade, pais, atualizado_em)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (modelo_id)
        DO UPDATE SET
          nome_completo = EXCLUDED.nome_completo,
          data_nascimento = EXCLUDED.data_nascimento,
          telefone = EXCLUDED.telefone,
          endereco = EXCLUDED.endereco,
          estado = EXCLUDED.estado,
          cidade = EXCLUDED.cidade,
          pais = EXCLUDED.pais,
          atualizado_em = NOW()
      `, [
        modelo_id,
        nome_completo?.trim() || null,
        data_nascimento || null,
        telefone?.trim() || null,
        endereco?.trim() || null,
        estado?.trim() || null,
        cidade?.trim() || null,
        pais?.trim() || null
      ]);

      return res.json({ sucesso: true });
    }

// CLIENTE

    if (req.user.role === "cliente") {

      const clienteRes = await db.query(
        "SELECT id FROM clientes WHERE user_id = $1",
        [userId]
      );

      if (!clienteRes.rowCount) {
        return res.status(404).json({ erro: "Cliente não encontrado" });
      }

      const cliente_id = clienteRes.rows[0].id;

      const verificacao = await db.query(`
        SELECT status
        FROM clientes_verificacao
        WHERE cliente_id = $1
        ORDER BY criado_em DESC
        LIMIT 1
      `, [cliente_id]);

      if (
        verificacao.rowCount > 0 &&
        verificacao.rows[0].status === "aprovado"
      ) {
        return res.status(403).json({
          erro: "Dados pessoais já aprovados e não podem ser alterados"
        });
      }

      await db.query(`
        INSERT INTO clientes_dados
          (cliente_id, nome_completo, data_nascimento, telefone, endereco, estado, cidade, pais, atualizado_em)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
        ON CONFLICT (cliente_id)
        DO UPDATE SET
          nome_completo = EXCLUDED.nome_completo,
          data_nascimento = EXCLUDED.data_nascimento,
          telefone = EXCLUDED.telefone,
          endereco = EXCLUDED.endereco,
          estado = EXCLUDED.estado,
          cidade = EXCLUDED.cidade,
          pais = EXCLUDED.pais,
          atualizado_em = NOW()
      `, [
        cliente_id,
        nome_completo?.trim() || null,
        data_nascimento || null,
        telefone?.trim() || null,
        endereco?.trim() || null,
        estado?.trim() || null,
        cidade?.trim() || null,
        pais?.trim() || null
      ]);

      return res.json({ sucesso: true });
    }

    return res.status(403).json({ erro: "Role inválida" });

  } catch (err) {
    console.error("ERRO PUT /api/usuario/dados:", err);
    res.status(500).json({ erro: err.message });
  }
});

// ===========================
// ATUALIZAR INFOS CLIENTE
// ===========================

app.put("/api/cliente/dados", authCliente, async (req, res) => {
  try {

    const {
      username,
      instagram,
      tiktok,
      local,
      bio
    } = req.body;

    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "Username obrigatório." });
    }

    await db.query(`
      INSERT INTO clientes_dados (
        cliente_id,
        username,
        instagram,
        tiktok,
        local,
        bio,
        criado_em,
        atualizado_em
      )
      VALUES ($1,$2,$3,$4,$5,$6,NOW(),NOW())
      ON CONFLICT (cliente_id)
      DO UPDATE SET
        username = COALESCE(EXCLUDED.username, clientes_dados.username),
        instagram = COALESCE(EXCLUDED.instagram, clientes_dados.instagram),
        tiktok = COALESCE(EXCLUDED.tiktok, clientes_dados.tiktok),
        local = COALESCE(EXCLUDED.local, clientes_dados.local),
        bio = COALESCE(EXCLUDED.bio, clientes_dados.bio),
        atualizado_em = NOW()
    `, [
      req.cliente_id,
      username.trim(),
      instagram || null,
      tiktok || null,
      local || null,
      bio || null
    ]);

    res.json({ success: true });

  } catch (err) {
    console.error("Erro atualizar dados cliente:", err);
    res.status(500).json({ error: "Erro interno." });
  }
});

// ===========================
// CANCELAR VIP
// ===========================

app.put("/api/cliente/subscricoes/:id/cancelar", auth, async (req, res) => {
  try {

    const subscriptionId = req.params.id;

    const clienteRes = await db.query(
      "SELECT id FROM clientes WHERE user_id = $1",
      [req.user.id]
    );

    if (!clienteRes.rowCount) {
      return res.status(404).json({ error: "Cliente não encontrado." });
    }

    const clienteId = clienteRes.rows[0].id;

    const subRes = await db.query(
      `SELECT id, ativo 
       FROM vip_subscriptions
       WHERE id = $1 AND cliente_id = $2`,
      [subscriptionId, clienteId]
    );

    if (!subRes.rowCount) {
      return res.status(403).json({ error: "Subscrição inválida." });
    }

    if (!subRes.rows[0].ativo) {
      return res.status(400).json({ error: "Esta subscrição já está cancelada." });
    }

    await db.query(
      `UPDATE vip_subscriptions
       SET recorrente = false,
           ativo = false
       WHERE id = $1`,
      [subscriptionId]
    );

    return res.status(200).json({
      success: true,
      message: "Subscrição cancelada com sucesso."
    });

  } catch (err) {
    console.error("Erro ao cancelar:", err);
    return res.status(500).json({
      error: "Erro interno ao cancelar subscrição."
    });
  }
});

// =============================
// ATUALIZAR INFOS CLT CHAT
// ============================

app.put("/api/chat/cliente/:cliente_id/anotacoes", authModelo, async (req, res) => {
  try {
    const cliente_id = Number(req.params.cliente_id);
    const userId = req.user.id;

    if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
      return res.status(400).json({ error: "cliente_id inválido" });
    }

    let { resumo_curto, nota_privada } = req.body || {};

    resumo_curto = String(resumo_curto || "").trim();
    nota_privada = String(nota_privada || "").trim();

    if (resumo_curto.length > 120) {
      return res.status(400).json({ error: "Resumo curto deve ter no máximo 120 caracteres" });
    }

    const modeloRes = await db.query(
      `SELECT id FROM modelos WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    if (!modeloRes.rowCount) {
      return res.status(403).json({ error: "Modelo não encontrada" });
    }

    const modelo_id = Number(modeloRes.rows[0].id);

    const result = await db.query(
      `
      INSERT INTO cliente_notas_modelo (
        modelo_id,
        cliente_id,
        resumo_curto,
        nota_privada,
        updated_at
      )
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (modelo_id, cliente_id)
      DO UPDATE SET
        resumo_curto = EXCLUDED.resumo_curto,
        nota_privada = EXCLUDED.nota_privada,
        updated_at = NOW()
      RETURNING
        resumo_curto,
        nota_privada,
        updated_at
      `,
      [modelo_id, cliente_id, resumo_curto || null, nota_privada || null]
    );

    return res.json({
      ok: true,
      ...result.rows[0]
    });

  } catch (err) {
    console.error("Erro ao salvar anotações do cliente:", err);
    return res.status(500).json({ error: "Erro interno ao salvar anotações" });
  }
});

// ================================
// APP POST - CRIAR/ENVIAR DADOS
// ===============================

// ===========================
// UPLOAD MIDIA - FEED
// ===========================

app.post("/api/upload", auth, authModelo, uploadLimiter, uploadB2.array("file", 10), async (req, res) => {

    try {

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: "Arquivo não enviado" });
      }

      const modeloRes = await db.query(
        `SELECT id, verificada FROM modelos WHERE user_id = $1`,
        [req.user.id]
      );

      if (modeloRes.rowCount === 0) {
        return res.status(404).json({ error: "Modelo não encontrado" });
      }

      if (!modeloRes.rows[0].verificada) {
        return res.status(403).json({ error: "Conta não verificada. Apenas modelos verificadas podem fazer upload de mídia." });
      }

      const modelo_id = modeloRes.rows[0].id;

      const { tipo_conteudo, preco, descricao } = req.body;
      const tipoFinal = tipo_conteudo || "feed";

      for (const file of req.files) {

        const mimetype = file.mimetype || "";

        let tipo;
        let publicUrl = null;
        let thumbnailUrl = null;

        if (mimetype.startsWith("image/")) {
          tipo = "imagem";
        } 
        else if (mimetype.startsWith("video/")) {
          tipo = "video";
        } 
        else {
          continue;
        }

        const bucket = tipoFinal === "venda" ? "venda" : "feed";

        if (tipo === "imagem") {
          const result = await uploadToSupabase(file.buffer, file.mimetype, file.originalname, bucket);
          publicUrl = result.url;
          thumbnailUrl = result.thumb_url;
        }

        if (tipo === "video") {
          const result = await uploadToSupabase(file.buffer, file.mimetype, file.originalname, bucket);
          publicUrl = result.url;
          thumbnailUrl = result.thumb_url;
        }

        await db.query(
          `
          INSERT INTO conteudos
          (modelo_id, url, thumbnail_url, tipo, tipo_conteudo, preco, descricao)
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          `,
          [
            modelo_id,
            publicUrl,
            thumbnailUrl,
            tipo,
            tipoFinal,
            preco ? Number(preco) : null,
            descricao || null
          ]
        );
      }

      res.json({ success: true });

    } catch (err) {

      console.error("Erro /api/upload:", err);

      res.status(500).json({
        error: "Erro interno"
      });

    }
  }
);

// ===========================
// INSERIR OFERTAS
// ===========================

app.post("/api/ofertas", authModelo, async (req, res) => {
  try {

    const userId = req.user.id;

    const modeloRes = await db.query(
      `SELECT id FROM modelos WHERE user_id = $1`,
      [userId]
    );

    if (modeloRes.rowCount === 0) {
      return res.status(404).json({ erro: "Modelo não encontrado" });
    }

    const modeloId = modeloRes.rows[0].id;

    const planoRes = await db.query(
      `SELECT valor_mensal FROM modelos_planos WHERE modelo_id = $1`,
      [modeloId]
    );

    if (planoRes.rowCount === 0) {
      return res.status(400).json({
        erro: "Defina primeiro o plano de assinatura."
      });
    }

    const VALOR_BASE = Number(planoRes.rows[0].valor_mensal);
    const VALOR_MINIMO = Number((VALOR_BASE * 0.5).toFixed(2));

    const { nome, limite, dias, desconto } = req.body;

    const limiteNum = Number(limite);
    const diasNum = Number(dias);
    const descontoNum = Number(desconto);

    if (
      !nome ||
      !Number.isFinite(limiteNum) || limiteNum <= 0 ||
      !Number.isFinite(diasNum) || diasNum <= 0 ||
      !Number.isFinite(descontoNum) || descontoNum < 0 || descontoNum > 50
    ) {
      return res.status(400).json({ erro: "Dados inválidos" });
    }

    let valorPromocional = Number(
      (VALOR_BASE * (1 - descontoNum / 100)).toFixed(2)
    );

    if (valorPromocional < VALOR_MINIMO) {
      valorPromocional = VALOR_MINIMO;
    }

    const dataFim = new Date();
    dataFim.setDate(dataFim.getDate() + diasNum);

    await db.query(
      `UPDATE ofertas SET ativa = false WHERE modelo_id = $1`,
      [modeloId]
    );

    const result = await db.query(
      `
     INSERT INTO ofertas (
  modelo_id,
  nome,
  limite_assinaturas,
  assinaturas_usadas,
  desconto_percentual,
  valor_base,
  valor_promocional,
  data_inicio,
  data_fim,
  ativa
)
VALUES ($1,$2,$3,0,$4,$5,$6,NOW(),$7,true)
RETURNING *
      `,
      [
        modeloId,
        nome,
        limiteNum,
        descontoNum,
        VALOR_BASE,
        valorPromocional,
        dataFim
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console.error("🔥 ERRO AO CRIAR OFERTA 🔥", err);
    res.status(500).json({ erro: "Erro interno ao criar oferta" });
  }
});

// ===========================
// DADOS.HTML CLIENTE
// ===========================

app.post("/api/cliente/dados", authCliente, async (req, res) => {
  try {
    const {
      username,
      nome_completo,
      data_nascimento,
      pais,
      nome_exibicao,
      instagram,
      tiktok,
      local,
      bio,
      avatar,
      avatar_thumb,
      capa
    } = req.body;

    const clienteRes = await db.query(
      `
      SELECT id
      FROM clientes
      WHERE id = $1
        AND ativo = true
      LIMIT 1
      `,
      [req.cliente_id]
    );

    if (clienteRes.rowCount === 0) {
      return res.status(404).json({ error: "Cliente não encontrado ou desativado" });
    }

    await db.query(
      `
      INSERT INTO clientes_dados (
        cliente_id,
        username,
        nome_completo,
        data_nascimento,
        pais,
        nome_exibicao,
        instagram,
        tiktok,
        local,
        bio,
        avatar,
        avatar_thumb,
        capa,
        ativo,
        criado_em,
        atualizado_em
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,true,NOW(),NOW()
      )
      ON CONFLICT (cliente_id)
      DO UPDATE SET
        username = EXCLUDED.username,
        nome_completo = EXCLUDED.nome_completo,
        data_nascimento = EXCLUDED.data_nascimento,
        pais = EXCLUDED.pais,
        nome_exibicao = EXCLUDED.nome_exibicao,
        instagram = EXCLUDED.instagram,
        tiktok = EXCLUDED.tiktok,
        local = EXCLUDED.local,
        bio = EXCLUDED.bio,
        avatar = EXCLUDED.avatar,
        avatar_thumb = EXCLUDED.avatar_thumb,
        capa = EXCLUDED.capa,
        ativo = true,
        desativado_em = NULL,
        atualizado_em = NOW()
      `,
      [
        req.cliente_id,
        username || null,
        nome_completo || null,
        data_nascimento || null,
        pais || null,
        nome_exibicao || null,
        instagram || null,
        tiktok || null,
        local || null,
        bio || null,
        avatar || null,
        avatar_thumb || null,
        capa || null
      ]
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("Erro salvar dados cliente:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// CADASTRO
// ===========================

// ── POST /api/pre-registro/enviar-codigo ─────────────────────────────────────
app.post("/api/pre-registro/enviar-codigo", authLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    const emailNormalizado = email?.trim().toLowerCase();

    if (!emailNormalizado || !emailValido(emailNormalizado)) {
      return res.status(400).json({ erro: "Email inválido" });
    }

    // Verificar se email já está registrado e ativo
    const check = await db.query(
      "SELECT id FROM users WHERE email = $1 AND ativo IS DISTINCT FROM false",
      [emailNormalizado]
    );
    if (check.rowCount > 0) {
      return res.status(409).json({ erro: "Este email já tem uma conta registada. Faz login." });
    }

    // Rate-limit: não reenviar se último envio foi há menos de 60 s
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
    return res.status(500).json({ erro: "Erro ao enviar email de verificação. Tenta novamente." });
  }
});

// ── POST /api/pre-registro/verificar-codigo ──────────────────────────────────
app.post("/api/pre-registro/verificar-codigo", authLimiter, async (req, res) => {
  try {
    const { email, codigo } = req.body;
    const emailNormalizado = email?.trim().toLowerCase();

    if (!emailNormalizado || !codigo) {
      return res.status(400).json({ erro: "Email e código são obrigatórios." });
    }

    const entry = otpPreRegistro.get(emailNormalizado);

    if (!entry) {
      return res.status(400).json({ erro: "Nenhum código foi enviado para este email. Solicita um novo." });
    }

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

    // OTP válido — gerar pre-token com validade de 30 min para preenchimento do formulário
    const preToken = crypto.randomBytes(24).toString("hex");
    entry.verificado = true;
    entry.preToken   = preToken;
    entry.expiresAt  = Date.now() + 30 * 60 * 1_000;

    return res.json({ ok: true, preToken });
  } catch (err) {
    console.error("Erro ao verificar OTP:", err);
    return res.status(500).json({ erro: "Erro interno. Tenta novamente." });
  }
});
// ──────────────────────────────────────────────────────────────────────────────

app.post("/api/register", authLimiter, async (req, res) => {
  try {
    const {
      email,
      senha,
      role,
      nome_completo,
      data_nascimento,
      ageConfirmed,
      preToken,
      ref,
      src
    } = req.body;

    const emailNormalizado = email?.trim().toLowerCase();

    if (!emailNormalizado || !senha || !role || !nome_completo || !data_nascimento) {
      return res.status(400).json({
        erro: "Todos os campos obrigatórios devem ser preenchidos"
      });
    }

    if (!emailValido(emailNormalizado)) {
      return res.status(400).json({ erro: "Email inválido" });
    }

    // ── Verificar pré-token OTP ───────────────────────────────────────────────
    if (!preToken) {
      return res.status(400).json({ erro: "Verificação de email obrigatória. Inicia o processo novamente." });
    }
    const otpEntry = otpPreRegistro.get(emailNormalizado);
    if (
      !otpEntry ||
      !otpEntry.verificado ||
      otpEntry.preToken !== preToken ||
      Date.now() > otpEntry.expiresAt
    ) {
      return res.status(400).json({ erro: "Sessão de verificação expirada ou inválida. Inicia o processo novamente." });
    }
    // ──────────────────────────────────────────────────────────────────────────

    if (!["modelo", "cliente"].includes(role)) {
      return res.status(400).json({ erro: "Tipo de conta inválido" });
    }

    if (ageConfirmed !== true) {
      return res.status(400).json({
        erro: "Confirmação de idade obrigatória (+18)"
      });
    }

    const nascimento = new Date(data_nascimento);
    const hoje = new Date();

    let idade = hoje.getFullYear() - nascimento.getFullYear();
    const mesDiff = hoje.getMonth() - nascimento.getMonth();

    if (
      mesDiff < 0 ||
      (mesDiff === 0 && hoje.getDate() < nascimento.getDate())
    ) {
      idade--;
    }

    if (idade < 18) {
      return res.status(400).json({
        erro: "É necessário ter 18 anos ou mais para se registrar"
      });
    }

    // ── Verificação de email existente ──────────────────────────────────────
    const emailCheck = await db.query(
      `SELECT id, ativo, motivo_desativacao, autoexcluida_em
       FROM users
       WHERE email = $1`,
      [emailNormalizado]
    );

    if (emailCheck.rowCount > 0) {
      const existing = emailCheck.rows[0];

      // Conta ativa → bloqueado sempre
      if (existing.ativo !== false) {
        return res.status(409).json({ erro: "Email já registrado" });
      }

      // Desativada por admin / bloqueada → bloqueado sempre
      if (existing.motivo_desativacao !== "autoexclusao" || !existing.autoexcluida_em) {
        return res.status(409).json({ erro: "Email já registrado" });
      }

      // Autoexclusão: verificar carência de 30 dias
      const diasDesdeExclusao = Math.floor(
        (Date.now() - new Date(existing.autoexcluida_em).getTime()) / (1000 * 60 * 60 * 24)
      );

      if (diasDesdeExclusao < 30) {
        const diasRestantes = 30 - diasDesdeExclusao;
        return res.status(409).json({
          erro: `Conta excluída recentemente. Você poderá criar uma nova conta em ${diasRestantes} dia${diasRestantes > 1 ? "s" : ""}.`
        });
      }

      // 30+ dias após autoexclusão → anonimiza o email antigo e libera o cadastro
      await db.query(
        `UPDATE users SET email = $1 WHERE id = $2`,
        [`deleted_${existing.id}@velvet.lat`, existing.id]
      );
    }
    // ────────────────────────────────────────────────────────────────────────

    const hash = await bcrypt.hash(senha, 10);

    const userResult = await db.query(
      `
      INSERT INTO public.users
        (email, password_hash, role, age_confirmed, age_confirmed_at, email_verificado)
      VALUES
        ($1, $2, $3, true, NOW(), TRUE)
      RETURNING id, token_version
      `,
      [emailNormalizado, hash, role]
    );

    const userId = userResult.rows[0].id;
    const tokenVersion = userResult.rows[0].token_version;

    let modeloId = null;
    let clienteId = null;

    const nomePublico = nome_completo.split(" ")[0];


    // MODELO
    if (role === "modelo") {

      const modeloResult = await db.query(
        `
        INSERT INTO public.modelos
          (user_id, nome, verificada, email_enviado_em, prazo_validacao)
        VALUES
          ($1, $2, 'false', NOW(), NOW() + INTERVAL '14 days')
        RETURNING id
        `,
        [userId, nomePublico]
      );

      modeloId = modeloResult.rows[0].id;

      await db.query(
        `
        INSERT INTO public.modelos_dados
          (modelo_id, nome_completo, data_nascimento, criado_em, atualizado_em)
        VALUES
          ($1, $2, $3, NOW(), NOW())
        `,
        [modeloId, nome_completo, data_nascimento]
      );

      console.log("📩 Tentando enviar email para:", emailNormalizado);
      await enviarEmailBoasVindasModelo(emailNormalizado, nome_completo);
    }

    // CLIENTE
    if (role === "cliente") {

      const clienteResult = await db.query(
        `
        INSERT INTO public.clientes
          (user_id, nome, origem_trafego, ref_modelo)
        VALUES
          ($1, $2, $3, $4)
        RETURNING id
        `,
        [
          userId,
          nomePublico,
          src || null,
          ref ? Number(ref) : null
        ]
      );

      clienteId = clienteResult.rows[0].id;

      await db.query(
        `
        INSERT INTO public.clientes_dados
          (cliente_id, username, nome_completo, data_nascimento, criado_em, atualizado_em)
        VALUES
          ($1, $2, $3, $4, NOW(), NOW())
        `,
        [
          clienteId,
          nomePublico,
          nome_completo,
          data_nascimento
        ]
      );

      console.log("📩 Tentando enviar email de boas-vindas para:", emailNormalizado);
      await enviarEmailBoasVindasCliente(emailNormalizado, nome_completo);
    }

    // ── Email verificado via OTP pré-registo — limpar entrada do mapa ────
    otpPreRegistro.delete(emailNormalizado);
    // ─────────────────────────────────────────────────────────────────────

    // GERAR TOKEN

    const token = jwt.sign(
      {
        id: userId,
        email: emailNormalizado,
        role,
        tv: tokenVersion
      },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.status(201).json({
      token,
      role,
      modelo_id: modeloId,
      cliente_id: clienteId
    });

  } catch (err) {
    console.error("ERRO REGISTER:", err);

    if (err.code === "23505") {
      return res.status(409).json({ erro: "Email já registrado" });
    }

    return res.status(500).json({
      erro: "Erro interno no servidor"
    });
  }
});

// ===========================
// LOGOUT
// ===========================
app.post("/api/logout", auth, async (req, res) => {
  try {
    await db.query(
      `UPDATE users SET token_version = token_version + 1 WHERE id = $1`,
      [req.user.id]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro logout:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// LOGIN
// ===========================
app.post("/api/login", authLimiter, async (req, res) => {
  try {
    let { email, senha } = req.body;

    email = email?.trim().toLowerCase();
    senha = senha?.trim();

    if (!email || !senha) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    const result = await db.query(
      `SELECT id, email, password_hash, role, ativo, token_version
       FROM public.users
       WHERE LOWER(email) = LOWER($1)
       LIMIT 1`,
      [email]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: "Usuário não encontrado" });
    }

    const user = result.rows[0];

    if (user.ativo === false) {
      return res.status(403).json({ error: "Conta desativada" });
    }

    const senhaOk = await bcrypt.compare(senha, user.password_hash);
    if (!senhaOk) {
      return res.status(401).json({ error: "Senha incorreta" });
    }

    const role = String(user.role || "").toLowerCase();

    if (role === "modelo") {
      const modeloRes = await db.query(
        `SELECT id, ativo
         FROM modelos
         WHERE user_id = $1
         LIMIT 1`,
        [user.id]
      );

      if (modeloRes.rowCount === 0) {
        return res.status(400).json({ error: "Modelo não encontrado" });
      }

      if (modeloRes.rows[0].ativo === false) {
        return res.status(403).json({ error: "Conta desativada" });
      }

      const token = jwt.sign(
        { id: user.id, email: user.email, role, tv: user.token_version },
        process.env.JWT_SECRET,
        { expiresIn: "30d" }
      );

      return res.json({
        token,
        role,
        modelo_id: modeloRes.rows[0].id
      });
    }

    if (role === "cliente") {
      const clienteRes = await db.query(
        `SELECT id, ativo
         FROM clientes
         WHERE user_id = $1
         LIMIT 1`,
        [user.id]
      );

      if (clienteRes.rowCount === 0) {
        return res.status(400).json({ error: "Cliente não encontrado" });
      }

      if (clienteRes.rows[0].ativo === false) {
        return res.status(403).json({ error: "Conta desativada" });
      }
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role, tv: user.token_version },
      process.env.JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({ token, role });

  } catch (err) {
    console.error("🔥 ERRO LOGIN:", err);
    return res.status(500).json({ error: "Erro interno no login" });
  }
});

// ===========================
// AVATAR
// ===========================

app.post( "/uploadAvatar", auth, uploadAvatarLimiter, uploadB2.single("avatar"), async (req, res) => {

    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo não enviado" });
      }

      const userId = req.user.id;

      const { mimetype, originalname, buffer } = req.file;

      const ext = originalname.split(".").pop();
      const caminho = `${userId}/${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabaseStorage.storage
        .from("avatars")
        .upload(caminho, buffer, { contentType: mimetype, upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: { publicUrl: avatarUrl } } = supabaseStorage.storage
        .from("avatars")
        .getPublicUrl(caminho);

      // ==============================
      // MODELO
      // ==============================
      if (req.user.role === "modelo") {

        const modeloRes = await db.query(
          "SELECT id FROM modelos WHERE user_id = $1",
          [userId]
        );

        if (!modeloRes.rowCount) {
          return res.status(404).json({ error: "Modelo não encontrado" });
        }

        const modelo_id = modeloRes.rows[0].id;

        await db.query(
          "UPDATE modelos SET avatar = $1 WHERE id = $2",
          [avatarUrl, modelo_id]
        );
      }

      // ==============================
      // CLIENTE
      // ==============================
      else if (req.user.role === "cliente") {

        const clienteRes = await db.query(
          "SELECT id FROM clientes WHERE user_id = $1",
          [userId]
        );

        if (!clienteRes.rowCount) {
          return res.status(404).json({ error: "Cliente não encontrado" });
        }

        const cliente_id = clienteRes.rows[0].id;

        await db.query(
          `
          UPDATE clientes_dados
          SET avatar = $1,
              atualizado_em = NOW()
          WHERE cliente_id = $2
          `,
          [avatarUrl, cliente_id]
        );
      }

      else {
        return res.status(403).json({ error: "Role inválida" });
      }

      res.json({ avatar: avatarUrl });

    } catch (err) {
      console.error("Erro upload avatar:", err);
      res.status(500).json({ error: "Erro ao atualizar avatar" });
    }
  }
);

// ===========================
// CAPA
// ===========================

app.post( "/uploadCapa", auth, uploadAvatarLimiter, uploadB2.single("capa"),  async (req, res) => {

    try {
      if (!req.file) {
        return res.status(400).json({ error: "Arquivo não enviado" });
      }

      const userId = req.user.id;
      const { mimetype, originalname, buffer } = req.file;

      // 🔥 caminho único (evita cache)
      const ext = originalname.split(".").pop();
      const caminho = `${userId}/${Date.now()}.${ext}`;

      const { error: uploadErr } = await supabaseStorage.storage
        .from("capas")
        .upload(caminho, buffer, { contentType: mimetype, upsert: true });

      if (uploadErr) throw uploadErr;

      const { data: { publicUrl: url } } = supabaseStorage.storage
        .from("capas")
        .getPublicUrl(caminho);

      // ==============================
      // MODELO
      // ==============================
      if (req.user.role === "modelo") {

        await db.query(
          "UPDATE modelos SET capa = $1 WHERE user_id = $2",
          [url, userId]
        );

      }

      // ==============================
      // CLIENTE
      // ==============================
      else if (req.user.role === "cliente") {

        const clienteRes = await db.query(
          "SELECT id FROM clientes WHERE user_id = $1",
          [userId]
        );

        if (!clienteRes.rowCount) {
          return res.status(404).json({ error: "Cliente não encontrado" });
        }

        const cliente_id = clienteRes.rows[0].id;

        await db.query(
          `
          UPDATE clientes_dados
          SET capa = $1,
              atualizado_em = NOW()
          WHERE cliente_id = $2
          `,
          [url, cliente_id]
        );
      }

      else {
        return res.status(403).json({ error: "Role inválida" });
      }

      res.json({ capa: url });

    } catch (err) {
      console.error("Erro upload capa:", err);
      res.status(500).json({ error: "Erro ao atualizar capa" });
    }
  }
);

// ===========================
// DADOS MODELO
// ===========================

app.post("/api/modelo/dados", auth, authModelo, async (req, res) => {
  try {
    let {
      nome_exibicao,
      nome_completo,
      data_nascimento,
      telefone,
      endereco,
      pais,
      instagram,
      tiktok
    } = req.body;

    instagram = instagram?.replace("@", "").trim() || null;
    tiktok = tiktok?.replace("@", "").trim() || null;

    if (
      !nome_exibicao ||
      !nome_completo ||
      !data_nascimento ||
      !telefone ||
      !endereco ||
      !pais
    ) {
      return res.status(400).json({ error: "Dados obrigatórios em falta" });
    }

    const userId = req.user.id;

    const modeloRes = await db.query(
      `
      SELECT id
      FROM modelos
      WHERE user_id = $1
        AND ativo = true
      LIMIT 1
      `,
      [userId]
    );

    if (modeloRes.rowCount === 0) {
      return res.status(404).json({ error: "Modelo não encontrado ou desativado" });
    }

    const modelo_id = modeloRes.rows[0].id;

    await db.query(
      `
      INSERT INTO modelos_dados (
        modelo_id,
        nome_exibicao,
        nome_completo,
        data_nascimento,
        telefone,
        endereco,
        pais,
        instagram,
        tiktok,
        ativo,
        criado_em,
        atualizado_em
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),NOW()
      )
      ON CONFLICT (modelo_id)
      DO UPDATE SET
        nome_exibicao = EXCLUDED.nome_exibicao,
        nome_completo = EXCLUDED.nome_completo,
        data_nascimento = EXCLUDED.data_nascimento,
        telefone = EXCLUDED.telefone,
        endereco = EXCLUDED.endereco,
        pais = EXCLUDED.pais,
        instagram = EXCLUDED.instagram,
        tiktok = EXCLUDED.tiktok,
        ativo = true,
        desativado_em = NULL,
        atualizado_em = NOW()
      `,
      [
        modelo_id,
        nome_exibicao,
        nome_completo,
        data_nascimento,
        telefone,
        endereco,
        pais,
        instagram,
        tiktok
      ]
    );

    await db.query(
      `
      UPDATE modelos
      SET nome_exibicao = $1
      WHERE id = $2
        AND ativo = true
      `,
      [nome_exibicao, modelo_id]
    );

    return res.json({ success: true });

  } catch (err) {
    console.error("Erro salvar dados modelo:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// EXCLUIR MIDIA DE CONTEUDOS
// ===========================

app.delete("/api/conteudos/:id", authModelo, async (req, res) => {
  const userId = req.user.id;
  const conteudo_id = Number(req.params.id);

  try {

    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [userId]
    );

    if (modeloRes.rowCount === 0) {
      return res.status(404).json({ error: "Modelo não encontrado" });
    }

    const modelo_id = modeloRes.rows[0].id;

    const result = await db.query(
      `
      UPDATE conteudos
      SET ativo = FALSE,
          deletado_em = NOW()
      WHERE id = $1
        AND modelo_id = $2
      RETURNING id
      `,
      [conteudo_id, modelo_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Conteúdo não encontrado ou não pertence ao modelo"
      });
    }

    res.json({ success: true });

  } catch (err) {
    console.error("Erro desativar conteúdo:", err);
    res.status(500).json({ error: "Erro ao desativar conteúdo" });
  }
});

// ===========================
// EXCLUIR CONTA
// ===========================

app.delete("/api/conta/excluir", auth, async (req, res) => {
  const userId = req.user.id;
  const role = req.user.role;
  const senhaInformada = req.body.senha;

  if (!senhaInformada) {
    return res.status(400).json({ error: "Senha obrigatória" });
  }

  const ip =
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket?.remoteAddress ||
    null;

  const userAgent = req.headers["user-agent"] || null;

  const client = await db.connect();

  try {
    const userRes = await client.query(
      `SELECT id, password_hash, ativo
       FROM users
       WHERE id = $1`,
      [userId]
    );

    if (userRes.rowCount === 0) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const usuario = userRes.rows[0];

    if (usuario.ativo === false) {
      return res.status(400).json({ error: "Conta já desativada" });
    }

    const senhaOk = await bcrypt.compare(
      senhaInformada,
      usuario.password_hash
    );

    if (!senhaOk) {
      return res.status(401).json({ error: "Senha inválida" });
    }

    await client.query("BEGIN");

    let modelo_id = null;
    let cliente_id = null;
    let agencia_id = null;
    let detalhes = {
      desativacao_logica: true,
      users: true,
      modelos: false,
      modelos_dados: false,
      clientes: false,
      clientes_dados: false,
      conteudos: false,
      messages_marcadas_deletadas: false,
      vip_subscriptions_encerradas: false
    };

    // ===========================
    // MODELO
    // ===========================
    if (role === "modelo") {
      const modeloRes = await client.query(
        `SELECT id
         FROM modelos
         WHERE user_id = $1`,
        [userId]
      );

      if (modeloRes.rowCount > 0) {
        modelo_id = modeloRes.rows[0].id;

        await client.query(
          `UPDATE messages
           SET deletada = true
           WHERE modelo_id = $1`,
          [modelo_id]
        );

        await client.query(
          `UPDATE vip_subscriptions
           SET ativo = false,
               updated_at = NOW()
           WHERE modelo_id = $1
             AND ativo = true`,
          [modelo_id]
        );

        await client.query(
          `UPDATE conteudos
           SET ativo = false,
               desativado_em = NOW()
           WHERE modelo_id = $1`,
          [modelo_id]
        );

        await client.query(
          `UPDATE modelos_dados
           SET ativo = false,
               desativado_em = NOW()
           WHERE modelo_id = $1`,
          [modelo_id]
        );

        await client.query(
          `UPDATE modelos
           SET ativo = false,
               desativado_em = NOW()
           WHERE id = $1`,
          [modelo_id]
        );

        detalhes.modelos = true;
        detalhes.modelos_dados = true;
        detalhes.conteudos = true;
        detalhes.messages_marcadas_deletadas = true;
        detalhes.vip_subscriptions_encerradas = true;
      }
    }

    // ===========================
    // CLIENTE
    // ===========================
    if (role === "cliente") {
      const clienteRes = await client.query(
        `SELECT id
         FROM clientes
         WHERE user_id = $1`,
        [userId]
      );

      if (clienteRes.rowCount > 0) {
        cliente_id = clienteRes.rows[0].id;

        await client.query(
          `UPDATE messages
           SET deletada = true
           WHERE cliente_id = $1`,
          [cliente_id]
        );

        await client.query(
          `UPDATE vip_subscriptions
           SET ativo = false,
               updated_at = NOW()
           WHERE cliente_id = $1
             AND ativo = true`,
          [cliente_id]
        );

        await client.query(
          `UPDATE clientes_dados
           SET ativo = false,
               desativado_em = NOW()
           WHERE cliente_id = $1`,
          [cliente_id]
        );

        await client.query(
          `UPDATE clientes
           SET ativo = false,
               desativado_em = NOW()
           WHERE id = $1`,
          [cliente_id]
        );

        detalhes.clientes = true;
        detalhes.clientes_dados = true;
        detalhes.messages_marcadas_deletadas = true;
        detalhes.vip_subscriptions_encerradas = true;
      }
    }

    // ===========================
    // AGÊNCIA
    // ===========================
    if (role === "agencia") {
      const agenciaRes = await client.query(
        `SELECT id
         FROM agencias
         WHERE user_id = $1`,
        [userId]
      );

      if (agenciaRes.rowCount > 0) {
        agencia_id = agenciaRes.rows[0].id;

        await client.query(
          `UPDATE agencias
           SET ativo = false,
               desativado_em = NOW()
           WHERE id = $1`,
          [agencia_id]
        );

        detalhes.agencias = true;
      }
    }

    // ===========================
    // USER
    // ===========================
    await client.query(
      `UPDATE users
       SET ativo = false,
           desativado_em = NOW(),
           autoexcluida_em = NOW(),
           motivo_desativacao = $2,
           desativado_por = $3
       WHERE id = $1`,
      [userId, "autoexclusao", "proprio_usuario"]
    );

    // ===========================
    // LOG - CONTA_EXCLUSOES_LOG
    // ===========================
    await client.query(
      `INSERT INTO conta_exclusoes_log
       (
         user_id,
         role,
         modelo_id,
         cliente_id,
         motivo,
         solicitado_em,
         ip,
         user_agent,
         origem,
         detalhes
       )
       VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8, $9)`,
      [
        userId,
        role,
        modelo_id,
        cliente_id,
        "autoexclusao",
        ip,
        userAgent,
        "/api/conta/excluir",
        JSON.stringify(detalhes)
      ]
    );

    // ===========================
    // LOG - ADMIN_SEGURANCA_HISTORICO
    // ===========================
    const motivo = `Autoexclusão de conta - Role: ${role}${modelo_id ? `, Modelo ID: ${modelo_id}` : ''}${cliente_id ? `, Cliente ID: ${cliente_id}` : ''}${agencia_id ? `, Agência ID: ${agencia_id}` : ''}`;

    await client.query(
      `INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
       VALUES ($1, $2, NOW(), $3, $4, $5)`,
      [
        userId, 
        motivo,
        userId,
        role,
        "autoexclusao"
      ]
    );

    await client.query("COMMIT");

    return res.json({
      ok: true,
      message: "Conta desativada com sucesso"
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ERRO DESATIVAR CONTA:", err);
    return res.status(500).json({ error: "Erro ao desativar conta" });
  } finally {
    client.release();
  }
});

// ===========================
// EXCLUIR PCT MIDIA CHAT
// ===========================

app.delete("/api/chat/pacote/:message_id", authModelo, async (req, res) => {

  const message_id = Number(req.params.message_id);

  if (!Number.isInteger(message_id)) {
    return res.status(400).json({ error: "message_id inválido" });
  }

  try {

    const msgRes = await db.query(`
      SELECT id, modelo_id, cliente_id, visto
      FROM messages
      WHERE id = $1
    `, [message_id]);

    if (!msgRes.rowCount) {
      return res.status(404).json({ error: "Mensagem não encontrada" });
    }

    const mensagem = msgRes.rows[0];

    if (mensagem.modelo_id !== req.modelo_id) {
      return res.status(403).json({ error: "Acesso negado" });
    }

    if (mensagem.visto === true) {
      return res.status(400).json({
        error: "Conteúdo já visualizado não pode ser excluído."
      });
    }

    const pagoRes = await db.query(`
      SELECT 1
      FROM conteudo_pacotes
      WHERE message_id = $1
      AND status = 'pago'
      LIMIT 1
    `, [message_id]);

    if (pagoRes.rowCount > 0) {
      return res.status(400).json({
        error: "Conteúdo já pago não pode ser excluído."
      });
    }

    // marcar deletada
    await db.query(`
      UPDATE messages
      SET deletada = true
      WHERE id = $1
    `, [message_id]);

    io.to(`chat_${mensagem.cliente_id}_${mensagem.modelo_id}`)
      .emit("mensagemExcluida", { id: message_id });

    res.json({ success: true });

  } catch (err) {
    console.error("Erro excluir pacote:", err);
    res.status(500).json({ error: "Erro ao excluir pacote" });
  }
});

// ===========================
// DELETAR PREMIUM
// ===========================

app.delete("/api/premium/:id", auth, authModelo, async (req, res) => {
  try {
    const premiumId = Number(req.params.id);
    const userId = Number(req.user?.id || 0);

    if (!Number.isInteger(premiumId) || premiumId <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const modeloRes = await db.query(
      `
      SELECT id
      FROM modelos
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (!modeloRes.rowCount) {
      return res.status(404).json({ error: "Modelo não encontrada" });
    }

    const modelo_id = Number(modeloRes.rows[0].id);

    const premiumRes = await db.query(
      `
      SELECT id, modelo_id
      FROM premium_posts
      WHERE id = $1
        AND ativo = true
      LIMIT 1
      `,
      [premiumId]
    );

    if (!premiumRes.rowCount) {
      return res.status(404).json({ error: "Postagem premium não encontrada" });
    }

    const premium = premiumRes.rows[0];

    if (Number(premium.modelo_id) !== modelo_id) {
      return res.status(403).json({ error: "Sem permissão para excluir esta postagem" });
    }

    await db.query(
      `
      UPDATE premium_posts
      SET ativo = false
      WHERE id = $1
      `,
      [premiumId]
    );

    await db.query(
  `
  UPDATE premium_post_midias
  SET ativo = false
  WHERE premium_post_id = $1
  `,
  [premiumId]
);

    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao excluir premium:", err);
    return res.status(500).json({ error: "Erro ao excluir premium" });
  }
});

// ===========================
// VIP PIX
// ===========================

app.post("/api/pagamento/vip/pix", authCliente, async (req, res) => {
  console.log("=================================");
  console.log("🔥 NOVO PIX VIP");
  console.log("BODY:", req.body);

  const client = await db.connect();

  try {
    const { modelo_id, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint, cpf, telefone } = req.body;
    const userId = Number(req.user?.id || 0);
    const cpfVip = String(cpf || "").replace(/\D/g, "") || null;
    const telefoneVip = String(telefone || "").replace(/\D/g, "") || null;

    console.log("User:", userId);
    console.log("Modelo:", modelo_id);

    if (!aceitou_termos) {
      return res.status(400).json({ error: "É necessário aceitar os termos." });
    }

    if (!aceitou_execucao_imediata) {
  return res.status(400).json({
    error: "É necessário declarar ciência sobre a execução imediata do serviço digital."
  });
}

if (!aceite_timestamp) {
  return res.status(400).json({
    error: "Data de aceite obrigatória."
  });
}

const dataAceite = new Date(aceite_timestamp);
if (Number.isNaN(dataAceite.getTime())) {
  return res.status(400).json({
    error: "Data de aceite inválida."
  });
}

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Usuário inválido." });
    }

    const modeloIdNum = Number(modelo_id);
    if (!Number.isInteger(modeloIdNum) || modeloIdNum <= 0) {
      return res.status(400).json({ error: "modelo_id inválido" });
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    console.log("IP:", ip);

    await client.query("BEGIN");

    /* =========================
       CLIENTE + USER
    ========================= */

    console.log("Buscando cliente...");

    const clienteRes = await client.query(
      `
      SELECT
        c.id,
        c.nome,
        c.bloqueado,
        u.email
      FROM clientes c
      LEFT JOIN users u
        ON u.id = c.user_id
      WHERE c.user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    console.log("Cliente encontrado:", clienteRes.rowCount);

    if (!clienteRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const {
      id: cliente_id,
      nome,
      bloqueado,
      email
    } = clienteRes.rows[0];

    console.log("cliente_id:", cliente_id);
    console.log("bloqueado:", bloqueado);

    if (bloqueado) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Conta bloqueada." });
    }

    const nomeFinal = String(nome || "").trim() || "Cliente Velvet";
    const emailFinal = String(email || "").trim();

    if (!emailFinal) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "E-mail do cliente não encontrado." });
    }

    /* =========================
       IMPEDIR ASSINAR O PRÓPRIO PERFIL
    ========================= */

    const donaRes = await client.query(
      `
      SELECT id
      FROM modelos
      WHERE user_id = $1
        AND id = $2
      LIMIT 1
      `,
      [userId, modeloIdNum]
    );

    if (donaRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Não é possível assinar o próprio perfil." });
    }

    /* =========================
       VALIDAR MODELO
    ========================= */

    const modeloRes = await client.query(
      `
      SELECT id
      FROM modelos
      WHERE id = $1
      LIMIT 1
      `,
      [modeloIdNum]
    );

    if (!modeloRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Modelo não encontrada." });
    }

    /* =========================
       REUTILIZAR PIX PENDENTE RECENTE
    ========================= */

    /* =========================
       PLANO VIP
    ========================= */

    console.log("Buscando plano VIP...");

    const planoRes = await client.query(
      `
      SELECT valor_mensal
      FROM modelos_planos
      WHERE modelo_id = $1
      LIMIT 1
      `,
      [modeloIdNum]
    );

    console.log("Plano VIP encontrado:", planoRes.rowCount);

    if (!planoRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Plano VIP não encontrado" });
    }

    let valorBase = Number(planoRes.rows[0].valor_mensal) || 0;

    console.log("Valor base:", valorBase);

    /* =========================
       OFERTA
    ========================= */

    console.log("Buscando oferta...");

    const ofertaRes = await client.query(
      `
      SELECT valor_promocional
      FROM ofertas
      WHERE modelo_id = $1
        AND ativa = true
        AND (data_inicio IS NULL OR data_inicio <= NOW())
        AND (data_fim IS NULL OR data_fim >= NOW())
      LIMIT 1
      `,
      [modeloIdNum]
    );

    if (ofertaRes.rowCount) {
      valorBase = Number(ofertaRes.rows[0].valor_promocional) || valorBase;
      console.log("Oferta aplicada:", valorBase);
    }

    if (!valorBase || valorBase <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Valor inválido" });
    }

    /* =========================
       CÁLCULO
    ========================= */

    const valorAssinatura = Number(valorBase.toFixed(2));
    const { taxaTransacao, taxaPlataforma, valorTotal } = calcTaxaStripe(valorAssinatura);
    const amount = Math.round(valorTotal * 100);

    console.log("VALORES:");
    console.log("base:", valorAssinatura);
    console.log("centavos:", amount);

    /* =========================
       CRIAR PIX ABACATEPAY
    ========================= */

    console.log("Criando pagamento PIX no AbacatePay...");

    const abacateResVip = await abacatePayRequest("POST", "/transparents/create", {
      method: "PIX",
      data: {
        amount,
        description: "Assinatura VIP Velvet",
        expiresIn: 3600,
        customer: cpfVip && telefoneVip ? { name: nomeFinal, email: emailFinal, taxId: cpfVip, cellphone: telefoneVip } : undefined,
        metadata: {},
        externalId: `vip_${cliente_id}_${modeloIdNum}`
      }
    });

    const abacateId  = abacateResVip?.data?.id;
    const brCode     = abacateResVip?.data?.brCode;
    const brCodeB64  = abacateResVip?.data?.brCodeBase64;
    const expiresAt  = abacateResVip?.data?.expiresAt || null;

    if (!abacateId || !brCode) {
      console.error("PIX AbacatePay não gerado:", abacateResVip);
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Erro ao gerar QR PIX" });
    }

    /* =========================
       REGISTRAR PIX
    ========================= */

    console.log("Registrando pagamento no banco...");

    await client.query(
      `
      INSERT INTO pagamentos_pix
      (
        cliente_id,
        modelo_id,
        valor,
        status,
        gateway,
        pagarme_order_id,
        criado_em,
        aceite_ip,
        aceitou_termos,
        aceitou_execucao_imediata,
        aceite_timestamp,
        versao_termos,
        fingerprint,
        cpf,
        telefone
      )
      VALUES ($1,$2,$3,'pendente','abacatepay',$4,NOW(),$5,$6,$7,$8,$9,$10,$11,$12)
      `,
      [
        cliente_id,
        modeloIdNum,
        valorTotal,
        abacateId,
        ip,
        !!aceitou_termos,
        !!aceitou_execucao_imediata,
        aceite_timestamp,
        versao_termos || "2026-04-06",
        fingerprint || "",
        cpfVip || null,
        telefoneVip || null
      ]
    );

    console.log("Pagamento registrado");

    await client.query("COMMIT");

    console.log("COMMIT realizado");
    console.log("PIX criado com sucesso");

    return res.json({
      qr_code_url: brCodeB64 ? (brCodeB64.startsWith("data:") ? brCodeB64 : `data:image/png;base64,${brCodeB64}`) : null,
      copia_cola: brCode,
      expires_at: expiresAt,
      order_id: abacateId
    });
  } catch (err) {
    console.error("=================================");
    console.error("🔥 ERRO PIX VIP");
    console.error("message:", err.message);
    console.error("stack:", err.stack);

    if (err.response) {
      console.error("STATUS:", err.response.status);
      console.error("DATA:", err.response.data);
    }

    try {
      console.log("ROLLBACK executado");
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Erro no rollback:", rollbackErr);
    }

    return res.status(500).json({
      error: "Erro ao gerar pagamento"
    });
  } finally {
    client.release();
    console.log("Conexão DB liberada");
  }
});

// ===========================
// MIDIA PIX
// ===========================

app.post("/api/pagamento/midia/pix", authCliente, async (req, res) => {

  const client = await db.connect();

  try {

   const { conteudo_id, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint } = req.body;
    const userId = req.user.id;

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0] ||
      req.socket.remoteAddress;

    if (!conteudo_id) {
      return res.status(400).json({ error: "Conteúdo inválido." });
    }

    if (!aceitou_termos) {
  return res.status(400).json({
    error: "É necessário aceitar os termos."
  });
}

if (!aceitou_execucao_imediata) {
  return res.status(400).json({
    error: "É necessário declarar ciência sobre a execução imediata do conteúdo digital."
  });
}

if (!aceite_timestamp) {
  return res.status(400).json({
    error: "Data de aceite obrigatória."
  });
}

const dataAceite = new Date(aceite_timestamp);
if (Number.isNaN(dataAceite.getTime())) {
  return res.status(400).json({
    error: "Data de aceite inválida."
  });
}

    /* ================================
       CLIENTE
    ================================ */

    const clienteRes = await client.query(
      `SELECT c.id, c.nome, c.bloqueado, u.email
       FROM clientes c
       LEFT JOIN users u ON u.id = c.user_id
       WHERE c.user_id = $1
       LIMIT 1`,
      [userId]
    );

    if (!clienteRes.rowCount) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const { id: cliente_id, nome: nomeDB, bloqueado, email: emailDB } = clienteRes.rows[0];

    if (bloqueado) {
      return res.status(403).json({ error: "Conta bloqueada." });
    }

    /* ================================
       BUSCAR MIDIA
    ================================ */

    const conteudo = await client.query(
      `SELECT preco, modelo_id
       FROM messages
       WHERE id = $1
       AND cliente_id = $2`,
      [conteudo_id, cliente_id]
    );

    if (!conteudo.rowCount) {
      return res.status(404).json({ error: "Conteúdo não encontrado" });
    }

    const { preco, modelo_id } = conteudo.rows[0];

    const precoNum = Number(preco);

    const { taxaTransacao, taxaPlataforma, valorTotal } = calcTaxaStripe(precoNum);
    const valorCentavos = Math.round(valorTotal * 100);

    /* ================================
       VERIFICAR SE JA COMPROU
    ================================ */

    const jaComprado = await client.query(
      `SELECT 1
       FROM pagamentos_pix
       WHERE cliente_id = $1
       AND message_id = $2
       AND status = 'pago'
       LIMIT 1`,
      [cliente_id, conteudo_id]
    );

    if (jaComprado.rowCount > 0) {
      return res.status(400).json({
        error: "Conteúdo já adquirido."
      });
    }

    await client.query("BEGIN");

    /* ================================
       EXPIRAR PIX ANTIGOS
    ================================ */

    await client.query(`
      UPDATE pagamentos_pix
      SET status = 'expirado'
      WHERE status = 'pendente'
      AND expires_at < NOW()
    `);

    /* ================================
       REUTILIZAR PIX EXISTENTE
    ================================ */

    const pixExistente = await client.query(
      `
      SELECT pagarme_order_id, qr_code
      FROM pagamentos_pix
      WHERE cliente_id = $1
      AND message_id = $2
      AND gateway = 'abacatepay'
      AND status = 'pendente'
      AND expires_at > NOW()
      ORDER BY criado_em DESC
      LIMIT 1
      `,
      [cliente_id, conteudo_id]
    );

    if (pixExistente.rowCount > 0 && pixExistente.rows[0].qr_code) {
      await client.query("ROLLBACK");
      return res.json({
        qr_code: pixExistente.rows[0].qr_code,
        qr_code_base64: null,
        payment_id: pixExistente.rows[0].pagarme_order_id,
        reutilizado: true
      });
    }

    /* ================================
       CRIAR PIX ABACATEPAY
    ================================ */

    console.log("Criando pagamento PIX Mídia no AbacatePay...");

    const nomeCliente  = String(nomeDB || "").trim() || "Cliente Velvet";
    const emailCliente = String(emailDB || "").trim();

    if (!emailCliente) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "E-mail do cliente não encontrado." });
    }

    const abacatePayload = {
      method: "PIX",
      data: {
        amount: valorCentavos,
        description: "Mídia Premium Velvet",
        expiresIn: 3600,
        metadata: {},
        externalId: `midia_${cliente_id}_${conteudo_id}`
      }
    };

    console.log("AbacatePay PIX Mídia payload:", JSON.stringify(abacatePayload));

    const abacateResMidia = await abacatePayRequest("POST", "/transparents/create", abacatePayload);

    const abacateIdMidia  = abacateResMidia?.data?.id;
    const brCodeMidia     = abacateResMidia?.data?.brCode;
    const brCodeB64Midia  = abacateResMidia?.data?.brCodeBase64;

    if (!abacateIdMidia || !brCodeMidia) {
      throw new Error("Erro ao gerar PIX no AbacatePay");
    }

    /* ================================
       SALVAR PIX
    ================================ */

await client.query(
  `
  INSERT INTO pagamentos_pix
  (
    cliente_id,
    modelo_id,
    message_id,
    qr_code,
    valor,
    status,
    gateway,
    pagarme_order_id,
    criado_em,
    expires_at,
    aceite_ip,
    aceitou_termos,
    aceitou_execucao_imediata,
    aceite_timestamp,
    versao_termos,
    fingerprint
  )
  VALUES (
    $1,$2,$3,$4,$5,'pendente','abacatepay',$6,NOW(),NOW() + INTERVAL '60 minutes',
    $7,$8,$9,$10,$11,$12
  )
  `,
  [
    cliente_id,
    modelo_id,
    conteudo_id,
    brCodeMidia,
    valorTotal,
    abacateIdMidia,
    ip || null,
    !!aceitou_termos,
    !!aceitou_execucao_imediata,
    aceite_timestamp,
    versao_termos || "2026-04-06",
    fingerprint || ""
  ]
);

    await client.query("COMMIT");

    return res.json({
      qr_code: brCodeMidia,
      qr_code_base64: brCodeB64Midia || null,
      payment_id: abacateIdMidia
    });

  } catch (err) {

    console.error("Erro gerar PIX:", err);

    try { await client.query("ROLLBACK"); } catch {}

    return res.status(500).json({
      error: "Erro ao gerar pagamento PIX"
    });

  } finally {

    client.release();

  }

});

// ===========================
// PREMIUM PIX
// ===========================

app.post("/api/pagamento/premium/pix", authCliente, async (req, res) => {
  console.log("=================================");
  console.log("🔥 NOVO PIX PREMIUM");
  console.log("BODY:", req.body);

  const client = await db.connect();

  try {
const {
  premium_post_id,
  aceitou_termos,
  aceitou_execucao_imediata,
  aceite_timestamp,
  versao_termos,
  fingerprint,
  cpf,
  telefone
} = req.body;

    const userId = Number(req.user?.id || 0);
    const cpfPremium = String(cpf || "").replace(/\D/g, "") || null;
    const telefonePremium = String(telefone || "").replace(/\D/g, "") || null;

    console.log("User:", userId);
    console.log("Premium post:", premium_post_id);

    if (!aceitou_termos) {
      return res.status(400).json({ error: "É necessário aceitar os termos." });
    }

    if (!aceitou_execucao_imediata) {
  return res.status(400).json({
    error: "É necessário declarar ciência sobre a execução imediata do conteúdo digital."
  });
}

if (!aceite_timestamp) {
  return res.status(400).json({
    error: "Data de aceite obrigatória."
  });
}

const dataAceite = new Date(aceite_timestamp);
if (Number.isNaN(dataAceite.getTime())) {
  return res.status(400).json({
    error: "Data de aceite inválida."
  });
}

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Usuário inválido." });
    }

    const premiumPostIdNum = Number(premium_post_id);
    if (!Number.isInteger(premiumPostIdNum) || premiumPostIdNum <= 0) {
      return res.status(400).json({ error: "premium_post_id inválido." });
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    console.log("IP:", ip);

    await client.query("BEGIN");

    /* =========================
       CLIENTE + USER
    ========================= */

    console.log("Buscando cliente...");

    const clienteRes = await client.query(
      `
      SELECT
        c.id,
        c.nome,
        c.bloqueado,
        u.email
      FROM clientes c
      LEFT JOIN users u
        ON u.id = c.user_id
      WHERE c.user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    console.log("Cliente encontrado:", clienteRes.rowCount);

    if (!clienteRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const {
      id: cliente_id,
      nome,
      bloqueado,
      email
    } = clienteRes.rows[0];

    console.log("cliente_id:", cliente_id);
    console.log("bloqueado:", bloqueado);

    if (bloqueado) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Conta bloqueada." });
    }

    const nomeFinal = String(nome || "").trim() || "Cliente Velvet";
    const emailFinal = String(email || "").trim();

    if (!emailFinal) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "E-mail do cliente não encontrado." });
    }

    /* =========================
       BUSCAR PREMIUM
    ========================= */

    console.log("Buscando premium post...");

    const premiumRes = await client.query(
      `
      SELECT
        pp.id,
        pp.modelo_id,
        pp.preco,
        pp.descricao,
        pp.ativo
      FROM premium_posts pp
      WHERE pp.id = $1
      LIMIT 1
      `,
      [premiumPostIdNum]
    );

    console.log("Premium encontrado:", premiumRes.rowCount);

    if (!premiumRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Premium não encontrado." });
    }

    const premium = premiumRes.rows[0];
    const modeloIdNum = Number(premium.modelo_id);
    const precoBase = Number(premium.preco || 0);

    console.log("modelo_id:", modeloIdNum);
    console.log("precoBase:", precoBase);
    console.log("ativo:", premium.ativo);

    if (!premium.ativo) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Premium indisponível." });
    }

    if (!Number.isInteger(modeloIdNum) || modeloIdNum <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Modelo inválida para este premium." });
    }

    if (!precoBase || precoBase <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Premium sem preço válido." });
    }

    /* =========================
       IMPEDIR COMPRAR O PRÓPRIO PREMIUM
    ========================= */

    const donaRes = await client.query(
      `
      SELECT id
      FROM modelos
      WHERE user_id = $1
        AND id = $2
      LIMIT 1
      `,
      [userId, modeloIdNum]
    );

    if (donaRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Não é possível comprar o próprio premium." });
    }

    /* =========================
       VALIDAR MODELO
    ========================= */

    const modeloRes = await client.query(
      `
      SELECT id
      FROM modelos
      WHERE id = $1
      LIMIT 1
      `,
      [modeloIdNum]
    );

    if (!modeloRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Modelo não encontrada." });
    }

    /* =========================
       EXIGIR VIP ATIVO
    ========================= */

    console.log("Validando VIP ativo...");

    const vipRes = await client.query(
      `
      SELECT 1
      FROM vip_subscriptions
      WHERE cliente_id = $1
        AND modelo_id = $2
        AND ativo = true
        AND expiration_at > NOW()
      LIMIT 1
      `,
      [cliente_id, modeloIdNum]
    );

    console.log("VIP ativo:", vipRes.rowCount);

    if (!vipRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Apenas clientes VIP podem comprar conteúdos premium."
      });
    }

    /* =========================
       IMPEDIR DUPLICIDADE PAGA
    ========================= */

    console.log("Verificando se já foi comprado...");

    const pagoRes = await client.query(
      `
      SELECT 1
      FROM premium_unlocks
      WHERE premium_post_id = $1
        AND cliente_id = $2
        AND status = 'pago'
      LIMIT 1
      `,
      [premiumPostIdNum, cliente_id]
    );

    if (pagoRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Conteúdo premium já adquirido."
      });
    }

    /* =========================
       EXPIRAR PENDENTES ANTIGOS
    ========================= */

    console.log("Expirando pendentes antigos...");

    await client.query(
      `
      UPDATE premium_unlocks
      SET status = 'expirado',
          updated_at = NOW()
      WHERE premium_post_id = $1
        AND cliente_id = $2
        AND status = 'pendente'
        AND metodo_pagamento = 'pix'
        AND created_at < NOW() - INTERVAL '55 minutes'
      `,
      [premiumPostIdNum, cliente_id]
    );

    /* =========================
       REUTILIZAR PIX PENDENTE RECENTE
    ========================= */

    /* =========================
       CÁLCULO
    ========================= */

    const valorBase = Number(precoBase.toFixed(2));
    const { taxaTransacao, taxaPlataforma, valorTotal } = calcTaxaStripe(valorBase);
    const amount = Math.round(valorTotal * 100);

    console.log("VALORES:");
    console.log("base:", valorBase);
    console.log("centavos:", amount);

    /* =========================
       CRIAR PIX ABACATEPAY
    ========================= */

    console.log("Criando pagamento PIX Premium no AbacatePay...");

    const abacateResPremium = await abacatePayRequest("POST", "/transparents/create", {
      method: "PIX",
      data: {
        amount,
        description: "Post Premium Velvet",
        expiresIn: 3600,
        customer: cpfPremium && telefonePremium ? { name: nomeFinal, email: emailFinal, taxId: cpfPremium, cellphone: telefonePremium } : undefined,
        metadata: {},
        externalId: `premium_${cliente_id}_${premiumPostIdNum}`
      }
    });

    const abacateIdPremium  = abacateResPremium?.data?.id;
    const brCodePremium     = abacateResPremium?.data?.brCode;
    const brCodeB64Premium  = abacateResPremium?.data?.brCodeBase64;
    const expiresAtPremium  = abacateResPremium?.data?.expiresAt || null;

    if (!abacateIdPremium || !brCodePremium) {
      console.error("PIX AbacatePay não gerado:", abacateResPremium);
      await client.query("ROLLBACK");
      return res.status(500).json({ error: "Erro ao gerar QR PIX" });
    }

    /* =========================
       REGISTRAR / UPSERT PREMIUM_UNLOCKS
    ========================= */

    console.log("Registrando premium_unlock pendente no banco...");

await client.query(
  `
  INSERT INTO premium_unlocks
  (
    premium_post_id,
    cliente_id,
    modelo_id,
    status,
    metodo_pagamento,
    valor_base,
    taxa_transacao,
    taxa_plataforma,
    valor_total,
    gateway,
    pagarme_order_id,
    qr_code_url,
    pacote_ref,
    aceite_ip,
    aceitou_termos,
    aceitou_execucao_imediata,
    aceite_timestamp,
    versao_termos,
    fingerprint,
    created_at,
    updated_at
  )
  VALUES
  (
    $1,$2,$3,
    'pendente','pix',
    $4,$5,$6,$7,
    'abacatepay',$8,$9,$10,
    $11,$12,$13,$14,$15,$16,
    NOW(),NOW()
  )
  ON CONFLICT (premium_post_id, cliente_id)
  DO UPDATE SET
    modelo_id = EXCLUDED.modelo_id,
    status = 'pendente',
    metodo_pagamento = 'pix',
    valor_base = EXCLUDED.valor_base,
    taxa_transacao = EXCLUDED.taxa_transacao,
    taxa_plataforma = EXCLUDED.taxa_plataforma,
    valor_total = EXCLUDED.valor_total,
    gateway = EXCLUDED.gateway,
    pagarme_order_id = EXCLUDED.pagarme_order_id,
    qr_code_url = EXCLUDED.qr_code_url,
    pacote_ref = EXCLUDED.pacote_ref,
    aceite_ip = EXCLUDED.aceite_ip,
    aceitou_termos = EXCLUDED.aceitou_termos,
    aceitou_execucao_imediata = EXCLUDED.aceitou_execucao_imediata,
    aceite_timestamp = EXCLUDED.aceite_timestamp,
    versao_termos = EXCLUDED.versao_termos,
    fingerprint = EXCLUDED.fingerprint,
    updated_at = NOW()
  `,
  [
    premiumPostIdNum,
    cliente_id,
    modeloIdNum,
    valorBase,
    taxaTransacao,
    taxaPlataforma,
    valorTotal,
    abacateIdPremium,
    brCodeB64Premium ? `data:image/png;base64,${brCodeB64Premium}` : null,
    `premium_${premiumPostIdNum}_${cliente_id}`,
    ip || null,
    !!aceitou_termos,
    !!aceitou_execucao_imediata,
    aceite_timestamp,
    versao_termos || "2026-04-06",
    fingerprint || ""
  ]
);

    console.log("Premium unlock registrado");

    await client.query("COMMIT");

    console.log("COMMIT realizado");
    console.log("PIX premium criado com sucesso");

    return res.json({
      qr_code_url: brCodeB64Premium ? (brCodeB64Premium.startsWith("data:") ? brCodeB64Premium : `data:image/png;base64,${brCodeB64Premium}`) : null,
      copia_cola: brCodePremium,
      expires_at: expiresAtPremium,
      order_id: abacateIdPremium,
      reutilizado: false
    });
  } catch (err) {
    console.log("=================================");
    console.error("🔥 ERRO PIX PREMIUM");
    console.error("message:", err.message);
    console.error("stack:", err.stack);
    console.error("code:", err.code);
    console.error("detail:", err.detail);
    console.error("constraint:", err.constraint);
    console.error("table:", err.table);
    console.error("column:", err.column);

    if (err.response) {
      console.error("STATUS:", err.response.status);
      console.error("DATA:", err.response.data);
    }

    try {
      console.log("ROLLBACK executado");
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      console.error("Erro no rollback:", rollbackErr);
    }

    return res.status(500).json({
      error: "Erro ao gerar pagamento premium"
    });
  } finally {
    client.release();
    console.log("Conexão DB liberada");
  }
});

// ===========================
// VIP CARTAO
// ===========================

app.post("/api/pagamento/vip/cartao", authCliente, async (req, res) => {
  const client = await db.connect();
  let cliente_id = null;

  try {
    await client.query("BEGIN");

    const {
      modelo_id,
      aceitou_termos,
      aceitou_execucao_imediata,
      aceite_timestamp,
      versao_termos,
      fingerprint,
      paymentMethodId,
      cpf,
      telefone,
      nome_cartao
    } = req.body || {};

    const cpfVip = String(cpf || "").replace(/\D/g, "") || null;
    const telefoneVip = String(telefone || "").replace(/\D/g, "") || null;
    const nomeCartaoVip = String(nome_cartao || "").trim() || null;

    const userId = Number(req.user?.id || 0);

    /* =====================================================
       VALIDAÇÕES INICIAIS
    ===================================================== */
    if (!Number.isInteger(userId) || userId <= 0) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: "Usuário inválido." });
    }

    const modeloIdNum = Number(modelo_id);
    if (!Number.isInteger(modeloIdNum) || modeloIdNum <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "modelo_id inválido" });
    }

    if (!fingerprint) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Fingerprint obrigatório." });
    }

    if (!aceitou_termos) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Você precisa aceitar os termos." });
    }

    if (!aceitou_execucao_imediata) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Você precisa declarar ciência sobre a execução imediata do serviço digital."
      });
    }

    if (!aceite_timestamp) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Data de aceite obrigatória." });
    }

    const dataAceite = new Date(aceite_timestamp);
    if (Number.isNaN(dataAceite.getTime())) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Data de aceite inválida." });
    }

    if (!paymentMethodId) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "paymentMethodId obrigatório." });
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      null;

    const currency = req.body.currency === "usd" ? "usd" : "brl";

    /* =====================================================
       BLOQUEIOS
    ===================================================== */
    const ipBloqueado = await client.query(
      `SELECT 1 FROM ips_bloqueados WHERE ip = $1 LIMIT 1`,
      [ip]
    );

    if (ipBloqueado.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "IP bloqueado." });
    }

    /* =====================================================
       CLIENTE
    ===================================================== */
    const clienteRes = await client.query(
      `
      SELECT
        c.id,
        c.nome,
        c.bloqueado,
        u.email
      FROM clientes c
      JOIN users u
        ON u.id = c.user_id
      WHERE c.user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (!clienteRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    cliente_id = Number(clienteRes.rows[0].id);

    const nomeCliente =
      String(clienteRes.rows[0].nome || "").trim() || "Cliente Velvet";
    const emailCliente = String(clienteRes.rows[0].email || "")
      .trim()
      .toLowerCase();

    if (clienteRes.rows[0].bloqueado) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Conta bloqueada." });
    }

    if (!emailCliente || !emailCliente.includes("@")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "E-mail do cliente inválido." });
    }

    /* =====================================================
       IMPEDIR ASSINAR O PRÓPRIO PERFIL
    ===================================================== */
    const donaRes = await client.query(
      `
      SELECT id
      FROM modelos
      WHERE user_id = $1
        AND id = $2
      LIMIT 1
      `,
      [userId, modeloIdNum]
    );

    if (donaRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Não é possível assinar o próprio perfil."
      });
    }

    /* =====================================================
       VALIDAR MODELO
    ===================================================== */
    const modeloRes = await client.query(
      `
      SELECT id
      FROM modelos
      WHERE id = $1
      LIMIT 1
      `,
      [modeloIdNum]
    );

    if (!modeloRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Modelo não encontrada." });
    }

    /* =====================================================
       ATUALIZAR CLIENTE
    ===================================================== */
    await client.query(
      `UPDATE clientes SET ultimo_ip = $1 WHERE id = $2`,
      [ip, cliente_id]
    );

    /* =====================================================
       BUSCAR PLANO
    ===================================================== */
    const planoRes = await client.query(
      `
      SELECT valor_mensal
      FROM modelos_planos
      WHERE modelo_id = $1
      LIMIT 1
      `,
      [modeloIdNum]
    );

    if (!planoRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Plano VIP não definido" });
    }

    let valorBasePlano = Number(planoRes.rows[0].valor_mensal) || 0;

    /* =====================================================
       OFERTA
    ===================================================== */
    const ofertaRes = await client.query(
      `
      SELECT id, desconto_percentual, valor_promocional
      FROM ofertas
      WHERE modelo_id = $1
        AND ativa = true
        AND (data_inicio IS NULL OR data_inicio <= NOW())
        AND (data_fim IS NULL OR data_fim >= NOW())
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [modeloIdNum]
    );

    let valorAssinatura = valorBasePlano;
    let oferta_id = null;

    if (ofertaRes.rowCount) {
      oferta_id = ofertaRes.rows[0].id;

      if (ofertaRes.rows[0].valor_promocional) {
        valorAssinatura = Number(ofertaRes.rows[0].valor_promocional);
      } else if (ofertaRes.rows[0].desconto_percentual) {
        const desconto = Number(ofertaRes.rows[0].desconto_percentual);
        valorAssinatura = valorBasePlano - (valorBasePlano * desconto / 100);
      }
    }

    valorAssinatura = Number(valorAssinatura.toFixed(2));

    if (!valorAssinatura || valorAssinatura <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Valor inválido" });
    }

    /* =====================================================
       CÁLCULO
    ===================================================== */
    const { taxaTransacao, taxaPlataforma, valorTotal } = calcTaxaStripe(valorAssinatura);

    /* =====================================================
       CRIAR PAGAMENTO STRIPE
    ===================================================== */
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(valorTotal * 100),
      currency: "brl",
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "Assinatura VIP Velvet",
      receipt_email: emailCliente,
      metadata: {
        tipo: "vip",
        cliente_id: String(cliente_id),
        modelo_id: String(modeloIdNum),
        valor_assinatura: String(valorAssinatura),
        taxa_transacao: String(taxaTransacao),
        taxa_plataforma: String(taxaPlataforma),
        oferta_id: oferta_id ? String(oferta_id) : ""
      }
    });

    const paymentIntentId = paymentIntent.id;
    const statusLocal = paymentIntent.status === "succeeded" ? "pago" : "pendente";

    /* =====================================================
       REGISTRAR PAGAMENTO LOCAL
    ===================================================== */
    await client.query(
      `
      INSERT INTO pagamentos_cartao
      (
        cliente_id,
        modelo_id,
        gateway,
        gateway_payment_id,
        stripe_payment_intent_id,
        valor,
        tipo,
        currency,
        status,
        aceite_ip,
        aceitou_termos,
        aceitou_execucao_imediata,
        aceite_timestamp,
        versao_termos,
        fingerprint,
        valor_brl,
        taxa_cambio,
        cpf,
        telefone,
        nome_cartao,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, 'stripe', $3, $4, $5, $6, 'brl', $7,
        $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17, $18,
        NOW(), NOW()
      )
      `,
      [
        cliente_id,
        modeloIdNum,
        paymentIntentId,
        paymentIntentId,
        valorTotal,
        "vip",
        statusLocal,
        ip,
        !!aceitou_termos,
        !!aceitou_execucao_imediata,
        aceite_timestamp,
        versao_termos || "2026-04-06",
        fingerprint || null,
        valorAssinatura,
        null,
        cpfVip || null,
        telefoneVip || null,
        nomeCartaoVip || null
      ]
    );

    if (statusLocal === "pago") {
      const calcularValores =
        req.app.get("calcularValores") ||
        (async ({ valor_bruto }) => ({
          valor_modelo: valor_bruto * 0.7,
          agency_fee: valor_bruto * 0.1,
          velvet_fee: valor_bruto * 0.05
        }));

      const taxaGateway = Number((valorAssinatura * 0.15).toFixed(2));
      const valores = await calcularValores({
        modelo_id: modeloIdNum,
        valor_bruto: valorAssinatura,
        taxa_gateway: taxaGateway
      });

      const vipExistente = await client.query(
        `SELECT id, ativo, expiration_at FROM vip_subscriptions
         WHERE cliente_id = $1 AND modelo_id = $2 LIMIT 1 FOR UPDATE`,
        [cliente_id, modeloIdNum]
      );
      const primeiraAssinatura = vipExistente.rowCount === 0;

      let novaExpiracao;
      if (
        vipExistente.rowCount > 0 &&
        vipExistente.rows[0].expiration_at &&
        new Date(vipExistente.rows[0].expiration_at) > new Date()
      ) {
        novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
        novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
      } else {
        novaExpiracao = new Date();
        novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
      }

      if (vipExistente.rowCount > 0) {
        await client.query(
          `UPDATE vip_subscriptions
           SET ativo = true, updated_at = NOW(), expiration_at = $3,
               valor_assinatura = $4, taxa_transacao = $5, taxa_plataforma = 0,
               valor_total = $6, recorrente = false, gateway_subscription_id = $7,
               aviso_7_dias_enviado = false, aviso_24h_enviado = false
           WHERE cliente_id = $1 AND modelo_id = $2`,
          [cliente_id, modeloIdNum, novaExpiracao, valorAssinatura, taxaGateway, valorTotal, paymentIntentId]
        );
      } else {
        await client.query(
          `INSERT INTO vip_subscriptions
             (cliente_id, modelo_id, ativo, created_at, updated_at, expiration_at,
              valor_assinatura, taxa_transacao, taxa_plataforma, valor_total,
              recorrente, gateway_subscription_id)
           VALUES ($1,$2,true,NOW(),NOW(),$3,$4,$5,0,$6,false,$7)`,
          [cliente_id, modeloIdNum, novaExpiracao, valorAssinatura, taxaGateway, valorTotal, paymentIntentId]
        );
      }

      await client.query(
        `INSERT INTO transacoes_agency
           (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee,
            velvet_fee, taxa_gateway, status, created_at)
         VALUES ($1,$2,'assinatura',$3,$4,$5,$6,$7,'pago',NOW())`,
        [modeloIdNum, cliente_id, valorAssinatura,
         Number(valores.valor_modelo || 0),
         Number(valores.agency_fee || 0),
         Number(valores.velvet_fee || 0),
         taxaGateway]
      );

      if (primeiraAssinatura) {
        await client.query(
          `INSERT INTO messages
             (cliente_id, modelo_id, text, sender, tipo, created_at, lida, visto, deletada)
           VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)`,
          [cliente_id, modeloIdNum, "Oii!! Bem vindo(a), qual seu nome?🥰"]
        );
      }
    }

    await client.query("COMMIT");

    if (statusLocal === "pago") {
      try {
        const io = req.app.get("io");
        if (io) {
          const sala = `chat_${cliente_id}_${modeloIdNum}`;
          io.to(sala).emit("vipAtivado", {
            cliente_id: Number(cliente_id),
            modelo_id: Number(modeloIdNum)
          });
        }
      } catch (e) { console.error("Erro socket vip cartão:", e); }
    }

    try {
      await client.query(
        `INSERT INTO pagamento_tentativas
         (cliente_id, metodo, fingerprint_pagamento, status, ip)
         VALUES ($1, 'cartao', $2, 'aprovado', $3)`,
        [cliente_id, fingerprint || null, ip]
      );
    } catch (logErr) {
      console.error("Erro ao registrar tentativa aprovada VIP:", logErr);
    }

    const resposta = {
      ok: true,
      payment_id: paymentIntentId,
      status: statusLocal,
      modelo_id: modeloIdNum,
      currency: "brl",
      taxa_cambio: null,
      valor_assinatura: valorAssinatura,
      taxa_transacao: taxaTransacao,
      taxa_plataforma: taxaPlataforma,
      valor_total: valorTotal,
      oferta_id: oferta_id || null
    };

    if (paymentIntent.status === "requires_action") {
      resposta.requires_action = true;
      resposta.client_secret = paymentIntent.client_secret;
    }

    return res.json(resposta);
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (_) {}

    console.error("Erro VIP Stripe:", err);

    try {
      if (cliente_id && req.body?.fingerprint) {
        await client.query(
          `
          INSERT INTO pagamento_tentativas
          (cliente_id, metodo, fingerprint_pagamento, status, ip)
          VALUES ($1, 'cartao', $2, 'recusado', $3)
          `,
          [
            cliente_id,
            req.body.fingerprint,
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
              req.socket.remoteAddress ||
              null
          ]
        );
      }
    } catch (logErr) {
      console.error("Erro ao registrar tentativa recusada:", logErr);
    }

    return res.status(500).json({
      error: err.message || "Erro ao criar pagamento com cartão",
      stripe_code: err.code || null,
      stripe_type: err.type || null
    });
  } finally {
    client.release();
  }
});

// ===========================
// MIDIA CARTAO
// ===========================

app.post("/api/pagamento/midia/cartao", auth, async (req, res) => {
  const requestId =
    "stripe_cartao_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

  const startedAt = Date.now();
  let client = null;
  let cliente_id = null;

  try {
    client = await db.connect();

    const {
      conteudo_id,
      fingerprint,
      aceitou_termos,
      aceitou_execucao_imediata,
      aceite_timestamp,
      versao_termos,
      paymentMethodId
    } = req.body || {};

    const userId = Number(req.user?.id || 0);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!conteudo_id || !Number.isInteger(Number(conteudo_id))) {
      return res.status(400).json({ error: "conteudo_id inválido" });
    }

    const conteudoId = Number(conteudo_id);

    if (!fingerprint) {
      return res.status(400).json({ error: "Fingerprint obrigatório." });
    }

    if (!aceitou_termos) {
      return res.status(400).json({ error: "Você precisa aceitar os termos." });
    }

    if (!aceitou_execucao_imediata) {
      return res.status(400).json({
        error: "Você precisa declarar ciência sobre a execução imediata do conteúdo digital."
      });
    }

    if (!aceite_timestamp) {
      return res.status(400).json({ error: "Data de aceite obrigatória." });
    }

    const dataAceite = new Date(aceite_timestamp);
    if (Number.isNaN(dataAceite.getTime())) {
      return res.status(400).json({ error: "Data de aceite inválida." });
    }

    if (!paymentMethodId) {
      return res.status(400).json({ error: "paymentMethodId obrigatório." });
    }

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;

    await client.query("BEGIN");

    /* =====================================================
       CLIENTE
    ===================================================== */
    const clienteRes = await client.query(
      `
      SELECT
        c.id,
        c.bloqueado,
        COALESCE(NULLIF(TRIM(c.nome), ''), split_part(u.email, '@', 1)) AS nome,
        u.email
      FROM clientes c
      JOIN users u ON u.id = c.user_id
      WHERE c.user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (!clienteRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    cliente_id = Number(clienteRes.rows[0].id);

    const { bloqueado, email, nome } = clienteRes.rows[0];

    if (bloqueado) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Conta bloqueada." });
    }

    const nomeCompleto = String(nome || "").trim();
    if (!nomeCompleto || nomeCompleto.length < 3) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Nome do cliente inválido." });
    }

    if (!email || !String(email).includes("@")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "E-mail do cliente inválido." });
    }

    /* =====================================================
       CONTEÚDO
    ===================================================== */
    const messageRes = await client.query(
      `
      SELECT preco, modelo_id
      FROM messages
      WHERE id = $1
        AND cliente_id = $2
      LIMIT 1
      `,
      [conteudoId, cliente_id]
    );

    if (!messageRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Conteúdo não encontrado" });
    }

    const { preco, modelo_id } = messageRes.rows[0];

    if (!preco || Number(preco) <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Conteúdo não está à venda." });
    }

    /* =====================================================
       JÁ COMPRADO
    ===================================================== */
    const jaComprado = await client.query(
      `
      SELECT 1
      FROM conteudo_pacotes
      WHERE message_id = $1
        AND cliente_id = $2
        AND status = 'pago'
      LIMIT 1
      `,
      [conteudoId, cliente_id]
    );

    if (jaComprado.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Conteúdo já adquirido." });
    }

    /* =====================================================
       CÁLCULO
    ===================================================== */
    const valorBase = Number(Number(preco).toFixed(2));
    const { taxaTransacao, taxaPlataforma, valorTotal } = calcTaxaStripe(valorBase);
    const total = valorTotal;

    if (!total || total <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Valor do pagamento inválido." });
    }

    /* =====================================================
       CRIAR PAGAMENTO STRIPE (MÍDIA)
    ===================================================== */
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: "brl",
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "Mídia Premium Velvet",
      receipt_email: String(email).trim().toLowerCase(),
      metadata: {
        tipo: "conteudo",
        cliente_id: String(cliente_id),
        modelo_id: String(modelo_id),
        message_id: String(conteudoId),
        taxa_transacao: String(taxaTransacao),
        taxa_plataforma: String(taxaPlataforma)
      }
    });

    const paymentIntentId = paymentIntent.id;
    const statusLocal = paymentIntent.status === "succeeded" ? "pago" : "pendente";

    /* =====================================================
       REGISTRAR PAGAMENTO LOCAL
    ===================================================== */
    await client.query(
      `
      INSERT INTO pagamentos_cartao
      (
        cliente_id,
        modelo_id,
        conteudo_id,
        gateway,
        gateway_payment_id,
        stripe_payment_intent_id,
        valor,
        tipo,
        currency,
        status,
        aceite_ip,
        aceitou_termos,
        aceitou_execucao_imediata,
        aceite_timestamp,
        versao_termos,
        fingerprint,
        valor_brl,
        taxa_cambio,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, 'stripe', $4, $5, $6, $7, 'brl', $8,
        $9, $10, $11, $12, $13, $14, $15, $16,
        NOW(), NOW()
      )
      `,
      [
        cliente_id,
        modelo_id,
        conteudoId,
        paymentIntentId,
        paymentIntentId,
        total,
        "midia",
        statusLocal,
        ip,
        !!aceitou_termos,
        !!aceitou_execucao_imediata,
        aceite_timestamp,
        versao_termos || "2026-04-06",
        fingerprint || null,
        valorBase,
        null
      ]
    );

    let conteudo_ids_liberados = null;

    if (statusLocal === "pago") {
      const calcularValores =
        req.app.get("calcularValores") ||
        (async ({ valor_bruto }) => ({
          valor_modelo: valor_bruto * 0.7,
          agency_fee: valor_bruto * 0.1,
          velvet_fee: valor_bruto * 0.05
        }));

      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valores = await calcularValores({
        modelo_id,
        valor_bruto: valorBase,
        taxa_gateway: taxaGateway
      });

      await client.query(
        `INSERT INTO conteudo_pacotes
           (message_id, cliente_id, modelo_id, preco, valor_base, valor_total,
            status, metodo_pagamento, pago_em, currency, valor_cobrado, taxa_cambio)
         VALUES ($1,$2,$3,$4,$4,$5,'pago','cartao',NOW(),'brl',$5,NULL)
         ON CONFLICT (message_id, cliente_id) DO UPDATE
           SET status='pago', metodo_pagamento='cartao', pago_em=NOW(), valor_total=$5`,
        [conteudoId, cliente_id, modelo_id, valorBase, total]
      );

      conteudo_ids_liberados = await marcarConteudoComoLiberadoPorPagamento(client, {
        message_id: conteudoId,
        cliente_id,
        modelo_id
      });

      await client.query(
        `INSERT INTO transacoes_agency
           (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee,
            velvet_fee, taxa_gateway, status, created_at)
         VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
        [modelo_id, cliente_id, valorBase,
         Number(valores.valor_modelo || 0),
         Number(valores.agency_fee || 0),
         Number(valores.velvet_fee || 0),
         taxaGateway]
      );
    }

    await client.query("COMMIT");

    if (statusLocal === "pago" && conteudo_ids_liberados) {
      try {
        const io = req.app.get("io");
        if (io) {
          const sala = `chat_${cliente_id}_${modelo_id}`;
          io.to(sala).emit("conteudoLiberado", {
            message_id: Number(conteudoId),
            conteudo_ids: conteudo_ids_liberados || []
          });
        }
      } catch (e) { console.error("Erro socket midia cartão:", e); }
    }

    try {
      await client.query(
        `INSERT INTO pagamento_tentativas
         (cliente_id, metodo, fingerprint_pagamento, status, conteudo_id, ip,
          aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos)
         VALUES ($1, 'cartao', $2, 'aprovado', $3, $4, $5, $6, $7, $8)`,
        [
          cliente_id,
          fingerprint || null,
          conteudoId || null,
          ip,
          !!aceitou_termos,
          !!aceitou_execucao_imediata,
          aceite_timestamp || null,
          versao_termos || "2026-04-06"
        ]
      );
    } catch (logErr) {
      console.error("Erro ao registrar tentativa aprovada mídia:", logErr);
    }

    const resposta = {
      ok: true,
      payment_id: paymentIntentId,
      status: statusLocal,
      currency: "brl",
      taxa_cambio: null,
      total,
      valorBase,
      taxaTransacao,
      taxaPlataforma,
      aceitou_termos: !!aceitou_termos,
      aceitou_execucao_imediata: !!aceitou_execucao_imediata,
      aceite_timestamp,
      versao_termos: versao_termos || "2026-04-06"
    };

    if (paymentIntent.status === "requires_action") {
      resposta.requires_action = true;
      resposta.client_secret = paymentIntent.client_secret;
    }

    return res.json(resposta);

  } catch (err) {
    console.error("💥 ERRO /api/pagamento/midia/cartao [STRIPE]", err.message);

    try {
      if (client) await client.query("ROLLBACK");
    } catch (e) {
      console.error("Erro no rollback:", e.message);
    }

    try {
      if (client && cliente_id && req.body?.fingerprint) {
        await client.query(
          `
          INSERT INTO pagamento_tentativas
          (cliente_id, metodo, fingerprint_pagamento, status, conteudo_id, ip,
           aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos)
          VALUES ($1, 'cartao', $2, 'recusado', $3, $4, $5, $6, $7, $8)
          `,
          [
            cliente_id,
            req.body.fingerprint,
            Number(req.body?.conteudo_id || 0) || null,
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
              req.socket?.remoteAddress ||
              null,
            !!req.body?.aceitou_termos,
            !!req.body?.aceitou_execucao_imediata,
            req.body?.aceite_timestamp || null,
            req.body?.versao_termos || "2026-04-06"
          ]
        );
      }
    } catch (logErr) {
      console.error("Erro ao registrar tentativa recusada:", logErr.message);
    }

    return res.status(500).json({
      error: "Erro interno ao processar pagamento com cartão",
      detalhe: err.message,
      stripe_code: err.code || null,
      stripe_type: err.type || null,
      requestId
    });
  } finally {
    if (client) {
      try {
        client.release();
      } catch (_) {}
    }
  }
});

// ===========================
// PREMIUM CARTAO
// ===========================

app.post("/api/pagamento/premium/cartao", authCliente, async (req, res) => {
  const requestId =
    "premium_cartao_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);

  let client = null;
  let cliente_id = null;

  try {
    client = await db.connect();

    const {
      premium_post_id,
      fingerprint,
      aceitou_termos,
      aceitou_execucao_imediata,
      aceite_timestamp,
      versao_termos,
      paymentMethodId,
      cpf,
      telefone,
      nome_cartao
    } = req.body || {};

    const cpfPremiumCartao = String(cpf || "").replace(/\D/g, "") || null;
    const telefonePremiumCartao = String(telefone || "").replace(/\D/g, "") || null;
    const nomeCartaoPremium = String(nome_cartao || "").trim() || null;

    const userId = Number(req.user?.id || 0);

    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!aceitou_termos) {
      return res.status(400).json({ error: "É necessário aceitar os termos." });
    }

    if (!aceitou_execucao_imediata) {
      return res.status(400).json({
        error: "É necessário declarar ciência sobre a execução imediata do conteúdo digital."
      });
    }

    if (!aceite_timestamp) {
      return res.status(400).json({ error: "Data de aceite obrigatória." });
    }

    const dataAceite = new Date(aceite_timestamp);
    if (Number.isNaN(dataAceite.getTime())) {
      return res.status(400).json({ error: "Data de aceite inválida." });
    }

    if (!premium_post_id || !Number.isInteger(Number(premium_post_id))) {
      return res.status(400).json({ error: "premium_post_id inválido" });
    }

    if (!fingerprint) {
      return res.status(400).json({ error: "Fingerprint obrigatório." });
    }

    if (!paymentMethodId) {
      return res.status(400).json({ error: "paymentMethodId obrigatório." });
    }

    const premiumPostId = Number(premium_post_id);

    const ip =
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket?.remoteAddress ||
      null;

    await client.query("BEGIN");

    /* =====================================================
       CLIENTE
    ===================================================== */
    const clienteRes = await client.query(
      `
      SELECT
        c.id,
        c.bloqueado,
        COALESCE(NULLIF(TRIM(c.nome), ''), split_part(u.email, '@', 1)) AS nome,
        u.email
      FROM clientes c
      JOIN users u ON u.id = c.user_id
      WHERE c.user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (!clienteRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    cliente_id = Number(clienteRes.rows[0].id);

    const { bloqueado, email, nome } = clienteRes.rows[0];

    if (bloqueado) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "Conta bloqueada." });
    }

    const nomeCompleto = String(nome || "").trim();
    if (!nomeCompleto || nomeCompleto.length < 3) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Nome do cliente inválido." });
    }

    if (!email || !String(email).includes("@")) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "E-mail do cliente inválido." });
    }

    /* =====================================================
       PREMIUM
    ===================================================== */
    const premiumRes = await client.query(
      `
      SELECT id, preco, modelo_id, descricao, ativo
      FROM premium_posts
      WHERE id = $1
      LIMIT 1
      `,
      [premiumPostId]
    );

    if (!premiumRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Conteúdo premium não encontrado" });
    }

    const { id: premium_id, preco, modelo_id, descricao, ativo } = premiumRes.rows[0];

    const donaRes = await client.query(
      `SELECT id FROM modelos WHERE user_id = $1 AND id = $2 LIMIT 1`,
      [userId, modelo_id]
    );

    if (donaRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(400).json({
        error: "Não é possível comprar o próprio conteúdo premium."
      });
    }

    const vipRes = await client.query(
      `
      SELECT 1
      FROM vip_subscriptions
      WHERE cliente_id = $1
        AND modelo_id = $2
        AND ativo = true
        AND expiration_at > NOW()
      LIMIT 1
      `,
      [cliente_id, modelo_id]
    );

    if (!vipRes.rowCount) {
      await client.query("ROLLBACK");
      return res.status(403).json({
        error: "Apenas clientes VIP podem comprar conteúdos premium."
      });
    }

    if (!ativo) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Conteúdo premium indisponível." });
    }

    if (!preco || Number(preco) <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Conteúdo premium não está à venda." });
    }

    /* =====================================================
       JÁ COMPRADO
    ===================================================== */
    const jaComprado = await client.query(
      `
      SELECT 1
      FROM premium_unlocks
      WHERE premium_post_id = $1
        AND cliente_id = $2
        AND status = 'pago'
      LIMIT 1
      `,
      [premium_id, cliente_id]
    );

    if (jaComprado.rowCount > 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Conteúdo premium já adquirido." });
    }

    /* =====================================================
       CÁLCULO
    ===================================================== */
    const valorBase = Number(Number(preco).toFixed(2));
    const { taxaTransacao, taxaPlataforma, valorTotal } = calcTaxaStripe(valorBase);
    const total = valorTotal;

    if (!total || total <= 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Valor do pagamento inválido." });
    }

    /* =====================================================
       CRIAR PAGAMENTO STRIPE (PREMIUM)
    ===================================================== */
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(total * 100),
      currency: "brl",
      payment_method: paymentMethodId,
      confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: descricao || `Premium Velvet #${premium_id}`,
      receipt_email: String(email).trim().toLowerCase(),
      metadata: {
        tipo: "premium",
        cliente_id: String(cliente_id),
        modelo_id: String(modelo_id),
        premium_post_id: String(premium_id),
        taxa_transacao: String(taxaTransacao),
        taxa_plataforma: String(taxaPlataforma)
      }
    });

    const paymentIntentId = paymentIntent.id;
    const statusLocal = paymentIntent.status === "succeeded" ? "pago" : "pendente";

    /* =====================================================
       REGISTRAR PAGAMENTO LOCAL
    ===================================================== */
    await client.query(
      `
      INSERT INTO premium_unlocks
      (
        premium_post_id,
        cliente_id,
        modelo_id,
        status,
        metodo_pagamento,
        valor_base,
        taxa_transacao,
        taxa_plataforma,
        valor_total,
        gateway,
        stripe_payment_intent_id,
        pagarme_order_id,
        pacote_ref,
        aceite_ip,
        aceitou_termos,
        aceitou_execucao_imediata,
        aceite_timestamp,
        versao_termos,
        fingerprint,
        valor_cobrado,
        taxa_cambio,
        created_at,
        updated_at
      )
      VALUES
      (
        $1, $2, $3, $4, 'cartao', $5, $6, $7, $8,
        'stripe', $9, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
        NOW(), NOW()
      )
      ON CONFLICT (premium_post_id, cliente_id)
      DO UPDATE SET
        modelo_id = EXCLUDED.modelo_id,
        status = EXCLUDED.status,
        metodo_pagamento = 'cartao',
        valor_base = EXCLUDED.valor_base,
        taxa_transacao = EXCLUDED.taxa_transacao,
        taxa_plataforma = EXCLUDED.taxa_plataforma,
        valor_total = EXCLUDED.valor_total,
        gateway = EXCLUDED.gateway,
        stripe_payment_intent_id = EXCLUDED.stripe_payment_intent_id,
        pagarme_order_id = EXCLUDED.pagarme_order_id,
        pacote_ref = EXCLUDED.pacote_ref,
        aceite_ip = EXCLUDED.aceite_ip,
        aceitou_termos = EXCLUDED.aceitou_termos,
        aceitou_execucao_imediata = EXCLUDED.aceitou_execucao_imediata,
        aceite_timestamp = EXCLUDED.aceite_timestamp,
        versao_termos = EXCLUDED.versao_termos,
        fingerprint = EXCLUDED.fingerprint,
        valor_cobrado = EXCLUDED.valor_cobrado,
        taxa_cambio = EXCLUDED.taxa_cambio,
        updated_at = NOW()
      `,
      [
        premium_id,
        cliente_id,
        modelo_id,
        statusLocal,
        valorBase,
        taxaTransacao,
        taxaPlataforma,
        total,
        paymentIntentId,
        `premium_${premium_id}_${cliente_id}`,
        ip || null,
        !!aceitou_termos,
        !!aceitou_execucao_imediata,
        aceite_timestamp,
        versao_termos || "2026-04-06",
        fingerprint || null,
        total,
        null
      ]
    );

    if (statusLocal === "pago") {
      const calcularValores =
        req.app.get("calcularValores") ||
        (async ({ valor_bruto }) => ({
          valor_modelo: valor_bruto * 0.7,
          agency_fee: valor_bruto * 0.1,
          velvet_fee: valor_bruto * 0.05
        }));

      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valores = await calcularValores({
        modelo_id,
        valor_bruto: valorBase,
        taxa_gateway: taxaGateway
      });

      await client.query(
        `INSERT INTO transacoes_agency
           (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee,
            velvet_fee, taxa_gateway, status, created_at)
         VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
        [modelo_id, cliente_id, valorBase,
         Number(valores.valor_modelo || 0),
         Number(valores.agency_fee || 0),
         Number(valores.velvet_fee || 0),
         taxaGateway]
      );
    }

    await client.query("COMMIT");

    if (statusLocal === "pago") {
      try {
        const io = req.app.get("io");
        if (io) {
          io.to(`user_${cliente_id}`).emit("pagamento_confirmado", {
            tipo: "premium",
            premium_post_id: premium_id,
            modelo_id,
            payment_id: paymentIntentId
          });
        }
      } catch (e) { console.error("Erro socket premium cartão:", e); }
    }

    try {
      await client.query(
        `INSERT INTO pagamento_tentativas
         (cliente_id, metodo, fingerprint_pagamento, status, ip, gateway,
          aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos)
         VALUES ($1, 'cartao', $2, 'aprovado', $3, 'stripe', $4, $5, $6, $7)`,
        [
          cliente_id,
          fingerprint || null,
          ip,
          !!aceitou_termos,
          !!aceitou_execucao_imediata,
          aceite_timestamp || null,
          versao_termos || "2026-04-06"
        ]
      );
    } catch (logErr) {
      console.error("Erro ao registrar tentativa aprovada premium:", logErr);
    }

    const resposta = {
      ok: true,
      payment_id: paymentIntentId,
      premium_post_id: premium_id,
      modelo_id,
      cliente_id,
      status: statusLocal,
      currency: "brl",
      taxa_cambio: null,
      total,
      valorBase,
      taxaTransacao,
      taxaPlataforma,
      aceitou_termos: !!aceitou_termos,
      aceitou_execucao_imediata: !!aceitou_execucao_imediata,
      aceite_timestamp,
      versao_termos: versao_termos || "2026-04-06"
    };

    if (paymentIntent.status === "requires_action") {
      resposta.requires_action = true;
      resposta.client_secret = paymentIntent.client_secret;
    }

    return res.json(resposta);

  } catch (err) {
    console.error("💥 ERRO /api/pagamento/premium/cartao [STRIPE]", err.message);

    try {
      if (client) await client.query("ROLLBACK");
    } catch (e) {
      console.error("Erro no rollback:", e.message);
    }

    try {
      if (client && cliente_id && req.body?.fingerprint) {
        await client.query(
          `
          INSERT INTO pagamento_tentativas
          (cliente_id, metodo, fingerprint_pagamento, status, ip, gateway,
           aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos)
          VALUES ($1, 'cartao', $2, 'recusado', $3, 'stripe', $4, $5, $6, $7)
          `,
          [
            cliente_id,
            req.body.fingerprint,
            req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
              req.socket?.remoteAddress ||
              null,
            !!req.body?.aceitou_termos,
            !!req.body?.aceitou_execucao_imediata,
            req.body?.aceite_timestamp || null,
            req.body?.versao_termos || "2026-04-06"
          ]
        );
      }
    } catch (logErr) {
      console.error("Erro ao registrar tentativa recusada:", logErr.message);
    }

    return res.status(500).json({
      error: "Erro interno ao processar pagamento com cartão do premium",
      detalhe: err.message,
      stripe_code: err.code || null,
      stripe_type: err.type || null,
      requestId
    });
  } finally {
    if (client) {
      try {
        client.release();
      } catch (_) {}
    }
  }
});

// ===========================
// CANCELAR VIP??
// ===========================

app.post("/api/vip/cancelar", auth, async (req, res) => {
  try {
    const { modelo_id } = req.body;
    const userId = req.user.id;

    if (!modelo_id || isNaN(Number(modelo_id))) {
      return res.status(400).json({ error: "modelo_id inválido" });
    }

    const clienteRes = await db.query(
      "SELECT id FROM clientes WHERE user_id = $1",
      [userId]
    );

    if (clienteRes.rowCount === 0) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const cliente_id = clienteRes.rows[0].id;

    const vip = await db.query(`
      SELECT stripe_subscription_id
      FROM vip_subscriptions
      WHERE cliente_id = $1
        AND modelo_id = $2
        AND recorrente = true
      LIMIT 1
    `, [cliente_id, modelo_id]);

    if (vip.rowCount === 0) {
      return res.status(404).json({ error: "Assinatura não encontrada" });
    }

    const subscriptionId = vip.rows[0].stripe_subscription_id;

    await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });

    await db.query(`
      UPDATE vip_subscriptions
      SET recorrente = false
      WHERE cliente_id = $1
        AND modelo_id = $2
    `, [cliente_id, modelo_id]);

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ Erro cancelar VIP:", err);
    res.status(500).json({ error: "Erro ao cancelar assinatura" });
  }
});

// ===========================
// ESQUECI A SENHA
// ===========================

app.post("/api/password/forgot", async (req, res) => {
  const client = await db.connect();

  try {
    let { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email obrigatório" });
    }

    email = email.trim().toLowerCase();

    await client.query("BEGIN");

    const userRes = await client.query(
      `
      SELECT id
      FROM users
      WHERE email = $1
        AND ativo = true
      LIMIT 1
      `,
      [email]
    );

    if (userRes.rowCount === 0) {
      await client.query("COMMIT");
      return res.json({ ok: true });
    }

    const userId = userRes.rows[0].id;

    await client.query(
      `DELETE FROM password_resets WHERE user_id = $1`,
      [userId]
    );

    const codigo = Math.floor(100000 + Math.random() * 900000).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await client.query(
      `
      INSERT INTO password_resets (
        user_id,
        codigo,
        expires_at,
        criado_em
      )
      VALUES ($1, $2, $3, NOW())
      `,
      [userId, codigo, expires]
    );

    await client.query("COMMIT");

    await resend.emails.send({
      from: "Velvet <contato@velvet.lat>",
      to: [email],
      subject: "Recuperação de senha – Velvet",
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f3fb; padding:24px; color:#2d1f3d;">
          <div style="max-width:600px; margin:0 auto; background:#ffffff; padding:32px; border-radius:12px;">

            <h2 style="margin-top:0; margin-bottom:20px; color:#6f42c1; text-align:center;">
              Recuperação de senha 🔐
            </h2>

            <p style="margin:0 0 16px; line-height:1.6;">
              Olá,
            </p>

            <p style="margin:0 0 20px; line-height:1.6;">
              Recebemos uma solicitação para redefinir a senha da sua conta na Velvet. Use o código abaixo para continuar.
            </p>

            <div style="background:#f8f4ff; padding:24px 16px; border-radius:10px; margin:20px 0; text-align:center;">
              <p style="margin:0 0 8px; font-size:13px; color:#6b5a7d; letter-spacing:0.5px; text-transform:uppercase;">
                Seu código de verificação
              </p>
              <p style="margin:0; font-size:36px; font-weight:bold; color:#6f42c1; letter-spacing:8px;">
                ${codigo}
              </p>
            </div>

            <div style="background:#fff7fb; padding:14px 16px; border-radius:10px; margin:20px 0;">
              <p style="margin:0; line-height:1.6; font-size:13px; color:#7a1f52;">
                ⏳ Este código expira em <strong>15 minutos</strong>. Se você não solicitou a recuperação de senha, ignore este email — sua conta está segura.
              </p>
            </div>

            <p style="margin:24px 0 0; line-height:1.6; text-align:center; color:#6b5a7d;">
              Equipe Velvet 💜
            </p>

          </div>
        </div>
      `
    });

    return res.json({ ok: true });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ ERRO PASSWORD FORGOT:", error);
    return res.status(500).json({ error: "Erro ao enviar código" });
  } finally {
    client.release();
  }
});

// ===========================
// REGISTAR NOVA SENHA
// ===========================

app.post("/api/password/reset", async (req, res) => {
  const client = await db.connect();

  try {
    let { email, codigo, novaSenha } = req.body;

    if (!email || !codigo || !novaSenha) {
      return res.status(400).json({ error: "Dados incompletos" });
    }

    if (novaSenha.length < 6) {
      return res.status(400).json({ error: "Senha muito curta" });
    }

    email = email.trim().toLowerCase();

    await client.query("BEGIN");

    const userRes = await client.query(
      `
      SELECT id
      FROM users
      WHERE email = $1
        AND ativo = true
      LIMIT 1
      `,
      [email]
    );

    if (userRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Código inválido" });
    }

    const userId = userRes.rows[0].id;

    const resetRes = await client.query(
      `
      SELECT id
      FROM password_resets
      WHERE user_id = $1
        AND codigo = $2
        AND usado = false
        AND expires_at > NOW()
      ORDER BY criado_em DESC
      LIMIT 1
      `,
      [userId, codigo]
    );

    if (resetRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Código inválido ou expirado" });
    }

    const senhaHash = await bcrypt.hash(novaSenha, 10);

    await client.query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
        AND ativo = true
      `,
      [senhaHash, userId]
    );

    await client.query(
      `
      UPDATE password_resets
      SET usado = true
      WHERE id = $1
      `,
      [resetRes.rows[0].id]
    );

    await client.query("COMMIT");

    return res.json({ success: true });

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("❌ ERRO PASSWORD RESET:", error);
    return res.status(500).json({ error: "Erro ao redefinir senha" });
  } finally {
    client.release();
  }
});

// =============================
// FALE CONOSCO / CONTATO
// =============================

app.post("/api/contato", async (req, res) => {
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
      str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");

    await resend.emails.send({
      from: "Velvet <contato@velvet.lat>",
      to: [process.env.EMAIL_TO],        // email onde recebes os contatos
      replyTo: email,
      subject: `[Contato] ${escape(assunto)}`,
      html: `
        <h3>Novo contato pelo site</h3>
        <p><b>Nome:</b> ${escape(nome)}</p>
        <p><b>Email:</b> ${escape(email)}</p>
        <p><b>Assunto:</b> ${escape(assunto)}</p>
        <p><b>Mensagem:</b></p>
        <p>${escape(mensagem).replace(/\n/g, "<br>")}</p>
      `
    });

    return res.json({ success: true });

  } catch (error) {
    console.error("❌ Erro contato:", error);
    return res.status(500).json({ error: "Erro ao enviar mensagem" });
  }
});

// ===========================
// MARCAR LIDO MODELO
// ===========================

app.post("/api/chat/modelo/marcar-lido/:cliente_id", authModelo, async (req, res) => {
  const userId = req.user.id;
  const cliente_id = Number(req.params.cliente_id);

  if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
    return res.status(400).json({ error: "cliente_id inválido" });
  }

  try {
    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [userId]
    );

    if (modeloRes.rowCount === 0) {
      return res.status(404).json({ error: "Modelo não encontrado" });
    }

    const modelo_id = modeloRes.rows[0].id;

    const updateRes = await db.query(
      `
      UPDATE messages
      SET lida = true
      WHERE cliente_id = $1
        AND modelo_id = $2
        AND sender = 'cliente'
        AND COALESCE(lida, false) = false
      `,
      [cliente_id, modelo_id]
    );

    await db.query(
      `
      UPDATE modelos
      SET last_seen = NOW()
      WHERE id = $1
      `,
      [modelo_id]
    );

    return res.json({
      success: true,
      atualizadas: updateRes.rowCount
    });
  } catch (err) {
    console.error("Erro marcar lido:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// MARCAR LIDO CLIENTE
// ===========================

app.post("/api/chat/cliente/marcar-lido/:modelo_id", authCliente, async (req, res) => {
  const userId = req.user.id;
  const modelo_id = Number(req.params.modelo_id);

  if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
    return res.status(400).json({ error: "modelo_id inválido" });
  }

  try {
    const clienteRes = await db.query(
      "SELECT id FROM clientes WHERE user_id = $1",
      [userId]
    );

    if (clienteRes.rowCount === 0) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const cliente_id = clienteRes.rows[0].id;

    const updateRes = await db.query(
      `
      UPDATE messages
      SET lida = true
      WHERE cliente_id = $1
        AND modelo_id = $2
        AND sender = 'modelo'
        AND COALESCE(lida, false) = false
      `,
      [cliente_id, modelo_id]
    );

    await db.query(
      `
      UPDATE clientes
      SET last_seen = NOW()
      WHERE id = $1
      `,
      [cliente_id]
    );

    return res.json({
      success: true,
      atualizadas: updateRes.rowCount
    });
  } catch (err) {
    console.error("Erro marcar lido cliente:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// CONTRATO DIGITAL — ZapSign
// ===========================

// Gera o buffer do PDF do contrato de parceria com o texto completo das 16 cláusulas
function gerarContratoPDFBuffer(dados) {
  // dados: { nome, email, dataHoje }
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 60, bufferPages: true });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = 60;  // left margin
    const W = doc.page.width - L * 2; // usable width

    // ── Helpers ──────────────────────────────────────────────────────
    function titulo(txt) {
      doc.moveDown(0.6)
         .font("Helvetica-Bold").fontSize(10)
         .text(txt, L, doc.y, { width: W })
         .font("Helvetica").fontSize(9);
    }
    function corpo(txt) {
      doc.font("Helvetica").fontSize(9)
         .text(txt, L, doc.y, { width: W, lineGap: 2 });
    }
    function lista(itens) {
      itens.forEach(it => {
        doc.font("Helvetica").fontSize(9)
           .text(`• ${it}`, L + 12, doc.y, { width: W - 12, lineGap: 1 });
      });
    }

    // ── Cabeçalho ────────────────────────────────────────────────────
    doc.font("Helvetica-Bold").fontSize(12)
       .text("CONTRATO DE PARCERIA DIGITAL, INTERMEDIAÇÃO TECNOLÓGICA", L, L, { width: W, align: "center" })
       .text("E USO DA PLATAFORMA VELVET", L, doc.y, { width: W, align: "center" });
    doc.moveDown(0.8);

    doc.font("Helvetica").fontSize(9)
       .text("Pelo presente instrumento particular, de um lado:", L, doc.y, { width: W });
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(9)
       .text("VELVET ENTERTAINMENT LTDA", L, doc.y, { width: W, continued: true })
       .font("Helvetica")
       .text(`, pessoa jurídica de direito privado, inscrita no CNPJ sob nº 66.615.892/0001-43, com sede na Rua Cel. José Eusébio, nº 95, Casa 13, Higienópolis, São Paulo/SP, CEP 01.239-030, doravante denominada simplesmente "VELVET";`, { width: W });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9).text("e, de outro lado,", L, doc.y, { width: W });
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(9)
       .text("CRIADORA DE CONTEÚDO / MODELO / INFLUENCER", L, doc.y, { width: W, continued: true })
       .font("Helvetica")
       .text(`, pessoa física maior de 18 (dezoito) anos, devidamente cadastrada na plataforma digital Velvet, doravante denominada simplesmente "CRIADORA";`, { width: W });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9)
       .text("resolvem celebrar o presente CONTRATO DE PARCERIA DIGITAL E INTERMEDIAÇÃO TECNOLÓGICA, mediante as cláusulas e condições abaixo:", L, doc.y, { width: W });

    // ── Cláusulas ─────────────────────────────────────────────────────
    titulo("CLÁUSULA 1 – OBJETO");
    corpo("1.1. O presente contrato regula a utilização da plataforma digital Velvet pela CRIADORA para:");
    lista(["publicação;", "hospedagem;", "monetização;", "comercialização;", "distribuição digital;", "disponibilização de conteúdo online."]);
    corpo("1.2. A VELVET atua exclusivamente como:");
    lista(["plataforma tecnológica;", "marketplace digital;", "intermediadora de pagamentos;", "hospedeira de conteúdo;", "facilitadora de monetização digital."]);
    corpo("1.3. A VELVET NÃO:");
    lista(["produz conteúdo;", "dirige atividades da CRIADORA;", "mantém controle artístico;", "impõe metas;", "determina horários;", "realiza contratação empregatícia;", "atua como empresária individual da CRIADORA."]);
    corpo("1.4. A relação entre as partes possui natureza exclusivamente civil, comercial, tecnológica e autônoma.");

    titulo("CLÁUSULA 2 – NATUREZA AUTÔNOMA DA RELAÇÃO");
    corpo("2.1. A CRIADORA reconhece expressamente que exerce atividade autônoma e independente.");
    corpo("2.2. O presente contrato não caracteriza: vínculo empregatício, relação trabalhista, sociedade, representação comercial, associação, franquia, mandato ou relação de emprego de qualquer natureza.");
    corpo("2.3. Não há: subordinação jurídica, pessoalidade obrigatória, controle de jornada, habitualidade dirigida, salário fixo ou exclusividade.");
    corpo("2.4. A CRIADORA possui liberdade integral para definir horários, escolher conteúdos, atuar em outras plataformas, prestar serviços a terceiros, trabalhar com outras agências e interromper atividades quando desejar.");
    corpo("2.5. A utilização da plataforma ocorre por livre iniciativa da própria CRIADORA.");

    titulo("CLÁUSULA 3 – COMISSÃO E REPASSES");
    corpo("3.1. Os valores pagos pelos usuários da plataforma pertencem originariamente à CRIADORA.");
    corpo("3.2. Pela disponibilização da infraestrutura tecnológica e operacional, a VELVET fará jus à comissão de 20% (vinte por cento) sobre os valores líquidos efetivamente recebidos pela plataforma.");
    corpo("3.3. O percentual remanescente pertencerá integralmente à CRIADORA.");
    corpo("3.4. Caso a CRIADORA esteja vinculada a agência parceira, poderá haver retenção adicional de percentual contratualmente ajustado entre a agência e a própria CRIADORA.");
    corpo("3.5. A VELVET não integra eventual relação contratual privada entre agência, empresária, assessoria, intermediadores externos e a CRIADORA.");
    corpo("3.6. Os pagamentos observarão: políticas antifraude, disponibilidade bancária, compliance financeiro, regras operacionais da plataforma e prazos internos de processamento.");

    titulo("CLÁUSULA 4 – CLÁUSULA FISCAL E TRIBUTÁRIA");
    corpo("4.1. A CRIADORA é exclusivamente responsável pelo recolhimento de tributos, obrigações fiscais, declarações tributárias, contribuições previdenciárias e emissão de notas fiscais quando exigidas.");
    corpo("4.2. A VELVET atua exclusivamente como intermediadora tecnológica e financeira.");
    corpo("4.3. Os valores transitados pela plataforma incluem quantias pertencentes às CRIADORAS, sendo receita própria da VELVET exclusivamente a comissão de intermediação tecnológica prevista contratualmente.");
    corpo("4.4. Os valores destinados às CRIADORAS não constituem: salário, folha de pagamento, remuneração trabalhista ou contraprestação empregatícia.");
    corpo("4.5. Cada parte responderá individualmente perante: Receita Federal, órgãos trabalhistas, autoridades previdenciárias e administrativas, pelas próprias obrigações legais.");

    titulo("CLÁUSULA 5 – OBJETO SOCIAL E ATIVIDADE DA VELVET");
    corpo("5.1. A CRIADORA reconhece que a VELVET possui como atividade empresarial: portais e provedores de conteúdo na internet, intermediação de serviços e negócios, publicidade digital, tecnologia e desenvolvimento de software.");
    corpo("5.2. A atuação da VELVET limita-se à disponibilização de: ambiente virtual, infraestrutura tecnológica, sistemas digitais, monetização online e intermediação operacional.");

    titulo("CLÁUSULA 6 – COMPLIANCE DE CONTEÚDO");
    corpo("6.1. É proibida a publicação de: conteúdo envolvendo menores, violência real, exploração sexual ilegal, pornografia não consensual, tráfico humano, conteúdo criminoso, conteúdo obtido sem autorização, material protegido por direitos autorais sem licença, conteúdo discriminatório e vazamentos íntimos.");
    corpo("6.2. A CRIADORA declara: ser maior de 18 anos, possuir plena capacidade civil, deter autorização sobre os conteúdos publicados e possuir consentimento de terceiros eventualmente participantes.");
    corpo("6.3. A CRIADORA responsabiliza-se integralmente pelos conteúdos disponibilizados.");

    titulo("CLÁUSULA 7 – KYC E VERIFICAÇÃO DE IDENTIDADE");
    corpo("7.1. A CRIADORA deverá fornecer: documento oficial com foto, selfie de verificação, prova de maioridade e informações cadastrais verdadeiras.");
    corpo("7.2. A VELVET poderá: solicitar documentação complementar, realizar verificações antifraude, suspender contas irregulares e bloquear acessos suspeitos.");
    corpo("7.3. Os dados serão tratados conforme a Lei Geral de Proteção de Dados e o Marco Civil da Internet.");

    titulo("CLÁUSULA 8 – LICENÇA DE USO DE CONTEÚDO");
    corpo("8.1. A titularidade dos conteúdos permanece pertencendo exclusivamente à CRIADORA.");
    corpo("8.2. A CRIADORA concede à VELVET licença não exclusiva, limitada, revogável e temporária para: hospedagem, distribuição interna, exibição na plataforma, reprodução técnica e divulgação operacional.");
    corpo("8.3. A presente licença não transfere propriedade intelectual à VELVET.");

    titulo("CLÁUSULA 9 – MODERAÇÃO E REMOÇÃO");
    corpo("9.1. A VELVET poderá remover conteúdos ou suspender contas em caso de: violação legal, descumprimento contratual, risco regulatório, fraude, ordem judicial ou violação das políticas internas.");
    corpo("9.2. A moderação realizada pela VELVET não caracteriza: direção da atividade, ingerência artística, vínculo trabalhista ou responsabilidade editorial integral.");

    titulo("CLÁUSULA 10 – RESPONSABILIDADE CIVIL");
    corpo("10.1. A CRIADORA responderá integralmente por: danos a terceiros, violações legais, uso indevido de imagem, infrações autorais e conteúdos ilícitos.");
    corpo("10.2. A CRIADORA obriga-se a indenizar a VELVET por quaisquer prejuízos, condenações, multas, despesas judiciais e danos reputacionais decorrentes dos conteúdos publicados pela própria CRIADORA.");

    titulo("CLÁUSULA 11 – PROPRIEDADE INTELECTUAL");
    corpo("11.1. A VELVET permanece titular da plataforma, do software, da marca, da identidade visual e da infraestrutura tecnológica.");
    corpo("11.2. É vedada qualquer utilização indevida da marca Velvet sem autorização expressa.");

    titulo("CLÁUSULA 12 – PRIVACIDADE E DADOS");
    corpo("12.1. As partes comprometem-se a observar integralmente a LGPD.");
    corpo("12.2. Os dados coletados poderão ser utilizados para: autenticação, prevenção à fraude, processamento de pagamentos, segurança da plataforma, cumprimento regulatório e ordens judiciais.");

    titulo("CLÁUSULA 13 – PROVAS DIGITAIS");
    corpo("13.1. As partes reconhecem validade jurídica de: assinatura eletrônica, aceite digital, logs, registros de IP, geolocalização, autenticação multifator e comprovantes eletrônicos.");
    corpo("13.2. Os registros digitais poderão ser utilizados como prova judicial e extrajudicial.");

    titulo("CLÁUSULA 14 – RESCISÃO");
    corpo("14.1. O contrato vigorará por prazo indeterminado.");
    corpo("14.2. Qualquer das partes poderá rescindir o contrato a qualquer momento.");
    corpo("14.3. A VELVET poderá rescindir imediatamente em caso de: fraude, atividade ilícita, violação contratual, risco regulatório ou determinação judicial.");

    titulo("CLÁUSULA 15 – INEXISTÊNCIA DE EXCLUSIVIDADE");
    corpo("15.1. O presente contrato não estabelece exclusividade entre as partes.");
    corpo("15.2. A CRIADORA poderá utilizar outras plataformas e prestar serviços para terceiros livremente.");

    titulo("CLÁUSULA 16 – FORO");
    corpo("16.1. Fica eleito o foro da Comarca de São Paulo/SP para resolução de quaisquer controvérsias oriundas deste contrato.");

    // ── Declaração Final ─────────────────────────────────────────────
    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(10)
       .text("DECLARAÇÃO FINAL DA CRIADORA", L, doc.y, { width: W, align: "center" });
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(9)
       .text("Ao aceitar este contrato, a CRIADORA declara expressamente que:", L, doc.y, { width: W });
    doc.moveDown(0.3);
    lista([
      "I – atua de forma autônoma e independente;",
      "II – compreende que a VELVET é apenas plataforma digital e marketplace tecnológico;",
      "III – reconhece inexistência de vínculo empregatício;",
      "IV – é maior de 18 anos;",
      "V – assume responsabilidade integral pelos conteúdos publicados;",
      "VI – concorda com a comissão de 20% da plataforma;",
      "VII – responsabiliza-se por suas obrigações fiscais e tributárias;",
      "VIII – aceita as políticas internas da plataforma."
    ]);

    // ── Assinaturas ────────────────────────────────────────────────────
    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(9)
       .text(`São Paulo/SP, ${dados.dataHoje}.`, L, doc.y, { width: W });
    doc.moveDown(1.2);

    const metade = (W - 40) / 2;
    const col2 = L + metade + 40;

    // Velvet lado esquerdo
    doc.font("Helvetica-Bold").fontSize(9)
       .text("VELVET ENTERTAINMENT LTDA", L, doc.y, { width: metade });
    const yAssin = doc.y;
    doc.font("Helvetica").fontSize(9)
       .text("CNPJ: 66.615.892/0001-43", L, doc.y, { width: metade })
       .text("Representante Legal: _________________________", L, doc.y, { width: metade });

    // Criadora lado direito
    doc.font("Helvetica-Bold").fontSize(9)
       .text("CRIADORA / MODELO / INFLUENCER", col2, yAssin, { width: metade });
    doc.font("Helvetica").fontSize(9)
       .text(`Nome: ${dados.nome || "________________________________"}`, col2, doc.y + 4, { width: metade })
       .text(`E-mail: ${dados.email || "______________________________"}`, col2, doc.y, { width: metade })
       .text("Assinatura Eletrônica: [ZapSign]", col2, doc.y, { width: metade });

    doc.end();
  });
}

// Envia PDF para ZapSign e devolve { token, signerToken, signUrl }
async function enviarContratoZapSign(pdfBuffer, nomeModelo, emailModelo) {
  const base64Pdf = pdfBuffer.toString("base64");
  const resp = await axios.post(
    "https://api.zapsign.com.br/api/v1/docs/",
    {
      name: `Contrato Velvet — ${nomeModelo}`,
      base64_pdf: base64Pdf,
      sandbox: process.env.ZAPSIGN_SANDBOX === "true",
      signers: [
        {
          name: nomeModelo,
          email: emailModelo,
          auth_mode: "assinaturaTela",
          send_automatic_email: false
        }
      ],
      lang: "pt-br",
      disable_signer_emails: true
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.ZAPSIGN_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      timeout: 30000
    }
  );
  const doc = resp.data;
  const signer = doc.signers?.[0];
  if (!signer) throw new Error("ZapSign não retornou signatário");
  const signUrl = `https://app.zapsign.com.br/verificar/${signer.token}`;
  return {
    token: doc.token,
    signerToken: signer.token,
    signUrl
  };
}

// Descarrega o PDF assinado do ZapSign e guarda no R2 privado
// Devolve a key do R2 ou null se falhar
async function descarregarPDFAssinadoZapSign(docToken, modeloId) {
  try {
    if (!process.env.ZAPSIGN_API_TOKEN) return null;

    const zapDoc = await axios.get(
      `https://api.zapsign.com.br/api/v1/docs/${docToken}/`,
      {
        headers: { Authorization: `Bearer ${process.env.ZAPSIGN_API_TOKEN}` },
        timeout: 15000
      }
    );

    const signedFileUrl = zapDoc.data?.signed_file || zapDoc.data?.original_file || null;
    if (!signedFileUrl) {
      console.warn(`[ZapSign] Documento ${docToken} não tem signed_file ainda`);
      return null;
    }

    const pdfResp = await axios.get(signedFileUrl, {
      responseType: "arraybuffer",
      timeout: 30000
    });
    const pdfBuffer = Buffer.from(pdfResp.data);

    const r2Key = `contratos/${modeloId}/contrato-assinado-${Date.now()}.pdf`;
    await s3Privado.putObject({
      Bucket: process.env.R2_BUCKET_PRIVATE,
      Key: r2Key,
      Body: pdfBuffer,
      ContentType: "application/pdf"
    }).promise();

    await db.query(
      "UPDATE modelos SET contrato_pdf_url = $1 WHERE id = $2",
      [r2Key, modeloId]
    );

    // Se a modelo já submeteu a verificação, actualizar também esse registo
    await db.query(
      `UPDATE modelos_verificacao
          SET contrato_pdf_url = $1
        WHERE modelo_id = $2
          AND (contrato_pdf_url IS NULL OR contrato_pdf_url = '')`,
      [r2Key, modeloId]
    );

    console.log(`[ZapSign] PDF assinado guardado em R2: ${r2Key}`);
    return r2Key;
  } catch (err) {
    console.warn(`[ZapSign] Erro ao descarregar PDF assinado: ${err.message}`);
    return null;
  }
}

// GET /api/verificacao/contrato/status
// Devolve se o contrato já foi assinado e a URL de assinatura actual
app.get("/api/verificacao/contrato/status", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const modeloRes = await db.query(
      `SELECT id, contrato_assinado, contrato_sign_url, contrato_assinado_em, contrato_token, contrato_signer_token
         FROM modelos WHERE user_id = $1`,
      [userId]
    );
    if (modeloRes.rowCount === 0) return res.status(404).json({ erro: "Modelo não encontrado" });
    const m = modeloRes.rows[0];

    // Buscar contrato_pdf_url também para sabermos se precisamos baixar
    const pdfRes = await db.query(
      "SELECT contrato_pdf_url FROM modelos WHERE id = $1",
      [m.id]
    );
    const jaTemPdf = !!pdfRes.rows[0]?.contrato_pdf_url;

    // Se já marcado como assinado — devolve direto (mas se não temos PDF, tentar baixar)
    if (m.contrato_assinado) {
      if (!jaTemPdf && m.contrato_token) {
        // PDF ainda não foi descarregado — tentar agora
        descarregarPDFAssinadoZapSign(m.contrato_token, m.id).catch(() => {});
      }
      return res.json({ assinado: true, assinado_em: m.contrato_assinado_em });
    }

    // Se tem signer_token, pollar ZapSign para ver se já assinou
    if (m.contrato_signer_token && process.env.ZAPSIGN_API_TOKEN) {
      try {
        const zapResp = await axios.get(
          `https://api.zapsign.com.br/api/v1/signers/${m.contrato_signer_token}/`,
          {
            headers: { Authorization: `Bearer ${process.env.ZAPSIGN_API_TOKEN}` },
            timeout: 10000
          }
        );
        const status = zapResp.data?.status;
        if (status === "signed") {
          // Actualiza BD
          await db.query(
            "UPDATE modelos SET contrato_assinado = true, contrato_assinado_em = NOW() WHERE id = $1",
            [m.id]
          );
          // Baixar o PDF assinado e guardar no R2
          if (m.contrato_token) {
            await descarregarPDFAssinadoZapSign(m.contrato_token, m.id);
          }
          return res.json({ assinado: true, assinado_em: new Date().toISOString() });
        }
      } catch (pollErr) {
        console.warn("[ZapSign] Erro ao pollar status:", pollErr.message);
      }
    }

    return res.json({
      assinado: false,
      sign_url: m.contrato_sign_url || null,
      tem_contrato: !!m.contrato_token
    });
  } catch (err) {
    console.error("Erro ao verificar status contrato:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// POST /api/verificacao/contrato
// Gera o contrato PDF, envia ao ZapSign, guarda tokens, devolve URL de assinatura
const contratoLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { erro: "Muitas tentativas. Tente novamente em 1 hora." }
});

app.post("/api/verificacao/contrato", auth, contratoLimiter, async (req, res) => {
  try {
    const userId = req.user.id;
    if (req.user.role !== "modelo") {
      return res.status(403).json({ erro: "Apenas modelos podem assinar o contrato" });
    }

    // Buscar dados da modelo
    const modeloRes = await db.query(
      `SELECT m.id, m.contrato_assinado, m.contrato_sign_url, m.contrato_token,
              md.nome_completo,
              u.email
         FROM modelos m
         LEFT JOIN modelos_dados md ON md.modelo_id = m.id AND md.ativo = true
         JOIN users u ON u.id = m.user_id
        WHERE m.user_id = $1`,
      [userId]
    );
    if (modeloRes.rowCount === 0) return res.status(404).json({ erro: "Modelo não encontrada" });
    const m = modeloRes.rows[0];

    // Se já assinou — devolve URL existente
    if (m.contrato_assinado) {
      return res.json({ ok: true, ja_assinado: true });
    }

    // Se já tem documento criado no ZapSign — devolve URL existente
    if (m.contrato_token && m.contrato_sign_url) {
      return res.json({ ok: true, sign_url: m.contrato_sign_url });
    }

    if (!m.nome_completo) {
      return res.status(400).json({ erro: "Preencha primeiro os dados pessoais (Passo 2) antes de assinar o contrato." });
    }

    // Data formatada em português
    const hoje = new Date();
    const dataHoje = hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

    // Gerar PDF
    const pdfBuffer = await gerarContratoPDFBuffer({
      nome: m.nome_completo,
      email: m.email,
      dataHoje
    });

    // Enviar ao ZapSign
    if (!process.env.ZAPSIGN_API_TOKEN) {
      return res.status(500).json({ erro: "ZapSign não configurado. Contacte o suporte." });
    }

    const { token, signerToken, signUrl } = await enviarContratoZapSign(
      pdfBuffer,
      m.nome_completo,
      m.email
    );

    // Guardar tokens no BD
    await db.query(
      `UPDATE modelos
          SET contrato_token = $1,
              contrato_signer_token = $2,
              contrato_sign_url = $3
        WHERE id = $4`,
      [token, signerToken, signUrl, m.id]
    );

    console.log(`[CONTRATO] Modelo ${m.id} — ZapSign doc ${token}`);
    res.json({ ok: true, sign_url: signUrl });
  } catch (err) {
    console.error("Erro ao criar contrato ZapSign:", err.response?.data || err.message);
    res.status(500).json({ erro: "Erro ao gerar contrato. Tente novamente." });
  }
});

// ===========================
// VERIFICACAO PERFIL
// ===========================

app.post("/api/verificacao", auth, uploadVerificacaoLimiter, uploadVerificacao.fields([{ name: "doc_frente", maxCount: 1 },{ name: "doc_verso", maxCount: 1 },{ name: "selfie", maxCount: 1 }]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const role = req.user.role;

      const {
        documento_tipo,
        confirmacao_identidade,
        aceite_privacidade,
        aceite_termos_criador,
        versao_privacidade,
        versao_termos_criador
      } = req.body;

      const ip =
        req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
        req.socket?.remoteAddress ||
        null;

      if (!documento_tipo) {
        return res.status(400).json({
          erro: "Tipo de documento obrigatório"
        });
      }

      if (!req.files?.doc_frente || !req.files?.selfie) {
        return res.status(400).json({
          erro: "Documento frente e selfie são obrigatórios"
        });
      }

      if (
        confirmacao_identidade !== true &&
        confirmacao_identidade !== "true"
      ) {
        return res.status(400).json({
          erro: "É obrigatório confirmar identidade, maioridade e autorização de verificação"
        });
      }

      if (
        aceite_privacidade !== true &&
        aceite_privacidade !== "true"
      ) {
        return res.status(400).json({
          erro: "É obrigatório aceitar a Política de Privacidade"
        });
      }

      if (
        aceite_termos_criador !== true &&
        aceite_termos_criador !== "true"
      ) {
        return res.status(400).json({
          erro: "É obrigatório aceitar os Termos e Condições para Criadores"
        });
      }

      const docFrenteUrl = req.files.doc_frente[0].key;
      const docVersoUrl = req.files.doc_verso?.[0]?.key || null;
      const selfieUrl = req.files.selfie[0].key;

      // MODELO
      if (role === "modelo") {
        const modeloRes = await db.query(
          "SELECT id, contrato_assinado, contrato_pdf_url FROM modelos WHERE user_id = $1",
          [userId]
        );

        if (modeloRes.rowCount === 0) {
          return res.status(400).json({ erro: "Modelo não encontrado" });
        }

        const { id: modeloId, contrato_assinado, contrato_pdf_url } = modeloRes.rows[0];

        // Verificar se o contrato foi assinado antes de aceitar documentos
        if (!contrato_assinado) {
          return res.status(403).json({
            erro: "CONTRACT_NOT_SIGNED",
            message: "O contrato de parceria ainda não foi assinado. Conclua o Passo 3 antes de enviar os documentos."
          });
        }

        await db.query(
          `
          INSERT INTO modelos_verificacao (
            modelo_id,
            documento_tipo,
            doc_frente_url,
            doc_verso_url,
            selfie_url,
            confirmacao_identidade,
            aceite_privacidade,
            aceite_termos_criador,
            versao_privacidade,
            versao_termos_criador,
            aceite_em,
            aceite_ip,
            status,
            contrato_pdf_url,
            criado_em,
            atualizado_em
          )
          VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,$10,
            NOW(),$11,'em_analise',$12, NOW(), NOW()
          )
          ON CONFLICT (modelo_id)
          DO UPDATE SET
            documento_tipo = EXCLUDED.documento_tipo,
            doc_frente_url = EXCLUDED.doc_frente_url,
            doc_verso_url = EXCLUDED.doc_verso_url,
            selfie_url = EXCLUDED.selfie_url,
            confirmacao_identidade = EXCLUDED.confirmacao_identidade,
            aceite_privacidade = EXCLUDED.aceite_privacidade,
            aceite_termos_criador = EXCLUDED.aceite_termos_criador,
            versao_privacidade = EXCLUDED.versao_privacidade,
            versao_termos_criador = EXCLUDED.versao_termos_criador,
            aceite_em = NOW(),
            aceite_ip = EXCLUDED.aceite_ip,
            status = 'em_analise',
            contrato_pdf_url = EXCLUDED.contrato_pdf_url,
            atualizado_em = NOW()
          `,
          [
            modeloId,
            documento_tipo,
            docFrenteUrl,
            docVersoUrl,
            selfieUrl,
            true,
            true,
            true,
            versao_privacidade || "2026-04-06",
            versao_termos_criador || "2026-04-06",
            ip,
            contrato_pdf_url || null
          ]
        );

        return res.json({ ok: true });
      }

      // CLIENTE
      if (role === "cliente") {
        const clienteRes = await db.query(
          "SELECT id FROM clientes WHERE user_id = $1",
          [userId]
        );

        if (clienteRes.rowCount === 0) {
          return res.status(400).json({ erro: "Cliente não encontrado" });
        }

        const clienteId = clienteRes.rows[0].id;

        await db.query(
          `
          INSERT INTO clientes_verificacao (
            cliente_id,
            documento_tipo,
            doc_frente_url,
            doc_verso_url,
            selfie_url,
            confirmacao_identidade,
            aceite_privacidade,
            aceite_termos_criador,
            versao_privacidade,
            versao_termos_criador,
            aceite_em,
            aceite_ip,
            status,
            criado_em,
            atualizado_em
          )
          VALUES (
            $1,$2,$3,$4,$5,
            $6,$7,$8,$9,$10,
            NOW(),$11,'em_analise', NOW(), NOW()
          )
          ON CONFLICT (cliente_id)
          DO UPDATE SET
            documento_tipo = EXCLUDED.documento_tipo,
            doc_frente_url = EXCLUDED.doc_frente_url,
            doc_verso_url = EXCLUDED.doc_verso_url,
            selfie_url = EXCLUDED.selfie_url,
            confirmacao_identidade = EXCLUDED.confirmacao_identidade,
            aceite_privacidade = EXCLUDED.aceite_privacidade,
            aceite_termos_criador = EXCLUDED.aceite_termos_criador,
            versao_privacidade = EXCLUDED.versao_privacidade,
            versao_termos_criador = EXCLUDED.versao_termos_criador,
            aceite_em = NOW(),
            aceite_ip = EXCLUDED.aceite_ip,
            status = 'em_analise',
            atualizado_em = NOW()
          `,
          [
            clienteId,
            documento_tipo,
            docFrenteUrl,
            docVersoUrl,
            selfieUrl,
            true,
            true,
            true,
            versao_privacidade || "2026-04-06",
            versao_termos_criador || "2026-04-06",
            ip
          ]
        );

        return res.json({ ok: true });
      }

      return res.status(403).json({ erro: "Role inválida" });
    } catch (err) {
      console.error("❌ Erro upload verificação:", err);
      return res.status(500).json({ erro: "Erro ao enviar documentos" });
    }
  }
);

// ===========================
// ACEITE DE TERMOS (MODELO)
// ===========================

const VERSAO_TERMOS_ATUAL = "2026-05";

// GET /api/modelo/aceite-termos/status
// Verifica se a modelo já aceitou a versão atual dos termos
app.get("/api/modelo/aceite-termos/status", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const modeloRes = await db.query(
      "SELECT id, termos_aceites, termos_versao FROM modelos WHERE user_id = $1",
      [userId]
    );

    if (!modeloRes.rowCount) {
      return res.status(404).json({ erro: "Modelo não encontrado" });
    }

    const { id: modeloId, termos_aceites, termos_versao } = modeloRes.rows[0];
    const precisaAceitar = !termos_aceites || termos_versao !== VERSAO_TERMOS_ATUAL;

    let aceite = null;
    if (!precisaAceitar) {
      const aceiteRes = await db.query(
        "SELECT aceite_em, versao FROM modelo_aceite_termos WHERE modelo_id = $1 AND versao = $2",
        [modeloId, VERSAO_TERMOS_ATUAL]
      );
      aceite = aceiteRes.rows[0] || null;
    }

    res.json({
      aceito: !precisaAceitar,
      versao_atual: VERSAO_TERMOS_ATUAL,
      versao_aceite: termos_versao || null,
      aceite_em: aceite?.aceite_em || null
    });
  } catch (err) {
    console.error("Erro ao verificar aceite de termos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// POST /api/modelo/aceite-termos
// Regista o aceite das 5 declarações com evidência forense (IP, UA, versão, timestamp)
app.post("/api/modelo/aceite-termos", auth, async (req, res) => {
  try {
    const userId = req.user.id;

    const {
      aceite_maioridade,
      aceite_conteudo,
      aceite_tributario,
      aceite_independente,
      aceite_financeiro,
      user_agent: uaFromBody
    } = req.body;

    // Todos os 5 aceites são obrigatórios
    const todos = [aceite_maioridade, aceite_conteudo, aceite_tributario, aceite_independente, aceite_financeiro];
    if (todos.some(v => v !== true && v !== "true")) {
      return res.status(400).json({ erro: "Todas as declarações são obrigatórias" });
    }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || null;

    const ua = uaFromBody || req.headers["user-agent"] || null;

    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [userId]
    );

    if (!modeloRes.rowCount) {
      return res.status(404).json({ erro: "Modelo não encontrado" });
    }

    const modeloId = modeloRes.rows[0].id;

    // Registo auditável com UPSERT (garante que re-aceite actualiza o registo)
    await db.query(`
      INSERT INTO modelo_aceite_termos (
        modelo_id, versao,
        aceite_maioridade, aceite_conteudo, aceite_tributario,
        aceite_independente, aceite_financeiro,
        aceite_ip, aceite_user_agent, aceite_em
      )
      VALUES ($1, $2, true, true, true, true, true, $3, $4, NOW())
      ON CONFLICT (modelo_id, versao) DO UPDATE SET
        aceite_maioridade   = true,
        aceite_conteudo     = true,
        aceite_tributario   = true,
        aceite_independente = true,
        aceite_financeiro   = true,
        aceite_ip           = EXCLUDED.aceite_ip,
        aceite_user_agent   = EXCLUDED.aceite_user_agent,
        aceite_em           = NOW()
    `, [modeloId, VERSAO_TERMOS_ATUAL, ip, ua]);

    // Actualizar atalho na tabela modelos
    await db.query(
      "UPDATE modelos SET termos_aceites = true, termos_versao = $1 WHERE id = $2",
      [VERSAO_TERMOS_ATUAL, modeloId]
    );

    console.log(`[TERMOS] Modelo ${modeloId} aceitou termos v${VERSAO_TERMOS_ATUAL} | IP: ${ip}`);

    res.json({ ok: true, versao: VERSAO_TERMOS_ATUAL, aceite_em: new Date().toISOString() });
  } catch (err) {
    console.error("Erro ao registar aceite de termos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ===========================
// CARREGAR MIDIAS CONTEUDOS
// ===========================

app.post("/api/conteudos", authModelo, uploadLimiter, uploadB2.array("file", 10), async (req, res) => {

    const userId = req.user.id;
    const { preco, descricao } = req.body;

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: "Arquivo obrigatório"
      });
    }

    try {

      const modeloRes = await db.query(
        "SELECT id, verificada FROM modelos WHERE user_id = $1",
        [userId]
      );

      if (modeloRes.rowCount === 0) {
        return res.status(404).json({
          error: "Modelo não encontrado"
        });
      }

      if (!modeloRes.rows[0].verificada) {
        return res.status(403).json({ error: "Conta não verificada. Apenas modelos verificadas podem fazer upload de conteúdos." });
      }

      const modelo_id = modeloRes.rows[0].id;

      const resultados = [];

      for (const file of req.files) {

  const { mimetype, originalname, buffer } = file;

  let tipo;

  if (mimetype.startsWith("image/")) {
    tipo = "imagem";
  }
  else if (mimetype.startsWith("video/")) {
    tipo = "video";
  }
  else {
    continue;
  }

  let url = null;
  let thumbnailUrl = null;

  // IMAGEM ou VIDEO — bucket "venda"
  const uploadResult = await uploadToSupabase(buffer, mimetype, originalname, "venda");
  url = uploadResult.url;
  thumbnailUrl = uploadResult.thumb_url;

  const result = await db.query(
    `
    INSERT INTO conteudos (
      modelo_id,
      url,
      thumbnail_url,
      tipo,
      tipo_conteudo,
      preco,
      descricao,
      criado_em
    )
    VALUES ($1,$2,$3,$4,'venda',$5,$6,NOW())
    RETURNING *
    `,
    [
      modelo_id,
      url,
      thumbnailUrl,
      tipo,
      preco || 0,
      descricao || null
    ]
  );

  resultados.push(result.rows[0]);
}

      res.json(resultados);

    } catch (err) {

      console.error("Erro upload múltiplo:", err);

      res.status(500).json({
        error: "Erro ao carregar conteúdo"
      });

    }
  }
);

// ===========================
// MARCAR CONTEUDO VISTO CHAT
// ===========================

app.post("/api/conteudo/visto", auth, async (req, res) => {

  const { message_id } = req.body;

  const clienteRes = await db.query(
    "SELECT id FROM clientes WHERE user_id = $1",
    [req.user.id]
  );

  if (!clienteRes.rowCount) {
    return res.status(404).json({ error: "Cliente não encontrado" });
  }

  const cliente_id = clienteRes.rows[0].id;

  await db.query(`
    UPDATE messages
    SET visto = true,
        updated_at = NOW()
    WHERE id = $1
    AND cliente_id = $2
  `,[message_id, cliente_id]);

  res.json({ ok: true });

});

// ===========================
// ATIVAR PUSH
// ===========================

app.post("/api/notificacoes/inscrever", auth, async (req, res) => {

  try {
    const userId = req.user.id;
    const subscription = req.body;

    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "Subscription inválida" });
    }

    await db.query(
      `
      INSERT INTO push_subscriptions (user_id, subscription_json, created_at, updated_at)
      VALUES ($1, $2, NOW(), NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        subscription_json = EXCLUDED.subscription_json,
        updated_at = NOW()
      `,
      [userId, JSON.stringify(subscription)]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao salvar subscription:", err);
    return res.status(500).json({ error: "Erro ao salvar subscription" });
  }
});

// ===========================
// ATIVAR PUSH NATIVO (CAPACITOR - FCM/APNs)
// ===========================

app.post("/api/notificacoes/inscrever-dispositivo", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { token, platform } = req.body;

    if (!token || !platform) {
      return res.status(400).json({ error: "Token ou plataforma inválidos" });
    }

    await db.query(
      `
      INSERT INTO device_push_tokens (user_id, token, platform, created_at, updated_at)
      VALUES ($1, $2, $3, NOW(), NOW())
      ON CONFLICT (user_id, platform)
      DO UPDATE SET
        token = EXCLUDED.token,
        updated_at = NOW()
      `,
      [userId, token, platform]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao salvar device token:", err);
    return res.status(500).json({ error: "Erro ao salvar token do dispositivo" });
  }
});

// ===========================
// DESATIVAR PUSH
// ===========================

app.post("/api/notificacoes/desinscrever", auth, async (req, res) => {

  try {
    const userId = req.user.id;

    await db.query(
      `
      DELETE FROM push_subscriptions
      WHERE user_id = $1
      `,
      [userId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover subscription:", err);
    return res.status(500).json({ error: "Erro ao remover subscription" });
  }
});

// ===========================
// ENCERRAR OFERTA MANUAL
// ===========================

app.patch("/api/ofertas/:id/encerrar", authModelo, async (req, res) => {
  try {
    const ofertaId = Number(req.params.id);
    const userId = req.user.id;

    if (!Number.isInteger(ofertaId) || ofertaId <= 0) {
      return res.status(400).json({ error: "ID inválido" });
    }

    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [userId]
    );

    if (modeloRes.rowCount === 0) {
      return res.status(404).json({ error: "Modelo não encontrado" });
    }

    const modelo_id = modeloRes.rows[0].id;

    const result = await db.query(
      `
      UPDATE ofertas
      SET ativa = false,
          atualizado_em = NOW()
      WHERE id = $1
        AND modelo_id = $2
      RETURNING *
      `,
      [ofertaId, modelo_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        error: "Oferta não encontrada ou não pertence ao modelo"
      });
    }

    res.json(result.rows[0]);

  } catch (err) {
    console.error("Erro encerrar oferta:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ===========================
// PUBLI PREMIUM
// ===========================

app.post("/api/premium", auth, authModelo, uploadLimiter, uploadB2.array("files", 10), async (req, res) => {
  const client = await db.connect();

  try {
    const userId = Number(req.user?.id || 0);
    const { descricao, preco } = req.body;
    const files = req.files || [];

    if (!files.length) {
      return res.status(400).json({ error: "Envie ao menos uma mídia" });
    }

    const precoNum = Number(preco);
    if (!precoNum || precoNum <= 0) {
      return res.status(400).json({ error: "Preço inválido" });
    }

    const modeloRes = await client.query(
      `
      SELECT id, verificada
      FROM modelos
      WHERE user_id = $1
      LIMIT 1
      `,
      [userId]
    );

    if (!modeloRes.rowCount) {
      return res.status(404).json({ error: "Modelo não encontrado" });
    }

    if (!modeloRes.rows[0].verificada) {
      return res.status(403).json({ error: "Conta não verificada. Apenas modelos verificadas podem publicar conteúdo premium." });
    }

    const modelo_id = Number(modeloRes.rows[0].id);

    await client.query("BEGIN");

    const postRes = await client.query(
      `
      INSERT INTO premium_posts (
        modelo_id,
        url,
        thumb_url,
        tipo,
        tipo_conteudo,
        preco,
        descricao,
        ativo,
        created_at,
        updated_at
      )
      VALUES ($1, NULL, NULL, NULL, $2, $3, $4, true, NOW(), NOW())
      RETURNING id, modelo_id, url, thumb_url, tipo, tipo_conteudo, preco, descricao, ativo, created_at, updated_at
      `,
      [modelo_id, "premium", precoNum, descricao || null]
    );

    const premium_post_id = Number(postRes.rows[0].id);
    const midiasCriadas = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const mimetype = file.mimetype || "";
      const tipo = mimetype.startsWith("video") ? "video" : "foto";

      let url = null;
      let thumb_url = null;

      if (tipo === "foto") {
        const result = await uploadToSupabase(
          file.buffer, file.mimetype,
          file.originalname || `premium-${Date.now()}-${i}.jpg`,
          "premium"
        );
        url = result.url;
        thumb_url = result.thumb_url;
      } else {
        const result = await uploadToSupabase(
          file.buffer, file.mimetype,
          file.originalname || `premium-${Date.now()}-${i}.mp4`,
          "premium"
        );
        url = result.url;
        thumb_url = result.thumb_url;
      }

      if (!url) {
        throw new Error(`Falha ao enviar arquivo ${i + 1} para Cloudflare`);
      }

      const midiaRes = await client.query(
        `
        INSERT INTO premium_post_midias (
          premium_post_id,
          url,
          thumb_url,
          tipo,
          ordem,
          ativo,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, true, NOW())
        RETURNING id, premium_post_id, url, thumb_url, tipo, ordem
        `,
        [premium_post_id, url, thumb_url, tipo, i]
      );

      midiasCriadas.push(midiaRes.rows[0]);
    }

    const primeiraMidia = midiasCriadas[0] || null;

    await client.query(
      `
      UPDATE premium_posts
      SET
        url = $1,
        thumb_url = $2,
        tipo = $3,
        updated_at = NOW()
      WHERE id = $4
      `,
      [
        primeiraMidia?.url || null,
        primeiraMidia?.thumb_url || null,
        primeiraMidia?.tipo || null,
        premium_post_id
      ]
    );

    await client.query("COMMIT");

    return res.json({
      ...postRes.rows[0],
      url: primeiraMidia?.url || null,
      thumb_url: primeiraMidia?.thumb_url || null,
      tipo: primeiraMidia?.tipo || null,
      tipo_conteudo: "premium",
      midias: midiasCriadas
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("=================================");
    console.error("Erro criar premium:");
    console.error("message:", err.message);
    console.error("code:", err.code);
    console.error("detail:", err.detail);
    console.error("table:", err.table);
    console.error("constraint:", err.constraint);
    console.error("stack:", err.stack);

    return res.status(500).json({
      error: "Erro ao criar premium",
      debug: err.message
    });
  } finally {
    client.release();
  }
});

// ===============================
// START SERVER
// ===============================

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log("🚀 Servidor rodando na porta", PORT);
});