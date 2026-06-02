//MIL VERESOES CARREGAR PERFIL
// 


async function iniciarPerfil() {

  // MODELO (perfil próprio)
  if (modo === "privado" && role === "modelo") {
    await carregarPerfil();        // garante modelo_id
    await carregarOfertaAtiva();   // oferta
    carregarFeed();
    return;
  }

  // CLIENTE ou VISITANTE (perfil público)
  if (modo === "publico" && modelo_id) {
    await carregarPerfilPublico(); // dados públicos
    await carregarOfertaAtiva();   // 🔥 FALTAVA ISSO
    return;
  }

  // fallback de segurança
  console.warn("Perfil inválido, redirecionando");
  window.location.href = "/index.html";
}




async function carregarPerfil() {
  const res = await fetch("/api/modelo/me", {
    headers: { Authorization: "Bearer " + token }
  });

  if (!res.ok) return;

  const modelo = await res.json();

  // 🔒 fonte única de verdade
  modelo_id = Number(modelo.id);
  localStorage.setItem("modelo_id", modelo_id);

  aplicarPerfilNoDOM(modelo);
}

async function carregarPerfilPublico() {
  const res = await fetch(`/api/modelo/publico/${modelo_id}`);

  if (!res.ok) {
    alert("Perfil não encontrado");
    return;
  }

  const modelo = await res.json();

  // 🔒 garante modelo_id correto
  if (modelo?.id) {
    modelo_id = Number(modelo.id);
  }

  aplicarPerfilNoDOM(modelo);

// 🔹 VISITANTE
if (!role) {
  ofertaCard.style.display = "block";
}

// 🔹 CLIENTE
if (role === "cliente") {
  try {
    const vipRes = await fetch(`/api/vip/status/${modelo_id}`, {
      headers: { Authorization: "Bearer " + token }
    });

    const vipData = vipRes.ok ? await vipRes.json() : { vip: false };
    window.__CLIENTE_VIP__ = vipData.vip === true;

    if (window.__CLIENTE_VIP__) {
      // ❌ cliente VIP → NÃO mostra assinatura
      ofertaCard.style.display = "none";
      btnChat?.classList.remove("hidden");
    } else {
      // ✅ cliente NÃO VIP → mostra
      ofertaCard.style.display = "block";
      btnChat?.classList.add("hidden");
    }
  } catch (err) {
    console.error("Erro VIP:", err);
    window.__CLIENTE_VIP__ = false;
    ofertaCard.style.display = "block";
  }
}

// 🔹 MODELO
if (role === "modelo") {
  ofertaCard.style.display = "block";
}

// 🔹 MODELO
if (role === "modelo") {
  ofertaCard.style.display = "block";
}

  // 🔥 OFERTA SÓ DEPOIS DE TUDO PRONTO
  await carregarOfertaAtiva();
  carregarFeedPublico();
  window.__VIP_READY__ = true;
}

// 🔒 oferta ativa vira fonte da verdade
// 


// ===============================
// FEED
// ===============================
function carregarFeed() {
  if (!listaMidias) return;

  fetch("/api/feed/me", {
    headers: { Authorization: "Bearer " + token }
  })
    .then(r => r.json())
    .then(feed => {
      if (!Array.isArray(feed)) return;
      listaMidias.innerHTML = "";
      feed.forEach(item => adicionarMidia(item));
    });
}

function carregarFeedPublico() {
  if (!listaMidias) return;

  fetch(`/api/modelo/publico/${modelo_id}/feed`)

    .then(r => r.json())
    .then(data => {
      // 🔎 SUPORTE A QUALQUER FORMATO
      const feed = Array.isArray(data) ? data : data.feed || data.midias || [];

      listaMidias.innerHTML = "";

      feed.forEach(item => {
        adicionarMidia(item);
      });
    });
}

function aplicarPerfilNoDOM(modelo) {
  nomeEl.textContent = modelo.nome || "";
  profileBio.textContent = modelo.bio || "";

  if (modelo.avatar) {
    avatarImg.src = modelo.avatar;
  }

  if (modelo.capa) {
    capaImg.src = modelo.capa;
  }

  const localEl = document.getElementById("local-texto");

  if (localEl) {
    const local = [modelo.local]
      .filter(Boolean)
      .join(" • ");

    if (local) {
      localEl.textContent = local;
    } else {
      // se não tiver local, esconde o bloco
      localEl.parentElement.style.display = "none";
    }
  }
}



// ===============================
// AUTH GUARD
// ===============================
const stripe = stripe("pk_live_51Spb5lRtYLPrY4c3L6pxRlmkDK6E0OSU93T5B75V4pY39rJ3FVyPEa6ZDDgqUiY1XCCEay6uQcItbZY4EcAOkoJn00TtsQ8bbz");
let elements;
window.__CLIENTE_VIP__ = false;

const socket = io();
const params = new URLSearchParams(window.location.search);
const modeloParam = params.get("id");
const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

//DEFINIÇÃO SEGURA DE MODO
let modo = "publico";
if (token && role === "modelo" && !modeloParam) {
  modo = "privado";
}

if (role === "cliente" && modo === "privado") {
  window.location.href = "##############################";
  throw new Error("Cliente não pode acessar profile privado");
}
if (modo === "publico") {
  localStorage.removeItem("modelo_id");
}

let modelo_id = modeloParam
  ? Number(modeloParam)
  : role === "modelo"
    ? localStorage.getItem("modelo_id")
    : null;

// autentica socket
socket.emit("auth", { token });

// registra cliente online
if (role === "cliente" && token) {
  const decoded = decodeJWT(token);
  if (decoded?.id) {
    socket.emit("loginCliente", Number(decoded.id));
  }
}


// 🔒 Guard APENAS para perfil público
if (modo === "publico" && (!modelo_id || modelo_id === "undefined")) {
  alert("Modelo não identificada.");
  window.location.href = "###########################";
  throw new Error("modelo_id ausente no perfil público");
}


function decodeJWT(token) {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload));
  } catch (e) {
    return null;
  }
}

function logout() {
  localStorage.clear();
  window.location.href = "#########################";
}
const midiasFree = document.getElementById("midias-free");
const midiasPaid = document.getElementById("midias-paid");
const modalMidia = document.getElementById("modalMidia");
const fecharModal = document.getElementById("fecharModal");
const modalVideo = document.getElementById("modalVideo");


// INIT
document.addEventListener("DOMContentLoaded", () => {
  aplicarRoleNoBody();
  iniciarUploads();
  iniciarPerfil();

 document.getElementById("btnVipPix")?.addEventListener("click", () => {
  fecharEscolha();
  abrirPopupPix();
  });

 document.getElementById("fecharPix")?.addEventListener("click", () => {
 document.getElementById("popupPix")?.classList.add("hidden");
 });

 document.getElementById("btnVipCartao")?.addEventListener("click", () => {
 fecharEscolha();
 pagarComCartao();
 });

  


});

fecharModal?.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation();
  if (modalVideo) {
    modalVideo.pause();
    modalVideo.src = "";
  }
  modalMidia.classList.add("hidden");
});


// ROLE VISUAL
function aplicarRoleNoBody() {
  document.body.classList.remove("role-modelo", "role-cliente", "role-publico");
  if (role === "modelo") {
    document.body.classList.add("role-modelo");
  } 
  else if (role === "cliente") {
    document.body.classList.add("role-cliente");
  } 
  else {
    document.body.classList.add("role-publico");
  }
}


// PERFIL

function iniciarPerfil() {

  if (modo === "privado" && role === "modelo") {
    carregarPerfil();
    carregarFeed();
    return;
  }

  // CLIENTE ou VISITANTE (perfil público)
  if (modo === "publico" && modelo_id) {
    carregarPerfilPublico();
    return;
  }

  // fallback de segurança
  console.warn("Perfil inválido, redirecionando");
  window.location.href = "/index.html";
}

async function carregarPerfil() {
  const res = await fetch("/api/modelo/me", {
    headers: { Authorization: "Bearer " + token }
  });

  if (!res.ok) return;

  const modelo = await res.json();
  localStorage.setItem("modelo_id", modelo.id);
  modelo_id = modelo.id;

  aplicarPerfilNoDOM(modelo);
}

async function carregarPerfilPublico() {
  // PERFIL PÚBLICO → SEM TOKEN
  const res = await fetch(`/api/modelo/publico/${modelo_id}`);

  if (!res.ok) {
    alert("Perfil não encontrado");
    return;
  }

  const modelo = await res.json();

  aplicarPerfilNoDOM(modelo);

 if (role === "cliente") {
  try {
    const vipRes = await fetch(`/api/vip/status/${modelo_id}`, {
      headers: {
        Authorization: "Bearer " + localStorage.getItem("token")
      }
    });

    if (vipRes.ok) {
      const vipData = await vipRes.json();
      window.__CLIENTE_VIP__ = vipData.vip === true;

     if (window.__CLIENTE_VIP__) {
      btnVip.textContent = "VIP ativo";
      btnVip.disabled = true;
      btnChat?.classList.remove("hidden");
    } else {
      btnChat?.classList.add("hidden");
    }
  }
  } catch (err) {
    console.error("Erro ao verificar VIP:", err);
    window.__CLIENTE_VIP__ = false;
  }
  } else {
  window.__CLIENTE_VIP__ = false;

  if (btnVip) {
    btnVip.textContent = "Torne-se VIP";
    btnVip.disabled = false;
  }
 }

 carregarFeedPublico();
}


function valorBRL(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

// ===============================
// FEED
// ===============================
function carregarFeed() {
  if (!midiasFree || !midiasPaid) return;

  fetch("/api/feed/me", {
    headers: { Authorization: "Bearer " + token }
  })
    .then(r => r.json())
    .then(feed => {
      if (!Array.isArray(feed)) return;

      midiasFree.innerHTML = "";
      midiasPaid.innerHTML = "";

      feed.forEach(item => {
        if (item.tipo_conteudo === "paid") {
          adicionarMidia(item, midiasPaid);
        } else {
          adicionarMidia(item, midiasFree);
        }
      });
    });
}

function carregarFeedPublico() {
  if (!midiasFree || !midiasPaid) return;
  if (!modelo_id) return;

  fetch(`/api/modelo/publico/${modelo_id}/feed`)
    .then(r => r.json())
    .then(data => {
      // 🔎 SUPORTE A QUALQUER FORMATO
      const feed = Array.isArray(data)
        ? data
        : data.feed || data.midias || [];

      midiasFree.innerHTML = "";
      midiasPaid.innerHTML = "";

      feed.forEach(item => {
        // público: especial continua bloqueado
        if (item.tipo_conteudo === "paid") {
          adicionarMidia(item, midiasPaid);
        } else {
          adicionarMidia(item, midiasFree);
        }
      });
    })
    .catch(err => {
      console.error("Erro ao carregar feed público:", err);
    });
}

function fecharEscolha() {
  document
    .getElementById("escolhaPagamento")
    .classList.add("hidden");
}


// btnVip?.addEventListener("click", async () => {

//   // 👀 VISITANTE → popup Velvet
//   if (!role) {
//     abrirPopupVelvet({ tipo: "login" });
//     return;
//   }

//   // 🔒 CLIENTE → verifica VIP
//   try {
//     const statusRes = await fetch(`/api/vip/status/${modelo_id}`, {
//       headers: {
//         Authorization: `Bearer ${localStorage.getItem("token")}`
//       }
//     });

//     if (!statusRes.ok) {
//       throw new Error("Falha ao verificar status VIP");
//     }

//     const statusData = await statusRes.json();

//     if (statusData.vip === true) {
//       alert("💜 Você já é VIP desta modelo");
//       return;
//     }

//     // ✅ NÃO É VIP → ABRE POPUP DE PAGAMENTO
//     document
//       .getElementById("escolhaPagamento")
//       ?.classList.remove("hidden");

//   } catch (err) {
//     console.error("Erro ao verificar status VIP:", err);
//     alert("Erro ao verificar status VIP");
//   }
// });

// ===============================
// BIO
// // ===============================
// function iniciarBioPopup() {
//   const btnEditarBio = document.getElementById("btnEditarBio");
//   const popupBio = document.getElementById("popupBio");
//   const btnFecharPopup = document.getElementById("btnFecharPopup");

//   if (!btnEditarBio || !popupBio) return;

//   btnEditarBio.onclick = () => {
//     bio.value = bio.textContent.trim();
//     popupBio.classList.remove("hidden");
//   };

//   btnFecharPopup.onclick = () => popupBio.classList.add("hidden");
// }

// // ===============================
// // UPLOAD AVATAR
// // ===============================
// inputAvatar?.addEventListener("change", async () => {
//   const file = inputAvatar.files[0];
//   if (!file) return;

//   const fd = new FormData();
//   fd.append("avatar", file);

//   const res = await fetch("/uploadAvatar", {
//     method: "POST",
//     headers: {
//       Authorization: "Bearer " + token
//     },
//     body: fd
//   });

//   const data = await res.json();

//   if (data.url) {
//     avatar.src = data.url; // 🔥 atualiza na hora
//   } else {
//     alert("Erro ao atualizar avatar");
//   }
// });

// // ===============================
// // UPLOAD CAPA
// // ===============================
// capa?.addEventListener("change", async () => {
//   const file = capa.files[0];
//   if (!file) return;

//   const fd = new FormData();
//   fd.append("capa", file);

//   const res = await fetch("/uploadCapa", {
//     method: "POST",
//     headers: {
//       Authorization: "Bearer " + token
//     },
//     body: fd
//   });

//   const data = await res.json();

//   if (data.url) {
//     capa.src = data.url; // 🔥 atualiza na hora
//   } else {
//     alert("Erro ao atualizar capa");
//   }
// });

// capa?.addEventListener("change", async () => {
//     const file = capa.files[0];
//     if (!file) return;

//     const fd = new FormData();
//     fd.append("capa", file);

//     const res = await fetch("/uploadCapa", {
//       method: "POST",
//       headers: {
//         Authorization: "Bearer " + token
//       },
//       body: fd
//     });

//     const data = await res.json();
//     if (data.url) {
//       capa.src = data.url; // 🔥 atualiza na hora
//     }
//   });

function iniciarUploads() {
  inputMedia?.addEventListener("change", async () => {
    const file = inputMedia.files[0];
    if (!file) return;

    const fd = new FormData();
    fd.append("midia", file);
     if (file.type.startsWith("video")) {
    const thumbBlob = await gerarThumbnailVideo(file);
    fd.append("thumbnail", thumbBlob, "thumb.jpg");
  }
  const res = await fetch("/api/feed/upload", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: fd
  });

  if (!res.ok) {
    alert("Erro ao enviar mídia");
    return;
  }

  carregarFeed(); // recarrega feed normalmente
});
}

// ===============================
// MIDIA
// ===============================
// function adicionarMidia(conteudo) {
//   const { id, url, tipo, thumbnail_url } = conteudo;
//   const isVideo = tipo === "video";

//   const card = document.createElement("div");
//   card.className = "midiaCard";

//   const img = document.createElement("img");
//   img.className = "midiaThumb";

//   if (isVideo) {
//     img.src = getVideoThumbnail(url, thumbnail_url);
//     card.classList.add("video");
//   } else {
//     img.src = url;
//   }

//   card.appendChild(img);

//   // 🔒 bloqueio VIP (mantém sua lógica)
//   const deveBloquear =
//     role !== "modelo" && window.__CLIENTE_VIP__ !== true;

//   if (deveBloquear) {
//     card.classList.add("bloqueada");
//     card.onclick = () => {
//       if (!role) {
//         abrirPopupVelvet({ tipo: "login" });
//       } else {
//         abrirPopupVelvet({ tipo: "vip" });
//       }
//     };
//   } else {
//     card.onclick = () => abrirModalMidia(url, isVideo);
//   }

//   // ❌ excluir (só modelo)
//   if (role === "modelo") {
//     const btnExcluir = document.createElement("button");
//     btnExcluir.className = "btnExcluirMidia";
//     btnExcluir.textContent = "Excluir";
//     btnExcluir.onclick = (e) => {
//       e.stopPropagation();
//       excluirMidia(id, card);
//     };
//     card.appendChild(btnExcluir);
//   }

//   midias.appendChild(card);

//   img.onerror = () => {
//   img.src = "/assets/capaDefault.jpg";
// };
// }

function getVideoThumbnail(url, thumbnail_url) {
  if (thumbnail_url) return thumbnail_url;

  if (url && url.includes("cloudinary.com")) {
    return url.replace(/\.(mp4|webm|ogg|mov)$/i, ".jpg");
  }

  // 🔒 BACKBLAZE OU QUALQUER OUTRO → fallback
  return "/assets/capaDefault.jpg";
}

async function gerarThumbnailVideo(file) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");

    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;

    video.addEventListener("loadeddata", () => {
      video.currentTime = 1;
    });

    video.addEventListener("seeked", () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);

      canvas.toBlob(blob => {
        resolve(blob);
        URL.revokeObjectURL(video.src);
      }, "image/jpeg", 0.85);
    });

    video.addEventListener("error", reject);
  });
}

function abrirModalMidia(url, isVideo) {
  const modal = document.getElementById("modalMidia");
  const img = document.getElementById("modalImg");
  const video = document.getElementById("modalVideo");

  img.style.display = "none";
  video.style.display = "none";

  // 🔥 LIMPA ESTADO ANTERIOR
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

// FECHAR MODAL
document.getElementById("fecharModal")?.addEventListener("click", (e) => {
  e.stopPropagation(); // 🔥 MUITO IMPORTANTE

  const modal = document.getElementById("modalMidia");
  const video = document.getElementById("modalVideo");

  video.pause();
  video.src = "";

  modal.classList.add("hidden");
});

async function excluirMidia(id, card) {
  if (!confirm("Excluir esta mídia?")) return;

  const res = await fetch(`/api/conteudos/${id}`, {

    method: "DELETE",
    headers: {
      Authorization: "Bearer " + token
    }
  });

  if (res.ok) {
    card.remove();
  } else {
    alert("Erro ao excluir mídia");
  }
}

// ===============================
// DOM PERFIL
// ===============================

function aplicarPerfilNoDOM(modelo) {
  console.log("🔥 PERFIL APLICADO", modelo);
  document.getElementById("perfil-nome").textContent =
    modelo.nome || "";

  document.getElementById("perfil-bio").textContent =
    modelo.bio || "";

  const avatar =
    modelo.avatar_url ||
    modelo.avatar ||
    "/assets/avatar-default.png";

  const capa =
    modelo.capa_url ||
    modelo.capa ||
    "/assets/capa-default.jpg";

  document.getElementById("perfil-avatar").src = avatar;
  document.getElementById("perfil-capa").src = capa;

  document.getElementById("local-texto").textContent =
    modelo.local || "";
}


async function abrirPopupPix() {
  if (!modelo_id) {
    alert("Modelo não identificada");
    return;
  }

  //ASSINATURA
//   const taxaTransacao  = Number((valorAssinatura * 0.10).toFixed(2));
//   const taxaPlataforma = Number((valorAssinatura * 0.05).toFixed(2));
//   const valorTotal     = Number((valorAssinatura + taxaTransacao + taxaPlataforma).toFixed(2)
//   );

//   document.getElementById("pixValorBase").innerText =
//     valorBRL(valorAssinatura);

//   document.getElementById("pixTaxaTransacao").innerText =
//     valorBRL(taxaTransacao);

//   document.getElementById("pixTaxaPlataforma").innerText =
//     valorBRL(taxaPlataforma);

//   document.getElementById("pixValorTotal").innerText =
//     valorBRL(valorTotal);

//   document.getElementById("popupPix").classList.remove("hidden");

//   const res = await fetch("/api/pagamento/vip/pix", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: "Bearer " + token
//     },
//     body: JSON.stringify({
//       modelo_id,
//       valor_assinatura: valorAssinatura // 👈 SÓ ISSO
//     })
//   });

//   const data = await res.json();

//   if (!res.ok) {
//     alert(data.error || "Erro ao gerar PIX");
//     return;
//   }

//   document.getElementById("pixQr").src =
//     "data:image/png;base64," + data.qr_code;

//   document.getElementById("pixCopia").value = data.copia_cola;

//   window.__PIX_PAYMENT_ID__ = data.payment_id;
// 
}

function copiarPix() {
  const textarea = document.getElementById("pixCopia");
  textarea.select();
  document.execCommand("copy");
  alert("Código Pix copiado 💜");
}

// socket.on("vipAtivado", ({ modelo_id: modeloVip }) => {
//   if (Number(modeloVip) !== Number(modelo_id)) return;

//   // 🔒 fecha popup PIX
//   document.getElementById("popupPix")?.classList.add("hidden");

//   // 🔔 popup simples de sucesso
//   mostrarVipAtivadoPopup();

//   // 🔥 atualiza estado local
//   window.__CLIENTE_VIP__ = true;

//   // 🔘 botão vira VIP ativo
//   if (btnVip) {
//     btnVip.textContent = "VIP ativo";
//     btnVip.disabled = true;
//   }

//   // 🔓 desbloqueia conteúdos
//   carregarFeedPublico();
// });

// async function pagarComCartao() {
//   fecharEscolha();

//   // 🔢 VALOR BASE (ASSINATURA)
//   const valorAssinatura = 20.00;

//   // 🔥 TAXAS PERCENTUAIS (CORRETO)
//   const taxaTransacao  = Number((valorAssinatura * 0.10).toFixed(2)); // 10%
//   const taxaPlataforma = Number((valorAssinatura * 0.05).toFixed(2)); // 5%

//   const valorTotal = Number(
//     (valorAssinatura + taxaTransacao + taxaPlataforma).toFixed(2)
//   );

  // document.getElementById("cartaoValorBase").innerText =
  //   valorBRL(valorAssinatura);

  // document.getElementById("cartaoTaxaTransacao").innerText =
  //   valorBRL(taxaTransacao);

  // document.getElementById("cartaoTaxaPlataforma").innerText =
  //   valorBRL(taxaPlataforma);

  // document.getElementById("cartaoValorTotal").innerText =
  //   valorBRL(valorTotal);

  // // 🔓 ABRE MODAL
  // document.getElementById("paymentModal").classList.remove("hidden");

  // // 🔥 CRIA PAYMENT INTENT
  // const res = await fetch("/api/pagamento/vip/cartao", {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     Authorization: "Bearer " + token
  //   },
  //   body: JSON.stringify({
  //     modelo_id,
  //     valor_assinatura: valorAssinatura,
  //     taxa_transacao: taxaTransacao,
  //     taxa_plataforma: taxaPlataforma
  //   })
  //  });

  //  const data = await res.json();

  //  if (!res.ok) {
  //   alert(data.error || "Erro no pagamento");
  //   return;
  // }

  // elements = stripe.elements({ clientSecret: data.clientSecret });

  // const paymentElement = elements.create("payment");
  // paymentElement.mount("#payment-element");
//}
//  // ===============================
//  // 💳 CONFIRMAR PAGAMENTO CARTÃO
//  // ===============================
//  document
//   .querySelector("#paymentModal .btn-confirmar-desbloqueio")
//   ?.addEventListener("click", async () => {

//     if (!elements) {
//       alert("Pagamento ainda não inicializado");
//       return;
//     }

//     const { error } = await stripe.confirmPayment({
//       elements,
//       confirmParams: {
//         return_url: window.location.href // fallback se Stripe pedir redirect
//       }
//     });

//     if (error) {
//       alert(error.message);
//     }
//});

// async function pagarComCartaoRecorrente() {
//   fecharEscolha();

//   // 🔓 ABRE MODAL
//   document.getElementById("paymentModal").classList.remove("hidden");

//   // 🔁 CRIA ASSINATURA (NÃO payment intent)
//   const res = await fetch("/api/vip/cartao/assinatura", {
//     method: "POST",
//     headers: {
//       "Content-Type": "application/json",
//       Authorization: "Bearer " + token
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

// function mostrarVipAtivadoPopup() {
//   const popup = document.getElementById("popupVipAtivado");

//   if (!popup) {
//     console.warn("popupVipAtivado não encontrado no DOM");
//     alert("VIP ativado com sucesso!");
//     return;
//   }

//   popup.classList.remove("hidden");
// }


function fecharVipAtivado() {
  document
    .getElementById("popupVipAtivado")
    .classList.add("hidden");
}

//💜 POPUP VELVET ACESSO para visitantes novos
function abrirPopupVelvet({ tipo }) {
  const popup = document.getElementById("popupVelvetAcesso");
  const texto = document.getElementById("popupVelvetTexto");
  const btn   = document.getElementById("btnVelvetAcao");

  if (!popup) return;

  if (tipo === "login") {
    texto.textContent =
      "Entre ou crie sua conta para acessar este conteúdo";
    btn.textContent = "Entrar / Criar conta";
    btn.onclick = () => {
      window.location.href = "/index.html";
    };
  }

  if (tipo === "vip") {
    texto.textContent =
      "Este conteúdo é exclusivo para membros VIP";
    btn.textContent = "Tornar-se VIP";
    btn.onclick = () => {
      popup.classList.add("hidden");
      document.getElementById("escolhaPagamento")?.classList.remove("hidden");
    };
  }

  popup.classList.remove("hidden");
}

// fechar clicando fora
document
  .getElementById("popupVelvetAcesso")
  ?.addEventListener("click", (e) => {
    if (e.target.id === "popupVelvetAcesso") {
      e.currentTarget.classList.add("hidden");
    }
  });

  function fecharPagamento() {
  const modal = document.getElementById("paymentModal");

  if (modal) {
    modal.classList.add("hidden");
  }

  // limpeza de segurança
  const paymentElement = document.getElementById("payment-element");
  if (paymentElement) {
    paymentElement.innerHTML = "";
  }

  elements = null;
}