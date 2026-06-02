// ===============================
// IDS (por enquanto fixos)
// depois podemos pegar da URL
// ===============================
const MODELO_ID = 1;
const CLIENTE_ID = 1;

const chatBox = document.getElementById("chatBox");
const input = document.getElementById("mensagem");

// ===============================
// ⌨️ ENTER PARA ENVIAR
// ===============================
input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    enviarMensagemCliente();
  }
});

// ===============================
// 🔌 SOCKET (AUTENTICADO)
// ===============================
const socket = io({
  auth: {
    token: localStorage.getItem("token")
  }
});

// (opcional por enquanto)
socket.emit("join", {
  modelo_id: MODELO_ID,
  cliente_id: CLIENTE_ID
});

// ===============================
// 📥 RECEBER MENSAGENS REALTIME
// ===============================
socket.on("message", msg => {
  renderMessage(msg);
});

// ===============================
// 📜 HISTÓRICO
// ===============================
async function carregarChat() {
  const res = await fetch(`/api/chat/${CLIENTE_ID}`, {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token")
    }
  });

  const mensagens = await res.json();
  chatBox.innerHTML = "";
  mensagens.forEach(renderMessage);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ===============================
// ✉️ ENVIAR COMO CLIENTE
// ===============================
async function enviarMensagemCliente() {
  const text = input.value.trim();
  if (!text) return;

  await fetch("https://velvet-test-production.up.railway.app/api/chat/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + localStorage.getItem("token")
    },
    body: JSON.stringify({
      cliente_id: CLIENTE_ID,
      modelo_id: MODELO_ID,
      text,
      sender: "cliente"
    })
  });

  input.value = "";
}

// ===============================
// 🖼️ RENDER
// ===============================
function renderMessage(m) {
  const div = document.createElement("div");
  div.className = `msg ${
    m.sender === "cliente" ? "msg-cliente" : "msg-modelo"
  }`;

  div.textContent = m.text;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

// ===============================
// START
// ===============================
carregarChat();
