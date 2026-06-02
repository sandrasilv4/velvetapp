// ===========================
// AUTH GUARD
// ===========================
const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

if (!token || role !== "modelo") {
  logout();
}

// ===========================
// SOCKET (shared, single connection)
// ===========================
const socket = io({
  transports: ["websocket", "polling"],
  auth: { token },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

window.socket = socket;

// ===========================
// INBOX STATE
// ===========================
const INBOX_LIMIT = 20;
let inboxOffset    = 0;
let inboxLista     = [];
let inboxCarregando = false;
let inboxFimLista  = false;
const chatsMap     = new Map();

// ===========================
// CHAT STATE
// ===========================
let autenticado            = false;
let salaPronta             = false;
let cliente_id             = null;
let modelo_id              = null;
let offsetMensagens        = 0;
const LIMIT_MENSAGENS      = 20;
let carregandoHistorico    = false;
let enviandoConteudo       = false;
let historicoInicialCarregado = false;
const mensagensRenderizadas = new Set();
let paginaConteudos        = 1;
const limiteConteudos      = 12;
let carregandoConteudos    = false;
let fimConteudos           = false;

// ===========================
// DOM REFS
// ===========================
const inboxEl    = document.getElementById("inbox");
const inboxPanel = document.getElementById("inboxPanel");
const chatBox    = document.getElementById("chatBox");

// ===========================
// SOCKET — CONNECT
// ===========================
socket.on("connect", async () => {
  autenticado = true;
  salaPronta  = false;

  socket.emit("loginModelo");
  entrarInbox();

  if (cliente_id) {
    await carregarInfoCliente(cliente_id);
  }

  tentarEntrarSala();
});

socket.on("connect_error", err => {
  autenticado = false;
  salaPronta  = false;
  console.error("❌ connect_error:", err.message, err);
});

socket.on("disconnect", reason => {
  console.warn("🔴 Socket desconectado:", reason);
  autenticado = false;
  salaPronta  = false;
});

// ===========================
// SOCKET — INBOX
// ===========================
socket.on("inboxMessage", async dados => {
  tocarSomNotificacao();
  const chatId         = dados.cliente_id || dados.modelo_id;
  const jaExisteNaTela = chatsMap.has(chatId);

  atualizarChatLocalInbox(dados);

  if (!jaExisteNaTela) {
    await recarregarInboxDoZero();
  }
});

// ===========================
// SOCKET — CHAT HISTORY
// ===========================
socket.on("chatHistory", mensagens => {
  if (!chatBox || !Array.isArray(mensagens)) return;

  const primeiraCarga = offsetMensagens === 0;

  if (primeiraCarga) {
    chatBox.innerHTML = "";
    mensagensRenderizadas.clear();
    mensagens.forEach(m => renderMensagem(m));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chatBox.scrollTop = chatBox.scrollHeight;
      });
    });
  } else {
    const alturaAntes = chatBox.scrollHeight;
    mensagens.reverse().forEach(m => {
      if (mensagensRenderizadas.has(m.id)) return;
      mensagensRenderizadas.add(m.id);
      const div = criarMensagemElemento(m);
      chatBox.prepend(div);
    });
    requestAnimationFrame(() => {
      const alturaDepois = chatBox.scrollHeight;
      chatBox.scrollTop += (alturaDepois - alturaAntes);
    });
  }

  offsetMensagens += mensagens.length;
  historicoInicialCarregado = true;
  carregandoHistorico       = false;
});

// ===========================
// SOCKET — NOVA MENSAGEM
// ===========================
socket.on("newMessage", msg => {
  if (
    Number(msg.modelo_id)  !== Number(modelo_id) ||
    Number(msg.cliente_id) !== Number(cliente_id)
  ) return;

  const temp = document.querySelector(`[data-id="${msg.tempId}"]`);

  if (temp) {
    temp.dataset.id = msg.id;
    mensagensRenderizadas.add(msg.id);
    return;
  }

  if (mensagensRenderizadas.has(msg.id)) return;

  renderMensagem(msg);
  scrollParaFinal();

  if (msg.sender === "cliente") {
    carregarInfoCliente(cliente_id);
  }
});

// ===========================
// SOCKET — EDIÇÃO / EXCLUSÃO
// ===========================
socket.on("mensagemEditada", ({ id, text }) => {
  const msgEl = document.querySelector(`.msg[data-id="${id}"]`);
  if (!msgEl) return;
  const textoDiv = msgEl.querySelector(".msg-texto");
  if (textoDiv) textoDiv.innerText = text;
});

socket.on("mensagemExcluida", ({ id }) => {
  const msgEl = document.querySelector(`.msg[data-id="${id}"]`);
  if (msgEl) msgEl.remove();
});

// ===========================
// SOCKET — CONTEÚDO VISTO
// ===========================
socket.on("conteudoVisto", ({ message_id, conteudo_ids }) => {
  if (!message_id) return;

  const el = document.querySelector(`.chat-conteudo[data-id="${message_id}"]`);
  if (el) {
    el.classList.remove("bloqueado");
    el.classList.add("visto");
    const status = el.querySelector(".status-bloqueado");
    if (status) status.innerText = t("chat.content_viewed");
  }

  if (Array.isArray(conteudo_ids)) {
    conteudo_ids.forEach(id => {
      window.conteudosVistosCliente.add(Number(id));
    });
  }
});

// ===========================
// INBOX — ENTRAR NA SALA
// ===========================
function entrarInbox() {
  socket.emit("joinInbox", res => {
    if (!res?.ok) {
      console.warn("⚠️ Falha ao entrar na inbox:", res?.error);
      return;
    }
    console.log("📬 Entrou na inbox:", res.sala);
  });
}

// ===========================
// INBOX — NORMALIZAR / COMPARAR
// ===========================
function normalizarChat(c) {
  const ultimo_sender = c.ultimo_sender ?? c.sender ?? null;
  const lida  = Boolean(c.lida);
  const visto = Boolean(c.visto);

  return {
    ...c,
    ultimo_sender,
    lida,
    visto,
    nao_lido:           ultimo_sender === "cliente" && lida  === false,
    por_responder:      ultimo_sender === "cliente" && lida  === true,
    cliente_visualizou: ultimo_sender === "modelo"  && visto === true
  };
}

function upsertChats(clientes) {
  clientes.map(normalizarChat).forEach(c => {
    const idx = inboxLista.findIndex(x => x.cliente_id === c.cliente_id);
    if (idx === -1) inboxLista.push(c);
    else inboxLista[idx] = { ...inboxLista[idx], ...c };
  });
}

async function recarregarInboxDoZero() {
  if (inboxCarregando) return;
  await carregarInboxInicial();
}

function prioridadeChat(c) {
  if (c.nao_lido)           return 1;
  if (c.por_responder)      return 2;
  if (c.cliente_visualizou) return 3;
  if (c.ultimo_sender === "modelo") return 4;
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

// ===========================
// INBOX — FETCH (scroll infinito)
// ===========================
async function carregarListaClientes() {
  if (inboxCarregando || inboxFimLista) return;

  inboxCarregando = true;

  try {
    const res = await fetch(
      `/api/chat/modelo?limit=${INBOX_LIMIT}&offset=${inboxOffset}`,
      { headers: { Authorization: "Bearer " + token } }
    );

    if (!res.ok) return;

    const clientes = await res.json();

    if (clientes.length === 0) {
      inboxFimLista = true;
      return;
    }

    preloadAvatars(clientes);
    upsertChats(clientes);
    inboxLista.sort(compararChats);
    rerenderizarInboxCompleta();
    inboxOffset += clientes.length;

  } catch (err) {
    console.error("Erro carregar inbox:", err);
  } finally {
    inboxCarregando = false;
  }
}

// ===========================
// INBOX — TEMPO (dias/hoje)
// ===========================
function formatarTempoInbox(data) {
  if (!data) return "";

  const d    = new Date(data);
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

// ===========================
// INBOX — ABRIR CHAT (split view)
// ===========================
function abrirChat(clienteId) {
  const idx = inboxLista.findIndex(c => c.cliente_id === clienteId);

  if (idx !== -1 && inboxLista[idx].ultimo_sender === "cliente") {
    inboxLista[idx] = normalizarChat({ ...inboxLista[idx], lida: true });
    inboxLista.sort(compararChats);
    rerenderizarInboxCompleta();
  }

  carregarChatNoPanel(clienteId);
}

// ===========================
// CHAT — CARREGAR NO PAINEL DIREITO
// ===========================
async function carregarChatNoPanel(novoClienteId) {
  offsetMensagens           = 0;
  salaPronta                = false;
  historicoInicialCarregado = false;
  carregandoHistorico       = false;
  mensagensRenderizadas.clear();

  if (chatBox) chatBox.innerHTML = "";

  cliente_id = novoClienteId;

  document.getElementById("chatPanel")?.classList.remove("vazio");

  await carregarInfoCliente(cliente_id);
  await marcarComoLido(cliente_id);
  tentarEntrarSala();
}

// ===========================
// INBOX — ATUALIZAR ITEM LOCAL
// ===========================
function atualizarChatLocalInbox(dados) {
  const chatId = dados.cliente_id || dados.modelo_id;
  const idx    = inboxLista.findIndex(c => c.cliente_id === chatId);
  if (idx === -1) return;

  inboxLista[idx] = normalizarChat({ ...inboxLista[idx], ...dados });
  inboxLista.sort(compararChats);
  rerenderizarInboxCompleta();
}

// ===========================
// INBOX — STATUS HTML
// ===========================
function gerarStatus(c) {
  if (c.nao_lido)
    return `<span class="status status-unseen">${t("inbox.chat_unread")}</span>`;
  if (c.por_responder)
    return `<span class="status status-reply">${t("inbox.chat_reply_needed")}</span>`;
  if (c.cliente_visualizou)
    return `<span class="status status-read">✓✓</span>`;
  if (c.ultimo_sender === "modelo")
    return `<span class="status status-sent">✓</span>`;
  return "";
}

// ===========================
// INBOX — PRELOAD AVATARS
// ===========================
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

// ===========================
// INBOX — CARGA INICIAL
// ===========================
async function carregarInboxInicial() {
  inboxOffset   = 0;
  inboxFimLista = false;
  inboxLista    = [];
  chatsMap.clear();

  let continuar = true;

  while (continuar && !inboxFimLista) {
    const clientes = await buscarPaginaInbox();

    if (!clientes.length) {
      inboxFimLista = true;
      break;
    }

    upsertChats(clientes);
    inboxLista.sort(compararChats);
    rerenderizarInboxCompleta();
    inboxOffset += clientes.length;

    const paginaNormalizada    = clientes.map(normalizarChat);
    const paginaTemPrioritario = paginaNormalizada.some(ehPrioritario);
    if (!paginaTemPrioritario) continuar = false;
  }
}

async function buscarPaginaInbox() {
  if (inboxCarregando || inboxFimLista) return [];

  inboxCarregando = true;

  try {
    const res = await fetch(
      `/api/chat/modelo?limit=${INBOX_LIMIT}&offset=${inboxOffset}`,
      { headers: { Authorization: "Bearer " + token } }
    );

    if (!res.ok) return [];

    const clientes = await res.json();

    if (clientes.length === 0) {
      inboxFimLista = true;
      return [];
    }

    preloadAvatars(clientes);
    return clientes;

  } catch (err) {
    console.error("Erro buscar inbox:", err);
    return [];
  } finally {
    inboxCarregando = false;
  }
}

// ===========================
// INBOX — RENDER LISTA
// ===========================
function rerenderizarInboxCompleta() {
  inboxEl.innerHTML = "";
  chatsMap.clear();

  inboxLista.forEach(c => {
    const statusHTML = gerarStatus(c);

    const div = document.createElement("div");
    div.className = "chat-item";
    if (c.cliente_id === cliente_id) div.classList.add("chat-item-ativo");
    div.onclick = () => abrirChat(c.cliente_id);

    div.innerHTML = `
      <div class="chat-row-top">
        <span class="chat-name">${c.username || c.nome || t("inbox.chat_client")}</span>
        <span class="chat-time">${formatarTempoInbox(c.ultima_mensagem_em)}</span>
      </div>
      <div class="chat-row-bottom">
        <div class="chat-status">${statusHTML}</div>
      </div>
    `;

    inboxEl.appendChild(div);
    chatsMap.set(c.cliente_id, { data: c, element: div });
  });
}

// ===========================
// INBOX — REFRESH PERIÓDICO
// ===========================
setInterval(async () => {
  if (document.visibilityState !== "visible") return;
  await recarregarInboxDoZero();
}, 60000);

// ===========================
// CHAT — ENTRAR NA SALA
// ===========================
function tentarEntrarSala() {
  if (!autenticado)               return;
  if (!cliente_id || !modelo_id)  return;
  if (salaPronta)                 return;

  salaPronta = true;

  socket.emit("joinChat",    { cliente_id, modelo_id });
  socket.emit("getHistory",  { cliente_id, modelo_id, offset: offsetMensagens, limit: LIMIT_MENSAGENS });
}

// ===========================
// CHAT — ENVIAR MENSAGEM
// ===========================
function enviarMensagem(e) {
  if (e) e.preventDefault();

  const campo = document.getElementById("msgInput");
  if (!campo) return;

  const text = campo.value.trim();
  if (!text) return;

  if (!socket.connected) {
    alert(t("chat.connection_lost"));
    return;
  }

  const tempId = "temp-" + Date.now();

  renderMensagem({ id: tempId, sender: "modelo", text, created_at: Date.now() });
  scrollParaFinal();

  socket.emit(
    "sendMessage",
    { cliente_id, modelo_id, text, tempId },
    resposta => {
      if (!resposta?.ok) return;
      const el = document.querySelector(`[data-id="${tempId}"]`);
      if (el) el.dataset.id = resposta.message_id;
      localStorage.removeItem(`inbox_modelo_lido_${cliente_id}`);
    }
  );

  campo.value = "";
}

// ===========================
// CHAT — SCROLL
// ===========================
function scrollParaFinal() {
  if (!chatBox) return;
  requestAnimationFrame(() => { chatBox.scrollTop = chatBox.scrollHeight; });
}

// ===========================
// CHAT — MENSAGENS ANTIGAS
// ===========================
function carregarMensagensAntigas() {
  if (carregandoHistorico) return;
  carregandoHistorico = true;
  socket.emit("getHistory", { cliente_id, modelo_id, offset: offsetMensagens, limit: LIMIT_MENSAGENS });
}

// ===========================
// CHAT — TEMPO RELATIVO
// ===========================
function formatarTempo(timestamp) {
  if (!timestamp || timestamp === "0") return t("chat.time_now");

  const time = typeof timestamp === "number"
    ? timestamp
    : new Date(timestamp).getTime();

  if (isNaN(time)) return t("chat.time_now");

  const diff = Date.now() - time;
  const min  = Math.floor(diff / 60000);
  const h    = Math.floor(diff / 3600000);
  const d    = Math.floor(diff / 86400000);

  if (min < 1) return t("chat.time_now");
  if (min < 60) return t("chat.time_minutes").replace("{n}", min);
  if (h  < 24) return t("chat.time_hours").replace("{n}", h);
  if (d  === 1) return t("chat.time_yesterday");
  return t("chat.time_days").replace("{n}", d);
}

// ===========================
// CHAT — RENDER MENSAGEM
// ===========================
function renderMensagem(msg) {
  if (!chatBox) return;
  if (mensagensRenderizadas.has(msg.id)) return;
  mensagensRenderizadas.add(msg.id);

  const div = document.createElement("div");
  div.className = msg.sender === "modelo" ? "msg msg-modelo" : "msg msg-cliente";
  div.dataset.id = msg.id;

  if (ehMensagemConteudo(msg)) {
    const quantidade  = getQuantidadeMidias(msg);
    const bloqueado   = mensagemEstaBloqueada(msg);
    const foiVisto    = !!(msg.visto || msg.liberado);
    const estadoClasse = bloqueado ? "bloqueado" : foiVisto ? "visto" : "livre";

    div.innerHTML = `
      <div class="chat-conteudo premium ${estadoClasse}"
           data-id="${msg.id}"
           data-qtd="${quantidade}"
           data-preco="${msg.preco || 0}">
        <div class="pacote-grid">
          ${(msg.midias || []).map((m, index) => `
            <div class="midia-item lazy-midia"
              data-thumb="${m.thumbnail_url || m.url}"
              data-full="${m.url}"
              data-index="${index}"
              style="background-image:url('${m.thumbnail_url || m.url}')">
            </div>
          `).join("")}
        </div>
        <div class="msg-meta">
          <span class="meta-midias">
            ${bloqueado ? `🔒${quantidade} mídia(s)` : foiVisto ? `🟢${quantidade} mídia(s)` : `📩${quantidade} mídia(s)`}
          </span>
          <span class="meta-valor">R$ ${Number(msg.preco || 0).toFixed(2)}</span>
          <span class="msg-hora">
            ${formatarTempo(msg.created_at)}
            ${msg.sender === "modelo" && !msg.liberado
              ? `<button class="btn-excluir-pacote" data-id="${msg.id}">⋮</button>`
              : ""}
          </span>
        </div>
      </div>
    `;

    const btnConteudo = div.querySelector(".btn-excluir-pacote");
    if (btnConteudo) {
      btnConteudo.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        excluirPacoteConteudo(btnConteudo.dataset.id);
      });
    }

    ativarLazyLoadingModelo(div, msg, bloqueado);

    div.querySelectorAll(".midia-item").forEach(el => {
      el.addEventListener("click", e => {
        if (role === "modelo") { abrirMidia(el); return; }
        if (bloqueado) { abrirPopupPagamento(msg.id); return; }
        abrirMidia(el);
      });
    });

  } else {
    div.innerHTML = `
      <div class="msg-texto">${msg.text || ""}</div>
      ${msg.sender === "modelo" ? `
        <button class="msg-menu" data-id="${msg.id}"
                data-text="${encodeURIComponent(msg.text || "")}">⋮</button>
      ` : ""}
      <span class="msg-hora">${formatarTempo(msg.created_at)}</span>
    `;

    const btn = div.querySelector(".msg-menu");
    if (btn) {
      btn.addEventListener("click", () => {
        abrirMenuMensagem(btn.dataset.id, decodeURIComponent(btn.dataset.text));
      });
    }
  }

  chatBox.appendChild(div);
}

// ===========================
// CHAT — CRIAR ELEMENTO (para histórico reverso)
// ===========================
function criarMensagemElemento(msg) {
  const div = document.createElement("div");
  div.className = msg.sender === "modelo" ? "msg msg-modelo" : "msg msg-cliente";
  div.dataset.id = msg.id;

  if (ehMensagemConteudo(msg)) {
    const quantidade  = getQuantidadeMidias(msg);
    const bloqueado   = mensagemEstaBloqueada(msg);
    const foiVisto    = !!(msg.visto || msg.liberado);
    const estadoClasse = bloqueado ? "bloqueado" : foiVisto ? "visto" : "livre";

    div.innerHTML = `
      <div class="chat-conteudo premium ${estadoClasse}"
           data-id="${msg.id}"
           data-preco="${msg.preco || 0}"
           data-qtd="${quantidade}">
        <div class="pacote-grid">
          ${(msg.midias || []).map((m, index) => `
            <div class="midia-item lazy-midia"
              data-thumb="${m.thumbnail_url || m.url}"
              data-full="${m.url}"
              data-index="${index}"
              style="background-image:url('${m.thumbnail_url || m.url}')">
            </div>
          `).join("")}
        </div>
        <div class="msg-meta">
          <span class="meta-midias">
            ${bloqueado ? `🔒${quantidade} mídia(s)` : foiVisto ? `🟢${quantidade} mídia(s)` : `📩${quantidade} mídia(s)`}
          </span>
          <span class="meta-valor">R$ ${Number(msg.preco || 0).toFixed(2)}</span>
          <span class="msg-hora">
            ${formatarTempo(msg.created_at)}
            ${msg.sender === "modelo" && !msg.liberado
              ? `<button class="btn-excluir-pacote" data-id="${msg.id}">⋮</button>`
              : ""}
          </span>
        </div>
      </div>
    `;

    ativarLazyLoadingModelo(div);

    const btnConteudo = div.querySelector(".btn-excluir-pacote");
    if (btnConteudo) {
      btnConteudo.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        excluirPacoteConteudo(btnConteudo.dataset.id);
      });
    }

    div.querySelectorAll(".midia-item").forEach(el => {
      el.addEventListener("click", () => {
        if (role === "modelo") { abrirMidia(el); return; }
        if (mensagemEstaBloqueada(msg)) { abrirPopupPagamento(msg.id); return; }
        abrirMidia(el);
      });
    });

  } else {
    div.innerHTML = `
      <div class="msg-texto">${msg.text || ""}</div>
      ${msg.sender === "modelo" ? `
        <button class="msg-menu" data-id="${msg.id}"
                data-text="${encodeURIComponent(msg.text || "")}">⋮</button>
      ` : ""}
      <span class="msg-hora">${formatarTempo(msg.created_at)}</span>
    `;

    const btn = div.querySelector(".msg-menu");
    if (btn) {
      btn.addEventListener("click", () => {
        abrirMenuMensagem(btn.dataset.id, decodeURIComponent(btn.dataset.text));
      });
    }
  }

  return div;
}

// ===========================
// CHAT — INFO CLIENTE
// ===========================
async function carregarInfoCliente(cid) {
  if (!cid) return;

  try {
    const res = await fetch(`/api/chat/cliente/${cid}`, {
      headers: { Authorization: "Bearer " + token }
    });

    if (!res.ok) { console.warn("Erro ao carregar cliente"); return; }

    const cliente = await res.json();

    const nome   = document.getElementById("chatClienteNome");
    const avatar = document.getElementById("chatClienteAvatar");
    const status = document.getElementById("chatClienteStatus");

    if (nome)   nome.innerText = cliente.nome || t("chat.client_name_placeholder");

    const avatarUrl = cliente.avatar || "/assets/avatar.png";
    if (avatar) {
      avatar.src = avatarUrl;
      avatar.style.cursor = "pointer";
      avatar.onclick = () => abrirPreviewAvatar(avatarUrl);
    }

    if (status) {
      status.innerText = cliente.last_seen
        ? t("chat.last_seen").replace("{time}", formatarTempo(cliente.last_seen))
        : t("chat.last_seen").replace("{time}", t("chat.time_now"));
    }

    await carregarAnotacoesCliente(cid);

  } catch (err) {
    console.error("Erro carregarInfoCliente:", err);
  }
}

// ===========================
// CHAT — MARCAR COMO LIDO
// ===========================
async function marcarComoLido(cid) {
  if (!cid) return;

  try {
    await fetch(`/api/chat/modelo/marcar-lido/${cid}`, {
      method: "POST",
      headers: { Authorization: "Bearer " + token }
    });
  } catch (err) {
    console.error("Erro marcar como lido:", err);
  }
}

// ===========================
// CHAT — MENU MENSAGEM
// ===========================
function fecharMenuMensagem() {
  document.getElementById("menuMensagem")?.classList.add("hidden");
}

function salvarEdicao() {
  const text = document.getElementById("editarTexto").value.trim();
  if (!text || !window.mensagemSelecionada) return;
  socket.emit("editarMensagem", { id: window.mensagemSelecionada, text });
  fecharMenuMensagem();
}

function excluirMensagem() {
  if (!window.mensagemSelecionada) return;
  socket.emit("excluirMensagem", { id: window.mensagemSelecionada });
  fecharMenuMensagem();
}

function abrirMenuMensagem(id, text) {
  window.mensagemSelecionada = id;
  const textarea = document.getElementById("editarTexto");
  if (textarea) textarea.value = text || "";
  document.getElementById("menuMensagem")?.classList.remove("hidden");
}

// ===========================
// CHAT — POPUP CONTEÚDOS
// ===========================
async function abrirPopupConteudos() {
  try {
    if (!Number.isInteger(cliente_id) || !Number.isInteger(modelo_id)) {
      console.warn("IDs inválidos para abrir popup.");
      return;
    }

    const popup = document.getElementById("popupConteudos");
    const grid  = document.getElementById("previewConteudos");
    if (!popup || !grid) return;

    popup.classList.remove("hidden");
    grid.innerHTML = `<div class="popup-loading">${t("chat.loading")}</div>`;

    if (!window.conteudosVistosCliente) window.conteudosVistosCliente = new Set();

    await carregarConteudosVistos(cliente_id);

    const tk = localStorage.getItem("token");
    if (!tk) { grid.innerHTML = t("chat.session_expired"); return; }

    const res = await fetch("/api/conteudos?limit=1000", {
      headers: { Authorization: "Bearer " + tk }
    });

    if (!res.ok) { grid.innerHTML = t("chat.error_load_content"); return; }

    const data     = await res.json();
    const conteudos = Array.isArray(data) ? data : data.conteudos;

    if (!Array.isArray(conteudos) || conteudos.length === 0) {
      grid.innerHTML = `<p>${t("chat.no_content")}</p>`;
      return;
    }

    grid.innerHTML = "";

    conteudos.forEach(c => {
      if (!c?.id || !c?.url) return;

      const jaVisto = window.conteudosVistosCliente.has(Number(c.id));
      const tipo    = c.tipo || "imagem";

      const item = document.createElement("div");
      item.className = "preview-item lazy-popup" + (jaVisto ? " visto desabilitado" : "");
      item.dataset.conteudoId = c.id;

      let thumb = c.thumbnail_url;
      if (!thumb) {
        if (c.tipo === "video") {
          thumb = c.url.includes("videodelivery.net")
            ? c.url.replace("iframe.videodelivery.net", "videodelivery.net") + "/thumbnails/thumbnail.jpg"
            : "/assets/video-thumb.jpg";
        } else {
          thumb = c.url;
        }
      }

      item.dataset.thumb = thumb;
      item.dataset.full  = c.url;
      item.dataset.tipo  = tipo;

      item.innerHTML = `
        <div class="popup-placeholder"></div>
        ${jaVisto ? `<span class="badge-visto">${t("chat.badge_seen")}</span>` : ""}
      `;

      const btnPreview = document.createElement("button");
      btnPreview.className = "btn-preview";
      btnPreview.innerHTML = "👁";
      btnPreview.addEventListener("click", e => {
        e.stopPropagation();
        abrirPreviewMidia({ url: item.dataset.full, tipo: item.dataset.tipo });
      });
      item.appendChild(btnPreview);

      if (c.tipo === "video") {
        const overlay = document.createElement("div");
        overlay.className = "play-overlay";
        const icon = document.createElement("span");
        icon.textContent = "▶";
        overlay.appendChild(icon);
        item.appendChild(overlay);
      }

      if (jaVisto) {
        item.addEventListener("click", () => alert(t("chat.content_already_seen")));
      } else {
        item.addEventListener("click", () => item.classList.toggle("selected"));
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
  document.getElementById("popupConteudos")?.classList.add("hidden");
  document.querySelectorAll(".preview-item.selected").forEach(el => el.classList.remove("selected"));
  const precoInput = document.getElementById("precoConteudo");
  if (precoInput) precoInput.value = 0;
  window.conteudosSelecionados = [];
}

function confirmarEnvioConteudo() {
  try {
    if (!Number.isInteger(cliente_id) || !Number.isInteger(modelo_id)) {
      alert(t("chat.invalid_client"));
      return;
    }

    const selecionados  = [...document.querySelectorAll(".preview-item.selected")];
    if (!selecionados.length) { alert(t("chat.select_at_least_one")); return; }

    const conteudos_ids = selecionados
      .map(item => Number(item.dataset.conteudoId || 0))
      .filter(id => Number.isInteger(id) && id > 0);

    if (!conteudos_ids.length) { alert(t("chat.invalid_content")); return; }

    let preco = Number(document.getElementById("precoConteudo")?.value || 0);
    if (!Number.isFinite(preco) || preco < 0) preco = 0;
    preco = Number(preco.toFixed(2));

    if (!socket || !socket.connected) { console.error("Socket não conectado!"); return; }

    socket.emit("sendConteudo", { cliente_id, modelo_id, conteudos_ids, preco });
    fecharPopupConteudos();

  } catch (err) {
    console.error("Erro confirmar envio de conteúdo:", err);
  }
}

// ===========================
// CHAT — MODAL MÍDIA
// ===========================
function fecharModalMidia() {
  const modal  = document.getElementById("modalMidia");
  const video  = document.getElementById("modalVideo");
  const iframe = document.getElementById("modalIframe");

  if (video)  { video.pause(); video.src = ""; }
  if (iframe) { iframe.src = ""; }
  modal?.classList.add("hidden");
}

function abrirMidia(midia) {
  if (!midia) return;
  const src = midia.dataset.full || midia.dataset.thumb;
  if (!src) return;
  abrirModalMidia(src);
}

function abrirModalMidia(src) {
  const modal  = document.getElementById("modalMidia");
  const img    = document.getElementById("modalImg");
  const video  = document.getElementById("modalVideo");
  const iframe = document.getElementById("modalIframe");

  if (!modal || !src) return;
  modal.classList.remove("hidden");

  if (img)    { img.style.display    = "none"; img.src = ""; }
  if (video)  { video.pause(); video.removeAttribute("src"); video.load(); video.style.display  = "none"; }
  if (iframe) { iframe.src = ""; iframe.style.display = "none"; }

  if (src.includes("iframe.videodelivery.net")) {
    iframe.src = src; iframe.style.display = "block"; return;
  }
  if (src.includes(".mp4") || src.includes(".webm") || src.includes(".mov")) {
    video.src = src; video.style.display = "block"; video.play().catch(() => {}); return;
  }
  img.src = src; img.style.display = "block";
}

function abrirPreviewAvatar(url) {
  if (!url || typeof url !== "string") return;

  let modal = document.getElementById("avatarPreviewModal");

  if (!modal) {
    modal = document.createElement("div");
    modal.id        = "avatarPreviewModal";
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
      setTimeout(() => modal.remove(), 200);
      document.removeEventListener("keydown", escListener);
    };
    const escListener = e => { if (e.key === "Escape") fechar(); };
    modal.querySelector(".preview-backdrop").onclick = fechar;
    modal.querySelector(".preview-close").onclick    = fechar;
    document.addEventListener("keydown", escListener);
  }

  const img = modal.querySelector("#avatarPreviewImg");
  img.onerror = () => { console.warn("Erro avatar preview"); modal.remove(); };
  img.src = url;
  requestAnimationFrame(() => modal.classList.add("open"));
}

function abrirPreviewMidia({ url }) {
  if (!url) return;
  abrirModalMidia(url);
}

// ===========================
// CHAT — EXCLUIR PACOTE
// ===========================
async function excluirPacoteConteudo(messageId) {
  const id = Number(messageId);
  if (!Number.isInteger(id)) return;
  if (!confirm(t("chat.confirm_delete_package"))) return;

  const tk = localStorage.getItem("token");
  if (!tk) return;

  try {
    const res  = await fetch(`/api/chat/pacote/${id}`, {
      method: "DELETE",
      headers: { Authorization: "Bearer " + tk }
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { alert(data.error || t("chat.error_delete")); }
  } catch (err) {
    console.error(err);
    alert(t("chat.error_delete_package"));
  }
}

// ===========================
// CHAT — CONTEÚDOS VISTOS
// ===========================
async function carregarConteudosVistos(cid) {
  try {
    const tk  = localStorage.getItem("token");
    const res = await fetch(`/api/chat/conteudos-vistos/${cid}`, {
      headers: { Authorization: "Bearer " + tk }
    });
    if (!res.ok) return;
    const vistos = await res.json();
    window.conteudosVistosCliente = new Set(
      Array.isArray(vistos)
        ? vistos.map(id => Number(id)).filter(id => Number.isInteger(id))
        : []
    );
  } catch (err) {
    console.error("Erro carregar conteúdos vistos:", err);
  }
}

// ===========================
// CHAT — ANOTAÇÕES
// ===========================
async function carregarAnotacoesCliente(cid) {
  if (!cid) return;

  try {
    const res = await fetch(`/api/chat/cliente/${cid}/anotacoes`, {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) { console.warn("Erro ao carregar anotações"); return; }

    const data = await res.json();

    const resumoEl     = document.getElementById("chatClienteResumo");
    const inputResumo  = document.getElementById("inputResumoCliente");
    const textareaNota = document.getElementById("textareaNotaCliente");

    if (resumoEl) {
      resumoEl.innerText     = data?.resumo_curto || "";
      resumoEl.style.display = data?.resumo_curto ? "inline-flex" : "none";
    }
    if (inputResumo)  inputResumo.value  = data?.resumo_curto || "";
    if (textareaNota) textareaNota.value = data?.nota_privada  || "";

  } catch (err) {
    console.error("Erro carregarAnotacoesCliente:", err);
  }
}

async function salvarAnotacoesCliente() {
  if (!cliente_id) return;

  const inputResumo  = document.getElementById("inputResumoCliente");
  const textareaNota = document.getElementById("textareaNotaCliente");
  const resumo_curto = String(inputResumo?.value  || "").trim();
  const nota_privada = String(textareaNota?.value || "").trim();

  try {
    const res = await fetch(`/api/chat/cliente/${cliente_id}/anotacoes`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ resumo_curto, nota_privada })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) { alert(data.error || t("chat.error_save_notes")); return; }

    const resumoEl = document.getElementById("chatClienteResumo");
    if (resumoEl) {
      resumoEl.innerText     = data?.resumo_curto || "";
      resumoEl.style.display = data?.resumo_curto ? "inline-flex" : "none";
    }
    fecharPopupAnotacoesCliente();

  } catch (err) {
    console.error("Erro salvarAnotacoesCliente:", err);
    alert(t("chat.error_save_notes"));
  }
}

function abrirPopupAnotacoesCliente()  { document.getElementById("popupAnotacoesCliente")?.classList.remove("hidden"); }
function fecharPopupAnotacoesCliente() { document.getElementById("popupAnotacoesCliente")?.classList.add("hidden"); }

// ===========================
// CHAT — LAZY LOADING
// ===========================
function ativarLazyLoadingModelo(div) {
  div.querySelectorAll(".lazy-midia").forEach(el => {
    const thumb = el.dataset.thumb;
    if (!thumb) return;
    const img         = document.createElement("img");
    img.src           = thumb;
    img.loading       = "lazy";
    img.decoding      = "async";
    img.className     = "midia-thumb";
    img.style.pointerEvents = "none";
    el.innerHTML = "";
    el.appendChild(img);
  });
}

function ativarLazyPopup(container) {
  const items    = container.querySelectorAll(".lazy-popup");
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      const el    = entry.target;
      const thumb = el.dataset.thumb;
      if (!thumb) return;

      const img      = document.createElement("img");
      img.className  = "popup-thumb";
      img.loading    = "lazy";
      img.dataset.src = thumb;
      img.src        = "/assets/thumb-default.png";

      const placeholder = el.querySelector(".popup-placeholder");
      if (placeholder) placeholder.remove();
      el.appendChild(img);

      const imgObserver = new IntersectionObserver(entries2 => {
        entries2.forEach(e2 => {
          if (e2.isIntersecting) {
            const image = e2.target;
            if (image.dataset.src) { image.src = image.dataset.src; image.removeAttribute("data-src"); }
            imgObserver.unobserve(image);
          }
        });
      }, { rootMargin: "200px" });

      imgObserver.observe(img);
      observer.unobserve(el);
    });
  }, { rootMargin: "200px" });

  items.forEach(el => observer.observe(el));
}

// ===========================
// CHAT — HELPERS MSG
// ===========================
function ehMensagemConteudo(msg) {
  if (!msg) return false;
  const tipos = ["conteudo", "ppv", "conteudo_ppv", "midia_ppv", "pacote", "pacote_ppv"];
  if (tipos.includes(msg.tipo)) return true;
  if (Array.isArray(msg.midias) && msg.midias.length > 0) return true;
  return false;
}

function getQuantidadeMidias(msg) {
  if (msg?.quantidade != null) return Number(msg.quantidade) || 0;
  return Array.isArray(msg?.midias) ? msg.midias.length : 0;
}

function mensagemEstaBloqueada(msg) {
  if (role === "modelo") return false;
  return Number(msg.preco || 0) > 0 && !msg.liberado && !msg.visto;
}

// ===========================
// CHAT — LOGOUT
// ===========================
async function logout() {
  const tk = localStorage.getItem("token");
  if (tk) {
    try { await fetch("/api/logout", { method: "POST", headers: { Authorization: "Bearer " + tk } }); } catch (_) {}
  }
  localStorage.clear();
  location.href = "/index.html";
}

// ===========================
// SOM NOTIFICAÇÃO
// ===========================
function tocarSomNotificacao() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// ===========================
// CLICK LISTENERS (document-level, same as chat.js)
// ===========================
document.addEventListener("click", e => {
  const btn = e.target.closest(".msg-menu");
  if (!btn) return;
  const messageId = btn.dataset.id;
  const text      = decodeURIComponent(btn.dataset.text || "");
  const textarea  = document.getElementById("editarTexto");
  if (textarea) textarea.value = text;
  window.mensagemSelecionada = messageId;
  document.getElementById("menuMensagem")?.classList.remove("hidden");
});

document.addEventListener("click", e => {
  const midia = e.target.closest(".midia-item");
  if (!midia) return;
  const conteudo = midia.closest(".chat-conteudo");
  if (!conteudo) return;
  if (role === "modelo") { abrirMidia(midia); return; }
  const bloqueado = conteudo.classList.contains("bloqueado");
  const messageId = conteudo.dataset.id;
  if (bloqueado) { abrirPopupPagamento(messageId); return; }
  abrirMidia(midia);
});

// ===========================
// OVERRIDE — ícone inbox no header não deve sair da página agency
// irParaInbox() em header.js navega para /inbox.html; aqui sobrescreve
// ===========================
window.irParaInbox = function () {};

// ===========================
// INIT
// ===========================
document.addEventListener("DOMContentLoaded", async () => {
  try {
    // Fetch modelo info
    const res = await fetch("/api/modelo/me", {
      headers: { Authorization: "Bearer " + token }
    });
    if (!res.ok) { logout(); return; }

    const modelo = await res.json();
    modelo_id = modelo.modelo_id;

    if (!modelo_id) { logout(); return; }

    const inboxHeader = document.getElementById("agencyInboxHeader");
    if (inboxHeader && modelo.nome_exibicao) {
      inboxHeader.textContent = modelo.nome_exibicao;
    }

    // Chat input handlers
    document.getElementById("sendBtn")?.addEventListener("click", enviarMensagem);
    document.getElementById("msgInput")?.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviarMensagem(e); }
    });

    // Modal close on backdrop
    document.getElementById("modalMidia")?.addEventListener("click", e => {
      if (e.target.classList.contains("modal-backdrop")) fecharModalMidia();
    });

    // Anotações
    document.getElementById("btnAnotacoesCliente")?.addEventListener("click", abrirPopupAnotacoesCliente);
    document.getElementById("fecharPopupAnotacoes")?.addEventListener("click", fecharPopupAnotacoesCliente);
    document.getElementById("salvarAnotacoesCliente")?.addEventListener("click", salvarAnotacoesCliente);
    document.querySelector(".popup-anotacoes-backdrop")?.addEventListener("click", fecharPopupAnotacoesCliente);

    // Transações do cliente
    document.getElementById("btnTransacoesCliente")?.addEventListener("click", () => {
      if (!cliente_id) return;
      window.location.href = `/cliente-transacoes.html?cliente_id=${cliente_id}`;
    });

    // Inbox scroll infinito — usa o painel esquerdo, não o window
    inboxPanel?.addEventListener("scroll", () => {
      const near = inboxPanel.scrollHeight - inboxPanel.scrollTop - inboxPanel.clientHeight < 100;
      if (near) carregarListaClientes();
    });

    // Chat scroll para histórico
    chatBox?.addEventListener("scroll", () => {
      if (historicoInicialCarregado && chatBox.scrollTop <= 100 && !carregandoHistorico) {
        carregarMensagensAntigas();
      }
    });

    // Carregar inbox
    await carregarInboxInicial();

  } catch (err) {
    console.error("Erro init agency:", err);
  }
});
