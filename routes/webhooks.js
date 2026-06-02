const express = require("express");
const db = require("../db");
const { enviarEmailNotificacaoContratoAssinado } = require("../email");
const { marcarConteudoComoLiberadoPorPagamento } = require("../utils/helpers");
const { descarregarPDFAssinadoZapSign } = require("../utils/contrato");

// Os webhooks devem ser registados ANTES do express.json() global
// Portanto exportamos uma função que recebe `app` e regista as rotas directamente
function registerWebhooks(app) {

  // ===========================
  // WEBHOOK ZAPSIGN
  // ===========================
  app.post("/api/webhook/zapsign", express.json(), async (req, res) => {
    try {
      const event = req.body;
      const eventType = event?.event_type || event?.type || "";
      const docToken = event?.document?.token || event?.doc?.token || event?.token || null;
      const signerStatus = event?.signer?.status || event?.document?.status || "";

      const foiAssinado =
        eventType === "sign_doc" || eventType === "signer_signed" ||
        signerStatus === "signed" || event?.document?.status === "signed";

      if (!foiAssinado || !docToken) return res.status(200).json({ ok: true, ignorado: true });

      const upd = await db.query(
        `UPDATE modelos SET contrato_assinado=true, contrato_assinado_em=NOW() WHERE contrato_token=$1 RETURNING id`,
        [docToken]
      );
      if (upd.rowCount === 0) return res.status(200).json({ ok: true });

      const modeloId = upd.rows[0].id;

      descarregarPDFAssinadoZapSign(docToken, modeloId)
        .then(async (pdfR2Key) => {
          try {
            const mInfo = await db.query(
              `SELECT m.nome_completo, m.nome_exibicao, u.email, m.contrato_assinado_em FROM modelos m JOIN users u ON u.id=m.user_id WHERE m.id=$1`,
              [modeloId]
            );
            const info = mInfo.rows[0] || {};
            await enviarEmailNotificacaoContratoAssinado({ nomeCompleto: info.nome_completo, nomeExibicao: info.nome_exibicao, emailModelo: info.email, modeloId, assinadoEm: info.contrato_assinado_em, pdfR2Key });
          } catch (emailErr) {
            console.warn("[ZapSign Webhook] Falha ao enviar email:", emailErr.message);
          }
        })
        .catch(err => console.warn("[ZapSign Webhook] Falha ao descarregar PDF:", err.message));

      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("[ZapSign Webhook] Erro:", err);
      res.status(500).json({ erro: "Erro interno" });
    }
  });

  // ===========================
  // WEBHOOK ASAAS
  // ===========================
  app.post("/api/webhook/asaas", express.json(), async (req, res) => {
    if (process.env.ASAAS_WEBHOOK_TOKEN) {
      const tokenRecebido = req.headers["access_token"] || req.headers["asaas-access-token"] || "";
      if (tokenRecebido !== process.env.ASAAS_WEBHOOK_TOKEN) {
        console.warn("Webhook Asaas: token inválido");
        return res.status(401).send("unauthorized");
      }
    }

    const event = req.body;
    const eventType = String(event?.event || "").toUpperCase();
    const payment = event?.payment || {};
    const asaasPaymentId = payment?.id || null;
    const valorPago = Number(payment.value || 0);

    if (!asaasPaymentId) return res.status(200).send("ok");

    const isPaidEvent = ["PAYMENT_RECEIVED","PAYMENT_CONFIRMED"].includes(eventType);
    const isFailedEvent = ["PAYMENT_OVERDUE","PAYMENT_DELETED","PAYMENT_REFUNDED","PAYMENT_CHARGEBACK_REQUESTED","PAYMENT_CHARGEBACK_DISPUTE"].includes(eventType);

    if (!isPaidEvent && !isFailedEvent) return res.status(200).send("ok");

    const novoStatus = isPaidEvent ? "pago" : "falhou";
    const calcularValores = req.app.get("calcularValores") || (async ({ valor_bruto }) => ({ valor_modelo: valor_bruto * 0.7, agency_fee: valor_bruto * 0.1, velvet_fee: valor_bruto * 0.05 }));

    const client = await db.connect();
    let dadosParaEmitir = null;

    try {
      await client.query("BEGIN");

      // PREMIUM
      const premiumRes = await client.query(`SELECT * FROM premium_unlocks WHERE pagarme_order_id=$1::text OR stripe_payment_intent_id=$1::text LIMIT 1 FOR UPDATE`, [asaasPaymentId]);
      if (premiumRes.rowCount > 0) {
        const row = premiumRes.rows[0];
        if (row.status === "pago") { await client.query("ROLLBACK"); return res.status(200).send("ok"); }
        await client.query(`UPDATE premium_unlocks SET status=$1::text, pago_em=CASE WHEN $1::text='pago' THEN NOW() ELSE pago_em END, updated_at=NOW() WHERE id=$2`, [novoStatus, row.id]);
        if (isPaidEvent) {
          const cliente_id = Number(row.cliente_id);
          const modelo_id = Number(row.modelo_id);
          const premium_post_id = Number(row.premium_post_id);
          const valorBase = Number(row.valor_base || valorPago);
          const taxaGateway = Number((1.99 + valorBase * 0.10).toFixed(2));
          const valores = await calcularValores({ modelo_id, valor_bruto: valorBase, taxa_gateway: taxaGateway });
          await client.query(`INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`, [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]);
          dadosParaEmitir = { tipo: "premium", cliente_id, modelo_id, premium_post_id, payment_id: asaasPaymentId };
        }
        await client.query("COMMIT");
        if (dadosParaEmitir) {
          try { const io = req.app.get("io"); if (io) io.to(`user_${dadosParaEmitir.cliente_id}`).emit("pagamento_confirmado", { tipo: "premium", premium_post_id: dadosParaEmitir.premium_post_id, modelo_id: dadosParaEmitir.modelo_id, payment_id: dadosParaEmitir.payment_id }); } catch (e) {}
        }
        return res.status(200).send("ok");
      }

      // PIX
      const pixRes = await client.query(`SELECT * FROM pagamentos_pix WHERE pagarme_order_id=$1 LIMIT 1 FOR UPDATE`, [asaasPaymentId]);
      if (pixRes.rowCount > 0) {
        const row = pixRes.rows[0];
        if (row.status === "pago") { await client.query("ROLLBACK"); return res.status(200).send("ok"); }
        await client.query(`UPDATE pagamentos_pix SET status=$1 WHERE pagarme_order_id=$2`, [novoStatus, asaasPaymentId]);
        if (isPaidEvent) {
          const cliente_id = Number(row.cliente_id);
          const modelo_id = Number(row.modelo_id);
          const message_id = row.message_id ? Number(row.message_id) : null;
          const isVip = !message_id;
          const valorBrutoTotal = Number(row.valor || valorPago);
          const valorBase = Number(((valorBrutoTotal - 1.99) / 1.10).toFixed(2));
          const taxaGateway = Number((valorBrutoTotal - valorBase).toFixed(2));
          const valores = await calcularValores({ modelo_id, valor_bruto: valorBase, taxa_gateway: taxaGateway });

          if (isVip) {
            const vipExistente = await client.query(`SELECT id, ativo, expiration_at FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 LIMIT 1 FOR UPDATE`, [cliente_id, modelo_id]);
            const primeiraAssinatura = vipExistente.rowCount === 0;
            let novaExpiracao = new Date();
            if (vipExistente.rowCount > 0 && vipExistente.rows[0].expiration_at && new Date(vipExistente.rows[0].expiration_at) > new Date()) {
              novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
            }
            novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);

            if (vipExistente.rowCount > 0) {
              await client.query(`UPDATE vip_subscriptions SET ativo=true, updated_at=NOW(), expiration_at=$3, valor_assinatura=$4, taxa_transacao=$5, taxa_plataforma=0, valor_total=$6, recorrente=false, gateway_subscription_id=$7, aviso_7_dias_enviado=false, aviso_24h_enviado=false WHERE cliente_id=$1 AND modelo_id=$2`, [cliente_id, modelo_id, novaExpiracao, valorBase, taxaGateway, valorPago, asaasPaymentId]);
            } else {
              await client.query(`INSERT INTO vip_subscriptions (cliente_id, modelo_id, ativo, created_at, updated_at, expiration_at, valor_assinatura, taxa_transacao, taxa_plataforma, valor_total, recorrente, gateway_subscription_id) VALUES ($1,$2,true,NOW(),NOW(),$3,$4,$5,0,$6,false,$7)`, [cliente_id, modelo_id, novaExpiracao, valorBase, taxaGateway, valorPago, asaasPaymentId]);
            }
            await client.query(`INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'assinatura',$3,$4,$5,$6,$7,'pago',NOW())`, [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]);
            if (primeiraAssinatura) {
              await client.query(`INSERT INTO messages (cliente_id, modelo_id, text, sender, tipo, created_at, lida, visto, deletada) VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)`, [cliente_id, modelo_id, "Oii!! Bem vindo(a), qual seu nome?🥰"]);
            }
            dadosParaEmitir = { tipo: "vip", cliente_id, modelo_id };
          } else {
            await client.query(`INSERT INTO conteudo_pacotes (message_id, cliente_id, modelo_id, preco, valor_base, valor_total, status, metodo_pagamento, pago_em, currency, valor_cobrado, taxa_cambio) VALUES ($1,$2,$3,$4,$4,$5,'pago','pix',NOW(),'brl',$5,NULL) ON CONFLICT (message_id, cliente_id) DO UPDATE SET status='pago', metodo_pagamento='pix', pago_em=NOW(), valor_total=$5`, [message_id, cliente_id, modelo_id, valorBase, valorPago]);
            const conteudo_ids = await marcarConteudoComoLiberadoPorPagamento(client, { message_id, cliente_id, modelo_id });
            await client.query(`INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`, [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]);
            dadosParaEmitir = { tipo: "conteudo", cliente_id, modelo_id, message_id, conteudo_ids };
          }
        }
        await client.query("COMMIT");
        if (dadosParaEmitir) {
          try {
            const io = req.app.get("io");
            if (io) {
              if (dadosParaEmitir.tipo === "conteudo") io.to(`chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`).emit("conteudoLiberado", { message_id: Number(dadosParaEmitir.message_id), conteudo_ids: dadosParaEmitir.conteudo_ids || [] });
              if (dadosParaEmitir.tipo === "vip") io.to(`chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`).emit("vipAtivado", { cliente_id: Number(dadosParaEmitir.cliente_id), modelo_id: Number(dadosParaEmitir.modelo_id) });
            }
          } catch (e) {}
        }
        return res.status(200).send("ok");
      }

      // CARTÃO
      const cartaoRes = await client.query(`SELECT * FROM pagamentos_cartao WHERE gateway_payment_id=$1 OR stripe_payment_intent_id=$1 LIMIT 1 FOR UPDATE`, [asaasPaymentId]);
      if (cartaoRes.rowCount === 0) { await client.query("ROLLBACK"); return res.status(200).send("ok"); }
      const row = cartaoRes.rows[0];
      if (row.status === "pago") { await client.query("ROLLBACK"); return res.status(200).send("ok"); }
      const tipoPag = String(row.tipo || "").toLowerCase();
      const cliente_id = Number(row.cliente_id);
      const modelo_id = Number(row.modelo_id);
      await client.query(`UPDATE pagamentos_cartao SET status=$1::text, pago_em=CASE WHEN $1::text='pago' THEN NOW() ELSE pago_em END, updated_at=NOW() WHERE gateway_payment_id=$2`, [novoStatus, asaasPaymentId]);

      if (isPaidEvent) {
        const valorBase = Number(row.valor_brl || row.valor || valorPago);
        const taxaGateway = Number((1.99 + valorBase * 0.10).toFixed(2));
        const valores = await calcularValores({ modelo_id, valor_bruto: valorBase, taxa_gateway: taxaGateway });

        if (tipoPag === "vip") {
          const vipExistente = await client.query(`SELECT id, ativo, expiration_at FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 LIMIT 1 FOR UPDATE`, [cliente_id, modelo_id]);
          const primeiraAssinatura = vipExistente.rowCount === 0;
          let novaExpiracao = new Date();
          if (vipExistente.rowCount > 0 && vipExistente.rows[0].expiration_at && new Date(vipExistente.rows[0].expiration_at) > new Date()) {
            novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
          }
          novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
          if (vipExistente.rowCount > 0) {
            await client.query(`UPDATE vip_subscriptions SET ativo=true, updated_at=NOW(), expiration_at=$3, valor_assinatura=$4, taxa_transacao=$5, taxa_plataforma=0, valor_total=$6, recorrente=false, gateway_subscription_id=$7, aviso_7_dias_enviado=false, aviso_24h_enviado=false WHERE cliente_id=$1 AND modelo_id=$2`, [cliente_id, modelo_id, novaExpiracao, valorBase, taxaGateway, valorPago, asaasPaymentId]);
          } else {
            await client.query(`INSERT INTO vip_subscriptions (cliente_id, modelo_id, ativo, created_at, updated_at, expiration_at, valor_assinatura, taxa_transacao, taxa_plataforma, valor_total, recorrente, gateway_subscription_id) VALUES ($1,$2,true,NOW(),NOW(),$3,$4,$5,0,$6,false,$7)`, [cliente_id, modelo_id, novaExpiracao, valorBase, taxaGateway, valorPago, asaasPaymentId]);
          }
          await client.query(`INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'assinatura',$3,$4,$5,$6,$7,'pago',NOW())`, [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]);
          if (primeiraAssinatura) {
            await client.query(`INSERT INTO messages (cliente_id, modelo_id, text, sender, tipo, created_at, lida, visto, deletada) VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)`, [cliente_id, modelo_id, "Oii!! Bem vindo(a), qual seu nome?🥰"]);
          }
          dadosParaEmitir = { tipo: "vip", cliente_id, modelo_id };
        } else if (tipoPag === "conteudo" || tipoPag === "midia") {
          const message_id = Number(row.message_id || row.conteudo_id || 0) || null;
          if (message_id) {
            await client.query(`INSERT INTO conteudo_pacotes (message_id, cliente_id, modelo_id, preco, valor_base, valor_total, status, metodo_pagamento, pago_em, currency, valor_cobrado, taxa_cambio) VALUES ($1,$2,$3,$4,$4,$5,'pago','cartao',NOW(),'brl',$5,NULL) ON CONFLICT (message_id, cliente_id) DO UPDATE SET status='pago', metodo_pagamento='cartao', pago_em=NOW(), valor_total=$5`, [message_id, cliente_id, modelo_id, valorBase, valorPago]);
            const conteudo_ids = await marcarConteudoComoLiberadoPorPagamento(client, { message_id, cliente_id, modelo_id });
            dadosParaEmitir = { tipo: "conteudo", cliente_id, modelo_id, message_id, conteudo_ids };
          }
          await client.query(`INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`, [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]);
        } else if (tipoPag === "premium") {
          const premium_post_id = Number(row.premium_post_id || 0) || null;
          if (premium_post_id) {
            await client.query(`UPDATE premium_unlocks SET status='pago', pago_em=NOW(), updated_at=NOW() WHERE premium_post_id=$1 AND cliente_id=$2`, [premium_post_id, cliente_id]);
            await client.query(`INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`, [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]);
            dadosParaEmitir = { tipo: "premium", cliente_id, modelo_id, premium_post_id, payment_id: asaasPaymentId };
          }
        }
      }

      await client.query("COMMIT");
      if (dadosParaEmitir) {
        try {
          const io = req.app.get("io");
          if (io) {
            if (dadosParaEmitir.tipo === "conteudo") io.to(`chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`).emit("conteudoLiberado", { message_id: Number(dadosParaEmitir.message_id), conteudo_ids: dadosParaEmitir.conteudo_ids || [] });
            if (dadosParaEmitir.tipo === "vip") io.to(`chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`).emit("vipAtivado", { cliente_id: Number(dadosParaEmitir.cliente_id), modelo_id: Number(dadosParaEmitir.modelo_id) });
            if (dadosParaEmitir.tipo === "premium") io.to(`user_${dadosParaEmitir.cliente_id}`).emit("pagamento_confirmado", { tipo: "premium", premium_post_id: dadosParaEmitir.premium_post_id, modelo_id: dadosParaEmitir.modelo_id, payment_id: dadosParaEmitir.payment_id });
          }
        } catch (e) {}
      }
      return res.status(200).send("ok");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("ERRO WEBHOOK ASAAS:", err);
      return res.status(500).send("erro");
    } finally {
      client.release();
    }
  });

  // ===========================
  // WEBHOOK ABACATEPAY
  // ===========================
  app.post("/api/webhook/abacatepay", express.json(), async (req, res) => {
    if (process.env.ABACATEPAY_WEBHOOK_SECRET) {
      const tokenRecebido = req.headers["authorization"] || req.headers["x-abacatepay-token"] || "";
      const tokenLimpo = tokenRecebido.replace(/^Bearer\s+/i, "");
      if (tokenLimpo !== process.env.ABACATEPAY_WEBHOOK_SECRET) {
        console.warn("Webhook AbacatePay: token inválido");
        return res.status(401).send("unauthorized");
      }
    }

    const body = req.body;
    const eventType = String(body?.event || "");
    const transparent = body?.data?.transparent || {};
    const correlationID = transparent?.id || null;
    const valorCentavos = Number(transparent?.paidAmount || transparent?.amount || 0);
    const valorPago = valorCentavos > 0 ? valorCentavos / 100 : 0;

    if (!correlationID) return res.status(200).send("ok");

    const isPaidEvent = eventType === "transparent.completed";
    const isFailedEvent = ["transparent.refunded","transparent.disputed"].includes(eventType);
    if (!isPaidEvent && !isFailedEvent) return res.status(200).send("ok");

    const novoStatus = isPaidEvent ? "pago" : "falhou";
    const calcularValores = req.app.get("calcularValores") || (async ({ valor_bruto }) => ({ valor_modelo: valor_bruto * 0.7, agency_fee: valor_bruto * 0.1, velvet_fee: valor_bruto * 0.05 }));

    const client = await db.connect();
    let dadosParaEmitir = null;

    try {
      await client.query("BEGIN");

      const premiumRes = await client.query(`SELECT * FROM premium_unlocks WHERE pagarme_order_id=$1::text LIMIT 1 FOR UPDATE`, [correlationID]);
      if (premiumRes.rowCount > 0) {
        const row = premiumRes.rows[0];
        if (row.status === "pago") { await client.query("ROLLBACK"); return res.status(200).send("ok"); }
        await client.query(`UPDATE premium_unlocks SET status=$1::text, pago_em=CASE WHEN $1::text='pago' THEN NOW() ELSE pago_em END, updated_at=NOW() WHERE id=$2`, [novoStatus, row.id]);
        if (isPaidEvent) {
          const cliente_id = Number(row.cliente_id);
          const modelo_id = Number(row.modelo_id);
          const premium_post_id = Number(row.premium_post_id);
          const valorBase = Number(row.valor_base || valorPago);
          const taxaGateway = Number((valorBase * 0.15).toFixed(2));
          const valores = await calcularValores({ modelo_id, valor_bruto: valorBase, taxa_gateway: taxaGateway });
          await client.query(`INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`, [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]);
          dadosParaEmitir = { tipo: "premium", cliente_id, modelo_id, premium_post_id, payment_id: correlationID };
        }
        await client.query("COMMIT");
        if (dadosParaEmitir) {
          try { const io = req.app.get("io"); if (io) io.to(`user_${dadosParaEmitir.cliente_id}`).emit("pagamento_confirmado", { tipo: "premium", premium_post_id: dadosParaEmitir.premium_post_id, modelo_id: dadosParaEmitir.modelo_id, payment_id: dadosParaEmitir.payment_id }); } catch (e) {}
        }
        return res.status(200).send("ok");
      }

      const pixRes = await client.query(`SELECT * FROM pagamentos_pix WHERE pagarme_order_id=$1 LIMIT 1 FOR UPDATE`, [correlationID]);
      if (pixRes.rowCount === 0) { await client.query("ROLLBACK"); return res.status(200).send("ok"); }

      const row = pixRes.rows[0];
      if (row.status === "pago") { await client.query("ROLLBACK"); return res.status(200).send("ok"); }
      await client.query(`UPDATE pagamentos_pix SET status=$1 WHERE pagarme_order_id=$2`, [novoStatus, correlationID]);

      if (isPaidEvent) {
        const cliente_id = Number(row.cliente_id);
        const modelo_id = Number(row.modelo_id);
        const message_id = row.message_id ? Number(row.message_id) : null;
        const isVip = !message_id;
        const valorBrutoTotal = Number(row.valor || valorPago);
        const valorBase = Number((valorBrutoTotal / 1.15).toFixed(2));
        const taxaGateway = Number((valorBrutoTotal - valorBase).toFixed(2));
        const valores = await calcularValores({ modelo_id, valor_bruto: valorBase, taxa_gateway: taxaGateway });

        if (isVip) {
          const vipExistente = await client.query(`SELECT id, ativo, expiration_at FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 LIMIT 1 FOR UPDATE`, [cliente_id, modelo_id]);
          const primeiraAssinatura = vipExistente.rowCount === 0;
          let novaExpiracao = new Date();
          if (vipExistente.rowCount > 0 && vipExistente.rows[0].expiration_at && new Date(vipExistente.rows[0].expiration_at) > new Date()) {
            novaExpiracao = new Date(vipExistente.rows[0].expiration_at);
          }
          novaExpiracao.setMonth(novaExpiracao.getMonth() + 1);
          if (vipExistente.rowCount > 0) {
            await client.query(`UPDATE vip_subscriptions SET ativo=true, updated_at=NOW(), expiration_at=$3, valor_assinatura=$4, taxa_transacao=$5, taxa_plataforma=0, valor_total=$6, recorrente=false, gateway_subscription_id=$7, aviso_7_dias_enviado=false, aviso_24h_enviado=false WHERE cliente_id=$1 AND modelo_id=$2`, [cliente_id, modelo_id, novaExpiracao, valorBase, taxaGateway, valorBrutoTotal, correlationID]);
          } else {
            await client.query(`INSERT INTO vip_subscriptions (cliente_id, modelo_id, ativo, created_at, updated_at, expiration_at, valor_assinatura, taxa_transacao, taxa_plataforma, valor_total, recorrente, gateway_subscription_id) VALUES ($1,$2,true,NOW(),NOW(),$3,$4,$5,0,$6,false,$7)`, [cliente_id, modelo_id, novaExpiracao, valorBase, taxaGateway, valorBrutoTotal, correlationID]);
          }
          await client.query(`INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'assinatura',$3,$4,$5,$6,$7,'pago',NOW())`, [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]);
          if (primeiraAssinatura) {
            await client.query(`INSERT INTO messages (cliente_id, modelo_id, text, sender, tipo, created_at, lida, visto, deletada) VALUES ($1,$2,$3,'modelo','texto',NOW(),false,false,false)`, [cliente_id, modelo_id, "Oii!! Bem vindo(a), qual seu nome?🥰🔥"]);
          }
          dadosParaEmitir = { tipo: "vip", cliente_id, modelo_id };
        } else {
          await client.query(`INSERT INTO conteudo_pacotes (message_id, cliente_id, modelo_id, preco, valor_base, valor_total, status, metodo_pagamento, pago_em, currency, valor_cobrado, taxa_cambio) VALUES ($1,$2,$3,$4,$4,$5,'pago','pix',NOW(),'brl',$5,NULL) ON CONFLICT (message_id, cliente_id) DO UPDATE SET status='pago', metodo_pagamento='pix', pago_em=NOW(), valor_total=$5`, [message_id, cliente_id, modelo_id, valorBase, valorBrutoTotal]);
          const conteudo_ids = await marcarConteudoComoLiberadoPorPagamento(client, { message_id, cliente_id, modelo_id });
          await client.query(`INSERT INTO transacoes_agency (modelo_id, cliente_id, tipo, valor_bruto, valor_modelo, agency_fee, velvet_fee, taxa_gateway, status, created_at) VALUES ($1,$2,'midia',$3,$4,$5,$6,$7,'pago',NOW())`, [modelo_id, cliente_id, valorBase, Number(valores.valor_modelo||0), Number(valores.agency_fee||0), Number(valores.velvet_fee||0), taxaGateway]);
          dadosParaEmitir = { tipo: "conteudo", cliente_id, modelo_id, message_id, conteudo_ids };
        }
      }

      await client.query("COMMIT");
      if (dadosParaEmitir) {
        try {
          const io = req.app.get("io");
          if (io) {
            if (dadosParaEmitir.tipo === "conteudo") io.to(`chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`).emit("conteudoLiberado", { message_id: Number(dadosParaEmitir.message_id), conteudo_ids: dadosParaEmitir.conteudo_ids || [] });
            if (dadosParaEmitir.tipo === "vip") io.to(`chat_${dadosParaEmitir.cliente_id}_${dadosParaEmitir.modelo_id}`).emit("vipAtivado", { cliente_id: Number(dadosParaEmitir.cliente_id), modelo_id: Number(dadosParaEmitir.modelo_id) });
          }
        } catch (e) {}
      }
      return res.status(200).send("ok");
    } catch (err) {
      try { await client.query("ROLLBACK"); } catch (_) {}
      console.error("ERRO WEBHOOK ABACATEPAY:", err);
      return res.status(500).send("erro");
    } finally {
      client.release();
    }
  });

  // ===========================
  // WEBHOOK STRIPE (desativado)
  // ===========================
  app.post("/api/webhook/stripe", express.raw({ type: "application/json" }), async (req, res) => {
    try {
      const signature = req.headers["stripe-signature"];
      if (!signature) return res.status(400).send("missing signature");
      throw new Error("Stripe webhook disabled - use /api/webhook/asaas instead");
    } catch (err) {
      console.error("Erro validando webhook Stripe:", err.message);
      return res.status(400).send("invalid signature");
    }
  });

  // Placeholder pagarme removido
  app.post("/api/webhook/pagarme_REMOVED", express.raw({ type: "*/*" }), async (req, res) => {
    return res.status(200).send("ok");
  });
}

module.exports = { registerWebhooks };
