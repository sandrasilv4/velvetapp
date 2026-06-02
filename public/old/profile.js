const tokenAtual = localStorage.getItem("token");
const role = localStorage.getItem("role");
const params = new URLSearchParams(window.location.search);
const refParam = params.get("ref") || params.get("id");
const srcParam = params.get("src");

if (refParam) localStorage.setItem("ref_modelo", refParam);
if (srcParam) localStorage.setItem("origem_trafego", srcParam);

if (refParam || srcParam) {
  fetch("/api/track-acesso", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ref: refParam,
      src: srcParam,
      page: "perfil"
    })
  }).catch(() => {});
}


window.__CLIENTE_VIP__ = false;
let user_id = null;

// PERFIL PÚBLICO PARAM=ID NA URL
let modelo_id = null;

const modeloParam =
  params.get("modelo_id") || params.get("id");

modelo_id = Number(modeloParam);

if (!modelo_id || isNaN(modelo_id)) {
  console.warn("modelo_id inválido na URL");
  modelo_id = null;
} else {window.MODELO_ID_ATUAL = modelo_id;

}

/////PERFIL ///
const btnUpload = document.querySelector(".btn-mais");
const avatarImg  = document.getElementById("profileAvatar");
const capaImg    = document.getElementById("profileCapa");
const nomeEl     = document.getElementById("profileName");
const profileBio = document.getElementById("profileBio");
const inputAvatar = document.getElementById("inputAvatar");
const inputCapa   = document.getElementById("inputCapa");
const listaMidias = document.getElementById("listaMidias");
const btnVip  = document.getElementById("btnVip");
const btnSalvarBio = document.getElementById("btnSalvarBio");
const bioInput     = document.getElementById("bioInput");
const localEl = document.getElementById("local-texto");
const inputUpload = document.getElementById("inputUpload");


///////////////////////////////// FUNCOES ///////////////////////////////////
function exigirCadastro(motivo = "Para continuar, crie sua conta") {
  console.log("🔥 exigirCadastro chamado");
  window.AUTH_MENSAGEM = motivo;
  openAgeGate("register");
}

function exigirLogin() {
  console.error("openAgeGate não carregado");
  openAgeGate("login");
}

function adicionarMidia(conteudo, contexto) {

  const { ehDona, ehVip } = contexto;

  const {
    id,
    url,
    tipo,
    tipo_conteudo,
    thumbnail_url,
    preco,
    descricao
  } = conteudo;

  const isVenda = tipo_conteudo === "venda";
  const isVideo = tipo === "video";

  const card = document.createElement("div");
  card.className = "midiaCard";

  // ===============================
  // 🎨 WRAPPER VISUAL
  // ===============================

  const mediaWrapper = document.createElement("div");
  mediaWrapper.className = "midiaWrapper";

  const img = document.createElement("img");
  img.className = "midiaThumb";
  img.src = isVideo
    ? getVideoThumbnail(url, thumbnail_url)
    : url;

  img.onerror = () => {
    img.src = "/assets/capa.png";
  };

  mediaWrapper.appendChild(img);

  // PREÇO (SÓ ESPECIAL)
  if (isVenda && preco) {
    const priceTag = document.createElement("div");
    priceTag.className = "midia-preco";
    priceTag.textContent = `R$ ${Number(preco).toFixed(2)}`;
    mediaWrapper.appendChild(priceTag);
  }

  card.appendChild(mediaWrapper);

  // DESCRIÇÃO (SÓ ESPECIAL)
  if (isVenda && descricao) {
    const desc = document.createElement("div");
    desc.className = "midia-descricao";
    desc.textContent = descricao;
    card.appendChild(desc);
  }

  // ===============================
  // 🔒 DEFINIR BLOQUEIO
  // ===============================

  let bloqueado = false;

  if (!ehDona) {
    if (isVenda) bloqueado = true;
    if (!isVenda && !ehVip) bloqueado = true;
  }

  if (bloqueado) {
    card.classList.add("locked");
  }
  else {
  card.classList.remove("locked");
}

  // ===============================
  // 🔥 BOTÃO EXCLUIR (SÓ DONA)
  // ===============================

  if (ehDona) {
    const btnExcluir = document.createElement("button");
    btnExcluir.className = "btnExcluirMidia";
    btnExcluir.textContent = "✕";

    btnExcluir.onclick = (e) => {
      e.stopPropagation();
      excluirMidia(id, card);
    };

    card.appendChild(btnExcluir);
  }

  // ===============================
  // 🖱️ COMPORTAMENTO DE CLIQUE
  // ===============================

  card.onclick = () => {
const tokenAtual = localStorage.getItem("token");

  // 👀 VISITANTE
  if (!tokenAtual) {
    return; 
  }

  const role = localStorage.getItem("role");
  const modeloLogado = Number(localStorage.getItem("modelo_id"));

  if (role === "modelo" && modeloLogado !== modelo_id) {
    alert("No momento, modelo não pode assinar ou ver conteúdo exclusivo de outra modelo. Estamos trabalhando para que isso seja possível!!💜");
    return;
  }

    if (ehDona) {
      abrirModalMidia(url, isVideo);
      return;
    }

    if (isVenda) {
      abrirPopupPagamentoVenda(conteudo);
      return;
    }

    if (!ehVip) {
      abrirFluxoVIP();
      return;
    }

    abrirModalMidia(url, isVideo);
  };

  // ===============================
  // 📦 GRID DESTINO
  // ===============================

  const gridDestino =
    isVenda
      ? document.getElementById("midias-paid")
      : document.getElementById("listaMidias");

  gridDestino?.appendChild(card);
}

async function aplicarRegrasDeAcesso() {
  const ofertaCard = document.getElementById("oferta-card");
  const btnAssinar = document.getElementById("btn-assinar");

  const tokenAtual = localStorage.getItem("token");

  // Estado padrão
  window.__CLIENTE_VIP__ = false;

  const ehModelo = role === "modelo";
  const ehCliente = role === "cliente";

  // ⚠️ DONA DO PERFIL
  const modeloLogado = Number(localStorage.getItem("modelo_id"));
  const ehDona = ehModelo && modeloLogado === modelo_id;

  // ===============================
  // 🟣 MODELO DONA DO PERFIL
  if (ehDona) {

    window.__CLIENTE_VIP__ = false;

    if (ofertaCard) ofertaCard.style.display = "block";

    if (btnAssinar) {
      btnAssinar.disabled = false;
      btnAssinar.style.cursor = "not-allowed";
      btnAssinar.textContent =
    `Assinar VIP por ${valorBRL(OFERTA_ATUAL.valor_promocional)}`;
    }

    return;
  }

  // ===============================
  // 👀 VISITANTE
  if (!tokenAtual) {
    if (ofertaCard) ofertaCard.style.display = "block";
    return;
  }

  // ===============================
  // 🔵 CLIENTE OU MODELO vendo outro perfil
if (ehCliente || ehModelo) {

  try {

    const res = await fetch(`/api/vip/status/${modelo_id}`, {
      headers: {
        Authorization: "Bearer " + tokenAtual
      }
    });

    const data = res.ok ? await res.json() : { vip: false };
    const vip = data.vip;

    const vipCard = document.getElementById("vip-card");
    const ofertaCard = document.getElementById("oferta-card");

    if (vip) {

      window.__CLIENTE_VIP__ = true;

      // 🔥 Esconde oferta normal
      if (ofertaCard) ofertaCard.style.display = "none";

      // 🔥 Mostra card exclusivo VIP
      if (vipCard) vipCard.classList.remove("hidden");

    } else {

      window.__CLIENTE_VIP__ = false;

      // 🔥 Mostra oferta normal
      if (ofertaCard) ofertaCard.style.display = "block";

      // 🔥 Esconde card VIP
      if (vipCard) vipCard.classList.add("hidden");

      if (btnAssinar) {
        btnAssinar.disabled = false;

        if (window.OFERTA_ATUAL) {
          btnAssinar.textContent =
            `Assinar VIP por ${valorBRL(window.OFERTA_ATUAL.valor_promocional)}`;
        }
      }

    }

  } catch (err) {

    console.error("Erro ao verificar VIP:", err);

    window.__CLIENTE_VIP__ = false;

    const vipCard = document.getElementById("vip-card");
    const ofertaCard = document.getElementById("oferta-card");

    if (ofertaCard) ofertaCard.style.display = "block";
    if (vipCard) vipCard.classList.add("hidden");

  }
}
}

async function carregarPerfilBase() {

  if (!modelo_id) {
    console.warn("modelo_id inválido");
    return;
  }

  const res = await fetch(`/api/modelo/publico/${modelo_id}`);

  if (!res.ok) {
    throw new Error("Perfil não encontrado");
  }

  const modelo = await res.json();

  aplicarPerfilNoDOM(modelo);
}

async function iniciarPerfil() {
  try {

    await carregarPerfilBase();

    // ⚠️ não usar user_id público, só verificar MODELO_ID_ATUAL
    if (!modelo_id) {
      throw new Error("IDs do perfil não definidos corretamente");
    }
    await carregarOfertaAtiva();
    await aplicarRegrasDeAcesso();
    await carregarFeedBase();

  } catch (err) {
    console.error("🔥 ERRO AO INICIAR PERFIL 🔥");
    console.error(err);

    // fallback visual mínimo
    const lista = document.getElementById("listaMidias");
    if (lista) {
      lista.innerHTML =
        "<p style='padding:20px;text-align:center;'>Erro ao carregar perfil.</p>";
    }
  }
}

function aplicarPerfilNoDOM(modelo) {
  console.log("Avatar vindo do backend:", modelo.avatar);

  if (nomeEl)
    nomeEl.textContent = modelo.nome_exibicao || "";

  if (profileBio)
    profileBio.textContent = modelo.bio || "";

  if (avatarImg)
    avatarImg.src = modelo.avatar || "/assets/avatar.png";

  if (capaImg)
    capaImg.src = modelo.capa || "/assets/capa.png";

  const localEl = document.getElementById("local-texto");

  if (localEl && localEl.parentElement) {
    const local = [modelo.local]
      .filter(Boolean)
      .join(" • ");

    localEl.textContent = local || "";
    localEl.parentElement.style.display = local ? "" : "none";
  }

  // ===============================
  // 🌐 REDES SOCIAIS
  const igLink = document.getElementById("link-instagram");
  const ttLink = document.getElementById("link-tiktok");

  // Instagram
  if (igLink) {
    const igUser = modelo.instagram?.replace("@", "");
    if (igUser) {
      igLink.href = `https://instagram.com/${igUser}`;
      igLink.style.display = "inline-block";
    } else {
      igLink.style.display = "none";
    }
  }

  // TikTok
  if (ttLink) {
    const ttUser = modelo.tiktok?.replace("@", "");
    if (ttUser) {
      ttLink.href = `https://www.tiktok.com/@${ttUser}`;
      ttLink.style.display = "inline-block";
    } else {
      ttLink.style.display = "none";
    }
  }
}

// ===============================
// DOM
document.addEventListener("DOMContentLoaded", async () => {

  const btnAssinar = document.getElementById("btn-assinar");
  const btnUpload = document.getElementById("btn-upload");
  const tokenAtual = localStorage.getItem("token");

  aplicarRoleNoBody();

  try {
    await iniciarPerfil();
  } catch (err) {
    console.error("Erro ao iniciar perfil:", err);
    return;
  }
  
const modeloLogado = Number(localStorage.getItem("modelo_id"));
const ehDona = role === "modelo" && tokenAtual && modeloLogado === modelo_id;

// 🔒 Remove botão upload se não for DONA do perfil
if (!ehDona) {
  btnUpload?.remove();
}


  // 🔁 Pós-registro
  const postRegisterAction = localStorage.getItem("post_register_action");

  if (postRegisterAction === "open_payment") {
    localStorage.removeItem("post_register_action");
    window.abrirFluxoVIP();
  }

  // 👑 Botão assinar
btnAssinar?.addEventListener("click", () => {
  const tokenAtual = localStorage.getItem("token");

if (!tokenAtual) {
  abrirPopupLoginObrigatorio();
  return;
}

  const role = localStorage.getItem("role");
  const modeloLogado = Number(localStorage.getItem("modelo_id"));

  // 🚫 Modelo vendo perfil de outra modelo
  if (role === "modelo" && modeloLogado !== modelo_id) {
    alert("No momento, modelo não pode assinar ou ver conteúdo exclusivo de outra modelo. Estamos trabalhando para que isso seja possível!!💜");
    return;
  }

  if (window.__CLIENTE_VIP__) {
    window.location.href = `/chatc.html?modelo_id=${modelo_id}`;
    return;
  }

  window.abrirFluxoVIP();
});


  // ===============================
  // 📂 TABS DE MÍDIAS
  const tabs = document.querySelectorAll(".midias-tabs .tab");

  tabs.forEach(tab => {

    tab.addEventListener("click", () => {

      tabs.forEach(t => t.classList.remove("active"));

      document
        .querySelectorAll(".midias-grid")
        .forEach(g => g.classList.remove("active"));

      tab.classList.add("active");

      const tipo = tab.dataset.tab;

      if (tipo === "free") {
        document
          .getElementById("listaMidias")
          ?.classList.add("active");
      }

      if (tipo === "paid") {
        document
          .getElementById("midias-paid")
          ?.classList.add("active");
      }

    });

  });
  document.getElementById("btn-vip-chat")?.addEventListener("click", () => {
  window.location.href = `/chatc.html?modelo_id=${modelo_id}`;
});


});


// =================================
// 🔗 Link genérico "Assinar VIP"

document.addEventListener("click", (e) => {

  const linkVip = e.target.closest(".link-assinar-vip");
  if (!linkVip) return;

  e.preventDefault();

  const tokenAtual = localStorage.getItem("token");

  if (!tokenAtual) {
    abrirPopupLoginObrigatorio();
    return;
  }

  window.abrirFluxoVIP();

});

function aplicarRoleNoBody() {
  const body = document.body;
  body.classList.remove("role-modelo", "role-cliente", "role-publico");

  const roleClass = role === "modelo"
    ? "role-modelo"
    : role === "cliente"
      ? "role-cliente"
      : "role-publico";

  body.classList.add(roleClass);
}

function valorBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}


let OFERTA_ATUAL = null;
async function carregarOfertaAtiva() {
  console.log("🧪 carregarOfertaAtiva chamado com modelo_id =", modelo_id);

  const ofertaCard = document.getElementById("oferta-card");
  const btnAssinar = document.getElementById("btn-assinar");
  const precoDescontoEl = document.getElementById("preco-desconto");
  const precoOriginalEl = document.getElementById("preco-original");
  const descontoEl = document.getElementById("oferta-desconto");

 if (!ofertaCard) {
  console.warn("ofertaCard não encontrado");
  return;
}
  try {
    const res = await fetch(`/api/ofertas/ativa/${modelo_id}`);

    if (!res.ok) {
      ofertaCard.style.display = "none";
      OFERTA_ATUAL = null;
      return;
    }

    const data = await res.json();

    if (!data.ativa) {

  const valor = Number(data.valor_base) || 20;

  OFERTA_ATUAL = {
    valor_base: valor,
    valor_promocional: valor,
    desconto_percentual: 0
  };

  if (precoDescontoEl)
    precoDescontoEl.textContent = valorBRL(valor);

  if (precoOriginalEl)
    precoOriginalEl.textContent = "";

  if (descontoEl)
    descontoEl.style.display = "none";

  if (btnAssinar)
    btnAssinar.textContent =
      `Assinar VIP por ${valorBRL(valor)}`;

  ofertaCard.style.display = "block";
  return;
}
    const oferta = data.oferta;
    OFERTA_ATUAL = {
      id: oferta.id,
      modelo_id: oferta.modelo_id,
      valor_base: Number(oferta.valor_base),
      valor_promocional: Number(oferta.valor_promocional),
      desconto_percentual: Number(oferta.desconto_percentual || 0)
    };
      window.OFERTA_ATUAL = OFERTA_ATUAL;

    if (descontoEl && OFERTA_ATUAL.desconto_percentual > 0) {
      descontoEl.textContent = `Economize ${OFERTA_ATUAL.desconto_percentual}%`;
      descontoEl.style.display = "inline-block";
    } else if (descontoEl) {
      descontoEl.style.display = "none";
    }

    if (precoDescontoEl) {
  precoDescontoEl.textContent =
    valorBRL(OFERTA_ATUAL.valor_promocional);
}

if (precoOriginalEl) {
  precoOriginalEl.textContent =
    valorBRL(OFERTA_ATUAL.valor_base);
}

    ofertaCard.style.display = "block";

    if (btnAssinar) {
  btnAssinar.disabled = false;
  btnAssinar.textContent =
    `Assinar VIP por ${valorBRL(OFERTA_ATUAL.valor_promocional)}`;
}

  } catch (err) {
    console.error("Erro ao carregar oferta:", err);
    ofertaCard.style.display = "none";
    OFERTA_ATUAL = null;
  }
}

// ===============================
// UPLOAD AVATAR
inputAvatar?.addEventListener("change", async () => {

  const file = inputAvatar.files?.[0];
  if (!file) return;

  const tokenAtual = localStorage.getItem("token");
  if (!tokenAtual) {
    abrirPopupLoginObrigatorio();
    return;
  }

  const fd = new FormData();
  fd.append("avatar", file);

  try {
    const res = await fetch("/uploadAvatar", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + tokenAtual
      },
      body: fd
    });

    const data = await res.json();
  
  if (data.avatar && avatarImg) {
  avatarImg.src = data.avatar + "?t=" + Date.now(); // evita cache
} else {
  alert("Erro ao atualizar avatar");
}

  } catch (err) {
    console.error("Erro upload avatar:", err);
    alert("Erro ao enviar avatar");
  }

});


// ===============================
// UPLOAD CAPA
inputCapa?.addEventListener("change", async () => {
  const file = inputCapa.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append("capa", file);

  const res = await fetch("/uploadCapa", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: fd
  });

  const data = await res.json();

  if (data.capa) {
    capaImg.src = data.capa + "?t=" + Date.now();
  }
});

// ===============================
// MIDIA
// function abrirModalVenda(c) {
//   const modal = document.createElement("div");
//   modal.className = "modal-midia";
//   modal.innerHTML = `
//     <div class="modal-backdrop"></div>

//     <div class="modal-conteudo venda-modal">
//       <img
//         src="${getVideoThumbnail(c.url, c.thumbnail_url)}"
//         class="midia-thumb"
//       >

//       <h3>Conteúdo Exclusivo</h3>
//       <p>${c.descricao || "Conteúdo exclusivo para desbloqueio"}</p>

//       <button class="btn-comprar">
//         Desbloquear por R$ ${Number(c.preco).toFixed(2)}
//       </button>
//     </div>
//   `;

//   modal.querySelector(".modal-backdrop").onclick = () => modal.remove();
//   document.body.appendChild(modal);
// }

//CARREGAR MIDIAS //
  btnUpload?.addEventListener("click", (e) => {
    e.preventDefault();
    inputUpload?.click();
  });

  inputUpload?.addEventListener("change", () => {
  const file = inputUpload.files[0];
  if (!file) return;

  if (!validarMidia(file)) {
    inputUpload.value = "";
    return;
  }

  const url = URL.createObjectURL(file);
  abrirPreviewUpload(file, url);

  inputUpload.value = "";
});


function validarMidia(file) {
  const maxSize = 50 * 1024 * 1024; // 50MB
  if (file.size > maxSize) {
    alert("Arquivo muito grande");
    return false;
  }
  return true;
}

function abrirPopupLoginObrigatorio() {

  const modal = document.createElement("div");
  modal.className = "modal-login-obrigatorio";

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-box-login">
      <h3>🔒 Acesso necessário</h3>
      <p>É necessário estar logado para esta ação.</p>

      <div class="login-acoes">
        <button class="btn-login">Ja tenho conta</button>
        <button class="btn-register">Não tenho conta</button>
      </div>
    </div>
  `;

  modal.querySelector(".modal-backdrop").onclick = () => modal.remove();

modal.querySelector(".btn-login").onclick = () => {
  modal.remove();

  // 🔥 SALVA QUE DEVE ABRIR VIP DEPOIS DO LOGIN
  localStorage.setItem("post_login_action", "open_vip_payment");

  if (typeof openAgeGate === "function") {
    openAgeGate("login");
  } else {
    console.error("openAgeGate não carregado ainda");

    const intervalo = setInterval(() => {
      if (typeof openAgeGate === "function") {
        clearInterval(intervalo);
        openAgeGate("login");
      }
    }, 100);
  }
};


modal.querySelector(".btn-register").onclick = () => {
  modal.remove();

  // 🔥 SALVA QUE DEVE ABRIR VIP DEPOIS DO REGISTRO
  localStorage.setItem("post_login_action", "open_vip_payment");

  openAgeGate("register");
};


  document.body.appendChild(modal);
}

function abrirPreviewUpload(file, url) {
  const modal = document.createElement("div");
  modal.className = "modal-midia";

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-conteudo upload-preview">
  <button type="button" class="modal-close-upload">✕</button>

      ${
        file.type.startsWith("video")
          ? `<video src="${url}" controls autoplay muted playsinline></video>`
          : `<img src="${url}">`
      }

      <div class="upload-box">
        <p class="upload-titulo">Escolha onde deseja adicionar a mídia:</p>

        <div class="upload-opcoes">
          <button type="button" class="upload-tab active" data-value="feed">🎁 Pra você</button>
          <button type="button" class="upload-tab" data-value="venda">🔥 Especial</button>
        </div>

        <input type="hidden" name="tipo_conteudo" value="feed">

        <div class="upload-especial hidden">
          <input
            type="number"
            id="upload-preco"
            placeholder="Preço (R$)"
            min="0"
            step="0.01"
          >
          <textarea
            id="upload-descricao"
            placeholder="Descrição do conteúdo"
            rows="3"
          ></textarea>
        </div>

        <button type="button" class="btn-confirmar">Publicar</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  const fecharModal = () => {
    URL.revokeObjectURL(url);
    modal.remove();
  };

  modal.querySelector(".modal-backdrop")
    .addEventListener("click", fecharModal);

modal.querySelector(".modal-close-upload")
  ?.addEventListener("click", (e) => {
    e.stopPropagation();
    fecharModal();
  });


  const tabs = modal.querySelectorAll(".upload-tab");
  const hiddenTipo = modal.querySelector("input[name='tipo_conteudo']");
  const boxEspecial = modal.querySelector(".upload-especial");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      tabs.forEach(t => t.classList.remove("active"));
      tab.classList.add("active");

      const valor = tab.dataset.value;
      hiddenTipo.value = valor;
      boxEspecial.classList.toggle("hidden", valor !== "venda");
    });
  });

  const btnPublicar = modal.querySelector(".btn-confirmar");

  btnPublicar.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    console.log("CLIQUE OK");
    console.log("FILE:", file);

    btnPublicar.disabled = true;
    btnPublicar.textContent = "Enviando...";

    try {
      const tipoConteudo = hiddenTipo.value;
      const preco = modal.querySelector("#upload-preco")?.value;
      const descricao = modal.querySelector("#upload-descricao")?.value;

      if (tipoConteudo === "venda" && (!preco || Number(preco) <= 0)) {
        alert("Informe um preço válido");
        btnPublicar.disabled = false;
        btnPublicar.textContent = "Publicar";
        return;
      }

      await enviarMidia(file, {
        tipo_conteudo: tipoConteudo,
        preco,
        descricao
      });

      if (role === "modelo") {
        await carregarFeedBase();

        if (tipoConteudo === "venda") {
          document.querySelector('[data-tab="paid"]')?.click();
        } else {
          document.querySelector('[data-tab="free"]')?.click();
        }
      }

      fecharModal();

    } catch (err) {
      console.error("Erro no upload:", err);
      btnPublicar.disabled = false;
      btnPublicar.textContent = "Publicar";
      alert("Erro ao enviar mídia");
    }
  });
}

async function carregarFeedBase() {
  if (!modelo_id) return;

  const listaFree = document.getElementById("listaMidias");
  const listaPaid = document.getElementById("midias-paid");

  if (listaFree) listaFree.innerHTML = "";
  if (listaPaid) listaPaid.innerHTML = "";

  const res = await fetch(`/api/modelo/publico/${modelo_id}/feed`);
  const feed = await res.json();

  console.log("FEED:", feed);

  const ehVip = window.__CLIENTE_VIP__ === true;

  const role = localStorage.getItem("role");
  const modeloLogado = Number(localStorage.getItem("modelo_id"));

  const ehDona = role === "modelo" && modeloLogado === modelo_id;

  feed.forEach(conteudo => {
    adicionarMidia(conteudo, {
      ehDona,
      ehVip
    });

  });
}

function mostrarLoading() {
  document.body.classList.add("loading");
}

function esconderLoading() {
  document.body.classList.remove("loading");
}

async function enviarMidia(file, dados = {}) {

  console.log("=== ENVIAR MIDIA CHAMADO ===");

  const tokenAtual = localStorage.getItem("token");
  const role = localStorage.getItem("role");

  console.log("Token existe?", !!tokenAtual);
  console.log("Role:", role);
  console.log("File recebido:", file);

  if (!file) {
    throw new Error("Arquivo não recebido");
  }

  if (!tokenAtual || role !== "modelo") {
    throw new Error("Upload não autorizado");
  }

  const formData = new FormData();
  formData.append("file", file);

  if (dados.tipo_conteudo) {
    formData.append("tipo_conteudo", dados.tipo_conteudo);
  }

  if (dados.tipo_conteudo === "venda") {
    formData.append("preco", dados.preco || 0);
    formData.append("descricao", dados.descricao || "");
  }

  console.log("Enviando para /api/upload ...");

  const res = await fetch("/api/upload", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + tokenAtual
    },
    body: formData
  });

  console.log("Status da resposta:", res.status);

  const texto = await res.text();
  console.log("Resposta do servidor:", texto);

  if (!res.ok) {
    throw new Error(texto);
  }

  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}


function getVideoThumbnail(url, thumbnail_url) {
  if (thumbnail_url) return thumbnail_url;
  return "/assets/capa.png";
}


function abrirModalMidia(url, isVideo) {
  const modal = document.getElementById("modalMidia");
  const img = document.getElementById("modalImg");
  const video = document.getElementById("modalVideo");

  img.style.display = "none";
  video.style.display = "none";

  video.pause();
  video.src = "";
  img.src = "";

  if (isVideo) {
    video.src = url;
    video.style.display = "block";
    video.play();
  } else {
    img.src = url;
    img.style.display = "block";
  }

  modal.classList.remove("hidden");
}

window.abrirFluxoVIP = function () {
  fecharPopupPagamento?.();
  document.getElementById("modalMidia")?.classList.add("hidden");

  const role = localStorage.getItem("role");

  if (!role) {
    exigirCadastro("Crie sua conta para assinar o perfil e acessar tudo 💜");
    return;
  }

  if (!modelo_id) {
    alert("Erro ao identificar modelo.");
    return;
  }

  window.PAGAMENTO_TIPO_ATUAL = "vip";

  const valorBase = window.OFERTA_ATUAL?.valor_base ?? 20;
  const valorPromocional =
    window.OFERTA_ATUAL?.valor_promocional ?? valorBase;

  preencherResumoVIP({
    valorBase: valorBase,
    desconto: valorBase - valorPromocional
  });

  abrirPopupPagamento();
};

document.getElementById("fecharModal")?.addEventListener("click", (e) => {
  e.stopPropagation(); 

  const modal = document.getElementById("modalMidia");
  const video = document.getElementById("modalVideo");

  video.pause();
  video.src = "";

  modal.classList.add("hidden");
});

async function excluirMidia(id, card) {

  if (!confirm("Excluir esta mídia?")) return;

  const tokenAtual = localStorage.getItem("token");
  const role = localStorage.getItem("role");

  if (!tokenAtual || role !== "modelo") {
    alert("Ação não autorizada");
    return;
  }

  const res = await fetch(`/api/conteudos/${id}`, {
    method: "DELETE",
    headers: {
      Authorization: "Bearer " + tokenAtual
    }
  });

  if (res.ok) {
    card?.remove();
  } else {
    alert("Erro ao excluir mídia");
  }
}

function atualizarUIVip() {

  const btnAssinar = document.getElementById("btn-assinar");
  const ofertaCard = document.getElementById("oferta-card");
  const vipCard = document.getElementById("vip-card");

  window.__CLIENTE_VIP__ = true;

  // 🔥 Atualiza botão
  if (btnAssinar) {
    btnAssinar.textContent = "VIP ativo!!";
    btnAssinar.disabled = true;
    btnAssinar.style.cursor = "default";
  }

  // 🔥 Esconde oferta
  if (ofertaCard) {
    ofertaCard.style.display = "none";
  }

  // 🔥 Mostra card VIP
  if (vipCard) {
    vipCard.classList.remove("hidden");
  }

  console.log("💎 UI VIP atualizada com sucesso");
}


// async function pagarComCartaoRecorrente() {
//   fecharEscolha();

//   // 🔓 ABRE MODAL
//   document.getElementById("paymentModal").classList.remove("hidden");

//   // 🔁 CRIA ASSINATURA (NÃO payment intent)
//   const res = await fetch("/api/vip/cartao/assinatura", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: "Bearer " + tokenAtual
//     },
//     body: JSON.stringify({
//       modelo_id
//     })
//   });

//   const data = await res.json();

//   if (!res.ok) {
//     alert(data.error || "Erro ao criar assinatura");
//     return;
//   }

//   // 🔐 USA O clientSecret DA ASSINATURA
//   elements = stripe.elements({ clientSecret: data.clientSecret });

//   const paymentElement = elements.create("payment");
//   paymentElement.mount("#payment-element");
// }


// window.abrirPopupPagamento = function () {
//   const popup = document.getElementById("popupPagamentoVelvet");
//   if (!popup) return;

//   popup.classList.remove("hidden");

//   // reset visual
//   document.querySelector(".vip-detalhes")?.classList.add("hidden");
//   document.querySelector(".midia-detalhes")?.classList.add("hidden");
//   document.querySelector(".velvet-tabs")?.classList.remove("hidden");
//   document.getElementById("conteudoPix")?.classList.remove("hidden");
//   document.getElementById("conteudoCartao")?.classList.add("hidden");

//   // ===============================
//   // 🔥 MÍDIA
//   // ===============================
//   if (window.PAGAMENTO_TIPO_ATUAL === "midia") {
//     document.querySelector(".velvet-tabs")?.classList.add("hidden");
//     document.getElementById("conteudoPix")?.classList.add("hidden");
//     document.getElementById("conteudoCartao")?.classList.remove("hidden");

//     document.querySelector(".midia-detalhes")?.classList.remove("hidden");

//     iniciarCartaoMidia();
//     return;
//   }

  // ===============================
  // 💎 VIP
  // ===============================
//   if (window.PAGAMENTO_TIPO_ATUAL === "vip") {
//     document.querySelector(".vip-detalhes")?.classList.remove("hidden");
//     mostrarMetodo("pix");
//     return;
//   }
// };

// window.fecharPopupPagamento = function () {
//   const popup = document.getElementById("popupPagamentoVelvet");
//   if (!popup) return;

//   popup.classList.add("hidden");

//   document.getElementById("pixLoading")?.classList.add("hidden");
//   document.getElementById("pixAguardando")?.classList.add("hidden");
//   document.getElementById("pixSucesso")?.classList.add("hidden");

//   document.getElementById("cartaoLoading")?.classList.add("hidden");
//   document.getElementById("formCartao")?.classList.add("hidden");
//   document.getElementById("cartaoSucesso")?.classList.add("hidden");
// };



