const express  = require("express");
const router   = express.Router();
const crypto   = require("crypto");
const db       = require("../db");
const auth     = require("../middleware/auth");
const requireRole = require("../middleware/requireRole");
const authModelo  = require("../middleware/authModelo");

// Estado em memória dos jobs de envio em massa
const allmessageJobs = new Map();

async function processarAllmessageJob(jobId, { modelo_id, texto, preco, conteudos, modo_teste }) {
  const job = allmessageJobs.get(jobId);
  if (!job) return;

  try {
    const temConteudo  = Array.isArray(conteudos) && conteudos.length > 0;
    const precoFinal   = Number(preco) || 0;

    const clientesRes = await db.query(
      `SELECT cliente_id FROM vip_subscriptions WHERE modelo_id=$1 AND ativo=true`,
      [modelo_id]
    );
    if (clientesRes.rowCount === 0) {
      job.status = "erro"; job.error = "Nenhum assinante ativo encontrado";
      job.percentual = 0; job.finalizado_em = new Date().toISOString();
      return;
    }

    let clientes = clientesRes.rows;
    if (modo_teste) clientes = clientes.slice(0, 1);

    job.total = clientes.length; job.processados = 0; job.enviados = 0;
    job.falhas = 0; job.percentual = 0; job.status = "processando"; job.error = null;

    for (const row of clientes) {
      const cliente_id = row.cliente_id;
      try {
        await db.query(
          `INSERT INTO messages (modelo_id, cliente_id, text, sender, visto, tipo) VALUES ($1,$2,$3,'modelo',false,'texto')`,
          [modelo_id, cliente_id, texto]
        );
        if (temConteudo) {
          const msgRes = await db.query(
            `INSERT INTO messages (modelo_id, cliente_id, text, sender, preco, visto, tipo) VALUES ($1,$2,'','modelo',$3,false,'conteudo_ppv_mass') RETURNING id`,
            [modelo_id, cliente_id, precoFinal]
          );
          const message_id = msgRes.rows[0].id;
          await db.query(
            `INSERT INTO conteudo_pacotes (cliente_id, modelo_id, preco, valor_total, status, message_id) VALUES ($1,$2,$3,$4,'pendente',$5)`,
            [cliente_id, modelo_id, precoFinal, precoFinal, message_id]
          );
          for (const conteudo_id of conteudos) {
            await db.query(
              `INSERT INTO messages_conteudos (message_id, conteudo_id) VALUES ($1,$2)`,
              [message_id, conteudo_id]
            );
          }
        }
        job.enviados++;
      } catch (err) {
        console.error(`Falha ao enviar para cliente ${cliente_id}:`, err);
        job.falhas++;
      }
      job.processados++;
      job.percentual = job.total > 0 ? Math.round((job.processados / job.total) * 100) : 0;
    }
    job.status = "concluido"; job.percentual = 100;
    job.finalizado_em = new Date().toISOString();
  } catch (err) {
    console.error("Erro geral no processarAllmessageJob:", err);
    job.status = "erro"; job.error = err.message || "Erro interno";
    job.finalizado_em = new Date().toISOString();
  }
}

// POST /api/allmessage
router.post("/", auth, requireRole("admin", "modelo"), async (req, res) => {
  try {
    const { texto, preco, conteudos, modo_teste } = req.body;
    let modelo_id;
    if (req.user.role === "modelo") {
      const r = await db.query("SELECT id FROM modelos WHERE user_id=$1", [req.user.id]);
      if (r.rowCount === 0) return res.status(403).json({ error: "Modelo não encontrada" });
      modelo_id = r.rows[0].id;
    } else {
      modelo_id = req.body.modelo_id;
    }
    if (!modelo_id || !texto) return res.status(400).json({ error: "Dados inválidos" });

    const jobId = crypto.randomUUID();
    allmessageJobs.set(jobId, {
      jobId, status: "processando", modelo_id, total: 0, processados: 0,
      enviados: 0, falhas: 0, percentual: 0, modo_teste: !!modo_teste,
      criado_em: new Date().toISOString(), error: null
    });
    res.json({ ok: true, jobId });
    processarAllmessageJob(jobId, { modelo_id, texto, preco, conteudos, modo_teste })
      .catch(err => {
        const job = allmessageJobs.get(jobId);
        if (job) { job.status = "erro"; job.error = err.message; }
      });
  } catch (err) {
    console.error("ERRO ALLMESSAGE ENVIO:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/allmessage/modelos
router.get("/modelos", auth, requireRole("admin", "modelo"), async (req, res) => {
  try {
    let sql = `SELECT m.id AS modelo_id, m.nome AS nome FROM modelos m`;
    let params = [];
    if (req.user.role === "modelo") { sql += ` WHERE m.user_id=$1`; params.push(req.user.id); }
    sql += ` ORDER BY m.nome`;
    const result = await db.query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error("Erro ALLMESSAGE modelos:", err);
    res.status(500).json({ error: "Erro ao listar modelos" });
  }
});

// GET /api/allmessage/status/:jobId
router.get("/status/:jobId", auth, requireRole("admin", "modelo"), async (req, res) => {
  try {
    const job = allmessageJobs.get(req.params.jobId);
    if (!job) return res.status(404).json({ error: "Job não encontrado ou expirado" });
    res.json(job);
  } catch (err) {
    console.error("ERRO STATUS ALLMESSAGE:", err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/allmessage/conteudos/:modelo_id
router.get("/conteudos/:modelo_id", auth, requireRole("admin", "modelo"), async (req, res) => {
  try {
    const { modelo_id } = req.params;
    if (req.user.role === "modelo") {
      const check = await db.query(`SELECT 1 FROM modelos WHERE id=$1 AND user_id=$2`, [modelo_id, req.user.id]);
      if (check.rowCount === 0) return res.json([]);
    }
    const result = await db.query(
      `SELECT id, url, thumbnail_url AS thumbnail FROM conteudos WHERE modelo_id=$1 AND tipo_conteudo='venda' ORDER BY id DESC`,
      [modelo_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erro ALLMESSAGE conteudos:", err);
    res.json([]);
  }
});

module.exports = router;
