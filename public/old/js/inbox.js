// ===============================
// AUTH
// ===============================
const token = localStorage.getItem("token");
if (!token) location.href = "/index.html";

// ===============================
// SOCKET (INBOX)
// ===============================
const socket = io({
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

setInterval(() => {
  if (!socket.connected) {
    console.warn("⚠️ Socket desconectado. Forçando reconexão...");
    socket.connect();
  }
}, 10000);

setInterval(() => {
  if (socket.connected) {
    socket.emit("pingCheck");
  }
}, 20000);

setInterval(() => {
  carregarListaClientes();
}, 30000); 

function autenticar() {
  socket.emit("auth", { token });
}

function entrarInbox() {
  socket.emit("joinInbox");
}

socket.on("connect", () => {
  console.log("🟢 Inbox conectado:", socket.id);
  autenticar();
  setTimeout(() => {
    entrarInbox();
  }, 500);
});

if (socket.connected) {
  autenticar();
  entrarInbox();
}

// 🔐 Após autenticar
socket.on("authOk", () => {
  entrarInbox();
});

// 🔔 Tempo real
socket.on("inboxMessage", () => {
  carregarListaClientes();
});


const inboxEl = document.getElementById("inbox");
let modeloId = null;

// ===============================
// INIT
// ===============================
(async function init() {

  const role = localStorage.getItem("role");
  if (role !== "modelo") return logout();

  await carregarListaClientes();

})();

socket.on("disconnect", (reason) => {
  console.warn("🔴 Inbox desconectado:", reason);
});

// ===============================
// FETCH INBOX
// ===============================

function prioridadeChat(c) {
  // 1️⃣ NOVO (cliente enviou e não foi visto)
  if (c.ultimo_sender === "cliente" && c.visto === false) {
    return 1;
  }

  // 3️⃣ Por responder (cliente enviou, você viu)
  if (c.ultimo_sender === "cliente" && c.visto === true) {
    return 2;
  }

  // 4️⃣ Visto pelo cliente (última mensagem foi sua e ele leu)
  if (c.ultimo_sender === "modelo" && c.lida === true) {
    return 3;
  }

  // 5️⃣ Demais
  return 4;
}

async function carregarListaClientes() {
  const res = await fetch("/api/chat/modelo", {
    headers: { Authorization: "Bearer " + token }
  });
  if (!res.ok) return;

  const clientes = await res.json();
// 🔥 ORDENA ANTES DE RENDERIZAR
clientes.sort((a, b) => {
  const pa = prioridadeChat(a);
  const pb = prioridadeChat(b);

  if (pa !== pb) return pa - pb;

  // desempate: conversa mais recente primeiro
  return new Date(b.ultima_mensagem_em) - new Date(a.ultima_mensagem_em);
});

inboxEl.innerHTML = "";

clientes.forEach(c => {
  let statusHTML = "";

  // 🔴 última mensagem do CLIENTE
  if (c.ultimo_sender === "cliente") {
    if (c.visto === false) {
      statusHTML = `<span class="status status-unseen">Não lido</span>`;
    } else {
      statusHTML = `<span class="status status-reply">Por responder</span>`;
    }
  }

  // 🟢 última mensagem da MODELO
  if (c.ultimo_sender === "modelo") {
    if (c.lida === true) {
      statusHTML = `<span class="status status-read">✓✓</span>`;
    } else {
      statusHTML = `<span class="status status-sent">✓</span>`;
    }
  }

  const div = document.createElement("div");
  div.className = "chat-item";
  div.onclick = () => abrirChat(c.cliente_id);

  div.innerHTML = `
    <div class="avatar">
    <img 
  src="${c.avatar || 'assets/avatar.png'}"
  width="40"
  height="40"
  loading="lazy"
/>
    </div>

    <div class="chat-body">
      <div class="chat-top">
        <span class="chat-name">${c.username || c.nome || "Cliente"}</span>
        <span class="chat-time">${formatarTempo(c.ultima_mensagem_em)}</span>
      </div>

      <div class="chat-bottom">
        <span class="chat-last">${c.ultima_mensagem || ""}</span>
        <div class="chat-status">${statusHTML}</div>
      </div>
    </div>
  `;

  inboxEl.appendChild(div);
});

}

// ===============================
// TEMPO
function formatarTempo(data) {
  if (!data) return "";
  const d = new Date(data);
  const diff = Math.floor((Date.now() - d.getTime()) / 86400000);

  if (diff === 0) {
    return d.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  if (diff === 1) return "1 dia";
  return `${diff} dias`;
}

// ===============================
// HELPERS
function abrirChat(clienteId) {
  window.location.href = `/chat.html?cliente_id=${clienteId}`;
}

function logout() {
  localStorage.clear();
  location.href = "/index.html";
}


function prioridadeChat(c) {

  // 1️⃣ NOVO (cliente nunca recebeu resposta da modelo)
  if (!c.modelo_respondeu) {
    return 1;
  }

  // 2️⃣ NÃO LIDO (cliente enviou e você não viu)
  if (c.ultimo_sender === "cliente" && c.visto === false) {
    return 2;
  }

  // 3️⃣ NECESSITA RESPOSTA (cliente enviou, você viu mas não respondeu)
  if (c.ultimo_sender === "cliente" && c.visto === true) {
    return 3;
  }

  // 4️⃣ Demais
  return 4;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    console.log("👁 Página visível — atualizando inbox");
    carregarListaClientes();
  }
});
