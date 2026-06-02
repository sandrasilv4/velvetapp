// ===========================
// VARIAVEIS
// ===========================
const express = require("express");
const path = require("path");
const jwt = require("jsonwebtoken");
const auth = require("./middleware/auth");
const authCliente = require("./middleware/authCliente");
const authModelo = require("./middleware/authModelo");
const authAdmin = require("./middleware/authAdmin");
const db = require("./db");
const AWS = require("aws-sdk");
const fs = require("fs");
const { enviarEmailAprovacao } = require("./email");
const { enviarEmailRejeicao } = require("./email");
const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();   //PRIMEIRO SEMPRE

const crypto = require("crypto");
const bcrypt = require("bcrypt");

const allmessageJobs = new Map();

const cron = require("node-cron");
const requireRole = require("./middleware/requireRole");

// ===========================
// CLOUDFLARE R2
// ===========================

const s3Privado = new AWS.S3({
  endpoint: new AWS.Endpoint(process.env.R2_ENDPOINT),
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: "auto",
  signatureVersion: "v4",
  s3ForcePathStyle: true
});

// ===========================
// GLOBAIS
// ===========================

router.use("/assets",
  express.static(path.join(__dirname, "admin-pages"))
);

// ===========================
// CHARGE BACK
// ===========================

cron.schedule("0 3 * * *", async () => {
  console.log("🔍 Verificando clientes com chargeback...");

  const { rows } = await db.query(`
    SELECT
      cliente_id,
      COUNT(*) AS total,
      SUM(valor_bruto) AS valor,
      MAX(created_at) AS ultimo
    FROM transacoes_agency
    WHERE status = 'chargeback'
      AND created_at >= NOW() - INTERVAL '60 days'
    GROUP BY cliente_id
    HAVING COUNT(*) >= 2
  `);

  for (const c of rows) {
    let nivel = "atencao";

    if (c.total >= 5 || Number(c.valor) >= 50) {
      nivel = "critico";
    } else if (c.total >= 3) {
      nivel = "alto";
    }

    await db.query(
      `
      INSERT INTO chargeback_alertas
        (cliente_id, nivel, total_chargebacks, valor_total, ultimo_chargeback)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (cliente_id)
      DO UPDATE SET
        nivel = EXCLUDED.nivel,
        total_chargebacks = EXCLUDED.total_chargebacks,
        valor_total = EXCLUDED.valor_total,
        ultimo_chargeback = EXCLUDED.ultimo_chargeback,
        ativo = true
      `,
      [
        c.cliente_id,
        nivel,
        c.total,
        c.valor,
        c.ultimo
      ]
    );
  }
});

// ===========================
// FUNCOES
// ===========================

// =========================
// CALCULAR VALORES PARA BD
// =========================

async function calcularValores({ modelo_id, valor_bruto, taxa_gateway }) {

  const regraRes = await db.query(`
    SELECT
      COALESCE(a.percentual_modelo, 0.70) AS percentual_modelo,
      COALESCE(a.percentual_agencia, 0) AS percentual_agencia,
      COALESCE(a.percentual_plataforma, 0.30) AS percentual_plataforma
    FROM modelos m
    LEFT JOIN agencias a ON a.id = m.agencia_id
    WHERE m.id = $1
  `, [modelo_id]);

  const regra = regraRes.rows[0];

  const bruto = Number(valor_bruto);
  const gateway = Number(taxa_gateway || 0);

  const percentualModelo = Number(regra.percentual_modelo);
  const percentualAgencia = Number(regra.percentual_agencia);
  const percentualPlataforma = Number(regra.percentual_plataforma);

  const valorModelo = bruto * percentualModelo;
  const valorAgencia = bruto * percentualAgencia;
  const valorVelvet = bruto * percentualPlataforma;

  return {
    valor_modelo: Number(valorModelo.toFixed(2)),
    agency_fee: Number(valorAgencia.toFixed(2)),
    velvet_fee: Number(valorVelvet.toFixed(2)),
    taxa_gateway: gateway
  };
}

// ===========================
// AUTH AGENCIAS
// ===========================

function authAgencia(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.sendStatus(401);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "agencia") {
      return res.sendStatus(403);
    }

    req.agencia = decoded;
    next();

  } catch (err) {
    return res.sendStatus(401);
  }
}

// ===========================
// PPV
// ===========================

async function processarAllmessageJob(jobId, {
  modelo_id,
  texto,
  preco,
  conteudos,
  modo_teste
}) {
  const job = allmessageJobs.get(jobId);
  if (!job) return;

  try {
    const temConteudo = Array.isArray(conteudos) && conteudos.length > 0;
    const precoFinal = Number(preco) || 0;

    const clientesRes = await db.query(
      `
      SELECT cliente_id
      FROM vip_subscriptions
      WHERE modelo_id = $1
        AND ativo = true
      `,
      [modelo_id]
    );

    if (clientesRes.rowCount === 0) {
      job.status = "erro";
      job.error = "Nenhum assinante ativo encontrado";
      job.percentual = 0;
      job.finalizado_em = new Date().toISOString();
      return;
    }

    let clientes = clientesRes.rows;

    if (modo_teste) {
      clientes = clientes.slice(0, 1);
    }

    job.total = clientes.length;
    job.processados = 0;
    job.enviados = 0;
    job.falhas = 0;
    job.percentual = 0;
    job.status = "processando";
    job.error = null;

    for (const row of clientes) {
      const cliente_id = row.cliente_id;

      try {

        // 1) MENSAGEM DE TEXTO
        await db.query(
          `
          INSERT INTO messages
            (modelo_id, cliente_id, text, sender, visto, tipo)
          VALUES
            ($1, $2, $3, 'modelo', false, 'texto')
          `,
          [modelo_id, cliente_id, texto]
        );


        // 2) MENSAGEM DE CONTEÚDO + PACOTE
        if (temConteudo) {
       const msgRes = await db.query(
    `
    INSERT INTO messages
      (modelo_id, cliente_id, text, sender, preco, visto, tipo)
    VALUES
      ($1, $2, '', 'modelo', $3, false, 'conteudo_ppv_mass')
    RETURNING id
    `,
    [modelo_id, cliente_id, precoFinal]
  );

  const message_id = msgRes.rows[0].id;

  await db.query(
    `
    INSERT INTO conteudo_pacotes
      (cliente_id, modelo_id, preco, valor_total, status, message_id)
    VALUES
      ($1, $2, $3, $4, 'pendente', $5)
    `,
    [
      cliente_id,
      modelo_id,
      precoFinal,
      precoFinal,
      message_id
    ]
  );

  for (const conteudo_id of conteudos) {
    await db.query(
      `
      INSERT INTO messages_conteudos
        (message_id, conteudo_id)
      VALUES
        ($1, $2)
      `,
      [message_id, conteudo_id]
    );
  }
}

job.enviados++;

} catch (err) {
console.error(`❌ Falha ao enviar para cliente ${cliente_id}:`, err);
job.falhas++;
}

job.processados++;
job.percentual = job.total > 0
? Math.round((job.processados / job.total) * 100)
: 0;
}

job.status = "concluido";
job.percentual = 100;
job.finalizado_em = new Date().toISOString();

} catch (err) {

    console.error("❌ Erro geral no processarAllmessageJob:", err);

    job.status = "erro";

    job.error = err.message || "Erro interno no envio em massa";

    job.finalizado_em = new Date().toISOString();
  }
}

async function podeAlterarDadosBancarios() {
  const hoje = new Date();
  const dia = hoje.getDate();

  // bloqueia do dia 1 ao 5
  return !(dia >= 1 && dia <= 5);
}

// ======================================
// ROTAS POST
// ======================================

// ===============================
// DADOS BANCARIOS INCLUIR ALTERAR
// ===============================

router.post("/modelo/dados-bancarios", authModelo, async (req, res) => {
  if (!podeAlterarDadosBancarios()) {
    return res.status(403).json({
      error: "Alterações bloqueadas no período de pagamento"
    });
  }

  const {
    pix_tipo,
    pix_chave,
    banco,
    agencia,
    conta,
    conta_tipo,
    titular_nome,
    titular_documento,
    confirmado_titular
  } = req.body;
  const tipo = (req.body.tipo || '').toLowerCase() || null;

  if (!confirmado_titular) {
    return res.status(400).json({
      error: "Confirmação de titularidade obrigatória"
    });
  }

  try {
    await db.query(`
      INSERT INTO modelo_dados_bancarios (
        modelo_id, tipo,
        pix_tipo, pix_chave,
        banco, agencia, conta, conta_tipo,
        titular_nome, titular_documento,
        confirmado_titular, status
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,'pendente')
      ON CONFLICT (modelo_id)
      DO UPDATE SET
        tipo = EXCLUDED.tipo,
        pix_tipo = EXCLUDED.pix_tipo,
        pix_chave = EXCLUDED.pix_chave,
        banco = EXCLUDED.banco,
        agencia = EXCLUDED.agencia,
        conta = EXCLUDED.conta,
        conta_tipo = EXCLUDED.conta_tipo,
        titular_nome = EXCLUDED.titular_nome,
        titular_documento = EXCLUDED.titular_documento,
        confirmado_titular = true,
        status = 'alteracao_pendente',
        atualizado_em = NOW()
    `, [
      req.modelo_id,
      tipo,
      pix_tipo,
      pix_chave,
      banco,
      agencia,
      conta,
      conta_tipo,
      titular_nome,
      titular_documento
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error("ERRO DADOS BANCÁRIOS:", err);
    res.status(500).json({ error: "Erro interno ao salvar dados bancários" });
  }
});

router.post("/modelo/dados-bancarios/alterar", authModelo, async (req, res) => {
  if (!podeAlterarDadosBancarios()) {
    return res.status(403).json({
      error: "Alterações bloqueadas no período de pagamento"
    });
  }

  const {
    justificativa,
    pix_tipo,
    pix_chave,
    banco,
    agencia,
    conta,
    conta_tipo,
    titular_nome,
    titular_documento
  } = req.body;
  const tipo = (req.body.tipo || '').toLowerCase() || null;

  if (!justificativa) {
    return res.status(400).json({
      error: "Justificativa obrigatória"
    });
  }

  try {
    await db.query(`
      UPDATE modelo_dados_bancarios
      SET
        tipo = $1,
        pix_tipo = $2,
        pix_chave = $3,
        banco = $4,
        agencia = $5,
        conta = $6,
        conta_tipo = $7,
        titular_nome = $8,
        titular_documento = $9,
        justificativa = $10,
        status = 'alteracao_pendente',
        atualizado_em = NOW()
      WHERE modelo_id = $11
    `, [
      tipo,
      pix_tipo,
      pix_chave,
      banco,
      agencia,
      conta,
      conta_tipo,
      titular_nome,
      titular_documento,
      justificativa,
      req.modelo_id
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error("ERRO DADOS BANCÁRIOS:", err);
    res.status(500).json({ error: "Erro interno ao salvar dados bancários" });
  }
});

// ===========================
// PAGAMENTOS
// ===========================

// router.post("/admin/pagamentos/:id/pagar", auth, async (req, res) => { 
  
//   const { id } = req.params;
//     await db.query(
//       `
//       UPDATE modelo_pagamentos
//       SET
//         status = 'pago',
//         pago_em = NOW()
//       WHERE id = $1
//       `,
//       [id]
//     );

//     res.json({ ok: true });
//   }
// );

// router.post("/admin/fechar-pagamentos-modelo/:modeloId", auth, async (req, res) => {
//   const { modeloId } = req.params;

//   await db.query(`/* SQL acima */`, [modeloId]);

//     res.json({ ok: true });
//   }
// );

// ===========================
// PPV
// ===========================

router.post("/allmessage", auth, requireRole("admin", "modelo"),

  async (req, res) => {
    try {
      const { texto, preco, conteudos, modo_teste } = req.body;

      let modelo_id;

      if (req.user.role === "modelo") {
        const modeloRes = await db.query(
          "SELECT id FROM modelos WHERE user_id = $1",
          [req.user.id]
        );

        if (modeloRes.rowCount === 0) {
          return res.status(403).json({ error: "Modelo não encontrada" });
        }

        modelo_id = modeloRes.rows[0].id;
      } else {
        modelo_id = req.body.modelo_id;
      }

      if (!modelo_id || !texto) {
        return res.status(400).json({ error: "Dados inválidos" });
      }

      const jobId = crypto.randomUUID();

      allmessageJobs.set(jobId, {
        jobId,
        status: "processando",
        modelo_id,
        total: 0,
        processados: 0,
        enviados: 0,
        falhas: 0,
        percentual: 0,
        modo_teste: !!modo_teste,
        criado_em: new Date().toISOString(),
        error: null
      });

      res.json({
        ok: true,
        jobId
      });

      processarAllmessageJob(jobId, {
        modelo_id,
        texto,
        preco,
        conteudos,
        modo_teste

      }).catch((err) => {
        console.error("❌ ERRO JOB ALLMESSAGE:", err);

        const job = allmessageJobs.get(jobId);
        if (job) {
          job.status = "erro";
          job.error = err.message;
        }
      });

    } catch (err) {
      console.error("❌ ERRO ALLMESSAGE ENVIO:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

// ===========================
// LOGINS
// ===========================

router.post("/agencia/login", async (req, res) => {
  try {
    const { email, senha } = req.body;

    const result = await db.query(
      "SELECT * FROM agencias WHERE email = $1",
      [email]
    );

    if (!result.rowCount) {
      return res.status(401).json({ erro: "Agência não encontrada" });
    }

    const agencia = result.rows[0];

    const senhaValida = await bcrypt.compare(senha, agencia.senha);

    if (!senhaValida) {
      return res.status(401).json({ erro: "Senha inválida" });
    }

    const token = jwt.sign(
      { 
        id: agencia.id, 
        email: agencia.email,  // ✅ Adicionar email
        role: "agencia" 
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({ 
      token,
      agencia: {
        id: agencia.id,
        nome: agencia.nome,
        email: agencia.email
      }
    });

  } catch (err) {
    console.error("Erro login agência:", err);
    res.status(500).json({ erro: "Erro interno" });
  }
});


router.post("/admin/login", async (req, res) => {

  const { email, senha } = req.body;

  try {
    const admin = await db.query(
      "SELECT * FROM admin WHERE email = $1",
      [email]
    );

    if (!admin.rowCount) {
      return res.status(400).json({ error: "Admin não encontrado" });
    }

    const adminData = admin.rows[0];

    const senhaValida = await bcrypt.compare(senha, adminData.senha);

    if (!senhaValida) {
      return res.status(400).json({ error: "Senha inválida" });
    }

    const token = jwt.sign(
      { id: adminData.id, role: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    res.json({ token });

  } catch (err) {
    console.error("Erro login admin:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/admin/modelo/:id/historico-bancario", auth, authAdmin, async (req,res)=>{

const { id } = req.params;

const page = Number(req.query.page) || 1;
const limit = 10;
const offset = (page - 1) * limit;

try{

const totalRes = await db.query(`
SELECT COUNT(*)
FROM modelo_dados_bancarios
WHERE modelo_id = $1
`,[id]);

const total = Number(totalRes.rows[0].count);
const totalPages = Math.ceil(total / limit);

const result = await db.query(`
SELECT
titular_nome,
banco,
agencia,
conta,
pix_chave,
status,
criado_em
FROM modelo_dados_bancarios
WHERE modelo_id = $1
ORDER BY criado_em DESC
LIMIT $2 OFFSET $3
`,[id,limit,offset]);

res.json({
dados: result.rows,
page,
totalPages
});

}catch(err){
console.error("Erro histórico bancário:", err);
res.status(500).json({error:"Erro ao buscar histórico"});
}

});

// ===========================
// CLIENTES
// ===========================

router.get("/transacoes_cliente", authCliente, async (req, res) => {
  try {
    const role = req.user.role;

    if (role !== "cliente") {
      return res.status(403).json({ error: "Apenas cliente pode acessar" });
    }

    const clienteRes = await db.query(
      "SELECT id FROM clientes WHERE user_id = $1",
      [req.user.id]
    );

    if (clienteRes.rowCount === 0) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const clienteId = clienteRes.rows[0].id;

    const vipQuery = await db.query(`
      SELECT
        id,
        'assinatura' AS tipo,
        valor_total AS valor,
        CASE 
          WHEN ativo = true THEN 'pago'
          ELSE 'inativo'
        END AS status,
        created_at
      FROM vip_subscriptions
      WHERE cliente_id = $1
    `, [clienteId]);

    const conteudoQuery = await db.query(`
      SELECT
        id,
        'midia' AS tipo,
        valor_total AS valor,
        status,
        criado_em AS created_at
      FROM conteudo_pacotes
      WHERE cliente_id = $1
    `, [clienteId]);

    const transacoes = [
      ...vipQuery.rows,
      ...conteudoQuery.rows
    ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json(transacoes);

  } catch (err) {
    console.error("Erro buscar transações cliente:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/cliente/transacoes", authCliente, async (req, res) => {
  try {
    const clienteRes = await db.query(
  "SELECT id FROM clientes WHERE user_id = $1",
  [req.user.id]
);

if (clienteRes.rowCount === 0) {
  return res.status(404).json({ error: "Cliente não encontrado" });
}

const clienteId = clienteRes.rows[0].id;

    const conteudos = await db.query(`
      SELECT
        'conteudo' AS tipo,
        cp.id,
        cp.modelo_id,
        cp.valor_total AS valor,
        cp.status,
        cp.criado_em AS created_at,
        cp.message_id
      FROM conteudo_pacotes cp
      WHERE cp.cliente_id = $1
        AND cp.status = 'pago'
    `, [clienteId]);

    const assinaturas = await db.query(`
      SELECT
        'assinatura' AS tipo,
        v.id,
        v.modelo_id,
        (
          v.valor_assinatura +
          v.taxa_transacao +
          v.taxa_plataforma
        ) AS valor,
        CASE
          WHEN v.ativo THEN 'ativa'
          ELSE 'inativa'
        END AS status,
        v.created_at,
        NULL AS message_id
      FROM vip_subscriptions v
      WHERE v.cliente_id = $1
    `, [clienteId]);

    // 🔀 Unifica e ordena
    const historico = [
      ...conteudos.rows,
      ...assinaturas.rows
    ].sort(
      (a, b) => new Date(b.created_at) - new Date(a.created_at)
    );

    res.json(historico);

  } catch (err) {
    console.error("Erro histórico cliente:", err);
    res.status(500).json({ error: "Erro ao buscar histórico do cliente" });
  }
});

router.get("/cliente/subscricoes", auth, async (req, res) => {
  try {
    const clienteRes = await db.query(
      "SELECT id FROM clientes WHERE user_id = $1",
      [req.user.id]
    );

    if (!clienteRes.rowCount) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const clienteId = clienteRes.rows[0].id;

    const result = await db.query(`
      SELECT 
        v.id,
        v.modelo_id,
        m.nome_exibicao AS modelo,
        v.created_at,
        v.expiration_at,
        v.ativo,
        v.recorrente
      FROM vip_subscriptions v
      JOIN modelos m ON m.id = v.modelo_id
      WHERE v.cliente_id = $1
      ORDER BY v.created_at DESC
    `, [clienteId]);

    res.json(result.rows);

  } catch (err) {
    console.error("Erro subscrições:", err);
    res.status(500).json({ error: "Erro ao buscar subscrições" });
  }
});

router.get("/access", authCliente, async (req, res) => {
  const message_id = Number(req.query.message_id);

  if (!Number.isInteger(message_id) || message_id <= 0) {

    return res.status(400).json({ error: "message_id inválido" });
  }

  const msgRes = await db.query(
    `
    SELECT id
    FROM messages
    WHERE id = $1
      AND cliente_id = $2
      AND visto = true
    `,
    [message_id, req.user.id]
  );

  if (msgRes.rowCount === 0) {
    return res.status(403).json({ error: "Conteúdo não liberado" });
  }

  const midiasRes = await db.query(
    `
    SELECT c.url, c.tipo
    FROM messages_conteudos mc
    JOIN conteudos c ON c.id = mc.conteudo_id
    WHERE mc.message_id = $1
    `,
    [message_id]
  );

  res.json({
    midias: midiasRes.rows.map(m => ({
      tipo: m.tipo,
      url: m.url
    }))
  });
});

// ===========================
// MODELOS
// ===========================

router.get("/modelo/transacoes",
  requireRole("modelo", "admin", "agente"),
  (req, res) => {
    res.sendFile(
      path.join(process.cwd(), "transacoes", "transacoes.html")
    );
  }
);

router.get("/transacoes", authModelo, async (req, res) => {
  try {
    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [req.user.id]
    );

    if (!modeloRes.rows.length) {
      return res.status(404).json({ error: "Modelo não encontrada" });
    }

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

      monthFilter = `
        AND created_at >= make_timestamptz($2, $3, 1, 0, 0, 0, 'America/Sao_Paulo')
        AND created_at < (
          make_timestamptz($2, $3, 1, 0, 0, 0, 'America/Sao_Paulo')
          + interval '1 month'
        )
      `;
    }

    const dataValues = [...values, limit, offset];

    const sql = `
      SELECT
        id AS codigo,
        tipo,
        created_at,
        created_at AT TIME ZONE 'America/Sao_Paulo' AS created_at_sp,
        TO_CHAR(
          created_at AT TIME ZONE 'America/Sao_Paulo',
          'DD/MM/YYYY HH24:MI'
        ) AS created_at_sp_formatado,
        TO_CHAR(
          created_at AT TIME ZONE 'America/Sao_Paulo',
          'DD/MM/YYYY'
        ) AS data_sp,
        valor_modelo AS valor,
        status,
        NULL AS message_id
      FROM transacoes_agency
      WHERE modelo_id = $1
        AND status = 'pago'
        ${monthFilter}
      ORDER BY created_at DESC
      LIMIT $${dataValues.length - 1}
      OFFSET $${dataValues.length}
    `;

    const countSql = `
      SELECT COUNT(*) AS count
      FROM transacoes_agency
      WHERE modelo_id = $1
        AND status = 'pago'
        ${monthFilter}
    `;

    const [dados, total] = await Promise.all([
      db.query(sql, dataValues),
      db.query(countSql, values)
    ]);

    const totalRegistros = parseInt(total.rows[0].count, 10);
    const totalPaginas = Math.ceil(totalRegistros / limit);

    res.json({
      registros: dados.rows,
      paginaAtual: page,
      totalPaginas,
      totalRegistros
    });

  } catch (err) {
    console.error("Erro /transacoes:", err);
    res.status(500).json({
      registros: [],
      paginaAtual: 1,
      totalPaginas: 1,
      totalRegistros: 0
    });
  }
});

router.get("/transacoes/diario", auth, requireRole("admin", "modelo", "agente"),

  async (req, res) => {
    try {
      const { mes } = req.query;

      if (!mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
        return res.status(400).json({
          error: "Formato de mês inválido (YYYY-MM)"
        });
      }

      const [ano, mesNum] = mes.split("-").map(Number);
      const { role } = req.user;

      let values = [ano, mesNum];
      let where = `
        status = 'pago'
        AND created_at >= make_timestamptz($1, $2, 1, 0, 0, 0, 'America/Sao_Paulo')
        AND created_at < (
          make_timestamptz($1, $2, 1, 0, 0, 0, 'America/Sao_Paulo')
          + interval '1 month'
        )
      `;

      if (role === "modelo") {
        const modeloRes = await db.query(
          "SELECT id FROM modelos WHERE user_id = $1",
          [req.user.id]
        );

        if (!modeloRes.rows.length) {
          return res.status(404).json({ error: "Modelo não encontrada" });
        }

        const modelo_id = modeloRes.rows[0].id;
        values.push(modelo_id);
        where += ` AND modelo_id = $${values.length}`;
      }

      const result = await db.query(
        `
        SELECT
          DATE(created_at AT TIME ZONE 'America/Sao_Paulo') AS dia,

          COALESCE(SUM(
            CASE WHEN tipo = 'midia' THEN valor_modelo END
          ), 0) AS ganhos_midias,

          COALESCE(SUM(
            CASE WHEN tipo = 'assinatura' THEN valor_modelo END
          ), 0) AS ganhos_assinaturas

        FROM transacoes_agency
        WHERE ${where}
        GROUP BY dia
        ORDER BY dia
        `,
        values
      );

      res.json(result.rows);
    } catch (err) {
      console.error("Erro /transacoes/diario:", err);
      res.status(500).json({ error: "Erro interno" });
    }
  }
);

router.get("/transacoes/resumo-mensal", auth, requireRole("admin", "modelo", "agente"), async (req, res) => {
    try {
      const { mes } = req.query;

      if (!mes || !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) {
        return res.status(400).json({
          error: "Formato de mês inválido (YYYY-MM)"
        });
      }

      const [ano, mesNum] = mes.split("-").map(Number);
      const { role } = req.user;

      let values = [ano, mesNum];
      let where = `
        status = 'pago'
        AND created_at >= make_timestamptz($1, $2, 1, 0, 0, 0, 'America/Sao_Paulo')
        AND created_at < (
          make_timestamptz($1, $2, 1, 0, 0, 0, 'America/Sao_Paulo')
          + interval '1 month'
        )
      `;

      if (role === "modelo") {
        const modeloRes = await db.query(
          "SELECT id FROM modelos WHERE user_id = $1",
          [req.user.id]
        );

        if (!modeloRes.rows.length) {
          return res.status(404).json({ error: "Modelo não encontrada" });
        }

        const modelo_id = modeloRes.rows[0].id;
        values.push(modelo_id);
        where += ` AND modelo_id = $${values.length}`;
      }

      const result = await db.query(
        `
        SELECT
          COALESCE(SUM(valor_bruto), 0) AS total_bruto,
          COALESCE(SUM(taxa_gateway), 0) AS total_taxas,
          COALESCE(SUM(agency_fee), 0) AS total_agency,
          COALESCE(SUM(velvet_fee), 0) AS total_velvet,
          COALESCE(SUM(valor_modelo), 0) AS total_modelo,

          COALESCE(SUM(CASE WHEN tipo = 'assinatura' THEN valor_bruto END), 0) AS total_assinaturas,
          COALESCE(SUM(CASE WHEN tipo = 'midia' THEN valor_bruto END), 0) AS total_midias

        FROM transacoes_agency
        WHERE ${where}
        `,
        values
      );

      res.json(result.rows[0]);
    } catch (err) {
      console.error("Erro /transacoes/resumo-mensal:", err);
      res.status(500).json({ error: "Erro interno" });
    }
  }
);

router.get("/transacoes/resumo-anual", auth, requireRole("admin", "modelo"), async (req, res) => {

    try {
      const { ano } = req.query;

      if (!ano || !/^\d{4}$/.test(ano)) {
        return res.status(400).json({ error: "Formato de ano inválido (YYYY)" });
      }

      const anoNum = Number(ano);
      const { role } = req.user;

      let values = [anoNum];
      let where = `
        status = 'pago'
        AND created_at >= make_timestamptz($1, 1, 1, 0, 0, 0, 'America/Sao_Paulo')
        AND created_at < make_timestamptz($1 + 1, 1, 1, 0, 0, 0, 'America/Sao_Paulo')
      `;

      if (role === "modelo") {
        const modeloRes = await db.query(
          "SELECT id FROM modelos WHERE user_id = $1",
          [req.user.id]
        );

        if (!modeloRes.rows.length) {
          return res.status(404).json({ error: "Modelo não encontrada" });
        }

        const modelo_id = modeloRes.rows[0].id;
        values.push(modelo_id);
        where += ` AND modelo_id = $${values.length}`;
      }

      const result = await db.query(
        `
        SELECT
          DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo') AS mes,

          COALESCE(SUM(valor_bruto), 0) AS total_bruto,
          COALESCE(SUM(taxa_gateway), 0) AS total_taxas,
          COALESCE(SUM(agency_fee), 0) AS total_agency,
          COALESCE(SUM(velvet_fee), 0) AS total_velvet,
          COALESCE(SUM(valor_modelo), 0) AS total_modelo,

          COALESCE(SUM(CASE WHEN tipo = 'assinatura' THEN valor_bruto END), 0) AS total_assinaturas,
          COALESCE(SUM(CASE WHEN tipo = 'midia' THEN valor_bruto END), 0) AS total_midias

        FROM transacoes_agency
        WHERE ${where}
        GROUP BY mes
        ORDER BY mes
        `,
        values
      );

      res.json(result.rows);
    } catch (err) {
      console.error("Erro /transacoes/resumo-anual:", err);
      res.status(500).json({ error: "Erro interno" });
    }
  }
);

router.get("/modelo/relatorio", (req, res) => {
  res.sendFile(
    path.join(process.cwd(), "admin-pages", "relatorio.html")
  );
});

router.get("/content/transacoes", (req, res) => {
  res.sendFile(
    path.join(process.cwd(), "content", "transacoes.html")
  );
});

router.get("/modelo/financeiro", authModelo, async (req, res) => {
  try {
    const modeloRes = await db.query(
      "SELECT id FROM modelos WHERE user_id = $1",
      [req.user.id]
    );

    if (!modeloRes.rows.length) {
      return res.status(404).json({ error: "Modelo não encontrada" });
    }

    const modelo_id = modeloRes.rows[0].id;

    const result = await db.query(
      `
      SELECT
        COALESCE(SUM(CASE
          WHEN tipo IN ('midia', 'conteudo')
           AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo')
               = DATE(NOW() AT TIME ZONE 'America/Sao_Paulo')
          THEN valor_modelo
        END), 0) AS hoje_midias,

        COALESCE(SUM(CASE
          WHEN tipo = 'assinatura'
           AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo')
               = DATE(NOW() AT TIME ZONE 'America/Sao_Paulo')
          THEN valor_modelo
        END), 0) AS hoje_assinaturas,

        COALESCE(SUM(CASE
          WHEN tipo IN ('midia', 'conteudo')
           AND DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo')
               = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
          THEN valor_modelo
        END), 0) AS mes_midias,

        COALESCE(SUM(CASE
          WHEN tipo = 'assinatura'
           AND DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo')
               = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
          THEN valor_modelo
        END), 0) AS mes_assinaturas,

        COALESCE(SUM(CASE
          WHEN tipo IN ('midia', 'conteudo')
           AND DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo')
               = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '1 month'
          THEN valor_modelo
        END), 0) AS mes_anterior_midias,

        COALESCE(SUM(CASE
          WHEN tipo = 'assinatura'
           AND DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo')
               = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '1 month'
          THEN valor_modelo
        END), 0) AS mes_anterior_assinaturas,

        COALESCE(SUM(CASE
          WHEN EXTRACT(YEAR FROM created_at AT TIME ZONE 'America/Sao_Paulo')
               = EXTRACT(YEAR FROM NOW() AT TIME ZONE 'America/Sao_Paulo')
          THEN valor_modelo
        END), 0) AS acumulado_ano_atual,

        COUNT(DISTINCT CASE
          WHEN tipo = 'assinatura'
           AND status = 'pago'
           AND DATE_TRUNC('month', created_at AT TIME ZONE 'America/Sao_Paulo')
               = DATE_TRUNC('month', NOW() AT TIME ZONE 'America/Sao_Paulo')
          THEN cliente_id
        END) AS assinantes_total,

        COUNT(DISTINCT CASE
          WHEN tipo = 'assinatura'
           AND status = 'pago'
           AND DATE(created_at AT TIME ZONE 'America/Sao_Paulo')
               = DATE(NOW() AT TIME ZONE 'America/Sao_Paulo')
          THEN cliente_id
        END) AS assinantes_hoje

      FROM transacoes_agency
      WHERE modelo_id = $1
        AND status = 'pago'
      `,
      [modelo_id]
    );

    const r = result.rows[0];

    res.json({
      hoje: {
        midias: Number(r.hoje_midias || 0),
        assinaturas: Number(r.hoje_assinaturas || 0)
      },
      mes: {
        midias: Number(r.mes_midias || 0),
        assinaturas: Number(r.mes_assinaturas || 0)
      },
      mesAnterior: {
        midias: Number(r.mes_anterior_midias || 0),
        assinaturas: Number(r.mes_anterior_assinaturas || 0)
      },
      total: {
        acumulado_ano_atual: Number(r.acumulado_ano_atual || 0)
      },
      assinantes: {
        total: Number(r.assinantes_total || 0),
        hoje: Number(r.assinantes_hoje || 0)
      }
    });
  } catch (err) {
    console.error("Erro /modelo/financeiro:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/modelo/pagamentos", authModelo, async (req, res) => {
  try {
const modeloRes = await db.query(
  "SELECT id FROM modelos WHERE user_id = $1",
  [req.user.id]
);

const modelo_id = modeloRes.rows[0].id;

    const result = await db.query(
      `
      SELECT
        mes,
        total_midias,
        total_assinaturas,
        total_geral,
        status,
        pago_em
      FROM modelo_pagamentos
      WHERE modelo_id = $1
      ORDER BY mes DESC
      `,
      [modelo_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error("ERRO PAGAMENTOS:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/modelo/dados-bancarios", authModelo, async (req, res) => {
  try {
    const { rows } = await db.query(`
      SELECT *
      FROM modelo_dados_bancarios
      WHERE modelo_id = $1
    `, [req.modelo_id]);

    if (!rows.length) {
      return res.json(null);
    }

    res.json(rows[0]);
  } catch (err) {
    console.error("Erro buscar dados bancários:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

router.get("/modelo/clientes/:cliente_id/transacoes", authModelo, async (req, res) => {
  try {
    const cliente_id = Number(req.params.cliente_id);

    if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
      return res.status(400).json({ error: "cliente_id inválido" });
    }

    const modeloRes = await db.query(
      `SELECT id FROM modelos WHERE user_id = $1 LIMIT 1`,
      [req.user.id]
    );

    if (!modeloRes.rowCount) {
      return res.status(404).json({ error: "Modelo não encontrada" });
    }

    const modelo_id = Number(modeloRes.rows[0].id);

    const clienteRes = await db.query(
      `
      SELECT
        c.id,
        c.nome,
        cd.avatar AS avatar_url
      FROM clientes c
      LEFT JOIN clientes_dados cd
        ON cd.cliente_id = c.id
      WHERE c.id = $1
      LIMIT 1
      `,
      [cliente_id]
    );

    if (!clienteRes.rowCount) {
      return res.status(404).json({ error: "Cliente não encontrado" });
    }

    const resumoRes = await db.query(
      `
      SELECT
  COUNT(*) FILTER (WHERE t.status = 'pago')::int AS total_compras,
  COALESCE(SUM(CASE WHEN t.status = 'pago' THEN t.valor_bruto END), 0)::numeric(10,2) AS total_pago,
  COUNT(*) FILTER (
    WHERE t.status = 'pago'
      AND LOWER(COALESCE(t.tipo, '')) IN ('conteudo', 'midia')
  )::int AS conteudos_pagos,
  COUNT(*) FILTER (
    WHERE t.status = 'pago'
      AND LOWER(COALESCE(t.tipo, '')) = 'assinatura'
  )::int AS assinaturas
FROM transacoes_agency t
WHERE t.modelo_id = $1
  AND t.cliente_id = $2

      `,
      [modelo_id, cliente_id]
    );

    const transRes = await db.query(
      `
      SELECT
        t.id,
        CASE
          WHEN LOWER(COALESCE(t.tipo, '')) = 'conteudo' THEN 'midia'
          ELSE LOWER(COALESCE(t.tipo, ''))
        END AS tipo,
        t.created_at,
        t.valor_bruto,
        t.valor_modelo,
        t.status,
        t.aceitou_termos
      FROM transacoes_agency t
      WHERE t.modelo_id = $1
  AND t.cliente_id = $2
  AND t.status = 'pago'
      ORDER BY t.created_at DESC, t.id DESC
      `,
      [modelo_id, cliente_id]
    );

    return res.json({
      cliente: clienteRes.rows[0],
      resumo: {
        total_compras: Number(resumoRes.rows[0]?.total_compras || 0),
        total_pago: Number(resumoRes.rows[0]?.total_pago || 0),
        conteudos_pagos: Number(resumoRes.rows[0]?.conteudos_pagos || 0),
        assinaturas: Number(resumoRes.rows[0]?.assinaturas || 0)
      },
      totalRegistros: transRes.rowCount,
      registros: transRes.rows
    });

  } catch (err) {
    console.error("Erro ao buscar transações do cliente para a modelo:", err);
    return res.status(500).json({
      error: "Erro ao buscar transações",
      detalhe: err.message
    });
  }
});

// ===========================
// PPV
// ===========================

router.get("/allmessage/modelos", auth, requireRole("admin", "modelo"), async (req, res) => {
    try {
      const { role, id: user_id } = req.user;

       let sql = `
        SELECT
          m.id        AS modelo_id,
          m.nome      AS nome
        FROM modelos m
      `;
      let params = [];

      // modelo só vê a própria
      if (role === "modelo") {
        sql += ` WHERE m.user_id = $1 `;
        params.push(user_id);
      }

      sql += ` ORDER BY m.nome `;

      const result = await db.query(sql, params);
      res.json(result.rows);

    } catch (err) {
      console.error("❌ Erro ALLMESSAGE modelos:", err);
      res.status(500).json({ error: "Erro ao listar modelos" });
    }
  }
);

router.get("/allmessage/status/:jobId", auth, requireRole("admin", "modelo"), async (req, res) => {
    try {
      const { jobId } = req.params;

      const job = allmessageJobs.get(jobId);

      if (!job) {
        return res.status(404).json({ error: "Job não encontrado ou expirado" });
      }

      res.json(job);
    } catch (err) {
      console.error("❌ ERRO STATUS ALLMESSAGE:", err);
      res.status(500).json({ error: err.message });
    }
  }
);

router.get("/allmessage/conteudos/:modelo_id", auth, requireRole("admin", "modelo"), async (req, res) => {
    try {
      const { modelo_id } = req.params;
      const { role, id: user_id } = req.user;

      if (role === "modelo") {
        const check = await db.query(
  `SELECT 1 FROM modelos WHERE id = $1 AND user_id = $2`,
  [modelo_id, user_id]
        );
        if (check.rowCount === 0) {
          return res.json([]);
        }
      }

      const result = await db.query(
        `
        SELECT
          id,
          url,
          thumbnail_url AS thumbnail
        FROM conteudos
        WHERE modelo_id = $1
          AND tipo_conteudo = 'venda'
        ORDER BY id DESC
        `,
        [modelo_id]
      );

      res.json(result.rows); // ✅ SEMPRE array

    } catch (err) {
      console.error("❌ Erro ALLMESSAGE conteudos:", err);
      res.json([]); // ⚠️ NUNCA retornar objeto
    }
  }
);

router.get("/modelo/conteudos", auth, authModelo, async (req, res) => {
  const modelo_id = req.user.id;

  const result = await db.query(
    `
    SELECT id, url, thumbnail
    FROM conteudos
    WHERE user_id = $1
    ORDER BY created_at DESC
    `,
    [modelo_id]
  );

  res.json(result.rows);
});

// ===========================
// AGENCIAS
// ===========================

router.get("/agencia/modelos", authAgencia, async (req, res) => {
  try {
    const agencia_id = req.agencia.id;

    const result = await db.query(
      "SELECT id, nome FROM modelos WHERE agencia_id = $1 ORDER BY nome",
      [agencia_id]
    );

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar modelos" });
  }
});

router.get("/agencia/modelo/:id", authAgencia, async (req, res) => {
  try {
    const agencia_id = req.agencia.id;
    const modelo_id = Number(req.params.id);

    if (!Number.isInteger(modelo_id) || modelo_id <= 0) {
      return res.status(400).json({ error: "Modelo inválida" });
    }

    const result = await db.query(
      `
      SELECT
        m.id,
        m.nome,

        /* ================= DIA ================= */

        COALESCE(SUM(CASE
          WHEN ta.data_sp = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
          THEN ta.valor_modelo
        END), 0) AS modelo_dia,

        COALESCE(SUM(CASE
          WHEN ta.data_sp = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
          THEN ta.agency_fee
        END), 0) AS agencia_dia,

        COALESCE(SUM(CASE
          WHEN ta.data_sp = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
          THEN ta.velvet_fee
        END), 0) AS velvet_dia,

        /* ================= MÊS ================= */

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('month', ta.data_sp) =
               DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
          THEN ta.valor_modelo
        END), 0) AS modelo_mes,

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('month', ta.data_sp) =
               DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
          THEN ta.agency_fee
        END), 0) AS agencia_mes,

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('month', ta.data_sp) =
               DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
          THEN ta.velvet_fee
        END), 0) AS velvet_mes,

        /* ================= ANO ================= */

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('year', ta.data_sp) =
               DATE_TRUNC('year', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
          THEN ta.valor_modelo
        END), 0) AS modelo_ano,

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('year', ta.data_sp) =
               DATE_TRUNC('year', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
          THEN ta.agency_fee
        END), 0) AS agencia_ano,

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('year', ta.data_sp) =
               DATE_TRUNC('year', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
          THEN ta.velvet_fee
        END), 0) AS velvet_ano

      FROM modelos m

      LEFT JOIN (
        SELECT
          modelo_id,
          valor_modelo,
          velvet_fee,
          agency_fee,
          (created_at AT TIME ZONE 'America/Sao_Paulo')::date AS data_sp
        FROM transacoes_agency
        WHERE status = 'pago'
      ) ta ON ta.modelo_id = m.id

      WHERE m.agencia_id = $1
        AND m.id = $2

      GROUP BY m.id, m.nome
      `,
      [agencia_id, modelo_id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Modelo não encontrada" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("❌ ERRO /agencia/modelo/:id:", err);
    res.status(500).json({ error: "Erro ao buscar dados da modelo" });
  }
});

router.get("/agencia/pagamentos", authAgencia, async (req, res) => {
  try {
    const agencia_id = req.agencia.id;

    const result = await db.query(`
      SELECT
        p.id,
        p.referencia_mes,
        p.valor_midias,
        p.valor_assinaturas,
        p.valor_total,
        p.data_pagamento,
        m.nome AS modelo_nome
      FROM pagamentos_agencia p
      JOIN modelos m ON m.id = p.modelo_id
      WHERE p.agencia_id = $1
      ORDER BY p.data_pagamento DESC
    `, [agencia_id]);

    res.json(result.rows);

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Erro ao buscar pagamentos" });
  }
});

router.get("/agencia/me", authAgencia, async (req,res)=>{

  const agencia_id = req.agencia.id;

  const result = await db.query(
    "SELECT id, nome FROM agencias WHERE id = $1",
    [agencia_id]
  );

  if(!result.rowCount){
    return res.sendStatus(404);
  }

  res.json(result.rows[0]);
});

router.get("/agencia/dashboard", authAgencia, async (req, res) => {
  try {
    const agencia_id = req.agencia.id;

    const result = await db.query(
      `
      SELECT
        /* ================= HOJE ================= */

        COALESCE(SUM(CASE
          WHEN data_sp = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
           AND tipo = 'midia'
          THEN agency_fee
        END), 0) AS midias_hoje,

        COALESCE(SUM(CASE
          WHEN data_sp = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
           AND tipo = 'assinatura'
          THEN agency_fee
        END), 0) AS assinaturas_hoje,

        /* ================= MÊS ================= */

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('month', data_sp) =
               DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
           AND tipo = 'midia'
          THEN agency_fee
        END), 0) AS midias_mes,

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('month', data_sp) =
               DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
           AND tipo = 'assinatura'
          THEN agency_fee
        END), 0) AS assinaturas_mes,

        /* ================= TOTAIS ================= */

        COALESCE(SUM(CASE
          WHEN data_sp = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
          THEN agency_fee
        END), 0) AS total_hoje,

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('month', data_sp) =
               DATE_TRUNC('month', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
          THEN agency_fee
        END), 0) AS total_mes,

        COALESCE(SUM(CASE
          WHEN DATE_TRUNC('year', data_sp) =
               DATE_TRUNC('year', (NOW() AT TIME ZONE 'America/Sao_Paulo')::date)
          THEN agency_fee
        END), 0) AS total_ano

      FROM (
        SELECT
          ta.tipo,
          ta.agency_fee,
          (ta.created_at AT TIME ZONE 'America/Sao_Paulo')::date AS data_sp
        FROM transacoes_agency ta
        INNER JOIN modelos m ON m.id = ta.modelo_id
        WHERE ta.status = 'pago'
          AND m.agencia_id = $1
      ) dados
      `,
      [agencia_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Erro dashboard agência:", err);
    res.status(500).json({ error: "Erro ao carregar dashboard" });
  }
});

router.get("/admin/agencias", auth, authAdmin, async (req,res)=>{
  try{

    const result = await db.query(`
      SELECT id, nome
      FROM agencias
      ORDER BY nome ASC
    `);

    res.json(result.rows);

  } catch(err){
    console.error("Erro buscar agências:", err);
    res.status(500).json({ error:"Erro ao buscar agências" });
  }
});

// ===========================
// transacoes origem
// ===========================

router.get("/transacoes/origem",
  auth,
  requireRole("admin"),
  async (req, res) => {
    const result = await db.query(`
      SELECT origem_cliente,
             COUNT(*) AS clientes,
             SUM(valor_bruto) AS total
      FROM transacoes_agency
      WHERE status = 'pago'
      GROUP BY origem_cliente
    `);

    res.json(result.rows);
  }
);

// ===========================
// PUTS - ALTERACOES
// ===========================

// router.put("/admin/modelo/:id/feed", auth, authAdmin, async (req,res)=>{

// const modelo_id = Number(req.params.id);
// const { feed } = req.body;

// try{

// await db.query(`
// UPDATE modelos
// SET feed = $1
// WHERE id = $2
// `,[feed, modelo_id]);

// res.json({ feed });

// }catch(err){
// console.error("Erro alterar feed:",err);
// res.status(500).json({ error:"Erro alterar feed" });
// }

// });

// router.put("/admin/validar-modelo/:id", auth, authAdmin, async (req,res)=>{
//   const client = await db.connect();

//   try {
//     await client.query("BEGIN");

//     const modelo_id = Number(req.params.id);
//     const { status, motivo_rejeicao } = req.body;

// const modeloRes = await client.query(
//   "SELECT user_id, nome_exibicao FROM modelos WHERE id=$1",
//   [modelo_id]
// );

//     if(!modeloRes.rowCount){
//       throw new Error("Modelo não encontrada");
//     }

// const user_id = modeloRes.rows[0].user_id;
// const nome_modelo = modeloRes.rows[0].nome_exibicao;

//     const userRes = await client.query(
//       "SELECT role FROM users WHERE id=$1",
//       [user_id]
//     );

//     const roleAtual = userRes.rows[0].role;

//     const emailRes = await client.query(
//   "SELECT email FROM users WHERE id=$1",
//   [user_id]
// );

// const email = emailRes.rows[0]?.email;

//     if(status === "aprovado"){

//       // 🟣 Se for cliente → migrar
//       if(roleAtual === "cliente"){

//         // 1️⃣ Atualizar role
//         await client.query(
//           "UPDATE users SET role='modelo' WHERE id=$1",
//           [user_id]
//         );

//         // 2️⃣ Criar registro em modelos
//         await client.query(`
//           INSERT INTO modelos (user_id, nome_exibicao, created_at)
//           SELECT user_id, nome, NOW()
//           FROM clientes
//           WHERE user_id=$1
//           ON CONFLICT (user_id) DO NOTHING
//         `,[user_id]);

//         // 3️⃣ Copiar clientes_dados → modelos_dados
//         await client.query(`
//           INSERT INTO modelos_dados (
//             modelo_id,
//             nome_completo,
//             data_nascimento,
//             telefone,
//             endereco,
//             pais,
//             cidade,
//             estado,
//             instagram,
//             tiktok
//           )
//           SELECT
//             m.id,
//             cd.nome_completo,
//             cd.data_nascimento,
//             cd.telefone,
//             cd.endereco,
//             cd.pais,
//             cd.cidade,
//             cd.estado,
//             cd.instagram,
//             cd.tiktok
//           FROM clientes_dados cd
//           JOIN modelos m ON m.user_id = cd.cliente_id
//           WHERE cd.cliente_id=$1
//           ON CONFLICT (modelo_id) DO NOTHING
//         `,[user_id]);
//       }

//       // 🔹 Marcar como verificada
//       await client.query(
//         "UPDATE modelos SET verificada=true WHERE id=$1",
//         [modelo_id]
//       );
//     }

//     // 🔹 Atualizar status da verificação
// await client.query(`
//   UPDATE modelos_verificacao
//   SET
//     status = $1,
//     motivo_rejeicao = $2,
//     verificado_em = NOW()
//   WHERE modelo_id = $3
// `,[
//   status,
//   motivo_rejeicao || null,
//   modelo_id
// ]);

//     await client.query("COMMIT");
  

// if(status === "aprovado" && email){
//   try{
//     await enviarEmailAprovacao(email);
//   }catch(e){
//     console.error("Erro enviar email aprovação:", e);
//   }
// }

// if(status === "rejeitado" && email){
//   try{
//     await enviarEmailRejeicao(email, motivo_rejeicao);
//   }catch(e){
//     console.error("Erro enviar email rejeição:", e);
//   }
// }
//     res.json({ message:"Processo concluído" });

//   } catch(err){
//     await client.query("ROLLBACK");
//     console.error(err);
//     res.status(500).json({ error:"Erro ao validar modelo" });
//   } finally {
//     client.release();
//   }
// });

// router.put("/admin/validar-cliente/:id", auth, authAdmin, async (req,res)=>{

//   const cliente_id = Number(req.params.id);
//   const { status, motivo_rejeicao } = req.body;

//   const client = await db.connect();
//    let email = null;
//   let nome_cliente = null;

//   try {
//     await client.query("BEGIN");

//     // 🔹 Atualiza status da verificação
//     await client.query(`
//       UPDATE clientes_verificacao
//       SET
//         status = $2,

//         motivo_rejeicao = $3,
//         verificado_em = NOW(),
//         atualizado_em = NOW()
//       WHERE cliente_id = $1
//     `,[cliente_id, status, motivo_rejeicao || "Não informado"]);

//     if (status === "aprovado") {

//   // 🔹 1️⃣ Buscar user_id do cliente
//   const userRes = await client.query(
//     "SELECT user_id, nome FROM clientes WHERE id = $1",
//     [cliente_id]
//   );

//   if (!userRes.rowCount) {
//     throw new Error("Cliente não encontrado");
//   }

//   const user_id = userRes.rows[0].user_id;
//   nome_cliente = userRes.rows[0].nome;

//   const emailRes = await client.query(
//   "SELECT email FROM users WHERE id=$1",
//   [user_id]
// );

// email = emailRes.rows[0]?.email;

//   // 🔹 2️⃣ Atualizar role no users
//   await client.query(
//     "UPDATE users SET role = 'modelo' WHERE id = $1",
//     [user_id]
//   );

//   // 🔹 3️⃣ Criar registro em modelos (copiando clientes → modelos)
//   await client.query(`
//     INSERT INTO modelos (
//       user_id,
//       nome,
//       nome_exibicao,
//       local,
//       bio,
//       avatar,
//       capa,
//       created_at,
//       verificada
//     )
//     SELECT
//       c.user_id,
//       c.nome,
//       cd.nome_exibicao,
//       cd.local,
//       cd.bio,
//       cd.avatar,
//       cd.capa,
//       NOW(),
//       true
//     FROM clientes c
//     LEFT JOIN clientes_dados cd ON cd.cliente_id = c.id
//     WHERE c.id = $1
//     ON CONFLICT (user_id) DO NOTHING
//   `, [cliente_id]);

//   // 🔹 4️⃣ Buscar modelo_id recém criado
//   const modeloRes = await client.query(
//     "SELECT id FROM modelos WHERE user_id = $1",
//     [user_id]
//   );

//   const modelo_id = modeloRes.rows[0].id;

//   // 🔹 5️⃣ Copiar clientes_dados → modelos_dados
//   await client.query(`
//     INSERT INTO modelos_dados (
//       modelo_id,
//       nome_completo,
//       data_nascimento,
//       telefone,
//       endereco,
//       pais,
//       cidade,
//       estado,
//       instagram,
//       tiktok,
//       vip_preco
//     )
//     SELECT
//       $1,
//       cd.nome_completo,
//       cd.data_nascimento,
//       cd.telefone,
//       cd.endereco,
//       cd.pais,
//       cd.cidade,
//       cd.estado,
//       cd.instagram,
//       cd.tiktok,
//       cd.vip_preco
//     FROM clientes_dados cd
//     WHERE cd.cliente_id = $2
//     ON CONFLICT (modelo_id) DO NOTHING
//   `, [modelo_id, cliente_id]);

//    await client.query(
//     "UPDATE clientes SET convertido_para_modelo = true WHERE id = $1",
//     [cliente_id]
//   );
// } 
//     await client.query("COMMIT");

//     if(status === "aprovado" && email){
//   try{
//     await enviarEmailAprovacao(email);
//   }catch(e){
//     console.error("Erro enviar email aprovação:", e);
//   }
// }

//     res.json({ success:true });

//   } catch (err) {

//     await client.query("ROLLBACK");
//     console.error("Erro validar cliente:", err);
//     res.status(500).json({ error:"Erro ao validar cliente" });

//   } finally {
//     client.release();
//   }
// });

// router.put("/admin/perfis/:id/editar", auth, authAdmin, async (req,res)=>{

//   const { id } = req.params;
//   const { tipo, dados } = req.body;

//   try{

//     if(tipo === "modelo"){

//       // Atualiza tabela modelos
//       await db.query(`
//         UPDATE modelos
//         SET nome_exibicao=$1,
//             local=$2,
//             bio=$3
//         WHERE id=$4
//       `,[
//         dados.nome_exibicao,
//         dados.local,
//         dados.bio,
//         id
//       ]);

//       // Atualiza modelos_dados
//       await db.query(`
//         UPDATE modelos_dados
//         SET nome_completo=$1,
//             data_nascimento=$2,
//             telefone=$3,
//             endereco=$4,
//             pais=$5,
//             estado=$6,
//             cidade=$7,
//             instagram=$8,
//             tiktok=$9,
//             vip_preco=$10
//         WHERE modelo_id=$11
//       `,[
//         dados.nome_completo,
//         dados.data_nascimento,
//         dados.telefone,
//         dados.endereco,
//         dados.pais,
//         dados.estado,
//         dados.cidade,
//         dados.instagram,
//         dados.tiktok,
//         dados.vip_preco,
//         id
//       ]);

//     } else {
//       await db.query(`
//          UPDATE clientes_dados
//         SET nome_completo=$1,
//             data_nascimento=$2,
//             telefone=$3,
//             endereco=$4,
//             pais=$5,
//             estado=$6,
//             cidade=$7,
//             instagram=$8,
//             tiktok=$9,
//             vip_preco=$10,
//             nome_exibicao=$11,
//             local=$12,
//             bio=$13
//         WHERE cliente_id=$14
//       `,[
//         dados.nome_completo,
//         dados.data_nascimento,
//         dados.telefone,
//         dados.endereco,
//         dados.pais,
//         dados.estado,
//         dados.cidade,
//         dados.instagram,
//         dados.tiktok,
//         dados.vip_preco,
//         dados.nome_exibicao,
//         dados.local,
//         dados.bio,
//         id
//       ]);
//     }

//     res.json({ message:"Atualizado com sucesso" });

//   }catch(err){
//     console.error(err);
//     res.status(500).json({ error:"Erro ao atualizar dados" });
//   }
// });

// router.put("/admin/modelo/:id/agencia", auth, authAdmin, async (req,res)=>{

// const modelo_id = Number(req.params.id);
// const { agencia_id } = req.body;

// try{

// await db.query(`
// UPDATE modelos
// SET agencia_id = $1
// WHERE id = $2
// `,[
// agencia_id || null,
// modelo_id
// ]);

// let nome_agencia = "Sem agência";

// if(agencia_id){

// const ag = await db.query(`
// SELECT nome
// FROM agencias
// WHERE id=$1
// `,[agencia_id]);

// nome_agencia = ag.rows[0]?.nome || "Agência";

// }

// res.json({
// ok:true,
// nome_agencia,
// data:new Date()
// });

// }catch(err){
// console.error("Erro alterar agência:",err);
// res.status(500).json({error:"Erro alterar agência"});
// }

// });

// ===========================
// EXPORT PARA SERVER
// ===========================

module.exports = {
  router,
  calcularValores
};