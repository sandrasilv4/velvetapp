const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

if (!token) {
  window.location.href = "/index.html";
  throw new Error("Sem token");
}

const socket = io({
  transports: ["websocket"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

let autenticado = false;

setInterval(() => {
  if (!socket.connected) {
    console.warn("⚠️ Forçando reconexão inbox cliente...");
    socket.connect();
  }
}, 10000);

setInterval(() => {
  if (socket.connected) {
    socket.emit("pingCheck");
  }
}, 20000);

function autenticar() {
  socket.emit("auth", { token });
}

function entrarInbox() {
  socket.emit("joinInbox");
}


socket.on("connect", () => {
  console.log("🟢 Inbox cliente conectado:", socket.id);
  autenticar();
});

// 🔐 Após autenticar, entra na sala
socket.on("authOk", () => {
  if (autenticado) return; // 🛡️ evita duplicação
  autenticado = true;

  console.log("🔐 Inbox autenticado");
  entrarInbox();
});

// 🔔 Atualização em tempo real
socket.on("inboxMessage", () => {
  carregarListaModelos();
});

// 🔴 Debug opcional
socket.on("disconnect", (reason) => {
  console.warn("🔴 Inbox cliente desconectado:", reason);
});

setInterval(() => {
  carregarListaModelos();
}, 30000);

const inboxEl = document.getElementById("inbox");

// ===============================
// FETCH INBOX
// ===============================
async function carregarListaModelos() {
  const res = await fetch("/api/chat/cliente", {
    headers: { Authorization: "Bearer " + token }
  });
  if (!res.ok) return;

  const modelos = await res.json();

  modelos.sort((a, b) => {
    const pa = prioridadeChat(a);
    const pb = prioridadeChat(b);
    if (pa !== pb) return pa - pb;

    const da = a.ultima_mensagem_em ? new Date(a.ultima_mensagem_em) : 0;
    const db = b.ultima_mensagem_em ? new Date(b.ultima_mensagem_em) : 0;

    return db - da;
  });

  inboxEl.innerHTML = "";

  modelos.forEach(c => {
    let statusHTML = "";

    if (c.sender === "modelo" && c.lida === false) {
      statusHTML = `<span class="status status-unseen">Não lido</span>`;
    } else if (c.sender === "cliente") {
      statusHTML = `<span class="status status-read">✓✓</span>`;
    }

    const div = document.createElement("div");
    div.className = "chat-item";
    div.onclick = () => abrirChat(c.modelo_id);

    div.innerHTML = `
      <div class="avatar">
        ${
          c.avatar
  ? `<img 
       src="${c.avatar}" 
       width="40" 
       height="40" 
       loading="lazy" 
       alt="Avatar"
     />`
  : `<div class="avatar-placeholder"></div>`
        }
      </div>

      <div class="chat-body">
        <div class="chat-top">
          <span class="chat-name">
            ${c.nome_exibicao || "Modelo"}
          </span>

          <span class="chat-time">
            ${c.ultima_mensagem_em ? formatarTempo(c.ultima_mensagem_em) : ""}
          </span>
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

function prioridadeChat(c) {
  // 1️⃣ novo não lido
  if (c.sender === "modelo" && c.lida === false) {
    return 1;
  }

  // 2️⃣ modelo falou e você já leu
  if (c.sender === "modelo" && c.lida === true) {
    return 2;
  }

  // 3️⃣ você falou por último
  if (c.sender === "cliente") {
    return 3;
  }

  return 4;
}



// ===============================
// TEMPO
// ===============================
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
let clienteId = null;

async function initClienteInbox() {
  const res = await fetch("/api/cliente/me", {
    headers: { Authorization: "Bearer " + token }
  });

  if (!res.ok) return logout();

  const me = await res.json();
  clienteId = me.id;

  function entrarInbox() {
    socket.emit("joinInbox", {
      sala: `inbox_cliente_${clienteId}`
    });
  }

  // registra listeners ANTES
  socket.on("connect", entrarInbox);

  // se já estiver conectado, entra agora
  if (socket.connected) {
    entrarInbox();
  }

  // primeira carga
  carregarListaModelos();
}

document.addEventListener("DOMContentLoaded", initClienteInbox);



// ===============================
// HELPERS
// ===============================
function abrirChat(modeloId) {
  window.location.href = `/chatc.html?modelo_id=${modeloId}`;
}

function logout() {
  localStorage.clear();
  location.href = "/index.html";
}

window.addEventListener("pageshow", function (event) {
  if (event.persisted) {
    window.location.reload();
  }
});
