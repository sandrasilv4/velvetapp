
// ===============================
// AUTH
// ===============================
const token = localStorage.getItem("token");
const role = localStorage.getItem("role");

if (!token || role !== "modelo") {
  logout();
}

// ===============================
// ESTADO
// ===============================
const LIMIT = 20;
let offset = 0;
let listaCompleta = [];
let carregando = false;
let fimLista = false;

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

socket.on("connect", () => {
  console.log("🟢 Inbox conectado:", socket.id);
  entrarInbox();
});

socket.on("connect_error", (err) => {
  console.error("❌ connect_error socket:", err.message, err);
});

socket.on("inboxMessage", async (dados) => {
  tocarSomNotificacao();
  const chatId = dados.cliente_id || dados.modelo_id;
  const jaExisteNaTela = chatsMap.has(chatId);

  atualizarChatLocal(dados);

  if (!jaExisteNaTela) {
    await recarregarInboxDoZero();
  }
});

socket.on("disconnect", (reason) => {
  console.warn("🔴 Inbox desconectado:", reason);
});


// ===============================
// ELEMENTOS
// ===============================
const inboxEl = document.getElementById("inbox");
const chatsMap = new Map();
const btnVoltarPerfil = document.getElementById("btnVoltarPerfil");
const modeloId = localStorage.getItem("modelo_id") || localStorage.getItem("user_id");

if (btnVoltarPerfil) {
  btnVoltarPerfil.addEventListener("click", () => {
    if (modeloId) {
      window.location.href = `/perfil.html?id=${modeloId}`;
    } else {
      window.location.href = "/perfil.html";
    }
  });
}

// ===============================
// INIT
// ===============================

window.addEventListener("load", async () => {
  await carregarInboxInicial();
});

window.addEventListener("scroll", () => {

  const pertoDoFim =
    window.innerHeight + window.scrollY >=
    document.body.offsetHeight - 100;

  if (pertoDoFim) {
    carregarListaClientes();
  }

});

function entrarInbox() {
socket.emit("joinInbox", (res) => {
    if (!res?.ok) {
      console.warn("⚠️ Falha ao entrar na inbox:", res?.error);
      return;
    }

    console.log("📬 Entrou na inbox:", res.sala);
  });
}

// ===============================
// HELPERS DE ESTADO
// ===============================

function normalizarChat(c) {
  const ultimo_sender = c.ultimo_sender ?? c.sender ?? null;
  const lida = Boolean(c.lida);
  const visto = Boolean(c.visto);

  return {
    ...c,
    ultimo_sender,
    lida,
    visto,
    nao_lido: ultimo_sender === "cliente" && lida === false,
    por_responder: ultimo_sender === "cliente" && lida === true,
    cliente_visualizou: ultimo_sender === "modelo" && visto === true
  };
}

function upsertChats(clientes) {
  clientes
    .map(normalizarChat)
    .forEach(c => {
      const idx = listaCompleta.findIndex(x => x.cliente_id === c.cliente_id);

      if (idx === -1) {
        listaCompleta.push(c);
      } else {
        listaCompleta[idx] = {
          ...listaCompleta[idx],
          ...c
        };
      }
    });
}

async function recarregarInboxDoZero() {
  if (carregando) return;
  await carregarInboxInicial();
}

// ===============================
// PRIORIDADE CHAT
// ===============================

function prioridadeChat(c) {
  if (c.nao_lido) return 1;           // cliente enviou, modelo não leu
  if (c.por_responder) return 2;       // modelo leu, ainda não respondeu
  if (c.cliente_visualizou) return 3;  // modelo enviou, cliente leu mas não respondeu
  if (c.ultimo_sender === "modelo") return 4; // modelo enviou, cliente ainda não viu
  return 5;
}

function compararChats(a, b) {
  const pa = prioridadeChat(a);
  const pb = prioridadeChat(b);

  if (pa !== pb) return pa - pb;

  const da = a.ultima_mensagem_em ? new Date(a.ultima_mensagem_em).getTime() : 0;
  const db = b.ultima_mensagem_em ? new Date(b.ultima_mensagem_em).getTime() : 0;

  return db - da;
}

// ===============================
// FETCH CLIENTES
// ===============================

async function carregarListaClientes() {
  if (carregando || fimLista) return;

  carregando = true;
  document.body.classList.add("loading");

  try {
    const res = await fetch(
      `/api/chat/modelo?limit=${LIMIT}&offset=${offset}`,
      { headers: { Authorization: "Bearer " + token } }
    );

    if (!res.ok) return;

    const clientes = await res.json();

    if (clientes.length === 0) {
      fimLista = true;
      return;
    }

    preloadAvatars(clientes);
    upsertChats(clientes);

    listaCompleta.sort(compararChats);
    rerenderizarInboxCompleta();

    offset += clientes.length;
  } catch (err) {
    console.error("Erro carregar inbox:", err);
  } finally {
    carregando = false;
    document.body.classList.remove("loading");
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

  if (diff === 1) return t("inbox.day_singular");

  return t("inbox.day_plural").replace("{n}", diff);
}

// ===============================
// HELPERS
// ===============================

function abrirChat(clienteId) {
  const idx = listaCompleta.findIndex(c => c.cliente_id === clienteId);

  if (idx !== -1 && listaCompleta[idx].ultimo_sender === "cliente") {
    listaCompleta[idx] = normalizarChat({
      ...listaCompleta[idx],
      lida: true
    });

    listaCompleta.sort(compararChats);
    rerenderizarInboxCompleta();
  }

  window.location.href = `/chat.html?cliente_id=${clienteId}`;
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

  const idx = listaCompleta.findIndex(c => c.cliente_id === chatId);
  if (idx === -1) return;

  listaCompleta[idx] = normalizarChat({
    ...listaCompleta[idx],
    ...dados
  });

  listaCompleta.sort(compararChats);
  rerenderizarInboxCompleta();
}

function gerarStatus(c) {
  if (c.nao_lido) {
    return `<span class="status status-unseen">${t("inbox.chat_unread")}</span>`;
  }

  if (c.por_responder) {
    return `<span class="status status-reply">${t("inbox.chat_reply_needed")}</span>`;
  }

  if (c.cliente_visualizou) {
    return `<span class="status status-read">✓✓</span>`;
  }

  if (c.ultimo_sender === "modelo") {
    return `<span class="status status-sent">✓</span>`;
  }

  return "";
}

// ===============================
// PRELOAD INICIAL
// ===============================

function preloadAvatars(clientes) {
  clientes.slice(0, 10).forEach(c => {
    const avatar = c.avatar_thumb || c.avatar;
    if (!avatar || avatar === "assets/avatar.png") return;

    const img = new Image();
    img.src = avatar;
  });
}

function ehPrioritario(c) {
  return c.nao_lido || c.por_responder || c.cliente_visualizou;
}

async function carregarInboxInicial() {
  offset = 0;
  fimLista = false;
  listaCompleta = [];
  chatsMap.clear();

  let continuar = true;

  while (continuar && !fimLista) {
    const clientes = await buscarPaginaInbox();

    if (!clientes.length) {
      fimLista = true;
      break;
    }

    upsertChats(clientes);

    listaCompleta.sort(compararChats);
    rerenderizarInboxCompleta();

    offset += clientes.length;

    const paginaNormalizada = clientes.map(normalizarChat);
    const paginaTemPrioritario = paginaNormalizada.some(ehPrioritario);

    if (!paginaTemPrioritario) {
      continuar = false;
    }
  }
}

async function buscarPaginaInbox() {
  if (carregando || fimLista) return [];

  carregando = true;
  document.body.classList.add("loading");

  try {
    const res = await fetch(
      `/api/chat/modelo?limit=${LIMIT}&offset=${offset}`,
      { headers: { Authorization: "Bearer " + token } }
    );

    if (!res.ok) return [];

    const clientes = await res.json();

    if (clientes.length === 0) {
      fimLista = true;
      return [];
    }

    preloadAvatars(clientes);
    return clientes;
  } catch (err) {
    console.error("Erro carregar inbox:", err);
    return [];
  } finally {
    carregando = false;
    document.body.classList.remove("loading");
  }
}

function rerenderizarInboxCompleta() {
  inboxEl.innerHTML = "";
  chatsMap.clear();

  listaCompleta.forEach(c => {
    const statusHTML = gerarStatus(c);
    const avatarSrc = c.avatar_thumb || c.avatar || "assets/avatar.png";

    const div = document.createElement("div");
    div.className = "chat-item";
    div.onclick = () => abrirChat(c.cliente_id);

    div.innerHTML = `
      <div class="avatar">
        <img
          src="${avatarSrc}"
          width="40"
          height="40"
          onerror="this.onerror=null; this.src='assets/avatar.png';"
        >
      </div>
      <div class="chat-body">
        <div class="chat-top">
        <span class="chat-name">
        ${c.username || c.nome || t("inbox.chat_client")}
        ${c.resumo_curto ? `<span class="chat-resumo-curto">${c.resumo_curto}</span>` : ""}
  <span class="spend-level">${c.spend_level || ""}</span>
</span>

          <span class="chat-time">
            ${formatarTempo(c.ultima_mensagem_em)}
          </span>
        </div>

        <div class="chat-bottom">
          <span class="chat-last">
            ${c.ultima_mensagem || ""}
          </span>

          <div class="chat-status">
            ${statusHTML}
          </div>
        </div>
      </div>
    `;

    inboxEl.appendChild(div);

    chatsMap.set(c.cliente_id, {
      data: c,
      element: div
    });
  });
}

function tocarSomNotificacao() {
  try {
    // Usa AudioContext para funcionar mesmo sem interação prévia no iOS
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
// REFRESH PERIÓDICO
// ===============================

setInterval(async () => {
  if (document.visibilityState !== "visible") return;
  await recarregarInboxDoZero();
}, 30000);

