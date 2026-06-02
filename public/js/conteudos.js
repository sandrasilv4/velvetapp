// ===============================
// AUTH GUARD
// ===============================
const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

if (!token) {
  window.location.href = "/index.html";
  throw new Error("Sem token");
}

let paginaAtual = 1;
const limite = 9;
let totalPaginas = 1;

document.addEventListener("DOMContentLoaded", async () => {
  carregarConteudos();
  iniciarLazyLoading();

  // Bloquear uploads para modelos não verificadas
  if (role === "modelo") {
    try {
      const meRes = await fetch("/api/modelo/me", { headers: { Authorization: "Bearer " + token } });
      if (meRes.ok) {
        const me = await meRes.json();
        if (!me.verificada) {
          // Botões ficam visíveis mas ao clicar abre popup de verificação
          ["btnNovoConteudo", "btnEnviarConteudo"].forEach(id => {
            const el = document.getElementById(id);
            if (!el) return;
            el.style.opacity = "0.55";
            el.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopImmediatePropagation();
              abrirPopupContaNaoVerificada();
            }, true);
          });
          const fi = document.getElementById("fileConteudo");
          if (fi) fi.addEventListener("click", (e) => { e.preventDefault(); abrirPopupContaNaoVerificada(); }, true);
        }
      }
    } catch (e) { /* silently ignore */ }
  }

  const btnNovo = document.getElementById("btnNovoConteudo");
  const modal = document.getElementById("modalNovoConteudo");
  const btnFechar = document.getElementById("btnFecharModal");
  const btnEnviar = document.getElementById("btnEnviarConteudo");

  // =========================
  // CONTEUDOS (PÁGINA)
  // =========================

  const fileInput = document.getElementById("fileConteudo");
  const fileName = document.getElementById("fileName");

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const files = fileInput.files;

      if (!files || files.length === 0) {
        fileName.textContent = t("conteudos.nenhum_arquivo");
        return;
      }

      if (files.length > 10) {
        alert(t("conteudos.max_arquivos"));
        fileInput.value = "";
        fileName.textContent = t("conteudos.nenhum_arquivo");
        return;
      }

      if (files.length === 1) {
        fileName.textContent = files[0].name;
      } else {
        fileName.textContent = t("conteudos.arquivos_selecionados").replace("{count}", files.length);
      }
    });
  }

  btnNovo?.addEventListener("click", () => modal.classList.remove("hidden"));
  btnFechar?.addEventListener("click", fecharModalNovoConteudo);

  btnEnviar?.addEventListener("click", () => {
    if (!fileInput) {
      alert(t("conteudos.erro_upload_campo"));
      return;
    }

    const files = fileInput.files;

    if (!files || files.length === 0) {
      alert(t("conteudos.selecione_arquivo"));
      return;
    }

    if (files.length > 10) {
      alert(t("conteudos.max_arquivos"));
      return;
    }

    const formData = new FormData();
    for (const file of files) {
      formData.append("file", file);
    }

    const progressContainer = document.getElementById("uploadProgressContainer");
    const progressBar = document.getElementById("uploadProgressBar");
    const progressText = document.getElementById("uploadPercent");

    progressContainer?.classList.remove("hidden");

    btnEnviar.disabled = true;
    btnEnviar.textContent = t("conteudos.enviando");

    const xhr = new XMLHttpRequest();

    xhr.open("POST", "/api/conteudos", true);
    xhr.setRequestHeader("Authorization", "Bearer " + token);

    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        if (progressBar) progressBar.style.width = percent + "%";
        if (progressText) progressText.textContent = percent + "%";
      }
    };

    xhr.onload = async function () {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (progressBar) progressBar.style.width = "100%";
        if (progressText) progressText.textContent = "100%";

        setTimeout(async () => {
          fecharModalNovoConteudo();
          await carregarConteudos();

          fileInput.value = "";
          if (fileName) fileName.textContent = t("conteudos.nenhum_arquivo");

          if (progressBar) progressBar.style.width = "0%";
          if (progressText) progressText.textContent = "0%";
          progressContainer?.classList.add("hidden");

          btnEnviar.disabled = false;
          btnEnviar.textContent = t("conteudos.btn_enviar");
        }, 500);
      } else {
        alert(t("conteudos.erro_upload"));
        btnEnviar.disabled = false;
        btnEnviar.textContent = t("conteudos.btn_enviar");
      }
    };

    xhr.onerror = function () {
      alert(t("conteudos.erro_conexao"));
      btnEnviar.disabled = false;
      btnEnviar.textContent = t("conteudos.btn_enviar");
    };

    xhr.send(formData);
  });

  // =========================
  // FEED (PADRÃO FOOTER)
  // =========================

  const uploadArea = document.getElementById("uploadArea");
  const fileFeed = document.getElementById("fileFeed");
  const previewContainer = document.getElementById("previewContainer");

  uploadArea?.addEventListener("click", () => {
    fileFeed?.click();
  });

  fileFeed?.addEventListener("change", () => {
    const file = fileFeed.files?.[0];
    if (!file) return;

    previewContainer.innerHTML = "";

    const url = URL.createObjectURL(file);

    if (file.type.startsWith("video")) {
      previewContainer.innerHTML = `<video src="${url}" controls></video>`;
    } else {
      previewContainer.innerHTML = `<img src="${url}">`;
    }
  });

  // =========================
  // ENVIAR FEED
  // =========================

  const btnEnviarFeed = document.getElementById("btnEnviarFeed");

  btnEnviarFeed?.addEventListener("click", async () => {
    const file = fileFeed?.files?.[0];

    if (!file) {
      alert(t("perfil.alert_selecione_midia"));
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("tipo_conteudo", "feed");

    btnEnviarFeed.disabled = true;
    btnEnviarFeed.textContent = t("perfil.enviando");

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

      document.getElementById("popupUploadFeed")?.classList.add("hidden");

      fileFeed.value = "";
      previewContainer.innerHTML = "";

    } catch (err) {
      console.error(err);
      alert(t("perfil.erro_upload"));
    } finally {
      btnEnviarFeed.disabled = false;
      btnEnviarFeed.textContent = t("perfil.upload_feed_btn");
    }
  });

  // =========================
  // PREMIUM (PADRÃO FOOTER)
  // =========================

  const filePremium = document.getElementById("filePremium");
  const previewPremium = document.getElementById("previewPremium");
  const btnEnviarPremium = document.getElementById("btnEnviarPremium");

  document.getElementById("uploadAreaPremium")
    ?.addEventListener("click", () => filePremium?.click());

  filePremium?.addEventListener("change", () => {
    const files = Array.from(filePremium.files || []);
    previewPremium.innerHTML = "";

    files.forEach(file => {
      const url = URL.createObjectURL(file);

      const item = document.createElement("div");
      item.innerHTML = file.type.startsWith("video")
        ? `<video src="${url}" controls></video>`
        : `<img src="${url}">`;

      previewPremium.appendChild(item);
    });
  });

  btnEnviarPremium?.addEventListener("click", async () => {
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

      document.getElementById("popupUploadPremium")?.classList.add("hidden");
      filePremium.value = "";
      previewPremium.innerHTML = "";
      document.getElementById("premiumTexto").value = "";
      document.getElementById("premiumPreco").value = "";
      resetarBarraUpload("premium");

    } catch (err) {
      console.error("Erro publicar premium:", err);
      alert(t("perfil.erro_publicar_premium"));
      resetarBarraUpload("premium");
    } finally {
      btnEnviarPremium.disabled = false;
      btnEnviarPremium.textContent = t("perfil.upload_premium_btn");
    }
  });

  // =========================
  // VIEWER
  // =========================

  const btnFecharViewer = document.getElementById("btnFecharViewer");
  const modalViewer = document.getElementById("modalVisualizarConteudo");

  btnFecharViewer?.addEventListener("click", fecharViewer);

  modalViewer?.addEventListener("click", (e) => {
    if (e.target.classList.contains("modal-backdrop")) {
      fecharViewer();
    }
  });

  // =========================
  // FECHAR POPUPS
  // =========================

  document.getElementById("uploadClose")?.addEventListener("click", () => {
    document.getElementById("popupUploadFeed")?.classList.add("hidden");
  });

  document.getElementById("uploadBackdrop")?.addEventListener("click", () => {
    document.getElementById("popupUploadFeed")?.classList.add("hidden");
  });

  document.getElementById("premiumClose")?.addEventListener("click", () => {
    document.getElementById("popupUploadPremium")?.classList.add("hidden");
  });

  document.getElementById("premiumBackdrop")?.addEventListener("click", () => {
    document.getElementById("popupUploadPremium")?.classList.add("hidden");
  });

  // =========================
// PAGINAÇÃO
// =========================

document.getElementById("btnAnterior")?.addEventListener("click", () => {
  if (paginaAtual > 1) {
    paginaAtual--;
    carregarConteudos();
  }
});

document.getElementById("btnProxima")?.addEventListener("click", () => {
  if (paginaAtual < totalPaginas) {
    paginaAtual++;
    carregarConteudos();
  }
});

});

async function carregarConteudos() {

  try {

    const res = await fetch(
      `/api/conteudos?venda=true&page=${paginaAtual}&limit=${limite}`,
      {
        headers: {
          Authorization: "Bearer " + token
        }
      }
    );

    if (!res.ok) throw new Error("Erro ao carregar conteúdos");

    const data = await res.json();

    renderizarConteudos(data.conteudos);

    totalPaginas = data.totalPaginas;

    atualizarPaginacao();

  } catch (err) {
    console.error(err.message);
  }

}

let observer = null;

function renderizarConteudos(conteudos) {

  const grid = document.getElementById("conteudosGrid");
  const vazio = document.getElementById("conteudosVazio");

  grid.innerHTML = "";

  if (!conteudos || conteudos.length === 0) {
    vazio.classList.remove("hidden");
    return;
  }

  vazio.classList.add("hidden");

  conteudos.forEach(c => {

    const card = document.createElement("div");
    card.className = "card-conteudo";

    const img = document.createElement("img");
    img.className = "card-thumb";

    let src;

    // ===============================
    // VIDEO (Cloudflare thumbnail)
    // ===============================

    if (c.tipo === "video") {

      src = c.thumbnail_url;

      if (!src && c.url && c.url.includes("videodelivery.net")) {

const match = c.url.match(/videodelivery\.net\/([^\/]+)/);
const videoId = match ? match[1] : null;

if (videoId) {
  src = `https://videodelivery.net/${videoId}/thumbnails/thumbnail.jpg`;
} else {
  src = "/assets/capa.png";
}

      }

    } else {

      // ===============================
      // IMAGEM NORMAL
      // ===============================

      src = c.url;

    }

    // ===============================
    // LAZY LOADING
    // ===============================

    img.loading = "lazy";
    img.dataset.src = src || "/assets/video-thumb.png";
    img.src = "/assets/thumb-default.png";

    if (observer) observer.observe(img);

    card.appendChild(img);

    // ===============================
    // OVERLAY PLAY
    // ===============================

    if (c.tipo === "video") {

      const overlay = document.createElement("div");
      overlay.className = "play-overlay";

      const icon = document.createElement("span");
      icon.textContent = "▶";

      overlay.appendChild(icon);
      card.appendChild(overlay);

    }

    // ===============================
    // BOTÃO EXCLUIR
    // ===============================

    const btnExcluir = document.createElement("button");
    btnExcluir.className = "btn-excluir";
    btnExcluir.innerHTML = "×";

    btnExcluir.addEventListener("click", async (e) => {

      e.stopPropagation();

      const ok = confirm(t("conteudos.confirm_excluir"));
      if (!ok) return;

      await excluirConteudo(c.id);

    });

    card.addEventListener("click", () => {
      abrirViewer(c);
    });

    card.appendChild(btnExcluir);

    grid.appendChild(card);

  });

}

function fecharModalNovoConteudo() {
  const modal = document.getElementById("modalNovoConteudo");
  if (modal) modal.classList.add("hidden");
}

function abrirViewer(conteudo) {

  const modal = document.getElementById("modalVisualizarConteudo");
  const viewer = document.getElementById("viewerConteudo");

  viewer.innerHTML = "";

if (conteudo.tipo === "video") {

  if (conteudo.url.includes("videodelivery.net")) {

    // extrai somente o ID do vídeo
    const match = conteudo.url.match(/videodelivery\.net\/([^\/]+)/);
    const videoId = match ? match[1] : null;

    if (!videoId) {
      console.error("VideoId inválido:", conteudo.url);
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.src = `https://iframe.videodelivery.net/${videoId}?autoplay=true`;
    iframe.allow =
      "accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture";
    iframe.allowFullscreen = true;

    viewer.appendChild(iframe);

  } else {

    const video = document.createElement("video");
    video.src = conteudo.url;
    video.controls = true;
    video.autoplay = true;

    viewer.appendChild(video);

  }
} else {

    const img = document.createElement("img");
    img.src = conteudo.url;
    viewer.appendChild(img);

  }

  modal.classList.remove("hidden");
}

function fecharViewer() {

  const modal = document.getElementById("modalVisualizarConteudo");
  const viewer = document.getElementById("viewerConteudo");

  const video = viewer.querySelector("video");
  const iframe = viewer.querySelector("iframe");

  if (video) {
    video.pause();
    video.src = "";
  }

  if (iframe) {
    iframe.src = "";
  }

  viewer.innerHTML = "";

  modal.classList.add("hidden");

}

async function excluirConteudo(conteudoId) {
  try {
    const res = await fetch(`/api/conteudos/${conteudoId}`, {
      method: "DELETE",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      const erro = await res.text();
      throw new Error(erro || "Erro ao excluir conteúdo");
    }

    // recarrega lista
    await carregarConteudos();

  } catch (err) {
    console.error("Erro ao excluir:", err.message);
    alert(t("conteudos.erro_excluir"));
  }
}

function iniciarLazyLoading(){

  observer = new IntersectionObserver((entries) => {

    entries.forEach(entry => {

      if(entry.isIntersecting){

        const el = entry.target;

        const src = el.dataset.src;

        if(src){
          el.src = src;
          el.removeAttribute("data-src");
        }

        observer.unobserve(el);

      }

    });

  },{
    rootMargin: "200px"
  });

}

function atualizarPaginacao(){

  const info = document.getElementById("paginaInfo");
  const btnAnterior = document.getElementById("btnAnterior");
  const btnProxima = document.getElementById("btnProxima");

  info.textContent = `${paginaAtual} / ${totalPaginas}`;

  btnAnterior.disabled = paginaAtual === 1;
  btnProxima.disabled = paginaAtual === totalPaginas;

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
        Apenas modelos com conta verificada podem fazer upload de conteúdo.<br>
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
