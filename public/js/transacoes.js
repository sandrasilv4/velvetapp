let todasTransacoes = [];
let transacoesFiltradas = [];
let paginaAtual = 1;
const itensPorPagina = 10;

function getToken() {
  return localStorage.getItem("token");
}

function getLocaleAtual() {
  if (typeof getCurrentLanguage === "function") {
    return getCurrentLanguage();
  }
  return localStorage.getItem("idioma") || "pt";
}

function formatarData(data) {
  if (!data) return "—";

  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleString(getLocaleAtual());
}

function formatarValor(valor) {
  const numero = Number(valor);

  if (Number.isNaN(numero)) return "R$ 0,00";

  return numero.toLocaleString(getLocaleAtual(), {
    style: "currency",
    currency: "BRL"
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await whenI18nReady();
  
  const token = getToken();
  if (!token) {
    alert(t("transacoes.login_necessario"));
    window.location.href = "/index.html";
    return;
  }

  const filtroTipo = document.getElementById("filtroTipo");
  if (filtroTipo) {
    const optionTodos = filtroTipo.querySelector('option[value=""]');
    const optionConteudo = filtroTipo.querySelector('option[value="conteudo"]');
    const optionAssinatura = filtroTipo.querySelector('option[value="assinatura"]');

    if (optionTodos) optionTodos.textContent = t("transacoes.filtro_todos");
    if (optionConteudo) optionConteudo.textContent = t("transacoes.filtro_conteudos");
    if (optionAssinatura) optionAssinatura.textContent = t("transacoes.filtro_assinaturas");

    filtroTipo.addEventListener("change", aplicarFiltros);
  }

  const tabs = document.querySelectorAll(".tab-btn");

  tabs.forEach(btn => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("ativa"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("ativa"));

      btn.classList.add("ativa");

      const tab = btn.dataset.tab;
      const content = document.getElementById("tab-" + tab);

      if (content) {
        content.classList.add("ativa");
      }

      if (tab === "subscricoes") {
        await carregarSubscricoes();
      }

      if (tab === "transacoes") {
        aplicarFiltros();
      }
    });
  });

  await carregarTransacoes();

  const abaAtiva = document.querySelector(".tab-btn.ativa");
  if (abaAtiva && abaAtiva.dataset.tab === "subscricoes") {
    await carregarSubscricoes();
  }
});

// ================================
// TRANSAÇÕES
// ================================
async function carregarTransacoes() {
  const lista = document.getElementById("listaTransacoes");
  const token = getToken();

  if (!lista) return;

  try {
    const res = await fetch("/api/cliente/transacoes", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      lista.innerHTML = `
        <div class="erro-transacoes">
          ${t("transacoes.erro_sem_transacoes")}
        </div>
      `;
      return;
    }

    const data = await res.json();
    todasTransacoes = Array.isArray(data) ? data : [];
    paginaAtual = 1;

    aplicarFiltros();
  } catch (err) {
    console.error("Erro ao carregar transações:", err);
    lista.innerHTML = `
      <div class="erro-transacoes">
        ${t("transacoes.erro_sem_transacoes")}
      </div>
    `;
  }
}

function aplicarFiltros() {
  const filtro = document.getElementById("filtroTipo");
  const tipoSelecionado = filtro ? filtro.value : "";

  paginaAtual = 1;

  transacoesFiltradas = !tipoSelecionado
    ? [...todasTransacoes]
    : todasTransacoes.filter(tr => tr.tipo === tipoSelecionado);

  renderTransacoes(transacoesFiltradas);
}

function renderTransacoes(transacoes) {
  const lista = document.getElementById("listaTransacoes");
  const paginacao = document.getElementById("paginacao");

  if (!lista || !paginacao) return;

  if (!Array.isArray(transacoes) || !transacoes.length) {
    lista.innerHTML = t("transacoes.nenhuma_transacao");
    paginacao.innerHTML = "";
    return;
  }

  const totalPaginas = Math.ceil(transacoes.length / itensPorPagina);

  if (paginaAtual > totalPaginas) {
    paginaAtual = totalPaginas;
  }

  const inicio = (paginaAtual - 1) * itensPorPagina;
  const fim = inicio + itensPorPagina;
  const paginaItems = transacoes.slice(inicio, fim);

  lista.innerHTML = "";

  paginaItems.forEach(tr => {
    const card = document.createElement("div");
    card.className = "transacao-card";

    const tipoTraduzido =
      tr.tipo === "assinatura"
        ? t("transacoes.tipo_assinatura")
        : t("transacoes.tipo_conteudo");

    card.innerHTML = `
      <div class="transacao-info">
        <div class="transacao-tipo">${tipoTraduzido}</div>

        <div class="transacao-data">
          ${formatarData(tr.created_at)}
        </div>

        <div class="transacao-valor">
          ${formatarValor(tr.valor)}
        </div>

        <button class="btn-reclamar" onclick="reclamar(${tr.id}, '${tr.tipo}')">
          ${t("transacoes.btn_reclamar")}
        </button>
      </div>
    `;

    lista.appendChild(card);
  });

  gerarPaginacao(transacoes);
}

function gerarPaginacao(transacoes) {
  const paginacao = document.getElementById("paginacao");
  if (!paginacao) return;

  paginacao.innerHTML = "";

  const totalPaginas = Math.ceil(transacoes.length / itensPorPagina);

  if (totalPaginas <= 1) return;

  for (let i = 1; i <= totalPaginas; i++) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = i;

    if (i === paginaAtual) {
      btn.classList.add("ativa");
    }

    btn.addEventListener("click", () => {
      paginaAtual = i;
      renderTransacoes(transacoesFiltradas);
    });

    paginacao.appendChild(btn);
  }
}

function reclamar(id, tipo) {
  const btn = document.getElementById("sp-btn");
  const box = document.getElementById("sp-box");
  if (btn && box && !box.classList.contains("aberto")) {
    btn.click();
  }
  box?.scrollIntoView({ behavior: "smooth", block: "end" });
}

window.reclamar = reclamar;

// ================================
// SUBSCRIÇÕES
// ================================
async function carregarSubscricoes() {
  const lista = document.getElementById("listaSubscricoes");
  const token = getToken();

  if (!lista) return;

  try {
    const res = await fetch("/api/cliente/subscricoes", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      lista.innerHTML = t("transacoes.erro_sem_subscricoes");
      return;
    }

    const data = await res.json();
    const subscricoes = Array.isArray(data) ? data : [];

    renderSubscricoes(subscricoes);
  } catch (err) {
    console.error("Erro ao carregar subscrições:", err);
    lista.innerHTML = t("transacoes.erro_sem_subscricoes");
  }
}

function renderSubscricoes(subscricoes) {
  const lista = document.getElementById("listaSubscricoes");
  if (!lista) return;

  lista.innerHTML = "";

  if (!Array.isArray(subscricoes) || !subscricoes.length) {
    lista.innerHTML = t("transacoes.nenhuma_subscricao");
    return;
  }

  subscricoes.forEach(v => {
    const ativa = Boolean(v.ativo) && new Date(v.expiration_at) > new Date();

    const statusBadge = ativa
      ? `<span class="badge-status badge-ativa">${t("transacoes.badge_ativa")}</span>`
      : `<span class="badge-status badge-expirada">${t("transacoes.badge_expirada")}</span>`;

    const card = document.createElement("div");
    card.className = "sub-vip-card";

    card.innerHTML = `
      <div class="sub-vip-info">
        ${statusBadge}
        <div class="transacao-tipo">${t("transacoes.tipo_subscricao_vip")}</div>
        <div><strong>${t("transacoes.label_criadora")}</strong> ${v.modelo || "—"}</div>
        <div><strong>${t("transacoes.label_data_assinatura")}</strong> ${formatarData(v.updated_at || v.created_at)}</div>
        <div><strong>${t("transacoes.label_termina")}</strong> ${formatarData(v.expiration_at)}</div>
        <div><strong>${t("transacoes.label_renovacao")}</strong> ${v.recorrente ? t("transacoes.sim") : t("transacoes.nao")}</div>

        ${
          ativa
            ? `<button class="btn-cancelar" onclick="cancelarSubscricao(${v.id})">${t("transacoes.btn_cancelar")}</button>`
            : `<button class="btn-renovar" onclick="renovarSubscricao(${v.modelo_id})">${t("transacoes.btn_renovar")}</button>`
        }
      </div>
    `;

    lista.appendChild(card);
  });
}

async function cancelarSubscricao(id) {
  const token = getToken();

  if (!confirm(t("transacoes.confirm_cancelar"))) return;

  try {
    const res = await fetch(`/api/cliente/subscricoes/${id}/cancelar`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok) {
      mostrarMensagem(data.error || t("transacoes.erro_cancelar"), "erro");
      return;
    }

    mostrarMensagem(data.message || t("transacoes.sucesso_cancelar"), "sucesso");
    await carregarSubscricoes();
  } catch (err) {
    console.error("Erro ao cancelar subscrição:", err);
    mostrarMensagem(t("transacoes.erro_inesperado"), "erro");
  }
}

window.cancelarSubscricao = cancelarSubscricao;

function renovarSubscricao(modeloId) {
  window.location.href = `/perfil.html?id=${modeloId}`;
}

window.renovarSubscricao = renovarSubscricao;

function mostrarMensagem(texto, tipo = "sucesso") {
  const tab = document.querySelector("#tab-subscricoes");
  if (!tab) return;

  let msg = document.getElementById("msgSub");

  if (!msg) {
    msg = document.createElement("div");
    msg.id = "msgSub";
    tab.prepend(msg);
  }

  msg.innerText = texto;
  msg.className = `msg-feedback ${tipo}`;

  setTimeout(() => {
    if (msg && msg.parentNode) {
      msg.remove();
    }
  }, 3000);
}