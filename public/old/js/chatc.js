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
let cliente_id = null;
let modelo_id = null;

setInterval(() => {
  if (!socket.connected) {
    console.warn("Tentando reconectar...");
    socket.connect();
  }
}, 10000);

const conteudosLiberados = new Set();
let pagamentoAtual = null;
let intervaloConfirmacaoPagamento = null;
let pagamentoEmProcesso = false;
const stripe = Stripe("pk_live_51Spb5lRtYLPrY4c3L6pxRlmkDK6E0OSU93T5B75V4pY39rJ3FVyPEa6ZDDgqUiY1XCCEay6uQcItbZY4EcAOkoJn00TtsQ8bbz");
let elements = null;


function tentarEntrarSala() {
  if (!autenticado) return;
  if (!cliente_id || !modelo_id) return;
  if (salaPronta) return;

  salaPronta = true;

  socket.emit("joinChat", { cliente_id, modelo_id });
  socket.emit("getHistory", { cliente_id, modelo_id });

  console.log("🟪 Sala cliente conectada");
}

socket.on("connect", () => {
  autenticado = false;
  salaPronta = false;
  socket.emit("auth", { token });
});

socket.on("authOk", async () => {
  if (autenticado) return;
  autenticado = true;

  socket.emit("loginCliente");

  await carregarCliente();     // define cliente_id
  await carregarInfoModelo(modelo_id);

  tentarEntrarSala();
});

document.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  modelo_id = Number(params.get("modelo_id"));

  if (!modelo_id) {
    alert("Modelo inválida.");
    return;
  }

  tentarEntrarSala();

  const sendBtn = document.getElementById("sendBtn");
  const input   = document.getElementById("messageInput");

  if (sendBtn) {
    sendBtn.onclick = enviarMensagem;
  }

  if (input) {
    input.addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        enviarMensagem();
      }
    });
  }

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-desbloquear");
  if (btn) {
    e.stopPropagation(); // impede duplicação
    const preco = btn.dataset.preco;
    const messageId = btn.dataset.messageId;
    abrirPagamentoChat(preco, messageId);
    return;
  }

  const card = e.target.closest(".chat-conteudo.bloqueado");
  if (card) {
    const preco = card.dataset.preco;
    const messageId = card.dataset.id;
    abrirPagamentoChat(preco, messageId);
  }

});

document.addEventListener("click", e => {
  if (
    e.target.classList.contains("modal-backdrop") ||
    e.target.classList.contains("modal-fechar")
  ) {
    fecharConteudo();
  }
});

document.getElementById("confirmarPagamento").onclick = async () => {

  const { error, paymentIntent } = await stripe.confirmPayment({
    elements,
    redirect: "if_required"
  });

  if (error) {
    alert(error.message);
    return;
  }

  document.getElementById("paymentModal").classList.add("hidden");
  document.getElementById("payment-element").innerHTML = "";

  if (!pagamentoAtual?.message_id) return;

  const conteudo_id = pagamentoAtual.message_id;

};

});

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


// 📜 HISTÓRICO
socket.on("chatHistory", mensagens => {
  const chat = document.getElementById("chatBox");
  if (!chat) return;

  chat.innerHTML = "";

  mensagens.forEach(m => {

    // 🔓 marca como liberado
    if (m.tipo === "conteudo") {
      if (m.liberado === true || Number(m.preco) === 0){
        conteudosLiberados.add(Number(m.id));
      }
    }

    renderMensagem(m);
  });

  // 🔥 força scroll para o final
  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
});

// 💬 NOVA MENSAGEM
socket.on("newMessage", msg => {
if (
  Number(msg.modelo_id) !== Number(modelo_id) ||
  Number(msg.cliente_id) !== Number(cliente_id)
) return;

  renderMensagem(msg);
 if (msg.sender === "modelo") {
    const status = document.getElementById("chatModeloStatus");
    if (status) status.innerText = "online";
  }

  scrollParaFinal();
});


socket.on("conteudoVisto", async ({ message_id }) => {
  const status = document.getElementById("pixStatus");

if (status) {
  status.innerText = "✅ Pagamento confirmado!";
}

  console.log("🔓 Conteúdo liberado:", message_id);
  conteudosLiberados.add(Number(message_id));

  fecharPopupPix();

  const card = document.querySelector(`[data-id="${message_id}"]`);
  if (!card) {
  console.warn("Card não encontrado, forçando refresh do histórico");
  socket.emit("getHistory", { cliente_id, modelo_id });
  return;
}

  const res = await fetch(`/api/chat/conteudo/${message_id}`, {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token")
    }
  });

  if (!res.ok) return;

  const midias = await res.json();

  card.classList.remove("bloqueado");
  card.classList.add("livre");

card.innerHTML = `
  <div class="pacote-grid">
    ${midias.map((m, index) => `
  <div class="midia-item"
       onclick="abrirConteudoSeguro(${message_id}, ${index})">
    ${
      m.tipo_media === "video"
        ? `<video src="${m.url}" muted playsinline></video>`
        : `<img src="${m.url}" />`
    }
  </div>
`).join("")}

  </div>
 `;
 const toast = document.getElementById("toastPagamento");

if (toast) {
  toast.classList.remove("hidden");

  setTimeout(() => {
    toast.classList.add("hidden");
  }, 3000);
}

card.removeAttribute("data-preco");
});

socket.on("vipAtivado", () => {
  fecharPopup();
  atualizarPerfil();
});

socket.on("disconnect", (reason) => {
  console.warn("🔴 Socket desconectado:", reason);
});

async function carregarCliente() {
  const res = await fetch("/api/cliente/me", {
    headers: { Authorization: "Bearer " + token }
  });

  if (!res.ok) return;

  const data = await res.json();
  cliente_id = data.cliente_id;

  socket.emit("loginCliente", cliente_id);
}

function fecharPopupPix() {
  const popup = document.getElementById("popupPix");
  if (popup) popup.classList.add("hidden");
  pagamentoAtual = {};
  const cpf = document.getElementById("pixCpf");
if (cpf) cpf.value = "";
}

// ===============================
// FUNÇÕES
function valorBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function abrirPagamentoChat(valor, conteudoId) {

  if (!valor || !conteudoId) {
    alert("Erro: dados inválidos");
    return;
  }

  pagamentoAtual = {
    conteudo_id: Number(conteudoId),
    valor: Number(valor)
  };

  document
    .getElementById("escolhaPagamento")
    .classList.remove("hidden");
}

function fecharEscolha() {
  document
    .getElementById("escolhaPagamento")
    .classList.add("hidden");
}

async function carregarInfoModelo(modelo_id) {
  try {
    const res = await fetch(`/api/modelo/chat/${modelo_id}`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) return;

    const modelo = await res.json();

    const avatar = document.getElementById("chatModeloAvatar");
    const nome   = document.getElementById("chatModeloNome");
    const status = document.getElementById("chatModeloStatus");

   if (avatar) {
  avatar.style.cursor = "pointer";

   if (modelo.avatar) {
    avatar.src = modelo.avatar; 
  } else {
    avatar.src = "/assets/avatar.png";
  }

  avatar.addEventListener("click", () => {
    if (modelo.avatar) {
      abrirPreviewAvatar(modelo.avatar);
    }
  });
}

    if (nome) {
      nome.innerText = modelo.nome_exibicao || "Modelo";
    }

        if (status) {
      if (modelo.last_seen) {
        status.innerText = `visto por último: ${formatarTempo(modelo.last_seen)}`;
      } else {
        status.innerText = "visto por último: agora";
      }
    }

  } catch (err) {
    console.error("Erro carregar modelo:", err);
  }
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

function enviarMensagem() {
  const input = document.getElementById("messageInput");
  const text = input?.value.trim();
  if (!text) return;

  socket.emit("sendMessage", {
    cliente_id,
    modelo_id,
    text
  });

  input.value = "";
}


function renderMensagem(msg) {
  const chat = document.getElementById("chatBox");
  if (!chat) return;

  const div = document.createElement("div");
  div.className =
    msg.sender === "modelo"
      ? "msg modelo"
      : "msg cliente";

  /* ✉️ TEXTO */
  if (msg.tipo === "texto") {
    div.innerText = msg.text;
  }

  /* 📦 CONTEÚDO */
  else if (msg.tipo === "conteudo") {

   const liberado =
  msg.liberado === true ||
  Number(msg.preco) === 0;

    /* ===========================
       🔓 CONTEÚDO LIBERADO
    ============================ */
    if (liberado) {

      div.innerHTML = `
        <div class="chat-conteudo livre premium"
             data-id="${msg.id}"
             data-qtd="${msg.quantidade ?? msg.midias.length}">
          <div class="pacote-grid">
            ${msg.midias.map((m, index) => `
              <div class="midia-item lazy-midia"
                   data-full="${m.url}"
                   data-thumb="${m.thumbnail_url || m.url}"
                   data-index="${index}"
                   data-message-id="${msg.id}">
                   
                   <div class="midia-placeholder"></div>

              </div>
            `).join("")}
          </div>
        </div>
      `;

    }

    /* ===========================
       🔒 CONTEÚDO BLOQUEADO
    ============================ */
    else {

      div.innerHTML = `
        <div class="chat-conteudo bloqueado premium"
             data-id="${msg.id}"
             data-preco="${msg.preco}"
             data-qtd="${msg.quantidade ?? 1}">

          <div class="pacote-grid">
            ${Array(msg.quantidade ?? 1).fill("").map(() =>
              `<div class="midia-item placeholder"></div>`
            ).join("")}
          </div>

          <div class="conteudo-info">
            <span class="status-bloqueado">
              ${msg.quantidade ?? 1} mídia(s)
            </span>

            <span class="preco-bloqueado">
              R$ ${Number(msg.preco).toFixed(2)}
            </span>

            <button class="btn-desbloquear"
              data-preco="${msg.preco}"
              data-message-id="${msg.id}">
              Desbloquear
            </button>
          </div>
        </div>
      `;
    }
  }

  chat.appendChild(div);

  // 🔥 Ativar lazy loading somente se liberado
if (msg.tipo === "conteudo" && 
    (msg.liberado === true || 
     conteudosLiberados.has(Number(msg.id)))) {

  ativarLazyLoading(div, msg);
}
  chat.scrollTop = chat.scrollHeight;
}

function scrollParaFinal() {
  const chat = document.getElementById("chatBox");
  if (!chat) return;

  requestAnimationFrame(() => {
    chat.scrollTop = chat.scrollHeight;
  });
}

async function abrirConteudoSeguro(message_id, index = 0) {

  const modal = document.getElementById("modalConteudo");
  const midiaBox = document.getElementById("modalMidia");

  if (!modal || !midiaBox) {
    console.error("❌ Modal não encontrado");
    return;
  }

  modal.classList.remove("hidden");
  midiaBox.innerHTML = "<p>Carregando...</p>";

  try {

    const res = await fetch(`/api/chat/conteudo/${message_id}`, {
      headers: {
        Authorization: "Bearer " + localStorage.getItem("token")
      }
    });

    if (!res.ok) {
      midiaBox.innerHTML = "<p>Acesso não autorizado.</p>";
      return;
    }

    const midias = await res.json();
    const midia = midias[index];

    if (!midia) {
      midiaBox.innerHTML = "<p>Erro ao abrir mídia.</p>";
      return;
    }

    // 🔓 só marca como liberado DEPOIS de validar backend
    conteudosLiberados.add(Number(message_id));

    socket.emit("marcarConteudoVisto", {
      message_id,
      cliente_id,
      modelo_id
    });

    midiaBox.innerHTML =
      (midia.tipo_media || midia.tipo) === "video"
        ? `<video src="${midia.url}" controls autoplay></video>`
        : `<img src="${midia.url}" />`;

  } catch (err) {
    console.error("Erro abrir conteúdo:", err);
    midiaBox.innerHTML = "<p>Erro inesperado.</p>";
  }
}

function fecharConteudo() {
  const modal = document.getElementById("modalConteudo");
  const midia = document.getElementById("modalMidia");

  modal.classList.add("hidden");
  midia.innerHTML = "";
}


function pagarComPix() {

  document
    .getElementById("escolhaPagamento")
    .classList.add("hidden");

  if (!pagamentoAtual?.conteudo_id || !pagamentoAtual?.valor) {
    alert("Conteúdo inválido");
    return;
  }

  abrirPixConteudo(
    pagamentoAtual.conteudo_id,
    pagamentoAtual.valor
  );
}

function abrirPixConteudo(conteudo_id, preco) {

  if (!conteudo_id || Number(preco) <= 0) {
    alert("Conteúdo inválido");
    return;
  }

  pagamentoAtual = {
    conteudo_id: Number(conteudo_id),
    valor: Number(preco)
  };

  const taxaTransacao  = Number((preco * 0.10).toFixed(2));
  const taxaPlataforma = Number((preco * 0.05).toFixed(2));
  const valorTotal     = Number(
    (preco + taxaTransacao + taxaPlataforma).toFixed(2)
  );

  document.getElementById("pixValorBase").innerText =
    valorBRL(preco);
  document.getElementById("pixTaxaTransacao").innerText =
    valorBRL(taxaTransacao);
  document.getElementById("pixTaxaPlataforma").innerText =
    valorBRL(taxaPlataforma);
  document.getElementById("pixValorTotal").innerText =
    valorBRL(valorTotal);

  document.getElementById("popupPix")
    .classList.remove("hidden");
}

async function gerarPix() {

  if (!pagamentoAtual || !pagamentoAtual.conteudo_id) {
    alert("Conteúdo inválido.");
    return;
  }

  const cpfInput = document.getElementById("pixCpf");
  if (!cpfInput) {
    alert("Campo CPF não encontrado.");
    return;
  }

  const cpfLimpo = cpfInput.value.replace(/\D/g, "");

  if (cpfLimpo.length !== 11) {
    alert("Digite um CPF válido.");
    return;
  }

  const conteudo_id = Number(pagamentoAtual.conteudo_id);

  const fingerprint = btoa(
    navigator.userAgent + navigator.language + screen.width
  );

  try {

    const res = await fetch("/api/pagamento/midia/pix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + localStorage.getItem("token")
      },
      body: JSON.stringify({
        conteudo_id,
        aceitou_termos: true,
        fingerprint,
        cpf: cpfLimpo  
      })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Erro ao gerar PIX");
      return;
    }

    const imgQr = document.getElementById("pixQr");
    const inputCopia = document.getElementById("pixCopia");

    if (!imgQr || !inputCopia) {
      console.error("Elementos do Pix não encontrados no HTML");
      return;
    }

    if (data.qr_code_url) {
      imgQr.src = data.qr_code_url;
      imgQr.classList.remove("hidden");
    }

    if (data.copia_cola) {
      inputCopia.value = data.copia_cola;
    }

  } catch (err) {
    console.error("Erro Pix:", err);
    alert("Erro inesperado no Pix");
  }
}

async function pagarComCartao() {

  if (pagamentoEmProcesso) return;
  pagamentoEmProcesso = true;

  document
    .getElementById("escolhaPagamento")
    .classList.add("hidden");

  if (!pagamentoAtual?.conteudo_id) {
    alert("Conteúdo inválido");
    pagamentoEmProcesso = false;
    return;
  }

  const conteudo_id = Number(pagamentoAtual.conteudo_id);

  try {

    const res = await fetch(
      "/api/pagamento/midia/cartao",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization:
            "Bearer " + localStorage.getItem("token")
        },
        body: JSON.stringify({ conteudo_id })
      }
    );

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Erro no pagamento");
      pagamentoEmProcesso = false;
      return;
    }

document.getElementById("cartaoValorConteudo")
  .innerText = valorBRL(data.valorBase);

document.getElementById("cartaoTaxaTransacao")
  .innerText = valorBRL(data.taxaTransacao);

document.getElementById("cartaoTaxaPlataforma")
  .innerText = valorBRL(data.taxaPlataforma);

document.getElementById("cartaoValorTotal")
  .innerText = valorBRL(data.total);

    elements = stripe.elements({
      clientSecret: data.clientSecret
    });

    const paymentElement =
      elements.create("payment");

    paymentElement.mount("#payment-element");

    document.getElementById("paymentModal")
      .classList.remove("hidden");

  } catch (err) {
    console.error("Erro cartão:", err);
    alert("Erro inesperado");
  }

  pagamentoEmProcesso = false;
}

function fecharPagamento() {

  const modal = document.getElementById("paymentModal");
  if (modal) modal.classList.add("hidden");

  if (elements) {
    try {
      elements = null;
    } catch (err) {
      console.warn("Erro limpando Stripe Elements:", err);
    }
  }

  const el = document.getElementById("payment-element");
  if (el) el.innerHTML = "";
}

async function copiarPix() {
  const input = document.getElementById("pixCopia");

  if (!input || !input.value) {
    mostrarToast("Código Pix indisponível");
    return;
  }

  try {

    // método moderno
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(input.value);
    } else {
      // fallback seguro
      const textarea = document.createElement("textarea");
      textarea.value = input.value;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }

    mostrarToast("Código Pix copiado!");

  } catch (err) {
    console.error("Erro copiar Pix:", err);
    mostrarToast("Não foi possível copiar");
  }
}

function mostrarToast(texto) {

  let toast = document.getElementById("toastPix");

  if (!toast) {
    toast = document.createElement("div");
    toast.id = "toastPix";
    toast.style.position = "fixed";
    toast.style.bottom = "30px";
    toast.style.left = "50%";
    toast.style.transform = "translateX(-50%)";
    toast.style.background = "#7b2cff";
    toast.style.color = "#fff";
    toast.style.padding = "12px 22px";
    toast.style.borderRadius = "30px";
    toast.style.fontWeight = "600";
    toast.style.boxShadow = "0 8px 25px rgba(0,0,0,0.3)";
    toast.style.zIndex = "999999";
    toast.style.fontSize = "14px";
    toast.style.transition = "opacity .3s ease, transform .3s ease";
    document.body.appendChild(toast);
  }

  toast.innerText = texto;

  toast.style.opacity = "1";
  toast.style.transform = "translateX(-50%) translateY(0)";

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(10px)";
  }, 2500);
}

//OTIMIZACAO CHAT
const observerMidia = new IntersectionObserver((entries) => {

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

    observerMidia.unobserve(el);

  });

}, {
  root: document.getElementById("chatBox"),
  threshold: 0.1
});

function ativarLazyLoading(container, msg) {

  const midias = container.querySelectorAll(".lazy-midia");

  midias.forEach(el => {

    observerMidia.observe(el);

    el.addEventListener("click", () => {

      const index = Number(el.dataset.index);
      abrirConteudoSeguro(msg.id, index);

    });

  });
}

const inputCpf = document.getElementById("pixCpf");

if (inputCpf) {
  inputCpf.addEventListener("input", (e) => {
    let v = e.target.value.replace(/\D/g, "");

    if (v.length > 11) v = v.slice(0, 11);

    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d)/, "$1.$2");
    v = v.replace(/(\d{3})(\d{1,2})$/, "$1-$2");

    e.target.value = v;
  });
}




