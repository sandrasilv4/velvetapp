// ========================================
// ADMIN DASHBOARD — API ROUTES
// ========================================

const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");
const authAdmin = require("../middleware/authAdmin");
const bcrypt = require("bcrypt");
const { enviarEmailAprovacao } = require("../email");
const { enviarEmailRejeicao } = require("../email");
const AWS = require('aws-sdk');
const multer = require('multer');
const multerS3 = require('multer-s3');
const upload = multer({ storage: multer.memoryStorage() });
const PDFDocument = require('pdfkit');
const { Resend: ResendPagamentos } = require('resend');
const _resendPagamentos = new ResendPagamentos(process.env.RESEND_API_KEY);

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


// Suporte a token via query param (necessário para iframes — o browser não envia headers)
router.use((req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  next();
});

// All routes require admin auth
router.use(auth, authAdmin);

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

router.get("/name-admin", authAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, nome FROM admin WHERE id = $1",
      [req.user.id]
    );

    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/overview", authAdmin, async (req, res) => {
  try {
    const [modelos, clientes, vips, fatd, fatm, fat12m, acessos, top] = await Promise.all([
      db.query(`
        SELECT COUNT(*) AS total
        FROM modelos
        WHERE ativo = true
          AND verificada = true
      `),

      db.query(`
        SELECT COUNT(*) AS total
        FROM clientes
        WHERE ativo = true
      `),

      db.query(`
        SELECT COUNT(*) AS total
        FROM vip_subscriptions
        WHERE ativo = true
      `),

      db.query(`
        SELECT COALESCE(SUM(t.velvet_fee), 0) AS total
        FROM transacoes_agency t
        WHERE t.created_at >= date_trunc('day', NOW())
          AND t.created_at < (date_trunc('day', NOW()) + INTERVAL '1 day')
          AND COALESCE(t.status, 'pago') NOT IN ('falhou', 'cancelado', 'estornado', 'chargeback')
      `),

      db.query(`
        SELECT COALESCE(SUM(t.taxa_gateway), 0) AS total
        FROM transacoes_agency t
        WHERE t.created_at >= date_trunc('day', NOW())
          AND t.created_at < (date_trunc('day', NOW()) + INTERVAL '1 day')
          AND COALESCE(t.status, 'pago') NOT IN ('falhou', 'cancelado', 'estornado', 'chargeback')
      `),

      db.query(`
        SELECT
          TO_CHAR(meses.mes, 'YYYY-MM') AS mes,
          COALESCE(SUM(t.velvet_fee), 0) AS total
        FROM generate_series(
          date_trunc('month', NOW()) - INTERVAL '11 months',
          date_trunc('month', NOW()),
          INTERVAL '1 month'
        ) AS meses(mes)
        LEFT JOIN transacoes_agency t
          ON date_trunc('month', t.created_at) = meses.mes
          AND COALESCE(t.status, 'pago') NOT IN ('falhou', 'cancelado', 'estornado', 'chargeback')
        GROUP BY meses.mes
        ORDER BY meses.mes ASC
      `),

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
FROM clientes
WHERE created_at >= date_trunc('month', NOW())
  AND created_at < (date_trunc('month', NOW()) + INTERVAL '1 month')
  AND origem_trafego IS NOT NULL
  AND origem_trafego != ''
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
ORDER BY total DESC;
      `),

      db.query(`
        SELECT
          t.modelo_id,
          m.nome,
          ROUND(COALESCE(SUM(t.valor_modelo), 0)::numeric, 2) AS ganhos,
          MAX(t.created_at) AS atualizado_em,
          (
            SELECT COUNT(*)
            FROM vip_subscriptions v
            WHERE v.modelo_id = t.modelo_id
              AND v.ativo = true
          ) AS assinantes
        FROM transacoes_agency t
        LEFT JOIN modelos m ON m.id = t.modelo_id
        WHERE t.modelo_id IS NOT NULL
          AND t.created_at >= date_trunc('month', NOW())
          AND t.created_at < (date_trunc('month', NOW()) + INTERVAL '1 month')
          AND COALESCE(t.status, 'pago') NOT IN ('falhou', 'cancelado', 'estornado', 'chargeback')
        GROUP BY t.modelo_id, m.nome
        ORDER BY ganhos DESC, atualizado_em DESC
        LIMIT 5
      `)
    ]);

    res.json({
      total_modelos: Number(modelos.rows[0]?.total || 0),
      total_clientes: Number(clientes.rows[0]?.total || 0),
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
        assinantes: Number(r.assinantes || 0)
      }))
    });
  } catch (err) {
    console.error("Erro overview:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 2. TRAFEGO ==========

// router.post("/acessos-origem", async (req, res) => {
//   try {
//     const {
//       modelo_id,
//       ref_modelo,
//       origem_trafego,
//       utm_source,
//       utm_medium,
//       utm_campaign,
//       utm_content,
//       utm_term,
//       referer,
//       landing_page,
//       current_url,
//       pagina
//     } = req.body;

//     const ip =
//       req.headers["cf-connecting-ip"] ||
//       req.headers["x-forwarded-for"]?.split(",")[0] ||
//       req.ip;

//     const userAgent = req.headers["user-agent"];

//     await db.query(
//       `
//       INSERT INTO acessos_origem (
//         user_id,
//         cliente_id,
//         modelo_id,
//         ref_modelo,
//         origem,
//         utm_source,
//         utm_medium,
//         utm_campaign,
//         utm_content,
//         utm_term,
//         referer,
//         landing_page,
//         current_url,
//         pagina,
//         ip,
//         user_agent,
//         created_at
//       )
//       VALUES (
//         $1,$2,$3,$4,$5,
//         $6,$7,$8,$9,$10,
//         $11,$12,$13,$14,$15,$16,NOW()
//       )
//       `,
//       [
//         req.user?.id || null,
//         req.user?.cliente_id || null,
//         modelo_id || ref_modelo || null,
//         ref_modelo || null,
//         origem_trafego || null,
//         utm_source || null,
//         utm_medium || null,
//         utm_campaign || null,
//         utm_content || null,
//         utm_term || null,
//         referer || null,
//         landing_page || null,
//         current_url || null,
//         pagina || null,
//         ip || null,
//         userAgent || null
//       ]
//     );

//     res.json({ ok: true });
//   } catch (err) {
//     console.error("Erro ao registrar origem:", err);
//     res.status(500).json({ error: "Erro ao registrar origem" });
//   }
// });

router.get("/acessos-origem", authAdmin, async (req, res) => {
  try {
    const mes = req.query.mes; // formato: YYYY-MM

    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
      return res.status(400).json({ error: "Parâmetro 'mes' inválido. Use YYYY-MM" });
    }

    const inicio = `${mes}-01`;
    const fim = new Date(inicio);
    fim.setMonth(fim.getMonth() + 1);

    const params = [inicio, fim];

    // 🔹 TOTAL
    const totalRes = await db.query(
      `
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

      FROM clientes
      WHERE created_at >= $1
        AND created_at < $2
        AND origem_trafego IS NOT NULL
        AND origem_trafego != ''
      `,
      params
    );

    // 🔹 DIÁRIO
    const diarioRes = await db.query(
      `
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

      FROM clientes
      WHERE created_at >= $1
        AND created_at < $2
        AND origem_trafego IS NOT NULL
        AND origem_trafego != ''
      GROUP BY created_at::date
      ORDER BY created_at::date ASC
      `,
      params
    );

    // 🔹 TOP MODELOS
    const topModelosRes = await db.query(
      `
      SELECT
        c.ref_modelo AS modelo_id,
        COALESCE(m.nome_exibicao, m.nome, 'Modelo #' || c.ref_modelo) AS nome,

        COUNT(*) FILTER (
          WHERE LOWER(c.origem_trafego) LIKE '%instagram%'
             OR LOWER(c.origem_trafego) LIKE '%insta%'
             OR LOWER(c.origem_trafego) LIKE '%src=instagram%'
        )::int AS instagram,

        COUNT(*) FILTER (
          WHERE LOWER(c.origem_trafego) LIKE '%tiktok%'
             OR LOWER(c.origem_trafego) LIKE '%src=tiktok%'
        )::int AS tiktok,

        COUNT(*) FILTER (
          WHERE LOWER(c.origem_trafego) IN ('direto','direct','none','unknown')
        )::int AS direto,

        COUNT(*)::int AS total

      FROM clientes c
      LEFT JOIN modelos m ON m.id = c.ref_modelo
      WHERE c.created_at >= $1
        AND c.created_at < $2
        AND c.ref_modelo IS NOT NULL
        AND c.origem_trafego IS NOT NULL
        AND c.origem_trafego != ''
      GROUP BY c.ref_modelo, m.nome_exibicao, m.nome
      ORDER BY total DESC
      LIMIT 20
      `,
      params
    );

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
    console.error("Erro /admin/dashboard/acessos:", err);
    res.status(500).json({ error: "Erro ao carregar acessos" });
  }
});

// ========== 3. ADMINS ==========

router.get("/admins", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT id, email, created_at FROM admin ORDER BY id");
    res.json(rows);
  } catch (err) {
    console.error("Erro admins:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.post("/admins", authAdmin, async (req, res) => {
  try {
    const { email, senha } = req.body;

    if (!email || !senha) {
      return res.status(400).json({ erro: "Email e senha obrigatórios" });
    }

    const adminLogadoId = req.admin.id;

    const emailNormalizado = email.trim().toLowerCase();
    const hash = await bcrypt.hash(senha, 10);

    const { rows } = await db.query(
      `
      INSERT INTO admin (email, senha)
      VALUES ($1, $2)
      RETURNING id, email, created_at
      `,
      [emailNormalizado, hash]
    );

    const novoAdmin = rows[0];

    await db.query(
  `
  INSERT INTO admin_seguranca_historico (
    user_id,
    tipo_user,
    admin_id,
    acao,
    motivo,
    data
  )
  VALUES ($1, $2, $3, $4, $5, NOW())
  `,
  [
    novoAdmin.id,
    "admin",
    adminLogadoId,
    "criacao",
    `Criou novo administrador: ${novoAdmin.email} (#${novoAdmin.id})`
  ]
);

    res.json(novoAdmin);
  } catch (err) {
    console.error("Erro criar admin:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.delete("/admins/:id", authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const adminLogadoId = req.admin.id;

    if (Number(id) === Number(adminLogadoId)) {
      return res.status(400).json({ erro: "Você não pode excluir seu próprio admin logado" });
    }

    const adminExistente = await db.query(
      "SELECT id, email FROM admin WHERE id = $1",
      [id]
    );

    if (!adminExistente.rows.length) {
      return res.status(404).json({ erro: "Admin não encontrado" });
    }

    const adminRemovido = adminExistente.rows[0];

    await db.query(
      "DELETE FROM admin WHERE id = $1",
      [id]
    );

    await db.query(
  `
  INSERT INTO admin_seguranca_historico (
    user_id,
    tipo_user,
    admin_id,
    acao,
    motivo,
    data
  )
  VALUES ($1, $2, $3, $4, $5, NOW())
  `,
  [
    adminRemovido.id,
    "admin",
    adminLogadoId,
    "exclusao",
    `Excluiu administrador: ${adminRemovido.email} (#${adminRemovido.id})`
  ]
);

await db.query(
  "DELETE FROM admin WHERE id = $1",
  [id]
);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro excluir admin:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 4. SEGURANÇA ==========

router.get("/seguranca", authAdmin, async (req, res) => {
  try {
    const m = parseMes(req.query.mes);
    const { limit, offset, page } = paginate(
      req.query,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );

    const params = [];
    let where = "1=1";

    if (m) {
      params.push(m.mes, m.ano);
      where += ` AND EXTRACT(MONTH FROM h.data) = $${params.length - 1}
                 AND EXTRACT(YEAR FROM h.data) = $${params.length}`;
    }

    const countQ = await db.query(
      `SELECT COUNT(*) FROM admin_seguranca_historico h WHERE ${where}`,
      params
    );

    const total = Number(countQ.rows[0].count);

    params.push(limit, offset);

    const { rows } = await db.query(`
      SELECT 
        h.id,
        h.user_id,
        h.tipo_user,
        h.acao,
        h.motivo,
        h.data,
        h.admin_id,
        a.email AS admin_email
      FROM admin_seguranca_historico h
      LEFT JOIN admin a ON a.id = h.admin_id
      WHERE ${where}
      ORDER BY h.data DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}
    `, params);

    res.json({
      rows,
      totalPages: Math.ceil(total / limit),
      page
    });

  } catch (err) {
    console.error("Erro segurança:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 5. CLIENTE RISCO ==========

router.get("/cliente-risco", authAdmin, async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query, Number(req.query.page) || 1, Number(req.query.limit) || 20);

  const countQ = await db.query(`
  SELECT COUNT(*) 
  FROM cliente_risco
  WHERE ativo = true
`);
    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(`
      SELECT *
      FROM cliente_risco
      WHERE ativo = true
      ORDER BY criado_em DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({ rows, totalPages: Math.ceil(total / limit), page });
  } catch (err) {
    console.error("Erro cliente-risco:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.get("/cliente-risco/lookup/:id", authAdmin, async (req, res) => {
  try {
    const clienteId = req.params.id;

    // Busca nas duas tabelas de pagamento, pega o mais recente
    const { rows } = await db.query(`
      SELECT cliente_id, cpf, aceite_ip AS ip, fingerprint
      FROM pagamentos_pix
      WHERE cliente_id = $1 AND aceite_ip IS NOT NULL
      ORDER BY criado_em DESC
      LIMIT 1
    `, [clienteId]);

    if (rows.length) return res.json(rows[0]);

    const { rows: rows2 } = await db.query(`
      SELECT cliente_id, cpf, aceite_ip AS ip, fingerprint
      FROM pagamentos_cartao
      WHERE cliente_id = $1 AND aceite_ip IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1
    `, [clienteId]);

    if (rows2.length) return res.json(rows2[0]);

    // Fallback sem IP mas com CPF/fingerprint
    const { rows: rows3 } = await db.query(`
      SELECT cliente_id, cpf, aceite_ip AS ip, fingerprint
      FROM pagamentos_cartao
      WHERE cliente_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [clienteId]);

    if (rows3.length) return res.json(rows3[0]);

    return res.status(404).json({ erro: "Nenhum dado encontrado para este cliente" });

  } catch (err) {
    console.error("Erro lookup cliente risco:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.get("/cliente-risco/:id", authAdmin, async (req, res) => {
  try {
    const clienteId = Number(req.params.id);

    const { rows } = await db.query(`
      SELECT
        cliente_id,
        bloqueio_ip,
        bloqueio_cpf,
        bloqueio_fingerprint,
        criado_em,
        cpf,
        ip,
        fingerprint,
        nivel,
        motivo,
        ativo,
        expira_em,
        admin
      FROM cliente_risco
      WHERE cliente_id = $1
      LIMIT 1
    `, [clienteId]);

    if (!rows.length) {
      return res.status(404).json({ erro: "Cliente de risco não encontrado" });
    }

    res.json(rows[0]);

  } catch (err) {
    console.error("Erro buscar cliente-risco:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.post("/cliente-risco", authAdmin, async (req, res) => {
  try {
    const {
      cliente_id,
      cpf,
      ip,
      fingerprint,
      nivel,
      motivo,
      expira_em,
      bloqueio_ip,
      bloqueio_cpf,
      bloqueio_fingerprint
    } = req.body;

    const admin = req.session?.user?.email || req.admin?.email || "Admin";
    const admin_id = req.session?.user?.id || req.admin?.id;

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      // 🔹 INSERIR CLIENTE RISCO
      const { rows } = await client.query(`
        INSERT INTO cliente_risco (
          cliente_id,
          cpf,
          ip,
          fingerprint,
          nivel,
          motivo,
          expira_em,
          bloqueio_ip,
          bloqueio_cpf,
          bloqueio_fingerprint,
          admin,
          criado_em
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
        RETURNING *
      `, [
        cliente_id,
        cpf || null,
        ip || null,
        fingerprint || null,
        nivel || null,
        motivo || null,
        expira_em || null,
        !!bloqueio_ip,
        !!bloqueio_cpf,
        !!bloqueio_fingerprint,
        admin
      ]);

      const clienteRisco = rows[0];

      // 🔹 INSERIR IP BLOQUEADO
      if (bloqueio_ip && ip) {
        await client.query(`
          INSERT INTO ips_bloqueados (ip, cliente_id, motivo, criado_em, expires_at)
          VALUES ($1, $2, $3, NOW(), $4)
          ON CONFLICT DO NOTHING
        `, [ip, cliente_id, motivo || null, expira_em || null]);
      }

      // 🔹 INSERIR CPF BLOQUEADO
      if (bloqueio_cpf && cpf) {
        await client.query(`
          INSERT INTO cpfs_bloqueados (cpf, cliente_id, motivo, created_at, expires_at)
          VALUES ($1, $2, $3, NOW(), $4)
          ON CONFLICT DO NOTHING
        `, [cpf, cliente_id, motivo || null, expira_em || null]);
      }

      // 🔹 INSERIR FINGERPRINT BLOQUEADO
      if (bloqueio_fingerprint && fingerprint) {
        await client.query(`
          INSERT INTO fingerprint_bloqueados (fingerprint, cliente_id, motivo, created_at, expires_at)
          VALUES ($1, $2, $3, NOW(), $4)
          ON CONFLICT DO NOTHING
        `, [fingerprint, cliente_id, motivo || null, expira_em || null]);
      }

      // 🔹 REGISTRAR NO HISTÓRICO DE SEGURANÇA
      const bloqueiosList = [
        bloqueio_ip && 'IP',
        bloqueio_cpf && 'CPF',
        bloqueio_fingerprint && 'Fingerprint'
      ].filter(Boolean).join(', ') || 'Nenhum';

      const descricaoAcao = `Cliente #${cliente_id} marcado como RISCO (${nivel || 'sem nível'}). ${motivo ? `Motivo: ${motivo}` : ''} Bloqueios: ${bloqueiosList}`;

      await client.query(`
        INSERT INTO admin_seguranca_historico (
          admin_id,
          motivo,
          data,
          user_id,
          tipo_user,
          acao
        )
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [
        admin_id,
        descricaoAcao,
        cliente_id,
        'cliente',
        'criar_cliente_risco'
      ]);

      await client.query("COMMIT");

      res.json(clienteRisco);

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error("Erro criar cliente risco:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.get("/dados-clientes-bloqueados", authAdmin, async (req, res) => {
  try {
    const { limit, offset, page } = paginate(
      req.query,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );

    const countQ = await db.query(`
      SELECT COUNT(*)
      FROM cliente_risco
    `);

    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(`
      SELECT
        cr.cliente_id,
        cr.cpf,
        cr.ip,
        cr.fingerprint,
        cr.motivo,
        cr.criado_em,
        cr.admin_id,
        cr.admin,
        a.email AS admin_email
      FROM cliente_risco cr
      LEFT JOIN admin a ON a.id = cr.admin_id
      ORDER BY cr.criado_em DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({
      rows,
      totalPages: Math.ceil(total / limit),
      page
    });

  } catch (err) {
    console.error("Erro dados-clientes-bloqueados:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.put("/cliente-risco/:id", authAdmin, async (req, res) => {
  try {
    const clienteId = req.params.id;
    const admin_id = req.user?.id;

    const atualQ = await db.query(
      `SELECT * FROM cliente_risco WHERE cliente_id = $1 LIMIT 1`,
      [clienteId]
    );

    if (!atualQ.rows.length) {
      return res.status(404).json({ erro: "Não encontrado" });
    }

    const atual = atualQ.rows[0];

    const nivel = req.body.nivel ?? atual.nivel;
    const motivo = req.body.motivo ?? atual.motivo;
    const expira_em = Object.prototype.hasOwnProperty.call(req.body, "expira_em")
      ? req.body.expira_em || null
      : atual.expira_em;

    const bloqueio_ip =
      Object.prototype.hasOwnProperty.call(req.body, "bloqueio_ip")
        ? req.body.bloqueio_ip === true || req.body.bloqueio_ip === "on" || req.body.bloqueio_ip === "true"
        : atual.bloqueio_ip;

    const bloqueio_cpf =
      Object.prototype.hasOwnProperty.call(req.body, "bloqueio_cpf")
        ? req.body.bloqueio_cpf === true || req.body.bloqueio_cpf === "on" || req.body.bloqueio_cpf === "true"
        : atual.bloqueio_cpf;

    const bloqueio_fingerprint =
      Object.prototype.hasOwnProperty.call(req.body, "bloqueio_fingerprint")
        ? req.body.bloqueio_fingerprint === true || req.body.bloqueio_fingerprint === "on" || req.body.bloqueio_fingerprint === "true"
        : atual.bloqueio_fingerprint;

    const admin =
      req.admin?.email ||
      req.session?.user?.email ||
      req.session?.user?.name ||
      atual.admin ||
      "Admin";

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      // 🔹 ATUALIZAR CLIENTE RISCO
      const { rows } = await client.query(`
        UPDATE cliente_risco SET
          nivel = $1,
          bloqueio_ip = $2,
          bloqueio_cpf = $3,
          bloqueio_fingerprint = $4,
          motivo = $5,
          expira_em = $6,
          admin = $7
        WHERE cliente_id = $8
        RETURNING *
      `, [
        nivel,
        bloqueio_ip,
        bloqueio_cpf,
        bloqueio_fingerprint,
        motivo,
        expira_em,
        admin,
        clienteId
      ]);

      // 🔹 ATUALIZAR IP BLOQUEADO
      if (bloqueio_ip && atual.ip) {
        // Se foi marcado agora, insere
        await client.query(`
          INSERT INTO ips_bloqueados (ip, cliente_id, motivo, criado_em, expires_at)
          VALUES ($1, $2, $3, NOW(), $4)
          ON CONFLICT DO NOTHING
        `, [atual.ip, clienteId, motivo || null, expira_em || null]);
      } else if (!bloqueio_ip && atual.ip) {
        // Se foi desmarcado, remove
        await client.query(`
          DELETE FROM ips_bloqueados
          WHERE ip = $1 AND cliente_id = $2
        `, [atual.ip, clienteId]);
      }

      // 🔹 ATUALIZAR CPF BLOQUEADO
      if (bloqueio_cpf && atual.cpf) {
        await client.query(`
          INSERT INTO cpfs_bloqueados (cpf, cliente_id, motivo, created_at, expires_at)
          VALUES ($1, $2, $3, NOW(), $4)
          ON CONFLICT DO NOTHING
        `, [atual.cpf, clienteId, motivo || null, expira_em || null]);
      } else if (!bloqueio_cpf && atual.cpf) {
        await client.query(`
          DELETE FROM cpfs_bloqueados
          WHERE cpf = $1 AND cliente_id = $2
        `, [atual.cpf, clienteId]);
      }

      // 🔹 ATUALIZAR FINGERPRINT BLOQUEADO
      if (bloqueio_fingerprint && atual.fingerprint) {
        await client.query(`
          INSERT INTO fingerprint_bloqueados (fingerprint, cliente_id, motivo, created_at, expires_at)
          VALUES ($1, $2, $3, NOW(), $4)
          ON CONFLICT DO NOTHING
        `, [atual.fingerprint, clienteId, motivo || null, expira_em || null]);
      } else if (!bloqueio_fingerprint && atual.fingerprint) {
        await client.query(`
          DELETE FROM fingerprint_bloqueados
          WHERE fingerprint = $1 AND cliente_id = $2
        `, [atual.fingerprint, clienteId]);
      }

      // 🔹 REGISTRAR NO LOG
      const bloqueiosList = [
        bloqueio_ip && 'IP',
        bloqueio_cpf && 'CPF',
        bloqueio_fingerprint && 'Fingerprint'
      ].filter(Boolean).join(', ') || 'Nenhum';

      const descricaoAcao = `Cliente #${clienteId} atualizado em RISCO. Nível: ${nivel}, Bloqueios: ${bloqueiosList}`;

      await client.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, descricaoAcao, clienteId, 'cliente', 'editar_cliente_risco']);

      await client.query("COMMIT");

      res.json(rows[0]);

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error("Erro atualizar cliente-risco:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.delete("/cliente-risco/:id", authAdmin, async (req, res) => {
  try {
    const clienteId = req.params.id;
    const admin_id = req.user?.id;
    const admin = req.admin?.email || req.session?.user?.email || "Admin";

    const client = await db.connect();

    try {
      await client.query("BEGIN");

      // 🔹 BUSCAR DADOS ANTES DE DELETAR
      const dodoRes = await client.query(
        `SELECT ip, cpf, fingerprint FROM cliente_risco WHERE cliente_id = $1`,
        [clienteId]
      );

      if (dodoRes.rows.length === 0) {
        return res.status(404).json({ erro: "Não encontrado" });
      }

      const { ip, cpf, fingerprint } = dodoRes.rows[0];

      // 🔹 DESATIVAR CLIENTE RISCO
      const { rows } = await client.query(`
        UPDATE cliente_risco
        SET
          ativo = false,
          admin = $1
        WHERE cliente_id = $2
        RETURNING *
      `, [admin, clienteId]);

      // 🔹 REMOVER DOS BLOQUEIOS
      if (ip) {
        await client.query(`DELETE FROM ips_bloqueados WHERE ip = $1 AND cliente_id = $2`, [ip, clienteId]);
      }
      if (cpf) {
        await client.query(`DELETE FROM cpfs_bloqueados WHERE cpf = $1 AND cliente_id = $2`, [cpf, clienteId]);
      }
      if (fingerprint) {
        await client.query(`DELETE FROM fingerprint_bloqueados WHERE fingerprint = $1 AND cliente_id = $2`, [fingerprint, clienteId]);
      }

      // 🔹 REGISTRAR NO LOG
      const descricaoAcao = `Cliente #${clienteId} removido da lista de risco`;

      await client.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, descricaoAcao, clienteId, 'cliente', 'remover_cliente_risco']);

      await client.query("COMMIT");

      res.json({ ok: true, row: rows[0] });

    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

  } catch (err) {
    console.error("Erro desativar cliente-risco:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.get("/logs-clientes-risco", authAdmin, async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query, 1, 20);

    const countQ = await db.query(`
      SELECT COUNT(*)
      FROM cliente_risco
    `);

    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(`
      SELECT
        cliente_id,
        cpf,
        ip,
        fingerprint,
        motivo,
        ativo,
        criado_em,
        admin
      FROM cliente_risco
      ORDER BY criado_em DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({
      rows,
      page,
      total,
      totalPages: Math.ceil(total / limit)
    });

  } catch (err) {
    console.error("Erro logs-clientes-risco:", err);
    res.status(500).json({ error: "Erro ao buscar logs de clientes risco" });
  }
});

// ========== 6. CLIENTE BLOQUEADO ==========

router.get("/clientes-bloqueados/lookup/:id", authAdmin, async (req, res) => {
  try {
    const clienteId = req.params.id;

    const { rows } = await db.query(`
      SELECT
        c.id AS cliente_id,
        u.id AS user_id,
        u.email,
        u.ativo,
        u.desativado_em,
        u.bloqueado,
        cd.nome_completo,
        cd.data_nascimento,
        COALESCE(pp.aceite_ip, pc.aceite_ip) AS ip,
        COALESCE(pp.fingerprint, pc.fingerprint) AS fingerprint,
        COALESCE(pp.cpf, pc.cpf) AS cpf
      FROM clientes c
      LEFT JOIN users u ON u.id = c.user_id
      LEFT JOIN clientes_dados cd ON cd.cliente_id = c.id
      LEFT JOIN LATERAL (
        SELECT aceite_ip, fingerprint, cpf
        FROM pagamentos_pix
        WHERE cliente_id = c.id AND aceite_ip IS NOT NULL
        ORDER BY criado_em DESC
        LIMIT 1
      ) pp ON true
      LEFT JOIN LATERAL (
        SELECT aceite_ip, fingerprint, cpf
        FROM pagamentos_cartao
        WHERE cliente_id = c.id AND aceite_ip IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      ) pc ON true
      WHERE c.id = $1
      LIMIT 1
    `, [clienteId]);

    if (!rows.length) {
      return res.status(404).json({ erro: "Cliente não encontrado" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro lookup cliente bloqueado:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.get("/clientes-bloqueados", authAdmin, async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query, 1, 20);

    const countQ = await db.query(`
      SELECT COUNT(*)
      FROM clientes_bloqueados_cadastro
      WHERE COALESCE(bloqueado, true) = true
    `);

    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(`
      SELECT
        id,
        cliente_id,
        user_id,
        email,
        nome_completo,
        data_nascimento,
        ativo,
        desativado_em,
        bloqueado,
        ip,
        fingerprint,
        cpf,
        nivel,
        motivo,
        bloqueio_ip,
        bloqueio_cpf,
        bloqueio_fingerprint,
        admin,
        criado_em
      FROM clientes_bloqueados_cadastro
      WHERE COALESCE(bloqueado, true) = true
      ORDER BY criado_em DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({
      rows,
      totalPages: Math.ceil(total / limit),
      page
    });
  } catch (err) {
    console.error("Erro clientes-bloqueados:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.get("/clientes-bloqueados/:id", authAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT *
      FROM clientes_bloqueados_cadastro
      WHERE cliente_id = $1
        AND COALESCE(bloqueado, true) = true
      LIMIT 1
    `, [req.params.id]);

    if (!rows.length) {
      return res.status(404).json({ erro: "Não encontrado" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro buscar cliente bloqueado:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  }
});

router.get("/logs-clientes-bloqueados", authAdmin, async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query, 1, 20);

    const countQ = await db.query(`
      SELECT COUNT(*) FROM clientes_bloqueados_cadastro
    `);
    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(`
      SELECT
        cb.cliente_id,
        cb.user_id,
        cb.email,
        cb.nome_completo,
        cb.cpf,
        cb.ip,
        cb.fingerprint,
        cb.motivo,
        cb.nivel,
        cb.bloqueado,
        cb.bloqueio_ip,
        cb.bloqueio_cpf,
        cb.bloqueio_fingerprint,
        cb.criado_em,
        cb.admin AS admin_email,
        COALESCE(cb.ip, pp.aceite_ip, pc.aceite_ip) AS ip_resolvido,
        COALESCE(cb.fingerprint, pp.fingerprint, pc.fingerprint) AS fingerprint_resolvido,
        COALESCE(cb.cpf, pp.cpf, pc.cpf) AS cpf_resolvido
      FROM clientes_bloqueados_cadastro cb
      LEFT JOIN LATERAL (
        SELECT aceite_ip, fingerprint, cpf
        FROM pagamentos_pix
        WHERE cliente_id = cb.cliente_id AND aceite_ip IS NOT NULL
        ORDER BY criado_em DESC
        LIMIT 1
      ) pp ON true
      LEFT JOIN LATERAL (
        SELECT aceite_ip, fingerprint, cpf
        FROM pagamentos_cartao
        WHERE cliente_id = cb.cliente_id AND aceite_ip IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 1
      ) pc ON true
      ORDER BY cb.criado_em DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({ rows, page, total, totalPages: Math.ceil(total / limit) });

  } catch (err) {
    console.error("Erro logs-clientes-bloqueados:", err);
    res.status(500).json({ error: "Erro ao buscar logs de clientes bloqueados" });
  }
});

router.post("/clientes-bloqueados", authAdmin, async (req, res) => {
  const client = await db.connect();

 console.log("BODY recebido:", JSON.stringify(req.body));
  try {
    const {
      cliente_id,
      user_id,
      email,
      nome_completo,
      data_nascimento,
      ativo,
      bloqueado,
      ip,
      fingerprint,
      cpf,
      nivel,
      motivo,
      bloqueio_ip,
      bloqueio_cpf,
      bloqueio_fingerprint
    } = req.body;

    const admin =
      req.admin?.email ||
      req.session?.user?.email ||
      req.session?.user?.name ||
      "Admin";

    const admin_id = req.session?.user?.id || req.admin?.id;

    await client.query("BEGIN");

    const ativoFinal = ativo === true || ativo === "true";
    const bloqueadoFinal = bloqueado === true || bloqueado === "true";

    // 1️⃣ Inserir em clientes_bloqueados_cadastro
    const { rows } = await client.query(`
      INSERT INTO clientes_bloqueados_cadastro (
        cliente_id,
        cliente_id_original,
        user_id,
        email,
        nome_completo,
        data_nascimento,
        ativo,
        desativado_em,
        bloqueado,
        ip,
        fingerprint,
        cpf,
        nivel,
        motivo,
        bloqueio_ip,
        bloqueio_cpf,
        bloqueio_fingerprint,
        admin,
        criado_em
      )
      VALUES (
        $1,$1,$2,$3,$4,$5,$6,NOW(),$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW()
      )
      RETURNING *
    `, [
      cliente_id,
      user_id || null,
      email || null,
      nome_completo || null,
      data_nascimento || null,
      ativoFinal,
      bloqueadoFinal,
      ip || null,
      fingerprint || null,
      cpf || null,
      nivel || null,
      motivo || null,
      !!bloqueio_ip,
      !!bloqueio_cpf,
      !!bloqueio_fingerprint,
      admin
    ]);

    // 2️⃣ Atualizar users (dispara o trigger automaticamente)
    if (user_id) {
      await client.query(`
        UPDATE users
        SET
          ativo = $1,
          bloqueado = $2,
          updated_at = NOW()
        WHERE id = $3
      `, [
        ativoFinal,
        bloqueadoFinal,
        user_id
      ]);
    }

    // 3️⃣ Atualizar clientes (caso o trigger não execute)
    await client.query(`
      UPDATE clientes
      SET
        bloqueado = $1,
        ativo = $2,
        desativado_em = NOW()
      WHERE id = $3
    `, [bloqueadoFinal, ativoFinal, cliente_id]);

    // 4️⃣ Atualizar clientes_dados
    await client.query(`
      UPDATE clientes_dados
      SET
        ativo = $1,
        atualizado_em = NOW()
      WHERE cliente_id = $2
    `, [ativoFinal, cliente_id]);

    // 5️⃣ Atualizar vip_subscriptions
    await client.query(`
      UPDATE vip_subscriptions
      SET
        ativo = $1,
        updated_at = NOW()
      WHERE cliente_id = $2
    `, [ativoFinal, cliente_id]);

    // 6️⃣ Registrar no histórico de segurança
    const descricaoAcao = `Cliente #${cliente_id} adicionado à lista de bloqueados. Nível: ${nivel || 'sem nível'}. ${motivo ? `Motivo: ${motivo}` : ''} Bloqueios: ${[
      bloqueio_ip && 'IP',
      bloqueio_cpf && 'CPF',
      bloqueio_fingerprint && 'Fingerprint'
    ].filter(Boolean).join(', ') || 'Nenhum'}`;

    await client.query(`
      INSERT INTO admin_seguranca_historico (
        admin_id,
        motivo,
        data,
        user_id,
        tipo_user,
        acao
      )
      VALUES ($1, $2, NOW(), $3, $4, $5)
    `, [
      admin_id,
      descricaoAcao,
      cliente_id,
      'cliente',
      'bloqueio_cadastro'
    ]);

    await client.query("COMMIT");

    res.json(rows[0]);

  } catch (err) {
  await client.query("ROLLBACK");

  console.error("ERRO COMPLETO:", {
    message: err.message,
    code: err.code,
    detail: err.detail,
    table: err.table,
    column: err.column,
    constraint: err.constraint
  });

  if (err.code === "23505") {
    return res.status(409).json({
      erro: "Cliente já está cadastrado na lista de bloqueados"
    });
  }

  res.status(500).json({ erro: "Erro interno", details: err.message });
}
});

router.put("/clientes-bloqueados/:id", authAdmin, async (req, res) => {
  const client = await db.connect();

  try {
    const {
      nivel,
      motivo,
      bloqueio_ip,
      bloqueio_cpf,
      bloqueio_fingerprint
    } = req.body;

    const admin =
      req.admin?.email ||
      req.session?.user?.email ||
      req.session?.user?.name ||
      "Admin";

    const admin_id = req.session?.user?.id || req.admin?.id;

    await client.query("BEGIN");

    // 1️⃣ Atualizar clientes_bloqueados_cadastro
    const { rows } = await client.query(`
      UPDATE clientes_bloqueados_cadastro
      SET
        nivel = $1,
        motivo = $2,
        bloqueio_ip = $3,
        bloqueio_cpf = $4,
        bloqueio_fingerprint = $5,
        admin = $6,
        ativo = false,
        bloqueado = true,
        desativado_em = COALESCE(desativado_em, NOW())
      WHERE cliente_id = $7
      RETURNING *
    `, [
      nivel || null,
      motivo || null,
      !!bloqueio_ip,
      !!bloqueio_cpf,
      !!bloqueio_fingerprint,
      admin,
      req.params.id
    ]);

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ erro: "Não encontrado" });
    }

    const bloqueado = rows[0];

    // 2️⃣ Atualizar users (dispara o trigger automaticamente)
    if (bloqueado.user_id) {
      await client.query(`
        UPDATE users
        SET
          ativo = false,
          bloqueado = true,
          updated_at = NOW()
        WHERE id = $1
      `, [bloqueado.user_id]);
    }

    // 3️⃣ Atualizar clientes (caso o trigger não execute)
    await client.query(`
      UPDATE clientes
      SET
        bloqueado = true,
        ativo = false,
        desativado_em = NOW()
      WHERE id = $1
    `, [req.params.id]);

    // 4️⃣ Atualizar clientes_dados
    await client.query(`
      UPDATE clientes_dados
      SET
        ativo = false,
        atualizado_em = NOW()
      WHERE cliente_id = $1
    `, [req.params.id]);

    // 5️⃣ Atualizar vip_subscriptions
    await client.query(`
      UPDATE vip_subscriptions
      SET
        ativo = false,
        updated_at = NOW()
      WHERE cliente_id = $1
    `, [req.params.id]);

    // 6️⃣ Registrar no histórico de segurança
    const descricaoAcao = `Cliente #${req.params.id} atualizado na lista de bloqueados. Nível: ${nivel || 'sem nível'}. ${motivo ? `Motivo: ${motivo}` : ''} Bloqueios: ${[
      bloqueio_ip && 'IP',
      bloqueio_cpf && 'CPF',
      bloqueio_fingerprint && 'Fingerprint'
    ].filter(Boolean).join(', ') || 'Nenhum'}`;

    await client.query(`
      INSERT INTO admin_seguranca_historico (
        admin_id,
        motivo,
        data,
        user_id,
        tipo_user,
        acao
      )
      VALUES ($1, $2, NOW(), $3, $4, $5)
    `, [
      admin_id,
      descricaoAcao,
      req.params.id,
      'cliente',
      'atualizar_bloqueio'
    ]);

    await client.query("COMMIT");

    res.json(bloqueado);

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro atualizar cliente bloqueado:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  } finally {
    client.release();
  }
});

router.delete("/clientes-bloqueados/:id", authAdmin, async (req, res) => {
  const client = await db.connect();

  try {
    const admin =
      req.admin?.email ||
      req.session?.user?.email ||
      req.session?.user?.name ||
      "Admin";

    const admin_id = req.session?.user?.id || req.admin?.id;

    await client.query("BEGIN");

    // 1️⃣ Atualizar clientes_bloqueados_cadastro
    const { rows } = await client.query(`
      UPDATE clientes_bloqueados_cadastro
      SET
        ativo = true,
        bloqueado = false,
        admin = $1
      WHERE cliente_id = $2
      RETURNING *
    `, [admin, req.params.id]);

    if (!rows.length) {
      await client.query("ROLLBACK");
      return res.status(404).json({ erro: "Não encontrado" });
    }

    const bloqueado = rows[0];

    // 2️⃣ Atualizar users (dispara o trigger automaticamente)
    if (bloqueado.user_id) {
      await client.query(`
        UPDATE users
        SET
          ativo = true,
          bloqueado = false,
          updated_at = NOW()
        WHERE id = $1
      `, [bloqueado.user_id]);
    }

    // 3️⃣ Atualizar clientes (caso o trigger não execute)
    await client.query(`
      UPDATE clientes
      SET
        bloqueado = false,
        ativo = true,
        desativado_em = NOW()
      WHERE id = $1
    `, [req.params.id]);

    // 4️⃣ Atualizar clientes_dados
    await client.query(`
      UPDATE clientes_dados
      SET
        ativo = true,
        atualizado_em = NOW()
      WHERE cliente_id = $1
    `, [req.params.id]);

    // 5️⃣ Atualizar vip_subscriptions
    await client.query(`
      UPDATE vip_subscriptions
      SET
        ativo = true,
        updated_at = NOW()
      WHERE cliente_id = $1
    `, [req.params.id]);

    // 6️⃣ Registrar no histórico de segurança
    const descricaoAcao = `Cliente #${req.params.id} removido da lista de bloqueados. Nível anterior: ${bloqueado.nivel || 'sem nível'}. Motivo anterior: ${bloqueado.motivo || 'sem motivo'}`;

    await client.query(`
      INSERT INTO admin_seguranca_historico (
        admin_id,
        motivo,
        data,
        user_id,
        tipo_user,
        acao
      )
      VALUES ($1, $2, NOW(), $3, $4, $5)
    `, [
      admin_id,
      descricaoAcao,
      req.params.id,
      'cliente',
      'remover_bloqueio'
    ]);

    await client.query("COMMIT");

    res.json({ ok: true, row: bloqueado });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro remover cliente bloqueado:", err);
    res.status(500).json({ erro: "Erro interno", details: err.message });
  } finally {
    client.release();
  }
});

// ========== 7. VERIFICAÇÕES ==========

router.get("/verificacoes/modelos", auth, authAdmin, async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.max(Number(req.query.limit) || 20, 1);
    const offset = (page - 1) * limit;

    const countQ = await db.query(`
      SELECT COUNT(*)::int AS total
      FROM modelos_verificacao mv
      JOIN modelos m ON m.id = mv.modelo_id
    `);

    const total = countQ.rows[0]?.total || 0;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const { rows } = await db.query(`
      SELECT
        mv.modelo_id,
        mv.modelo_id AS id,
        m.nome_exibicao AS modelo_nome,
        mv.documento_tipo,
        mv.status,
        mv.criado_em,
        mv.verificado_em
      FROM modelos_verificacao mv
      JOIN modelos m ON m.id = mv.modelo_id
      ORDER BY
        CASE
          WHEN mv.status = 'pendente' THEN 0
          WHEN mv.status = 'em_analise' THEN 1
          WHEN mv.status = 'rejeitado' THEN 2
          WHEN mv.status = 'aprovado' THEN 3
          ELSE 4
        END,
        mv.criado_em DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    res.json({
      rows,
      total,
      totalPages,
      page
    });

  } catch (err) {
    console.error("Erro listar verificações de modelos:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/verificacoes/modelo/:id", auth, authAdmin, async (req, res) => {
  try {
    const modelo_id = Number(req.params.id);

    const { rows } = await db.query(`
      SELECT
        mv.modelo_id,
        mv.documento_tipo,
        mv.doc_frente_url,
        mv.doc_verso_url,
        mv.selfie_url,
        mv.contrato_pdf_url,
        mv.status,
        mv.motivo_rejeicao,
        mv.declaracao,
        mv.criado_em,
        mv.verificado_em,

        m.nome_exibicao,
        m.bio,
        m.local,
        m.avatar,
        m.capa,
        m.agencia_id,
        m.verificada,
        m.feed,
        m.agencia_desde,
        m.atualizado_em,

        md.nome_completo,
        md.data_nascimento,
        md.telefone,
        md.endereco,
        md.pais,
        md.estado,
        md.cidade,
        md.instagram,
        md.tiktok,
        md.vip_preco,

        a.nome AS agencia_nome

      FROM modelos_verificacao mv
      JOIN modelos m ON m.id = mv.modelo_id
      LEFT JOIN modelos_dados md ON md.modelo_id = m.id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN agencias a ON a.id = m.agencia_id
      WHERE mv.modelo_id = $1
      LIMIT 1
    `, [modelo_id]);

    if (!rows.length) {
      return res.status(404).json({ error: "Verificação não encontrada" });
    }

    const v = rows[0];

    res.json({
      ...v,
      avatar_url: assinarArquivoPrivado(v.avatar),
      capa_url: assinarArquivoPrivado(v.capa),
      doc_frente_url: assinarArquivoPrivado(v.doc_frente_url),
      doc_verso_url: assinarArquivoPrivado(v.doc_verso_url),
      selfie_url: assinarArquivoPrivado(v.selfie_url),
      contrato_pdf_url: assinarArquivoPrivado(v.contrato_pdf_url)
    });

  } catch (err) {
    console.error("Erro detalhe verificação modelo:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.put("/verificacoes/modelo/:id", auth, authAdmin, async (req, res) => {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    const modelo_id = Number(req.params.id);
    const { status, motivo_rejeicao, dados = {} } = req.body;

    if (!["aprovado", "rejeitado"].includes(status)) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Status inválido" });
    }

    if (status === "rejeitado" && (!motivo_rejeicao || !motivo_rejeicao.trim())) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Motivo da rejeição é obrigatório" });
    }

    const modeloRes = await client.query(`
      SELECT
        m.id,
        m.user_id,
        m.agencia_id AS agencia_id_atual,
        u.email
      FROM modelos m
      JOIN users u ON u.id = m.user_id
      WHERE m.id = $1
      LIMIT 1
    `, [modelo_id]);

    if (!modeloRes.rowCount) {
      throw new Error("Modelo não encontrado");
    }

    const user_id = modeloRes.rows[0].user_id;
    const email = modeloRes.rows[0].email;
    const agencia_id_atual = modeloRes.rows[0].agencia_id_atual;

    const novaAgenciaId =
      dados.agencia_id !== undefined &&
      dados.agencia_id !== null &&
      String(dados.agencia_id).trim() !== ''
        ? Number(dados.agencia_id)
        : null;

    const agenciaMudou = String(agencia_id_atual || '') !== String(novaAgenciaId || '');
    const atualizarAgenciaDesde = agenciaMudou && novaAgenciaId !== null;

    await client.query(`
      UPDATE modelos
      SET
        nome_exibicao = $1,
        local = $2,
        bio = $3,
        agencia_id = $4,
        atualizado_em = NOW(),
        verificada = $5,
        feed = CASE WHEN $5 = true THEN true ELSE feed END,
        agencia_desde = CASE
          WHEN $6 = true THEN NOW()
          ELSE agencia_desde
        END
      WHERE id = $7
    `, [
      dados.nome_exibicao || null,
      dados.local || null,
      dados.bio || null,
      novaAgenciaId,
      status === "aprovado",
      atualizarAgenciaDesde,
      modelo_id
    ]);

    await client.query(`
      INSERT INTO modelos_dados (
        modelo_id,
        nome_completo,
        data_nascimento,
        telefone,
        endereco,
        pais,
        estado,
        cidade,
        instagram,
        tiktok,
        vip_preco
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (modelo_id)
      DO UPDATE SET
        nome_completo = EXCLUDED.nome_completo,
        data_nascimento = EXCLUDED.data_nascimento,
        telefone = EXCLUDED.telefone,
        endereco = EXCLUDED.endereco,
        pais = EXCLUDED.pais,
        estado = EXCLUDED.estado,
        cidade = EXCLUDED.cidade,
        instagram = EXCLUDED.instagram,
        tiktok = EXCLUDED.tiktok,
        vip_preco = EXCLUDED.vip_preco
    `, [
      modelo_id,
      dados.nome_completo || null,
      dados.data_nascimento || null,
      dados.telefone || null,
      dados.endereco || null,
      dados.pais || null,
      dados.estado || null,
      dados.cidade || null,
      dados.instagram || null,
      dados.tiktok || null,
      dados.vip_preco || null
    ]);

    await client.query(`
      UPDATE modelos_verificacao
      SET
        status = $1,
        motivo_rejeicao = $2,
        verificado_em = NOW()
      WHERE modelo_id = $3
    `, [
      status,
      status === "rejeitado" ? motivo_rejeicao.trim() : null,
      modelo_id
    ]);

    await client.query("COMMIT");

    if (status === "aprovado" && email) {
      try {
        await enviarEmailAprovacao(email);
      } catch (e) {
        console.error("Erro enviar email aprovação:", e);
      }
    }

    if (status === "rejeitado" && email) {
      try {
        await enviarEmailRejeicao(email, motivo_rejeicao.trim());
      } catch (e) {
        console.error("Erro enviar email rejeição:", e);
      }
    }

    res.json({ message: "Processo concluído" });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Erro atualizar verificação modelo:", err);
    res.status(500).json({ error: "Erro ao validar modelo", detail: err.message });
  } finally {
    client.release();
  }
});

router.get("/verificacoes-aprovadas", auth, authAdmin, async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    const totalRes = await db.query(`
      SELECT COUNT(*)::int AS total
      FROM modelos_verificacao
      WHERE status = 'aprovado'
    `);

    const total = totalRes.rows[0]?.total || 0;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const result = await db.query(`
      SELECT
        mv.modelo_id AS id,
        'modelo' AS tipo,
        m.nome_exibicao,
        mv.documento_tipo,
        mv.doc_frente_url,
        mv.doc_verso_url,
        mv.selfie_url,
        mv.verificado_em
      FROM modelos_verificacao mv
      JOIN modelos m ON m.id = mv.modelo_id
      WHERE mv.status = 'aprovado'
      ORDER BY mv.verificado_em DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const dados = result.rows.map(p => ({
      ...p,
      doc_frente_url: assinarArquivoPrivado(p.doc_frente_url),
      doc_verso_url: assinarArquivoPrivado(p.doc_verso_url),
      selfie_url: assinarArquivoPrivado(p.selfie_url)
    }));

    res.json({
      dados,
      totalPages,
      page
    });

  } catch (err) {
    console.error("Erro buscar aprovados:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/verificacoes-rejeitadas", auth, authAdmin, async (req, res) => {
  try {
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = 10;
    const offset = (page - 1) * limit;

    const totalRes = await db.query(`
      SELECT COUNT(*)::int AS total
      FROM modelos_verificacao
      WHERE status = 'rejeitado'
    `);

    const total = totalRes.rows[0]?.total || 0;
    const totalPages = Math.max(Math.ceil(total / limit), 1);

    const result = await db.query(`
      SELECT
        mv.modelo_id AS id,
        'modelo' AS tipo,
        m.nome_exibicao,
        mv.documento_tipo,
        mv.doc_frente_url,
        mv.doc_verso_url,
        mv.selfie_url,
        mv.motivo_rejeicao,
        mv.verificado_em AS rejeitado_em
      FROM modelos_verificacao mv
      JOIN modelos m ON m.id = mv.modelo_id
      WHERE mv.status = 'rejeitado'
      ORDER BY mv.verificado_em DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);

    const dados = result.rows.map(p => ({
      ...p,
      doc_frente_url: assinarArquivoPrivado(p.doc_frente_url),
      doc_verso_url: assinarArquivoPrivado(p.doc_verso_url),
      selfie_url: assinarArquivoPrivado(p.selfie_url)
    }));

    res.json({
      dados,
      totalPages,
      page
    });

  } catch (err) {
    console.error("Erro rejeitados:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.put("/perfis/:id/editar", auth, authAdmin, async (req, res) => {
  const { id } = req.params;
  const { dados } = req.body;

  try {
    await db.query(`
      UPDATE modelos
      SET nome_exibicao = $1,
          local = $2,
          bio = $3,
          agencia_id = $4
      WHERE id = $5
    `, [
      dados.nome_exibicao || null,
      dados.local || null,
      dados.bio || null,
      dados.agencia_id || null,
      id
    ]);

    await db.query(`
      INSERT INTO modelos_dados (
        modelo_id,
        nome_completo,
        data_nascimento,
        telefone,
        endereco,
        pais,
        estado,
        cidade,
        instagram,
        tiktok,
        vip_preco
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (modelo_id)
      DO UPDATE SET
        nome_completo = EXCLUDED.nome_completo,
        data_nascimento = EXCLUDED.data_nascimento,
        telefone = EXCLUDED.telefone,
        endereco = EXCLUDED.endereco,
        pais = EXCLUDED.pais,
        estado = EXCLUDED.estado,
        cidade = EXCLUDED.cidade,
        instagram = EXCLUDED.instagram,
        tiktok = EXCLUDED.tiktok,
        vip_preco = EXCLUDED.vip_preco
    `, [
      id,
      dados.nome_completo || null,
      dados.data_nascimento || null,
      dados.telefone || null,
      dados.endereco || null,
      dados.pais || null,
      dados.estado || null,
      dados.cidade || null,
      dados.instagram || null,
      dados.tiktok || null,
      dados.vip_preco || null
    ]);

    res.json({ message: "Atualizado com sucesso" });

  } catch (err) {
    console.error("Erro ao atualizar perfil modelo:", err);
    res.status(500).json({ error: "Erro ao atualizar dados" });
  }
});

router.get("/agencias-lista", auth, authAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, nome
      FROM agencias
      ORDER BY nome ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("Erro listar agências:", err);
    res.status(500).json({ error: "Erro ao buscar agências" });
  }
});

// ========== 8. FECHAMENTO ==========FALTA

router.get("/fechamento", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM fechamento_mensal ORDER BY ano DESC, mes DESC");
    res.json(rows);
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

router.post("/fechamento", async (req, res) => {
  try {
    const now = new Date();
    const ano = now.getFullYear();
    const mes = now.getMonth() + 1;

    // Check if already exists
    const existing = await db.query(
      "SELECT id FROM fechamento_mensal WHERE ano = $1 AND mes = $2", [ano, mes]
    );
    if (existing.rows.length) return res.status(400).json({ erro: "Fechamento já existe para este mês" });

    const result = await db.query(`
      SELECT
        COALESCE(SUM(valor_bruto), 0) AS total_bruto,
        COALESCE(SUM(taxa_gateway), 0) AS total_taxas,
        COALESCE(SUM(agency_fee), 0) AS total_agency,
        COALESCE(SUM(velvet_fee), 0) AS total_velvet,
        COALESCE(SUM(valor_modelo), 0) AS total_modelos,
        COALESCE(SUM(CASE WHEN tipo = 'assinatura' THEN valor_bruto ELSE 0 END), 0) AS total_assinaturas,
        COALESCE(SUM(CASE WHEN tipo != 'assinatura' THEN valor_bruto ELSE 0 END), 0) AS total_midias
      FROM transacoes_agency
      WHERE status = 'normal'
      AND EXTRACT(MONTH FROM created_at) = $1
      AND EXTRACT(YEAR FROM created_at) = $2
    `, [mes, ano]);

    const r = result.rows[0];
    const { rows } = await db.query(`
      INSERT INTO fechamento_mensal (ano, mes, total_bruto, total_taxas, total_agency, total_velvet, total_modelos, total_assinaturas, total_midias)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
    `, [ano, mes, r.total_bruto, r.total_taxas, r.total_agency, r.total_velvet, r.total_modelos, r.total_assinaturas, r.total_midias]);

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro fechamento:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 9. DADOS BANCÁRIOS ==========

router.get("/dados-bancarios", async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query, Number(req.query.page) || 1, Number(req.query.limit) || 20);
    const status = req.query.status;

    let where = "1=1";
    const params = [limit, offset];
    if (status) {
      where = "b.status = $3";
      params.push(status);
    }

    const countQ = await db.query(`SELECT COUNT(*) FROM modelo_dados_bancarios b WHERE ${where}`, status ? [status] : []);
    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(`
      SELECT b.*, m.nome AS modelo_nome
      FROM modelo_dados_bancarios b
      LEFT JOIN modelos m ON m.id = b.modelo_id
      WHERE ${where}
      ORDER BY CASE WHEN b.status = 'pendente' THEN 0 ELSE 1 END, b.criado_em DESC
      LIMIT $1 OFFSET $2
    `, params);

    res.json({ rows, totalPages: Math.ceil(total / limit), page });
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

router.get("/dados-bancarios/:id", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM modelo_dados_bancarios WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: "Não encontrado" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

router.put("/dados-bancarios/:id", authAdmin, async (req, res) => {
  try {
    const beforeQ = await db.query(
      `SELECT * 
         FROM modelo_dados_bancarios 
        WHERE id = $1 
        LIMIT 1`,
      [req.params.id]
    );

    if (!beforeQ.rows.length) {
      return res.status(404).json({ erro: "Registro bancário não encontrado" });
    }

    const anterior = beforeQ.rows[0];
    const fields = { ...req.body };
    if (fields.tipo) fields.tipo = fields.tipo.toLowerCase();
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

    const { rows } = await db.query(
      `UPDATE modelo_dados_bancarios
          SET ${sets.join(", ")}
        WHERE id = $${i}
      RETURNING *`,
      vals
    );

    const atualizado = rows[0];

    let acao = "atualizacao_dados_bancarios";
    let motivo = `Dados bancários atualizados pelo admin. Status anterior: ${anterior.status || "null"}; novo status: ${atualizado.status || "null"}.`;

    if (anterior.status !== atualizado.status && atualizado.status === "aprovado") {
      acao = "aprovacao_dados_bancarios";
      motivo = `Dados bancários aprovados pelo admin. Status anterior: ${anterior.status || "null"}; novo status: aprovado.`;
    } else if (anterior.status !== atualizado.status && atualizado.status === "rejeitado") {
      acao = "rejeicao_dados_bancarios";
      motivo = `Dados bancários rejeitados pelo admin. Status anterior: ${anterior.status || "null"}; novo status: rejeitado.`;
    }

    await db.query(
      `INSERT INTO admin_seguranca_historico
        (user_id, tipo_user, acao, motivo, data, admin_id)
       VALUES
        ($1, $2, $3, $4, NOW(), $5)`,
      [
        atualizado.modelo_id,
        "modelo",
        acao,
        motivo,
        req.admin?.id || req.user?.id || null
      ]
    );

    res.json(atualizado);
  } catch (err) {
    console.error("Erro atualizar bancário:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 10. MODELOS ==========

router.get("/modelos-lista", async (req, res) => {
  try {
    const { rows } = await db.query(
      "SELECT id, nome FROM modelos WHERE ativo = true AND verificada = true ORDER BY nome"
    );
    res.json(rows);
  } catch (err) { 
    res.status(500).json({ erro: "Erro interno" }); 
  }
});

router.get("/modelos", authAdmin, async (req, res) => {
  try {
    const { limit, offset, page } = paginate(
      req.query,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );

    const busca = req.query.busca || "";
    const params = [];
    let where = "m.ativo = true AND m.verificada = true";

    if (busca) {
      params.push(`%${busca}%`);
      params.push(`%${busca}%`);
      params.push(busca);
      where += ` AND (m.nome ILIKE $1 OR u.email ILIKE $2 OR m.id::text = $3)`;
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

router.get("/agencias", authAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, nome
      FROM agencias
      ORDER BY nome ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("Erro listar agências:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/modelos/:id", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM modelos WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: "Não encontrado" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

router.put("/modelos/:id", authAdmin, async (req, res) => {
  try {
    const modeloId = req.params.id;
    const adminId = req.admin?.id || req.user?.id || null;
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
      "agencia_id",
      "ativo"
    ];

    const antesQ = await db.query(`
      SELECT id, nome, ativo, feed, bio, verificada, agencia_id
      FROM modelos
      WHERE id = $1
    `, [modeloId]);

    if (!antesQ.rows.length) {
      return res.status(404).json({ erro: "Modelo não encontrado" });
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
        INSERT INTO admin_seguranca_historico
          (user_id, tipo_user, acao, motivo, data, admin_id)
        VALUES
          ($1, 'modelo', $2, $3, NOW(), $4)
      `, [
        modeloId,
        (depois.ativo === false ? "desativacao_modelo" : "reativacao_modelo"),
        `Modelo ${depois.nome || "#" + modeloId} teve status alterado para ativo=${depois.ativo}`,
        adminId
      ]);
    }

    res.json(depois);
  } catch (err) {
    console.error("Erro atualizar modelo:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/modelos-dados/:id", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM modelos_dados WHERE modelo_id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: "Não encontrado" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

router.put("/modelos-dados/:id", authAdmin, async (req, res) => {
  try {
    const modeloId = req.params.id;
    const adminId = req.admin?.id || req.user?.id || null;
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

    const antesQ = await db.query(`
      SELECT modelo_id, vip_preco
      FROM modelos_dados
      WHERE modelo_id = $1
    `, [modeloId]);

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
        INSERT INTO admin_seguranca_historico
          (user_id, tipo_user, acao, motivo, data, admin_id)
        VALUES
          ($1, 'modelo', 'alteracao_vip_preco', $2, NOW(), $3)
      `, [
        modeloId,
        `VIP alterado de ${antes.vip_preco ?? "null"} para ${depois.vip_preco ?? "null"}`,
        adminId
      ]);
    }

    res.json(depois);
  } catch (err) {
    console.error("Erro atualizar modelos_dados:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 11. RANKING ==========

router.get("/ranking", authAdmin, async (req, res) => {
  try {
    const mes = String(req.query.mes || '').trim(); // YYYY-MM
    const params = [];
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
        t.created_at >= $1::date
        AND t.created_at < ($1::date + INTERVAL '1 month')
      `;
    }

    const { rows } = await db.query(`
      SELECT
        t.modelo_id,
        m.nome,
        ROUND(COALESCE(SUM(t.valor_modelo), 0)::numeric, 2) AS ganhos_total,
        MAX(t.created_at) AS atualizado_em
      FROM transacoes_agency t
      LEFT JOIN modelos m ON m.id = t.modelo_id
      WHERE t.modelo_id IS NOT NULL
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

// ========== 12. FINANCEIRO (RASTREIO) ==========

function makeGenericList(table, orderBy = "id DESC", dateColumn = null) {
  return async (req, res) => {
    try {
      const { limit, offset, page } = paginate(
        req.query,
        Number(req.query.page) || 1,
        Number(req.query.limit) || 20
      );

      const m = parseMes(req.query.mes);

      let where = "1=1";
      if (dateColumn && m && Number.isInteger(m.mes) && Number.isInteger(m.ano)) {
        where = `EXTRACT(MONTH FROM ${dateColumn}) = ${m.mes} AND EXTRACT(YEAR FROM ${dateColumn}) = ${m.ano}`;
      }

      const countQ = await db.query(`SELECT COUNT(*) FROM ${table} WHERE ${where}`);
      const total = Number(countQ.rows[0].count);

      const { rows } = await db.query(
        `SELECT * FROM ${table} WHERE ${where} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      res.json({
        rows,
        totalPages: Math.ceil(total / limit),
        page
      });
    } catch (err) {
      console.error(`Erro ${table}:`, err);
      res.status(500).json({ erro: "Erro interno" });
    }
  };
}

router.get("/pagamentos-cartao", makeGenericList("pagamentos_cartao", "created_at DESC", "created_at"));
router.get("/pagamentos-pix", makeGenericList("pagamentos_pix", "criado_em DESC", "criado_em"));
router.get("/pagamento-tentativas", makeGenericList("pagamento_tentativas", "criado_em DESC", "criado_em"));
router.get("/pagarme-events", makeGenericList("pagarme_events", "created_at DESC", "created_at"));
router.get("/stripe-events", makeGenericList("stripe_events", "created_at DESC", "created_at"));
router.get("/conteudo-pacotes", makeGenericList("conteudo_pacotes", "criado_em DESC", "criado_em"));
router.get("/premium-unlocks", makeGenericList("premium_unlocks", "created_at DESC", "created_at"));
router.get("/vip-subscriptions", makeGenericList("vip_subscriptions", "updated_at DESC", "updated_at"));

// ========== MÍDIAS ADMIN ==========

router.get("/midias-admin", async (req, res) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 24;
    const offset = (page - 1) * limit;
    const modelo_id = req.query.modelo_id || null;
    const tipo = req.query.tipo || null;
    const tipo_conteudo = req.query.tipo_conteudo || null;

    const params = [];
    let paramIdx = 1;
    let where = "c.ativo = TRUE";

    if (modelo_id) {
      where += ` AND c.modelo_id = $${paramIdx++}`;
      params.push(modelo_id);
    }
    if (tipo) {
      where += ` AND c.tipo = $${paramIdx++}`;
      params.push(tipo);
    }
    if (tipo_conteudo) {
      where += ` AND c.tipo_conteudo = $${paramIdx++}`;
      params.push(tipo_conteudo);
    }

    const countQ = await db.query(
      `SELECT COUNT(*) FROM conteudos c WHERE ${where}`,
      params
    );
    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(
      `SELECT c.id, c.modelo_id, c.tipo, c.tipo_conteudo, c.url,
              COALESCE(c.thumbnail_url, c.thumb_url) AS thumbnail_url,
              c.preco, c.descricao, c.criado_em,
              COALESCE(m.nome_exibicao, m.nome) AS modelo_nome
       FROM conteudos c
       LEFT JOIN modelos m ON m.id = c.modelo_id
       WHERE ${where}
       ORDER BY c.criado_em DESC
       LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
      [...params, limit, offset]
    );

    res.json({ rows, total, totalPages: Math.ceil(total / limit), page });
  } catch (err) {
    console.error("Erro midias-admin:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/midias-admin/modelos", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT m.id, COALESCE(m.nome_exibicao, m.nome) AS nome, COUNT(c.id)::int AS total_midias
       FROM modelos m
       INNER JOIN conteudos c ON c.modelo_id = m.id AND c.ativo = TRUE
       GROUP BY m.id, m.nome_exibicao, m.nome
       ORDER BY total_midias DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Erro midias-admin modelos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.delete("/midias-admin/:id", async (req, res) => {
  const conteudo_id = Number(req.params.id);
  if (!conteudo_id) return res.status(400).json({ erro: "ID inválido" });

  try {
    const { rows } = await db.query(
      `SELECT id, url, tipo FROM conteudos WHERE id = $1`,
      [conteudo_id]
    );

    if (!rows.length) return res.status(404).json({ erro: "Mídia não encontrada" });

    const { url, tipo } = rows[0];
    const axios = require("axios");

    // Extrai ID do Cloudflare e chama API de deleção
    if (tipo === "imagem" || tipo === "image") {
      const match = url && url.match(/imagedelivery\.net\/[^/]+\/([^/]+)/);
      if (match) {
        const imageId = match[1];
        await axios.delete(
          `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/images/v1/${imageId}`,
          { headers: { Authorization: `Bearer ${process.env.CF_IMAGES_TOKEN}` } }
        ).catch(e => console.warn("CF Images delete warn:", e.response?.data || e.message));
      }
    } else if (tipo === "video") {
      const match = url && url.match(/videodelivery\.net\/([^/?]+)|iframe\.videodelivery\.net\/([^/?]+)/);
      if (match) {
        const videoId = match[1] || match[2];
        await axios.delete(
          `https://api.cloudflare.com/client/v4/accounts/${process.env.CF_ACCOUNT_ID}/stream/${videoId}`,
          { headers: { Authorization: `Bearer ${process.env.CF_STREAM_TOKEN}` } }
        ).catch(e => console.warn("CF Stream delete warn:", e.response?.data || e.message));
      }
    }

    await db.query(
      `UPDATE conteudos SET ativo = FALSE, deletado_em = NOW() WHERE id = $1`,
      [conteudo_id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("Erro deletar midia-admin:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 13. TRANSAÇÕES AGENCY ==========

router.get("/transacoes-agency", async (req, res) => {
  try {
    const { limit, offset, page } = paginate(
      req.query,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );

    const modelo_id = req.query.modelo_id;
    const m = parseMes(req.query.mes);

    let where = "m.verificada = true AND m.ativo = true";
    const params = [];
    let paramIdx = 1;

    if (modelo_id) {
      where += ` AND t.modelo_id = $${paramIdx}`;
      params.push(modelo_id);
      paramIdx++;
    }

    if (m) {
      where += ` AND EXTRACT(MONTH FROM t.created_at) = $${paramIdx}
                 AND EXTRACT(YEAR FROM t.created_at) = $${paramIdx + 1}`;
      params.push(m.mes, m.ano);
      paramIdx += 2;
    }

    // Copiar params para countParams
    const countParams = [...params];

    const countQ = await db.query(`
      SELECT COUNT(*) AS count
      FROM transacoes_agency t
      INNER JOIN modelos m ON m.id = t.modelo_id
      WHERE ${where}
    `, countParams);

    const total = Number(countQ.rows[0]?.count || 0);

    const totaisQ = await db.query(`
      SELECT
        COALESCE(SUM(t.valor_bruto), 0) AS bruto,
        COALESCE(SUM(t.valor_modelo), 0) AS modelo,
        COALESCE(SUM(t.velvet_fee), 0) AS velvet,
        COALESCE(SUM(t.agency_fee), 0) AS agency,
        COALESCE(SUM(t.taxa_gateway), 0) AS gateway
      FROM transacoes_agency t
      INNER JOIN modelos m ON m.id = t.modelo_id
      WHERE ${where}
    `, countParams);

    // Adicionar limit e offset para a query de rows
    const rowsParams = [...params, limit, offset];

    const { rows } = await db.query(`
      SELECT
        t.*,
        m.nome AS modelo_nome
      FROM transacoes_agency t
      INNER JOIN modelos m ON m.id = t.modelo_id
      WHERE ${where}
      ORDER BY t.created_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `, rowsParams);

    res.json({
      rows,
      totalPages: Math.ceil(total / limit),
      page,
      totais: totaisQ.rows[0]
    });
  } catch (err) {
    console.error("Erro transações:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 14. PASSWORD RESETS ==========

router.post("/password-reset", authAdmin, async (req, res) => {
  try {
    const { user_id, email, nova_senha } = req.body;

    if ((!user_id && !email) || !nova_senha) {
      return res.status(400).json({ erro: "Informe user_id ou email, e nova_senha" });
    }

    if (nova_senha.length < 6) {
      return res.status(400).json({ erro: "Senha deve ter no mínimo 6 caracteres" });
    }

    let uid = user_id;

    if (!uid && email) {
      const found = await db.query(
        "SELECT id FROM users WHERE LOWER(email) = $1",
        [email.trim().toLowerCase()]
      );

      if (!found.rows.length) {
        return res.status(404).json({ erro: "Nenhum usuário encontrado com esse e-mail" });
      }

      uid = found.rows[0].id;
    }

    const hash = await bcrypt.hash(nova_senha, 10);

    const upd = await db.query(
      "UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2 RETURNING id",
      [hash, uid]
    );

    if (!upd.rows.length) {
      return res.status(404).json({ erro: "Usuário não encontrado" });
    }

    await db.query(
      "INSERT INTO admin_seguranca_historico (admin_id, motivo) VALUES ($1, $2)",
      [req.user.id, `Reset de senha do user #${uid}${email ? ` (${email})` : ''}`]
    );

    res.json({ ok: true, mensagem: "Senha resetada com sucesso" });
  } catch (err) {
    console.error("Erro reset senha:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/password-resets", authAdmin, async (req, res) => {
  try {
    const { limit, offset, page } = paginate(
      req.query,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );

    const countQ = await db.query("SELECT COUNT(*) FROM password_resets");
    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(
      "SELECT * FROM password_resets ORDER BY criado_em DESC LIMIT $1 OFFSET $2",
      [limit, offset]
    );

    res.json({ rows, totalPages: Math.ceil(total / limit), page });
  } catch (err) {
    console.error("Erro password-resets:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});
// ========== 15. VIP SUBSCRIPTIONS ==========

router.get("/vips", async (req, res) => {
  try {
    const { limit, offset, page } = paginate(req.query, Number(req.query.page) || 1, Number(req.query.limit) || 20);
    const busca = req.query.busca || "";

    let where = "1=1";
    const params = [];

    if (busca) {
      where = "v.cliente_id::text = $1";
      params.push(busca);
    }

    // COUNT
    const countParams = busca ? [busca] : [];
    const countWhere = busca ? "v.cliente_id::text = $1" : "1=1";
    const countQ = await db.query(`
      SELECT COUNT(*) FROM vip_subscriptions v WHERE ${countWhere}
    `, countParams);
    const total = Number(countQ.rows[0].count);

    // DATA
    params.push(limit, offset);
    const paramIndex = busca ? 2 : 1;
    const { rows } = await db.query(`
      SELECT v.*, m.nome AS modelo_nome
      FROM vip_subscriptions v
      LEFT JOIN modelos m ON m.id = v.modelo_id
      WHERE ${where}
      ORDER BY v.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `, params);

    res.json({ rows, totalPages: Math.ceil(total / limit), page });
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

router.get("/vip-subscriptions/:id", async (req, res) => {
  try {
    const { rows } = await db.query("SELECT * FROM vip_subscriptions WHERE id = $1", [req.params.id]);
    if (!rows.length) return res.status(404).json({ erro: "Não encontrado" });
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

router.put("/vip-subscriptions/:id", async (req, res) => {
  try {
    const { ativo, recorrente, valor_assinatura, valor_total, expiration_at } = req.body;
    const { rows } = await db.query(`
      UPDATE vip_subscriptions
      SET ativo = $1, recorrente = $2, valor_assinatura = $3, valor_total = $4, expiration_at = $5, updated_at = NOW()
      WHERE id = $6 RETURNING *
    `, [ativo, recorrente, valor_assinatura, valor_total, expiration_at, req.params.id]);
    res.json(rows[0]);
  } catch (err) { res.status(500).json({ erro: "Erro interno" }); }
});

// ========== 16. MODELO PAGAMENTOS ==========

router.get("/modelo-pagamentos", authAdmin, async (req, res) => {
  try {
    const { limit, offset, page } = paginate(
      req.query,
      Number(req.query.page) || 1,
      Number(req.query.limit) || 20
    );

    const modelo_id = req.query.modelo_id;

    let where = "1=1";
    const params = [limit, offset];
    let idx = 3;

    if (modelo_id) {
      where += ` AND p.modelo_id = $${idx}`;
      params.push(modelo_id);
      idx++;
    }

    let countWhere = "1=1";
    const countParams = [];
    let cidx = 1;

    if (modelo_id) {
      countWhere += ` AND p.modelo_id = $${cidx}`;
      countParams.push(modelo_id);
      cidx++;
    }

    const countQ = await db.query(
      `SELECT COUNT(*) FROM modelo_pagamentos p WHERE ${countWhere}`,
      countParams
    );

    const total = Number(countQ.rows[0].count);

    const { rows } = await db.query(`
      SELECT p.*, m.nome AS modelo_nome, m.nome_exibicao
      FROM modelo_pagamentos p
      LEFT JOIN modelos m ON m.id = p.modelo_id
      WHERE ${where}
      ORDER BY p.created_at DESC
      LIMIT $1 OFFSET $2
    `, params);

    for (const row of rows) {
      // Comprovativo de transferência/PIX carregado pelo admin
      row.comprovativo_signed_url = row.recibo_url
        ? s3Privado.getSignedUrl("getObject", {
            Bucket: process.env.R2_BUCKET_PRIVATE,
            Key: row.recibo_url,
            Expires: 300
          })
        : null;

      // PDF de recibo gerado automaticamente ao marcar como pago
      row.recibo_pdf_signed_url = row.recibo_pdf_url
        ? s3Privado.getSignedUrl("getObject", {
            Bucket: process.env.R2_BUCKET_PRIVATE,
            Key: row.recibo_pdf_url,
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
    console.error("Erro modelo-pagamentos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/modelo-pagamentos/:id", authAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM modelo_pagamentos WHERE id = $1`,
      [req.params.id]
    );

    if (!rows.length) {
      return res.status(404).json({ erro: "Não encontrado" });
    }

    const row = rows[0];

    row.comprovativo_signed_url = row.recibo_url
      ? s3Privado.getSignedUrl("getObject", {
          Bucket: process.env.R2_BUCKET_PRIVATE,
          Key: row.recibo_url,
          Expires: 300
        })
      : null;

    row.recibo_pdf_signed_url = row.recibo_pdf_url
      ? s3Privado.getSignedUrl("getObject", {
          Bucket: process.env.R2_BUCKET_PRIVATE,
          Key: row.recibo_pdf_url,
          Expires: 300
        })
      : null;

    res.json(row);
  } catch (err) {
    console.error("Erro detalhe modelo-pagamentos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/modelos-select", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, nome, nome_exibicao
      FROM modelos
      WHERE verificada = true
        AND ativo = true
      ORDER BY COALESCE(nome_exibicao, nome) ASC
    `);

    res.json(rows);
  } catch (err) {
    console.error("Erro ao buscar modelos do select:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.post("/modelo-pagamentos", authAdmin, upload.single("recibo"), async (req, res) => {
  try {
    const {
      modelo_id,
      mes,
      total_midias,
      total_assinaturas,
      total_geral,
      comissao_velvet,
      valor_liquido,
      chargebacks
    } = req.body;

    if (!modelo_id || !mes) {
      return res.status(400).json({ erro: "modelo_id e mês obrigatórios" });
    }

    const modeloIdNum = Number(modelo_id);
    const midias = Number(total_midias || 0);
    const assinaturas = Number(total_assinaturas || 0);
    let total = Number(total_geral || 0);

    if (!total) {
      total = midias + assinaturas;
    }

    const mesDate = `${mes}-01`;

    const ganhosRes = await db.query(`
      SELECT COALESCE(SUM(valor_modelo), 0) AS ganhos
      FROM transacoes_agency
      WHERE modelo_id = $1
        AND status = 'pago'
    `, [modeloIdNum]);

    const pagosRes = await db.query(`
      SELECT COALESCE(SUM(total_geral), 0) AS pagos
      FROM modelo_pagamentos
      WHERE modelo_id = $1
        AND status = 'pago'
    `, [modeloIdNum]);

    const ganhos = Number(ganhosRes.rows[0].ganhos || 0);
    const pagos = Number(pagosRes.rows[0].pagos || 0);
    const saldo = ganhos - pagos;

    if (total > saldo) {
      return res.status(400).json({
        erro: `Saldo insuficiente para este pagamento. Saldo disponível: ${saldo.toFixed(2)}`
      });
    }

    let recibo_url = null;

    if (req.file) {
      try {
        const key = `recibos/${modeloIdNum}/${Date.now()}-${req.file.originalname}`;

        await s3Privado.putObject({
          Bucket: process.env.R2_BUCKET_PRIVATE,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype
        }).promise();

        recibo_url = key;
      } catch (uploadErr) {
        console.warn("Aviso: upload de comprovativo falhou (B2 não configurado?):", uploadErr.message);
        // Continua sem o ficheiro — pagamento é registado na mesma
      }
    }

    const comissao    = Number(comissao_velvet || 0);
    const liquido     = Number(valor_liquido   || 0);
    const chargebacksVal = Number(chargebacks  || 0);

    const { rows } = await db.query(`
      INSERT INTO modelo_pagamentos
      (
        modelo_id,
        mes,
        total_midias,
        total_assinaturas,
        total_geral,
        status,
        recibo_url,
        comissao_velvet,
        valor_liquido,
        chargebacks
      )
      VALUES ($1, $2, $3, $4, $5, 'pendente', $6, $7, $8, $9)
      RETURNING *
    `, [
      modeloIdNum,
      mesDate,
      midias,
      assinaturas,
      total,
      recibo_url,
      comissao,
      liquido,
      chargebacksVal
    ]);

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro criar pgto modelo:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/modelo-pagamentos/saldo/:modelo_id", authAdmin, async (req, res) => {
  try {
    const modelo_id = Number(req.params.modelo_id);

    if (!modelo_id) {
      return res.status(400).json({ erro: "modelo_id inválido" });
    }

    const ganhosRes = await db.query(`
      SELECT COALESCE(SUM(valor_modelo), 0) AS ganhos
      FROM transacoes_agency
      WHERE modelo_id = $1
        AND status = 'pago'
    `, [modelo_id]);

    const pagosRes = await db.query(`
      SELECT COALESCE(SUM(total_geral), 0) AS pagos
      FROM modelo_pagamentos
      WHERE modelo_id = $1
        AND status = 'pago'
    `, [modelo_id]);

    const ganhos = Number(ganhosRes.rows[0].ganhos || 0);
    const pagos = Number(pagosRes.rows[0].pagos || 0);
    const saldo = ganhos - pagos;

    res.json({
      ganhos,
      pagos,
      saldo
    });
  } catch (err) {
    console.error("Erro saldo modelo-pagamentos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ── Helper: gerar PDF do recibo com PDFKit ──
function gerarReciboPDF(p) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const fmtBRL = v => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const W = 495;
    const reciboNum = String(p.id).padStart(6, '0');
    const dataEmissao = new Date().toLocaleDateString('pt-BR');
    const dataPagamento = p.pago_em ? new Date(p.pago_em).toLocaleDateString('pt-BR') : dataEmissao;
    const mesRefRaw = new Date(p.mes).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const mesRef = mesRefRaw.charAt(0).toUpperCase() + mesRefRaw.slice(1);
    const nomeCompleto = p.nome_completo || p.nome_exibicao || p.modelo_nome || `Modelo #${p.modelo_id}`;
    const cpf = p.titular_documento || '—';
    const endereco = [p.endereco, p.cidade, p.estado].filter(Boolean).join(', ') || '—';
    const modeloShare    = Number(p.total_geral      || 0);
    const taxaPlataforma = Number(p.taxa_plataforma  || p.comissao_velvet || 0);
    const taxaAgencia    = Number(p.taxa_agencia     || 0);
    const chargebacksVal = Number(p.chargebacks      || 0);
    const valorBruto     = Number(p.valor_bruto      || (modeloShare + taxaPlataforma + taxaAgencia));
    const liquido        = Number(p.valor_liquido    || (modeloShare - chargebacksVal));
    const pctAgenciaPct  = Number(p.pct_agencia_pct  || 0);
    // alias para retrocompatibilidade
    const comissao = taxaPlataforma;

    const pgtoTipoPDF = (p.pgto_tipo || '').toLowerCase() || (p.pix_chave ? 'pix' : p.banco ? 'transferencia' : null);
    let tipoPagamento = '—';
    if (pgtoTipoPDF === 'pix') tipoPagamento = `PIX — ${(p.pix_tipo || '').toUpperCase()}: ${p.pix_chave || '—'}`;
    else if (pgtoTipoPDF === 'transferencia') tipoPagamento = `TED — Banco: ${p.banco || '—'} | Ag: ${p.agencia || '—'} | Conta: ${p.conta || '—'}`;

    // ── Cabeçalho roxo ──
    doc.rect(50, 50, W, 55).fill('#7B2CFF');
    doc.fillColor('white').fontSize(16).font('Helvetica-Bold').text('VELVET ENTERTAINMENT LTDA', 65, 62);
    doc.fontSize(9).font('Helvetica').text('CNPJ: 66.615.892/0001-43  •  contato@velvet.lat', 65, 82);
    doc.fillColor('black');

    // ── Título + número ──
    doc.moveDown(3.5);
    doc.fontSize(18).font('Helvetica-Bold').text('RECIBO DE PAGAMENTO', 50, 125, { width: W, align: 'center' });
    doc.fontSize(10).font('Helvetica').fillColor('#555')
      .text(`Nº ${reciboNum}  •  Emitido em ${dataEmissao}  •  Referência: ${mesRef}`, 50, 148, { width: W, align: 'center' });
    doc.fillColor('black');

    // ── Linha divisória ──
    doc.moveTo(50, 168).lineTo(545, 168).strokeColor('#7B2CFF').lineWidth(1.5).stroke();

    // ── Dados beneficiário ──
    doc.rect(50, 178, W, 90).fill('#f9f5ff').stroke('#e0d4ff');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#7B2CFF').text('BENEFICIÁRIO', 65, 188);
    doc.fillColor('#222').fontSize(10).font('Helvetica-Bold').text(nomeCompleto, 65, 200);
    doc.fontSize(9).font('Helvetica')
      .text(`CPF/Doc: ${cpf}`, 65, 215)
      .text(`Endereço: ${endereco}`, 65, 228)
      .text(`ID Modelo: #${p.modelo_id}`, 65, 241);

    // ── Emissor (lado direito) ──
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#7B2CFF').text('EMISSOR', 320, 188);
    doc.fillColor('#222').fontSize(9).font('Helvetica')
      .text('Velvet Entertainment Ltda', 320, 200)
      .text('CNPJ: 66.615.892/0001-43', 320, 213)
      .text('R Cel José Eusébio, 95 casa 13', 320, 226)
      .text('Higienópolis — São Paulo/SP', 320, 239)
      .text('CEP 01.239-030', 320, 252);
    doc.fillColor('black');

    // ── Tabela de itens ──
    const tY = 280;
    doc.rect(50, tY, W, 20).fill('#7B2CFF');
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
      .text('DESCRIÇÃO', 65, tY + 6)
      .text('PERÍODO', 310, tY + 6)
      .text('VALOR BRUTO', 430, tY + 6, { width: 100, align: 'right' });
    doc.fillColor('black');

    let rowY = tY + 20;
    const linhas = [];
    if (Number(p.total_midias) > 0) linhas.push({ desc: 'Receitas brutas — Mídias', valor: Number(p.total_midias) });
    if (Number(p.total_assinaturas) > 0) linhas.push({ desc: 'Receitas brutas — Assinaturas', valor: Number(p.total_assinaturas) });
    if (!linhas.length) linhas.push({ desc: 'Receitas brutas — Plataforma Velvet', valor: modeloShare });

    linhas.forEach((l, i) => {
      if (i % 2 === 0) doc.rect(50, rowY, W, 20).fill('#f9f5ff');
      doc.fillColor('#222').fontSize(9).font('Helvetica')
        .text(l.desc, 65, rowY + 5)
        .text(mesRef, 310, rowY + 5)
        .text(fmtBRL(l.valor), 430, rowY + 5, { width: 100, align: 'right' });
      rowY += 20;
    });

    // ── Breakdown financeiro ──
    const bY = rowY + 10;

    // calcular altura dinâmica conforme linhas visíveis
    let bLinhas = 1; // valor bruto sempre
    if (chargebacksVal > 0) bLinhas++;
    const bH = 18 + bLinhas * 16 + 24; // header + linhas + separador + total

    doc.rect(310, bY, W - 260, bH).fill('#f9f5ff').stroke('#e0d4ff');

    let bLineY = bY + 8;
    doc.fontSize(9).font('Helvetica').fillColor('#555');

    // Valor bruto
    doc.text('Valor bruto:', 320, bLineY)
       .text(fmtBRL(modeloShare), 430, bLineY, { width: 110, align: 'right' });
    bLineY += 16;

    // Chargebacks / estornos
    if (chargebacksVal > 0) {
      doc.text('Chargebacks / estornos:', 320, bLineY)
         .text(`- ${fmtBRL(chargebacksVal)}`, 430, bLineY, { width: 110, align: 'right' });
      bLineY += 16;
    }

    // Separador + total líquido
    doc.moveTo(320, bLineY + 2).lineTo(540, bLineY + 2).strokeColor('#7B2CFF').lineWidth(0.8).stroke();
    doc.fontSize(11).font('Helvetica-Bold').fillColor('#7B2CFF')
      .text('VALOR LÍQUIDO PAGO:', 320, bLineY + 8)
      .text(fmtBRL(liquido), 430, bLineY + 8, { width: 110, align: 'right' });
    doc.fillColor('black');

    const bBoxBottom = bLineY + 30;

    // ── Dados do pagamento ──
    const pY = bBoxBottom + 10;
    doc.rect(50, pY, W, 45).fill('#f0fff4').stroke('#c3e6cb');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#27a745').text('DADOS DO PAGAMENTO', 65, pY + 7);
    doc.fillColor('#222').fontSize(9).font('Helvetica')
      .text(`Data: ${dataPagamento}`, 65, pY + 20)
      .text(`Forma: ${tipoPagamento}`, 65, pY + 33);
    doc.fillColor('black');

    // ── Rodapé ──
    const fY = pY + 65;
    doc.moveTo(50, fY).lineTo(545, fY).strokeColor('#ddd').lineWidth(0.5).stroke();
    doc.fontSize(8).fillColor('#888').font('Helvetica')
      .text('Este documento comprova o repasse de receitas geradas na plataforma Velvet.', 50, fY + 8, { width: W, align: 'center' })
      .text('Velvet Entertainment Ltda — CNPJ: 66.615.892/0001-43 — São Paulo/SP', 50, fY + 20, { width: W, align: 'center' })
      .text(`Documento gerado automaticamente em ${dataEmissao}`, 50, fY + 32, { width: W, align: 'center' });

    doc.end();
  });
}

router.post("/modelo-pagamentos/:id/pagar", authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { comissao_velvet, valor_liquido } = req.body;

    // 1. Buscar todos os dados do pagamento + modelo + agência
    const { rows } = await db.query(`
      SELECT
        mp.*,
        m.nome AS modelo_nome, m.nome_exibicao,
        md.nome_completo, md.endereco, md.cidade, md.estado,
        mdb.tipo AS pgto_tipo, mdb.pix_tipo, mdb.pix_chave,
        mdb.banco, mdb.agencia AS banco_agencia, mdb.conta, mdb.conta_tipo, mdb.titular_documento,
        u.email AS modelo_email,
        au.email AS admin_email,
        COALESCE(ag.percentual_agencia, 0)    AS pct_agencia,
        COALESCE(ag.percentual_plataforma, 0.20) AS pct_plataforma,
        ag.nome AS agencia_nome
      FROM modelo_pagamentos mp
      LEFT JOIN modelos m ON m.id = mp.modelo_id
      LEFT JOIN modelos_dados md ON md.modelo_id = mp.modelo_id
      LEFT JOIN modelo_dados_bancarios mdb ON mdb.modelo_id = mp.modelo_id AND mdb.status = 'aprovado'
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN users au ON au.id = $2
      LEFT JOIN agencias ag ON ag.id = m.agencia_id
      WHERE mp.id = $1
    `, [id, req.user.id]);

    if (!rows.length) return res.status(404).json({ erro: 'Pagamento não encontrado' });

    const p = rows[0];

    // ── Breakdown financeiro ────────────────────────────────────────────
    // total_geral = valor_modelo_share (saldo líquido já sem taxas)
    // valor_bruto = gross que os clientes pagaram pelo conteúdo da modelo
    const pctPlataforma = Number(p.pct_plataforma || 0.20);   // sempre 20%
    const pctAgencia    = Number(p.pct_agencia    || 0);       // 0 se sem agência
    const pctModelo     = 1 - pctPlataforma - pctAgencia;      // ex: 0.70 ou 0.80

    const modeloShare  = Number(p.total_geral || 0);           // saldo líquido da modelo
    const valorBruto   = pctModelo > 0 ? modeloShare / pctModelo : modeloShare;
    const taxaPlataforma = valorBruto * pctPlataforma;          // 20% do bruto
    const taxaAgencia    = valorBruto * pctAgencia;             // % da agência (0 se sem agência)
    const chargebacksVal = Number(p.chargebacks || 0);          // deduções manuais
    const comissao       = taxaPlataforma;                      // alias para compatibilidade
    const liquido        = modeloShare - chargebacksVal;        // valor efectivamente transferido

    // 2. Gerar PDF
    const dadosPDF = {
      ...p,
      valor_bruto:      valorBruto,
      taxa_plataforma:  taxaPlataforma,
      taxa_agencia:     taxaAgencia,
      pct_agencia_pct:  pctAgencia * 100,   // ex: 10 (%)
      chargebacks:      chargebacksVal,
      comissao_velvet:  comissao,
      valor_liquido:    liquido,
      pago_em:          new Date()
    };
    const pdfBuffer = await gerarReciboPDF(dadosPDF);

    // 3. Guardar PDF no R2 privado
    let pdfKey = null;
    try {
      pdfKey = `recibos/${p.modelo_id}/${id}-recibo-${Date.now()}.pdf`;
      await s3Privado.putObject({
        Bucket: process.env.R2_BUCKET_PRIVATE,
        Key: pdfKey,
        Body: pdfBuffer,
        ContentType: 'application/pdf'
      }).promise();
    } catch (uploadErr) {
      console.warn('Aviso: upload do PDF falhou:', uploadErr.message);
      pdfKey = null;
    }

    // 4. Atualizar DB com todos os campos de compliance
    //    recibo_pdf_url = PDF gerado; recibo_url = comprovativo carregado (não tocar)
    await db.query(`
      UPDATE modelo_pagamentos
      SET
        status          = 'pago',
        pago_em         = NOW(),
        comissao_velvet = $2,
        taxa_agencia    = $3,
        chargebacks     = $4,
        valor_liquido   = $5,
        admin_id        = $6,
        pago_por        = $7,
        recibo_pdf_url  = COALESCE($8, recibo_pdf_url)
      WHERE id = $1
    `, [id, taxaPlataforma, taxaAgencia, chargebacksVal, liquido,
        req.user.id, p.admin_email || `admin#${req.user.id}`, pdfKey]);

    // 5. Registar no histórico de recibos
    try {
      const reciboNum = String(p.id).padStart(6, '0');
      await db.query(
        `INSERT INTO recibos_pagamento (pagamento_id, modelo_id, numero_recibo) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [p.id, p.modelo_id, reciboNum]
      );
    } catch (_) {}

    // 6. Enviar email à modelo com PDF em anexo
    if (p.modelo_email) {
      try {
        const mesRefRaw = new Date(p.mes).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
        const mesRef = mesRefRaw.charAt(0).toUpperCase() + mesRefRaw.slice(1);
        const fmtBRL = v => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        const nomeModelo = p.nome_completo || p.nome_exibicao || p.modelo_nome || 'Modelo';
        const reciboNum = String(p.id).padStart(6, '0');

        await _resendPagamentos.emails.send({
          from: 'Velvet <contato@velvet.lat>',
          to: p.modelo_email,
          subject: `💜 Recibo de pagamento — ${mesRef}`,
          html: `
            <div style="font-family:Arial,Helvetica,sans-serif;background:#f0ebfa;padding:32px 16px;color:#2d1f3d;">
              <div style="max-width:600px;margin:0 auto;">
                <div style="background:linear-gradient(135deg,#7B2CFF 0%,#a94cff 100%);border-radius:14px 14px 0 0;padding:20px 32px;text-align:center;">
                  <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:1px;">💜 Velvet</span>
                </div>
                <div style="background:#fff;padding:32px;border-radius:0 0 14px 14px;border:1px solid #e5d9ff;border-top:none;">
                  <h2 style="color:#7B2CFF;margin:0 0 16px;">Olá, ${nomeModelo}!</h2>
                  <p style="margin:0 0 16px;line-height:1.6;">O seu pagamento referente a <strong>${mesRef}</strong> foi processado. Segue o recibo em anexo.</p>
                  <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
                    <tr style="background:#f9f5ff;">
                      <td style="padding:10px 14px;font-weight:600;color:#7B2CFF;">Recibo Nº</td>
                      <td style="padding:10px 14px;">#${reciboNum}</td>
                    </tr>
                    <tr>
                      <td style="padding:10px 14px;font-weight:600;color:#7B2CFF;">Referência</td>
                      <td style="padding:10px 14px;">${mesRef}</td>
                    </tr>
                    <tr style="background:#f9f5ff;">
                      <td style="padding:10px 14px;font-weight:600;color:#7B2CFF;">Valor bruto</td>
                      <td style="padding:10px 14px;">${fmtBRL(valorBruto)}</td>
                    </tr>
                    ${comissao > 0 ? `
                    <tr>
                      <td style="padding:10px 14px;font-weight:600;color:#7B2CFF;">Comissão Velvet</td>
                      <td style="padding:10px 14px;">- ${fmtBRL(comissao)}</td>
                    </tr>` : ''}
                    <tr style="background:#f0fff4;">
                      <td style="padding:12px 14px;font-weight:700;color:#27a745;font-size:15px;">Valor recebido</td>
                      <td style="padding:12px 14px;font-weight:700;color:#27a745;font-size:15px;">${fmtBRL(liquido)}</td>
                    </tr>
                  </table>
                  <p style="margin:16px 0 0;font-size:13px;color:#888;">Guarde este recibo para os seus registos fiscais. Em caso de dúvidas, contacte <a href="mailto:contato@velvet.lat" style="color:#7B2CFF;">contato@velvet.lat</a></p>
                  <div style="margin-top:28px;padding-top:18px;border-top:1px solid #f0ebfa;text-align:center;">
                    <p style="margin:0 0 4px;color:#6b5a7d;">Equipe Velvet 💜</p>
                  </div>
                </div>
              </div>
            </div>
          `,
          attachments: [{
            filename: `recibo-velvet-${reciboNum}.pdf`,
            content: pdfBuffer.toString('base64')
          }]
        });
      } catch (emailErr) {
        console.warn('Email de recibo não enviado:', emailErr.message);
        // Não falha o pagamento se o email falhar
      }
    }

    // Gerar URL assinada do PDF para abrir directamente no frontend
    const recibo_pdf_signed_url = pdfKey
      ? s3Privado.getSignedUrl("getObject", {
          Bucket: process.env.R2_BUCKET_PRIVATE,
          Key: pdfKey,
          Expires: 300
        })
      : null;

    res.json({ ok: true, id: Number(id), recibo_pdf_signed_url });
  } catch (err) {
    console.error("Erro pagar modelo-pagamento:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ===== RECIBO DE PAGAMENTO =====
router.get("/modelo-pagamentos/:id/recibo", authAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    const { rows } = await db.query(`
      SELECT mp.id, mp.modelo_id, mp.mes, mp.total_midias, mp.total_assinaturas,
             mp.total_geral, mp.status, mp.pago_em,
             mp.comissao_velvet, mp.taxa_agencia, mp.chargebacks, mp.valor_liquido,
             m.nome AS modelo_nome, m.nome_exibicao,
             md.nome_completo, md.endereco, md.cidade, md.estado,
             mdb.tipo AS pgto_tipo, mdb.pix_tipo, mdb.pix_chave,
             mdb.banco, mdb.agencia, mdb.conta, mdb.conta_tipo, mdb.titular_documento,
             COALESCE(ag.percentual_agencia, 0)      AS pct_agencia,
             COALESCE(ag.percentual_plataforma, 0.20) AS pct_plataforma,
             ag.nome AS agencia_nome
      FROM modelo_pagamentos mp
      LEFT JOIN modelos m ON m.id = mp.modelo_id
      LEFT JOIN modelos_dados md ON md.modelo_id = mp.modelo_id
      LEFT JOIN modelo_dados_bancarios mdb ON mdb.modelo_id = mp.modelo_id
      LEFT JOIN agencias ag ON ag.id = m.agencia_id
      WHERE mp.id = $1
    `, [id]);

    if (!rows.length) return res.status(404).send('<h3>Pagamento não encontrado</h3>');

    const p = rows[0];
    const nomeCompleto = p.nome_completo || p.nome_exibicao || p.modelo_nome || `Modelo #${p.modelo_id}`;
    const cpf           = p.titular_documento || '—';
    const endereco      = p.endereco || '—';
    const local         = [p.cidade, p.estado].filter(Boolean).join(' - ') || '—';
    const dataEmissao   = new Date().toLocaleDateString('pt-BR');
    const mesRefRaw     = new Date(p.mes).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    const mesRefLabel   = mesRefRaw.charAt(0).toUpperCase() + mesRefRaw.slice(1);
    const reciboNum     = String(p.id).padStart(6, '0');
    const dataPagamento = p.pago_em ? new Date(p.pago_em).toLocaleDateString('pt-BR') : '—';
    const fmtBRL = v => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const pgtoTipo = (p.pgto_tipo || '').toLowerCase() || (p.pix_chave ? 'pix' : p.banco ? 'transferencia' : null);
    let tipoPagamento = '—';
    if (pgtoTipo === 'pix') tipoPagamento = `PIX — ${(p.pix_tipo || '').toUpperCase()}: ${p.pix_chave || '—'}`;
    else if (pgtoTipo === 'transferencia') tipoPagamento = `TED — Banco: ${p.banco || '—'} | Ag: ${p.agencia || '—'} | Conta: ${p.conta || '—'}${p.conta_tipo ? ' (' + p.conta_tipo + ')' : ''}`;

    // ── Breakdown financeiro ──
    const modeloShare    = Number(p.total_geral    || 0);
    const pctPlataforma  = Number(p.pct_plataforma || 0.20);
    const pctAgencia     = Number(p.pct_agencia    || 0);
    const pctModelo      = 1 - pctPlataforma - pctAgencia;
    const taxaPlataforma = Number(p.comissao_velvet || 0) || (pctModelo > 0 ? (modeloShare / pctModelo) * pctPlataforma : 0);
    const taxaAgencia    = Number(p.taxa_agencia    || 0) || (pctModelo > 0 ? (modeloShare / pctModelo) * pctAgencia : 0);
    const chargebacksVal = Number(p.chargebacks     || 0);
    const valorBruto     = modeloShare + taxaPlataforma + taxaAgencia;
    const liquido        = Number(p.valor_liquido   || 0) || (modeloShare - chargebacksVal);
    const pctAgenciaPct  = Math.round(pctAgencia * 100);

    // Linhas da tabela — ganhos da modelo
    const linhas = [];
    if (Number(p.total_midias) > 0) linhas.push({ descricao: 'Receitas brutas — Mídias', periodo: mesRefLabel, valor: Number(p.total_midias) });
    if (Number(p.total_assinaturas) > 0) linhas.push({ descricao: 'Receitas brutas — Assinaturas', periodo: mesRefLabel, valor: Number(p.total_assinaturas) });
    if (linhas.length === 0) linhas.push({ descricao: 'Receitas brutas — Plataforma Velvet', periodo: mesRefLabel, valor: modeloShare });
    const linhasHtml = linhas.map(l => `<tr><td class="c">1</td><td>${l.descricao}</td><td class="c">${l.periodo}</td><td class="r">${fmtBRL(l.valor)}</td></tr>`).join('');

    // Linhas do breakdown de deduções
    const deducoesHtml = [
      `<div class="totrow"><span>Valor bruto</span><span>${fmtBRL(modeloShare)}</span></div>`,
      chargebacksVal > 0 ? `<div class="totrow ded"><span>Chargebacks / estornos</span><span>- ${fmtBRL(chargebacksVal)}</span></div>` : '',
      `<div class="totrow f"><span>VALOR LÍQUIDO PAGO</span><span>${fmtBRL(liquido)}</span></div>`
    ].filter(Boolean).join('');

    try { await db.query(`INSERT INTO recibos_pagamento (pagamento_id, modelo_id, numero_recibo) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [p.id, p.modelo_id, reciboNum]); } catch (_) {}

    res.send(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<base href="${baseUrl}/">
<title>Recibo #${reciboNum} — Velvet</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Segoe UI',Arial,sans-serif;background:#f0f0f0;padding:20px;color:#222;font-size:13px}
.page{background:#fff;max-width:800px;margin:0 auto;padding:40px 50px;box-shadow:0 4px 20px rgba(0,0,0,.15)}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #7B2CFF;padding-bottom:20px;margin-bottom:24px}
.logo img{width:140px}.ei{text-align:right}.ei h2{color:#7B2CFF;font-size:17px;font-weight:700}.ei p{color:#555;font-size:11px;line-height:1.7;margin-top:4px}
.ts{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:24px}.ts h1{font-size:24px;font-weight:700;letter-spacing:1px}
.rm{text-align:right}.rm table{border-collapse:collapse;margin-left:auto}.rm td{padding:3px 8px;font-size:12px}.rm td:first-child{color:#888;font-weight:600}.rm td:last-child{font-weight:700}
.stamp{display:inline-block;border:2px solid #7B2CFF;color:#7B2CFF;padding:3px 14px;font-size:10px;font-weight:700;letter-spacing:2px;border-radius:3px;margin-top:8px}
.cs{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px;background:#f9f5ff;padding:16px 20px;border-radius:8px;border-left:4px solid #7B2CFF}
.cs h4{color:#7B2CFF;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px}.cs p{font-size:12px;color:#333;line-height:1.8}.cs p strong{color:#111}
table.pt{width:100%;border-collapse:collapse;margin-bottom:20px}table.pt th{background:#7B2CFF;color:#fff;padding:10px 12px;text-align:left;font-size:12px;font-weight:600}
table.pt th.c,table.pt td.c{text-align:center}table.pt th.r,table.pt td.r{text-align:right}table.pt td{padding:10px 12px;border-bottom:1px solid #eee;font-size:12px}table.pt tr:nth-child(even) td{background:#faf7ff}
.tot{display:flex;justify-content:flex-end;margin-bottom:24px}.totbox{border:2px solid #7B2CFF;border-radius:6px;padding:14px 20px;min-width:300px}
.totrow{display:flex;justify-content:space-between;padding:5px 0;font-size:13px;gap:16px}
.totrow.ded{color:#c0392b;font-size:12px}
.totrow.f{border-top:2px solid #7B2CFF;margin-top:8px;padding-top:10px;font-size:15px;font-weight:700;color:#7B2CFF}
.pi{background:#f0f9f0;border:1px solid #c3e6cb;border-radius:6px;padding:14px 18px;margin-bottom:24px}.pi h4{color:#27a745;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px}.pi p{font-size:12px;color:#333;line-height:1.8}
.ft{border-top:1px solid #ddd;padding-top:14px;text-align:center;color:#888;font-size:10px;line-height:1.7}
.pbtn{display:block;margin:20px auto 0;padding:10px 32px;background:#7B2CFF;color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600}
@media print{body{background:#fff;padding:0}.page{box-shadow:none;padding:20px}.pbtn{display:none}}
</style></head><body>
<div class="page">
  <div class="hdr"><div class="logo"><img src="assets/velvet.png" alt="Velvet"></div>
    <div class="ei"><h2>Velvet Entertainment Ltda</h2><p>CNPJ: 66.615.892/0001-43<br>R Cel José Eusébio, 95 casa 13 — Higienópolis<br>São Paulo — SP — CEP 01.239-030<br>Tel: (11) 97752-7031</p></div></div>
  <div class="ts"><h1>RECIBO DE PAGAMENTO</h1>
    <div class="rm"><table><tr><td>RECIBO Nº</td><td>#${reciboNum}</td></tr><tr><td>DATA</td><td>${dataEmissao}</td></tr><tr><td>REFERÊNCIA</td><td>${mesRefLabel}</td></tr></table><div class="stamp">ORIGINAL</div></div></div>
  <div class="cs">
    <div><h4>Dados do Beneficiário</h4><p><strong>Nº Cliente:</strong> ${p.modelo_id}<br><strong>Nome:</strong> ${nomeCompleto}<br><strong>CPF/Doc:</strong> ${cpf}<br><strong>Endereço:</strong> ${endereco}<br><strong>Local:</strong> ${local}</p></div>
    <div><h4>Emissor</h4><p><strong>Empresa:</strong> Velvet Entertainment Ltda<br><strong>CNPJ:</strong> 66.615.892/0001-43<br><strong>Endereço:</strong> R Cel José Eusébio, 95 casa 13<br><strong>Local:</strong> Higienópolis — São Paulo/SP — CEP 01.239-030</p></div>
  </div>
  <table class="pt"><thead><tr><th class="c" style="width:50px">QTD</th><th>Descrição</th><th class="c" style="width:150px">Período</th><th class="r" style="width:110px">Valor Bruto</th></tr></thead><tbody>${linhasHtml}</tbody></table>
  <div class="tot"><div class="totbox">${deducoesHtml}</div></div>
  <div class="pi"><h4>Dados do Pagamento</h4><p><strong>Data:</strong> ${dataPagamento} &nbsp; <strong>Valor líquido:</strong> ${fmtBRL(liquido)} &nbsp; <strong>Forma:</strong> ${tipoPagamento}</p></div>
  <div class="ft"><p>Este documento comprova o repasse de receitas geradas na plataforma Velvet.</p><p>Velvet Entertainment Ltda — CNPJ: 66.615.892/0001-43 — R Cel José Eusébio, 95 casa 13, Higienópolis, São Paulo/SP — CEP 01.239-030</p></div>
</div>
<button class="pbtn" onclick="window.print()">🖨️ Salvar / Imprimir PDF</button>
</body></html>`);
  } catch (err) {
    console.error("Erro recibo:", err);
    res.status(500).send('<h3>Erro ao gerar recibo</h3>');
  }
});

router.put("/modelo-pagamentos/:id", authAdmin, async (req, res) => {
  try {
    const { total_midias, total_assinaturas, total_geral, status, recibo_url } = req.body;

    const { rows } = await db.query(`
      UPDATE modelo_pagamentos
      SET
        total_midias = $1,
        total_assinaturas = $2,
        total_geral = $3,
        status = $4,
        recibo_url = $5,
        pago_em = CASE
          WHEN $4 = 'pago' AND pago_em IS NULL THEN NOW()
          WHEN $4 <> 'pago' THEN NULL
          ELSE pago_em
        END
      WHERE id = $6
      RETURNING *
    `, [
      Number(total_midias || 0),
      Number(total_assinaturas || 0),
      Number(total_geral || 0),
      status,
      recibo_url || null,
      req.params.id
    ]);

    if (!rows.length) {
      return res.status(404).json({ erro: "Pagamento não encontrado" });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro atualizar modelo-pagamento:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

// ========== 16. AGÊNCIAS ==========

router.get("/agencias-list", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        id,
        nome,
        COALESCE(email, '') AS email,
        COALESCE(percentual_agencia, 0) * 100 AS percentual_agencia,
        COALESCE(percentual_modelo, 0) * 100 AS percentual_modelo,
        COALESCE(percentual_plataforma, 0) * 100 AS percentual_plataforma,
        created_at
      FROM agencias
      ORDER BY id DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("Erro /agencias-list:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.get("/agencias/:agenciaId/modelos", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        id,
        nome,
        agencia_id,
        agencia_desde
      FROM modelos
      WHERE agencia_id = $1
      ORDER BY nome
    `, [req.params.agenciaId]);

    res.json(rows);
  } catch (err) {
    console.error("Erro /agencias/:agenciaId/modelos:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.put("/agencias/:id", authAdmin, async (req, res) => {
  try {
    const agenciaId = Number(req.params.id);
    const { percentual_agencia, percentual_modelo, percentual_plataforma } = req.body;

    const admin_id = req.user?.id;
    const user_id = req.user?.id;

    if (!agenciaId) {
      return res.status(400).json({ erro: "Agência inválida" });
    }

    const agenciaAtual = await db.query(
      `SELECT nome, percentual_agencia, percentual_modelo, percentual_plataforma FROM agencias WHERE id = $1`,
      [agenciaId]
    );

    if (!agenciaAtual.rows.length) {
      return res.status(404).json({ erro: "Agência não encontrada" });
    }

    const { nome, percentual_agencia: percAntigo, percentual_modelo: percModeloAntigo, percentual_plataforma: percPlatAntigo } = agenciaAtual.rows[0];

    const { rows } = await db.query(`
      UPDATE agencias
      SET
        percentual_agencia = $1,
        percentual_modelo = $2,
        percentual_plataforma = $3
      WHERE id = $4
      RETURNING id, nome, percentual_agencia, percentual_modelo, percentual_plataforma
    `, [
      percentual_agencia ? Number(percentual_agencia) / 100 : 0,
      percentual_modelo ? Number(percentual_modelo) / 100 : 0,
      percentual_plataforma ? Number(percentual_plataforma) / 100 : 0,
      agenciaId
    ]);

    const motivo = `Alteração de percentuais da agência ${nome}: Agência ${(percAntigo * 100).toFixed(0)}% → ${percentual_agencia}%, Modelo ${(percModeloAntigo * 100).toFixed(0)}% → ${percentual_modelo}%, Plataforma ${(percPlatAntigo * 100).toFixed(0)}% → ${percentual_plataforma}%`;

    await db.query(`
      INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
      VALUES ($1, $2, NOW(), $3, $4, $5)
    `, [admin_id, motivo, user_id, 'admin', 'alteracao_percentuais_agencia']);

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao alterar agência:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.put("/modelos/:id/agencia", authAdmin, async (req, res) => {
  try {
    const modeloId = Number(req.params.id);
    const agencia_id = req.body.agencia_id ? Number(req.body.agencia_id) : null;

    const admin_id = req.user?.id;
    const user_id = req.user?.id;

    console.log("DEBUG - modeloId:", modeloId, "agencia_id:", agencia_id, "admin_id:", admin_id);

    if (!modeloId) {
      return res.status(400).json({ erro: "Modelo inválido" });
    }

    if (!admin_id || !user_id) {
      return res.status(401).json({ erro: "Usuário não autenticado" });
    }

    if (agencia_id !== null) {
      const agenciaExiste = await db.query(
        `SELECT id FROM agencias WHERE id = $1 LIMIT 1`,
        [agencia_id]
      );

      if (!agenciaExiste.rows.length) {
        return res.status(404).json({ erro: "Agência não encontrada" });
      }
    }

    const modeloAtual = await db.query(
      `SELECT agencia_id, nome FROM modelos WHERE id = $1`,
      [modeloId]
    );

    if (!modeloAtual.rows.length) {
      return res.status(404).json({ erro: "Modelo não encontrada" });
    }

    const agenciaAnterior = modeloAtual.rows[0]?.agencia_id;
    const nomeModelo = modeloAtual.rows[0]?.nome;

    const { rows } = await db.query(`
      UPDATE modelos
      SET
        agencia_id = $1::integer,
        agencia_desde = CASE
          WHEN $1::integer IS NULL THEN NULL
          WHEN agencia_id IS DISTINCT FROM $1::integer THEN NOW()
          ELSE agencia_desde
        END,
        atualizado_em = NOW()
      WHERE id = $2
      RETURNING id, nome, agencia_id, agencia_desde
    `, [agencia_id, modeloId]);

    if (!rows.length) {
      return res.status(500).json({ erro: "Falha ao atualizar modelo" });
    }

    const motivo = `Alteração de agência da modelo ${nomeModelo}: ${agenciaAnterior || 'Sem agência'} → ${agencia_id || 'Sem agência'}`;

    try {
      await db.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, motivo, user_id, 'admin', 'alteracao_agencia_modelo']);
    } catch (logErr) {
      console.error("Erro ao registrar no log:", logErr);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao alterar agência da modelo:", err.message);
    res.status(500).json({ erro: "Erro interno: " + err.message });
  }
});

router.post("/agencias", authAdmin, async (req, res) => {
  try {
    let { nome, email, senha, percentual_agencia, percentual_modelo, percentual_plataforma } = req.body;

    const admin_id = req.user?.id;
    const user_id = req.user?.id;

    // Validações
    if (!nome || nome.trim() === '') {
      return res.status(400).json({ erro: "Nome da agência é obrigatório" });
    }

    if (!senha || senha.trim() === '') {
      return res.status(400).json({ erro: "Senha é obrigatória" });
    }

    if (!admin_id || !user_id) {
      return res.status(401).json({ erro: "Usuário não autenticado" });
    }

    // Converter percentuais para números
    percentual_agencia = percentual_agencia !== undefined && percentual_agencia !== null && percentual_agencia !== '' 
      ? Number(percentual_agencia) 
      : 0;
    percentual_modelo = percentual_modelo !== undefined && percentual_modelo !== null && percentual_modelo !== '' 
      ? Number(percentual_modelo) 
      : 0;
    percentual_plataforma = percentual_plataforma !== undefined && percentual_plataforma !== null && percentual_plataforma !== '' 
      ? Number(percentual_plataforma) 
      : 0;

    if (isNaN(percentual_agencia) || isNaN(percentual_modelo) || isNaN(percentual_plataforma)) {
      return res.status(400).json({ erro: "Percentuais devem ser números válidos" });
    }

    // Hash da senha com bcrypt
    const senhaHash = await bcrypt.hash(senha, 10);

    // Inserir nova agência
    const { rows } = await db.query(`
      INSERT INTO agencias (nome, email, senha, percentual_agencia, percentual_modelo, percentual_plataforma)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, nome, email, percentual_agencia, percentual_modelo, percentual_plataforma, created_at
    `, [
      nome.trim(),
      email && email.trim() ? email.trim() : null,
      senhaHash,
      percentual_agencia / 100,
      percentual_modelo / 100,
      percentual_plataforma / 100
    ]);

    if (!rows.length) {
      return res.status(500).json({ erro: "Falha ao criar agência" });
    }

    // Registrar no log
    const motivo = `Nova agência criada: ${nome}. Percentuais - Agência: ${percentual_agencia}%, Modelo: ${percentual_modelo}%, Plataforma: ${percentual_plataforma}%`;

    try {
      await db.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, motivo, user_id, 'admin', 'criacao_agencia']);
    } catch (logErr) {
      console.error("Erro ao registrar no log:", logErr);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao criar agência:", err.message);
    res.status(500).json({ erro: "Erro interno: " + err.message });
  }
});

// ==================== 17. CHARGEBACKS ====================

router.get("/chargebacks-list", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        id,
        plataforma,
        valor,
        data,
        status,
        motivo,
        comprovante,
        criado_em
      FROM chargebacks
      ORDER BY data DESC
    `);

    res.json(rows);
  } catch (err) {
    console.error("Erro /chargebacks-list:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.post("/chargebacks", authAdmin, uploadPublico.single('comprovante'), async (req, res) => {
  try {
    let { plataforma, valor, data, motivo } = req.body;
    const comprovante = req.file ? req.file.location : null;

    const admin_id = req.user?.id;
    const user_id = req.user?.id;

    // Validações
    if (!plataforma || !['pagarme', 'stripe'].includes(plataforma)) {
      return res.status(400).json({ erro: "Plataforma inválida" });
    }

    if (!valor || isNaN(valor) || valor <= 0) {
      return res.status(400).json({ erro: "Valor inválido" });
    }

    if (!data) {
      return res.status(400).json({ erro: "Data é obrigatória" });
    }

    if (!comprovante) {
      return res.status(400).json({ erro: "Comprovante é obrigatório" });
    }

    if (!admin_id || !user_id) {
      return res.status(401).json({ erro: "Usuário não autenticado" });
    }

    valor = Number(valor);

    const { rows } = await db.query(`
      INSERT INTO chargebacks (plataforma, valor, data, motivo, comprovante)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, plataforma, valor, data, status, motivo, comprovante, criado_em
    `, [plataforma, valor, data, motivo || null, comprovante]);

    if (!rows.length) {
      return res.status(500).json({ erro: "Falha ao registrar chargeback" });
    }

    // Registrar no log
    const motevoLog = `Chargeback registrado: ${plataforma} - R$ ${valor.toFixed(2)}`;

    try {
      await db.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, motevoLog, user_id, 'admin', 'chargeback_novo']);
    } catch (logErr) {
      console.error("Erro ao registrar no log:", logErr);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao criar chargeback:", err.message);
    res.status(500).json({ erro: "Erro interno: " + err.message });
  }
});

router.delete("/chargebacks/:id", authAdmin, async (req, res) => {
  try {
    const chargebackId = Number(req.params.id);

    const admin_id = req.user?.id;
    const user_id = req.user?.id;

    if (!chargebackId) {
      return res.status(400).json({ erro: "Chargeback inválido" });
    }

    if (!admin_id || !user_id) {
      return res.status(401).json({ erro: "Usuário não autenticado" });
    }

    const chargeback = await db.query(
      `SELECT plataforma, valor FROM chargebacks WHERE id = $1`,
      [chargebackId]
    );

    if (!chargeback.rows.length) {
      return res.status(404).json({ erro: "Chargeback não encontrado" });
    }

    await db.query(`DELETE FROM chargebacks WHERE id = $1`, [chargebackId]);

    // Registrar no log
    const motevoLog = `Chargeback deletado: ${chargeback.rows[0].plataforma} - R$ ${chargeback.rows[0].valor.toFixed(2)}`;

    try {
      await db.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, motevoLog, user_id, 'admin', 'chargeback_deletado']);
    } catch (logErr) {
      console.error("Erro ao registrar no log:", logErr);
    }

    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao deletar chargeback:", err.message);
    res.status(500).json({ erro: "Erro interno: " + err.message });
  }
});

// ==================== 18. FATURAMENTOS ====================
 
router.get("/faturamentos-list", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        id,
        plataforma,
        mes,
        valor_total,
        taxas,
        chargeback,
        estornos,
        valor_liquido,
        arquivo,
        criado_em
      FROM faturamentos
      ORDER BY mes DESC
    `);
 
    res.json(rows);
  } catch (err) {
    console.error("Erro /faturamentos-list:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});

router.post("/faturamentos", authAdmin, uploadPublico.single('arquivo'), async (req, res) => {
  try {
    let { plataforma, mes, valor_total, taxas, chargeback, estornos } = req.body;
    const arquivo = req.file ? req.file.location : null;
 
    const admin_id = req.user?.id;
    const user_id = req.user?.id;
 
    if (!plataforma || !['pagarme', 'stripe'].includes(plataforma)) {
      return res.status(400).json({ erro: "Plataforma inválida" });
    }
 
    if (!mes) {
      return res.status(400).json({ erro: "Mês é obrigatório" });
    }
 
    if (!valor_total || isNaN(valor_total) || valor_total <= 0) {
      return res.status(400).json({ erro: "Valor total inválido" });
    }
 
    if (!arquivo) {
      return res.status(400).json({ erro: "Arquivo é obrigatório" });
    }
 
    if (!admin_id || !user_id) {
      return res.status(401).json({ erro: "Usuário não autenticado" });
    }
 
    valor_total = Number(valor_total);
    taxas = taxas ? Number(taxas) : 0;
    chargeback = chargeback ? Number(chargeback) : 0;
    estornos = estornos ? Number(estornos) : 0;
    const valor_liquido = valor_total - taxas - chargeback - estornos;
 
    const { rows } = await db.query(`
      INSERT INTO faturamentos (plataforma, mes, valor_total, taxas, chargeback, estornos, valor_liquido, arquivo)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, plataforma, mes, valor_total, taxas, chargeback, estornos, valor_liquido, arquivo, criado_em
    `, [plataforma, mes, valor_total, taxas, chargeback, estornos, valor_liquido, arquivo]);
 
    if (!rows.length) {
      return res.status(500).json({ erro: "Falha ao registrar faturamento" });
    }
 
    const motevoLog = `Faturamento registrado: ${plataforma} - ${mes} - R$ ${valor_liquido.toFixed(2)} (líquido)`;
 
    try {
      await db.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, motevoLog, user_id, 'admin', 'faturamento_novo']);
    } catch (logErr) {
      console.error("Erro ao registrar no log:", logErr);
    }
 
    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao criar faturamento:", err.message);
    res.status(500).json({ erro: "Erro interno: " + err.message });
  }
});

router.delete("/faturamentos/:id", authAdmin, async (req, res) => {
  try {
    const faturamentoId = Number(req.params.id);
 
    const admin_id = req.user?.id;
    const user_id = req.user?.id;
 
    if (!faturamentoId) {
      return res.status(400).json({ erro: "Faturamento inválido" });
    }
 
    if (!admin_id || !user_id) {
      return res.status(401).json({ erro: "Usuário não autenticado" });
    }
 
    const faturamento = await db.query(
      `SELECT plataforma, mes, valor_liquido FROM faturamentos WHERE id = $1`,
      [faturamentoId]
    );
 
    if (!faturamento.rows.length) {
      return res.status(404).json({ erro: "Faturamento não encontrado" });
    }
 
    await db.query(`DELETE FROM faturamentos WHERE id = $1`, [faturamentoId]);
 
    const motevoLog = `Faturamento deletado: ${faturamento.rows[0].plataforma} - ${faturamento.rows[0].mes} - R$ ${faturamento.rows[0].valor_liquido.toFixed(2)}`;
 
    try {
      await db.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, motevoLog, user_id, 'admin', 'faturamento_deletado']);
    } catch (logErr) {
      console.error("Erro ao registrar no log:", logErr);
    }
 
    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao deletar faturamento:", err.message);
    res.status(500).json({ erro: "Erro interno: " + err.message });
  }
});
 
// ==================== 19. DESPESAS ====================
 
router.get("/despesas-list", async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT
        id,
        categoria,
        descricao,
        valor,
        data,
        comprovante,
        criado_em
      FROM despesas
      ORDER BY data DESC
    `);
 
    res.json(rows);
  } catch (err) {
    console.error("Erro /despesas-list:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});
 
router.post("/despesas", authAdmin, uploadPublico.single('comprovante'), async (req, res) => {
  try {
    let { categoria, descricao, valor, data } = req.body;
    const comprovante = req.file ? req.file.location : null;
 
    const admin_id = req.user?.id;
    const user_id = req.user?.id;
 
    // Validações
    const categoriasValidas = ['banco_dados', 'render', 'cloudflare', 'hostinger', 'claude', 'email', 'salario', 'outro'];
    
    if (!categoria || !categoriasValidas.includes(categoria)) {
      return res.status(400).json({ erro: "Categoria inválida" });
    }
 
    if (!descricao || descricao.trim() === '') {
      return res.status(400).json({ erro: "Descrição é obrigatória" });
    }
 
    if (!valor || isNaN(valor) || valor <= 0) {
      return res.status(400).json({ erro: "Valor inválido" });
    }
 
    if (!data) {
      return res.status(400).json({ erro: "Data é obrigatória" });
    }
 
    if (!comprovante) {
      return res.status(400).json({ erro: "Comprovante é obrigatório" });
    }
 
    if (!admin_id || !user_id) {
      return res.status(401).json({ erro: "Usuário não autenticado" });
    }
 
    valor = Number(valor);
    descricao = descricao.trim();
 
    const { rows } = await db.query(`
      INSERT INTO despesas (categoria, descricao, valor, data, comprovante)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, categoria, descricao, valor, data, comprovante, criado_em
    `, [categoria, descricao, valor, data, comprovante]);
 
    if (!rows.length) {
      return res.status(500).json({ erro: "Falha ao registrar despesa" });
    }
 
    // Registrar no log
    const motevoLog = `Despesa registrada: ${categoria} - ${descricao} - $ ${valor.toFixed(2)}`;
 
    try {
      await db.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, motevoLog, user_id, 'admin', 'despesa_nova']);
    } catch (logErr) {
      console.error("Erro ao registrar no log:", logErr);
    }
 
    res.json(rows[0]);
  } catch (err) {
    console.error("Erro ao criar despesa:", err.message);
    res.status(500).json({ erro: "Erro interno: " + err.message });
  }
});
 
router.delete("/despesas/:id", authAdmin, async (req, res) => {
  try {
    const despesaId = Number(req.params.id);
 
    const admin_id = req.user?.id;
    const user_id = req.user?.id;
 
    if (!despesaId) {
      return res.status(400).json({ erro: "Despesa inválida" });
    }
 
    if (!admin_id || !user_id) {
      return res.status(401).json({ erro: "Usuário não autenticado" });
    }
 
    const despesa = await db.query(
      `SELECT categoria, descricao, valor FROM despesas WHERE id = $1`,
      [despesaId]
    );
 
    if (!despesa.rows.length) {
      return res.status(404).json({ erro: "Despesa não encontrada" });
    }
 
    await db.query(`DELETE FROM despesas WHERE id = $1`, [despesaId]);
 
    // Registrar no log
    const motevoLog = `Despesa deletada: ${despesa.rows[0].categoria} - ${despesa.rows[0].descricao} - R$ ${despesa.rows[0].valor.toFixed(2)}`;
 
    try {
      await db.query(`
        INSERT INTO admin_seguranca_historico (admin_id, motivo, data, user_id, tipo_user, acao)
        VALUES ($1, $2, NOW(), $3, $4, $5)
      `, [admin_id, motevoLog, user_id, 'admin', 'despesa_deletada']);
    } catch (logErr) {
      console.error("Erro ao registrar no log:", logErr);
    }
 
    res.json({ success: true });
  } catch (err) {
    console.error("Erro ao deletar despesa:", err.message);
    res.status(500).json({ erro: "Erro interno: " + err.message });
  }
});

// ========================================
// NEWSLETTER
// ========================================

const { Resend } = require("resend");
const _resendNewsletter = new Resend(process.env.RESEND_API_KEY);

router.get("/newsletter/resumo", authAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT COUNT(*) AS total
      FROM modelos m
      JOIN users u ON u.id = m.user_id
      WHERE m.verificada = true AND m.ativo = true AND u.email IS NOT NULL
    `);
    res.json({ total: Number(rows[0].total) });
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get("/newsletter/modelos", authAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT m.id, COALESCE(m.nome_exibicao, m.nome, u.email) AS nome, u.email
      FROM modelos m
      JOIN users u ON u.id = m.user_id
      WHERE m.verificada = true AND m.ativo = true AND u.email IS NOT NULL
      ORDER BY nome ASC
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.get("/newsletter/historico", authAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT id, assunto, total_enviados, erro, criado_em
      FROM newsletter_envios
      ORDER BY criado_em DESC
      LIMIT 20
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ erro: err.message });
  }
});

router.post("/newsletter/enviar", authAdmin, async (req, res) => {
  const { assunto, mensagem, modelo_ids } = req.body;
  if (!assunto || !mensagem) {
    return res.status(400).json({ erro: "Assunto e mensagem são obrigatórios." });
  }

  try {
    let rows;
    if (Array.isArray(modelo_ids) && modelo_ids.length > 0) {
      const result = await db.query(`
        SELECT u.email
        FROM modelos m
        JOIN users u ON u.id = m.user_id
        WHERE m.id = ANY($1)
          AND u.email IS NOT NULL
          AND TRIM(u.email) != ''
      `, [modelo_ids]);
      rows = result.rows;
    } else {
      const result = await db.query(`
        SELECT u.email
        FROM modelos m
        JOIN users u ON u.id = m.user_id
        WHERE m.verificada = true AND m.ativo = true
          AND u.email IS NOT NULL
          AND TRIM(u.email) != ''
      `);
      rows = result.rows;
    }

    if (rows.length === 0) {
      return res.status(400).json({ erro: "Nenhuma modelo encontrada para envio." });
    }

    // Validação extra: filtrar emails com formato inválido antes de enviar ao Resend
    const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const emails = rows
      .map(r => r.email.trim())
      .filter(e => EMAIL_REGEX.test(e));
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; background:#f6f3fb; padding:24px; color:#2d1f3d;">
        <div style="max-width:600px; margin:0 auto; background:#ffffff; padding:32px; border-radius:12px;">
          <h2 style="margin-top:0; margin-bottom:20px; color:#6f42c1; text-align:center;">
            ${assunto}
          </h2>
          <div style="line-height:1.7; font-size:15px;">
            ${mensagem}
          </div>
          <div style="text-align:center; margin:32px 0 8px;">
            <a href="https://www.velvet.lat"
               style="display:inline-block; background:#6f42c1; color:#ffffff; text-decoration:none; padding:14px 28px; border-radius:10px; font-weight:bold; font-size:15px;">
              Acessar a plataforma
            </a>
          </div>
          <p style="margin:24px 0 0; text-align:center; color:#6b5a7d;">
            Equipe Velvet 💜
          </p>
        </div>
      </div>
    `;

    if (emails.length === 0) {
      return res.status(400).json({ erro: "Nenhum email válido encontrado para envio." });
    }

    // Envia em lotes de 100 via Resend Batch API (uma chamada por lote, sem rate limit)
    const LOTE = 100;
    let enviados = 0;
    for (let i = 0; i < emails.length; i += LOTE) {
      const lote = emails.slice(i, i + LOTE);
      await _resendNewsletter.batch.send(
        lote.map(email => ({
          from: "Velvet <contato@velvet.lat>",
          to: email,
          subject: assunto,
          html
        }))
      );
      enviados += lote.length;
    }

    await db.query(
      `INSERT INTO newsletter_envios (assunto, mensagem, total_enviados, admin_id) VALUES ($1, $2, $3, $4)`,
      [assunto, mensagem, enviados, req.user.id]
    );

    res.json({ ok: true, total: enviados });
  } catch (err) {
    console.error("Erro newsletter:", err);
    await db.query(
      `INSERT INTO newsletter_envios (assunto, mensagem, total_enviados, erro, admin_id) VALUES ($1, $2, 0, $3, $4)`,
      [assunto, mensagem, err.message, req.user?.id]
    ).catch(() => {});
    res.status(500).json({ erro: "Erro ao enviar newsletter." });
  }
});

module.exports = router;
