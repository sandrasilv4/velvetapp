const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const authCliente = require("../middleware/authCliente");
const { stripe } = require("../config/services");
const { calcTaxaStripe, abacatePayRequest } = require("../utils/pagamentos");
const { marcarConteudoComoLiberadoPorPagamento } = require("../utils/helpers");

// ===========================
// GET /api/pagamento/status/:paymentRef
// ===========================
router.get("/status/:paymentRef", auth, async (req, res) => {
  try {
    const { paymentRef } = req.params;
    if (!paymentRef || String(paymentRef).trim() === "") {
      return res.status(400).json({ error: "paymentRef inválido" });
    }

    function normalizarStatusLocal(status) {
      const s = String(status || "").toLowerCase().trim();
      if (s === "pago") return "pago";
      if (["falhou","failed","refused","denied","cancelled","canceled","requires_payment_method"].includes(s)) return "falhou";
      if (["expired","expirado"].includes(s)) return "expirado";
      if (["chargedback","chargeback","refunded","estornado"].includes(s)) return "falhou";
      if (["requires_action","requires_confirmation","processing","pending","pendente","iniciado","succeeded"].includes(s)) return "pendente";
      return "pendente";
    }

    const premiumRes = await db.query(
      `SELECT status, premium_post_id, modelo_id, metodo_pagamento AS metodo, 'premium' AS tipo, gateway, currency
       FROM premium_unlocks WHERE pagarme_order_id=$1 OR stripe_payment_intent_id=$1 LIMIT 1`,
      [paymentRef]
    );
    if (premiumRes.rowCount > 0) {
      const row = premiumRes.rows[0];
      return res.json({ status: normalizarStatusLocal(row.status), raw_status: row.status, tipo: row.tipo, metodo: row.metodo||null, gateway: row.gateway||null, currency: row.currency||null, message_id: null, premium_post_id: row.premium_post_id||null, modelo_id: row.modelo_id||null });
    }

    const vipPixRes = await db.query(
      `SELECT status, modelo_id, 'pix' AS metodo, 'vip' AS tipo, gateway, currency FROM pagamentos_pix WHERE pagarme_order_id=$1 AND message_id IS NULL LIMIT 1`,
      [paymentRef]
    );
    if (vipPixRes.rowCount > 0) {
      const row = vipPixRes.rows[0];
      return res.json({ status: normalizarStatusLocal(row.status), raw_status: row.status, tipo: row.tipo, metodo: row.metodo, gateway: row.gateway||"pagarme", currency: row.currency||null, message_id: null, premium_post_id: null, modelo_id: row.modelo_id||null });
    }

    const vipCartaoRes = await db.query(
      `SELECT status, modelo_id, 'cartao' AS metodo, 'vip' AS tipo, gateway, currency FROM pagamentos_cartao WHERE (stripe_payment_intent_id=$1 OR gateway_payment_id=$1) AND conteudo_id IS NULL AND tipo='vip' LIMIT 1`,
      [paymentRef]
    );
    if (vipCartaoRes.rowCount > 0) {
      const row = vipCartaoRes.rows[0];
      return res.json({ status: normalizarStatusLocal(row.status), raw_status: row.status, tipo: row.tipo, metodo: row.metodo, gateway: row.gateway||"stripe", currency: row.currency||null, message_id: null, premium_post_id: null, modelo_id: row.modelo_id||null });
    }

    const pixRes = await db.query(
      `SELECT status, message_id, modelo_id, 'pix' AS metodo, 'midia' AS tipo, gateway, currency FROM pagamentos_pix WHERE pagarme_order_id=$1 AND message_id IS NOT NULL LIMIT 1`,
      [paymentRef]
    );
    if (pixRes.rowCount > 0) {
      const row = pixRes.rows[0];
      return res.json({ status: normalizarStatusLocal(row.status), raw_status: row.status, tipo: row.tipo, metodo: row.metodo, gateway: row.gateway||"pagarme", currency: row.currency||null, message_id: row.message_id||null, premium_post_id: null, modelo_id: row.modelo_id||null });
    }

    const cartaoRes = await db.query(
      `SELECT status, conteudo_id AS message_id, modelo_id, 'cartao' AS metodo, 'midia' AS tipo, gateway, currency FROM pagamentos_cartao WHERE (stripe_payment_intent_id=$1 OR gateway_payment_id=$1) AND conteudo_id IS NOT NULL LIMIT 1`,
      [paymentRef]
    );
    if (cartaoRes.rowCount > 0) {
      const row = cartaoRes.rows[0];
      return res.json({ status: normalizarStatusLocal(row.status), raw_status: row.status, tipo: row.tipo, metodo: row.metodo, gateway: row.gateway||"stripe", currency: row.currency||null, message_id: row.message_id||null, premium_post_id: null, modelo_id: row.modelo_id||null });
    }

    return res.json({ status: "pendente", raw_status: null, tipo: null, metodo: null, gateway: null, currency: null, message_id: null, premium_post_id: null, modelo_id: null });
  } catch (err) {
    console.error("Erro status pagamento:", err);
    return res.status(500).json({ error: "erro ao consultar status" });
  }
});

// ===========================
// POST /api/pagamento/vip/pix
// ===========================
router.post("/vip/pix", authCliente, async (req, res) => {
  const client = await db.connect();
  try {
    const { modelo_id, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint, cpf, telefone } = req.body;
    const userId = Number(req.user?.id || 0);
    const cpfVip = String(cpf || "").replace(/\D/g, "") || null;
    const telefoneVip = String(telefone || "").replace(/\D/g, "") || null;

    if (!aceitou_termos) return res.status(400).json({ error: "É necessário aceitar os termos." });
    if (!aceitou_execucao_imediata) return res.status(400).json({ error: "É necessário declarar ciência sobre a execução imediata." });
    if (!aceite_timestamp || Number.isNaN(new Date(aceite_timestamp).getTime())) return res.status(400).json({ error: "Data de aceite inválida." });
    if (!Number.isInteger(userId) || userId <= 0) return res.status(401).json({ error: "Usuário inválido." });

    const modeloIdNum = Number(modelo_id);
    if (!Number.isInteger(modeloIdNum) || modeloIdNum <= 0) return res.status(400).json({ error: "modelo_id inválido" });

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    await client.query("BEGIN");

    const clienteRes = await client.query(
      `SELECT c.id, c.nome, c.bloqueado, u.email FROM clientes c LEFT JOIN users u ON u.id=c.user_id WHERE c.user_id=$1 LIMIT 1`,
      [userId]
    );
    if (!clienteRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Cliente não encontrado" }); }
    const { id: cliente_id, nome, bloqueado, email } = clienteRes.rows[0];
    if (bloqueado) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Conta bloqueada." }); }
    const nomeFinal = String(nome || "").trim() || "Cliente Velvet";
    const emailFinal = String(email || "").trim();
    if (!emailFinal) { await client.query("ROLLBACK"); return res.status(400).json({ error: "E-mail do cliente não encontrado." }); }

    const donaRes = await client.query(`SELECT id FROM modelos WHERE user_id=$1 AND id=$2 LIMIT 1`, [userId, modeloIdNum]);
    if (donaRes.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Não é possível assinar o próprio perfil." }); }

    const modeloRes = await client.query(`SELECT id FROM modelos WHERE id=$1 LIMIT 1`, [modeloIdNum]);
    if (!modeloRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Modelo não encontrada." }); }

    const planoRes = await client.query(`SELECT valor_mensal FROM modelos_planos WHERE modelo_id=$1 LIMIT 1`, [modeloIdNum]);
    if (!planoRes.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Plano VIP não encontrado" }); }
    let valorBase = Number(planoRes.rows[0].valor_mensal) || 0;

    const ofertaRes = await client.query(
      `SELECT valor_promocional FROM ofertas WHERE modelo_id=$1 AND ativa=true AND (data_inicio IS NULL OR data_inicio<=NOW()) AND (data_fim IS NULL OR data_fim>=NOW()) LIMIT 1`,
      [modeloIdNum]
    );
    if (ofertaRes.rowCount) valorBase = Number(ofertaRes.rows[0].valor_promocional) || valorBase;
    if (!valorBase || valorBase <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Valor inválido" }); }

    const { taxaTransacao, valorTotal } = calcTaxaStripe(Number(valorBase.toFixed(2)));
    const amount = Math.round(valorTotal * 100);

    const abacateRes = await abacatePayRequest("POST", "/transparents/create", {
      method: "PIX",
      data: {
        amount, description: "Assinatura VIP Velvet", expiresIn: 3600,
        customer: cpfVip && telefoneVip ? { name: nomeFinal, email: emailFinal, taxId: cpfVip, cellphone: telefoneVip } : undefined,
        metadata: {}, externalId: `vip_${cliente_id}_${modeloIdNum}`
      }
    });

    const abacateId = abacateRes?.data?.id;
    const brCode = abacateRes?.data?.brCode;
    const brCodeB64 = abacateRes?.data?.brCodeBase64;
    const expiresAt = abacateRes?.data?.expiresAt || null;

    if (!abacateId || !brCode) { await client.query("ROLLBACK"); return res.status(500).json({ error: "Erro ao gerar QR PIX" }); }

    await client.query(
      `INSERT INTO pagamentos_pix (cliente_id, modelo_id, valor, status, gateway, pagarme_order_id, criado_em, aceite_ip, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint, cpf, telefone)
       VALUES ($1,$2,$3,'pendente','abacatepay',$4,NOW(),$5,$6,$7,$8,$9,$10,$11,$12)`,
      [cliente_id, modeloIdNum, valorTotal, abacateId, ip, !!aceitou_termos, !!aceitou_execucao_imediata, aceite_timestamp, versao_termos||"2026-04-06", fingerprint||"", cpfVip||null, telefoneVip||null]
    );

    await client.query("COMMIT");
    return res.json({
      qr_code_url: brCodeB64 ? (brCodeB64.startsWith("data:") ? brCodeB64 : `data:image/png;base64,${brCodeB64}`) : null,
      copia_cola: brCode, expires_at: expiresAt, order_id: abacateId
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("ERRO PIX VIP:", err.message);
    return res.status(500).json({ error: "Erro ao gerar pagamento" });
  } finally {
    client.release();
  }
});

// ===========================
// POST /api/pagamento/midia/pix
// ===========================
router.post("/midia/pix", authCliente, async (req, res) => {
  const client = await db.connect();
  try {
    const { conteudo_id, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint } = req.body;
    const userId = req.user.id;
    const ip = req.headers["x-forwarded-for"]?.split(",")[0] || req.socket.remoteAddress;

    if (!conteudo_id) return res.status(400).json({ error: "Conteúdo inválido." });
    if (!aceitou_termos) return res.status(400).json({ error: "É necessário aceitar os termos." });
    if (!aceitou_execucao_imediata) return res.status(400).json({ error: "É necessário declarar ciência sobre a execução imediata." });
    if (!aceite_timestamp || Number.isNaN(new Date(aceite_timestamp).getTime())) return res.status(400).json({ error: "Data de aceite inválida." });

    const clienteRes = await client.query(
      `SELECT c.id, c.nome, c.bloqueado, u.email FROM clientes c LEFT JOIN users u ON u.id=c.user_id WHERE c.user_id=$1 LIMIT 1`,
      [userId]
    );
    if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
    const { id: cliente_id, nome: nomeDB, bloqueado, email: emailDB } = clienteRes.rows[0];
    if (bloqueado) return res.status(403).json({ error: "Conta bloqueada." });

    const conteudo = await client.query(`SELECT preco, modelo_id FROM messages WHERE id=$1 AND cliente_id=$2`, [conteudo_id, cliente_id]);
    if (!conteudo.rowCount) return res.status(404).json({ error: "Conteúdo não encontrado" });
    const { preco, modelo_id } = conteudo.rows[0];
    const precoNum = Number(preco);
    const { valorTotal } = calcTaxaStripe(precoNum);
    const valorCentavos = Math.round(valorTotal * 100);

    const jaComprado = await client.query(
      `SELECT 1 FROM pagamentos_pix WHERE cliente_id=$1 AND message_id=$2 AND status='pago' LIMIT 1`,
      [cliente_id, conteudo_id]
    );
    if (jaComprado.rowCount > 0) return res.status(400).json({ error: "Conteúdo já adquirido." });

    await client.query("BEGIN");
    await client.query(`UPDATE pagamentos_pix SET status='expirado' WHERE status='pendente' AND expires_at < NOW()`);

    const pixExistente = await client.query(
      `SELECT pagarme_order_id, qr_code FROM pagamentos_pix WHERE cliente_id=$1 AND message_id=$2 AND gateway='abacatepay' AND status='pendente' AND expires_at>NOW() ORDER BY criado_em DESC LIMIT 1`,
      [cliente_id, conteudo_id]
    );
    if (pixExistente.rowCount > 0 && pixExistente.rows[0].qr_code) {
      await client.query("ROLLBACK");
      return res.json({ qr_code: pixExistente.rows[0].qr_code, qr_code_base64: null, payment_id: pixExistente.rows[0].pagarme_order_id, reutilizado: true });
    }

    const emailCliente = String(emailDB || "").trim();
    if (!emailCliente) { await client.query("ROLLBACK"); return res.status(400).json({ error: "E-mail do cliente não encontrado." }); }

    const abacateRes = await abacatePayRequest("POST", "/transparents/create", {
      method: "PIX",
      data: { amount: valorCentavos, description: "Mídia Premium Velvet", expiresIn: 3600, metadata: {}, externalId: `midia_${cliente_id}_${conteudo_id}` }
    });

    const abacateId = abacateRes?.data?.id;
    const brCode = abacateRes?.data?.brCode;
    const brCodeB64 = abacateRes?.data?.brCodeBase64;
    if (!abacateId || !brCode) throw new Error("Erro ao gerar PIX no AbacatePay");

    await client.query(
      `INSERT INTO pagamentos_pix (cliente_id, modelo_id, message_id, qr_code, valor, status, gateway, pagarme_order_id, criado_em, expires_at, aceite_ip, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint)
       VALUES ($1,$2,$3,$4,$5,'pendente','abacatepay',$6,NOW(),NOW()+INTERVAL '60 minutes',$7,$8,$9,$10,$11,$12)`,
      [cliente_id, modelo_id, conteudo_id, brCode, valorTotal, abacateId, ip||null, !!aceitou_termos, !!aceitou_execucao_imediata, aceite_timestamp, versao_termos||"2026-04-06", fingerprint||""]
    );

    await client.query("COMMIT");
    return res.json({ qr_code: brCode, qr_code_base64: brCodeB64||null, payment_id: abacateId });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Erro gerar PIX:", err);
    return res.status(500).json({ error: "Erro ao gerar pagamento PIX" });
  } finally {
    client.release();
  }
});

// ===========================
// POST /api/pagamento/premium/pix
// ===========================
router.post("/premium/pix", authCliente, async (req, res) => {
  const client = await db.connect();
  try {
    const { premium_post_id, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint, cpf, telefone } = req.body;
    const userId = Number(req.user?.id || 0);
    const cpfPremium = String(cpf || "").replace(/\D/g, "") || null;
    const telefonePremium = String(telefone || "").replace(/\D/g, "") || null;

    if (!aceitou_termos) return res.status(400).json({ error: "É necessário aceitar os termos." });
    if (!aceitou_execucao_imediata) return res.status(400).json({ error: "É necessário declarar ciência sobre a execução imediata." });
    if (!aceite_timestamp || Number.isNaN(new Date(aceite_timestamp).getTime())) return res.status(400).json({ error: "Data de aceite inválida." });
    if (!Number.isInteger(userId) || userId <= 0) return res.status(401).json({ error: "Usuário inválido." });
    const premiumPostIdNum = Number(premium_post_id);
    if (!Number.isInteger(premiumPostIdNum) || premiumPostIdNum <= 0) return res.status(400).json({ error: "premium_post_id inválido." });

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || null;
    await client.query("BEGIN");

    const clienteRes = await client.query(
      `SELECT c.id, c.nome, c.bloqueado, u.email FROM clientes c LEFT JOIN users u ON u.id=c.user_id WHERE c.user_id=$1 LIMIT 1`,
      [userId]
    );
    if (!clienteRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Cliente não encontrado" }); }
    const { id: cliente_id, nome, bloqueado, email } = clienteRes.rows[0];
    if (bloqueado) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Conta bloqueada." }); }
    const nomeFinal = String(nome || "").trim() || "Cliente Velvet";
    const emailFinal = String(email || "").trim();
    if (!emailFinal) { await client.query("ROLLBACK"); return res.status(400).json({ error: "E-mail do cliente não encontrado." }); }

    const premiumRes = await client.query(`SELECT id, preco, modelo_id FROM premium_posts WHERE id=$1 AND ativo=true LIMIT 1`, [premiumPostIdNum]);
    if (!premiumRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Post premium não encontrado." }); }
    const { id: postId, preco, modelo_id } = premiumRes.rows[0];

    const vipRes = await client.query(`SELECT 1 FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 AND ativo=true AND expiration_at>NOW() LIMIT 1`, [cliente_id, modelo_id]);
    if (!vipRes.rowCount) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Apenas clientes VIP podem comprar conteúdos premium." }); }

    const jaComprado = await client.query(`SELECT 1 FROM premium_unlocks WHERE premium_post_id=$1 AND cliente_id=$2 AND status='pago' LIMIT 1`, [postId, cliente_id]);
    if (jaComprado.rowCount > 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Conteúdo premium já adquirido." }); }

    const valorBase = Number(Number(preco).toFixed(2));
    const { valorTotal } = calcTaxaStripe(valorBase);
    const amount = Math.round(valorTotal * 100);

    const abacateRes = await abacatePayRequest("POST", "/transparents/create", {
      method: "PIX",
      data: {
        amount, description: "Premium Velvet", expiresIn: 3600,
        customer: cpfPremium && telefonePremium ? { name: nomeFinal, email: emailFinal, taxId: cpfPremium, cellphone: telefonePremium } : undefined,
        metadata: {}, externalId: `premium_${cliente_id}_${postId}`
      }
    });

    const abacateId = abacateRes?.data?.id;
    const brCode = abacateRes?.data?.brCode;
    const brCodeB64 = abacateRes?.data?.brCodeBase64;
    if (!abacateId || !brCode) { await client.query("ROLLBACK"); return res.status(500).json({ error: "Erro ao gerar QR PIX" }); }

    await client.query(
      `INSERT INTO premium_unlocks (premium_post_id, cliente_id, modelo_id, status, metodo_pagamento, valor_base, taxa_transacao, taxa_plataforma, valor_total, gateway, pagarme_order_id, aceite_ip, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint, created_at, updated_at)
       VALUES ($1,$2,$3,'pendente','pix',$4,$5,0,$6,'abacatepay',$7,$8,$9,$10,$11,$12,$13,NOW(),NOW())
       ON CONFLICT (premium_post_id, cliente_id) DO UPDATE SET
         status='pendente', metodo_pagamento='pix', valor_base=EXCLUDED.valor_base,
         valor_total=EXCLUDED.valor_total, gateway='abacatepay',
         pagarme_order_id=EXCLUDED.pagarme_order_id, updated_at=NOW()`,
      [postId, cliente_id, modelo_id, valorBase, Number((valorTotal-valorBase).toFixed(2)), valorTotal, abacateId, ip, !!aceitou_termos, !!aceitou_execucao_imediata, aceite_timestamp, versao_termos||"2026-04-06", fingerprint||""]
    );

    await client.query("COMMIT");
    return res.json({
      qr_code_url: brCodeB64 ? (brCodeB64.startsWith("data:") ? brCodeB64 : `data:image/png;base64,${brCodeB64}`) : null,
      copia_cola: brCode, order_id: abacateId
    });
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("ERRO PIX PREMIUM:", err.message);
    return res.status(500).json({ error: "Erro ao gerar pagamento" });
  } finally {
    client.release();
  }
});

// ===========================
// POST /api/pagamento/vip/cartao
// ===========================
router.post("/vip/cartao", authCliente, async (req, res) => {
  const client = await db.connect();
  let cliente_id = null;
  try {
    await client.query("BEGIN");
    const { modelo_id, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint, paymentMethodId, cpf, telefone, nome_cartao } = req.body || {};
    const cpfVip = String(cpf || "").replace(/\D/g, "") || null;
    const telefoneVip = String(telefone || "").replace(/\D/g, "") || null;
    const nomeCartaoVip = String(nome_cartao || "").trim() || null;
    const userId = Number(req.user?.id || 0);

    if (!Number.isInteger(userId) || userId <= 0) { await client.query("ROLLBACK"); return res.status(401).json({ error: "Usuário inválido." }); }
    const modeloIdNum = Number(modelo_id);
    if (!Number.isInteger(modeloIdNum) || modeloIdNum <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "modelo_id inválido" }); }
    if (!fingerprint) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Fingerprint obrigatório." }); }
    if (!aceitou_termos) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Você precisa aceitar os termos." }); }
    if (!aceitou_execucao_imediata) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Você precisa declarar ciência sobre a execução imediata." }); }
    if (!aceite_timestamp || Number.isNaN(new Date(aceite_timestamp).getTime())) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Data de aceite inválida." }); }
    if (!paymentMethodId) { await client.query("ROLLBACK"); return res.status(400).json({ error: "paymentMethodId obrigatório." }); }

    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || null;

    const ipBloqueado = await client.query(`SELECT 1 FROM ips_bloqueados WHERE ip=$1 LIMIT 1`, [ip]);
    if (ipBloqueado.rowCount > 0) { await client.query("ROLLBACK"); return res.status(403).json({ error: "IP bloqueado." }); }

    const clienteRes = await client.query(
      `SELECT c.id, c.nome, c.bloqueado, u.email FROM clientes c JOIN users u ON u.id=c.user_id WHERE c.user_id=$1 LIMIT 1`, [userId]
    );
    if (!clienteRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Cliente não encontrado" }); }
    cliente_id = Number(clienteRes.rows[0].id);
    const nomeCliente = String(clienteRes.rows[0].nome || "").trim() || "Cliente Velvet";
    const emailCliente = String(clienteRes.rows[0].email || "").trim().toLowerCase();
    if (clienteRes.rows[0].bloqueado) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Conta bloqueada." }); }
    if (!emailCliente || !emailCliente.includes("@")) { await client.query("ROLLBACK"); return res.status(400).json({ error: "E-mail do cliente inválido." }); }

    const donaRes = await client.query(`SELECT id FROM modelos WHERE user_id=$1 AND id=$2 LIMIT 1`, [userId, modeloIdNum]);
    if (donaRes.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Não é possível assinar o próprio perfil." }); }

    const modeloRes = await client.query(`SELECT id FROM modelos WHERE id=$1 LIMIT 1`, [modeloIdNum]);
    if (!modeloRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Modelo não encontrada." }); }

    await client.query(`UPDATE clientes SET ultimo_ip=$1 WHERE id=$2`, [ip, cliente_id]);

    const planoRes = await client.query(`SELECT valor_mensal FROM modelos_planos WHERE modelo_id=$1 LIMIT 1`, [modeloIdNum]);
    if (!planoRes.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Plano VIP não definido" }); }
    let valorBasePlano = Number(planoRes.rows[0].valor_mensal) || 0;

    const ofertaRes = await client.query(
      `SELECT id, desconto_percentual, valor_promocional FROM ofertas WHERE modelo_id=$1 AND ativa=true AND (data_inicio IS NULL OR data_inicio<=NOW()) AND (data_fim IS NULL OR data_fim>=NOW()) ORDER BY created_at DESC LIMIT 1`,
      [modeloIdNum]
    );
    let valorAssinatura = valorBasePlano;
    let oferta_id = null;
    if (ofertaRes.rowCount) {
      oferta_id = ofertaRes.rows[0].id;
      if (ofertaRes.rows[0].valor_promocional) valorAssinatura = Number(ofertaRes.rows[0].valor_promocional);
      else if (ofertaRes.rows[0].desconto_percentual) {
        const desconto = Number(ofertaRes.rows[0].desconto_percentual);
        valorAssinatura = valorBasePlano - (valorBasePlano * desconto / 100);
      }
    }
    valorAssinatura = Number(valorAssinatura.toFixed(2));
    if (!valorAssinatura || valorAssinatura <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Valor inválido" }); }

    const { taxaTransacao, taxaPlataforma, valorTotal } = calcTaxaStripe(valorAssinatura);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(valorTotal * 100), currency: "brl",
      payment_method: paymentMethodId, confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "Assinatura VIP Velvet", receipt_email: emailCliente,
      metadata: { tipo: "vip", cliente_id: String(cliente_id), modelo_id: String(modeloIdNum), valor_assinatura: String(valorAssinatura), taxa_transacao: String(taxaTransacao), taxa_plataforma: String(taxaPlataforma), oferta_id: oferta_id ? String(oferta_id) : "" }
    });

    const paymentIntentId = paymentIntent.id;
    const statusLocal = paymentIntent.status === "succeeded" ? "pago" : "pendente";

    await client.query(
      `INSERT INTO pagamentos_cartao (cliente_id, modelo_id, gateway, gateway_payment_id, stripe_payment_intent_id, valor, tipo, currency, status, aceite_ip, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint, valor_brl, taxa_cambio, cpf, telefone, nome_cartao, created_at, updated_at)
       VALUES ($1,$2,'stripe',$3,$4,$5,$6,'brl',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW())`,
      [cliente_id, modeloIdNum, paymentIntentId, paymentIntentId, valorTotal, "vip", statusLocal, ip, !!aceitou_termos, !!aceitou_execucao_imediata, aceite_timestamp, versao_termos||"2026-04-06", fingerprint||null, valorAssinatura, null, cpfVip||null, telefoneVip||null, nomeCartaoVip||null]
    );

    if (statusLocal === "pago") {
      const calcularValores = req.app.get("calcularValores") || (async ({ valor_bruto }) => ({ valor_modelo: valor_bruto * 0.7, agency_fee: valor_bruto * 0.1, velvet_fee: valor_bruto * 0.05 }));
      const taxaGateway = Number((valorAssinatura * 0.15).toFixed(2));
      const valores = await calcularValores({ modelo_id: modeloIdNum, valor_bruto: valorAssinatura, taxa_gateway: taxaGateway });

      const vipExistente = await client.query(`SELECT id, ativo, expiration_at FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 LIMIT 1 FOR UPDATE`, [cliente_id, modeloIdNum]);
      const primeiraAssinatura = vipExistente.rowCount === 0;

      let novaExpiracao = new Date();
      if (vipExistente.rowCount > 0 && vipExistente.rows[0].expiration_at && new Date(vipExistente.rows[0].expiration_at) > new Date()) {
        novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
      }
      novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);

      if (vipExistente.rowCount > 0) {
        await client.query(
          `UPDATE vip_subscriptions SET ativo=true, updated_at=NOW(), expiration_at=$3, valor_assinatura=$4, taxa_transacao=$5, taxa_plataforma=0, valor_total=$6, recorrente=false, gateway_subscription_id=$7, aviso_7_dias_enviado=false, aviso_24h_enviado=false WHERE cliente_id=$1 AND modelo_id=$2`,
          [cliente_id, modeloIdNum, novaExpiracao, valorAssinatura, taxaGateway, valorTotal, paymentIntentId]
        );
      } else {
        await client.query(
          `INSERT INTO vip_subscriptions (cliente_id, modelo_id, ativo, created_at, updated_at, expiration_at, valor_assinatura, taxa_transacao, taxa_plataforma, valor_total, recorrente, gateway_subscription_id) VALUES ($1,$2,true,NOW(),NOW(),$3,$4,$5,0,$6,false,$7)`,
          [cliente_id, modeloIdNum, novaExpiracao, valorAssinatura, taxaGateway, valorTotal, paymentIntentId]
        );
      }

      await client.query(
        `INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'assinatura',$3,$4,$5,$6,$7,'pago',NOW())`,
        [modeloIdNum, cliente_id, valorAssinatura, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]
      );

      if (primeiraAssinatura) {
        await client.query(`INSERT INTO messages (cliente_id, modelo_id, text, sender, tipo, created_at, lida, visto, deletada) VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)`, [cliente_id, modeloIdNum, "Oii!! Bem vindo(a), qual seu nome?🥰"]);
      }
    }

    await client.query("COMMIT");

    if (statusLocal === "pago") {
      try {
        const io = req.app.get("io");
        if (io) io.to(`chat_${cliente_id}_${modeloIdNum}`).emit("vipAtivado", { cliente_id: Number(cliente_id), modelo_id: Number(modeloIdNum) });
      } catch (e) {}
    }

    const resposta = { ok: true, payment_id: paymentIntentId, status: statusLocal, modelo_id: modeloIdNum, currency: "brl", taxa_cambio: null, valor_assinatura: valorAssinatura, taxa_transacao: taxaTransacao, taxa_plataforma: taxaPlataforma, valor_total: valorTotal, oferta_id: oferta_id || null };
    if (paymentIntent.status === "requires_action") { resposta.requires_action = true; resposta.client_secret = paymentIntent.client_secret; }
    return res.json(resposta);
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    console.error("Erro VIP Stripe:", err);
    return res.status(500).json({ error: err.message || "Erro ao criar pagamento com cartão", stripe_code: err.code||null, stripe_type: err.type||null });
  } finally {
    client.release();
  }
});

// ===========================
// POST /api/pagamento/midia/cartao
// ===========================
router.post("/midia/cartao", auth, async (req, res) => {
  let client = null;
  let cliente_id = null;
  try {
    client = await db.connect();
    const { conteudo_id, fingerprint, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, paymentMethodId } = req.body || {};
    const userId = Number(req.user?.id || 0);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!conteudo_id || !Number.isInteger(Number(conteudo_id))) return res.status(400).json({ error: "conteudo_id inválido" });
    const conteudoId = Number(conteudo_id);
    if (!fingerprint) return res.status(400).json({ error: "Fingerprint obrigatório." });
    if (!aceitou_termos) return res.status(400).json({ error: "Você precisa aceitar os termos." });
    if (!aceitou_execucao_imediata) return res.status(400).json({ error: "Você precisa declarar ciência sobre a execução imediata." });
    if (!aceite_timestamp || Number.isNaN(new Date(aceite_timestamp).getTime())) return res.status(400).json({ error: "Data de aceite inválida." });
    if (!paymentMethodId) return res.status(400).json({ error: "paymentMethodId obrigatório." });
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;

    await client.query("BEGIN");

    const clienteRes = await client.query(`SELECT c.id, c.bloqueado, COALESCE(NULLIF(TRIM(c.nome),''),split_part(u.email,'@',1)) AS nome, u.email FROM clientes c JOIN users u ON u.id=c.user_id WHERE c.user_id=$1 LIMIT 1`, [userId]);
    if (!clienteRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Cliente não encontrado" }); }
    cliente_id = Number(clienteRes.rows[0].id);
    const { bloqueado, email, nome } = clienteRes.rows[0];
    if (bloqueado) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Conta bloqueada." }); }
    const nomeCompleto = String(nome || "").trim();
    if (!nomeCompleto || nomeCompleto.length < 3) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Nome do cliente inválido." }); }
    if (!email || !String(email).includes("@")) { await client.query("ROLLBACK"); return res.status(400).json({ error: "E-mail do cliente inválido." }); }

    const messageRes = await client.query(`SELECT preco, modelo_id FROM messages WHERE id=$1 AND cliente_id=$2 LIMIT 1`, [conteudoId, cliente_id]);
    if (!messageRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Conteúdo não encontrado" }); }
    const { preco, modelo_id } = messageRes.rows[0];
    if (!preco || Number(preco) <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Conteúdo não está à venda." }); }

    const jaComprado = await client.query(`SELECT 1 FROM conteudo_pacotes WHERE message_id=$1 AND cliente_id=$2 AND status='pago' LIMIT 1`, [conteudoId, cliente_id]);
    if (jaComprado.rowCount > 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Conteúdo já adquirido." }); }

    const valorBase = Number(Number(preco).toFixed(2));
    const { taxaTransacao, taxaPlataforma, valorTotal } = calcTaxaStripe(valorBase);
    if (!valorTotal || valorTotal <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Valor do pagamento inválido." }); }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(valorTotal * 100), currency: "brl",
      payment_method: paymentMethodId, confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: "Mídia Premium Velvet", receipt_email: String(email).trim().toLowerCase(),
      metadata: { tipo: "conteudo", cliente_id: String(cliente_id), modelo_id: String(modelo_id), message_id: String(conteudoId), taxa_transacao: String(taxaTransacao), taxa_plataforma: String(taxaPlataforma) }
    });

    const paymentIntentId = paymentIntent.id;
    const statusLocal = paymentIntent.status === "succeeded" ? "pago" : "pendente";

    await client.query(
      `INSERT INTO pagamentos_cartao (cliente_id, modelo_id, conteudo_id, gateway, gateway_payment_id, stripe_payment_intent_id, valor, tipo, currency, status, aceite_ip, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint, valor_brl, taxa_cambio, created_at, updated_at) VALUES ($1,$2,$3,'stripe',$4,$5,$6,$7,'brl',$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())`,
      [cliente_id, modelo_id, conteudoId, paymentIntentId, paymentIntentId, valorTotal, "midia", statusLocal, ip, !!aceitou_termos, !!aceitou_execucao_imediata, aceite_timestamp, versao_termos||"2026-04-06", fingerprint||null, valorBase, null]
    );

    let conteudo_ids_liberados = null;
    if (statusLocal === "pago") {
      const calcularValores = req.app.get("calcularValores") || (async ({ valor_bruto }) => ({ valor_modelo: valor_bruto * 0.7, agency_fee: valor_bruto * 0.1, velvet_fee: valor_bruto * 0.05 }));
      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valores = await calcularValores({ modelo_id, valor_bruto: valorBase, taxa_gateway: taxaGateway });

      await client.query(
        `INSERT INTO conteudo_pacotes (message_id, cliente_id, modelo_id, preco, valor_base, valor_total, status, metodo_pagamento, pago_em, currency, valor_cobrado, taxa_cambio) VALUES ($1,$2,$3,$4,$4,$5,'pago','cartao',NOW(),'brl',$5,NULL) ON CONFLICT (message_id, cliente_id) DO UPDATE SET status='pago', metodo_pagamento='cartao', pago_em=NOW(), valor_total=$5`,
        [conteudoId, cliente_id, modelo_id, valorBase, valorTotal]
      );
      conteudo_ids_liberados = await marcarConteudoComoLiberadoPorPagamento(client, { message_id: conteudoId, cliente_id, modelo_id });
      await client.query(
        `INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
        [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]
      );
    }

    await client.query("COMMIT");

    if (statusLocal === "pago" && conteudo_ids_liberados) {
      try {
        const io = req.app.get("io");
        if (io) io.to(`chat_${cliente_id}_${modelo_id}`).emit("conteudoLiberado", { message_id: Number(conteudoId), conteudo_ids: conteudo_ids_liberados || [] });
      } catch (e) {}
    }

    const resposta = { ok: true, payment_id: paymentIntentId, status: statusLocal, currency: "brl", taxa_cambio: null, total: valorTotal, valorBase, taxaTransacao, taxaPlataforma };
    if (paymentIntent.status === "requires_action") { resposta.requires_action = true; resposta.client_secret = paymentIntent.client_secret; }
    return res.json(resposta);
  } catch (err) {
    try { if (client) await client.query("ROLLBACK"); } catch (_) {}
    console.error("ERRO /api/pagamento/midia/cartao:", err.message);
    return res.status(500).json({ error: "Erro interno ao processar pagamento", stripe_code: err.code||null, stripe_type: err.type||null });
  } finally {
    if (client) { try { client.release(); } catch (_) {} }
  }
});

// ===========================
// POST /api/pagamento/premium/cartao
// ===========================
router.post("/premium/cartao", authCliente, async (req, res) => {
  let client = null;
  let cliente_id = null;
  try {
    client = await db.connect();
    const { premium_post_id, fingerprint, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, paymentMethodId, cpf, telefone, nome_cartao } = req.body || {};
    const cpfPremiumCartao = String(cpf || "").replace(/\D/g, "") || null;
    const telefonePremiumCartao = String(telefone || "").replace(/\D/g, "") || null;
    const nomeCartaoPremium = String(nome_cartao || "").trim() || null;
    const userId = Number(req.user?.id || 0);

    if (!Number.isInteger(userId) || userId <= 0) return res.status(401).json({ error: "Usuário não autenticado" });
    if (!aceitou_termos) return res.status(400).json({ error: "É necessário aceitar os termos." });
    if (!aceitou_execucao_imediata) return res.status(400).json({ error: "É necessário declarar ciência sobre a execução imediata." });
    if (!aceite_timestamp || Number.isNaN(new Date(aceite_timestamp).getTime())) return res.status(400).json({ error: "Data de aceite inválida." });
    if (!premium_post_id || !Number.isInteger(Number(premium_post_id))) return res.status(400).json({ error: "premium_post_id inválido" });
    if (!fingerprint) return res.status(400).json({ error: "Fingerprint obrigatório." });
    if (!paymentMethodId) return res.status(400).json({ error: "paymentMethodId obrigatório." });
    const premiumPostId = Number(premium_post_id);
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;

    await client.query("BEGIN");

    const clienteRes = await client.query(`SELECT c.id, c.bloqueado, COALESCE(NULLIF(TRIM(c.nome),''),split_part(u.email,'@',1)) AS nome, u.email FROM clientes c JOIN users u ON u.id=c.user_id WHERE c.user_id=$1 LIMIT 1`, [userId]);
    if (!clienteRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Cliente não encontrado" }); }
    cliente_id = Number(clienteRes.rows[0].id);
    const { bloqueado, email, nome } = clienteRes.rows[0];
    if (bloqueado) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Conta bloqueada." }); }
    const nomeCompleto = String(nome || "").trim();
    if (!nomeCompleto || nomeCompleto.length < 3) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Nome do cliente inválido." }); }
    if (!email || !String(email).includes("@")) { await client.query("ROLLBACK"); return res.status(400).json({ error: "E-mail do cliente inválido." }); }

    const premiumRes = await client.query(`SELECT id, preco, modelo_id, descricao, ativo FROM premium_posts WHERE id=$1 LIMIT 1`, [premiumPostId]);
    if (!premiumRes.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ error: "Conteúdo premium não encontrado" }); }
    const { id: premium_id, preco, modelo_id, descricao, ativo } = premiumRes.rows[0];

    const donaRes = await client.query(`SELECT id FROM modelos WHERE user_id=$1 AND id=$2 LIMIT 1`, [userId, modelo_id]);
    if (donaRes.rowCount) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Não é possível comprar o próprio conteúdo premium." }); }

    const vipRes = await client.query(`SELECT 1 FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 AND ativo=true AND expiration_at>NOW() LIMIT 1`, [cliente_id, modelo_id]);
    if (!vipRes.rowCount) { await client.query("ROLLBACK"); return res.status(403).json({ error: "Apenas clientes VIP podem comprar conteúdos premium." }); }
    if (!ativo) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Conteúdo premium indisponível." }); }
    if (!preco || Number(preco) <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Conteúdo premium não está à venda." }); }

    const jaComprado = await client.query(`SELECT 1 FROM premium_unlocks WHERE premium_post_id=$1 AND cliente_id=$2 AND status='pago' LIMIT 1`, [premium_id, cliente_id]);
    if (jaComprado.rowCount > 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Conteúdo premium já adquirido." }); }

    const valorBase = Number(Number(preco).toFixed(2));
    const { taxaTransacao, taxaPlataforma, valorTotal } = calcTaxaStripe(valorBase);
    if (!valorTotal || valorTotal <= 0) { await client.query("ROLLBACK"); return res.status(400).json({ error: "Valor do pagamento inválido." }); }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(valorTotal * 100), currency: "brl",
      payment_method: paymentMethodId, confirm: true,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: descricao || `Premium Velvet #${premium_id}`,
      receipt_email: String(email).trim().toLowerCase(),
      metadata: { tipo: "premium", cliente_id: String(cliente_id), modelo_id: String(modelo_id), premium_post_id: String(premium_id), taxa_transacao: String(taxaTransacao), taxa_plataforma: String(taxaPlataforma) }
    });

    const paymentIntentId = paymentIntent.id;
    const statusLocal = paymentIntent.status === "succeeded" ? "pago" : "pendente";

    await client.query(
      `INSERT INTO premium_unlocks (premium_post_id, cliente_id, modelo_id, status, metodo_pagamento, valor_base, taxa_transacao, taxa_plataforma, valor_total, gateway, stripe_payment_intent_id, pagarme_order_id, pacote_ref, aceite_ip, aceitou_termos, aceitou_execucao_imediata, aceite_timestamp, versao_termos, fingerprint, valor_cobrado, taxa_cambio, created_at, updated_at) VALUES ($1,$2,$3,$4,'cartao',$5,$6,$7,$8,'stripe',$9,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW(),NOW()) ON CONFLICT (premium_post_id, cliente_id) DO UPDATE SET modelo_id=EXCLUDED.modelo_id, status=EXCLUDED.status, metodo_pagamento='cartao', valor_base=EXCLUDED.valor_base, taxa_transacao=EXCLUDED.taxa_transacao, taxa_plataforma=EXCLUDED.taxa_plataforma, valor_total=EXCLUDED.valor_total, gateway=EXCLUDED.gateway, stripe_payment_intent_id=EXCLUDED.stripe_payment_intent_id, pagarme_order_id=EXCLUDED.pagarme_order_id, aceite_ip=EXCLUDED.aceite_ip, aceitou_termos=EXCLUDED.aceitou_termos, aceite_timestamp=EXCLUDED.aceite_timestamp, updated_at=NOW()`,
      [premium_id, cliente_id, modelo_id, statusLocal, valorBase, taxaTransacao, taxaPlataforma, valorTotal, paymentIntentId, paymentIntentId, ip, !!aceitou_termos, !!aceitou_execucao_imediata, aceite_timestamp, versao_termos||"2026-04-06", fingerprint||null, valorTotal, null]
    );

    if (statusLocal === "pago") {
      const calcularValores = req.app.get("calcularValores") || (async ({ valor_bruto }) => ({ valor_modelo: valor_bruto * 0.7, agency_fee: valor_bruto * 0.1, velvet_fee: valor_bruto * 0.05 }));
      const taxaGateway = Number((valorBase * 0.15).toFixed(2));
      const valores = await calcularValores({ modelo_id, valor_bruto: valorBase, taxa_gateway: taxaGateway });
      await client.query(
        `INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`,
        [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]
      );
    }

    await client.query("COMMIT");

    if (statusLocal === "pago") {
      try {
        const io = req.app.get("io");
        if (io) io.to(`user_${cliente_id}`).emit("pagamento_confirmado", { tipo: "premium", premium_post_id: premium_id, modelo_id, payment_id: paymentIntentId });
      } catch (e) {}
    }

    const resposta = { ok: true, payment_id: paymentIntentId, status: statusLocal, currency: "brl", total: valorTotal, valorBase, taxaTransacao, taxaPlataforma };
    if (paymentIntent.status === "requires_action") { resposta.requires_action = true; resposta.client_secret = paymentIntent.client_secret; }
    return res.json(resposta);
  } catch (err) {
    try { if (client) await client.query("ROLLBACK"); } catch (_) {}
    console.error("ERRO /api/pagamento/premium/cartao:", err.message);
    return res.status(500).json({ error: "Erro interno ao processar pagamento", stripe_code: err.code||null, stripe_type: err.type||null });
  } finally {
    if (client) { try { client.release(); } catch (_) {} }
  }
});

// ===========================
// POST /api/vip/cancelar
// ===========================
router.post("/vip/cancelar", auth, async (req, res) => {
  try {
    const { modelo_id } = req.body;
    const userId = req.user.id;
    if (!modelo_id || isNaN(Number(modelo_id))) return res.status(400).json({ error: "modelo_id inválido" });

    const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [userId]);
    if (clienteRes.rowCount === 0) return res.status(404).json({ error: "Cliente não encontrado" });
    const cliente_id = clienteRes.rows[0].id;

    const vip = await db.query(
      `SELECT stripe_subscription_id FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 AND recorrente=true LIMIT 1`,
      [cliente_id, modelo_id]
    );
    if (vip.rowCount === 0) return res.status(404).json({ error: "Assinatura não encontrada" });

    const subscriptionId = vip.rows[0].stripe_subscription_id;
    await stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
    await db.query(`UPDATE vip_subscriptions SET recorrente=false WHERE cliente_id=$1 AND modelo_id=$2`, [cliente_id, modelo_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro cancelar VIP:", err);
    res.status(500).json({ error: "Erro ao cancelar assinatura" });
  }
});

module.exports = router;
