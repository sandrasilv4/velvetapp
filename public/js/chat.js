// ===============================
// 🔐 AUTENTICAÇÃO
// ===============================

const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

const socket = io({
  transports: ["websocket", "polling"],
  auth: { token },
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000
});

window.socket = socket;

// ===============================
// VARIÁVEIS CHAT
// ===============================

let autenticado = false;
let salaPronta = false;

let cliente_id = null;
let modelo_id = null;

let offsetMensagens = 0;
const LIMIT_MENSAGENS = 20;

let carregandoHistorico = false;
let enviandoConteudo = false;
let historicoInicialCarregado = false;

const mensagensRenderizadas = new Set();

const chatBox = document.getElementById("chatBox");

let paginaConteudos = 1;
const limiteConteudos = 12;

let carregandoConteudos = false;
let fimConteudos = false;

// ===============================
// AUTENTICAR
// ===============================
socket.on("connect", async () => {
  autenticado = true;
  salaPronta = false;

  socket.emit("loginModelo");

  if (cliente_id) {
    await carregarInfoCliente(cliente_id);
  }

  tentarEntrarSala();
});

socket.on("connect_error", (err) => {
  autenticado = false;
  salaPronta = false;
  console.error("❌ connect_error socket:", err.message, err);
});



// ===============================
// ENTRAR NA SALA
function tentarEntrarSala(){

  if (!autenticado) return;
  if (!cliente_id || !modelo_id) return;
  if (salaPronta) return;

  salaPronta = true;

  socket.emit("joinChat",{
    cliente_id,
    modelo_id
  });

  socket.emit("getHistory",{
    cliente_id,
    modelo_id,
    offset: offsetMensagens,
    limit: LIMIT_MENSAGENS
  });

}

// ===============================
// DOM
// ===============================

document.addEventListener("DOMContentLoaded", async () => {
  try {
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

    const params = new URLSearchParams(location.search);
    cliente_id = Number(params.get("cliente_id"));

    if (!cliente_id) {
      alert(t("chat.invalid_client"));
      return;
    }

    const modal = document.getElementById("modalMidia");

    if (modal) {
      modal.addEventListener("click", function (e) {
        if (e.target.classList.contains("modal-backdrop")) {
          fecharModalMidia();
        }
      });
    }

    const sendBtn = document.getElementById("sendBtn");
    const msgInput = document.getElementById("msgInput");

    if (sendBtn) {
      sendBtn.addEventListener("click", enviarMensagem);
    }

    if (msgInput) {
      msgInput.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          enviarMensagem(e);
        }
      });
    }

    document.getElementById("btnAnotacoesCliente")?.addEventListener("click", abrirPopupAnotacoesCliente);
    document.getElementById("fecharPopupAnotacoes")?.addEventListener("click", fecharPopupAnotacoesCliente);
    document.getElementById("salvarAnotacoesCliente")?.addEventListener("click", salvarAnotacoesCliente);
    document.querySelector(".popup-anotacoes-backdrop")?.addEventListener("click", fecharPopupAnotacoesCliente);
    
    document.getElementById("btnTransacoesCliente")?.addEventListener("click", () => {
  if (!cliente_id) return;
  window.location.href = `/cliente-transacoes.html?cliente_id=${cliente_id}`;
    });
    
    await carregarInfoCliente(cliente_id);

    await marcarComoLido(cliente_id);

    tentarEntrarSala();

  } catch (err) {
    console.error("Erro DOMContentLoaded:", err);
  }
});

  // ===============================
  // SCROLL HISTÓRICO
  // ===============================
if (chatBox) {

  chatBox.addEventListener("scroll", () => {

    if (
      historicoInicialCarregado &&
      chatBox.scrollTop <= 100 &&
      !carregandoHistorico
    ) {
      carregarMensagensAntigas();
    }

  });

}

document.addEventListener("click", e => {

  const btn = e.target.closest(".msg-menu");
  if (!btn) return;

  const messageId = btn.dataset.id;
  const text = decodeURIComponent(btn.dataset.text || "");

  const textarea = document.getElementById("editarTexto");

  if (textarea) {
    textarea.value = text;
  }

  window.mensagemSelecionada = messageId;

  const menu = document.getElementById("menuMensagem");
  if (menu) menu.classList.remove("hidden");

 });

document.addEventListener("click", e => {
  const midia = e.target.closest(".midia-item");
  if (!midia) return;

  const conteudo = midia.closest(".chat-conteudo");
  if (!conteudo) return;

  if (role === "modelo") {
    abrirMidia(midia);
    return;
  }

  const bloqueado = conteudo.classList.contains("bloqueado");
  const messageId = conteudo.dataset.id;

  if (bloqueado) {
    abrirPopupPagamento(messageId);
    return;
  }

  abrirMidia(midia);
});


// ===============================
// HISTÓRICO
// ===============================

socket.on("chatHistory", mensagens => {

  if (!chatBox || !Array.isArray(mensagens)) return;

  const primeiraCarga = offsetMensagens === 0;

  if (primeiraCarga) {

    chatBox.innerHTML = "";
    mensagensRenderizadas.clear();

    mensagens.forEach(m => renderMensagem(m));

    // 🔧 esperar DOM + imagens renderizarem
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
  carregandoHistorico = false;

});

// ===============================
// NOVA MENSAGEM
// ===============================

socket.on("newMessage", msg => {

  if (
    Number(msg.modelo_id) !== Number(modelo_id) ||
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

// ===============================
// ENVIAR MENSAGEM
// ===============================
function enviarMensagem(e){

  if(e) e.preventDefault();

  const campo = document.getElementById("msgInput");
  if(!campo) return;

  const text = campo.value.trim();
  if(!text) return;

  if(!socket.connected){
    alert(t("chat.connection_lost"));
    return;
  }

  const tempId = "temp-" + Date.now();

  renderMensagem({
    id: tempId,
    sender:"modelo",
    text,
    created_at:Date.now()
  });

  scrollParaFinal();

  socket.emit(
    "sendMessage",
    {
      cliente_id,
      modelo_id,
      text,
      tempId
    },
    resposta => {

      if(!resposta?.ok) return;

      const el = document.querySelector(`[data-id="${tempId}"]`);
      if(el) el.dataset.id = resposta.message_id;

       localStorage.removeItem(`inbox_modelo_lido_${cliente_id}`);

    }
  );

  campo.value = "";

}

// ===============================
// SCROLL
// ===============================

function scrollParaFinal(){
  if(!chatBox) return;

  requestAnimationFrame(()=>{
    chatBox.scrollTop = chatBox.scrollHeight;
  });
}
// ===============================
// CARREGAR MENSAGENS ANTIGAS
// ===============================

function carregarMensagensAntigas(){

  if(carregandoHistorico) return;

  carregandoHistorico = true;

  socket.emit("getHistory",{
    cliente_id,
    modelo_id,
    offset: offsetMensagens,
    limit: LIMIT_MENSAGENS
  });
}

// ===============================
// EDIÇÃO
// ===============================

socket.on("mensagemEditada", ({ id, text }) => {

  const msgEl = document.querySelector(`.msg[data-id="${id}"]`);

  if (!msgEl) return;

  const textoDiv = msgEl.querySelector(".msg-texto");

  if (textoDiv) textoDiv.innerText = text;

});

// ===============================
// EXCLUSÃO
// ===============================
socket.on("mensagemExcluida", ({ id }) => {

  const msgEl = document.querySelector(`.msg[data-id="${id}"]`);

  if (msgEl) msgEl.remove();

});

// ===============================
// CONTEÚDO VENDIDO
// ===============================
// 🔔 Atualiza a mensagem de conteúdo quando cliente já viu
socket.on("conteudoVisto", ({ message_id, conteudo_ids }) => {

  if (!message_id) return;

  const el = document.querySelector(
    `.chat-conteudo[data-id="${message_id}"]`
  );

  if (el) {
    el.classList.remove("bloqueado");
    el.classList.add("visto");

    const status = el.querySelector(".status-bloqueado");
    if (status) status.innerText = t("chat.content_viewed");
  }

  // 🔒 Atualiza lista local para bloquear no popup
  if (Array.isArray(conteudo_ids)) {
    conteudo_ids.forEach(id => {
      window.conteudosVistosCliente.add(Number(id));
    });
  }

});

// ===============================
// FORMATAR HORA
// ===============================
function formatarTempo(timestamp) {
  if (!timestamp || timestamp === "0") return t("chat.time_now");

  // aceita número OU string ISO
  const time =
    typeof timestamp === "number"
      ? timestamp
      : new Date(timestamp).getTime();

  if (isNaN(time)) return t("chat.time_now");

  const diff = Date.now() - time;

  const min = Math.floor(diff / 60000);
  const h   = Math.floor(diff / 3600000);
  const d   = Math.floor(diff / 86400000);

  if (min < 1) return t("chat.time_now");
  if (min < 60) return t("chat.time_minutes").replace("{n}", min);
  if (h < 24) return t("chat.time_hours").replace("{n}", h);
  if (d === 1) return t("chat.time_yesterday");
  return t("chat.time_days").replace("{n}", d);
}

// ===============================
// RENDER MENSAGEM
// ===============================

function renderMensagem(msg) {
  if (!chatBox) return;

  if (mensagensRenderizadas.has(msg.id)) return;
  mensagensRenderizadas.add(msg.id);

  const div = document.createElement("div");

  div.className =
    msg.sender === "modelo"
      ? "msg msg-modelo"
      : "msg msg-cliente";

  div.dataset.id = msg.id;

 if (ehMensagemConteudo(msg)) {
  const quantidade = getQuantidadeMidias(msg);
  const bloqueado = mensagemEstaBloqueada(msg);
  const foiVisto = !!(msg.visto || msg.liberado);

  let estadoClasse = "";
  if (bloqueado) {
    estadoClasse = "bloqueado";
  } else if (foiVisto) {
    estadoClasse = "visto";
  } else {
    estadoClasse = "livre";
  }

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
          ${bloqueado
            ? `🔒${quantidade} mídia(s)`
            : foiVisto
              ? `🟢${quantidade} mídia(s)`
              : `📩${quantidade} mídia(s)`}
        </span>

        <span class="meta-valor">
          R$ ${Number(msg.preco || 0).toFixed(2)}
        </span>

        <span class="msg-hora">
          ${formatarTempo(msg.created_at)}

          ${msg.sender === "modelo" && !msg.liberado ? `
            <button
              class="btn-excluir-pacote"
              data-id="${msg.id}">
              ⋮
            </button>
          ` : ""}
        </span>
      </div>
    </div>
  `;

    const btnConteudo = div.querySelector(".btn-excluir-pacote");

    if (btnConteudo) {
      btnConteudo.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();

        const btn = e.currentTarget;

        console.log("[btn-excluir-pacote click]", {
          messageId: btn.dataset.id,
          socketConnected: !!socket?.connected,
          cliente_id,
          modelo_id,
        });

        excluirPacoteConteudo(btn.dataset.id);
      });
    }

    ativarLazyLoadingModelo(div, msg, bloqueado);

    div.querySelectorAll(".midia-item").forEach(el => {
      el.addEventListener("click", (e) => {
        console.log("[midia-item click]", {
          target: e.target,
          el,
          idMsg: msg.id,
          bloqueado,
          full: el.dataset.full,
          thumb: el.dataset.thumb,
          index: el.dataset.index,
        });

        if (role === "modelo") {
          abrirMidia(el);
          return;
        }

        if (bloqueado) {
          abrirPopupPagamento(msg.id);
          return;
        }

        abrirMidia(el);
      });
    });

  } else {
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

      <span class="msg-hora">${formatarTempo(msg.created_at)}</span>
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

  chatBox.appendChild(div);
}

async function carregarInfoCliente(cliente_id) {
  if (!cliente_id) return;

  try {
    const res = await fetch(`/api/chat/cliente/${cliente_id}`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.warn("Erro ao carregar cliente");
      return;
    }

    const cliente = await res.json();

    const nome = document.getElementById("chatClienteNome");
    const avatar = document.getElementById("chatClienteAvatar");
    const status = document.getElementById("chatClienteStatus");

    if (nome) {
      nome.innerText = cliente.nome || t("chat.client_name_placeholder");
    }

    const avatarUrl = cliente.avatar || "/assets/avatar.png";

    if (avatar) {
      avatar.src = avatarUrl;
      avatar.style.cursor = "pointer";

      avatar.onclick = () => {
        abrirPreviewAvatar(avatarUrl);
      };
    }

    if (status) {
      if (cliente.last_seen) {
        status.innerText = t("chat.last_seen").replace("{time}", formatarTempo(cliente.last_seen));
      } else {
        status.innerText = t("chat.last_seen").replace("{time}", t("chat.time_now"));
      }
    }

    await carregarAnotacoesCliente(cliente_id);

  } catch (err) {
    console.error("Erro carregarInfoCliente:", err);
  }
}

function fecharMenuMensagem(){
  const menu = document.getElementById("menuMensagem");
  if(menu) menu.classList.add("hidden");
}

function salvarEdicao(){

  const text = document.getElementById("editarTexto").value.trim();

  if(!text || !window.mensagemSelecionada) return;

  socket.emit("editarMensagem",{
    id: window.mensagemSelecionada,
    text
  });

  fecharMenuMensagem();
}

function excluirMensagem(){

  if(!window.mensagemSelecionada) return;

  socket.emit("excluirMensagem",{
    id: window.mensagemSelecionada
  });

  fecharMenuMensagem();
}

// ===============================
// POPUP ENVIAR CONTEÚDO
// ===============================

async function abrirPopupConteudos() {
  try {

    // 🔒 validar IDs
    if (!Number.isInteger(cliente_id) || !Number.isInteger(modelo_id)) {
      console.warn("IDs inválidos para abrir popup.");
      return;
    }

    const popup = document.getElementById("popupConteudos");
    const grid  = document.getElementById("previewConteudos");

    if (!popup || !grid) return;

    popup.classList.remove("hidden");
    grid.innerHTML = `<div class="popup-loading">${t("chat.loading")}</div>`;

   if (!window.conteudosVistosCliente) {
      window.conteudosVistosCliente = new Set();
    }

    await carregarConteudosVistos(cliente_id);

    const token = localStorage.getItem("token");

    if (!token) {
      grid.innerHTML = t("chat.session_expired");
      return;
    }

    const res = await fetch("/api/conteudos?limit=1000", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      grid.innerHTML = t("chat.error_load_content");
      return;
    }

    const data = await res.json();
    const conteudos = Array.isArray(data) ? data : data.conteudos;

    if (!Array.isArray(conteudos) || conteudos.length === 0) {
      grid.innerHTML = `<p>${t("chat.no_content")}</p>`;
      return;
    }

    grid.innerHTML = "";

    conteudos.forEach(c => {

      if (!c?.id || !c?.url) return;

      const id = Number(c.id);
      const tipo = c.tipo || "imagem";

      const jaVisto = window.conteudosVistosCliente.has(Number(c.id));

      const item = document.createElement("div");

      item.className =
        "preview-item lazy-popup" +
        (jaVisto ? " visto desabilitado" : "");

      item.dataset.conteudoId = c.id;
      let thumb = c.thumbnail_url;

if (!thumb) {

  if (c.tipo === "video") {

    if (c.url.includes("videodelivery.net")) {
      thumb = c.url.replace("iframe.videodelivery.net", "videodelivery.net") + "/thumbnails/thumbnail.jpg";
    } else {
      thumb = "/assets/video-thumb.jpg"; // fallback
    }

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
          alert(t("chat.content_already_seen"));
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

  document
    .querySelectorAll(".preview-item.selected")
    .forEach(el => el.classList.remove("selected"));

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

    const selecionados = [
      ...document.querySelectorAll(".preview-item.selected")
    ];

    if (!selecionados.length) {
      alert(t("chat.select_at_least_one"));
      return;
    }

    const conteudos_ids = selecionados
      .map(item => Number(item.dataset.conteudoId || 0))
      .filter(id => Number.isInteger(id) && id > 0);

    if (!conteudos_ids.length) {
      alert(t("chat.invalid_content"));
      return;
    }

    let preco = Number(document.getElementById("precoConteudo")?.value || 0);
    if (!Number.isFinite(preco) || preco < 0) preco = 0;
    preco = Number(preco.toFixed(2));

    if (!socket || !socket.connected) {
      console.error("Socket não conectado!");
      return;
    }

    socket.emit("sendConteudo", {
      cliente_id,
      modelo_id,
      conteudos_ids,
      preco
    });

    fecharPopupConteudos();

  } catch (err) {
    console.error("Erro confirmar envio de conteúdo:", err);
  }
}

function fecharModalMidia(){

  const modal  = document.getElementById("modalMidia");
  const video  = document.getElementById("modalVideo");
  const iframe = document.getElementById("modalIframe");

  if(video){
    video.pause();
    video.src = "";
  }

  if(iframe){
    iframe.src = "";
  }

  modal.classList.add("hidden");
}

function abrirMidia(midia){

  if (!midia) return;

  const src = midia.dataset.full || midia.dataset.thumb;
  if (!src) return;

  const isVideo =
    src.includes(".mp4") ||
    src.includes(".webm") ||
    src.includes(".mov") ||
    src.includes(".m3u8") ||
    src.includes("videodelivery.net");

  abrirModalMidia(src, isVideo);
}


function abrirModalMidia(src){

  const modal  = document.getElementById("modalMidia");
  const img    = document.getElementById("modalImg");
  const video  = document.getElementById("modalVideo");
  const iframe = document.getElementById("modalIframe");

  if(!modal || !src) return;

  modal.classList.remove("hidden");

  /* reset */
  if(img){
    img.style.display = "none";
    img.src = "";
  }

  if(video){
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.style.display = "none";
  }

  if(iframe){
    iframe.src = "";
    iframe.style.display = "none";
  }

  /* CLOUDFlARE STREAM */
  if(src.includes("iframe.videodelivery.net")){

    iframe.src = src;
    iframe.style.display = "block";
    return;
  }

  /* VIDEO NORMAL */
  if(
    src.includes(".mp4") ||
    src.includes(".webm") ||
    src.includes(".mov")
  ){
    video.src = src;
    video.style.display = "block";
    video.play().catch(()=>{});
    return;
  }

  /* IMAGEM */
  img.src = src;
  img.style.display = "block";
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

async function marcarComoLido(cliente_id) {
  if (!cliente_id) return;

  try {
    const res = await fetch(`/api/chat/modelo/marcar-lido/${cliente_id}`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.warn("Não foi possível marcar como lido");
      return;
    }

  } catch (err) {
    console.error("Erro marcar como lido:", err);
  }
}

function ativarLazyLoadingModelo(div){

  const midias = div.querySelectorAll(".lazy-midia");

  midias.forEach(el => {

    const thumb = el.dataset.thumb;
    if(!thumb) return;

    const img = document.createElement("img");

    img.src = thumb;
    img.loading = "lazy";
    img.decoding = "async";
    img.className = "midia-thumb";
    img.style.pointerEvents = "none";

    el.innerHTML = "";
    el.appendChild(img);

  });

}

function abrirMenuMensagem(id, text){

  window.mensagemSelecionada = id;

  const textarea = document.getElementById("editarTexto");
  if (textarea) textarea.value = text || "";

  const menu = document.getElementById("menuMensagem");
  if (menu) menu.classList.remove("hidden");

}


async function carregarConteudosVistos(cliente_id) {

  try {

    const token = localStorage.getItem("token");

    const res = await fetch(`/api/chat/conteudos-vistos/${cliente_id}`, {
      headers: {
        Authorization: "Bearer " + token
      }
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

function formatarHora(data) {
  if (!data) return "";

  const d = new Date(data);
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function abrirPreviewMidia({ url }) {

  if (!url) return;

  abrirModalMidia(url);

}

async function excluirPacoteConteudo(messageId){

  const id = Number(messageId);
  if(!Number.isInteger(id)) return;

  if(!confirm(t("chat.confirm_delete_package"))) return;

  const token = localStorage.getItem("token");
  if(!token) return;

  try{

    const res = await fetch(`/api/chat/pacote/${id}`,{
      method:"DELETE",
      headers:{
        Authorization:"Bearer " + token
      }
    });

    const data = await res.json().catch(()=>({}));

    if(!res.ok){
      alert(data.error || t("chat.error_delete"));
      return;
    }

    // ❌ NÃO remove aqui
    // o socket fará isso para todos

  }catch(err){
    console.error(err);
    alert(t("chat.error_delete_package"));
  }

}

function ativarLazyPopup(container){

  const items = container.querySelectorAll(".lazy-popup");

  const observer = new IntersectionObserver((entries)=>{

    entries.forEach(entry=>{

      if(!entry.isIntersecting) return;

      const el = entry.target;
      const thumb = el.dataset.thumb;

      if(!thumb) return;

      const img = document.createElement("img");

      img.className = "popup-thumb";
      img.loading = "lazy";

      // lazy igual à página conteúdos
      img.dataset.src = thumb;
      img.src = "/assets/thumb-default.png";

      const placeholder = el.querySelector(".popup-placeholder");
      if(placeholder) placeholder.remove();

      el.appendChild(img);

      // quando imagem entrar no viewport
      const imgObserver = new IntersectionObserver((entries2)=>{

        entries2.forEach(entry2=>{

          if(entry2.isIntersecting){

            const image = entry2.target;

            const src = image.dataset.src;

            if(src){
              image.src = src;
              image.removeAttribute("data-src");
            }

            imgObserver.unobserve(image);

          }

        });

      },{
        rootMargin:"200px"
      });

      imgObserver.observe(img);

      observer.unobserve(el);

    });

  },{
    rootMargin:"200px"
  });

  items.forEach(el=>observer.observe(el));

}

function criarMensagemElemento(msg) {
  const div = document.createElement("div");

  div.className =
    msg.sender === "modelo"
      ? "msg msg-modelo"
      : "msg msg-cliente";

  div.dataset.id = msg.id;

  if (ehMensagemConteudo(msg)) {
    const quantidade = getQuantidadeMidias(msg);
    const bloqueado = mensagemEstaBloqueada(msg);
    const foiVisto = !!(msg.visto || msg.liberado);

    let estadoClasse = "";
    if (bloqueado) {
      estadoClasse = "bloqueado";
    } else if (foiVisto) {
      estadoClasse = "visto";
    } else {
      estadoClasse = "livre";
    }

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
            ${bloqueado
              ? `🔒${quantidade} mídia(s)`
              : foiVisto
                ? `🟢${quantidade} mídia(s)`
                : `📩${quantidade} mídia(s)`}
          </span>

          <span class="meta-valor">
            R$ ${Number(msg.preco || 0).toFixed(2)}
          </span>

          <span class="msg-hora">
            ${formatarTempo(msg.created_at)}

            ${msg.sender === "modelo" && !msg.liberado ? `
              <button
                class="btn-excluir-pacote"
                data-id="${msg.id}">
                ⋮
              </button>
            ` : ""}
          </span>
        </div>
      </div>
    `;

    ativarLazyLoadingModelo(div);

    const btnConteudo = div.querySelector(".btn-excluir-pacote");
    if (btnConteudo) {
      btnConteudo.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        excluirPacoteConteudo(btnConteudo.dataset.id);
      });
    }

    div.querySelectorAll(".midia-item").forEach(el => {
      el.addEventListener("click", () => {
        if (role === "modelo") {
          abrirMidia(el);
          return;
        }

        if (mensagemEstaBloqueada(msg)) {
          abrirPopupPagamento(msg.id);
          return;
        }

        abrirMidia(el);
      });
    });

  } else {
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

      <span class="msg-hora">${formatarTempo(msg.created_at)}</span>
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

  return div;
}

function ehMensagemConteudo(msg) {
  if (!msg) return false;

  // aceita tipos antigos e novos
  const tiposConteudo = [
    "conteudo",
    "ppv",
    "conteudo_ppv",
    "midia_ppv",
    "pacote",
    "pacote_ppv"
  ];

  if (tiposConteudo.includes(msg.tipo)) return true;

  // fallback: se vier com mídias, também trata como conteúdo
  if (Array.isArray(msg.midias) && msg.midias.length > 0) return true;

  return false;
}

function getQuantidadeMidias(msg) {
  if (msg?.quantidade != null) return Number(msg.quantidade) || 0;
  return Array.isArray(msg?.midias) ? msg.midias.length : 0;
}

function mensagemEstaBloqueada(msg) {
  // modelo nunca deve ficar bloqueada no próprio chat
  if (role === "modelo") return false;

  return Number(msg.preco || 0) > 0 && !msg.liberado && !msg.visto;
}

function aplicarEstadoLocalInboxModelo(chat) {
  if (!chat) return chat;

  const foiLidoNoChat =
    localStorage.getItem(`inbox_modelo_lido_${chat.cliente_id}`) === "1";

  if (
    foiLidoNoChat &&
    chat.ultimo_sender === "cliente"
  ) {
    return {
      ...chat,
      lida: true
    };
  }

  return chat;
}

async function carregarAnotacoesCliente(cliente_id) {
  if (!cliente_id) return;

  try {
    const res = await fetch(`/api/chat/cliente/${cliente_id}/anotacoes`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.warn("Erro ao carregar anotações do cliente");
      return;
    }

    const data = await res.json();

    const resumoEl = document.getElementById("chatClienteResumo");
    const inputResumo = document.getElementById("inputResumoCliente");
    const textareaNota = document.getElementById("textareaNotaCliente");

    if (resumoEl) {
      resumoEl.innerText = data?.resumo_curto || "";
      resumoEl.style.display = data?.resumo_curto ? "inline-flex" : "none";
    }

    if (inputResumo) inputResumo.value = data?.resumo_curto || "";
    if (textareaNota) textareaNota.value = data?.nota_privada || "";

  } catch (err) {
    console.error("Erro carregarAnotacoesCliente:", err);
  }
}

async function salvarAnotacoesCliente() {
  if (!cliente_id) return;

  const inputResumo = document.getElementById("inputResumoCliente");
  const textareaNota = document.getElementById("textareaNotaCliente");

  const resumo_curto = String(inputResumo?.value || "").trim();
  const nota_privada = String(textareaNota?.value || "").trim();

  try {
    const res = await fetch(`/api/chat/cliente/${cliente_id}/anotacoes`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({
        resumo_curto,
        nota_privada
      })
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      alert(data.error || t("chat.error_save_notes"));
      return;
    }

    const resumoEl = document.getElementById("chatClienteResumo");
    if (resumoEl) {
      resumoEl.innerText = data?.resumo_curto || "";
      resumoEl.style.display = data?.resumo_curto ? "inline-flex" : "none";
    }

    fecharPopupAnotacoesCliente();

  } catch (err) {
    console.error("Erro salvarAnotacoesCliente:", err);
    alert(t("chat.error_save_notes"));
  }
}

function abrirPopupAnotacoesCliente() {
  document.getElementById("popupAnotacoesCliente")?.classList.remove("hidden");
}

function fecharPopupAnotacoesCliente() {
  document.getElementById("popupAnotacoesCliente")?.classList.add("hidden");
}

// apenas log
socket.on("disconnect", reason => {
  console.warn("🔴 Socket desconectado:", reason);

});