//===========================
// AUTH
// ===============================
const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

if (!token || role !== "cliente") {
  logout();
}

const LIMITE_INICIAL = 30;
let offset = 0;
let listaCompleta = [];
const chatsMap = new Map();

// ✅ CORRIGIDO: declarar clienteId com let para evitar variável global implícita
let clienteId = null;

const params = new URLSearchParams(window.location.search);
const modelo_id = params.get("modelo_id");

  document.addEventListener("DOMContentLoaded", () => {
    
  const btnVoltar = document.getElementById("btnVoltarPerfil");

  if (btnVoltar) {
    btnVoltar.addEventListener("click", () => {
      if (modelo_id) {
        window.location.href = `/perfil.html?id=${modelo_id}`;
      } else {
        window.location.href = "/feed.html";
      }
    });
  }

  initClienteInbox();
});

// ===============================
// SOCKET
// ===============================
const socket = io({
  transports: ["websocket", "polling"],
  auth: {
    token
  },
  reconnection: true,
  reconnectionAttempts: 5,
  reconnectionDelay: 2000,
  timeout: 10000
});

function entrarInbox() {
  // ✅ CORRIGIDO: não passa payload — o servidor descobre a sala pelo socket.user
  socket.emit("joinInbox", (res) => {
    if (!res?.ok) {
      console.warn("⚠️ Falha ao entrar na inbox cliente:", res?.error);
      return;
    }
    console.log("📬 Inbox cliente conectada:", res.sala);
  });
}

socket.on("connect", () => {
  console.log("🟢 Inbox cliente conectado:", socket.id);
  // ✅ CORRIGIDO: sempre chama entrarInbox no connect — o servidor autentica pelo token
  // clienteId pode ainda ser null aqui, mas o servidor usa socket.user (do token JWT)
  entrarInbox();
});

socket.on("connect_error", (err) => {
  console.error("❌ connect_error socket:", err.message, err);
});

socket.on("inboxMessage", dados => {
  tocarSomNotificacao();
  atualizarChatLocal(dados);

  // fallback segurança
  if (!chatsMap.has(dados.modelo_id)) {
    carregarListaModelos();
  }

});

socket.on("disconnect", (reason) => {
  console.warn("🔴 Inbox desconectado:", reason);
});

// ===============================
// ELEMENTOS
// ===============================
const inboxEl = document.getElementById("inbox");

// ===============================
// INIT
// ===============================
async function initClienteInbox() {
  const res = await fetch("/api/cliente/me", {
    headers: { Authorization: "Bearer " + token }
  });

  if (!res.ok) return logout();

  const me = await res.json();
  clienteId = me.id;

  // ✅ CORRIGIDO: se o socket já conectou antes do clienteId ser definido,
  // chama entrarInbox novamente agora que temos o id (o servidor vai fazer join na sala certa)
  if (socket.connected) {
    entrarInbox();
  }

  carregarListaModelos();
}
// ===============================
// PRIORIDADE CHAT
// ===============================
function prioridadeChat(c) {

  // mensagem da modelo não lida
  if (c.sender === "modelo" && c.lida === false) return 1;

  // modelo enviou e você leu
  if (c.sender === "modelo" && c.lida === true) return 2;

  // você enviou por último
  if (c.sender === "cliente") return 3;

  return 4;
}

// ===============================
// FETCH MODELOS
// ===============================
async function carregarListaModelos() {

  try {

    const res = await fetch("/api/chat/cliente", {
      headers: { Authorization: "Bearer " + token }
    });

    if (!res.ok) return;

    const modelos = await res.json();
    preloadAvatars(modelos);

    // ordenação inteligente
    modelos.sort((a, b) => {

      const pa = prioridadeChat(a);
      const pb = prioridadeChat(b);

      if (pa !== pb) return pa - pb;

      const da = a.ultima_mensagem_em ? new Date(a.ultima_mensagem_em) : 0;
      const db = b.ultima_mensagem_em ? new Date(b.ultima_mensagem_em) : 0;

      return db - da;
    });

    listaCompleta = modelos;

offset = 0;

inboxEl.innerHTML = "";
chatsMap.clear();

renderizarMais();

  } catch (err) {

    console.error("Erro inbox cliente:", err);

  }

}

// ===============================
// TEMPO
// ===============================
function formatarTempo(data) {
  if (!data) return "";

  const d = new Date(data);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);

  if (diff === 0) {
    return d.toLocaleTimeString(
      localStorage.getItem("lang") || "pt",
      { hour: "2-digit", minute: "2-digit" }
    );
  }

  if (diff === 1) return t("inboxc.day_singular");

  return t("inboxc.day_plural").replace("{n}", diff);
}

// ===============================
// HELPERS
// ===============================
function abrirChat(modeloId) {
  window.location.href = `/chatc.html?modelo_id=${modeloId}`;
}

async function logout() {
  const token = localStorage.getItem("token");
  if (token) {
    try { await fetch("/api/logout", { method: "POST", headers: { Authorization: "Bearer " + token } }); } catch (_) {}
  }
  localStorage.clear();
  location.href = "/index.html";
}

function atualizarChatLocal(dados) {

  const chatId = dados.cliente_id || dados.modelo_id;

  const chat = chatsMap.get(chatId);

  if (!chat) return;

  const el = chat.element;

  // atualizar mensagem
  el.querySelector(".chat-last").textContent =
    dados.ultima_mensagem || "";

  // atualizar horário
  el.querySelector(".chat-time").textContent =
    formatarTempo(dados.ultima_mensagem_em);

  // atualizar status
  el.querySelector(".chat-status").innerHTML =
    gerarStatus(dados);

  moverChatParaTopo(el);

}

function moverChatParaTopo(el) {

  const primeiro = inboxEl.firstChild;

  if (primeiro !== el) {
    inboxEl.insertBefore(el, primeiro);
  }

}

function gerarStatus(c) {
  if (c.sender === "modelo" && c.lida === false) {
    return `<span class="status status-unseen">${t("inboxc.chat_unread")}</span>`;
  }

  if (c.sender === "modelo" && c.lida === true) {
    return `<span class="status status-read">✓✓</span>`;
  }

  if (c.sender === "cliente") {
    return `<span class="status status-sent">✓</span>`;
  }

  return "";
}

function renderizarMais() {

  const slice = listaCompleta.slice(offset, offset + LIMITE_INICIAL);

  slice.forEach(m => {

    let statusHTML = "";

    if (m.sender === "modelo" && m.lida === false) {
      statusHTML = `<span class="status status-unseen">${t("inboxc.chat_unread")}</span>`;
    } else if (m.sender === "modelo" && m.lida === true) {
      statusHTML = `<span class="status status-read">✓✓</span>`;
    } else if (m.sender === "cliente") {
      statusHTML = `<span class="status status-sent">✓</span>`;
    }

    const div = document.createElement("div");
    div.className = "chat-item";

    div.onclick = () => abrirChat(m.modelo_id);

    div.innerHTML = `
    <div class="avatar">
      <img 
        src="${m.avatar || 'assets/avatar.png'}"
        width="40"
        height="40"
        loading="lazy"
        decoding="async"
        fetchpriority="low"
      />
    </div>

    <div class="chat-body">
      <div class="chat-top">
        <span class="chat-name">
          ${m.nome_exibicao || t("inboxc.chat_model")}
        </span>

        <span class="chat-time">
          ${formatarTempo(m.ultima_mensagem_em)}
        </span>
      </div>

      <div class="chat-bottom">
        <span class="chat-last">
          ${m.ultima_mensagem || ""}
        </span>

        <div class="chat-status">
          ${statusHTML}
        </div>
      </div>
    </div>
    `;

    inboxEl.appendChild(div);

    chatsMap.set(m.modelo_id, {
      data: m,
      element: div
    });

  });

  offset += LIMITE_INICIAL;
}


function preloadAvatars(modelos) {

  modelos.slice(0,10).forEach(m => {

    const avatar = m.avatar_thumb || m.avatar;
    if (!avatar) return;

    const img = new Image();
    img.src = avatar;

  });

}

function tocarSomNotificacao() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // silencia erros — áudio pode ser bloqueado antes de interação do usuário
  }
}

// ===============================
// ATUALIZA AO VOLTAR PRA ABA
// ===============================
setInterval(() => {

  if (document.visibilityState === "visible") {
    carregarListaModelos();
  }

}, 30000);