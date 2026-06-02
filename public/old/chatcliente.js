// ===============================
// AUTH GUARD — CHAT CLIENTE
// ===============================
const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

if (!token) {
  window.location.href = "/index.html";
  throw new Error("Sem token");
}
const socket = io({
  transports: ["websocket"]
});

let cliente_id = null;
let modelo_id = null;
let chatAtivo = null;
const mensagensRenderizadas = new Set();
const conteudosLiberados = new Set();
let stripe;
let elements;
let pagamentoAtual = {};
stripe = Stripe("pk_live_51Spb5lRtYLPrY4c3L6pxRlmkDK6E0OSU93T5B75V4pY39rJ3FVyPEa6ZDDgqUiY1XCCEay6uQcItbZY4EcAOkoJn00TtsQ8bbz");

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

  mensagens.forEach(m => {

    // 🔓 marca como liberado ao carregar histórico
    if (m.tipo === "conteudo") {
      if (m.visto === true || Number(m.preco) === 0) {
        conteudosLiberados.add(Number(m.id));
      }
    }

    renderMensagem(m);
  });

  atualizarStatusPorResponder(mensagens);
});


socket.on("chatMetaUpdate", data => {
  atualizarListaComMeta(data);
});

// 💬 NOVA MENSAGEM
socket.on("newMessage", msg => {

  // 🔒 se a mensagem NÃO é deste chat, ignora
  if (Number(msg.modelo_id) !== Number(modelo_id)) return;

  // ✅ renderiza sempre no chat aberto
  renderMensagem(msg);

  // ❗ SÓ marca "Não visto" se EU NÃO fui quem enviou
  if (msg.sender !== "cliente") {
    atualizarItemListaComNovaMensagem(msg);
    contarChatsNaoLidosCliente();
  }
});


socket.on("conteudoVisto", async ({ message_id }) => {

  console.log("🔓 Conteúdo liberado:", message_id);
  conteudosLiberados.add(Number(message_id));

  fecharPopupPix();

  /* ==========================
     🔄 ATUALIZA CARD NO CHAT
  ========================== */
  const card = document.querySelector(
    `.chat-conteudo[data-id="${message_id}"]`
  );

  if (!card) return;

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

 card.classList.remove("bloqueado");
card.classList.add("livre");
card.removeAttribute("data-preco");

});

socket.on("unreadUpdate", ({ modelo_id, unread }) => {
  if (!unread) return;

  const li = [...document.querySelectorAll("#listaModelos li")]
    .find(el => Number(el.dataset.modeloId) === Number(modelo_id));

  if (!li) return;

  li.classList.add("nao-visto");

  const badge = li.querySelector(".badge");
  badge.innerText = "Não visto";
  badge.classList.remove("hidden");

  // 🔔 ATUALIZA HEADER
  contarChatsNaoLidosCliente();
});

function fecharPopupPix() {
  const popup = document.getElementById("popupPix");
  if (popup) popup.classList.add("hidden");

  // limpa estado de pagamento
  pagamentoAtual = {};
}




// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  await carregarCliente();
  await carregarListaModelos();

  const vipModelo = localStorage.getItem("vip_modelo_id");

if (vipModelo) {
  localStorage.removeItem("vip_modelo_id");

  // força reload da lista VIP
  await carregarListaModelos();

  // abre automaticamente o chat da modelo VIP
  const li = [...document.querySelectorAll("#listaModelos li")]
    .find(el => Number(el.dataset.modeloId) === Number(vipModelo));

  if (li) li.click();
}


  const sendBtn = document.getElementById("sendBtn");
  const input   = document.getElementById("messageInput");
  sendBtn.onclick = enviarMensagem;

 input.addEventListener("keydown", e => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault(); // 🚫 impede quebra de linha
    enviarMensagem();
  }
  });
  const avatarEl = document.getElementById("chatAvatar");

  avatarEl.onerror = () => {
  avatarEl.src =
    "https://velvet-app-production.up.railway.app/assets/avatarDefault.png";
  };

  document.addEventListener("click", (e) => {
  const btn = e.target.closest(".btn-desbloquear");
  if (!btn) return;

 const preco = btn.dataset.preco;
 const messageId = btn.dataset.messageId;
console.log("DEBUG pagamento:", preco, messageId);
abrirPagamentoChat(preco, messageId);

 });


});



// ===============================
// FUNÇÕES
// ===============================
// 💰 FORMATA VALORES EM REAL (R$)
function valorBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

async function abrirPagamentoChat(valor, conteudoId) {
  pagamentoAtual = {
    valor,
    message_id: conteudoId
  };

  if (!valor || !conteudoId) {
    alert("Erro: dados inválidos");
    return;
  }

  document
    .getElementById("escolhaPagamento")
    .classList.remove("hidden");
}

function fecharEscolha() {
  document
    .getElementById("escolhaPagamento")
    .classList.add("hidden");
}


function atualizarListaComMeta({ cliente_id, modelo_id, sender, created_at }) {
  const minhaRole = localStorage.getItem("role");

  const li = [...document.querySelectorAll(".chat-item")]
    .find(el =>
      minhaRole === "cliente"
        ? Number(el.dataset.modeloId) === modelo_id
        : Number(el.dataset.clienteId) === cliente_id
    );

  if (!li) return;

  // horário
  li.dataset.lastTime = new Date(created_at).getTime();

  // status
  if (sender !== minhaRole) {
    li.dataset.status = "por-responder";
    li.querySelector(".badge").innerText = "Por responder";
    li.querySelector(".badge").classList.remove("hidden");
  }

  organizarListaClientes?.();
  organizarListaModelos?.();
}

async function carregarListaModelos() {
  const res = await fetch("/api/chat/cliente", {
    headers: { Authorization: "Bearer " + token }
  });

  const modelos = await res.json();
  const lista = document.getElementById("listaModelos");
  lista.innerHTML = "";

  if (!modelos.length) {
    lista.innerHTML = "<li>Você não é VIP em nenhuma modelo.</li>";
    return;
  }

  const unreadRes = await fetch("/api/chat/unread/cliente", {
    headers: { Authorization: "Bearer " + token }
  });
  const unreadIds = await unreadRes.json();

  modelos.forEach(m => {
    const li = document.createElement("li");
    li.className = "chat-item";
    li.dataset.modeloId = m.modelo_id;

    const temNaoVisto = unreadIds.includes(m.modelo_id);

    li.innerHTML = `
      <span class="nome">${m.nome}</span>
      <span class="badge ${temNaoVisto ? "" : "hidden"}">Não visto</span>
    `;

    li.onclick = () => {
      modelo_id = m.modelo_id;
      chatAtivo = { cliente_id, modelo_id };

      mensagensRenderizadas.clear();
      document.getElementById("chatBox").innerHTML = "";
      document.getElementById("chatNome").innerText = m.nome;
      if (m.avatar) {
        document.getElementById("chatAvatar").src = m.avatar;
      }

      li.querySelector(".badge")?.classList.add("hidden");
      li.classList.remove("nao-visto");

      const sala = `chat_${cliente_id}_${modelo_id}`;
      socket.emit("joinChat", { sala });
      socket.emit("getHistory", { cliente_id, modelo_id });
    };

    lista.appendChild(li);
    contarChatsNaoLidosCliente();
  });
}

async function carregarCliente() {
  const res = await fetch("/api/cliente/me", {
    headers: { Authorization: "Bearer " + token }
  });

  const data = await res.json();
  cliente_id = data.id;

 document.getElementById("clienteNomeTitulo").innerText =
  data.username || data.nome;

  socket.emit("loginCliente", cliente_id);
}

function atualizarItemListaComNovaMensagem(msg) {

  // 🚫 cliente NÃO marca Não visto para mensagens dele mesmo
  if (msg.sender === "cliente") return;

  const li = [...document.querySelectorAll("#listaModelos li")]
    .find(el => Number(el.dataset.modeloId) === msg.modelo_id);

  if (!li) return;

  li.dataset.status = "nao-visto";

  const badge = li.querySelector(".badge");
  badge.innerText = "Não visto";
  badge.classList.remove("hidden");

  li.dataset.lastTime = Date.now();

  organizarListaModelos?.();
}

function enviarMensagem() {
  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text) return;

  if (!modelo_id) {
  alert("Selecione uma modelo para conversar.");
  return;
}

// ❌ erro real de sessão
if (!cliente_id) {
  alert("Erro de sessão. Recarregue a página.");
  return;
}

  socket.emit("sendMessage", {
    cliente_id,
    modelo_id,
    text
  });

  const item = [...document.querySelectorAll("#listaModelos li")]
  .find(li => Number(li.dataset.modeloId) === modelo_id);

if (item) {
  item.querySelector(".badge").classList.add("hidden");
}
  input.value = "";
}

function renderMensagem(msg) {
  const msgKey = msg.id ?? `${msg.sender}-${msg.created_at}`;
  if (mensagensRenderizadas.has(msgKey)) return;
  mensagensRenderizadas.add(msgKey);

  const chat = document.getElementById("chatBox");
  if (!chat) return;

  const div = document.createElement("div");

  div.className =
    msg.sender === "modelo"
      ? "msg msg-modelo"
      : "msg msg-cliente";

  /* ✉️ TEXTO */
  if (msg.tipo === "texto") {
    div.innerText = msg.text;
  }

  /* 📦 CONTEÚDO */
  else if (msg.tipo === "conteudo") {

    const liberado =
  msg.visto === true ||
  conteudosLiberados.has(Number(msg.id)) ||
  Number(msg.preco) === 0;


    // 🔓 LIBERADO
  if (liberado) {
  div.innerHTML = `
    <div class="chat-conteudo livre premium"
         data-id="${msg.id}"
         data-qtd="${msg.quantidade ?? msg.midias.length}">
      <div class="pacote-grid">
        ${msg.midias.map((m, index) => `
          <div class="midia-item"
               onclick="abrirConteudoSeguro(${msg.id}, ${index})">
            ${
              (m.tipo_media || m.tipo) === "video"
                ? `<video src="${m.url}" muted playsinline></video>`
                : `<img src="${m.url}" />`
            }
          </div>
        `).join("")}
      </div>
    </div>
  `;
}

    // 🔒 BLOQUEADO
    else {
      div.innerHTML = `
        <div class="chat-conteudo bloqueado premium"
     data-id="${msg.id}"
     data-preco="${msg.preco}"
     data-qtd="${msg.quantidade ?? 1}">
          <div class="pacote-grid">
            ${Array(msg.quantidade ?? 1).fill("").map(() =>
  `<div class="midia-item placeholder"
       onclick="avisarConteudoBloqueado()"></div>`
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
  chat.scrollTop = chat.scrollHeight;
}

function avisarConteudoBloqueado() {
  alert("Você precisa desbloquear a mídia para ver o conteúdo.");
}


  
function marcarNaoVisto(msg) {
  document.querySelectorAll("#listaModelos li").forEach(li => {
    if (Number(li.dataset.modeloId) === msg.modelo_id) {
      li.classList.add("nao-visto");
      li.querySelector(".badge").classList.remove("hidden");
    }
  });
}

function adicionarMensagemNoChat(msg) {
  const chatBox = document.getElementById("chatBox");
  if (!chatBox) return;

  const div = document.createElement("div");
  div.className = msg.sender === "cliente" ? "msg cliente" : "msg modelo";
  div.innerText = msg.text;

  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function atualizarStatusPorResponder(mensagens) {
  if (!mensagens || mensagens.length === 0) return;

  const ultima = mensagens[mensagens.length - 1];
  const minhaRole = localStorage.getItem("role"); // cliente | modelo

  const item = [...document.querySelectorAll(".chat-item")]
    .find(li =>
      minhaRole === "cliente"
        ? Number(li.dataset.modeloId) === ultima.modelo_id
        : Number(li.dataset.clienteId) === ultima.cliente_id
    );

  if (!item) return;

  const badge = item.querySelector(".badge");

  // ✅ última mensagem NÃO foi minha → por responder
  if (ultima.sender !== minhaRole) {
    badge.innerText = "Por responder";
    badge.classList.remove("hidden");
    item.classList.remove("nao-visto");
  }
  // ✅ última mensagem foi minha → limpa tudo
  else {
    badge.classList.add("hidden");
    item.classList.remove("nao-visto");
  }
}

async function abrirConteudoSeguro(message_id, index = 0) {
  const modal = document.getElementById("modalConteudo");
  const midiaBox = document.getElementById("modalMidia");
  
  conteudosLiberados.add(Number(message_id));
  socket.emit("marcarConteudoVisto", {
  message_id,
  cliente_id,
  modelo_id
 });

  if (!modal || !midiaBox) {
    console.error("❌ Modal de conteúdo não encontrado no DOM");
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
      midiaBox.innerHTML = "<p>Erro ao carregar conteúdo.</p>";
      return;
    }

    const midias = await res.json();
    const midia = midias[index];

    if (!midia) {
  midiaBox.innerHTML = "<p>Erro ao abrir mídia.</p>";
  return;
}

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

document.addEventListener("click", e => {
  if (
    e.target.classList.contains("modal-backdrop") ||
    e.target.classList.contains("modal-fechar")
  ) {
    fecharConteudo();
  }
});

function organizarListaModelos() {
  const lista = document.getElementById("listaModelos");
  if (!lista) return;

  const itens = [...lista.querySelectorAll("li")];

  itens.sort((a, b) => {
    const ta = Number(a.dataset.lastTime || 0);
    const tb = Number(b.dataset.lastTime || 0);
    return tb - ta; 
  });

  itens.forEach(li => lista.appendChild(li));
}

function organizarListaClientes() {
}

function contarChatsNaoLidosCliente() {
  const itens = document.querySelectorAll(
    "#listaModelos li.nao-visto, #listaModelos li[data-status='nao-visto']"
  );

  atualizarBadgeHeader(itens.length);
}

document.getElementById("confirmarPagamento").onclick = async () => {
  const { error, paymentIntent } = await stripe.confirmPayment({
    elements,
    redirect: "if_required"
  });

  if (error) {
    alert(error.message);
    return;
  }

  // 🔓 pagamento confirmado → abrir conteúdo
  document.getElementById("paymentModal").classList.add("hidden");
  document.getElementById("payment-element").innerHTML = "";

  if (pagamentoAtual.message_id) {
    abrirConteudoSeguro(pagamentoAtual.message_id);
    pagamentoAtual = {};
  }
};


// ===============================
// ⚡ PIX — CONTEÚDO (BOTÃO)
// ===============================
function pagarComPix() {
  // 1️⃣ fecha popup de escolha
  document
    .getElementById("escolhaPagamento")
    .classList.add("hidden");

  // 2️⃣ valida dados salvos
  if (
    !pagamentoAtual ||
    !pagamentoAtual.message_id ||
    !pagamentoAtual.valor
  ) {
    alert("Conteúdo inválido");
    return;
  }

  // 3️⃣ chama Pix com dados CORRETOS
  abrirPixConteudo(
    pagamentoAtual.message_id,
    Number(pagamentoAtual.valor)
  );
}


let intervaloConfirmacaoPix = null;

async function abrirPixConteudo(message_id, preco) {
  if (!message_id || Number(preco) <= 0) {
    alert("Conteúdo inválido");
    return;
  }

  // 🔐 guarda estado do pagamento
  pagamentoAtual = {
    message_id: Number(message_id),
    preco: Number(preco)
  };

  // 💰 cálculos
  const taxaTransacao  = Number((preco * 0.10).toFixed(2));
  const taxaPlataforma = Number((preco * 0.05).toFixed(2));
  const valorTotal     = Number(
    (preco + taxaTransacao + taxaPlataforma).toFixed(2)
  );

  // 🧾 UI
  document.getElementById("pixValorBase").innerText = valorBRL(preco);
  document.getElementById("pixTaxaTransacao").innerText = valorBRL(taxaTransacao);
  document.getElementById("pixTaxaPlataforma").innerText = valorBRL(taxaPlataforma);
  document.getElementById("pixValorTotal").innerText = valorBRL(valorTotal);

  document.getElementById("popupPix").classList.remove("hidden");

  try {
    // 🔗 cria pagamento Pix
    const res = await fetch("/api/pagamento/conteudo/pix", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + localStorage.getItem("token")
      },
      body: JSON.stringify({ message_id })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Erro ao gerar PIX");
      return;
    }

    // 🧾 QR Code
    document.getElementById("pixQr").src =
      "data:image/png;base64," + data.qr_code;

    document.getElementById("pixCopia").value =
      data.copia_cola;

    // 🔁 POLLING — confirma pagamento pelo BANCO (verdade final)
    if (intervaloConfirmacaoPix) {
      clearInterval(intervaloConfirmacaoPix);
    }

    intervaloConfirmacaoPix = setInterval(async () => {
      try {
        const statusRes = await fetch(
          `/api/chat/conteudo-status/${pagamentoAtual.message_id}`,
          {
            headers: {
              Authorization: "Bearer " + localStorage.getItem("token")
            }
          }
        );

        if (!statusRes.ok) return;

        const status = await statusRes.json();

        if (status.liberado === true) {
          clearInterval(intervaloConfirmacaoPix);
          intervaloConfirmacaoPix = null;

          // 🔓 fecha popup
          fecharPopupPix();

          // 🔄 força atualização do chat
          socket.emit("conteudoVisto", {
            message_id: pagamentoAtual.message_id
          });

          pagamentoAtual = {};
        }
      } catch (err) {
        console.error("Erro polling Pix:", err);
      }
    }, 3000);

  } catch (err) {
    console.error("Erro Pix:", err);
    alert("Erro inesperado no Pix");
  }
}


async function pagarComCartao() {
  document.getElementById("escolhaPagamento").classList.add("hidden");

  if (!pagamentoAtual?.message_id) {
    alert("Conteúdo inválido");
    return;
  }

  const res = await fetch("/api/pagamento/conteudo/cartao", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + localStorage.getItem("token")
    },
    body: JSON.stringify({
      message_id: pagamentoAtual.message_id
    })
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.error || "Erro no pagamento");
    return;
  }

  // valores
  document.getElementById("cartaoValorConteudo").innerText =
    valorBRL(data.valor_base);

  document.getElementById("cartaoTaxaTransacao").innerText =
    valorBRL(data.taxa_transacao);

  document.getElementById("cartaoTaxaPlataforma").innerText =
    valorBRL(data.taxa_plataforma);

  document.getElementById("cartaoValorTotal").innerText =
    valorBRL(data.valor_total);

  // Stripe Elements
  elements = stripe.elements({
    clientSecret: data.clientSecret
  });

  const paymentElement = elements.create("payment");
  paymentElement.mount("#payment-element");

  document.getElementById("paymentModal").classList.remove("hidden");
}

function fecharPagamento() {
  const modal = document.getElementById("paymentModal");
  if (modal) modal.classList.add("hidden");

  // limpa Stripe Elements
  const el = document.getElementById("payment-element");
  if (el) el.innerHTML = "";

  elements = null;
}


function copiarPix() {
  const input = document.getElementById("pixCopia");

  if (!input || !input.value) {
    alert("Código Pix indisponível");
    return;
  }

  // método moderno
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(input.value)
      .then(() => {
        alert("Código Pix copiado!");
      })
      .catch(() => {
        fallbackCopiarPix(input);
      });
  } else {
    fallbackCopiarPix(input);
  }
}

function fallbackCopiarPix(input) {
  input.removeAttribute("readonly");
  input.select();
  input.setSelectionRange(0, 99999); // mobile
  document.execCommand("copy");
  input.setAttribute("readonly", true);

  alert("Código Pix copiado!");
}








