// ========================================
// AGENCY DASHBOARD — API ROUTES
// ========================================

const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const authAgencia = require("../middleware/authAgencia");
const bcrypt = require("bcrypt");
const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const upload = multer({ storage: multer.memoryStorage() });
const jwt = require("jsonwebtoken");

const s3Privado = new AWS.S3({
  endpoint: new AWS.Endpoint(process.env.R2_ENDPOINT),
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: "auto",
  signatureVersion: "v4",
  s3ForcePathStyle: true
});

const s3Publico = new AWS.S3({
  endpoint: new AWS.Endpoint(process.env.R2_ENDPOINT),
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: "auto",
  signatureVersion: "v4",
  s3ForcePathStyle: true
});

const uploadPublico = multer({
  storage: multerS3({
    s3: s3Publico,
    bucket: process.env.R2_BUCKET,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = file.originalname.split(".").pop();
      const nome = `uploads/${req.user.id}/${Date.now()}-${file.fieldname}.${ext}`;
      cb(null, nome);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

const uploadPrivado = multer({
  storage: multerS3({
    s3: s3Privado,
    bucket: process.env.R2_BUCKET_PRIVATE,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = file.originalname.split(".").pop();
      const nome = `privado/${req.user.id}/${Date.now()}-${file.fieldname}.${ext}`;
      cb(null, nome);
    }
  }),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

// All routes require agency auth
router.use(auth, authAgencia);

// ========== HELPERS ==========

function parseMes(mesStr) {
  if (!mesStr) return null;
  const [ano, mes] = mesStr.split("-");
  if (!ano || !mes) return null;
  return { ano: Number(ano), mes: Number(mes) };
}

function paginate(query, defaultPage = 1, defaultLimit = 20) {
  let page = parseInt(query.page, 10);
  let limit = parseInt(query.limit, 10);

  if (!Number.isFinite(page) || page < 1) page = defaultPage;
  if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;

  limit = Math.min(limit, 100);

  const offset = (page - 1) * limit;

  return { limit, offset, page };
}

function assinarArquivoPrivado(key) {
  if (!key) return null;

  return s3Privado.getSignedUrl("getObject", {
    Bucket: process.env.R2_BUCKET_PRIVATE,
    Key: key,
    Expires: 60 * 10
  });
}

// ========== 1. OVERVIEW ==========

router.get("/name-agency", authAgencia, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, nome FROM agencias WHERE id = $1",
      [req.user.id]
    );

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/overview", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;

    const [modelos, vips, fatd, fatm, fat12m, acessos, top] = await Promise.all([

      // MODELOS (pode manter direto)
      db.query(`
        SELECT COUNT(*) AS total
        FROM modelos
        WHERE ativo = true
          AND verificada = true
          AND agencia_id = $1
      `, [agenciaId]),

      // VIPS (via view)
      db.query(`
        SELECT COUNT(*) AS total
        FROM vw_vips_agencia
        WHERE ativo = true
          AND agencia_id = $1
      `, [agenciaId]),

      // FATURAMENTO DIA (via view)
      db.query(`
        SELECT COALESCE(SUM(agency_fee), 0) AS total
        FROM vw_transacoes_agencia
        WHERE agencia_id = $1
          AND created_at >= date_trunc('day', NOW())
          AND created_at < date_trunc('day', NOW()) + INTERVAL '1 day'
          AND COALESCE(status, 'pago') NOT IN ('falhou','cancelado','estornado','chargeback')
      `, [agenciaId]),

      // FATURAMENTO MÊS (via view)
      db.query(`
        SELECT COALESCE(SUM(agency_fee), 0) AS total
        FROM vw_transacoes_agencia
        WHERE agencia_id = $1
          AND created_at >= date_trunc('month', NOW())
          AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
          AND COALESCE(status, 'pago') NOT IN ('falhou','cancelado','estornado','chargeback')
      `, [agenciaId]),

      // FATURAMENTO 12 MESES (via view — versão correta)
      db.query(`
        SELECT
          TO_CHAR(meses.mes, 'YYYY-MM') AS mes,
          COALESCE(SUM(t.agency_fee), 0) AS total
        FROM generate_series(
          date_trunc('month', NOW()) - INTERVAL '11 months',
          date_trunc('month', NOW()),
          INTERVAL '1 month'
        ) AS meses(mes)

        LEFT JOIN (
          SELECT *
          FROM vw_transacoes_agencia
          WHERE agencia_id = $1
            AND COALESCE(status, 'pago') NOT IN ('falhou','cancelado','estornado','chargeback')
        ) t
          ON date_trunc('month', t.created_at) = meses.mes

        GROUP BY meses.mes
        ORDER BY meses.mes ASC
      `, [agenciaId]),

      // ACESSOS (via view)
      db.query(`
        SELECT
          CASE
            WHEN LOWER(origem_trafego) LIKE '%instagram%'
              OR LOWER(origem_trafego) LIKE '%insta%'
              OR LOWER(origem_trafego) LIKE '%src=instagram%' THEN 'Instagram'
            WHEN LOWER(origem_trafego) LIKE '%tiktok%'
              OR LOWER(origem_trafego) LIKE '%src=tiktok%' THEN 'TikTok'
            WHEN LOWER(origem_trafego) IN ('direto','direct','none','unknown','(direct)','(none)') THEN 'Direto'
            ELSE 'Outros'
          END AS origem,
          COUNT(*) AS total
        FROM vw_acessos_agencia
        WHERE agencia_id = $1
          AND created_at >= date_trunc('month', NOW())
          AND created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
          AND origem_trafego IS NOT NULL
        GROUP BY
          CASE
            WHEN LOWER(origem_trafego) LIKE '%instagram%'
              OR LOWER(origem_trafego) LIKE '%insta%'
              OR LOWER(origem_trafego) LIKE '%src=instagram%' THEN 'Instagram'
            WHEN LOWER(origem_trafego) LIKE '%tiktok%'
              OR LOWER(origem_trafego) LIKE '%src=tiktok%' THEN 'TikTok'
            WHEN LOWER(origem_trafego) IN ('direto','direct','none','unknown','(direct)','(none)') THEN 'Direto'
            ELSE 'Outros'
          END
        ORDER BY total DESC
      `, [agenciaId]),

      db.query(`
        SELECT
          t.modelo_id,
          COALESCE(m.nome_exibicao, m.nome) AS nome,
          ROUND(COALESCE(SUM(t.valor_modelo), 0)::numeric, 2) AS ganhos,
          ROUND(COALESCE(SUM(t.agency_fee), 0)::numeric, 2) AS ganhos_agencia,
          MAX(t.created_at) AS atualizado_em,
          (
            SELECT COUNT(*)
            FROM vw_vips_agencia v
            WHERE v.modelo_id = t.modelo_id
              AND v.ativo = true
              AND v.agencia_id = $1
          ) AS assinantes
        FROM vw_transacoes_agencia t
        JOIN modelos m ON m.id = t.modelo_id
        WHERE t.agencia_id = $1
          AND t.created_at >= date_trunc('month', NOW())
          AND t.created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
          AND COALESCE(t.status, 'pago') NOT IN ('falhou','cancelado','estornado','chargeback')
        GROUP BY t.modelo_id, m.nome_exibicao, m.nome
        ORDER BY ganhos DESC, atualizado_em DESC
        LIMIT 5
      `, [agenciaId])

    ]);

    res.json({
      total_modelos: Number(modelos.rows[0]?.total || 0),
      vips_ativos: Number(vips.rows[0]?.total || 0),
      faturamento_dia: Number(fatd.rows[0]?.total || 0),
      faturamento_mes: Number(fatm.rows[0]?.total || 0),
      faturamento_12m: (fat12m.rows || []).map(r => ({
        mes: r.mes,
        total: Number(r.total || 0)
      })),
      acessos_origem: (acessos.rows || []).map(r => ({
        origem: r.origem,
        total: Number(r.total || 0)
      })),
      top_modelos: (top.rows || []).map(r => ({
        modelo_id: r.modelo_id,
        nome: r.nome,
        ganhos: Number(r.ganhos || 0),
        ganhos_agencia: Number(r.ganhos_agencia || 0),
        assinantes: Number(r.assinantes || 0)
      }))
    });

  } catch (err) {
    console.error("Erro overview:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 2. TRAFEGO ==========

router.get("/acessos-origem", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    const mes = req.query.mes;

    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: "Parâmetro 'mes' inválido. Use YYYY-MM" });
    }

    const inicio = `${mes}-01`;
    const fim = new Date(inicio);
    fim.setMonth(fim.getMonth() + 1);

    const params = [inicio, fim, agenciaId];

    // 🔹 TOTAL
    const totalRes = await db.query(`
      SELECT
        COUNT(*)::int AS total,

        COUNT(*) FILTER (
          WHERE LOWER(origem_trafego) LIKE '%instagram%'
             OR LOWER(origem_trafego) LIKE '%insta%'
             OR LOWER(origem_trafego) LIKE '%src=instagram%'
        )::int AS instagram,

        COUNT(*) FILTER (
          WHERE LOWER(origem_trafego) LIKE '%tiktok%'
             OR LOWER(origem_trafego) LIKE '%src=tiktok%'
        )::int AS tiktok,

        COUNT(*) FILTER (
          WHERE LOWER(origem_trafego) IN ('direto','direct','none','unknown')
        )::int AS direto

      FROM vw_acessos_agencia
      WHERE agencia_id = $3
        AND created_at >= $1
        AND created_at < $2
        AND origem_trafego IS NOT NULL
        AND origem_trafego != ''
    `, params);

    // 🔹 DIÁRIO
    const diarioRes = await db.query(`
      SELECT
        TO_CHAR(created_at::date, 'DD/MM') AS dia,

        COUNT(*) FILTER (
          WHERE LOWER(origem_trafego) LIKE '%instagram%'
             OR LOWER(origem_trafego) LIKE '%insta%'
             OR LOWER(origem_trafego) LIKE '%src=instagram%'
        )::int AS instagram,

        COUNT(*) FILTER (
          WHERE LOWER(origem_trafego) LIKE '%tiktok%'
             OR LOWER(origem_trafego) LIKE '%src=tiktok%'
        )::int AS tiktok,

        COUNT(*) FILTER (
          WHERE LOWER(origem_trafego) IN ('direto','direct','none','unknown')
        )::int AS direto

      FROM vw_acessos_agencia
      WHERE agencia_id = $3
        AND created_at >= $1
        AND created_at < $2
        AND origem_trafego IS NOT NULL
        AND origem_trafego != ''
      GROUP BY created_at::date
      ORDER BY created_at::date ASC
    `, params);

    // 🔹 TOP MODELOS
    const topModelosRes = await db.query(`
      SELECT
        ref_modelo AS modelo_id,
        COALESCE(nome_exibicao, nome, 'Modelo #' || ref_modelo) AS nome,

        COUNT(*) FILTER (
          WHERE LOWER(origem_trafego) LIKE '%instagram%'
             OR LOWER(origem_trafego) LIKE '%insta%'
             OR LOWER(origem_trafego) LIKE '%src=instagram%'
        )::int AS instagram,

        COUNT(*) FILTER (
          WHERE LOWER(origem_trafego) LIKE '%tiktok%'
             OR LOWER(origem_trafego) LIKE '%src=tiktok%'
        )::int AS tiktok,

        COUNT(*) FILTER (
          WHERE LOWER(origem_trafego) IN ('direto','direct','none','unknown')
        )::int AS direto,

        COUNT(*)::int AS total

      FROM vw_acessos_agencia
      WHERE agencia_id = $3
        AND created_at >= $1
        AND created_at < $2
        AND ref_modelo IS NOT NULL
        AND origem_trafego IS NOT NULL
        AND origem_trafego != ''
      GROUP BY ref_modelo, nome_exibicao, nome
      ORDER BY total DESC
      LIMIT 20
    `, params);

    const totais = totalRes.rows[0] || {};

    res.json({
      total: Number(totais.total || 0),
      instagram: Number(totais.instagram || 0),
      tiktok: Number(totais.tiktok || 0),
      direto: Number(totais.direto || 0),
      distribuicao: true,

      diario: (diarioRes.rows || []).map(r => ({
        dia: r.dia,
        instagram: Number(r.instagram || 0),
        tiktok: Number(r.tiktok || 0),
        direto: Number(r.direto || 0)
      })),

      top_modelos: (topModelosRes.rows || []).map(r => ({
        modelo_id: r.modelo_id,
        nome: r.nome,
        instagram: Number(r.instagram || 0),
        tiktok: Number(r.tiktok || 0),
        direto: Number(r.direto || 0),
        total: Number(r.total || 0)
      }))
    });

  } catch (err) {
    console.error("Erro /agency/dashboard/acessos:", err);
    res.status(500).json({ error: "Erro ao carregar acessos" });
  }
});

// ========== 3. agency ==========

router.get("/agency", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia?.id;
    if (!agenciaId) return res.status(400).json({ erro: "Agência ID não fornecido" });

    const { rows } = await db.query(`
      SELECT id, email, nome, percentual_agencia, percentual_modelo, percentual_plataforma, created_at
      FROM agencias
      WHERE id = $1
      LIMIT 1
    `, [agenciaId]);

    if (!rows.length) return res.status(404).json({ erro: "Agência não encontrada" });

    res.json([rows[0]]);
  } catch (err) {
    console.error("Erro GET agency:", err);
    res.status(500).json({ erro: "Erro interno", message: err.message });
  }
});

router.put("/agency/reset-password", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    const { senha } = req.body;

    if (!senha || senha.length < 6) {
      return res.status(400).json({ erro: "Senha inválida (mínimo 6 caracteres)" });
    }

    const hash = await bcrypt.hash(senha, 10);

    await db.query(`
      UPDATE agencias SET senha = $1 WHERE id = $2
    `, [hash, agenciaId]);

    await db.query(`
      INSERT INTO admin_seguranca_historico (user_id, tipo_user, acao, motivo, data)
      VALUES ($1, 'agencia', 'reset_senha_agencia', $2, NOW())
    `, [agenciaId, `Agência #${agenciaId} redefiniu a própria senha`]);

    res.json({ ok: true });
  } catch (err) {
    console.error("Erro reset senha:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.put("/agency/percentuais", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    const { percentual_agencia, percentual_modelo } = req.body;

    // valores vindos do frontend (em %)
    const ag = Number(percentual_agencia);
    const mod = Number(percentual_modelo);

    // plataforma fixa (20%)
    const pPlat = 0.2;

    // validação básica
    if (isNaN(ag) || ag < 0 || ag > 80) {
      return res.status(400).json({ erro: "Percentual da agência inválido (0–80%)" });
    }

    if (isNaN(mod) || mod < 0 || mod > 80) {
      return res.status(400).json({ erro: "Percentual do modelo inválido (0–80%)" });
    }

    // validação em % (mais intuitivo)
    if (ag + mod > 80) {
      return res.status(400).json({
        erro: `A soma não pode ultrapassar 100%. Velvet: 20% + Agência: ${ag}% + Modelo: ${mod}% = ${20 + ag + mod}%`
      });
    }

    // conversão para decimal (para salvar no banco)
    const pAg = ag / 100;
    const pMod = mod / 100;

    const antes = await db.query(
      `SELECT percentual_agencia, percentual_modelo FROM agencias WHERE id = $1`,
      [agenciaId]
    );

    await db.query(`
      UPDATE agencias
      SET percentual_agencia = $1, percentual_modelo = $2
      WHERE id = $3
    `, [pAg, pMod, agenciaId]);

    const ant = antes.rows[0];

    await db.query(`
      INSERT INTO admin_seguranca_historico (user_id, tipo_user, acao, motivo, data)
      VALUES ($1, 'agencia', 'alteracao_percentual', $2, NOW())
    `, [
      agenciaId,
      `Agência #${agenciaId} alterou percentuais. Antes: agência=${(ant.percentual_agencia * 100).toFixed(2)}% modelo=${(ant.percentual_modelo * 100).toFixed(2)}%. Depois: agência=${ag}% modelo=${mod}%`
    ]);

    res.json({
      ok: true,
      percentual_agencia: pAg,
      percentual_modelo: pMod
    });

  } catch (err) {
    console.error("Erro percentuais:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 8. FECHAMENTO ==========

router.get("/fechamentos-agency", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;

    const { rows } = await db.query(
      `SELECT * FROM fechamento_mensal_agency 
       WHERE agencia_id = $1 
       ORDER BY ano DESC, mes DESC`,
      [agenciaId]
    );

    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar fechamentos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 9. DADOS BANCÁRIOS ==========

router.get("/dados-bancarios", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    const { limit, offset, page } = paginate(req.query);

    const status = req.query.status;

    let where = "m.agencia_id = $1";
    const params = [agenciaId];

    if (status) {
      where += " AND b.status = $2";
      params.push(status);
    }

    // COUNT
    const countQ = await db.query(`
      SELECT COUNT(*) 
      FROM modelo_dados_bancarios b
      JOIN modelos m ON m.id = b.modelo_id
      WHERE ${where}
    `, params);

    const total = Number(countQ.rows[0].count);

    // DATA
    const dataParams = [...params, limit, offset];

    const { rows } = await db.query(`
      SELECT b.*, m.nome AS modelo_nome
      FROM modelo_dados_bancarios b
      JOIN modelos m ON m.id = b.modelo_id
      WHERE ${where}
      ORDER BY 
        CASE WHEN b.status = 'pendente' THEN 0 ELSE 1 END,
        b.criado_em DESC
      LIMIT $${params.length + 1}
      OFFSET $${params.length + 2}
    `, dataParams);

    res.json({
      rows,
      totalPages: Math.ceil(total / limit),
      page
    });

  } catch (err) {
    console.error("Erro ao buscar dados bancários:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/dados-bancarios/:id", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    
    const { rows } = await db.query(`
      SELECT b.*, m.nome AS modelo_nome
      FROM modelo_dados_bancarios b
      JOIN modelos m ON m.id = b.modelo_id
      WHERE b.id = $1 AND m.agencia_id = $2
    `, [req.params.id, agenciaId]);
    
    if (!rows.length) {
      return res.status(404).json({ erro: "Não encontrado" });
    }
    
    res.json(rows[0]);
  } catch (err) { 
    console.error("Erro ao buscar dado bancário:", err);
    res.status(500).json({ erro: "Erro interno" }); 
  }
});

router.put("/dados-bancarios/:id", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    
    // Verifica se o registro pertence à agência logada
    const beforeQ = await db.query(`
      SELECT b.* 
      FROM modelo_dados_bancarios b
      JOIN modelos m ON m.id = b.modelo_id
      WHERE b.id = $1 AND m.agencia_id = $2
      LIMIT 1
    `, [req.params.id, agenciaId]);

    if (!beforeQ.rows.length) {
      return res.status(404).json({ erro: "Registro bancário não encontrado" });
    }

    const anterior = beforeQ.rows[0];
    const fields = req.body;
    const sets = [];
    const vals = [];
    let i = 1;

    for (const [key, val] of Object.entries(fields)) {
      if (["id", "modelo_id", "criado_em", "aprovado_em", "atualizado_em"].includes(key)) continue;
      sets.push(`${key} = $${i}`);
      vals.push(val);
      i++;
    }

    if (!sets.length) {
      return res.status(400).json({ erro: "Nenhum campo válido para atualizar" });
    }

    if (fields.status === "aprovado" && anterior.status !== "aprovado") {
      sets.push(`aprovado_em = NOW()`);
    }

    sets.push(`atualizado_em = NOW()`);
    vals.push(req.params.id);

    const { rows } = await db.query(`
      UPDATE modelo_dados_bancarios
      SET ${sets.join(", ")}
      WHERE id = $${i}
      RETURNING *
    `, vals);

    const atualizado = rows[0];

    let acao = "atualizacao_dados_bancarios";
    let motivo = `Dados bancários atualizados pelo agency. Status anterior: ${anterior.status || "null"}; novo status: ${atualizado.status || "null"}.`;

    if (anterior.status !== atualizado.status && atualizado.status === "aprovado") {
      acao = "aprovacao_dados_bancarios";
      motivo = `Dados bancários aprovados pelo agency. Status anterior: ${anterior.status || "null"}; novo status: aprovado.`;
    } else if (anterior.status !== atualizado.status && atualizado.status === "rejeitado") {
      acao = "rejeicao_dados_bancarios";
      motivo = `Dados bancários rejeitados pelo agency. Status anterior: ${anterior.status || "null"}; novo status: rejeitado.`;
    }

    await db.query(`
      INSERT INTO agency_seguranca_historico
        (user_id, tipo_user, acao, motivo, data, agency_id)
      VALUES
        ($1, $2, $3, $4, NOW(), $5)
    `, [
      atualizado.modelo_id,
      "modelo",
      acao,
      motivo,
      agenciaId
    ]);

    res.json(atualizado);
  } catch (err) {
    console.error("Erro atualizar bancário:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 10. MODELOS ==========

router.get("/modelos-lista", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    
    const { rows } = await db.query(`
      SELECT id, nome 
      FROM modelos 
      WHERE ativo = true 
        AND verificada = true 
        AND agencia_id = $1
      ORDER BY nome
    `, [agenciaId]);
    
    res.json(rows);
  } catch (err) { 
    console.error("Erro ao listar modelos:", err);
    res.status(500).json({ erro: "Erro interno" }); 
  }
});

router.get("/modelos", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    const { limit, offset, page } = paginate(
      req.query,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );

    const busca = req.query.busca || "";
    const params = [agenciaId];
    let where = "m.ativo = true AND m.verificada = true AND m.agencia_id = $1";

    if (busca) {
      params.push(`%${busca}%`);
      params.push(`%${busca}%`);
      params.push(busca);
      where += ` AND (m.nome ILIKE $2 OR u.email ILIKE $3 OR m.id::text = $4)`;
    }

    const countQ = await db.query(`
      SELECT COUNT(*) AS count
      FROM modelos m
      LEFT JOIN users u ON u.id = m.user_id
      WHERE ${where}
    `, params);

    const total = Number(countQ.rows[0]?.count || 0);

    params.push(limit, offset);

    const { rows } = await db.query(`
      SELECT
        m.id,
        m.user_id,
        m.nome,
        m.nome_exibicao,
        m.verificada,
        m.local,
        m.bio,
        m.feed,
        m.agencia_id,
        m.ativo,
        m.created_at,
        m.atualizado_em,
        m.desativado_em,
        u.email,
        ag.nome AS agencia_nome
      FROM modelos m
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN agencias ag ON ag.id = m.agencia_id
      WHERE ${where}
      ORDER BY m.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      rows,
      totalPages: Math.ceil(total / limit),
      page
    });
  } catch (err) {
    console.error("Erro modelos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/agencias", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    
    // Retorna apenas a própria agência
    const { rows } = await db.query(`
      SELECT id, nome
      FROM agencias
      WHERE id = $1
    `, [agenciaId]);

    res.json(rows);
  } catch (err) {
    console.error("Erro listar agências:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/modelos/:id", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    
    const { rows } = await db.query(`
      SELECT * 
      FROM modelos 
      WHERE id = $1 AND agencia_id = $2
    `, [req.params.id, agenciaId]);
    
    if (!rows.length) {
      return res.status(404).json({ erro: "Não encontrado" });
    }
    
    res.json(rows[0]);
  } catch (err) { 
    console.error("Erro ao buscar modelo:", err);
    res.status(500).json({ erro: "Erro interno" }); 
  }
});

router.put("/modelos/:id", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    const modeloId = req.params.id;
    const fields = req.body;
    const sets = [];
    const vals = [];
    let i = 1;

    const allowed = [
      "nome",
      "nome_exibicao",
      "verificada",
      "feed",
      "bio",
      "local",
      "ativo"
    ];

    // Verifica se o modelo pertence à agência logada
    const antesQ = await db.query(`
      SELECT id, nome, ativo, feed, bio, verificada, agencia_id
      FROM modelos
      WHERE id = $1 AND agencia_id = $2
    `, [modeloId, agenciaId]);

    if (!antesQ.rows.length) {
      return res.status(404).json({ erro: "Modelo não encontrado" });
    }

    const antes = antesQ.rows[0];

    // Não permite alterar agencia_id
    for (const [key, val] of Object.entries(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = $${i}`);
      vals.push(val === "" ? null : val);
      i++;
    }

    if (!sets.length) {
      return res.status(400).json({ erro: "Nenhum campo para atualizar" });
    }

    if (Object.prototype.hasOwnProperty.call(fields, "ativo")) {
      if (fields.ativo === false || fields.ativo === "false") {
        sets.push(`desativado_em = NOW()`);
      } else if (fields.ativo === true || fields.ativo === "true") {
        sets.push(`desativado_em = NULL`);
      }
    }

    sets.push(`atualizado_em = NOW()`);
    vals.push(modeloId);

    const { rows } = await db.query(`
      UPDATE modelos
      SET ${sets.join(", ")}
      WHERE id = $${i}
      RETURNING *
    `, vals);

    const depois = rows[0];

    // log de desativação / reativação
    if (String(antes.ativo) !== String(depois.ativo)) {
      await db.query(`
        INSERT INTO agency_seguranca_historico
          (user_id, tipo_user, acao, motivo, data, agency_id)
        VALUES
          ($1, 'modelo', $2, $3, NOW(), $4)
      `, [
        modeloId,
        (depois.ativo === false ? "desativacao_modelo" : "reativacao_modelo"),
        `Modelo ${depois.nome || "#" + modeloId} teve status alterado para ativo=${depois.ativo}`,
        agenciaId
      ]);
    }

    res.json(depois);
  } catch (err) {
    console.error("Erro atualizar modelo:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/modelos-dados/:id", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    
    // Verifica se o modelo pertence à agência
    const { rows } = await db.query(`
      SELECT md.* 
      FROM modelos_dados md
      JOIN modelos m ON m.id = md.modelo_id
      WHERE md.modelo_id = $1 AND m.agencia_id = $2
    `, [req.params.id, agenciaId]);
    
    if (!rows.length) {
      return res.status(404).json({ erro: "Não encontrado" });
    }
    
    res.json(rows[0]);
  } catch (err) { 
    console.error("Erro ao buscar dados do modelo:", err);
    res.status(500).json({ erro: "Erro interno" }); 
  }
});

router.put("/modelos-dados/:id", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    const modeloId = req.params.id;
    const fields = req.body;
    const sets = [];
    const vals = [];
    let i = 1;

    const allowed = [
      "nome_completo",
      "data_nascimento",
      "telefone",
      "endereco",
      "pais",
      "estado",
      "cidade",
      "instagram",
      "tiktok",
      "vip_preco"
    ];

    // Verifica se o modelo pertence à agência logada
    const antesQ = await db.query(`
      SELECT md.modelo_id, md.vip_preco
      FROM modelos_dados md
      JOIN modelos m ON m.id = md.modelo_id
      WHERE md.modelo_id = $1 AND m.agencia_id = $2
    `, [modeloId, agenciaId]);

    if (!antesQ.rows.length) {
      return res.status(404).json({ erro: "Dados do modelo não encontrados" });
    }

    const antes = antesQ.rows[0];

    for (const [key, val] of Object.entries(fields)) {
      if (!allowed.includes(key)) continue;
      sets.push(`${key} = $${i}`);
      vals.push(val === "" ? null : val);
      i++;
    }

    if (!sets.length) {
      return res.status(400).json({ erro: "Nenhum campo para atualizar" });
    }

    sets.push(`atualizado_em = NOW()`);
    vals.push(modeloId);

    const { rows } = await db.query(`
      UPDATE modelos_dados
      SET ${sets.join(", ")}
      WHERE modelo_id = $${i}
      RETURNING *
    `, vals);

    const depois = rows[0];

    if (
      Object.prototype.hasOwnProperty.call(fields, "vip_preco") &&
      String(antes.vip_preco) !== String(depois.vip_preco)
    ) {
      await db.query(`
        INSERT INTO agency_seguranca_historico
          (user_id, tipo_user, acao, motivo, data, agency_id)
        VALUES
          ($1, 'modelo', 'alteracao_vip_preco', $2, NOW(), $3)
      `, [
        modeloId,
        `VIP alterado de ${antes.vip_preco ?? "null"} para ${depois.vip_preco ?? "null"}`,
        agenciaId
      ]);
    }

    res.json(depois);
  } catch (err) {
    console.error("Erro atualizar modelos_dados:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 11. RANKING ==========

router.get("/ranking", authAgencia, async (req, res) => {
  try {
    const agenciaId = req.agencia.id;
    const mes = String(req.query.mes || '').trim(); // YYYY-MM
    const params = [agenciaId];
    let whereMes = `
      t.created_at >= date_trunc('month', NOW())
      AND t.created_at < (date_trunc('month', NOW()) + INTERVAL '1 month')
    `;

    if (mes) {
      const match = mes.match(/^(\d{4})-(\d{2})$/);
      if (!match) {
        return res.status(400).json({ erro: "Parâmetro mes inválido. Use YYYY-MM" });
      }

      params.push(`${mes}-01`);
      whereMes = `
        t.created_at >= $2::date
        AND t.created_at < ($2::date + INTERVAL '1 month')
      `;
    }

    const { rows } = await db.query(`
      SELECT
        t.modelo_id,
        m.nome,
        ROUND(COALESCE(SUM(t.valor_modelo), 0)::numeric, 2) AS ganhos_total,
        ROUND(COALESCE(SUM(t.agency_fee), 0)::numeric, 2) AS ganhos_agencia,
        MAX(t.created_at) AS atualizado_em
      FROM transacoes_agency t
      JOIN modelos m ON m.id = t.modelo_id
      WHERE t.modelo_id IS NOT NULL
        AND m.agencia_id = $1
        AND ${whereMes}
        AND COALESCE(t.status, 'pago') NOT IN ('falhou', 'cancelado', 'estornado', 'chargeback')
      GROUP BY t.modelo_id, m.nome
      ORDER BY ganhos_total DESC, atualizado_em DESC
      LIMIT 50
    `, params);

    res.json(rows);
  } catch (err) {
    console.error("Erro ranking:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 16. agencias PAGAMENTOS ==========

// SALDO
router.get("/agencia-pagamentos/saldo", authAgencia, async (req, res) => {
  try {
    const agenciaId = Number(req.agencia?.id);
    if (!agenciaId) {
      return res.status(400).json({ erro: "Agência inválida" });
    }

    const ganhosRes = await db.query(`
      SELECT COALESCE(SUM(agency_fee), 0) AS ganhos
      FROM vw_transacoes_agencia t
      JOIN modelos m ON m.id = t.modelo_id
      WHERE m.agencia_id = $1::int
        AND t.status = 'pago'
    `, [agenciaId]);

    const pagosRes = await db.query(`
      SELECT COALESCE(SUM(total_agencia), 0) AS pagos
      FROM agencia_pagamentos
      WHERE agencia_id = $1::int
        AND status = 'pago'
    `, [agenciaId]);

    const ganhos = Number(ganhosRes.rows[0].ganhos || 0);
    const pagos = Number(pagosRes.rows[0].pagos || 0);

    res.json({
      ganhos,
      pagos,
      saldo: ganhos - pagos
    });

  } catch (err) {
    console.error("Erro saldo agencia-pagamentos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});


// LISTAGEM
router.get("/agencia-pagamentos", authAgencia, async (req, res) => {
  try {
    const agenciaId = Number(req.agencia?.id);
    if (!agenciaId) {
      return res.status(400).json({ erro: "Agência inválida" });
    }

    const { limit, offset, page } = paginate(req.query);

    const countQ = await db.query(`
      SELECT COUNT(*) 
      FROM agencia_pagamentos
      WHERE agencia_id = $1::int
    `, [agenciaId]);

    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(`
      SELECT 
        p.*,
        a.nome AS agencia_nome
      FROM agencia_pagamentos p
      JOIN agencias a ON a.id = p.agencia_id
      WHERE p.agencia_id = $1::int
      ORDER BY p.created_at DESC
      LIMIT $2 OFFSET $3
    `, [agenciaId, limit, offset]);

    for (const row of rows) {
      row.recibo_signed_url = row.recibo_url
        ? s3Privado.getSignedUrl("getObject", {
            Bucket: process.env.R2_BUCKET_PRIVATE,
            Key: row.recibo_url,
            Expires: 300
          })
        : null;
    }

    res.json({
      rows,
      totalPages: Math.ceil(total / limit),
      page
    });

  } catch (err) {
    console.error("Erro agencia-pagamentos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});


// DETALHE
router.get("/agencia-pagamentos/:id", authAgencia, async (req, res) => {
  try {
    const agenciaId = Number(req.agencia?.id);
    const id = Number(req.params.id);

    const { rows } = await db.query(`
      SELECT p.*, a.nome AS agencia_nome
      FROM agencia_pagamentos p
      JOIN agencias a ON a.id = p.agencia_id
      WHERE p.id = $1::int AND p.agencia_id = $2::int
    `, [id, agenciaId]);

    if (!rows.length) {
      return res.status(404).json({ erro: "Não encontrado" });
    }

    const row = rows[0];

    row.recibo_signed_url = row.recibo_url
      ? s3Privado.getSignedUrl("getObject", {
          Bucket: process.env.R2_BUCKET_PRIVATE,
          Key: row.recibo_url,
          Expires: 300
        })
      : null;

    res.json(row);

  } catch (err) {
    console.error("Erro detalhe agencia-pagamentos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

module.exports = router;
