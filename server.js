console.log("SERVIDOR INICIADO - O SENHOR EH MEU PASTOR E NADA ME FALTARA!");

require("dotenv").config();

const http    = require("http");
const path    = require("path");
const { Server } = require("socket.io");
const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const compression = require("compression");

const ffmpeg = require("fluent-ffmpeg");
const ffmpegPath = require("ffmpeg-static");
ffmpeg.setFfmpegPath(ffmpegPath);

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) console.error("JWT_SECRET não configurado!");

// ── Módulos da aplicação ──────────────────────────────────────────────────────
const { setupSocket }      = require("./socket");
const { registerWebhooks } = require("./routes/webhooks");
const { router: servercontentRouter, calcularValores } = require("./servercontent");
const auth       = require("./middleware/auth");
const authAdmin  = require("./middleware/authAdmin");
const authCliente = require("./middleware/authCliente");
const db         = require("./db");
const { uploadB2, supabaseStorage }  = require("./config/storage");
const { uploadAvatarLimiter }        = require("./config/rateLimiters");
const { stripe }                     = require("./config/services");

const {
  authRouter,
  usuariosRouter,
  modelosRouter,
  clientesRouter,
  chatRouter,
  pagamentosRouter,
  conteudosRouter,
  premiumRouter,
  ofertasRouter,
  verificacaoRouter,
  notificacoesRouter,
  miscRouter,
  adminDashboardRouter,
  agencyDashboardRouter,
  adminEmailRouter,
  suporteRouter,
  inboxRouter
} = require("./routes/index");

// ── App & servidor ────────────────────────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

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

app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("CORS bloqueado: " + origin));
  },
  credentials: true
}));

// ── Socket.io ────────────────────────────────────────────────────────────────
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
  transports: ["websocket"]
});

setupSocket(io);
app.set("io", io);

// ── Modo manutenção ───────────────────────────────────────────────────────────
app.use((req, res, next) => {
  const MANUTENCAO = false;
  if (!MANUTENCAO) return next();
  const liberados = ["/manutencao.html", "/api/webhook/", "/api/admin/", "/admin/", "/public/admin/"];
  if (liberados.some(p => req.path.startsWith(p))) return next();
  return res.status(503).sendFile(path.join(__dirname, "manutencao.html"));
});

// ── Webhooks (ANTES do express.json global) ───────────────────────────────────
registerWebhooks(app);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(compression());

// ── Conteúdo servercontent ────────────────────────────────────────────────────
app.use("/api", servercontentRouter);
app.set("calcularValores", calcularValores);

// ── Arquivos estáticos ────────────────────────────────────────────────────────
app.use("/assets", express.static(path.join(__dirname, "assets")));
app.use("/icons",  express.static(path.join(__dirname, "icons")));
app.use("/app",    express.static("app"));
app.use(express.static(path.join(__dirname, "public")));
app.get("/manifest.json", (req, res) => res.sendFile(path.join(__dirname, "manifest.json")));

// ═══════════════════════════════════════════════════════════════════
//  ROTAS API
// ═══════════════════════════════════════════════════════════════════

// Autenticação & conta
app.use("/api", authRouter);

// Usuário
app.use("/api/usuario", usuariosRouter);

// Uploads de avatar/capa (sem prefixo /api — original)
app.post("/uploadAvatar", auth, uploadAvatarLimiter, uploadB2.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    const userId = req.user.id;
    const { mimetype, originalname, buffer } = req.file;
    const ext = originalname.split(".").pop();
    const caminho = `${userId}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabaseStorage.storage.from("avatars").upload(caminho, buffer, { contentType: mimetype, upsert: true });
    if (uploadErr) throw uploadErr;
    const { data: { publicUrl } } = supabaseStorage.storage.from("avatars").getPublicUrl(caminho);
    if (req.user.role === "modelo") {
      const r = await db.query("SELECT id FROM modelos WHERE user_id=$1", [userId]);
      if (!r.rowCount) return res.status(404).json({ error: "Modelo não encontrado" });
      await db.query("UPDATE modelos SET avatar=$1 WHERE id=$2", [publicUrl, r.rows[0].id]);
    } else if (req.user.role === "cliente") {
      const r = await db.query("SELECT id FROM clientes WHERE user_id=$1", [userId]);
      if (!r.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
      await db.query("UPDATE clientes_dados SET avatar=$1, atualizado_em=NOW() WHERE cliente_id=$2", [publicUrl, r.rows[0].id]);
    } else {
      return res.status(403).json({ error: "Role inválida" });
    }
    res.json({ avatar: publicUrl });
  } catch (err) {
    console.error("Erro upload avatar:", err);
    res.status(500).json({ error: "Erro ao atualizar avatar" });
  }
});

app.post("/uploadCapa", auth, uploadAvatarLimiter, uploadB2.single("capa"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Arquivo não enviado" });
    const userId = req.user.id;
    const { mimetype, originalname, buffer } = req.file;
    const ext = originalname.split(".").pop();
    const caminho = `${userId}/${Date.now()}.${ext}`;
    const { error: uploadErr } = await supabaseStorage.storage.from("capas").upload(caminho, buffer, { contentType: mimetype, upsert: true });
    if (uploadErr) throw uploadErr;
    const { data: { publicUrl } } = supabaseStorage.storage.from("capas").getPublicUrl(caminho);
    if (req.user.role === "modelo") {
      await db.query("UPDATE modelos SET capa=$1 WHERE user_id=$2", [publicUrl, userId]);
    } else if (req.user.role === "cliente") {
      const r = await db.query("SELECT id FROM clientes WHERE user_id=$1", [userId]);
      if (!r.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
      await db.query("UPDATE clientes_dados SET capa=$1, atualizado_em=NOW() WHERE cliente_id=$2", [publicUrl, r.rows[0].id]);
    } else {
      return res.status(403).json({ error: "Role inválida" });
    }
    res.json({ capa: publicUrl });
  } catch (err) {
    console.error("Erro upload capa:", err);
    res.status(500).json({ error: "Erro ao atualizar capa" });
  }
});

// Modelos
app.use("/api/modelo", modelosRouter);
app.get("/api/modelos", auth, async (req, res) => {
  // Delega para o handler do feed no modelosRouter (mesmo código)
  req.url = "/feed";
  modelosRouter(req, res, () => res.status(404).json({ error: "Not found" }));
});
app.get("/modelo/relatorio", (req, res) => {
  res.sendFile(path.join(process.cwd(), "admin-pages", "relatorio.html"));
});
app.get("/conteudos.html", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "conteudos.html"));
});

// Clientes
app.use("/api/cliente", clientesRouter);

// Chat & mensagens
app.use("/api/chat", chatRouter);
app.post("/api/conteudo/visto", auth, async (req, res) => {
  const { message_id } = req.body;
  const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [req.user.id]);
  if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
  await db.query("UPDATE messages SET visto=true, updated_at=NOW() WHERE id=$1 AND cliente_id=$2", [message_id, clienteRes.rows[0].id]);
  res.json({ ok: true });
});

// VIP status & cancelar
app.get("/api/vip/status/:modelo_id", authCliente, async (req, res) => {
  try {
    const modelo_id = Number(req.params.modelo_id);
    if (!Number.isInteger(modelo_id) || modelo_id <= 0) return res.status(400).json({ error: "modelo_id inválido" });
    const result = await db.query(
      `SELECT expiration_at FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 AND ativo=true AND expiration_at>NOW() ORDER BY expiration_at DESC LIMIT 1`,
      [req.cliente_id, modelo_id]
    );
    res.json({ vip: result.rowCount > 0, expiration_at: result.rows[0]?.expiration_at || null });
  } catch (err) {
    console.error("Erro buscar status VIP:", err);
    res.status(500).json({ error: "Erro interno" });
  }
});

app.post("/api/vip/cancelar", auth, async (req, res) => {
  try {
    const { modelo_id } = req.body;
    if (!modelo_id || isNaN(Number(modelo_id))) return res.status(400).json({ error: "modelo_id inválido" });
    const clienteRes = await db.query("SELECT id FROM clientes WHERE user_id=$1", [req.user.id]);
    if (!clienteRes.rowCount) return res.status(404).json({ error: "Cliente não encontrado" });
    const cliente_id = clienteRes.rows[0].id;
    const vip = await db.query(`SELECT stripe_subscription_id FROM vip_subscriptions WHERE cliente_id=$1 AND modelo_id=$2 AND recorrente=true LIMIT 1`, [cliente_id, modelo_id]);
    if (vip.rowCount === 0) return res.status(404).json({ error: "Assinatura não encontrada" });
    await stripe.subscriptions.update(vip.rows[0].stripe_subscription_id, { cancel_at_period_end: true });
    await db.query("UPDATE vip_subscriptions SET recorrente=false WHERE cliente_id=$1 AND modelo_id=$2", [cliente_id, modelo_id]);
    res.json({ ok: true });
  } catch (err) {
    console.error("Erro cancelar VIP:", err);
    res.status(500).json({ error: "Erro ao cancelar assinatura" });
  }
});

// Pagamentos
app.use("/api/pagamento", pagamentosRouter);

// Conteúdos
app.use("/api/conteudos", conteudosRouter);
app.post("/api/upload", auth, (req, res, next) => {
  req.url = "/upload";
  conteudosRouter(req, res, next);
});

// Premium — rota pública de lista ANTES do /api/premium catch-all
app.get("/api/modelo/publico/:modelo_id/premium", (req, res, next) => {
  // Encaminha para o handler de premium router
  const originalUrl = req.url;
  req.url = `/publico/${req.params.modelo_id}`;
  premiumRouter(req, res, () => { req.url = originalUrl; next(); });
});
app.use("/api/premium", premiumRouter);

// Ofertas
app.use("/api/ofertas", ofertasRouter);

// Verificação
app.use("/api/verificacao", verificacaoRouter);

// Notificações
app.use("/api/notificacoes", notificacoesRouter);

// Admin & agência
app.use("/admin/dashboard", adminDashboardRouter);
app.use("/agency/dashboard", agencyDashboardRouter);
app.use("/api/admin/email", auth, authAdmin, adminEmailRouter);
app.use("/api/suporte", suporteRouter);
app.use("/api/inbox", inboxRouter);

// Misc (health, push public-key, stripe pk, app state, contato)
app.use("/api", miscRouter);

// ── Logger de requisições ─────────────────────────────────────────────────────
app.use((req, res, next) => {
  console.log("REQ:", req.method, req.url);
  next();
});

// ── Handler de erro global ────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  const isProduction = process.env.NODE_ENV === "production";
  console.error("ERRO GLOBAL:", { message: err.message, path: req.originalUrl, method: req.method, stack: isProduction ? undefined : err.stack });
  if (err.statusCode) return res.status(err.statusCode).json({ error: err.message });
  return res.status(500).json({ error: "Erro interno do servidor" });
});

process.on("unhandledRejection", (reason) => console.error("Unhandled Rejection:", reason));
process.on("uncaughtException", (err) => { console.error("Uncaught Exception:", err); process.exit(1); });

// ── Iniciar servidor ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor rodando na porta", PORT);
});
