// ===============================
// 🔐 AUTENTICAÇÃO
// ===============================

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
let salaPronta = false;
let modelo_id = null;
let cliente_id = null;

setInterval(() => {
  if (!socket.connected) {
    console.warn("⚠️ Forçando reconexão...");
    socket.connect();
  }
}, 10000);


function autenticar() {
  socket.emit("auth", { token });
}

function fazerLogin() {
  if (role === "cliente") {
    socket.emit("loginCliente");
  }
  if (role === "modelo") {
    socket.emit("loginModelo");
  }
}

function entrarSala() {
  if (cliente_id && modelo_id) {
    socket.emit("joinChat", { cliente_id, modelo_id });
    socket.emit("getHistory", { cliente_id, modelo_id });
  }
}

socket.on("connect", () => {
  console.log("🟢 Conectado:", socket.id);
  autenticado = false;
  salaPronta = false; 
  autenticar();
});

// 🔐 Após autenticar
socket.on("authOk", () => {
  if (autenticado) return;
  autenticado = true;

if (role === "modelo") socket.emit("loginModelo");
if (role === "cliente") socket.emit("loginCliente");

  setTimeout(tentarEntrarSala, 200);
});

function tentarEntrarSala() {
  if (!autenticado) return;
  if (!modelo_id || !cliente_id) return;
  if (salaPronta) return;

  salaPronta = true;

  socket.emit("joinChat", { cliente_id, modelo_id });
  socket.emit("getHistory", { cliente_id, modelo_id });

  console.log("🟪 Sala conectada");
}

// ===============================
// 📌 VARIÁVEIS GLOBAIS DO CHAT
// ===============================
let chatAtivo = null;
window.conteudosVistosCliente = new Set();
let carregandoHistorico = false;
let historicoInicialCarregado = false;
let socketAutenticado = false;

// ===============================
// 📎 PARAMETROS URL
// ===============================

const params = new URLSearchParams(location.search);

if (role === "modelo") {
  cliente_id = Number(params.get("cliente_id"));

  if (!Number.isInteger(cliente_id) || cliente_id <= 0) {
    console.warn("cliente_id inválido na URL");
    cliente_id = null;
  }
}

// ===============================
// 📦 ELEMENTOS DOM
// ===============================

const chatBox = document.getElementById("chatBox");
const input = document.getElementById("msgInput");

// ===============================
// ⬆️ SCROLL PARA CARREGAR MAIS
// ===============================

if (chatBox) {
  chatBox.addEventListener("scroll", () => {
    if (
  historicoInicialCarregado &&
  chatBox.scrollTop === 0 &&
  !carregandoHistorico
) {
 carregarMensagensAntigas();
    }
  });
}

socket.on("chatHistory", mensagens => {
  const chat = document.getElementById("chatBox");
  if (!chat || !Array.isArray(mensagens)) return;

  chat.innerHTML = "";

  mensagens.forEach(m => renderMensagem(m));

  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
});

// 💬 NOVA MENSAGEM
socket.on("newMessage", msg => {
  renderMensagem(msg);
  scrollParaFinal();
});

// ✏️ Edição
socket.on("mensagemEditada", ({ id, text }) => {
  const msgEl = document
    .querySelector(`.msg-menu[data-id="${id}"]`)
    ?.closest(".msg");

  if (!msgEl) return;

  const textoDiv = msgEl.querySelector(".msg-texto");
  if (textoDiv) textoDiv.innerText = text;
});

// 🗑️ Exclusão
socket.on("mensagemExcluida", ({ id }) => {
  const msgEl = document
    .querySelector(`.msg-menu[data-id="${id}"]`)
    ?.closest(".msg");

  if (msgEl) msgEl.remove();
});

// 🔓 Conteúdo visto
socket.on("conteudoVisto", ({ message_id }) => {
  if (!message_id) return;

  const el = document.querySelector(
    `.chat-conteudo[data-id="${message_id}"]`
  );

  if (!el) return;

  el.classList.remove("bloqueado");
  el.classList.add("visto");

  const status = el.querySelector(".status-bloqueado");
  if (status) status.innerText = "🟢 Vendido";
});

socket.on("disconnect", (reason) => {
  console.warn("🔴 Socket desconectado:", reason);
});

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  const res = await fetch("/api/modelo/me", {
    headers: { Authorization: "Bearer " + token }
  });

  if (!res.ok) {
  console.error("Erro ao buscar modelo");
  return;
}

  const modelo = await res.json();

 modelo_id = modelo.modelo_id;
if (!modelo_id) {
  console.error("modelo_id indefinido");
  return;
}

  await carregarInfoCliente(cliente_id);
  tentarEntrarSala();

  sala = `chat_${cliente_id}_${modelo_id}`;
  marcarComoLido(cliente_id);

  const input = document.getElementById("msgInput");
  input.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      enviarMensagem();
    }
  });

});

// ===============================
// FUNÇÕES
// ===============================

function scrollParaFinal() {
  const chat = document.getElementById("chatBox");
  if (!chat) return;

  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
}

function formatarTempo(timestamp) {
  if (!timestamp || timestamp === "0") return "agora";

  // aceita número OU string ISO
  const time =
    typeof timestamp === "number"
      ? timestamp
      : new Date(timestamp).getTime();

  if (isNaN(time)) return "agora";

  const diff = Date.now() - time;

  const min = Math.floor(diff / 60000);
  const h   = Math.floor(diff / 3600000);
  const d   = Math.floor(diff / 86400000);

  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (h < 24) return `há ${h} h`;
  if (d === 1) return "ontem";
  return `há ${d} dias`;
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

function enviarMensagem() {
 const text = input.value.trim();
  if (!text) return;

  const msgLocal = {
    id: "temp-" + Date.now(),
    sender: "modelo",
    text,
    created_at: Date.now()
  };

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

function abrirPreviewMidiaDireto(message, index) {
  try {
    if (!message) return;

    // 🔒 Só funciona para mensagens de conteúdo
    if (message.tipo !== "conteudo") return;

    // 🔒 Verifica se existe array de mídias
    if (!Array.isArray(message.midias)) return;

    const midia = message.midias[index];
    if (!midia) return;

    // 🔒 Se estiver bloqueado (conteúdo pago não comprado)
    if (message.bloqueado) {
      if (typeof abrirFluxoPagamentoConteudo === "function") {
        abrirFluxoPagamentoConteudo(message);
      }
      return;
    }

    // ✅ Abrir preview normalmente
    abrirPreviewMidia(midia);

  } catch (err) {
    console.error("Erro ao abrir preview:", err);
  }
}


function renderMensagem(msg) {
  const chat = document.getElementById("chatBox");
  if (!chat) return;

  const div = document.createElement("div");

  div.className =
    msg.sender === "modelo" ? "msg msg-modelo" : "msg msg-cliente";

  // ===============================
  // 📦 MENSAGEM DE CONTEÚDO
  // ===============================
  if (msg.tipo === "conteudo") {

    const quantidade = msg.quantidade ?? (msg.midias?.length || 0);
    const bloqueado = Number(msg.preco) > 0 && !msg.visto;

div.innerHTML = `
  <div class="chat-conteudo premium ${bloqueado ? "bloqueado" : "visto"}"
       data-id="${msg.id}"
       data-qtd="${quantidade}">

    ${msg.sender === "modelo" && !msg.visto ? `
      <button
        class="btn-excluir-pacote"
        data-id="${msg.id}">
        ⋮
      </button>
    ` : ""}

    <div class="pacote-grid">
      ${(msg.midias || []).map((m, index) => `
        <div class="midia-item lazy-midia"
             data-thumb="${m.thumbnail_url || m.url}"
             data-full="${m.url}"
             data-index="${index}">
             <div class="midia-placeholder"></div>
        </div>
      `).join("")}
    </div>

    ${
      msg.preco > 0
        ? `
        <div class="conteudo-info">
          <span class="status-bloqueado">
            ${
              msg.visto
                ? `🟢 Vendido · ${quantidade} mídia(s)`
                : `🔒 ${quantidade} mídia(s)`
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
  <span class="msg-hora">${formatarHora(msg.created_at)}</span>
`;
const btnConteudo = div.querySelector(".btn-excluir-pacote");

if (btnConteudo) {
  btnConteudo.addEventListener("click", (e) => {
    e.stopPropagation(); // 🔥 impede abrir preview ao clicar no botão
    excluirPacoteConteudo(btnConteudo.dataset.id);
  });
}
    ativarLazyLoadingModelo(div, msg, bloqueado);
  }

  // ===============================
  // 💬 MENSAGEM DE TEXTO
  // ===============================
  else {
    div.innerHTML = `
      <div class="msg-texto">${msg.text}</div>

      ${msg.sender === "modelo" ? `
        <button
          class="msg-menu"
          data-id="${msg.id}"
          data-text="${encodeURIComponent(msg.text || "")}">
          ⋮
        </button>
      ` : ""}

      <span class="msg-hora">${formatarHora(msg.created_at)}</span>
    `;

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

  chat.appendChild(div);
}


function abrirPreviewAvatar(url) {
  if (!url || typeof url !== "string") return;

  let modal = document.getElementById("avatarPreviewModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "avatarPreviewModal";
    modal.className = "preview-modal";

    modal.innerHTML = `
      <div class="preview-backdrop"></div>
      <div class="preview-box">
        <span class="preview-close">×</span>
        <img id="avatarPreviewImg" />
      </div>
    `;

    document.body.appendChild(modal);

    const fechar = () => {
      modal.classList.remove("open");
      setTimeout(() => modal.remove(), 200); // tempo para animação
      document.removeEventListener("keydown", escListener);
    };

    const escListener = (e) => {
      if (e.key === "Escape") fechar();
    };

    modal.querySelector(".preview-backdrop").onclick = fechar;
    modal.querySelector(".preview-close").onclick = fechar;

    document.addEventListener("keydown", escListener);
  }

  const img = modal.querySelector("#avatarPreviewImg");

  // 🔒 Evita mostrar imagem quebrada
  img.onerror = () => {
    console.warn("Erro ao carregar avatar preview");
    modal.remove();
  };

  img.src = url;

  // 🔥 Abrir
  requestAnimationFrame(() => {
    modal.classList.add("open");
  });
}

function abrirPreviewMidia(midia) {
  if (!midia || !midia.url) return;

  let modal = document.getElementById("midiaPreviewModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id = "midiaPreviewModal";
    modal.className = "preview-modal";

    modal.innerHTML = `
      <div class="preview-backdrop"></div>
      <div class="preview-box">
        <span class="preview-close">×</span>
        <div id="midiaPreviewContainer"></div>
      </div>
    `;

    document.body.appendChild(modal);

    const fechar = () => {
      modal.classList.remove("open");
      setTimeout(() => modal.remove(), 200);
      document.removeEventListener("keydown", escListener);
    };

    const escListener = (e) => {
      if (e.key === "Escape") fechar();
    };

    modal.querySelector(".preview-backdrop").onclick = fechar;
    modal.querySelector(".preview-close").onclick = fechar;

    document.addEventListener("keydown", escListener);
  }

  const container = modal.querySelector("#midiaPreviewContainer");
  container.innerHTML = "";

  if (midia.tipo_media === "video" || midia.tipo === "video") {
    container.innerHTML = `
      <video src="${midia.url}" controls autoplay playsinline></video>
    `;
  } else {
    container.innerHTML = `
      <img src="${midia.url}" />
    `;
  }

  requestAnimationFrame(() => {
    modal.classList.add("open");
  });
}


function enviarConteudosSelecionados() {
  if (!window.socket) return;

  const selecionados = [
    ...document.querySelectorAll(".preview-item.selected")
  ];

  if (selecionados.length === 0) {
    alert("Selecione ao menos um conteúdo.");
    return;
  }

  // 🔒 Sanitizar IDs
  const conteudos_ids = selecionados
    .map(el => Number(el.dataset.conteudoId))
    .filter(id => Number.isInteger(id) && id > 0);

  if (conteudos_ids.length === 0) {
    alert("Conteúdos inválidos.");
    return;
  }

  // 🔒 Sanitizar preço
  let preco = Number(
    document.getElementById("precoConteudo")?.value || 0
  );

  if (!Number.isFinite(preco) || preco < 0) {
    preco = 0;
  }

  preco = Number(preco.toFixed(2));

  // 🔒 Garantir IDs globais válidos
  if (
    !Number.isInteger(cliente_id) ||
    !Number.isInteger(modelo_id)
  ) {
    console.error("cliente_id ou modelo_id inválido");
    return;
  }

  socket.emit("sendConteudo", {
    cliente_id,
    modelo_id,
    conteudos_ids,
    preco
  });

  fecharPopupConteudos();
}


async function abrirPopupConteudos() {
  try {
    if (!Number.isInteger(cliente_id)) return;

    const popup = document.getElementById("popupConteudos");
    const grid = document.getElementById("previewConteudos");

    if (!popup || !grid) return;

    popup.classList.remove("hidden");
    grid.innerHTML = `<div class="popup-loading">Carregando...</div>`;

    if (!window.conteudosVistosCliente) {
      window.conteudosVistosCliente = new Set();
    }

    await carregarConteudosVistos(cliente_id);

    const token = localStorage.getItem("token");
    if (!token) {
      grid.innerHTML = "Sessão expirada.";
      return;
    }

    const res = await fetch("/api/conteudos", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      grid.innerHTML = "Erro ao carregar conteúdos.";
      return;
    }

    const conteudos = await res.json();

    if (!Array.isArray(conteudos) || conteudos.length === 0) {
      grid.innerHTML = "<p>Nenhum conteúdo enviado ainda.</p>";
      return;
    }

    grid.innerHTML = "";

    conteudos.forEach(c => {
      if (!c?.id || !c?.url) return;

      const jaVisto = window.conteudosVistosCliente.has(c.id);

      const item = document.createElement("div");
      item.className =
        "preview-item lazy-popup" +
        (jaVisto ? " visto desabilitado" : "");

        item.dataset.conteudoId = c.id;
item.dataset.thumb = c.thumbnail_url || c.url;
item.dataset.full = c.url;
item.dataset.tipo = c.tipo; 

      item.innerHTML = `
        <div class="popup-placeholder"></div>
        ${jaVisto ? `<span class="badge-visto">Visto</span>` : ""}
      `;
// 👁 BOTÃO DE PREVIEW (não altera seleção)
const btnPreview = document.createElement("button");
btnPreview.className = "btn-preview";
btnPreview.innerHTML = "👁";

btnPreview.addEventListener("click", (e) => {
  e.stopPropagation(); // 🔥 impede de selecionar/desselecionar

  abrirPreviewMidia({
    url: item.dataset.full,
    tipo: item.dataset.tipo
  });
});

item.appendChild(btnPreview);   
        // ▶ OVERLAY PARA VÍDEO
  if (c.tipo === "video") {
    const overlay = document.createElement("div");
    overlay.className = "play-overlay";

    const icon = document.createElement("span");
    icon.textContent = "▶";

    overlay.appendChild(icon);
    item.appendChild(overlay);
  }

      if (jaVisto) {
        item.addEventListener("click", () => {
          alert("Este conteúdo já foi visto por este cliente e não pode ser reenviado.");
        });
      } else {
        item.addEventListener("click", () => {
          item.classList.toggle("selected");
        });
      }

      grid.appendChild(item);
    });

    ativarLazyPopup(grid);

  } catch (err) {
    console.error("Erro abrirPopupConteudos:", err);
    const grid = document.getElementById("previewConteudos");
    if (grid) grid.innerHTML = "Erro inesperado.";
  }
}

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

function confirmarEnvioConteudo() {
  try {
    // 🔒 Validar IDs globais
    if (!Number.isInteger(cliente_id) || !Number.isInteger(modelo_id)) {
      alert("Selecione um cliente válido primeiro.");
      return;
    }

    const selecionados = [
      ...document.querySelectorAll(".preview-item.selected")
    ];

    if (!selecionados.length) {
      alert("Selecione ao menos um conteúdo.");
      return;
    }

    // 🔒 Sanitizar IDs dos conteúdos
    const conteudos_ids = selecionados
      .map(item => Number(item.dataset.conteudoId))
      .filter(id => Number.isInteger(id) && id > 0);

    if (!conteudos_ids.length) {
      alert("Conteúdos inválidos.");
      return;
    }

    // 🔒 Sanitizar preço
    let preco = Number(document.getElementById("precoConteudo")?.value || 0);
    if (!Number.isFinite(preco) || preco < 0) preco = 0;
    preco = Number(preco.toFixed(2));

if (!socket || !socket.connected) {
  console.error("Socket não conectado!");
  return;
}

    // 🔥 Garantir join na sala antes de enviar
    socket.emit("joinChat", { cliente_id, modelo_id });

    // 🔥 Delay mínimo para join
    setTimeout(() => {
      socket.emit("sendConteudo", {
        cliente_id,
        modelo_id,
        conteudos_ids,
        preco
      });
    }, 50);

    // 🔄 Fechar popup
    fecharPopupConteudos();

  } catch (err) {
    console.error("Erro confirmar envio de conteúdo:", err);
  }
}

// 🔔 Atualiza a mensagem de conteúdo quando cliente já viu
socket.on("conteudoVisto", ({ message_id }) => {
  if (!message_id) return;

  // 🔒 Garantir que o seletor funcione mesmo com string/number
  const el = document.querySelector(`.chat-conteudo[data-id="${message_id}"]`);
  if (!el) return;

  el.classList.remove("bloqueado");
  el.classList.add("visto");

  const status = el.querySelector(".status-bloqueado");
  if (status) status.innerText = "🟢 Vendido";
});

// 🔄 Carrega os conteúdos já vistos pelo cliente
async function carregarConteudosVistos(cliente_id) {
  if (!Number.isInteger(cliente_id)) return;

  try {
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch(`/api/chat/conteudos-vistos/${cliente_id}`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.warn("Falha ao buscar conteúdos vistos:", res.status);
      window.conteudosVistosCliente = new Set();
      return;
    }

    const ids = await res.json();

    // 🔒 Sempre cria Set para evitar erro no frontend
    window.conteudosVistosCliente = new Set(
      Array.isArray(ids) ? ids.map(id => Number(id)).filter(id => Number.isInteger(id)) : []
    );

  } catch (err) {
    console.error("Erro carregarConteudosVistos:", err);
    window.conteudosVistosCliente = new Set();
  }
}

function formatarHora(data) {
  if (!data) return "";

  const d = new Date(data);
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

// 🔒 Marca todas as mensagens de um cliente como lidas pelo modelo
async function marcarComoLido(cliente_id) {
  try {
    if (!Number.isInteger(cliente_id)) {
      console.warn("cliente_id inválido:", cliente_id);
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      console.warn("Token não encontrado para marcar como lido");
      return;
    }

    const res = await fetch(`/api/chat/modelo/marcar-lido/${cliente_id}`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.error("Falha ao marcar mensagens como lidas:", res.status);
    } else {
      console.log("Mensagens marcadas como lidas para cliente_id:", cliente_id);
    }

  } catch (err) {
    console.error("Erro ao marcar como lido:", err);
  }
}

// ===============================
// Variáveis globais para edição de mensagem
// ===============================
let mensagemEditandoId = null;
let elementoMensagemEditando = null;


function abrirMenuMensagem(id, texto) {
  if (!id) {
    console.warn("ID da mensagem inválido:", id);
    return;
  }

  mensagemEditandoId = id;

  // 🔒 Acha a mensagem no DOM de forma segura
  const btnMenu = document.querySelector(`.msg-menu[data-id="${id}"]`);
  if (!btnMenu) {
    console.warn("Botão de menu da mensagem não encontrado:", id);
    elementoMensagemEditando = null;
  } else {
    elementoMensagemEditando = btnMenu.closest(".msg") || null;
  }

  // 🔒 Preenche input de edição se existir
  const inputEditar = document.getElementById("editarTexto");
  if (inputEditar) {
    inputEditar.value = texto || "";
  }

  // 🔒 Mostra menu apenas se existir
  const menu = document.getElementById("menuMensagem");
  if (menu) {
    menu.classList.remove("hidden");
  }
}



function fecharMenuMensagem() {
  // 🔒 Resetar variáveis globais
  mensagemEditandoId = null;
  elementoMensagemEditando = null;

  // 🔒 Fechar menu apenas se existir
  const menu = document.getElementById("menuMensagem");
  if (menu) {
    menu.classList.add("hidden");
  }
}


function salvarEdicao() {
  const inputEditar = document.getElementById("editarTexto");
  if (!inputEditar) return;

  const novoTexto = inputEditar.value.trim();

  if (!novoTexto) {
    alert("Mensagem vazia não é permitida.");
    return;
  }

  if (!mensagemEditandoId) {
    console.warn("Nenhuma mensagem selecionada para edição.");
    return;
  }

  // 🔥 Atualiza o DOM localmente
  if (elementoMensagemEditando) {
    const textoDiv = elementoMensagemEditando.querySelector(".msg-texto");
    if (textoDiv) {
      textoDiv.innerText = novoTexto;
    }
  }

  // 🔒 Emite para o backend apenas se ID válido
if (socket && socket.connected) {
    socket.emit("editarMensagem", {
      id: mensagemEditandoId,
      text: novoTexto
    });
  } else {
    console.warn("Socket não conectado. Edição não enviada.");
  }

  fecharMenuMensagem();
}

function excluirMensagem() {
  if (!mensagemEditandoId) {
    console.warn("Nenhuma mensagem selecionada para exclusão.");
    return;
  }

  if (!confirm("Tem certeza que deseja excluir esta mensagem?")) return;

  if (elementoMensagemEditando) {
    elementoMensagemEditando.remove();
  }

 if (socket && socket.connected && socketAutenticado) {
  socket.emit("excluirMensagem", { id: mensagemEditandoId });
  } else {
    console.warn("Socket não conectado. Exclusão não enviada.");
  }

  // 🔄 Fecha menu
  fecharMenuMensagem();
}


async function carregarInfoCliente(cliente_id) {
  try {
    if (!Number.isInteger(cliente_id)) {
      console.warn("cliente_id inválido:", cliente_id);
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      console.warn("Token não encontrado.");
      return;
    }

    // 🔒 Rota real do server
    const res = await fetch(`/api/cliente/${cliente_id}`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.warn("Falha ao buscar info do cliente:", res.status);
      return;
    }

    const cliente = await res.json();

    const avatar = document.getElementById("chatClienteAvatar");
    const nome = document.getElementById("chatClienteNome");
    const status = document.getElementById("chatClienteStatus");

    if (avatar) {
      avatar.style.cursor = "pointer";

      // 🔄 remove listener antigo
      avatar.replaceWith(avatar.cloneNode(true));
      const novoAvatar = document.getElementById("chatClienteAvatar");
      
      if (cliente.avatar) {
        novoAvatar.addEventListener("click", () => abrirPreviewAvatar(cliente.avatar));
      }
    }

    if (nome) {
      nome.innerText = cliente.username || cliente.nome || "Cliente";
    }

    if (status) {
      if (cliente.last_seen) {
        status.innerText = `visto por último: ${formatarTempo(cliente.last_seen)}`;
      } else {
        status.innerText = "visto por último: agora";
      }
    }

  } catch (err) {
    console.error("Erro carregar cliente:", err);
  }
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

//OTIMIZACAO CHAT
const observerModelo = new IntersectionObserver((entries) => {

  entries.forEach(entry => {

    if (!entry.isIntersecting) return;

    const el = entry.target;
    const thumb = el.dataset.thumb;

    if (!thumb) return;

    const img = document.createElement("img");
    img.src = thumb;
    img.loading = "lazy";
    img.decoding = "async";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";

    el.innerHTML = "";
    el.appendChild(img);

    observerModelo.unobserve(el);

  });

}, {
  root: document.getElementById("chatBox"),
  threshold: 0.1
});

function ativarLazyLoadingModelo(container, msg, bloqueado) {

  const midias = container.querySelectorAll(".lazy-midia");

  midias.forEach((el) => {

    observerModelo.observe(el);

    el.style.cursor = "pointer";

    el.addEventListener("click", (e) => {
      e.stopPropagation();

      if (bloqueado) {
        if (typeof abrirFluxoPagamentoConteudo === "function") {
          abrirFluxoPagamentoConteudo(msg);
        }
        return;
      }

      const index = Number(el.dataset.index);
      abrirPreviewMidiaDireto(msg, index);
    });

  });
}

let popupObserver;

function ativarLazyPopup(container) {

  if (popupObserver) {
    popupObserver.disconnect();
  }

  popupObserver = new IntersectionObserver((entries) => {

    entries.forEach(entry => {

      if (!entry.isIntersecting) return;

      const el = entry.target;
      const thumb = el.dataset.thumb;
      if (!thumb) return;

      const img = document.createElement("img");
      img.src = thumb;
      img.loading = "lazy";
      img.decoding = "async";
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";

      el.querySelector(".popup-placeholder")?.remove();
      el.prepend(img);

      popupObserver.unobserve(el);

    });

  }, {
    root: container,   // 🔥 AGORA USA O GRID CORRETO
    threshold: 0.1
  });

  const items = container.querySelectorAll(".lazy-popup");
  items.forEach(el => popupObserver.observe(el));
}

async function excluirPacoteConteudo(message_id) {

  if (!confirm("Tem certeza que deseja excluir este pacote?")) return;

  try {

    const res = await fetch(`/api/chat/pacote/${message_id}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + localStorage.getItem("token")
      }
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Erro ao excluir pacote.");
      return;
    }

    // 🔥 remove do DOM
    const el = document.querySelector(
      `.chat-conteudo[data-id="${message_id}"]`
    )?.closest(".msg");

    if (el) el.remove();

  } catch (err) {
    console.error("Erro excluir pacote:", err);
    alert("Erro inesperado.");
  }
}