const express = require("express");
const router = express.Router();
const path = require("path");
const db = require("../db");
const auth = require("../middleware/auth");
const authModelo = require("../middleware/authModelo");
const { onlineModelos } = require("../state");
const { uploadB2 } = require("../config/storage");
const { uploadLimiter } = require("../config/rateLimiters");
const { uploadToSupabase } = require("../utils/upload");

// GET /api/modelo/me
router.get("/me", authModelo, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT m.id AS modelo_id, m.user_id, m.nome_exibicao, m.bio, m.avatar, m.capa, m.local, m.verificada,
              md.instagram, md.tiktok
       FROM modelos m LEFT JOIN modelos_dados md ON md.modelo_id = m.id AND md.ativo = true
       WHERE m.id = $1 AND m.ativo = true`,
      [req.modelo_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Perfil não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro /api/modelo/me:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// PUT /api/modelo/me
router.put("/me", authModelo, async (req, res) => {
  try {
    const { nome_exibicao, instagram, tiktok, local, bio } = req.body;
    if (!nome_exibicao || !nome_exibicao.trim()) {
      return res.status(400).json({ error: "nome_exibicao é obrigatório" });
    }
    await db.query(
      `UPDATE modelos SET nome_exibicao = $1, local = $2, bio = $3 WHERE id = $4`,
      [nome_exibicao.trim(), local?.trim() || null, bio?.trim() || null, req.modelo_id]
    );
    await db.query(
      `INSERT INTO modelos_dados (modelo_id, instagram, tiktok)
       VALUES ($1, $2, $3)
       ON CONFLICT (modelo_id) DO UPDATE SET instagram = EXCLUDED.instagram, tiktok = EXCLUDED.tiktok`,
      [req.modelo_id, instagram?.trim() || null, tiktok?.trim() || null]
    );
    res.json({ sucesso: true });
  } catch (err) {
    console.error("ERRO PUT /api/modelo/me:", err);
    res.status(500).json({ erro: "Erro ao salvar dados da modelo" });
  }
});

// GET /api/modelo/planos/me
router.get("/planos/me", auth, authModelo, async (req, res) => {
  try {
    const plano = await db.query(
      `SELECT COALESCE(valor_mensal, 20.00) AS valor_mensal FROM modelos_planos WHERE modelo_id = $1 LIMIT 1`,
      [req.modelo_id]
    );
    res.json(plano.rows[0] || { valor_mensal: 20 });
  } catch (err) {
    console.error("Erro buscar plano:", err);
    res.status(500).json({ erro: "Erro ao buscar plano" });
  }
});

// PUT /api/modelo/planos
router.put("/planos", authModelo, async (req, res) => {
  try {
    const { valor_mensal, desconto_trimestral } = req.body;
    const mensal = Number(valor_mensal);
    const desconto = Number(desconto_trimestral) || 0;
    if (!mensal || mensal < 20) return res.status(400).json({ erro: "Valor mínimo R$ 20" });
    if (desconto < 0 || desconto > 30) return res.status(400).json({ erro: "Desconto inválido" });
    const valorTrimestral = (mensal * 3) * (1 - desconto / 100);
    const existe = await db.query(`SELECT modelo_id FROM modelos_planos WHERE modelo_id = $1`, [req.modelo_id]);
    if (existe.rows.length > 0) {
      await db.query(
        `UPDATE modelos_planos SET valor_mensal = $1, desconto_trimestral = $2, valor_trimestral = $3, updated_at = NOW() WHERE modelo_id = $4`,
        [mensal, desconto, valorTrimestral, req.modelo_id]
      );
    } else {
      await db.query(
        `INSERT INTO modelos_planos (modelo_id, valor_mensal, desconto_trimestral, valor_trimestral) VALUES ($1,$2,$3,$4)`,
        [req.modelo_id, mensal, desconto, valorTrimestral]
      );
    }
    res.json({ sucesso: true });
  } catch (err) {
    console.error("Erro salvar plano:", err);
    res.status(500).json({ erro: "Erro ao salvar plano" });
  }
});

// GET /api/modelo/chat/:id
router.get("/chat/:id", auth, async (req, res) => {
  const modelo_id = Number(req.params.id);
  if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
    return res.status(400).json({ error: "modelo_id inválido" });
  }
  try {
    const result = await db.query(
      `SELECT id, nome_exibicao, avatar AS avatar_url, last_seen FROM modelos WHERE id = $1 AND ativo = true`,
      [modelo_id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "Modelo não encontrado" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro buscar modelo chat:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// GET /api/modelo/me/vip-count
router.get("/me/vip-count", auth, async (req, res) => {
  try {
    const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id = $1", [req.user.id]);
    if (!modeloRes.rows.length) return res.json({ total: 0 });
    const result = await db.query(
      `SELECT COUNT(*)::int AS total FROM vip_subscriptions WHERE modelo_id = $1 AND ativo = true AND expiration_at > NOW()`,
      [modeloRes.rows[0].id]
    );
    res.json({ total: result.rows[0]?.total || 0 });
  } catch (err) {
    console.error("Erro contar VIPs:", err);
    res.status(500).json({ total: 0 });
  }
});

// GET /api/modelo/vips
router.get("/vips", authModelo, async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.id AS cliente_id, c.nome FROM vip_subscriptions v JOIN clientes c ON c.id = v.cliente_id
       WHERE v.modelo_id = $1 AND v.ativo = true AND v.expiration_at > NOW() ORDER BY c.nome`,
      [req.modelo_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erro listar VIPs:", err);
    res.status(500).json([]);
  }
});

// GET /api/modelo/assinantes
router.get("/assinantes", authModelo, async (req, res) => {
  try {
    const result = await db.query(
      `WITH vip_ativos AS (
         SELECT v.cliente_id, v.modelo_id, MAX(v.expiration_at) AS expiration_at
         FROM vip_subscriptions v WHERE v.modelo_id = $1 AND v.ativo = true AND v.expiration_at > NOW()
         GROUP BY v.cliente_id, v.modelo_id
       ),
       financeiros AS (
         SELECT t.cliente_id, t.modelo_id,
           COALESCE(SUM(CASE WHEN LOWER(COALESCE(t.tipo,''))='assinatura' AND t.status='pago' THEN COALESCE(t.valor_modelo,0) ELSE 0 END),0)::numeric(10,2) AS total_assinaturas,
           COALESCE(SUM(CASE WHEN LOWER(COALESCE(t.tipo,'')) IN ('conteudo','midia') AND t.status='pago' THEN COALESCE(t.valor_modelo,0) ELSE 0 END),0)::numeric(10,2) AS total_midias
         FROM transacoes_agency t WHERE t.modelo_id = $1 GROUP BY t.cliente_id, t.modelo_id
       )
       SELECT c.id AS cliente_id, c.nome AS nome_cliente, va.expiration_at,
         COALESCE(f.total_assinaturas,0)::numeric(10,2) AS total_assinaturas,
         COALESCE(f.total_midias,0)::numeric(10,2) AS total_midias
       FROM vip_ativos va JOIN clientes c ON c.id = va.cliente_id
       LEFT JOIN financeiros f ON f.cliente_id = va.cliente_id AND f.modelo_id = va.modelo_id
       ORDER BY va.expiration_at ASC, c.nome ASC`,
      [req.modelo_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erro listar assinantes:", err);
    res.status(500).json({ erro: "Erro ao listar assinantes" });
  }
});

// GET /api/modelos (feed)
router.get("/feed", auth, async (req, res) => {
  try {
    if (!["cliente", "modelo"].includes(req.user.role)) return res.status(403).json([]);
    const clienteId = req.user.role === "cliente" ? req.user.id : null;

    const result = await db.query(`
      SELECT m.id AS modelo_id, m.nome_exibicao, m.avatar, m.capa, m.bio,
        COALESCE(r.ganhos_mes, 0) AS ganhos_total,
        ver.verificado_em AS aprovado_em,
        CASE WHEN ver.verificado_em >= NOW() - INTERVAL '14 days' THEN true ELSE false END AS is_new,
        COALESCE(fas.total, 0) AS total_fas,
        CASE WHEN COALESCE(resp.total_recebidas,0) >= 5 AND COALESCE(resp.total_respondidas,0)::float/NULLIF(resp.total_recebidas,0) >= 0.7 THEN true ELSE false END AS responsiva,
        CASE WHEN COALESCE(cont.recente,0) > 0 OR COALESCE(cont.premium,0) > 0 THEN true ELSE false END AS ativa_conteudo,
        COALESCE(cont.premium, 0) AS total_premium,
        CASE WHEN $1::int IS NOT NULL AND (COALESCE(inter.msgs,0)>0 OR COALESCE(assin.ativa,false)=true) THEN true ELSE false END AS recomendada
      FROM modelos m
      JOIN LATERAL (SELECT status, verificado_em FROM modelos_verificacao WHERE modelo_id = m.id ORDER BY verificado_em DESC LIMIT 1) ver ON true
      LEFT JOIN LATERAL (SELECT SUM(valor_modelo) AS ganhos_mes FROM transacoes_agency t WHERE t.modelo_id = m.id AND date_trunc('month',t.created_at) = date_trunc('month',NOW())) r ON true
      LEFT JOIN LATERAL (SELECT COUNT(*) AS total FROM vip_subscriptions v WHERE v.modelo_id = m.id AND v.ativo = true AND v.expiration_at > NOW()) fas ON true
      LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE sender='cliente') AS total_recebidas, COUNT(*) FILTER (WHERE sender='modelo' AND EXISTS (SELECT 1 FROM messages m2 WHERE m2.modelo_id=m.id AND m2.cliente_id=messages.cliente_id AND m2.sender='cliente' AND m2.created_at<messages.created_at AND m2.created_at >= NOW()-INTERVAL '7 days')) AS total_respondidas FROM messages WHERE modelo_id=m.id AND created_at >= NOW()-INTERVAL '7 days' AND deletada IS NOT TRUE) resp ON true
      LEFT JOIN LATERAL (SELECT COUNT(*) FILTER (WHERE criado_em >= NOW()-INTERVAL '7 days') AS recente, COUNT(*) FILTER (WHERE tipo_conteudo='venda' AND preco>0) AS premium FROM conteudos WHERE modelo_id=m.id) cont ON true
      LEFT JOIN LATERAL (SELECT COUNT(*) AS msgs FROM messages WHERE modelo_id=m.id AND cliente_id=$1 AND deletada IS NOT TRUE LIMIT 1) inter ON ($1::int IS NOT NULL)
      LEFT JOIN LATERAL (SELECT true AS ativa FROM vip_subscriptions WHERE modelo_id=m.id AND cliente_id=$1 AND ativo=true AND expiration_at>NOW() LIMIT 1) assin ON ($1::int IS NOT NULL)
      WHERE ver.status = 'aprovado' AND m.feed = true AND m.ativo = true
    `, [clienteId]);

    const modelos = result.rows;
    const onlineIds = new Set(onlineModelos.keys());
    modelos.forEach(m => { m.online = onlineIds.has(Number(m.modelo_id)); });

    const online      = modelos.filter(m => m.online);
    const novas       = modelos.filter(m => m.is_new);
    const emAlta      = [...modelos].sort((a, b) => b.ganhos_total - a.ganhos_total).slice(0, 20);
    const recomendadas = clienteId
      ? modelos.filter(m => m.recomendada)
      : [...modelos].sort(() => Math.random() - 0.5).slice(0, 10);

    emAlta.forEach((m, i) => {
      if (i === 0) m.top1 = true;
      if (i === 1) m.top2 = true;
      if (i === 2) m.top3 = true;
    });

    const idsDestaque = new Set([
      ...online.map(m => m.modelo_id), ...novas.map(m => m.modelo_id),
      ...emAlta.map(m => m.modelo_id), ...recomendadas.map(m => m.modelo_id)
    ]);
    const descubraMais = modelos.filter(m => !idsDestaque.has(m.modelo_id))
      .sort((a, b) => (a.nome_exibicao || "").localeCompare(b.nome_exibicao || "", "pt-BR"));

    res.json({ online, novas, emAlta, recomendadas, descubraMais });
  } catch (err) {
    console.error("Erro feed modelos:", err);
    res.status(500).json({ online: [], novas: [], emAlta: [], recomendadas: [] });
  }
});

// GET /api/modelo/publico/:id/feed
router.get("/publico/:id/feed", async (req, res) => {
  const modeloId = Number(req.params.id);
  const { rows } = await db.query(
    `SELECT c.id, c.url, c.thumbnail_url, c.tipo, c.tipo_conteudo, c.preco, c.descricao
     FROM conteudos c JOIN modelos m ON m.id = c.modelo_id
     WHERE c.modelo_id = $1 AND m.ativo = true AND c.ativo = true AND c.tipo_conteudo = 'feed' AND (c.preco IS NULL OR c.preco = 0)
     ORDER BY c.id DESC`,
    [modeloId]
  );
  res.json(rows);
});

// GET /api/modelo/publico/:modelo_id
router.get("/publico/:modelo_id", async (req, res) => {
  const modelo_id = Number(req.params.modelo_id);
  if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
    return res.status(400).json({ error: "modelo_id inválido" });
  }
  try {
    const result = await db.query(
      `SELECT m.id AS modelo_id, m.nome_exibicao, m.bio, m.avatar, m.capa, m.local,
              COALESCE(NULLIF(mp.valor_mensal,0), NULLIF(md.vip_preco,0), 20.00) AS valor_assinatura,
              md.instagram, md.tiktok
       FROM modelos m
       JOIN LATERAL (SELECT status FROM modelos_verificacao WHERE modelo_id = m.id ORDER BY criado_em DESC LIMIT 1) v ON true
       LEFT JOIN modelos_dados md ON md.modelo_id = m.id AND md.ativo = true
       LEFT JOIN modelos_planos mp ON mp.modelo_id = m.id
       WHERE m.id = $1 AND m.ativo = true AND v.status = 'aprovado' LIMIT 1`,
      [modelo_id]
    );
    if (!result.rows.length) return res.status(403).json({ error: "Perfil indisponível no momento" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro perfil público:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

// GET /api/modelo/aceite-termos/status
const VERSAO_TERMOS_ATUAL = "2026-05";
router.get("/aceite-termos/status", auth, async (req, res) => {
  try {
    const modeloRes = await db.query(
      "SELECT id, termos_aceites, termos_versao FROM modelos WHERE user_id = $1", [req.user.id]
    );
    if (!modeloRes.rowCount) return res.status(404).json({ erro: "Modelo não encontrado" });
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
    res.json({ aceito: !precisaAceitar, versao_atual: VERSAO_TERMOS_ATUAL, versao_aceite: termos_versao || null, aceite_em: aceite?.aceite_em || null });
  } catch (err) {
    console.error("Erro ao verificar aceite de termos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// POST /api/modelo/aceite-termos
router.post("/aceite-termos", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { aceite_maioridade, aceite_conteudo, aceite_tributario, aceite_independente, aceite_financeiro, user_agent: uaFromBody } = req.body;
    const todos = [aceite_maioridade, aceite_conteudo, aceite_tributario, aceite_independente, aceite_financeiro];
    if (todos.some(v => v !== true && v !== "true")) {
      return res.status(400).json({ erro: "Todas as declarações são obrigatórias" });
    }
    const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || null;
    const ua = uaFromBody || req.headers["user-agent"] || null;
    const modeloRes = await db.query("SELECT id FROM modelos WHERE user_id = $1", [userId]);
    if (!modeloRes.rowCount) return res.status(404).json({ erro: "Modelo não encontrado" });
    const modeloId = modeloRes.rows[0].id;

    await db.query(`
      INSERT INTO modelo_aceite_termos (modelo_id, versao, aceite_maioridade, aceite_conteudo, aceite_tributario, aceite_independente, aceite_financeiro, aceite_ip, aceite_user_agent, aceite_em)
      VALUES ($1,$2,true,true,true,true,true,$3,$4,NOW())
      ON CONFLICT (modelo_id, versao) DO UPDATE SET
        aceite_maioridade=true, aceite_conteudo=true, aceite_tributario=true,
        aceite_independente=true, aceite_financeiro=true,
        aceite_ip=EXCLUDED.aceite_ip, aceite_user_agent=EXCLUDED.aceite_user_agent, aceite_em=NOW()
    `, [modeloId, VERSAO_TERMOS_ATUAL, ip, ua]);

    await db.query("UPDATE modelos SET termos_aceites = true, termos_versao = $1 WHERE id = $2", [VERSAO_TERMOS_ATUAL, modeloId]);
    res.json({ ok: true, versao: VERSAO_TERMOS_ATUAL, aceite_em: new Date().toISOString() });
  } catch (err) {
    console.error("Erro ao registar aceite de termos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// POST /api/modelo/dados
router.post("/dados", auth, authModelo, async (req, res) => {
  try {
    let { nome_exibicao, nome_completo, data_nascimento, telefone, endereco, pais, instagram, tiktok } = req.body;
    instagram = instagram?.replace("@", "").trim() || null;
    tiktok = tiktok?.replace("@", "").trim() || null;
    if (!nome_exibicao || !nome_completo || !data_nascimento || !telefone || !endereco || !pais) {
      return res.status(400).json({ error: "Dados obrigatórios em falta" });
    }
    const modeloRes = await db.query(
      `SELECT id FROM modelos WHERE user_id = $1 AND ativo = true LIMIT 1`, [req.user.id]
    );
    if (modeloRes.rowCount === 0) return res.status(404).json({ error: "Modelo não encontrado ou desativado" });
    const modelo_id = modeloRes.rows[0].id;

    await db.query(
      `INSERT INTO modelos_dados (modelo_id, nome_exibicao, nome_completo, data_nascimento, telefone, endereco, pais, instagram, tiktok, ativo, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW(),NOW())
       ON CONFLICT (modelo_id) DO UPDATE SET
         nome_exibicao=EXCLUDED.nome_exibicao, nome_completo=EXCLUDED.nome_completo,
         data_nascimento=EXCLUDED.data_nascimento, telefone=EXCLUDED.telefone,
         endereco=EXCLUDED.endereco, pais=EXCLUDED.pais,
         instagram=EXCLUDED.instagram, tiktok=EXCLUDED.tiktok,
         ativo=true, desativado_em=NULL, atualizado_em=NOW()`,
      [modelo_id, nome_exibicao, nome_completo, data_nascimento, telefone, endereco, pais, instagram, tiktok]
    );
    await db.query(`UPDATE modelos SET nome_exibicao = $1 WHERE id = $2 AND ativo = true`, [nome_exibicao, modelo_id]);
    return res.json({ success: true });
  } catch (err) {
    console.error("Erro salvar dados modelo:", err);
    return res.status(500).json({ error: "Erro interno" });
  }
});

// GET /modelo/relatorio
router.get("/relatorio", authModelo, (req, res) => {
  res.sendFile(path.join(process.cwd(), "admin-pages", "relatorio.html"));
});

module.exports = router;
