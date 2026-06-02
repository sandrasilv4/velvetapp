const token = localStorage.getItem("token");
const role = localStorage.getItem("role");

let modelo_id = null;
let EH_DONA = false;
let btnAssinar = null;

if (token && window.io) {
  const socket = io({
    transports: ["websocket"],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000
  });

  window.socket = socket;

  socket.on("connect", () => {
    socket.emit("auth", { token });
  });

  socket.on("authOk", () => {
    console.log("Socket autenticado no perfil");
  });

  socket.on("disconnect", () => {
    console.log("Socket desconectado no perfil");
  });
}

function getEstadoAcessoPerfil() {
  const tokenAtual = localStorage.getItem("token");
  const roleAtual = localStorage.getItem("role");
  const modeloLogado = Number(localStorage.getItem("modelo_id"));
  
  if (typeof registrarOrigemTrafego === "function") {
  registrarOrigemTrafego({
    modelo_id,
    pagina: "perfil"
  });
}

  const ehVisitante = !tokenAtual;
  const ehModelo = roleAtual === "modelo";
  const ehCliente = roleAtual === "cliente";
  const ehDona = ehModelo && modeloLogado === modelo_id;
  const ehModeloVisitandoOutra = ehModelo && !ehDona;
  const ehVip = !!window.__CLIENTE_VIP__;

  return {
    tokenAtual,
    roleAtual,
    ehVisitante,
    ehModelo,
    ehCliente,
    ehDona,
    ehModeloVisitandoOutra,
    ehVip
  };
}

function podeVerFeed() {
  const s = getEstadoAcessoPerfil();
  return s.ehDona || (s.ehCliente && s.ehVip);
}

function podeAbrirChat() {
  const s = getEstadoAcessoPerfil();
  return s.ehDona || (s.ehCliente && s.ehVip);
}

function podeComprarPremium() {
  const s = getEstadoAcessoPerfil();
  return s.ehCliente && s.ehVip;
}

function podeVerPremiumLiberado(item) {
  const s = getEstadoAcessoPerfil();
  return s.ehDona || item.liberado === true;
}

function tratarAcaoProtegidaPremium() {
  const s = getEstadoAcessoPerfil();

  if (s.ehVisitante) {
    abrirPopupPremiumBloqueadoVisitante();
    return false;
  }

  if (s.ehModeloVisitandoOutra) {
    alert(t("perfil.alert_modelo_premium"));
    return false;
  }

  if (!s.ehVip) {
    alert(t("perfil.alert_so_vip_premium"));
    abrirFluxoVIP();
    return false;
  }

  return true;
}

function abrirPopupPremiumBloqueadoVisitante() {
  const modal = document.createElement("div");
  modal.className = "modal-login-obrigatorio";

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-box-login">
      <h3>${t("perfil.modal_premium_titulo")}</h3>
      <p>${t("perfil.modal_premium_desc1")}</p>
      <p style="margin-top:-10px;">${t("perfil.modal_premium_desc2")}</p>

      <div class="login-acoes">
        <button class="btn-login">${t("perfil.btn_ja_tenho_conta")}</button>
        <button class="btn-register">${t("perfil.btn_criar_conta")}</button>
      </div>
    </div>
  `;

  modal.querySelector(".modal-backdrop").onclick = () => modal.remove();

  modal.querySelector(".btn-login").onclick = () => {
    modal.remove();
    salvarRetornoPerfilAcao("vip");
    if (typeof openAgeGate === "function") openAgeGate("login");
  };

  modal.querySelector(".btn-register").onclick = () => {
    modal.remove();
    salvarRetornoPerfilAcao("vip");
    if (typeof openAgeGate === "function") openAgeGate("register");
  };

  document.body.appendChild(modal);
}

function tratarAcaoProtegidaFeedOuChat() {
  const s = getEstadoAcessoPerfil();

  if (s.ehVisitante) {
    abrirPopupLoginObrigatorio();
    return false;
  }

  if (s.ehModeloVisitandoOutra) {
    alert(t("perfil.alert_modelo_feed"));
    return false;
  }

  if (!s.ehVip) {
    abrirFluxoVIP();
    return false;
  }

  return true;
}

function salvarRetornoPerfilAcao(acao = "vip") {
  const destino = `/perfil.html?modelo_id=${modelo_id}`;

  localStorage.setItem("post_login_action", JSON.stringify({
    tipo: acao,
    redirect: destino,
    modelo_id
  }));

  localStorage.setItem("post_register_action", JSON.stringify({
    tipo: acao,
    redirect: destino,
    modelo_id
  }));

  localStorage.setItem("redirect_after_auth", destino);
}


function atualizarBotaoVip(expiration_at) {
  const btn = document.getElementById("btn-assinar");
  const ofertaCard = document.getElementById("oferta-card");
  const vipCard = document.getElementById("vip-card");
  const vipChatBtn = document.getElementById("btn-vip-chat");

 if (btn) {
    btn.innerText = t("perfil.vip_ativo_btn");
    btn.disabled = true;
    btn.classList.add("vip-ativo");
    btn.style.cursor = "default";
  }

  if (ofertaCard) ofertaCard.style.display = "none";
  if (vipCard) vipCard.classList.remove("hidden");

  if (vipChatBtn) {
    vipChatBtn.disabled = false;
  }

  if (expiration_at) {
    console.log("VIP ativo até:", new Date(expiration_at).toLocaleDateString("pt-BR"));
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  await whenI18nReady();
btnAssinar = document.getElementById("btn-assinar");

  // FEED
  document.getElementById("uploadClose")?.addEventListener("click", () => {
    document.getElementById("popupUploadFeed").classList.add("hidden");
  });

  document.getElementById("uploadBackdrop")?.addEventListener("click", () => {
    document.getElementById("popupUploadFeed").classList.add("hidden");
  });

  // PREMIUM
  document.getElementById("premiumClose")?.addEventListener("click", () => {
    document.getElementById("popupUploadPremium").classList.add("hidden");
  });

  document.getElementById("premiumBackdrop")?.addEventListener("click", () => {
    document.getElementById("popupUploadPremium").classList.add("hidden");
  });

document.getElementById("fecharModal")?.addEventListener("click", (e) => {
  e.stopPropagation();
  fecharModalMidia();
});

  // fechar clicando fora
document.querySelector("#modalMidia .modal-backdrop")
?.addEventListener("click", fecharModalMidia);


  // =========================
  // PARAMETROS URL
  // =========================

  const params = new URLSearchParams(window.location.search);
  modelo_id = Number(params.get("modelo_id") || params.get("id"));

  if (!modelo_id) {
    console.warn("modelo_id não encontrado na URL");
    return;
  }
  window.MODELO_ID_ATUAL = modelo_id;

  // =========================
  // VERIFICAR SE É DONA
  // =========================

  const modeloLogado = Number(localStorage.getItem("modelo_id"));
  EH_DONA = role === "modelo" && modeloLogado === modelo_id;

  if (!EH_DONA) {
    document.getElementById("btn-upload")?.remove();
  }

  if (EH_DONA) {
    const meRes = await fetch("/api/modelo/me", { headers: { Authorization: "Bearer " + token } });
    if (meRes.ok) {
      const me = await meRes.json();
      if (!me.verificada) {
        // Deixa os botões visíveis mas intercepta o clique com popup
        ["btn-upload", "btnEnviarFeed", "btnEnviarPremium"].forEach(id => {
          const el = document.getElementById(id);
          if (!el) return;
          el.style.opacity = "0.55";
          el.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            abrirPopupContaNaoVerificada();
          }, true);
        });
        ["fileFeed", "filePremium"].forEach(id => {
          const el = document.getElementById(id);
          if (el) el.addEventListener("click", (e) => { e.preventDefault(); abrirPopupContaNaoVerificada(); }, true);
        });
      }
    }
  }

btnAssinar?.addEventListener("click", () => {
  const s = getEstadoAcessoPerfil();

  if (s.ehDona) return;

  if (s.ehVisitante) {
    abrirPopupLoginObrigatorio();
    return;
  }

if (s.ehModeloVisitandoOutra) {
    alert(t("perfil.alert_modelo_assinar"));
    return;
  }

  if (s.ehVip) {
    window.location.href = `/chatc.html?modelo_id=${modelo_id}`;
    return;
  }

  abrirFluxoVIP();
});


await carregarPerfil();
await carregarOfertaAtiva();
await aplicarRegrasDeAcesso();

await verificarVip();   // define estado VIP primeiro

await carregarFeed();
await carregarPremium();

consumirRetornoPosAuth();

iniciarVerificacaoVip();

  const btnVipChat = document.getElementById("btn-vip-chat");

  btnVipChat?.addEventListener("click", () => {
    window.location.href = `/inboxc.html`;

  });


// ===============================
// ENVIAR POST FEED
// ===============================

const btnEnviarFeed = document.getElementById("btnEnviarFeed");

btnEnviarFeed?.addEventListener("click", async () => {
  const file = fileInput.files[0];

  if (!file) {
    alert(t("perfil.alert_selecione_midia"));
    return;
  }

  const formData = new FormData();
  formData.append("file", file);
  formData.append("tipo_conteudo", "feed");

  btnEnviarFeed.disabled = true;
  btnEnviarFeed.textContent = t("perfil.enviando");
  atualizarBarraUpload("feed", 0);

  try {
    const res = await uploadComProgresso({
      url: "/api/upload",
      formData,
      token,
      tipo: "feed"
    });

    if (!res.ok) {
      alert(res.data?.error || t("perfil.erro_upload"));
      return;
    }

    atualizarBarraUpload("feed", 100);
    alert(t("perfil.post_publicado"));

    document.getElementById("popupUploadFeed").classList.add("hidden");

    fileInput.value = "";
    preview.innerHTML = "";
    resetarBarraUpload("feed");

    carregarFeed();
  } catch (err) {
    console.error(err);
    alert(t("perfil.erro_upload"));
    resetarBarraUpload("feed");
  } finally {
    btnEnviarFeed.disabled = false;
    btnEnviarFeed.textContent = t("perfil.upload_feed_btn");
  }
});


const filePremium = document.getElementById("filePremium");
const previewPremium = document.getElementById("previewPremium");

document.getElementById("uploadAreaPremium")
?.addEventListener("click", () => {
  filePremium.click();
});

filePremium?.addEventListener("change", () => {
  const files = Array.from(filePremium.files || []);
  previewPremium.innerHTML = "";

  if (!files.length) return;

  files.forEach(file => {
    const url = URL.createObjectURL(file);

    const item = document.createElement("div");
    item.className = "preview-premium-item";

    item.innerHTML = file.type.startsWith("video")
      ? `<video src="${url}" controls></video>`
      : `<img src="${url}" alt="Preview premium">`;

    previewPremium.appendChild(item);
  });
});

document.getElementById("btnEnviarPremium")
?.addEventListener("click", async () => {
  const btnEnviarPremium = document.getElementById("btnEnviarPremium");
  const files = Array.from(filePremium.files || []);
  const descricao = document.getElementById("premiumTexto").value.trim();
  const preco = document.getElementById("premiumPreco").value;

    if (!files.length) {
    alert(t("perfil.alert_selecione_ao_menos"));
    return;
    }

   if (!preco || Number(preco) <= 0) {
    alert(t("perfil.alert_preco_invalido"));
    return;
    }

  const form = new FormData();
  form.append("descricao", descricao);
  form.append("preco", preco);

  files.forEach(file => {
    form.append("files", file);
  });

  btnEnviarPremium.disabled = true;
  btnEnviarPremium.textContent = t("perfil.enviando");
  atualizarBarraUpload("premium", 0);

  try {
    const res = await uploadComProgresso({
      url: "/api/premium",
      formData: form,
      token,
      tipo: "premium"
    });

    if (!res.ok) {
     alert(res.data?.error || t("perfil.erro_publicar_premium"));
      return;
    }

    atualizarBarraUpload("premium", 100);

    document.getElementById("popupUploadPremium").classList.add("hidden");
    filePremium.value = "";
    previewPremium.innerHTML = "";
    document.getElementById("premiumTexto").value = "";
    document.getElementById("premiumPreco").value = "";
    resetarBarraUpload("premium");

    carregarPremium();
  } catch (err) {
    console.error("Erro publicar premium:", err);
    alert(t("perfil.erro_publicar_premium"));
    resetarBarraUpload("premium");
  } finally {
    btnEnviarPremium.disabled = false;
    btnEnviarPremium.textContent = t("perfil.upload_premium_btn");
  }
});

// ===============================
// TABS FEED / PREMIUM
// ===============================

const tabs = document.querySelectorAll(".midias-tabs .tab");
const feedGrid = document.getElementById("listaMidias");
const premiumGrid = document.getElementById("midias-paid");

tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    const tipo = tab.dataset.tab;

    if (tipo === "free") {
      feedGrid.classList.add("active");
      premiumGrid.classList.remove("active");
    }

    if (tipo === "paid") {
      feedGrid.classList.remove("active");
      premiumGrid.classList.add("active");
    }
  });
});


});


async function carregarPerfil(){

  try{

    const res = await fetch(`/api/modelo/publico/${modelo_id}`);

    if(!res.ok) return;

    const modelo = await res.json();

    document.getElementById("profileName").textContent =
      modelo.nome_exibicao || "";

    document.getElementById("profileBio").textContent =
      modelo.bio || "";

      const avatar = document.getElementById("profileAvatar");
const capa = document.getElementById("profileCapa");

if (avatar) {
  avatar.src = modelo.avatar || "/assets/avatar.png";
  avatar.onerror = () => avatar.src = "/assets/avatar.png";
}

if (capa) {
  capa.src = modelo.capa || "/assets/capa.png";
  capa.onerror = () => capa.src = "/assets/capa.png";
}

    const localEl = document.getElementById("local-texto");

    if(localEl){
      localEl.textContent = modelo.local || "";
    }

    const ig = document.getElementById("link-instagram");
    const tt = document.getElementById("link-tiktok");

    if(modelo.instagram){
      ig.href = "https://instagram.com/" + modelo.instagram.replace("@","");
      ig.style.display = "inline-block";
    }else{
      ig.style.display = "none";
    }

    if(modelo.tiktok){
      tt.href = "https://tiktok.com/@" + modelo.tiktok.replace("@","");
      tt.style.display = "inline-block";
    }else{
      tt.style.display = "none";
    }

  }catch(e){
    console.error("erro perfil",e);
  }

}

function abrirMidia(item) {
  const modal = document.getElementById("modalMidia");
  const img = document.getElementById("modalImg");
  const video = document.getElementById("modalVideo");
  const iframe = document.getElementById("modalIframe");
  const dotsWrap = document.getElementById("modalDots");

  img.style.display = "none";
  video.style.display = "none";
  iframe.style.display = "none";

  img.onload = null;
  img.onerror = null;
  video.onloadeddata = null;
  video.onerror = null;
  iframe.onload = null;
  iframe.onerror = null;

  video.pause();
  video.src = "";
  iframe.src = "";

  const midias = item.midias && item.midias.length
    ? item.midias
    : [{ url: item.url }];

  let index = 0;
  let startX = 0;
  let currentX = 0;
  let isDragging = false;
  let houveArraste = false;

  function renderDots() {
    if (!dotsWrap) return;

    if (midias.length <= 1) {
      dotsWrap.classList.add("hidden");
      dotsWrap.innerHTML = "";
      return;
    }

    dotsWrap.innerHTML = midias.map((_, i) => `
      <button
        type="button"
        class="modal-dot ${i === index ? "active" : ""}"
        data-index="${i}"
        aria-label="Ir para mídia ${i + 1}">
      </button>
    `).join("");

    dotsWrap.classList.remove("hidden");

    dotsWrap.querySelectorAll(".modal-dot").forEach(dot => {
      dot.addEventListener("click", (e) => {
        e.stopPropagation();
        index = Number(dot.dataset.index);
        mostrar();
      });
    });
  }

  function atualizarDots() {
    if (!dotsWrap) return;

    dotsWrap.querySelectorAll(".modal-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
  }

  function mostrar() {
    const media = midias[index];
    const url = media.url || "";

    const ehVideo =
      url.includes(".mp4") ||
      url.includes(".webm") ||
      url.includes(".mov") ||
      url.includes("videodelivery.net");

    img.style.display = "none";
    video.style.display = "none";
    iframe.style.display = "none";

    img.onload = null;
    img.onerror = null;
    video.onloadeddata = null;
    video.onerror = null;
    iframe.onload = null;
    iframe.onerror = null;

    video.pause();
    video.src = "";
    iframe.src = "";

    atualizarDots();

    if (ehVideo) {
      if (url.includes("videodelivery.net")) {
        const partes = url.split("/");
        const videoId = partes[3];

        iframe.src = `https://iframe.videodelivery.net/${videoId}?autoplay=true`;
        iframe.style.display = "block";
      } else {
        video.src = url;
        video.style.display = "block";
        video.currentTime = 0;
        video.play().catch(() => {});
      }
    } else {
      img.src = url;
      img.style.display = "block";
    }
  }

  function irProxima() {
    if (midias.length <= 1) return;
    index = (index + 1) % midias.length;
    mostrar();
  }

  function irAnterior() {
    if (midias.length <= 1) return;
    index = (index - 1 + midias.length) % midias.length;
    mostrar();
  }

  renderDots();
  modal.classList.remove("hidden");
  mostrar();

  const areaInteracao = modal.querySelector(".modal-conteudo");

  modal.onclick = (e) => {
    if (houveArraste) return;

    const clicouMidia =
      e.target === img ||
      e.target === video ||
      e.target === iframe;

    if (!clicouMidia || midias.length <= 1) return;

    if (e.clientX > window.innerWidth / 2) {
      irProxima();
    } else {
      irAnterior();
    }
  };

  if (areaInteracao) {
    areaInteracao.onpointerdown = (e) => {
      if (midias.length <= 1) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;

      houveArraste = false;
      isDragging = true;
      startX = e.clientX;
      currentX = e.clientX;
      areaInteracao.setPointerCapture(e.pointerId);
    };

    areaInteracao.onpointermove = (e) => {
      if (!isDragging) return;

      currentX = e.clientX;
      const deltaX = currentX - startX;

      if (Math.abs(deltaX) > 8) {
        houveArraste = true;
        e.preventDefault();
      }
    };

    function finalizarArraste() {
      if (!isDragging) return;

      isDragging = false;

      const deltaX = currentX - startX;
      const threshold = Math.max(50, window.innerWidth * 0.12);

      if (deltaX < -threshold) {
        irProxima();
      } else if (deltaX > threshold) {
        irAnterior();
      }

      setTimeout(() => {
        houveArraste = false;
      }, 60);
    }

    areaInteracao.onpointerup = finalizarArraste;
    areaInteracao.onpointercancel = finalizarArraste;
  }
}

function valorBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

async function aplicarRegrasDeAcesso() {
  const ofertaCard = document.getElementById("oferta-card");
  const vipCard = document.getElementById("vip-card");
  const btnVipChat = document.getElementById("btn-vip-chat");

  const s = getEstadoAcessoPerfil();

  // reset visual base
  if (ofertaCard) ofertaCard.style.display = "none";
  if (vipCard) vipCard.classList.add("hidden");

  if (btnVipChat) {
    btnVipChat.disabled = true;
    btnVipChat.style.opacity = "0.6";
    btnVipChat.style.cursor = "not-allowed";
  }

  // MODELO DONA
  if (s.ehDona) {
    if (btnAssinar) {
      btnAssinar.style.display = "none";
    }

    if (btnVipChat) {
      btnVipChat.disabled = false;
      btnVipChat.style.opacity = "1";
      btnVipChat.style.cursor = "pointer";
    }

    return;
  }

  // VISITANTE
  if (s.ehVisitante) {
    if (ofertaCard) ofertaCard.style.display = "block";

    if (btnAssinar && window.OFERTA_ATUAL) {
      btnAssinar.disabled = false;
      btnAssinar.style.display = "block";
      btnAssinar.textContent =
    `${t("perfil.btn_assinar_prefix")} ${valorBRL(window.OFERTA_ATUAL.valor_promocional)}`;
    }

    return;
  }

  // MODELO vendo outra modelo
  if (s.ehModeloVisitandoOutra) {
    if (ofertaCard) ofertaCard.style.display = "block";

    if (btnAssinar) {
      btnAssinar.disabled = true;
      btnAssinar.style.display = "block";
      btnAssinar.style.cursor = "not-allowed";
      btnAssinar.textContent = t("perfil.btn_assinar_modelo_bloqueado");
    }

    return;
  }

  // CLIENTE: consultar VIP real
  try {
    const res = await fetch(`/api/vip/status/${modelo_id}`, {
      headers: {
        Authorization: "Bearer " + s.tokenAtual
      }
    });

    const data = res.ok ? await res.json() : { vip: false };
    window.__CLIENTE_VIP__ = !!data.vip;

    if (window.__CLIENTE_VIP__) {
      if (vipCard) vipCard.classList.remove("hidden");

      if (btnVipChat) {
        btnVipChat.disabled = false;
        btnVipChat.style.opacity = "1";
        btnVipChat.style.cursor = "pointer";
      }

      atualizarBotaoVip(data.expiration_at);
      return;
    }

    if (ofertaCard) ofertaCard.style.display = "block";

    if (btnAssinar && window.OFERTA_ATUAL) {
      btnAssinar.disabled = false;
      btnAssinar.style.display = "block";
      btnAssinar.style.cursor = "pointer";
      btnAssinar.textContent =
        `${t("perfil.btn_assinar_prefix")} ${valorBRL(window.OFERTA_ATUAL.valor_promocional)}`;
    }
  } catch (err) {
    console.error("Erro ao aplicar regras de acesso:", err);
    window.__CLIENTE_VIP__ = false;

    if (ofertaCard) ofertaCard.style.display = "block";
  }
}

window.OFERTA_ATUAL = null;
async function carregarOfertaAtiva() {
  console.log("🧪 carregarOfertaAtiva chamado com modelo_id =", modelo_id);

  const ofertaCard = document.getElementById("oferta-card");
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
      window.OFERTA_ATUAL = null;
      return;
    }

    const data = await res.json();

    if (!data.ativa) {

  const valor = Number(data.valor_base) || 20;

  window.OFERTA_ATUAL = {
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
    `${t("perfil.btn_assinar_prefix")} ${valorBRL(valor)}`;

  ofertaCard.style.display = "block";
  return;
}
    const oferta = data.oferta;
    window.OFERTA_ATUAL = {
      id: oferta.id,
      modelo_id: oferta.modelo_id,
      valor_base: Number(oferta.valor_base),
      valor_promocional: Number(oferta.valor_promocional),
      desconto_percentual: Number(oferta.desconto_percentual || 0)
    };

    if (descontoEl && window.OFERTA_ATUAL.desconto_percentual > 0) {
      descontoEl.textContent = `${t("perfil.oferta_economize")} ${window.OFERTA_ATUAL.desconto_percentual}%`;
      descontoEl.style.display = "inline-block";
    } else if (descontoEl) {
      descontoEl.style.display = "none";
    }

    if (precoDescontoEl) {
  precoDescontoEl.textContent =
    valorBRL(window.OFERTA_ATUAL.valor_promocional);
}

if (precoOriginalEl) {
  precoOriginalEl.textContent =
    valorBRL(window.OFERTA_ATUAL.valor_base);
}

    ofertaCard.style.display = "block";

    if (btnAssinar) {
  btnAssinar.disabled = false;
  btnAssinar.textContent =
  `${t("perfil.btn_assinar_prefix")} ${valorBRL(window.OFERTA_ATUAL.valor_promocional)}`;
}

  } catch (err) {
    console.error("Erro ao carregar oferta:", err);
    ofertaCard.style.display = "none";
    window.OFERTA_ATUAL = null;
  }
}

function abrirPopupLoginObrigatorio() {
  const modal = document.createElement("div");
  modal.className = "modal-login-obrigatorio";

modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-box-login">
      <h3>${t("perfil.modal_acesso_titulo")}</h3>
      <p>${t("perfil.modal_acesso_desc")}</p>

      <div class="login-acoes">
        <button class="btn-login">${t("perfil.btn_ja_tenho_conta")}</button>
        <button class="btn-register">${t("perfil.btn_nao_tenho_conta")}</button>
      </div>
    </div>
  `;

  modal.querySelector(".modal-backdrop").onclick = () => modal.remove();

  modal.querySelector(".btn-login").onclick = () => {
    modal.remove();
    salvarRetornoPerfilAcao("vip");

    if (typeof openAgeGate === "function") {
      openAgeGate("login");
    } else {
      console.error("openAgeGate não carregado");
    }
  };

  modal.querySelector(".btn-register").onclick = () => {
    modal.remove();
    salvarRetornoPerfilAcao("vip");

    if (typeof openAgeGate === "function") {
      openAgeGate("register");
    } else {
      console.error("openAgeGate não carregado");
    }
  };

  document.body.appendChild(modal);
}

function abrirFluxoVIP() {
  const roleAtual = localStorage.getItem("role");

  if (!roleAtual) {
    abrirPopupLoginObrigatorio();
    return;
  }

 if (!modelo_id) {
    alert(t("perfil.alert_erro_modelo"));
    return;
  }

  window.PAGAMENTO_TIPO_ATUAL = "vip";
  window.PREMIUM_ATUAL = null;
  window.MIDIA_VENDA_ATUAL = null;

  const valorBase = Number(window.OFERTA_ATUAL?.valor_base ?? 20);
  const valorPromocional = Number(
    window.OFERTA_ATUAL?.valor_promocional ?? valorBase
  );

  abrirPopupPagamento();

  preencherResumoVIP({
    valorBase,
    desconto: Math.max(0, valorBase - valorPromocional)
  });
}

async function carregarFeed() {

  const grid = document.getElementById("listaMidias");
  if (!grid) return;

  grid.innerHTML = "";

  try {

    const res = await fetch(`/api/modelo/publico/${modelo_id}/feed`);
    if (!res.ok) return;

    const midias = await res.json();

    if (!midias.length) {
      grid.innerHTML =
        `<p style='grid-column:1/-1;text-align:center;'>${t("perfil.sem_posts_feed")}</p>`;
      return;
    }

    midias.forEach(item => {

      const div = document.createElement("div");
      div.className = "midia-thumb";

      const podeVerAgora = podeVerFeed();

      if (!podeVerAgora) {
        div.classList.add("locked");
      }

      const url = item.url || "";
      const thumb = item.thumbnail_url || url;

      const ehVideo =
        url.includes(".mp4") ||
        url.includes(".webm") ||
        url.includes(".mov") ||
        url.includes("videodelivery.net");

      if (ehVideo) {
        let thumbnail = thumb;

        if (url.includes("videodelivery.net")) {

          const videoId = url.split("videodelivery.net/")[1];

          thumbnail = `https://videodelivery.net/${videoId}/thumbnails/thumbnail.jpg`;

        }

        div.innerHTML = `
          <img src="${thumbnail}">
          <span class="video-icon">▶</span>
        `;

      } else {

        div.innerHTML = `<img src="${thumb}">`;

      }

      div.onclick = () => {
  if (!podeVerFeed()) {
    tratarAcaoProtegidaFeedOuChat();
    return;
  }

  abrirMidia(item);
};

      // botão excluir (modelo)
      if (EH_DONA) {

        const btnExcluir = document.createElement("button");
        btnExcluir.className = "btn-excluir-midia";
        btnExcluir.textContent = "✕";

        btnExcluir.onclick = (e) => {
          e.stopPropagation();
          excluirMidia(item.id, div);
        };

        div.appendChild(btnExcluir);

      }

      grid.appendChild(div);

    });

  } catch (err) {

    console.error("Erro ao carregar feed:", err);

  }

}

const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileFeed");
const preview = document.getElementById("previewContainer");

uploadArea?.addEventListener("click", () => {
  fileInput.click();
});

fileInput?.addEventListener("change", () => {

  const file = fileInput.files[0];
  if (!file) return;

  preview.innerHTML = "";

  const url = URL.createObjectURL(file);

  if (file.type.startsWith("video")) {
    preview.innerHTML = `<video src="${url}" controls></video>`;
  } else {
    preview.innerHTML = `<img src="${url}">`;
  }

});

async function excluirMidia(id, elemento) {

  if (!confirm(t("perfil.confirm_excluir_midia"))) return;

  try {

    const res = await fetch(`/api/conteudos/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || t("perfil.erro_excluir_midia"));
      return;
    }

    elemento.remove();

  } catch (err) {

    console.error("Erro ao excluir mídia:", err);
    alert(t("perfil.erro_excluir_midia"));

  }

}

async function carregarPremium() {
  const container = document.getElementById("midias-paid");
  if (!container) return;

  container.innerHTML = "";

  try {
    const headers = token
      ? { Authorization: "Bearer " + token }
      : {};

    const res = await fetch(`/api/modelo/publico/${modelo_id}/premium`, {
      headers
    });

    if (!res.ok) {
     container.innerHTML =
    `<p style='text-align:center;'>${t("perfil.erro_carregar_premium")}</p>`;
      return;
    }

    const midias = await res.json();

    if (!midias.length) {
  container.innerHTML =
    `<p style='text-align:center;'>${t("perfil.sem_premium")}</p>`;
      return;
    }

    midias.forEach(item => {
      const podeVer = podeVerPremiumLiberado(item);
      const card = document.createElement("article");
      card.className = "midia-card-premium";

      if (!podeVer) {
        card.classList.add("locked");
      }

      const criadoEm = item.criado_em || item.created_at || item.criadoem || null;

      const avatar =
        document.getElementById("profileAvatar")?.src || "/assets/avatar.png";

      const nome =
        document.getElementById("profileName")?.textContent?.trim() || "Perfil";

      const descricao = escapeHtml(item.descricao || "");

      let mediaPrincipal = "";

      const mediasBase = item.midias?.length
        ? item.midias
        : [{
            url: item.url || "",
            thumbnail_url: item.thumbnail_url || "",
            thumb_url: item.thumb_url || ""
          }];

      const medias = podeVer
        ? mediasBase
        : mediasBase.map(m => ({
            ...m,
            __somenteThumb: true
          }));

      const mediaHTML = medias.map((m, i) => {
        const url = m.url || "";
        const thumb = getThumbPremium(m, item);
        const ehVideo = !m.__somenteThumb && ehVideoUrl(url);

        if (i === 0) {
          mediaPrincipal = ehVideo ? url : thumb;
        }

        return `
          <div class="carousel-item">
            ${
              ehVideo
                ? `
                  <video
                    src="${url}"
                    poster="${thumb}"
                    muted
                    playsinline
                    preload="none"
                  ></video>
                `
                : `
                  <img
                    src="${thumb}"
                    alt="Post premium"
                    loading="eager"
                    onerror="this.onerror=null;this.src='/assets/premium-locked.jpg';"
                  >
                `
            }
          </div>
        `;
      }).join("");

      card.innerHTML = `
        <div class="premium-header">
          <img
            class="premium-avatar"
            src="${avatar}"
            alt="Avatar da modelo"
          >

          <div class="premium-user">
            <div class="premium-topline">
              <span class="premium-username">${nome}</span>
              <span class="premium-tempo">
                ${criadoEm ? `${tempoAtras(criadoEm)} atrás` : ""}
              </span>
            </div>
          </div>

          ${
            EH_DONA
              ? `<button class="btn-excluir-premium" data-id="${item.id}" type="button">✕</button>`
              : ""
          }
        </div>

        <div class="premium-media">
          <div class="carousel" data-index="0">
            <div class="carousel-track">
              ${mediaHTML}
            </div>

            ${medias.length > 1 ? `
              <button class="carousel-arrow prev" type="button">‹</button>
              <button class="carousel-arrow next" type="button">›</button>

              <div class="carousel-dots">
                ${medias.map((_, i) => `
                  <button
                    type="button"
                    class="carousel-dot ${i === 0 ? "active" : ""}"
                    data-index="${i}">
                  </button>
                `).join("")}
              </div>
            ` : ""}
          </div>
        </div>

        <div class="premium-info">
          <p class="premium-descricao">
            <strong>${nome}:</strong> ${descricao}
          </p>

          <div class="premium-footer">
            <span class="premium-preco">${valorBRL(item.preco)}</span>
          </div>
        </div>
      `;

      if (EH_DONA) {
        const btnExcluir = card.querySelector(".btn-excluir-premium");

        btnExcluir?.addEventListener("click", (e) => {
          e.stopPropagation();
          excluirPremium(item.id, card);
        });
      }

      const carousel = card.querySelector(".carousel");
      const track = card.querySelector(".carousel-track");
      const slides = Array.from(card.querySelectorAll(".carousel-item"));
      const dots = Array.from(card.querySelectorAll(".carousel-dot"));
      const prevBtn = card.querySelector(".carousel-arrow.prev");
      const nextBtn = card.querySelector(".carousel-arrow.next");
      const media = card.querySelector(".premium-media");

      let houveArraste = false;

      if (carousel && track && slides.length > 1) {
        let currentIndex = 0;
        let startX = 0;
        let currentX = 0;
        let isDragging = false;

        function updateCarousel(index, animate = true) {
          currentIndex = Math.max(0, Math.min(index, slides.length - 1));

          track.style.transition = animate ? "transform .28s ease" : "none";
          track.style.transform = `translateX(-${currentIndex * 100}%)`;

          dots.forEach((dot, i) => {
            dot.classList.toggle("active", i === currentIndex);
          });
        }

        prevBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          updateCarousel(currentIndex - 1);
        });

        nextBtn?.addEventListener("click", (e) => {
          e.stopPropagation();
          updateCarousel(currentIndex + 1);
        });

        dots.forEach((dot, i) => {
          dot.addEventListener("click", (e) => {
            e.stopPropagation();
            updateCarousel(i);
          });
        });

        carousel.addEventListener("pointerdown", (e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;

          houveArraste = false;
          isDragging = true;
          startX = e.clientX;
          currentX = e.clientX;
          track.style.transition = "none";
        });

        carousel.addEventListener("pointermove", (e) => {
          if (!isDragging) return;

          currentX = e.clientX;
          const deltaX = currentX - startX;

          if (Math.abs(deltaX) > 8) {
            houveArraste = true;
          }

          const base = -currentIndex * carousel.offsetWidth;
          track.style.transform = `translateX(${base + deltaX}px)`;
        });

        function endDrag() {
          if (!isDragging) return;

          isDragging = false;
          const deltaX = currentX - startX;
          const threshold = carousel.offsetWidth * 0.18;

          if (deltaX < -threshold && currentIndex < slides.length - 1) {
            updateCarousel(currentIndex + 1);
          } else if (deltaX > threshold && currentIndex > 0) {
            updateCarousel(currentIndex - 1);
          } else {
            updateCarousel(currentIndex);
          }

          setTimeout(() => {
            houveArraste = false;
          }, 50);
        }

        carousel.addEventListener("pointerup", endDrag);
        carousel.addEventListener("pointercancel", endDrag);
        carousel.addEventListener("lostpointercapture", () => {
          if (isDragging) endDrag();
        });

        updateCarousel(0);
      }

      if (media) {
        media.onclick = () => {
          if (houveArraste) return;

          if (!podeVer) {
            if (!tratarAcaoProtegidaPremium()) return;
            abrirFluxoPremium(item);
            return;
          }

          abrirMidia({
            ...item,
            url: mediaPrincipal || item.url || item.thumbnail_url || item.thumb_url
          });
        };
      }

      container.appendChild(card);
    });

  } catch (err) {
    console.error("Erro carregar premium:", err);
    container.innerHTML =
      `<p style='text-align:center;'>${t("perfil.erro_carregar_premium")}</p>`;
  }
}

function consumirRetornoPosAuth() {
  const bruto =
    localStorage.getItem("post_login_action") ||
    localStorage.getItem("post_register_action");

  if (!bruto) return;

  try {
    const acao = JSON.parse(bruto);

    const mesmoPerfil =
      Number(acao?.modelo_id || 0) === Number(modelo_id);

    if (!mesmoPerfil) return;

    localStorage.removeItem("post_login_action");
    localStorage.removeItem("post_register_action");
    localStorage.removeItem("redirect_after_auth");

    if (acao?.tipo === "vip") {
      setTimeout(() => {
        const s = getEstadoAcessoPerfil();

        if (!s.ehVisitante && !s.ehVip && !s.ehModeloVisitandoOutra) {
          abrirFluxoVIP();
        }
      }, 400);
    }
  } catch (err) {
    console.error("Erro ao consumir retorno pós-auth:", err);
  }
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function abrirFluxoPremium(item) {
  if (!tratarAcaoProtegidaPremium()) return;

  window.PREMIUM_ATUAL = {
    premium_post_id: Number(item.id),
    modelo_id: Number(item.modelo_id || modelo_id),
    preco: Number(item.preco || 0),
    descricao: item.descricao || "",
    url: item.url || null,
    thumbnail_url: item.thumbnail_url || item.thumb_url || null,
    thumb_url: item.thumb_url || item.thumbnail_url || null,
    tipo: item.tipo || null,
    criado_em: item.criado_em || item.created_at || null,
    midias: item.midias || []
  };

  window.PAGAMENTO_TIPO_ATUAL = "premium";
  window.MIDIA_VENDA_ATUAL = null;

  abrirPopupPagamento();
}

async function abrirPremiumLiberadoAtual() {
  const premiumId = window.PREMIUM_ATUAL?.premium_post_id;
  if (!premiumId) return;

  try {
    const res = await fetch(`/api/modelo/publico/${modelo_id}/premium`, {
      headers: {
        Authorization: "Bearer " + localStorage.getItem("token")
      }
    });

    if (!res.ok) return;

    const lista = await res.json();
    const item = lista.find(x => Number(x.id) === Number(premiumId));

    if (!item) return;
    if (!item.liberado) return;

    // garante estrutura compatível com abrirMidia(item)
    const itemNormalizado = {
      ...item,
      midias: item.midias?.length
        ? item.midias
        : [
            {
              url:
                item.url ||
                item.thumbnail_url ||
                item.thumb_url ||
                ""
            }
          ]
    };

    if (itemNormalizado.url || itemNormalizado.midias?.length) {
      abrirMidia(itemNormalizado);
    }
  } catch (err) {
    console.error("Erro abrirPremiumLiberadoAtual:", err);
  }
}


function tempoAtras(dataISO) {
  if (!dataISO) return "";

  const data = new Date(dataISO);
  if (isNaN(data.getTime())) return "";

  const agora = new Date();
  const diff = Math.floor((agora - data) / 1000);

  if (diff < 0) return "";

  const minutos = Math.floor(diff / 60);
  const horas = Math.floor(diff / 3600);
  const dias = Math.floor(diff / 86400);

  if (minutos < 60) return `${minutos} min`;
  if (horas < 24) return `${horas} h`;
  return `${dias} d`;
}

function renderThumb(item){

  const div = document.createElement("div");
  div.className = "midia-thumb";

  const ehVideo = item.tipo === "video";

  const thumbSrc = ehVideo
    ? item.thumbnail_url
    : item.url;

  div.innerHTML = `
    <img src="${thumbSrc}" loading="lazy">
    ${ehVideo ? '<span class="video-icon">▶</span>' : ''}
  `;

  div.onclick = () => abrirMidia(item);

  return div;
}

async function ativarVip(expiration_at) {
  window.__CLIENTE_VIP__ = true;

  atualizarBotaoVip(expiration_at);
  await aplicarRegrasDeAcesso();
  await carregarFeed();
  await carregarPremium();
}

async function verificarVip() {

  const token = localStorage.getItem("token");
  if (!token) return;

  try {

    const res = await fetch(`/api/vip/status/${modelo_id}`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) return;

    const data = await res.json();

    if (data.vip) {

      ativarVip(data.expiration_at);

      if (vipCheckInterval) {
        clearInterval(vipCheckInterval);
        vipCheckInterval = null;
      }

    }

  } catch (err) {
    console.error("Erro verificar VIP:", err);
  }

}

let vipCheckInterval = null;

function iniciarVerificacaoVip(){

  const token = localStorage.getItem("token");

  // visitante
  if(!token) return;

  // própria modelo
  if(EH_DONA) return;

  // qualquer modelo
  if(role === "modelo") return;

  // já é VIP
  if(window.__CLIENTE_VIP__) return;

  // já existe polling
  if(vipCheckInterval) return;

  vipCheckInterval = setInterval(verificarVip, 4000);

  verificarVip(); // primeira verificação imediata
}

async function atualizarPerfilPosPagamento() {
  await aplicarRegrasDeAcesso();
  await carregarFeed();
  await carregarPremium();

  if (window.PAGAMENTO_TIPO_ATUAL === "premium") {
    await abrirPremiumLiberadoAtual();
  }
}

window.atualizarPerfilPosPagamento = atualizarPerfilPosPagamento;

window.addEventListener("languageChanged", async () => {
  await carregarOfertaAtiva();
  await aplicarRegrasDeAcesso();
  await carregarFeed();
  await carregarPremium();

  const btnAssinar = document.getElementById("btn-assinar");
  if (btnAssinar && window.__CLIENTE_VIP__) {
    btnAssinar.textContent = t("perfil.vip_ativo_btn");
  }
});

function fecharModalMidia() {
  const modal = document.getElementById("modalMidia");
  const img = document.getElementById("modalImg");
  const video = document.getElementById("modalVideo");
  const iframe = document.getElementById("modalIframe");
  const dotsWrap = document.getElementById("modalDots");
  const areaInteracao = modal?.querySelector(".modal-conteudo");

  if (modal) {
    modal.classList.add("hidden");
    modal.onclick = null;
  }

  if (areaInteracao) {
    areaInteracao.onpointerdown = null;
    areaInteracao.onpointermove = null;
    areaInteracao.onpointerup = null;
    areaInteracao.onpointercancel = null;
  }

  if (img) {
    img.style.display = "none";
    img.src = "";
    img.onload = null;
    img.onerror = null;
  }

  if (video) {
    video.pause();
    video.style.display = "none";
    video.src = "";
    video.onloadeddata = null;
    video.onerror = null;
  }

  if (iframe) {
    iframe.style.display = "none";
    iframe.src = "";
    iframe.onload = null;
    iframe.onerror = null;
  }

  if (dotsWrap) {
    dotsWrap.innerHTML = "";
    dotsWrap.classList.add("hidden");
  }
}

async function excluirPremium(id, elemento) {
  if (!confirm(t("perfil.confirm_excluir_premium"))) return;

  try {
    const res = await fetch(`/api/premium/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || t("perfil.erro_excluir_premium"));
      return;
    }

    elemento.remove();

    const container = document.getElementById("midias-paid");
    if (container && !container.querySelector(".midia-card-premium")) {
      container.innerHTML =
        `<p style='text-align:center;'>${t("perfil.sem_premium")}</p>`;
    }

  } catch (err) {
    console.error("Erro ao excluir premium:", err);
    alert(t("perfil.erro_excluir_premium"));
  }
}

function atualizarBarraUpload(tipo, percentual) {
  const box = document.getElementById(
    tipo === "feed" ? "uploadProgressBox" : "premiumProgressBox"
  );
  const fill = document.getElementById(
    tipo === "feed" ? "uploadProgress" : "premiumProgress"
  );
  const text = document.getElementById(
    tipo === "feed" ? "progressText" : "premiumProgressText"
  );

  if (!box || !fill || !text) return;

  box.classList.remove("hidden");
  fill.style.width = `${percentual}%`;
  text.textContent = `${percentual}%`;
}

function resetarBarraUpload(tipo) {
  const box = document.getElementById(
    tipo === "feed" ? "uploadProgressBox" : "premiumProgressBox"
  );
  const fill = document.getElementById(
    tipo === "feed" ? "uploadProgress" : "premiumProgress"
  );
  const text = document.getElementById(
    tipo === "feed" ? "progressText" : "premiumProgressText"
  );

  if (!box || !fill || !text) return;

  fill.style.width = "0%";
  text.textContent = "0%";
  box.classList.add("hidden");
}

function uploadComProgresso({ url, formData, token, tipo }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", url, true);

    if (token) {
      xhr.setRequestHeader("Authorization", "Bearer " + token);
    }

    xhr.upload.addEventListener("progress", (e) => {
      if (!e.lengthComputable) return;

      const percentual = Math.round((e.loaded / e.total) * 100);
      atualizarBarraUpload(tipo, percentual);
    });

    xhr.addEventListener("load", () => {
      let data = {};

      try {
        data = JSON.parse(xhr.responseText || "{}");
      } catch {
        data = {};
      }

      resolve({
        ok: xhr.status >= 200 && xhr.status < 300,
        status: xhr.status,
        data
      });
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Erro de rede no upload"));
    });

    xhr.send(formData);
  });
}

function ehVideoUrl(url = "") {
  return (
    url.includes(".mp4") ||
    url.includes(".webm") ||
    url.includes(".mov") ||
    url.includes("videodelivery.net")
  );
}

function getCloudflareVideoId(url = "") {
  const match = url.match(/videodelivery\.net\/([^/?#]+)/);
  return match?.[1] || null;
}

function getThumbPremium(media = {}, item = {}) {
  const url = media.url || item.url || "";

  const thumb =
    media.thumbnail_url ||
    media.thumb_url ||
    item.thumbnail_url ||
    item.thumb_url ||
    "";

  if (thumb) return thumb;

  if (url.includes("videodelivery.net")) {
    const videoId = getCloudflareVideoId(url);
    if (videoId) {
      return `https://videodelivery.net/${videoId}/thumbnails/thumbnail.jpg`;
    }
  }

  return "/assets/premium-locked.jpg";
}

// ===============================
// POPUP CONTA NÃO VERIFICADA
// ===============================
function abrirPopupContaNaoVerificada() {
  let popup = document.getElementById("popupContaNaoVerificada");
  if (popup) { popup.classList.remove("hidden"); return; }

  popup = document.createElement("div");
  popup.id = "popupContaNaoVerificada";
  popup.style.cssText = "position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;";
  popup.innerHTML = `
    <div style="position:absolute;inset:0;background:rgba(0,0,0,0.55);" id="popupNVOverlay"></div>
    <div style="
      position:relative;z-index:2;background:#fff;border-radius:18px;
      padding:32px 24px;max-width:380px;width:100%;text-align:center;
      box-shadow:0 20px 60px rgba(0,0,0,0.25);display:flex;flex-direction:column;gap:16px;
    ">
      <div style="font-size:44px;">🔒</div>
      <h3 style="margin:0;color:#7B2CFF;font-size:18px;">Conta não verificada</h3>
      <p style="margin:0;color:#555;font-size:14px;line-height:1.6;">
        Apenas modelos com conta verificada podem fazer upload de mídia.<br>
        Acede à tua conta para completar a verificação.
      </p>
      <a href="/conta.html" style="
        background:linear-gradient(135deg,#7B2CFF,#9B5CFF);color:#fff;
        text-decoration:none;padding:14px 24px;border-radius:14px;
        font-size:15px;font-weight:600;display:block;
      ">Verificar conta agora</a>
      <button id="popupNVFechar" style="
        background:none;border:none;color:#999;font-size:13px;cursor:pointer;padding:4px;
      ">Fechar</button>
    </div>
  `;
  document.body.appendChild(popup);

  const fechar = () => popup.classList.add("hidden");
  popup.querySelector("#popupNVOverlay").addEventListener("click", fechar);
  popup.querySelector("#popupNVFechar").addEventListener("click", fechar);
}