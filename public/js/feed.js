// ===============================
// SESSÃO (sem guard — portfólio público)
// ===============================
const token = localStorage.getItem("token");

async function logout() {
  const token = localStorage.getItem("token");
  if (token) {
    try { await fetch("/api/logout", { method: "POST", headers: { Authorization: "Bearer " + token } }); } catch (_) {}
  }
  localStorage.clear();
  window.location.href = "/index.html";
}

function getFeedText(key, fallback = "") {
  if (typeof t === "function") return t(key);
  return fallback;
}

// ===============================
// RENDER CARD
// ===============================
function criarCard(modelo) {
  const card = document.createElement("div");
  card.className = "modelo-card";

  const foto = modelo.capa || modelo.avatar || "/assets/avatar.png";
  const avatar = modelo.avatar || "/assets/avatar.png";

  // badge de ranking
  let badgeRank = "";
  if (modelo.top1) badgeRank = `<span class="badge badge-top1">🥇 #1</span>`;
  else if (modelo.top2) badgeRank = `<span class="badge badge-top2">🥈 #2</span>`;
  else if (modelo.top3) badgeRank = `<span class="badge badge-top3">🥉 #3</span>`;

  // badges de destaque — textos via i18n
  const badges = [];
  if (modelo.online)            badges.push(`<span class="badge badge-online">${t("feed.badge_online")}</span>`);
  if (modelo.responsiva)        badges.push(`<span class="badge badge-responsiva">${t("feed.badge_responsiva")}</span>`);
  if (modelo.ativa_conteudo)    badges.push(`<span class="badge badge-conteudo">${t("feed.badge_ativa")}</span>`);
  if (modelo.is_new)            badges.push(`<span class="badge badge-new">${t("feed.badge_nova")}</span>`);
  if (modelo.total_premium > 0) badges.push(`<span class="badge badge-premium">${t("feed.badge_premium")}</span>`);

  const fasFormatado = modelo.total_fas >= 1000
    ? (modelo.total_fas / 1000).toFixed(1) + "k"
    : modelo.total_fas;

  const fasTexto = t("feed.fas_contador").replace("{n}", fasFormatado);

  card.innerHTML = `
    <div class="modelo-foto" style="background-image:url('${foto}')">
      <div class="modelo-foto-overlay"></div>
      ${badgeRank}
      <div class="card-badges">${badges.join("")}</div>
      <img class="avatar-flutuante" src="${avatar}" alt="${modelo.nome_exibicao || ""}">
    </div>
    <div class="modelo-info">
      <div class="modelo-header">
        <span class="modelo-nome">${modelo.nome_exibicao || ""}</span>
        ${modelo.online ? '<span class="dot-online"></span>' : ''}
      </div>
      <div class="modelo-bio">${modelo.bio || ""}</div>
      <div class="modelo-footer">
        <span class="fas-contador">${fasTexto}</span>
      </div>
    </div>
  `;

  card.onclick = () => {
    const modeloId = Number(modelo.modelo_id);
    if (!modeloId) return;
    window.location.href = `perfil.html?modelo_id=${modeloId}`;
  };

  return card;
}

// ===============================
// RENDER SEÇÃO
// ===============================
function renderSecao(containerId, modelos, emptyMsg) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = "";

  if (!modelos || modelos.length === 0) {
    container.closest(".feed-secao")?.classList.add("feed-secao--vazia");
    return;
  }

  modelos.forEach(m => container.appendChild(criarCard(m)));
}

// ===============================
// RENDER FEED COMPLETO
// ===============================
window.renderFeed = async function () {
  const wrapper = document.getElementById("listaModelos");
  if (!wrapper) return;

  wrapper.innerHTML = `<div class="feed-loading">${t("feed.loading")}</div>`;

  try {
    const res = await fetch("/api/modelos", {
      headers: { Authorization: "Bearer " + token }
    });

    if (!res.ok) throw new Error("Erro ao buscar modelos");

    const { online, novas, emAlta, recomendadas, descubraMais } = await res.json();

    wrapper.innerHTML = `
      ${online.length ? `
      <section class="feed-secao">
        <h2 class="feed-secao-titulo">${t("feed.sec_online")}</h2>
        <div class="feed-grid" id="sec-online"></div>
      </section>` : ""}

      ${recomendadas.length ? `
      <section class="feed-secao">
        <h2 class="feed-secao-titulo">${t("feed.sec_recomendadas")}</h2>
        <div class="feed-grid" id="sec-recomendadas"></div>
      </section>` : ""}

      <section class="feed-secao">
        <h2 class="feed-secao-titulo">${t("feed.sec_emalta")}</h2>
        <div class="feed-grid" id="sec-emalta"></div>
      </section>

      ${novas.length ? `
      <section class="feed-secao">
        <h2 class="feed-secao-titulo">${t("feed.sec_novas")}</h2>
        <div class="feed-grid" id="sec-novas"></div>
      </section>` : ""}

      ${descubraMais && descubraMais.length ? `
      <section class="feed-secao">
        <h2 class="feed-secao-titulo">${t("feed.sec_descubra") || "✨ Descubra mais"}</h2>
        <div class="feed-grid" id="sec-descubra"></div>
      </section>` : ""}
    `;

    renderSecao("sec-online", online);
    renderSecao("sec-recomendadas", recomendadas);
    renderSecao("sec-emalta", emAlta, "Nenhuma modelo disponível");
    renderSecao("sec-novas", novas);
    renderSecao("sec-descubra", descubraMais || []);

  } catch (err) {
    console.error("Erro ao carregar o feed:", err);
    wrapper.innerHTML = `<p class="feed-erro">Erro ao carregar o feed.</p>`;
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  // aguarda i18n carregar antes de renderizar os textos dos badges/seções
  if (typeof whenI18nReady === "function") await whenI18nReady();
  window.renderFeed();

  // re-renderiza se o usuário trocar o idioma com o feed aberto
  window.addEventListener("languageChanged", () => window.renderFeed());
});
