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

const conteudosLiberados = new Set();
let chatPagamentoAtual = null;
let chatPagamentoEmProcesso = false;

const PAGARME_PUBLIC_KEY = "pk_oQW43ZaU7HPVnbj8";
// const stripe = Stripe("pk_live_51Spb5lRtYLPrY4c3L6pxRlmkDK6E0OSU93T5B75V4pY39rJ3FVyPEa6ZDDgqUiY1XCCEay6uQcItbZY4EcAOkoJn00TtsQ8bbz");

// // ===============================
// // SOCKET
// ===============================

socket.on("connect", async () => {
  autenticado = true;
  salaPronta = false;

  socket.emit("loginCliente");

  if (modelo_id) {
    await carregarInfoModelo(modelo_id);
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
// ===============================

function tentarEntrarSala() {

  if (!autenticado) return;
  if (!cliente_id || !modelo_id) return;
  if (salaPronta) return;

  salaPronta = true;

  socket.emit("joinChat", {
    cliente_id,
    modelo_id
  });

  socket.emit("getHistory", {
    cliente_id,
    modelo_id,
    offset: offsetMensagens,
    limit: LIMIT_MENSAGENS
  });

}

// ===============================
// DOM READY
// ===============================

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const res = await fetch("/api/cliente/me", {
      headers: { Authorization: "Bearer " + token }
    });

    if (!res.ok) {
      console.error("Erro ao buscar cliente");
      return;
    }

    const cliente = await res.json();
    cliente_id = cliente.cliente_id;

    if (!cliente_id) {
      console.error("cliente_id indefinido");
      return;
    }

    const params = new URLSearchParams(window.location.search);
    modelo_id = Number(params.get("modelo_id"));

    if (!modelo_id) {
      alert(t("chatc.invalid_model"));
      return;
    }

    // 🔒 Verificar VIP ativo antes de permitir o chat
    const vipRes = await fetch(`/api/vip/status/${modelo_id}`, {
      headers: { Authorization: "Bearer " + token }
    });
    if (vipRes.ok) {
      const vipData = await vipRes.json();
      if (!vipData.vip) {
        bloquearChatSemVip(modelo_id);
        return;
      }
    }

    await carregarInfoModelo(modelo_id);
    tentarEntrarSala();

    const sendBtn = document.getElementById("sendBtn");
    const input = document.getElementById("msgInput");

    if (sendBtn) {
      sendBtn.addEventListener("click", enviarMensagem);
    }

    if (input) {
      input.addEventListener("keydown", e => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          enviarMensagem();
        }
      });
    }

if (typeof bindFormularioStripePagamento === "function") {
  bindFormularioStripePagamento();
}

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

// 👇 EVENTO GLOBAL DE CLIQUE (CAPTURE)
document.addEventListener(
  "click",
  (e) => {
    const card = e.target.closest(".chat-conteudo");
    if (!card) return;

    const grid = e.target.closest(".pacote-grid");
    if (!grid) return;

    const preco = Number(card.dataset.preco || 0);
    const messageId = Number(card.dataset.id || 0);
    const todasMidias = [...grid.querySelectorAll(".midia-item[data-index]")];

    if (!todasMidias.length) return;

    const pacoteTotalmenteLiberado =
      preco === 0 ||
      card.classList.contains("livre") ||
      conteudosLiberados.has(messageId) ||
      todasMidias.every(
        (m) =>
          m.classList.contains("midia-livre") ||
          m.dataset.liberado === "true"
      );

    // se NÃO estiver 100% liberado, qualquer clique no pacote abre pagamento
    if (preco > 0 && !pacoteTotalmenteLiberado) {
      e.preventDefault();
      e.stopPropagation();
      abrirPagamentoChat(preco, messageId);
      return;
    }

    // daqui para baixo: pacote 100% liberado
    e.preventDefault();
    e.stopPropagation();

    // tenta primeiro pelo elemento
    let midiaClicada = e.target.closest(".midia-item[data-index]");

    // fallback: identifica pela posição do clique
 if (!midiaClicada) {
      const x = e.clientX;
      const y = e.clientY;

      midiaClicada = todasMidias.find((m) => {
        const r = m.getBoundingClientRect();
        const margem = 8; // tolerância pequena
        return (
          x >= r.left - margem &&
          x <= r.right + margem &&
          y >= r.top - margem &&
          y <= r.bottom + margem
        );
      });
    }
    
    if (!midiaClicada) {
      const gridRect = grid.getBoundingClientRect();
      const x = e.clientX;
      const y = e.clientY;

      const clicouDentroDoGrid =
        x >= gridRect.left &&
        x <= gridRect.right &&
        y >= gridRect.top &&
        y <= gridRect.bottom;

      if (clicouDentroDoGrid) {
        let menorDistancia = Infinity;

        todasMidias.forEach((m) => {
          const r = m.getBoundingClientRect();
          const cx = r.left + r.width / 2;
          const cy = r.top + r.height / 2;
          const distancia = Math.hypot(x - cx, y - cy);

          if (distancia < menorDistancia) {
            menorDistancia = distancia;
            midiaClicada = m;
          }
        });
      }
    }
    if (!midiaClicada) return;

    const index = Number(midiaClicada.dataset.index || 0);
    abrirConteudo(messageId, index);
  },
  true
);
    

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
    alert(t("chatc.connection_lost"));
    return;
  }

  const tempId = "temp-" + Date.now();

  renderMensagem({
    id: tempId,
    sender:"cliente",
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
// CARREGAR HISTÓRICO ANTIGO
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

socket.on("conteudoVisto", async ({ message_id, cliente_id: cid }) => {
  console.log("📩 conteudoVisto recebido:", { message_id, cid, cliente_id });

  if (!message_id) return;
  if (cid != null && Number(cid) !== Number(cliente_id)) return;

  const el = document.querySelector(`.chat-conteudo[data-id="${message_id}"]`);
  if (!el) return;

  try {
    const res = await fetch(`/api/chat/conteudo/${message_id}`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) return;

    const midias = await res.json();

    const todasLiberadas = midias.every(m => m.liberado !== false);

    el.classList.remove("bloqueado");

    if (todasLiberadas) {
      el.classList.add("livre");
      conteudosLiberados.add(Number(message_id));
    }

    el.innerHTML = `
      <div class="pacote-grid">
        ${midias.map((m, index) => {
          const liberado = m.liberado !== false;

          return `
            <div class="midia-item ${liberado ? "midia-livre" : "midia-bloqueada"}"
                 data-index="${index}"
                 data-liberado="${liberado ? "true" : "false"}">
              ${
                liberado
                  ? (
                      m.tipo_media === "video"
                        ? `<video src="${m.url}" muted playsinline></video>`
                        : `<img src="${m.url}">`
                    )
                  : `
                    <div class="midia-preview" style="background-image:url('${m.thumbnail_url || m.url}')"></div>
                  `
              }
            </div>
          `;
        }).join("")}
      </div>
    `;
  } catch (err) {
    console.error("Erro liberar conteúdo:", err);
  }
});


// ===============================
// FORMATAR HORA
// ===============================
function formatarTempo(timestamp) {
  if (!timestamp || timestamp === "0") return t("chatc.time_now");

  // aceita número OU string ISO
  const time =
    typeof timestamp === "number"
      ? timestamp
      : new Date(timestamp).getTime();

  if (isNaN(time)) return t("chatc.time_now");

  const diff = Date.now() - time;

  const min = Math.floor(diff / 60000);
  const h   = Math.floor(diff / 3600000);
  const d   = Math.floor(diff / 86400000);

  if (min < 1) return t("chatc.time_now");
  if (min < 60) return t("chatc.time_minutes").replace("{n}", min);
  if (h < 24) return t("chatc.time_hours").replace("{n}", h);
  if (d === 1) return t("chatc.time_yesterday");
  return t("chatc.time_days").replace("{n}", d);
}


// ===============================
// RENDER MENSAGEM
// ===============================

function renderMensagem(msg){

  if (!chatBox) return;

  // evitar duplicação
  if (mensagensRenderizadas.has(msg.id)) return;
  mensagensRenderizadas.add(msg.id);

  const div = document.createElement("div");

  div.className =
    msg.sender === "modelo"
      ? "msg msg-modelo"
      : "msg msg-cliente";

  div.dataset.id = msg.id;

  // ===============================
  // 📦 MENSAGEM DE CONTEÚDO
  // ===============================
if (msg.tipo === "conteudo" || msg.tipo === "conteudo_ppv_mass") {
  const quantidade =
    msg.quantidade ?? (msg.midias?.length || 0);

const cardLiberado =
  Number(msg.preco) === 0 ||
  msg.liberado === true;

 div.innerHTML = `
  <div class="msg-conteudo-wrap ${
        msg.sender === "modelo" ? "lado-modelo" : "lado-cliente"
  }">

<div class="chat-conteudo premium ${
  cardLiberado ? "visto" : (msg.preco > 0 ? "bloqueado" : "")
}" data-id="${msg.id}" data-preco="${msg.preco || 0}">

  <div class="pacote-grid">
    ${(msg.midias || []).map((m, index) => {
      const midiaLiberada =
        Number(msg.preco) === 0 ||
        m.liberado === true ||
        cardLiberado;

      return `
 <div class="midia-item lazy-midia ${
          midiaLiberada ? "midia-livre" : "midia-bloqueada"
        }"
          data-thumb="${m.thumbnail_url || m.url}"
          data-full="${m.url}"
          data-index="${index}"
          data-conteudo-id="${m.conteudo_id || ""}"
          data-ja-possuia="${m.ja_possuia === true ? "true" : "false"}"
          data-liberado="${midiaLiberada ? "true" : "false"}"
          style="background-image:url('${m.thumbnail_url || m.url}')">
        </div>
      `;
    }).join("")}
  </div>

  ${
    msg.preco > 0
      ? `
      <div class="conteudo-info">
        <span class="status-bloqueado">
          ${
            msg.liberado
              ? `🟢 ${quantidade} mídia(s)`
              : msg.tem_parcial_liberado
                ? `✨ ${quantidade} mídia(s) · parcial`
                : `✨ ${quantidade} mídia(s)`
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
</div>
`;

    const bloqueadoTotal =
      Number(msg.preco) > 0 &&
      msg.liberado !== true &&
      !msg.tem_parcial_liberado;

    ativarLazyLoadingModelo(div, msg, bloqueadoTotal);
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

<span class="msg-hora">
  ${formatarTempo(msg.created_at)}
</span>
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

// // ===============================
// // ABRIR CONTEÚDO
// // ===============================

async function abrirConteudo(message_id, index = 0) {
  try {
    const res = await fetch(`/api/chat/conteudo/${message_id}`, {
      headers: { Authorization: "Bearer " + token }
    });

    if (!res.ok) {
      alert(t("chatc.error_load_media"));
      return;
    }

    const midias = await res.json();
    const midia = midias[index];

    if (!midia) return;

    if (midia.liberado === false) {
      const card = document.querySelector(`.chat-conteudo[data-id="${message_id}"]`);
      const preco = Number(card?.dataset.preco || 0);

      if (preco > 0) {
        abrirPagamentoChat(preco, message_id);
      }
      return;
    }

    if (!midia.url) {
      console.warn("Mídia sem URL:", { message_id, index, midia });
      return;
    }

    abrirModalMidia(midia.url);
    marcarConteudoVisto(message_id);

  } catch (err) {
    console.error("Erro ao abrir conteúdo:", err);
  }
}

// ===============================
// PAGAMENTO CHAT
// ===============================

function abrirPagamentoChat(valor, conteudoId) {
  if (!valor || !conteudoId) {
    alert(t("chatc.error_invalid_data"));
    return;
  }

  const conteudo_id = Number(conteudoId);
  const preco = Number(valor);

  // mantém compatibilidade com qualquer trecho antigo do chat
  chatPagamentoAtual = {
    conteudo_id,
    valor: preco
  };

  // alimenta o fluxo novo do pag.js
  window.PAGAMENTO_TIPO_ATUAL = "midia";
  window.MIDIA_VENDA_ATUAL = {
    conteudo_id,
    preco,
    descricao: ""
  };

  // sincroniza também o objeto global que o pag.js usa
  window.pagamentoAtual = {
    tipo: "midia",
    conteudo_id,
    valor: preco,
    preco
  };

  // se o modal antigo estiver aberto por qualquer motivo, fecha
  document.getElementById("escolhaPagamento")?.classList.add("hidden");
  document.getElementById("paymentModal")?.classList.add("hidden");

  if (typeof abrirPopupPagamento !== "function") {
    console.error("abrirPopupPagamento não está disponível.");
    alert(t("chatc.error_open_payment"));
    return;
  }

  abrirPopupPagamento();
}

async function carregarInfoModelo(modelo_id) {
  try {
    await fetch(`/api/chat/cliente/marcar-lido/${modelo_id}`, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const res = await fetch(`/api/modelo/chat/${modelo_id}`, {
      headers: { Authorization: "Bearer " + token }
    });

    if (!res.ok) {
      console.warn("Erro ao carregar modelo");
      return;
    }

    const modelo = await res.json();

    const nome = document.getElementById("chatModeloNome");
    if (nome) nome.innerText = modelo.nome_exibicao || modelo.nome || t("chatc.model_name_placeholder");

    const avatar = document.getElementById("chatModeloAvatar");
    if (avatar) {
      if (modelo.avatar_url) {
        avatar.src = modelo.avatar_url;
      }

      avatar.style.cursor = "pointer";
      avatar.onclick = () => {
        if (modelo.avatar_url) abrirPreviewAvatar(modelo.avatar_url);
      };
    }

    const status = document.getElementById("chatModeloStatus");
    if (status) {
      status.innerText = modelo.last_seen
        ? t("chatc.last_seen").replace("{time}", formatarTempo(modelo.last_seen))
        : t("chatc.last_seen").replace("{time}", t("chatc.time_now"));
    }

  } catch (err) {
    console.error("Erro carregarInfoModelo:", err);
  }
}

function fecharEscolha() {
  document
.getElementById("escolhaPagamento")
    .classList.add("hidden");
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


function abrirMidia(midia) {
  if (!midia) return;

  const src = midia.dataset.full || midia.dataset.src || midia.dataset.thumb;
  if (!src) return;

  abrirModalMidia(src);

  const conteudo = midia.closest(".chat-conteudo");
  if (!conteudo) return;

  const message_id = Number(conteudo.dataset.id);

  if (message_id && socket) {
    socket.emit("marcarConteudoVisto", {
      message_id,
      cliente_id,
      modelo_id
    });
  }
}

function abrirModalMidia(src) {
  const modal  = document.getElementById("modalMidia");
  const img    = document.getElementById("modalImg");
  const video  = document.getElementById("modalVideo");
  const iframe = document.getElementById("modalIframe");

  if (!modal || !src) return;

  modal.classList.remove("hidden");

  // reset de tudo
  if (img) {
    img.style.display = "none";
    img.removeAttribute("src");
  }

  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.style.display = "none";
    video.load();
  }

  if (iframe) {
    iframe.removeAttribute("src");
    iframe.style.display = "none";
  }

  if (src.includes("iframe.videodelivery.net")) {
    if (iframe) {
      iframe.src = src;
      iframe.style.display = "block";
    }
    return;
  }

  if (
    src.includes(".mp4") ||
    src.includes(".webm") ||
    src.includes(".mov")
  ) {
    if (video) {
      video.src = src;
      video.style.display = "block";
      video.play().catch(() => {});
    }
    return;
  }

  if (img) {
    img.src = src;
    img.style.display = "block";
  }
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

  const img = modal.querySelector("#avatarPreviewImg");

  //Evita mostrar imagem quebrada
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

function formatarHora(data) {
  if (!data) return "";

  const d = new Date(data);
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function abrirPreviewMidia({ url }){

  if(!url) return;

  abrirModalMidia(url);

}

function criarMensagemElemento(msg){

  const div = document.createElement("div");

  div.className =
    msg.sender === "modelo"
      ? "msg msg-modelo"
      : "msg msg-cliente";

  div.dataset.id = msg.id;

if (msg.tipo === "conteudo" || msg.tipo === "conteudo_ppv_mass") {
  const quantidade =
    msg.quantidade ?? (msg.midias?.length || 0);

const cardLiberado =
  Number(msg.preco) === 0 ||
  msg.liberado === true;

div.innerHTML = `
  <div class="msg-conteudo-wrap ${
    msg.sender === "modelo" ? "lado-modelo" : "lado-cliente"
  }">
<div class="chat-conteudo premium ${
  cardLiberado ? "visto" : (msg.preco > 0 ? "bloqueado" : "")
}" data-id="${msg.id}" data-preco="${msg.preco || 0}">

  <div class="pacote-grid">
    ${(msg.midias || []).map((m, index) => {
      const midiaLiberada =
        Number(msg.preco) === 0 ||
        m.liberado === true ||
        cardLiberado;

      return `
       <div class="midia-item lazy-midia ${
  midiaLiberada ? "midia-livre" : "midia-bloqueada"
}"
  data-thumb="${m.thumbnail_url || m.url}"
  data-full="${m.url}"
  data-index="${index}"
  data-conteudo-id="${m.conteudo_id || ""}"
  data-ja-possuia="${m.ja_possuia === true ? "true" : "false"}"
  data-liberado="${midiaLiberada ? "true" : "false"}">
</div>
      `;
    }).join("")}
  </div>

  ${
    msg.preco > 0
      ? `
      <div class="conteudo-info">
        <span class="status-bloqueado">
          ${
            msg.liberado
              ? `🟢 ${quantidade} mídia(s)`
              : msg.tem_parcial_liberado
                ? `✨ ${quantidade} mídia(s) · parcial`
                : `✨ ${quantidade} mídia(s)`
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

<div class="msg-meta">
  <span class="msg-hora">${formatarTempo(msg.created_at)}</span>
</div>
</div>
`;
}

  return div;

}

function valorBRLChat(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

async function liberarConteudo(messageId) {
  if (!messageId) return;

  console.log("Conteúdo confirmado pelo backend:", messageId);

  const el = document.querySelector(`.chat-conteudo[data-id="${messageId}"]`);
  if (!el) return;

  try {
    const res = await fetch(`/api/chat/conteudo/${messageId}`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) return;

    const midias = await res.json();
    const todasLiberadas = midias.every(m => m.liberado !== false);

    // marca estado do card
    el.classList.remove("bloqueado");
    el.classList.remove("visto");

    if (todasLiberadas) {
      conteudosLiberados.add(Number(messageId));
      el.classList.add("livre");
    } else {
      el.classList.remove("livre");
    }

    const precoAtual = Number(el.dataset.preco || 0);
    const quantidade = midias.length || 0;

    el.innerHTML = `
      <div class="pacote-grid">
        ${midias.map((m, index) => {
          const liberado = m.liberado !== false;

          return `
            <div
              class="midia-item ${liberado ? "midia-livre" : "midia-bloqueada"}"
              data-index="${index}"
              data-full="${m.url || ""}"
              data-thumb="${m.thumbnail_url || m.url || ""}"
              data-liberado="${liberado ? "true" : "false"}"
              style="${!liberado ? `background-image:url('${m.thumbnail_url || m.url || ""}')` : ""}"
            >
              ${
                liberado
                  ? (
                      m.tipo_media === "video"
                        ? `<video src="${m.url}" muted playsinline preload="metadata"></video>`
                        : `<img src="${m.url}" alt="">`
                    )
                  : `
                    <div class="midia-preview" style="background-image:url('${m.thumbnail_url || m.url || ""}')"></div>
                    <div class="midia-lock">🔒</div>
                  `
              }
            </div>
          `;
        }).join("")}
      </div>

      ${
        precoAtual > 0
          ? `
            <div class="conteudo-info">
              <span class="status-bloqueado">
                ${todasLiberadas ? `🟢 ${quantidade} mídia(s)` : `✨ ${quantidade} mídia(s)`}
              </span>
              <span class="preco-bloqueado">
                R$ ${precoAtual.toFixed(2)}
              </span>
            </div>
          `
          : ""
      }
    `;

    if (todasLiberadas && midias.length > 0) {
      setTimeout(() => {
        abrirConteudo(messageId, 0);
      }, 250);
    }
  } catch (err) {
    console.error("Erro liberar conteúdo:", err);
  }
}

async function marcarConteudoVisto(messageId){

  await fetch("/api/conteudo/visto",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      Authorization:"Bearer "+localStorage.getItem("token")
    },
    body:JSON.stringify({message_id:messageId})
  });
}

function resetarPixUI() {
  pararPollingPagamento();

  const imgQr = document.getElementById("pixQr");
  if (imgQr) {
    imgQr.src = "";
    imgQr.classList.add("hidden");
  }

  const inputNovo = document.getElementById("pixCodigo");
  if (inputNovo) inputNovo.value = "";

  const inputAntigo = document.getElementById("pixCopia");
  if (inputAntigo) inputAntigo.value = "";

  const statusPix = document.getElementById("pixStatus");
  if (statusPix) {
    statusPix.innerText = "";
    statusPix.className = "pix-status aguardando";
  }

  if (chatPagamentoAtual) {
    chatPagamentoAtual.orderId = null;
    chatPagamentoAtual.payment_id = null;
    chatPagamentoAtual.message_id = null;
  }
}

window.finalizarPagamentoEAbrirMidia = async function (messageId) {
  const popup = document.getElementById("popupPagamentoVelvet");

  if (popup) {
    popup.classList.add("hidden");
    popup.style.display = "none";
    popup.style.visibility = "hidden";
    popup.style.pointerEvents = "none";
  }

  if (!messageId) return;

  try {
    // 1) atualiza o card no chat imediatamente
    await liberarConteudo(messageId);

    // 2) abre a primeira mídia já liberada
    setTimeout(() => {
      abrirConteudo(messageId, 0);
    }, 150);

  } catch (err) {
    console.error("Erro ao finalizar pagamento e abrir mídia:", err);
  }
};

function garantirToastPagamento() {
  let el = document.getElementById("toastPagamento");

  if (!el) {
    el = document.createElement("div");
    el.id = "toastPagamento";
    el.className = "toast-pagamento hidden";
    document.body.appendChild(el);
  }

  return el;
}

function mostrarToastPagamento(texto, tipo = "info", autoHide = false) {
  const el = garantirToastPagamento();

  el.innerText = texto;
  el.className = `toast-pagamento ${tipo}`;

  if (autoHide) {
    clearTimeout(el._hideTimer);
    el._hideTimer = setTimeout(() => {
      el.className = "toast-pagamento hidden";
    }, 3500);
  }
}

function esconderToastPagamento() {
  const el = document.getElementById("toastPagamento");
  if (!el) return;
  el.className = "toast-pagamento hidden";
}

// apenas log
socket.on("disconnect", reason => {
  console.warn("🔴 Socket desconectado:", reason);

});

function mostrarMetodoPixChat() {
  if (!validarDadosIniciaisPagamento()) return;

  resetarEstadoCartao();
  resetarEstadoPix();
  irParaEtapaPagamento("pix");

  setTimeout(() => {
    document.getElementById("btnGerarPix")?.click();
  }, 200);
}

// ===============================
// BLOQUEIO SEM VIP
// ===============================
function bloquearChatSemVip(modeloId) {
  // Ocultar área de input
  const inputArea = document.querySelector(".chat-input, .chat-input-area, .input-area, #chatFooter, .chat-footer");
  if (inputArea) { inputArea.style.display = "none"; }

  const sendBtn = document.getElementById("sendBtn");
  if (sendBtn) sendBtn.style.display = "none";

  const msgInput = document.getElementById("msgInput");
  if (msgInput) msgInput.style.display = "none";

  // Mostrar banner no lugar do chat
  const chatBox = document.getElementById("chatBox");
  if (chatBox) {
    chatBox.innerHTML = `
      <div style="
        display:flex;flex-direction:column;align-items:center;justify-content:center;
        height:100%;min-height:200px;gap:16px;padding:32px;text-align:center;
      ">
        <div style="font-size:48px;">🔒</div>
        <p style="font-size:16px;color:#555;margin:0;line-height:1.5;">
          Para conversar com esta modelo é necessário ter uma assinatura VIP ativa.
        </p>
        <button onclick="window.location.href='/perfil.html?id=${modeloId}'" style="
          background:linear-gradient(135deg,#7B2CFF,#9B5CFF);color:#fff;
          border:none;padding:14px 28px;border-radius:14px;font-size:15px;
          font-weight:600;cursor:pointer;
        ">Assinar VIP</button>
      </div>
    `;
  }
}