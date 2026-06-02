const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

if (!token) {
  window.location.href = "/index.html";
  throw new Error("Sem token");
}
const socket = io({
  transports: ["websocket"]
});

let modelo_id = null;
let cliente_id = null;
let chatAtivo = null;
let conteudosVistosCliente = new Set();

// 🔐 SOCKET AUTH
socket.on("connect", () => {
  socket.emit("auth", {
    token: localStorage.getItem("token")
  });
});

// 📜 HISTÓRICO
socket.on("chatHistory", mensagens => {
  const chat = document.getElementById("chatBox");
  chat.innerHTML = "";

  mensagens.forEach(m => renderMensagem(m));

  atualizarStatusPorResponder(mensagens);
});


// 💬 NOVA MENSAGEM
socket.on("newMessage", msg => {
  // 🔥 se ainda não escolheu cliente, ignora só mensagens que NÃO são da modelo
  if (cliente_id && Number(msg.cliente_id) !== Number(cliente_id)) return;

  // 🔒 se tem cliente ativo, filtra normalmente
  if (cliente_id && Number(msg.cliente_id) !== Number(cliente_id)) return;

  renderMensagem(msg);
  atualizarStatusPorResponder([msg]);
});


socket.on("conteudoVisto", ({ message_id }) => {
  const el = document.querySelector(
    `.chat-conteudo[data-id="${message_id}"]`
  );
  if (!el) return;

  // remove qualquer estado anterior
  el.classList.remove("nao-visto");
  el.classList.remove("bloqueado");

  // aplica visto
  el.classList.add("visto");
});



socket.on("unreadUpdate", ({ cliente_id, modelo_id }) => {
  document.querySelectorAll("#listaClientes li").forEach(li => {
    if (Number(li.dataset.clienteId) === cliente_id) {
      li.dataset.status = "nao-visto";
      const badge = li.querySelector(".badge");
      badge.innerText = "Não visto";
      badge.classList.remove("hidden");
      
      organizarListaClientes();
    }
    contarChatsNaoLidosModelo();
  });
});

socket.on("novoAssinante", ({ cliente_id, nome }) => {
adicionarNovoClienteNaLista(cliente_id, nome);
});
// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  await carregarModelo();   
  await carregarListaClientes();
  await aplicarUnreadModelo();

    const ultimoCliente = localStorage.getItem("chat_cliente_ativo");

  if (ultimoCliente) {
    const li = [...document.querySelectorAll("#listaClientes li")]
      .find(el => Number(el.dataset.clienteId) === Number(ultimoCliente));

    if (li) li.click();
  }


  const sendBtn = document.getElementById("sendBtn");
  const input   = document.getElementById("messageInput");
  const btnConteudo = document.getElementById("btnEnviarConteudo");

  sendBtn.onclick = enviarMensagem;

  input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();   // 🔥 ISSO resolve a quebra de linha
    enviarMensagem();
  }
 });

  // 🔥 AQUI — sempre ativo
  btnConteudo.onclick = abrirPopupConteudos;

  socket.on("mensagemEditada", ({ id, text }) => {
  const msgEl = document
    .querySelector(`.msg-menu[data-id="${id}"]`)
    ?.closest(".msg");

  if (!msgEl) return;

  const textoDiv = msgEl.querySelector(".msg-texto");
  if (textoDiv) textoDiv.innerText = text;
});

socket.on("mensagemExcluida", ({ id }) => {
  const msgEl = document
    .querySelector(`.msg-menu[data-id="${id}"]`)
    ?.closest(".msg");

  if (msgEl) msgEl.remove();
});

});

// ===============================
// FUNÇÕES
// ===============================

function formatarTempo(timestamp) {
  if (!timestamp || timestamp === "0") return "";

  const diff = Date.now() - Number(timestamp);
  const min = Math.floor(diff / 60000);
  const h   = Math.floor(diff / 3600000);
  const d   = Math.floor(diff / 86400000);

  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  if (h < 24) return `${h} h`;
  if (d === 1) return "ontem";
  return `${d} dias`;
}

function organizarListaClientes() {
  const lista = document.getElementById("listaClientes");
  const itens = [...lista.querySelectorAll(".chat-item")];

  const prioridadeStatus = {
    "novo": 0,          // 🔥 absoluto
    "nao-visto": 1,
    "por-responder": 2,
    "normal": 3
  };

  itens.sort((a, b) => {
    const sa = a.dataset.status || "normal";
    const sb = b.dataset.status || "normal";

    const pa = prioridadeStatus[sa];
    const pb = prioridadeStatus[sb];

    // 1️⃣ prioridade por status
    if (pa !== pb) return pa - pb;

    // 2️⃣ se ambos forem "novo", NÃO mexe
    if (sa === "novo" && sb === "novo") return 0;

    // 3️⃣ ordenar por tempo
    const ta = Number(a.dataset.lastTime || 0);
    const tb = Number(b.dataset.lastTime || 0);
    return tb - ta;
  });

  itens.forEach(li => lista.appendChild(li));
}

async function carregarListaClientes() {
  const res = await fetch("/api/chat/modelo", {
    headers: { Authorization: "Bearer " + token }
  });

  const clientes = await res.json();
  const lista = document.getElementById("listaClientes");

  lista.innerHTML = "";

  if (!clientes.length) {
    lista.innerHTML = "<li>Nenhum cliente VIP ainda.</li>";
    return;
  }

  clientes.forEach(c => {
    const li = document.createElement("li");
    li.className = "chat-item";
    li.dataset.clienteId = c.cliente_id;

    // ⏱ timestamp da última mensagem da MODELO
    li.dataset.lastTime = c.ultima_msg_modelo_ts
      ? new Date(c.ultima_msg_modelo_ts).getTime()
      : 0;
    li.dataset.status = c.status || "normal";

    const nomeExibido = c.username || c.nome;
li.innerHTML = `
  <div class="linha-topo">
    <span class="nome">${nomeExibido}</span>
    <span class="tempo"></span>
  </div>
  <span class="badge hidden"></span>
`;
    // 🔔 aplica badge + tempo
    atualizarBadgeComTempo(li);
    contarChatsNaoLidosModelo();

    // ===============================
    // 🖱️ CLICK NO CLIENTE
    // ===============================
    li.onclick = async () => {
      const avatarEl = document.getElementById("chatAvatar");
      avatarEl.src = "/assets/avatarDefault.png";
      cliente_id = c.cliente_id;
      localStorage.setItem("chat_cliente_ativo", cliente_id);
      chatAtivo = { cliente_id, modelo_id };
      await carregarConteudosVistos(cliente_id);
      

      document.getElementById("clienteNome").innerText =
  c.username || c.nome;


      // 🔥 buscar dados do cliente (avatar, etc.)
      const res = await fetch(`/api/cliente/${cliente_id}`, {
        headers: {
          Authorization: "Bearer " + localStorage.getItem("token")
        }
      });
      if (res.ok) {
  const dados = await res.json();
  avatarEl.src = dados.avatar || "/assets/avatarDefault.png";

  avatarEl.onclick = () => {
    if (!dados.avatar) return;
    abrirPreviewAvatar(dados.avatar);
  };
}

      // 🧹 limpar badge visual
      const badge = li.querySelector(".badge");
      if (badge) badge.classList.add("hidden");

      // 🔄 atualizar status local
      li.dataset.status = "normal";

      // 🔁 reordenar lista
      organizarListaClientes();

      // 📡 entrar no chat
      const sala = `chat_${cliente_id}_${modelo_id}`;
      socket.emit("joinChat", { sala });
      socket.emit("getHistory", { cliente_id, modelo_id });
      setTimeout(contarChatsNaoLidosModelo, 50);
    };

    lista.appendChild(li);
  });

  // 🔁 ordena após carregar tudo
  organizarListaClientes();
}

function atualizarBadgeComTempo(li) {
  const badge = li.querySelector(".badge");
  const tempo = li.querySelector(".tempo");

  const status = li.dataset.status;
  const lastTime = Number(li.dataset.lastTime || 0);

  // 🔔 BADGE
  if (badge) {
    if (status === "novo") {
      badge.innerText = "Novo";
      badge.classList.remove("hidden");
    }
    else if (status === "nao-visto") {
      badge.innerText = "Não visto";
      badge.classList.remove("hidden");
    }
    else if (status === "por-responder") {
      badge.innerText = "Por responder";
      badge.classList.remove("hidden");
    }
    else {
      badge.classList.add("hidden");
    }
  }

  // ⏱ TEMPO
  if (tempo) {
    tempo.innerText = lastTime > 0 ? formatarTempo(lastTime) : "";
  }
}


async function carregarModelo() {
  const res = await fetch("/api/modelo/me", {
    headers: { Authorization: "Bearer " + token }
  });

  const data = await res.json();
  modelo_id = Number(data.user_id ?? data.id);
  const nomeEl = document.getElementById("modeloNome");
  if (nomeEl) {
    nomeEl.innerText = data.nome || "Modelo";
  }
  socket.emit("loginModelo", modelo_id);
}

async function aplicarUnreadModelo() {
  const res = await fetch("/api/chat/unread/modelo", {
    headers: { Authorization: "Bearer " + token }
  });

  const unreadIds = await res.json();

  document.querySelectorAll("#listaClientes li").forEach(li => {
    if (unreadIds.includes(Number(li.dataset.clienteId))) {
    li.dataset.status = "nao-visto";
    const badge = li.querySelector(".badge");
    badge.innerText = "Não visto";
    badge.classList.remove("hidden");
    }
  });
  organizarListaClientes();
}

function enviarMensagem() {
  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text) return;

  if (!cliente_id || !modelo_id) {
  alert("Erro de sessão. Recarregue a página.");
  return;
}
  socket.emit("sendMessage", {
    cliente_id,
    modelo_id,
    text
  });

  const item = [...document.querySelectorAll("#listaClientes li")]
  .find(li => Number(li.dataset.clienteId) === cliente_id);

if (item) {
  const badge = item.querySelector(".badge");
  badge.classList.add("hidden");
}

if (item) {
  item.dataset.lastTime = Date.now();
  item.dataset.status = "normal";
  atualizarBadgeComTempo(item);
  organizarListaClientes();
}

  input.value = "";
}

function renderMensagem(msg) {
  const chat = document.getElementById("chatBox");
  if (!chat) return;

  const div = document.createElement("div");

  // alinhamento correto
  div.className =
    msg.sender === "modelo" ? "msg msg-modelo" : "msg msg-cliente";

    if (
  msg.tipo === "conteudo" &&
  Array.isArray(msg.midias) &&
  msg.midias.length > 0
 ) {

    div.innerHTML = `
<div class="chat-conteudo premium ${msg.visto ? "visto" : "bloqueado"}"
     data-id="${msg.id}"
     data-qtd="${msg.quantidade ?? msg.midias.length}">

    <!-- 📸 MÍDIA -->
    <div class="pacote-grid">
      ${msg.midias.map(m => `
        <div class="midia-item">
          ${
            (m.tipo_media || m.tipo) === "video"
  ? `<video src="${m.url}" muted></video>`
  : `<img src="${m.url}" />`
          }
        </div>
      `).join("")}
    </div>

    <!-- 🧾 INFO ABAIXO -->
    ${
      msg.preco > 0
        ? `
          <div class="conteudo-info">
            <span class="status-bloqueado">
              ${
                msg.visto
                  ? `🟢 Vendido · ${msg.quantidade ?? msg.midias.length} mídia(s)`
                  : `🔒 ${msg.quantidade ?? msg.midias.length} mídia(s)`
              }
            </span>
            <span class="preco-bloqueado">
              R$ ${Number(msg.preco).toFixed(2)}
            </span>
          </div>
        `
        : ""
    }

  </div>
`;
  }

  /* ===============================
     💬 TEXTO NORMAL
  =============================== */
 else {
  div.innerHTML = `
    <div class="msg-texto">${msg.text || ""}</div>

    ${msg.sender === "modelo" ? `
      <button
        class="msg-menu"
        data-id="${msg.id}"
        data-text="${encodeURIComponent(msg.text || "")}">
        ⋮
      </button>
    ` : ""}

    <span class="msg-hora">${formatarTempo(new Date(msg.created_at).getTime())}</span>
  `;
 }

  chat.appendChild(div);
  chat.scrollTop = chat.scrollHeight;
  const btn = div.querySelector(".msg-menu");
 if (btn) {
  btn.addEventListener("click", () => {
    abrirMenuMensagem(
      btn.dataset.id,
      decodeURIComponent(btn.dataset.text)
    );
  });
}

}

function atualizarStatusPorResponder(mensagens) {
  if (!mensagens || mensagens.length === 0) return;

  const ultima = mensagens[mensagens.length - 1];
  const minhaRole = localStorage.getItem("role"); // cliente | modelo

  const item = [...document.querySelectorAll(".chat-item")].find(li =>
    minhaRole === "cliente"
      ? Number(li.dataset.modeloId) === ultima.modelo_id
      : Number(li.dataset.clienteId) === ultima.cliente_id
  );

  if (!item) return;

  const badge = item.querySelector(".badge");
  let mudou = false;

  // 🚫 nunca sobrepor "novo" ou "nao-visto"
  if (item.dataset.status === "novo" || item.dataset.status === "nao-visto") {
    return;
  }

  // 📩 última mensagem NÃO foi minha → por responder
  if (ultima.sender !== minhaRole) {
    if (item.dataset.status !== "por-responder") {
      item.dataset.status = "por-responder";
      badge.innerText = "Por responder";
      badge.classList.remove("hidden");
      mudou = true;
    }
  }
  // ✅ última mensagem foi minha → volta ao normal
  else {
    if (item.dataset.status !== "normal") {
      item.dataset.status = "normal";
      badge.classList.add("hidden");
      mudou = true;
    }
  }

  // 🔁 reorganiza só se algo mudou
  if (mudou) {
    organizarListaClientes();
  }
}

function adicionarNovoClienteNaLista(cliente_id, nome) {
  const lista = document.getElementById("listaClientes");

  const existente = [...lista.querySelectorAll("li")]
    .find(li => Number(li.dataset.clienteId) === cliente_id);

  if (existente) return;

  const li = document.createElement("li");
  li.className = "chat-item";
  li.dataset.clienteId = cliente_id;
  li.dataset.status = "novo";
  li.dataset.lastTime = Date.now();
  const nomeExibido = nome;
li.innerHTML = `
  <div class="linha-topo">
    <span class="nome">${nomeExibido}</span>
    <span class="tempo">agora</span>
  </div>
  <span class="badge">Novo</span>
`;

  li.onclick = () => {
    cliente_id = Number(li.dataset.clienteId);
    chatAtivo = { cliente_id, modelo_id };

    document.getElementById("clienteNome").innerText = nome;

    // 🧹 limpar badge e status
    li.dataset.status = "normal";
    const badge = li.querySelector(".badge");
    badge.classList.add("hidden");

    organizarListaClientes();

    const sala = `chat_${cliente_id}_${modelo_id}`;
    socket.emit("joinChat", { sala });
    socket.emit("getHistory", { cliente_id, modelo_id });
  };

  // ➕ adiciona apenas UMA vez
  lista.prepend(li);

  // 🔁 organiza depois de tudo pronto
  organizarListaClientes();
}

async function abrirPopupConteudos() {
  document.getElementById("popupConteudos").classList.remove("hidden");

  const grid = document.getElementById("previewConteudos");
  grid.innerHTML = "Carregando...";

  const res = await fetch("/api/conteudos/me", {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token")
    }
  });

  if (!res.ok) {
    grid.innerHTML = "Erro ao carregar conteúdos";
    return;
  }

  const conteudos = await res.json();

  if (!Array.isArray(conteudos) || conteudos.length === 0) {
    grid.innerHTML = "<p>Nenhum conteúdo enviado ainda.</p>";
    return;
  }

  grid.innerHTML = "";

  conteudos.forEach(c => {
    const jaVisto = conteudosVistosCliente.has(c.id);

    const item = document.createElement("div");
    item.className =
      "preview-item" +
      (jaVisto ? " visto desabilitado" : "");
    item.dataset.conteudoId = c.id;

    item.innerHTML = `
      ${c.tipo === "video"
        ? `<video src="${c.url}" muted></video>`
        : `<img src="${c.url}" />`
      }
      ${jaVisto ? `<span class="badge-visto">Visto</span>` : ""}
    `;

    // 🚫 REGRA FINAL:
    // conteúdo visto (pago OU grátis) NUNCA pode ser reenviado
    if (jaVisto) {
      item.onclick = () => {
        alert("Este conteúdo já foi visto por este cliente e não pode ser reenviado.");
      };
    } else {
      item.onclick = () => {
        item.classList.toggle("selected");
      };
    }

    grid.appendChild(item);
  });
}

function confirmarEnvioConteudo() {
  if (!cliente_id || !modelo_id) {
    alert("Selecione um cliente primeiro.");
    return;
  }

  const selecionados = [
    ...document.querySelectorAll(".preview-item.selected")
  ];

  if (!selecionados.length) {
    alert("Selecione ao menos um conteúdo.");
    return;
  }

  const preco = Number(
    document.getElementById("precoConteudo").value || 0
  );

  const conteudos_ids = selecionados
    .map(item => Number(item.dataset.conteudoId))
    .filter(id => Number.isInteger(id) && id > 0);

  // 🔥 GARANTE JOIN NA SALA ATIVA
  const sala = `chat_${cliente_id}_${modelo_id}`;
  socket.emit("joinChat", { sala });

  // 🔥 ENVIA UMA ÚNICA VEZ (após garantir o join)
  setTimeout(() => {
    socket.emit("sendConteudo", {
      cliente_id,
      modelo_id,
      conteudos_ids,
      preco
    });
  }, 50);

  fecharPopupConteudos();
}

function abrirPreviewConteudo(url, tipo) {
  const popup = document.getElementById("popupConteudos");

  // usa o MESMO sistema do resto da UI
  if (popup) popup.classList.add("hidden");

  let modal = document.getElementById("previewModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "previewModal";
    modal.className = "preview-modal";

    modal.innerHTML = `
      <div class="preview-backdrop"></div>
      <div class="preview-box">
        <span class="preview-close">×</span>
        <img id="previewImg" />
        <video id="previewVideo" controls></video>
      </div>
    `;

    document.body.appendChild(modal);

    const fechar = () => {
      modal.classList.remove("open");

      const video = modal.querySelector("#previewVideo");
      video.pause();
      video.src = "";

      if (popup) {
        popup.classList.remove("hidden");

        // 🔥 devolve foco ao popup
        const inputPreco = document.getElementById("precoConteudo");
        if (inputPreco) inputPreco.focus();
      }
    };

    // ✅ EVENTOS REGISTRADOS CORRETAMENTE
    modal.querySelector(".preview-backdrop").onclick = fechar;
    modal.querySelector(".preview-close").onclick = fechar;
  }

  const img = modal.querySelector("#previewImg");
  const video = modal.querySelector("#previewVideo");

  if (tipo === "video") {
    img.style.display = "none";

    video.style.display = "block";
    video.src = url;
    video.currentTime = 0;
    video.play();
  } else {
    video.pause();
    video.src = "";
    video.style.display = "none";

    img.style.display = "block";
    img.src = url;
  }

  modal.classList.add("open");
}

function contarChatsNaoLidosModelo() {
  const itens = document.querySelectorAll(
    "#listaClientes li[data-status='nao-visto'], #listaClientes li[data-status='novo']"
  );

  atualizarBadgeHeader(itens.length);
}

async function carregarConteudosVistos(cliente_id) {
  const res = await fetch(`/api/chat/conteudos-vistos/${cliente_id}`, {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token")
    }
  });

  const ids = await res.json();
  conteudosVistosCliente = new Set(ids);
}

function abrirPreviewAvatar(url) {
  let modal = document.getElementById("avatarPreviewModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "avatarPreviewModal";
    modal.className = "preview-modal open";

    modal.innerHTML = `
      <div class="preview-backdrop"></div>
      <div class="preview-box">
        <span class="preview-close">×</span>
        <img id="avatarPreviewImg" />
      </div>
    `;

    document.body.appendChild(modal);

    const fechar = () => modal.remove();
    modal.querySelector(".preview-backdrop").onclick = fechar;
    modal.querySelector(".preview-close").onclick = fechar;
  }

  const img = modal.querySelector("#avatarPreviewImg");
  img.src = url;

  modal.classList.add("open");
}

// ===============================
// ❌ FECHAR POPUP DE CONTEÚDOS
// ===============================
function fecharPopupConteudos() {
  const popup = document.getElementById("popupConteudos");
  if (!popup) return;

  popup.classList.add("hidden");

  // limpa seleção
  document
    .querySelectorAll(".preview-item.selected")
    .forEach(el => el.classList.remove("selected"));

  // reseta preço
  const precoInput = document.getElementById("precoConteudo");
  if (precoInput) precoInput.value = 0;
}


async function carregarConteudosVistos(cliente_id) {
  const res = await fetch(`/api/chat/conteudos-vistos/${cliente_id}`, {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token")
    }
  });

  const ids = await res.json();
  conteudosVistosCliente = new Set(ids);
}

function abrirPreviewAvatar(url) {
  let modal = document.getElementById("avatarPreviewModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "avatarPreviewModal";
    modal.className = "preview-modal open";

    modal.innerHTML = `
      <div class="preview-backdrop"></div>
      <div class="preview-box">
        <span class="preview-close">×</span>
        <img id="avatarPreviewImg" />
      </div>
    `;

    document.body.appendChild(modal);

    const fechar = () => modal.remove();
    modal.querySelector(".preview-backdrop").onclick = fechar;
    modal.querySelector(".preview-close").onclick = fechar;
  }

  const img = modal.querySelector("#avatarPreviewImg");
  img.src = url;

  modal.classList.add("open");
}

let mensagemEditandoId = null;
let elementoMensagemEditando = null;

function abrirMenuMensagem(id, texto) {
  mensagemEditandoId = id;

  elementoMensagemEditando = document
    .querySelector(`.msg-menu[data-id="${id}"]`)
    ?.closest(".msg");

  document.getElementById("editarTexto").value = texto || "";
  document.getElementById("menuMensagem").classList.remove("hidden");
}

function fecharMenuMensagem() {
  mensagemEditandoId = null;
  elementoMensagemEditando = null;
  document.getElementById("menuMensagem").classList.add("hidden");
}

function salvarEdicao() {
  const novoTexto = document.getElementById("editarTexto").value.trim();
  if (!novoTexto) return alert("Mensagem vazia.");

  // atualiza na tela
  if (elementoMensagemEditando) {
    const textoDiv = elementoMensagemEditando.querySelector(".msg-texto");
    if (textoDiv) textoDiv.innerText = novoTexto;
  }

  // backend
  socket.emit("editarMensagem", {
    id: mensagemEditandoId,
    text: novoTexto
  });

  fecharMenuMensagem();
}

function excluirMensagem() {
  if (!confirm("Excluir mensagem?")) return;

  if (elementoMensagemEditando) {
    elementoMensagemEditando.remove();
  }

  socket.emit("excluirMensagem", {
    id: mensagemEditandoId
  });

  fecharMenuMensagem();
}



