const express     = require("express");
const router      = express.Router();
const path        = require("path");
const db          = require("../db");
const auth        = require("../middleware/auth");
const authModelo  = require("../middleware/authModelo");
const authCliente = require("../middleware/authCliente");
const requireRole = require("../middleware/requireRole");

function podeAlterarDadosBancarios() {
  const dia = new Date().getDate();
  return !(dia >= 1 && dia <= 5);
}

// ── Dados bancários ────────────────────────────────────────────────────────────

router.post("/modelo/dados-bancarios", authModelo, async (req, res) => {
  if (!podeAlterarDadosBancarios()) {
    return res.status(403).json({ error: "Alterações bloqueadas no período de pagamento" });
  }
  const { pix_tipo, pix_chave, banco, agencia, conta, conta_tipo, titular_nome, titular_documento, confirmado_titular } = req.body;
  const tipo = (req.body.tipo || "").toLowerCase() || null;
  if (!confirmado_titular) return res.status(400).json({ error: "Confirmação de titularidade obrigatória" });
  try {
    await db.query(`
      INSERT INTO modelo_dados_bancarios (modelo_id, tipo, pix_tipo, pix_chave, banco, agencia, conta, conta_tipo, titular_nome, titular_documento, confirmado_titular, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'pendente')
      ON CONFLICT (modelo_id) DO UPDATE SET
        tipo=EXCLUDED.tipo, pix_tipo=EXCLUDED.pix_tipo, pix_chave=EXCLUDED.pix_chave,
        banco=EXCLUDED.banco, agencia=EXCLUDED.agencia, conta=EXCLUDED.conta,
        conta_tipo=EXCLUDED.conta_tipo, titular_nome=EXCLUDED.titular_nome,
        titular_documento=EXCLUDED.titular_documento, confirmado_titular=true,
        status='alteracao_pendente', atualizado_em=NOW()
    `, [req.modelo_id, tipo, pix_tipo, pix_chave, banco, agencia, conta, conta_tipo, titular_nome, titular_documento]);
    res.json({ ok: true });
  } catch (err) {
    console.error("ERRO DADOS BANCÁRIOS:", err);
    res.status(500).json({ error: "Erro interno ao salvar dados bancários" });
  }
});

router.post("/modelo/dados-bancarios/alterar", authModelo, async (req, res) => {
  if (!podeAlterarDadosBancarios()) {
    return res.status(403).json({ error: "Alterações bloqueadas no período de pagamento" });
  }
  const { justificativa, pix_tipo, pix_chave, banco, agencia, conta, conta_tipo, titular_nome, titular_documento } = req.body;
  const tipo = (req.body.tipo || "").toLowerCase() || null;
  if (!justificativa) return res.status(400).json({ error: "Justificativa obrigatória" });
  try {
    await db.query(`
      UPDATE modelo_dados_bancarios SET tipo=$1, pix_tipo=$2, pix_chave=$3, banco=$4, agencia=$5,
        conta=$6, conta_tipo=$7, titular_nome=$8, titular_documento=$9, justificativa=$10,
        status='alteracao_pendente', atualizado_em=NOW()
      WHERE modelo_id=$11
    `, [tipo, pix_tipo, pix_chave, banco, agencia, conta, conta_tipo, titular_nome, titular_documento, justificativa, req.modelo_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("ERRO DADOS BANCÁRIOS:", err);
    res.status(500).json({ error: "Erro interno ao salvar dados bancários" });
  }
});

router.get("/modelo/dados-bancarios", authModelo, async (req, res) => {
  try {
    const { rows } = await db.query(`SELECT * FROM modelo_dados_bancarios WHERE modelo_id=$1`, [req.modelo_id]);
    res.json(rows.length ? rows[0] : null);
  } catch (err) {
    console.error("Erro buscar dados bancários:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// ── Transações cliente ─────────────────────────────────────────────────────────

router.get("/transacoes_cliente", authCliente, async (req, res) => {
  try {
    if (req.user.role !== "cliente") return res.status(403).json({ error: "Apenas cliente pode acessar" });
    const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [req.user.id]);
    if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
    const clienteId = clienteRes.rows[0].id;
    const vipQ = await db.query(`SELECT id,'assinatura' AS tipo,valor_total AS valor,CASE WHEN ativo THEN 'pago' ELSE 'inativo' END AS status,created_at FROM vip_subscriptions WHERE cliente_id=$1`, [clienteId]);
    const contQ = await db.query(`SELECT id,'midia' AS tipo,valor_total AS valor,status,criado_em AS created_at FROM conteudo_pacotes WHERE cliente_id=$1`, [clienteId]);
    const transacoes = [...vipQ.rows, ...contQ.rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(transacoes);
  } catch (err) {
    console.error("Erro buscar transações cliente:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/cliente/transacoes", authCliente, async (req, res) => {
  try {
    const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [req.user.id]);
    if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
    const clienteId = clienteRes.rows[0].id;
    const conteudos   = await db.query(`SELECT 'conteudo' AS tipo,cp.id,cp.modelo_id,cp.valor_total AS valor,cp.status,cp.criado_em AS created_at,cp.message_id FROM conteudo_pacotes cp WHERE cp.cliente_id=$1 AND cp.status='pago'`, [clienteId]);
    const assinaturas = await db.query(`SELECT 'assinatura' AS tipo,v.id,v.modelo_id,(v.valor_assinatura+v.taxa_transacao+v.taxa_plataforma) AS valor,CASE WHEN v.ativo THEN 'ativa' ELSE 'inativa' END AS status,v.created_at,NULL AS message_id FROM vip_subscriptions v WHERE v.cliente_id=$1`, [clienteId]);
    const historico = [...conteudos.rows, ...assinaturas.rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    res.json(historico);
  } catch (err) {
    console.error("Erro histórico cliente:", err);
    res.status(500).json({ error: "Erro ao buscar histórico do cliente" });
  }
});

router.get("/cliente/subscricoes", auth, async (req, res) => {
  try {
    const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [req.user.id]);
    if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
    const result = await db.query(`
      SELECT v.id,v.modelo_id,m.nome_exibicao AS modelo,v.created_at,v.expiration_at,v.ativo,v.recorrente
      FROM vip_subscriptions v JOIN modelos m ON m.id=v.modelo_id
      WHERE v.cliente_id=$1 ORDER BY v.created_at DESC
    `, [clienteRes.rows[0].id]);
    res.json(result.rows);
  } catch (err) {
    console.error("Erro subscrições:", err);
    res.status(500).json({ error: "Erro ao buscar subscrições" });
  }
});

router.get("/access", authCliente, async (req, res) => {
  const message_id = Number(req.query.message_id);
  if (!Number.isInteger(message_id) || message_id <= 0) return res.status(400).json({ error: "message_id inválido" });
  const msgRes = await db.query(`SELECT id FROM messages WHERE id=$1 AND cliente_id=$2 AND visto=true`, [message_id, req.user.id]);
  if (msgRes.rowCount === 0) return res.status(403).json({ error: "Conteúdo não liberado" });
  const midiasRes = await db.query(`SELECT c.url, c.tipo FROM messages_conteudos mc JOIN conteudos c ON c.id=mc.conteudo_id WHERE mc.message_id=$1`, [message_id]);
  res.json({ midias: midiasRes.rows.map(m => ({ tipo: m.tipo, url: m.url })) });
});

// ── Transações modelo ──────────────────────────────────────────────────────────

router.get("/modelo/transacoes", requireRole("modelo", "admin", "agente"), (req, res) => {
  res.sendFile(path.join(process.cwd(), "transacoes", "transacoes.html"));
});

router.get("/transacoes", authModelo, async (req, res) => {
  try {
    const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id=$1", [req.user.id]);
    if (!modeloRes.rows.length) return res.status(404).json({ error: "Modelo não encontrada" });
    const modelo_id = modeloRes.rows[0].id;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = 10;
    const offset = (page - 1) * limit;
    const { mes } = req.query;
    let values = [modelo_id];
    let monthFilter = "";
    if (mes && /^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
      const [ano, mesNum] = mes.split("-").map(Number);
      values.push(ano, mesNum);
      monthFilter = `AND created_at >= make_timestamptz($2,$3,1,0,0,0,'America/Sao_Paulo') AND created_at < (make_timestamptz($2,$3,1,0,0,0,'America/Sao_Paulo') + interval '1 month')`;
    }
    const dataValues = [...values, limit, offset];
    const sql = `SELECT id AS codigo,tipo,created_at,TO_CHAR(created_at AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') AS created_at_sp_formatado,valor_modelo AS valor,status,NULL AS message_id FROM transacoes_agency WHERE modelo_id=$1 AND status='pago' ${monthFilter} ORDER BY created_at DESC LIMIT $${dataValues.length-1} OFFSET $${dataValues.length}`;
    const countSql = `SELECT COUNT(*) AS count FROM transacoes_agency WHERE modelo_id=$1 AND status='pago' ${monthFilter}`;
    const [dados, total] = await Promise.all([db.query(sql, dataValues), db.query(countSql, values)]);
    res.json({ registros: dados.rows, paginaAtual: page, totalPaginas: Math.ceil(parseInt(total.rows[0].count)/limit), totalRegistros: parseInt(total.rows[0].count) });
  } catch (err) {
    console.error("Erro /transacoes:", err);
    res.status(500).json({ registros: [], paginaAtual: 1, totalPaginas: 1, totalRegistros: 0 });
  }
});

router.get("/transacoes/diario", auth, requireRole("admin", "modelo", "agente"), async (req, res) => {
  try {
    const { mes } = req.query;
    if (!mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return res.status(400).json({ error: "Formato de mês inválido (YYYY-MM)" });
    const [ano, mesNum] = mes.split("-").map(Number);
    let values = [ano, mesNum];
    let where = `status='pago' AND created_at >= make_timestamptz($1,$2,1,0,0,0,'America/Sao_Paulo') AND created_at < (make_timestamptz($1,$2,1,0,0,0,'America/Sao_Paulo') + interval '1 month')`;
    if (req.user.role === "modelo") {
      const r = await db.query("SELECT id FROM modelos WHERE user_id=$1", [req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: "Modelo não encontrada" });
      values.push(r.rows[0].id); where += ` AND modelo_id=$${values.length}`;
    }
    const result = await db.query(`SELECT DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,COALESCE(SUM(CASE WHEN tipo='midia' THEN valor_modelo END),0) AS ganhos_midias,COALESCE(SUM(CASE WHEN tipo='assinatura' THEN valor_modelo END),0) AS ganhos_assinaturas FROM transacoes_agency WHERE ${where} GROUP BY dia ORDER BY dia`, values);
    res.json(result.rows);
  } catch (err) {
    console.error("Erro /transacoes/diario:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/transacoes/resumo-mensal", auth, requireRole("admin", "modelo", "agente"), async (req, res) => {
  try {
    const { mes } = req.query;
    if (!mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) return res.status(400).json({ error: "Formato de mês inválido (YYYY-MM)" });
    const [ano, mesNum] = mes.split("-").map(Number);
    let values = [ano, mesNum];
    let where = `status='pago' AND created_at >= make_timestamptz($1,$2,1,0,0,0,'America/Sao_Paulo') AND created_at < (make_timestamptz($1,$2,1,0,0,0,'America/Sao_Paulo') + interval '1 month')`;
    if (req.user.role === "modelo") {
      const r = await db.query("SELECT id FROM modelos WHERE user_id=$1", [req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: "Modelo não encontrada" });
      values.push(r.rows[0].id); where += ` AND modelo_id=$${values.length}`;
    }
    const result = await db.query(`SELECT COALESCE(SUM(valor_bruto),0) AS total_bruto,COALESCE(SUM(taxa_gateway),0) AS total_taxas,COALESCE(SUM(agency_fee),0) AS total_agency,COALESCE(SUM(velvet_fee),0) AS total_velvet,COALESCE(SUM(valor_modelo),0) AS total_modelo,COALESCE(SUM(CASE WHEN tipo='assinatura' THEN valor_bruto END),0) AS total_assinaturas,COALESCE(SUM(CASE WHEN tipo='midia' THEN valor_bruto END),0) AS total_midias FROM transacoes_agency WHERE ${where}`, values);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro /transacoes/resumo-mensal:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/transacoes/resumo-anual", auth, requireRole("admin", "modelo"), async (req, res) => {
  try {
    const { ano } = req.query;
    if (!ano || !/^\d{4}$/.test(ano)) return res.status(400).json({ error: "Formato de ano inválido (YYYY)" });
    const anoNum = Number(ano);
    let values = [anoNum];
    let where = `status='pago' AND created_at >= make_timestamptz($1,1,1,0,0,0,'America/Sao_Paulo') AND created_at < make_timestamptz($1+1,1,1,0,0,0,'America/Sao_Paulo')`;
    if (req.user.role === "modelo") {
      const r = await db.query("SELECT id FROM modelos WHERE user_id=$1", [req.user.id]);
      if (!r.rows.length) return res.status(404).json({ error: "Modelo não encontrada" });
      values.push(r.rows[0].id); where += ` AND modelo_id=$${values.length}`;
    }
    const result = await db.query(`SELECT DATE_TRUNC('month',created_at AT TIME ZONE 'America/Sao_Paulo') AS mes,COALESCE(SUM(valor_bruto),0) AS total_bruto,COALESCE(SUM(taxa_gateway),0) AS total_taxas,COALESCE(SUM(agency_fee),0) AS total_agency,COALESCE(SUM(velvet_fee),0) AS total_velvet,COALESCE(SUM(valor_modelo),0) AS total_modelo,COALESCE(SUM(CASE WHEN tipo='assinatura' THEN valor_bruto END),0) AS total_assinaturas,COALESCE(SUM(CASE WHEN tipo='midia' THEN valor_bruto END),0) AS total_midias FROM transacoes_agency WHERE ${where} GROUP BY mes ORDER BY mes`, values);
    res.json(result.rows);
  } catch (err) {
    console.error("Erro /transacoes/resumo-anual:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/transacoes/origem", auth, requireRole("admin"), async (req, res) => {
  const result = await db.query(`SELECT origem_cliente,COUNT(*) AS clientes,SUM(valor_bruto) AS total FROM transacoes_agency WHERE status='pago' GROUP BY origem_cliente`);
  res.json(result.rows);
});

router.get("/content/transacoes", (req, res) => {
  res.sendFile(path.join(process.cwd(), "content", "transacoes.html"));
});

// ── Financeiro modelo ──────────────────────────────────────────────────────────

router.get("/modelo/financeiro", authModelo, async (req, res) => {
  try {
    const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id=$1", [req.user.id]);
    if (!modeloRes.rows.length) return res.status(404).json({ error: "Modelo não encontrada" });
    const modelo_id = modeloRes.rows[0].id;
    const result = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN tipo IN ('midia','conteudo') AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo')=DATE(NOW() AT TIME ZONE 'America/Sao_Paulo') THEN valor_modelo END),0) AS hoje_midias,
        COALESCE(SUM(CASE WHEN tipo='assinatura' AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo')=DATE(NOW() AT TIME ZONE 'America/Sao_Paulo') THEN valor_modelo END),0) AS hoje_assinaturas,
        COALESCE(SUM(CASE WHEN tipo IN ('midia','conteudo') AND DATE_TRUNC('month',created_at AT TIME ZONE 'America/Sao_Paulo')=DATE_TRUNC('month',NOW() AT TIME ZONE 'America/Sao_Paulo') THEN valor_modelo END),0) AS mes_midias,
        COALESCE(SUM(CASE WHEN tipo='assinatura' AND DATE_TRUNC('month',created_at AT TIME ZONE 'America/Sao_Paulo')=DATE_TRUNC('month',NOW() AT TIME ZONE 'America/Sao_Paulo') THEN valor_modelo END),0) AS mes_assinaturas,
        COALESCE(SUM(CASE WHEN tipo IN ('midia','conteudo') AND DATE_TRUNC('month',created_at AT TIME ZONE 'America/Sao_Paulo')=DATE_TRUNC('month',NOW() AT TIME ZONE 'America/Sao_Paulo')-INTERVAL '1 month' THEN valor_modelo END),0) AS mes_anterior_midias,
        COALESCE(SUM(CASE WHEN tipo='assinatura' AND DATE_TRUNC('month',created_at AT TIME ZONE 'America/Sao_Paulo')=DATE_TRUNC('month',NOW() AT TIME ZONE 'America/Sao_Paulo')-INTERVAL '1 month' THEN valor_modelo END),0) AS mes_anterior_assinaturas,
        COALESCE(SUM(CASE WHEN EXTRACT(YEAR FROM created_at AT TIME ZONE 'America/Sao_Paulo')=EXTRACT(YEAR FROM NOW() AT TIME ZONE 'America/Sao_Paulo') THEN valor_modelo END),0) AS acumulado_ano_atual,
        COUNT(DISTINCT CASE WHEN tipo='assinatura' AND status='pago' AND DATE_TRUNC('month',created_at AT TIME ZONE 'America/Sao_Paulo')=DATE_TRUNC('month',NOW() AT TIME ZONE 'America/Sao_Paulo') THEN cliente_id END) AS assinantes_total,
        COUNT(DISTINCT CASE WHEN tipo='assinatura' AND status='pago' AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo')=DATE(NOW() AT TIME ZONE 'America/Sao_Paulo') THEN cliente_id END) AS assinantes_hoje
      FROM transacoes_agency WHERE modelo_id=$1 AND status='pago'
    `, [modelo_id]);
    const r = result.rows[0];
    res.json({
      hoje:       { midias: Number(r.hoje_midias||0),        assinaturas: Number(r.hoje_assinaturas||0) },
      mes:        { midias: Number(r.mes_midias||0),         assinaturas: Number(r.mes_assinaturas||0) },
      mesAnterior:{ midias: Number(r.mes_anterior_midias||0), assinaturas: Number(r.mes_anterior_assinaturas||0) },
      total:      { acumulado_ano_atual: Number(r.acumulado_ano_atual||0) },
      assinantes: { total: Number(r.assinantes_total||0), hoje: Number(r.assinantes_hoje||0) }
    });
  } catch (err) {
    console.error("Erro /modelo/financeiro:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/modelo/pagamentos", authModelo, async (req, res) => {
  try {
    const r = await db.query("SELECT id FROM modelos WHERE user_id=$1", [req.user.id]);
    const result = await db.query(`SELECT mes,total_midias,total_assinaturas,total_geral,status,pago_em FROM modelo_pagamentos WHERE modelo_id=$1 ORDER BY mes DESC`, [r.rows[0].id]);
    res.json(result.rows);
  } catch (err) {
    console.error("ERRO PAGAMENTOS:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/modelo/clientes/:cliente_id/transacoes", authModelo, async (req, res) => {
  try {
    const cliente_id = Number(req.params.cliente_id);
    if (!Number.isInteger(cliente_id) || cliente_id <= 0) return res.status(400).json({ error: "cliente_id inválido" });
    const modeloRes = await db.query(`SELECT id FROM modelos WHERE user_id=$1 LIMIT 1`, [req.user.id]);
    if (!modeloRes.rowCount) return res.status(404).json({ error: "Modelo não encontrada" });
    const modelo_id = Number(modeloRes.rows[0].id);
    const clienteRes = await db.query(`SELECT c.id, c.nome, NULL AS avatar_url FROM clientes c WHERE c.id=$1 LIMIT 1`, [cliente_id]);
    if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
    const resumoRes = await db.query(`
      SELECT COUNT(*) FILTER (WHERE t.status='pago')::int AS total_compras,
        COALESCE(SUM(CASE WHEN t.status='pago' THEN t.valor_bruto END),0)::numeric(10,2) AS total_pago,
        COUNT(*) FILTER (WHERE t.status='pago' AND LOWER(COALESCE(t.tipo,'')) IN ('conteudo','midia'))::int AS conteudos_pagos,
        COUNT(*) FILTER (WHERE t.status='pago' AND LOWER(COALESCE(t.tipo,''))='assinatura')::int AS assinaturas
      FROM transacoes_agency t WHERE t.modelo_id=$1 AND t.cliente_id=$2
    `, [modelo_id, cliente_id]);
    const transRes = await db.query(`
      SELECT t.id, CASE WHEN LOWER(COALESCE(t.tipo,''))='conteudo' THEN 'midia' ELSE LOWER(COALESCE(t.tipo,'')) END AS tipo,
        t.created_at, t.valor_bruto, t.valor_modelo, t.status, t.aceitou_termos
      FROM transacoes_agency t WHERE t.modelo_id=$1 AND t.cliente_id=$2 AND t.status='pago'
      ORDER BY t.created_at DESC, t.id DESC
    `, [modelo_id, cliente_id]);
    return res.json({
      cliente: clienteRes.rows[0],
      resumo: { total_compras: Number(resumoRes.rows[0]?.total_compras||0), total_pago: Number(resumoRes.rows[0]?.total_pago||0), conteudos_pagos: Number(resumoRes.rows[0]?.conteudos_pagos||0), assinaturas: Number(resumoRes.rows[0]?.assinaturas||0) },
      totalRegistros: transRes.rowCount, registros: transRes.rows
    });
  } catch (err) {
    console.error("Erro buscar transações do cliente:", err);
    return res.status(500).json({ error: "Erro ao buscar transações" });
  }
});

router.get("/modelo/conteudos", auth, authModelo, async (req, res) => {
  const result = await db.query(`SELECT id, url, thumbnail_url AS thumbnail FROM conteudos WHERE modelo_id=$1 AND tipo_conteudo='venda' ORDER BY id DESC`, [req.modelo_id]);
  res.json(result.rows);
});

module.exports = router;
