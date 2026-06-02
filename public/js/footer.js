document.addEventListener("DOMContentLoaded", () => {
    function atualizarAvatarFooter(user = {}) {
  const avatar = document.getElementById("footerAvatar");
  if (!avatar) return;

  const avatarUrl =
    user.avatar_url ||
    user.avatar ||
    user.foto_perfil ||
    user.foto ||
    localStorage.getItem("avatar_url") ||
    localStorage.getItem("avatar") ||
    "";

  if (avatarUrl && typeof avatarUrl === "string" && avatarUrl.trim() !== "") {
    avatar.src = avatarUrl;
  } else {
    avatar.src = "/assets/avatar.png";
  }

  avatar.onerror = () => {
    avatar.src = "/assets/avatar.png";
  };
}

 atualizarAvatarFooter();

const role = localStorage.getItem("role");
const menu = document.getElementById("footerModelo");
const subMenu = document.getElementById("footerSubMenu");

  if (!menu) return;

const modeloLogado = Number(localStorage.getItem("modelo_id"));

  const params = new URLSearchParams(window.location.search);
  const modeloIdUrl = Number(params.get("modelo_id") || params.get("id"));

  const ehPaginaDePerfil = !!modeloIdUrl;
  const ehDonaDoPerfil = role === "modelo" && modeloLogado === modeloIdUrl;

  if (ehPaginaDePerfil) {
    if (ehDonaDoPerfil) {
      menu.style.display = "flex";
    } else {
      menu.style.display = "none";
      return;
    }
  } else {
    if (role === "modelo") {
      menu.style.display = "flex";
    } else {
      menu.style.display = "none";
      return;
    }
  }

  const btnPerfil = document.getElementById("btnAvatar");
  const btnMedia = document.getElementById("btnPost");
  const btnConteudos = document.getElementById("btnConteudos");
  const btnVip = document.getElementById("btnVip");
  const btnLinks = document.getElementById("btnLinks");

  // =========================
  // FECHAR MENU AO CLICAR FORA
  // =========================

  document.addEventListener("click", (e) => {
    if (!subMenu.contains(e.target) && !e.target.closest(".footer-btn")) {
      fecharMenu();
    }
  });

  // =========================
  // BOTÃO POST
  // =========================

btnMedia?.addEventListener("click", () => {
  abrirMenu(`
    <button id="menuPostFeed">${t("footer.postar_feed")}</button>
    <button id="menuPostPremium">${t("footer.postar_premium")}</button>
  `);
});

  // =========================
  // CONTEÚDOS
  // =========================

  btnConteudos?.addEventListener("click", () => {
    window.location.href = "/conteudos.html";
  });

  // =========================
  // VIP
  // =========================

  btnVip?.addEventListener("click", () => {
    window.location.href = "/ofertas.html";
  });

  // =========================
  // LINKS
  // =========================

  btnLinks?.addEventListener("click", () => {
    window.location.href = "/links.html";
  });

  // =========================
  // PERFIL
  // =========================

  btnPerfil?.addEventListener("click", () => {

    const modeloId = localStorage.getItem("modelo_id");

    if (!modeloId) {
      console.warn("modelo_id não encontrado no localStorage");
      return;
    }

    window.location.href = `/perfil.html?id=${modeloId}`;

  });

  // =========================
  // ABRIR MENU
  // =========================

function abrirMenu(html) {
  subMenu.innerHTML = html;
  subMenu.style.display = "flex";
  registrarEventosMenu();
}

function fecharMenu() {
  subMenu.style.display = "none";
  subMenu.innerHTML = "";
}

  // =========================
  // REGISTRAR EVENTOS DO MENU
  // =========================

function registrarEventosMenu() {
  const btnFeed = document.getElementById("menuPostFeed");
  const btnPremium = document.getElementById("menuPostPremium");

  if (btnFeed) {
    btnFeed.onclick = postarFeed;
  }

  if (btnPremium) {
    btnPremium.onclick = postarPremium;
  }
}

function postarFeed() {
  const popup = document.getElementById("popupUploadFeed");
  if (!popup) return;
  popup.classList.remove("hidden");
}

function postarPremium() {
  const popup = document.getElementById("popupUploadPremium");
  if (!popup) return;
  popup.classList.remove("hidden");
}


});

