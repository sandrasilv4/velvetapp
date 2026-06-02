(() => {
  // ===============================
  // CONTEXTO / SESSÃO
  // ===============================
  const token = localStorage.getItem("token");
  const role  = localStorage.getItem("role");

  if (!token || !role) {
    window.location.href = "/index.html";
    return;
  }

  document.addEventListener("DOMContentLoaded", () => {
    carregarConversas();
  });

  // ===============================
  // CARREGAR CONVERSAS
  // ===============================
  async function carregarConversas() {
    const url =
      role === "modelo"
        ? "/api/chat/modelo"
        : "/api/chat/cliente";

    const res = await fetch(url, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.error("Erro ao carregar conversas");
      return;
    }

    const conversas = await res.json();

    const lista = document.querySelector(".lista-conversas");
    lista.innerHTML = "";

    // 🔥 usa VIP + histórico (SEM normalizar nada)
    const filtradas = conversas.filter(c =>
      c.vip === true ||
      c.ultima_msg_modelo_ts ||
      c.ultima_msg_cliente_ts
    );

    if (!filtradas.length) {
      lista.innerHTML =
        "<p style='padding:16px'>Nenhum assinante ainda</p>";
      return;
    }

    filtradas.forEach(c => {
      const item = criarItemConversa(c);
      lista.appendChild(item);
    });

    organizarLista(lista);
  }

  // ===============================
  // CRIAR ITEM
  // ===============================
  function criarItemConversa(c) {
    const div = document.createElement("div");
    div.className = "chat-item";

    // 🔥 status vindo do backend
    div.dataset.status = c.status || "normal";

    // ⏱ tempo da última interação
    const lastTime =
      c.ultima_msg_modelo_ts ||
      c.ultima_msg_cliente_ts;

    div.dataset.lastTime = lastTime
      ? new Date(lastTime).getTime()
      : 0;

    const nome = c.nome || c.username || "Cliente";
    const avatar = c.avatar || "/assets/avatarDefault.png";

    // preview inteligente
    const preview =
      c.ultima_msg_texto ||
      (c.vip ? "Novo assinante VIP 💜" : "Toque para abrir o chat");

    div.innerHTML = `
      <img class="avatar" src="${avatar}" />

      <div class="info">
        <div class="linha-topo">
          <strong>${nome}</strong>
          <span class="hora">${formatarTempo(div.dataset.lastTime)}</span>
        </div>

        <div class="preview">
          ${preview}
        </div>
      </div>

      ${renderBadge(div.dataset.status)}
    `;

    // 🖱️ abrir chat (próximo passo)
    div.onclick = () => abrirChat(c);

    return div;
  }

  // ===============================
  // BADGE
  // ===============================
  function renderBadge(status) {
    if (status === "nao-visto") return `<span class="badge">Não lida</span>`;
    if (status === "por-responder") return `<span class="badge">Responder</span>`;
    if (status === "novo") return `<span class="badge">Novo</span>`;
    return "";
  }

  // ===============================
  // ORDENAR LISTA
  // ===============================
  function organizarLista(lista) {
    const itens = [...lista.querySelectorAll(".chat-item")];

    const prioridade = {
      novo: 0,
      "nao-visto": 1,
      "por-responder": 2,
      normal: 3
    };

    itens.sort((a, b) => {
      const pa = prioridade[a.dataset.status] ?? 3;
      const pb = prioridade[b.dataset.status] ?? 3;
      if (pa !== pb) return pa - pb;

      return Number(b.dataset.lastTime) - Number(a.dataset.lastTime);
    });

    itens.forEach(i => lista.appendChild(i));
  }

  // ===============================
  // TEMPO
  // ===============================
  function formatarTempo(ts) {
    if (!ts || ts === 0) return "";

    const diff = Date.now() - ts;
    const min = Math.floor(diff / 60000);
    const h   = Math.floor(diff / 3600000);
    const d   = Math.floor(diff / 86400000);

    if (min < 1) return "agora";
    if (min < 60) return `${min} min`;
    if (h < 24) return `${h} h`;
    if (d === 1) return "ontem";
    return `${d} dias`;
  }

  // ===============================
  // ABRIR CHAT 
  // ===============================
function abrirChat(c) {
  if (!c || !c.cliente_id) {
    console.error("Cliente inválido:", c);
    return;
  }

  // 🔑 guarda o cliente ativo para o chatmodelo
  localStorage.setItem("chat_cliente_ativo", c.cliente_id);

  // opcional: guarda nome (UX)
  if (c.nome || c.username) {
    localStorage.setItem(
      "chat_cliente_nome",
      c.nome || c.username
    );
  }

  // 🔁 abre o chat real
  window.location.href = "/paginaChat.html";
}


})();
