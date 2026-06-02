const token = localStorage.getItem("token");

function getUsuarioLogado() {
  if (!token) return null;

  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload; 
  } catch {
    return null;
  }
}

async function buscarDadosPessoais() {
  if (!token) return null;

  const res = await fetch("/api/usuario/perfil", {
    headers: {
      Authorization: "Bearer " + token
    }
  });

  if (!res.ok) return null;
  return await res.json();
}

function paginaTem(id) {
  return document.getElementById(id) !== null;
}

function preencherFormulario(formId, dados) {
  const form = document.getElementById(formId);
  if (!form || !dados) return;

  Object.keys(dados).forEach((campo) => {
    if (form[campo] !== undefined) {
      form[campo].value = dados[campo] ?? "";
    }
  });
}

function bloquearFormulario(form) {
  if (!form) return;

  form.querySelectorAll("input, select, textarea, button").forEach(el => {
    el.disabled = true;
  });

  form.style.pointerEvents = "none";
  form.style.opacity = "0.6";
}


function mostrarStatusVerificacao(status) {
  const box = document.getElementById("statusVerificacao");
  if (!box) return;

  box.style.display = "block";
  box.className = "status-box";

if (status === "aprovado") {
  box.classList.add("status-aprovado");
  box.innerText = t("areaUsuario.status_approved");
}

if (status === "em_analise") {
  box.innerText = t("areaUsuario.status_in_review");
}

if (status === "rejeitado") {
  box.innerText = t("areaUsuario.status_rejected");
}
}

async function irParaInbox() {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/index.html";
    return;
  }

  const res = await fetch("/api/me", {
    headers: {
      Authorization: "Bearer " + token
    }
  });

  if (!res.ok) return;

  const user = await res.json();

  if (user.role === "modelo") {
    window.location.href = "/inbox.html";
  } else {
    window.location.href = "/inboxc.html";
  }
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch("/api/me", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) return;

    const user = await res.json();

    // role REAL e confiável
    document.body.classList.add(`role-${user.role}`);

     document.addEventListener("click", (e) => {
    const btn = e.target.closest("#btnCriarNovaConta");
    if (!btn) return;

    e.preventDefault();

    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("role");
    localStorage.removeItem("modeloId");
    localStorage.removeItem("clienteId");
    sessionStorage.clear();

    window.location.href = "/index.html";
  });

    // CLIENTE NÃO PODE VALIDAR PERFIL
    if (user.role === "cliente") {
      bloquearPaginaValidacaoCliente();
    }

    if (user.role === "modelo") {
      const resDados = await fetch("/api/usuario/dados", {
        headers: { Authorization: "Bearer " + token }
      });

      if (resDados.ok) {
        const dados = await resDados.json();

        if (dados.status === "aprovado") {
          document.getElementById("areaBanner")?.classList.add("hidden");
        }
      }
    }

    // PERFIL VISUAL
    carregarPerfilBase(user);
    carregarDadosUsuario();
    carregarDadosPessoais();

    // SOMENTE MODELO
    if (user.role === "modelo") {
      carregarResumoModelo();
      carregarAreaModelo(user.id);

      if (document.getElementById("listaAssinantes")) {
        carregarAssinantes();
      }
    }
  } catch (err) {
    console.error("Erro ao carregar página conta:", err);
  }
});

function irParaFeed() {
  window.location.href = "/feed.html";
}

function bloquearPaginaValidacaoCliente() {
  const formDadosPessoais = document.getElementById("formDadosPessoais");
  const formDocumentos = document.getElementById("formDocumentos");

  if (formDadosPessoais) {
    formDadosPessoais.querySelectorAll("input, select, textarea, button").forEach(el => {
      el.disabled = true;
    });
    formDadosPessoais.style.pointerEvents = "none";
    formDadosPessoais.style.opacity = "0.6";
  }

  if (formDocumentos) {
    formDocumentos.querySelectorAll("input, select, textarea, button").forEach(el => {
      el.disabled = true;
    });
    formDocumentos.style.pointerEvents = "none";
    formDocumentos.style.opacity = "0.6";
  }

  abrirModalContaCliente();
}

function abrirModalContaCliente() {
  document.getElementById("modalContaCliente")?.classList.remove("hidden");
}

function fecharModalContaCliente() {
  document.getElementById("modalContaCliente")?.classList.add("hidden");
}


let assinantesCache = [];
let paginaAtual = 1;
const LIMITE_POR_PAGINA = 10;

async function carregarAssinantes() {
  const token = localStorage.getItem("token");
  if (!token) return;

  const tbody = document.getElementById("listaAssinantes");
  if (!tbody) return;

  try {
    const res = await fetch("/api/modelo/assinantes", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) throw new Error("Erro ao buscar assinantes");

    assinantesCache = await res.json();
    paginaAtual = 1;

    renderizarPagina();
    configurarBotoes();

  } catch (err) {
    console.error("Erro carregar assinantes:", err);
    tbody.innerHTML = `
      <tr>
        <td colspan="7">${t("areaUsuario.subscribers_load_error")}</td>
      </tr>
    `;
  }
}

async function carregarPerfilBase(usuario) {
  const token = localStorage.getItem("token");
  if (!token || !usuario?.role) return;

  const endpoint =
    usuario.role === "modelo"
      ? "/api/modelo/me"
      : "/api/cliente/me";

  const res = await fetch(endpoint, {
    headers: { Authorization: "Bearer " + token }
  });

  if (!res.ok) {
    console.error("Erro ao carregar perfil:", res.status);
    return;
  }

  const perfil = await res.json();

  // 📸 AVATAR
const avatar = document.getElementById("profileAvatar");
if (avatar) {
  avatar.src = perfil.avatar
    ? perfil.avatar + "?t=" + Date.now()
    : "/assets/avatar.png";
}

  // 🖼️ CAPA
const capa = document.getElementById("profileCapa");
if (capa) {
  capa.src = perfil.capa
    ? perfil.capa + "?t=" + Date.now()
    : "/assets/capa.png";
}

  // 👤 NOME
  const profileName = document.getElementById("profileName");
  if (profileName) {
    profileName.textContent =
      perfil.nome_exibicao || perfil.username || "";
  }
}


function renderizarPagina() {
  const tbody = document.getElementById("listaAssinantes");
  const inicio = (paginaAtual - 1) * LIMITE_POR_PAGINA;
  const fim = inicio + LIMITE_POR_PAGINA;

  const pagina = assinantesCache.slice(inicio, fim);

  tbody.innerHTML = "";

  if (pagina.length === 0) {
    tbody.innerHTML = `
      <tr>
       <td colspan="5">${t("areaUsuario.no_subscribers_found")}</td>
      </tr>
    `;
    return;
  }

  pagina.forEach(a => {
    const total =
      Number(a.total_assinaturas) + Number(a.total_midias);

    tbody.innerHTML += `
      <tr>
        <td class="assinante-nome">${a.nome_cliente}</td>
        <td>${formatarData(a.expiration_at)}</td>
        <td>R$ ${Number(a.total_assinaturas).toFixed(2)}</td>
        <td>R$ ${Number(a.total_midias).toFixed(2)}</td>
        <td class="total-geral">R$ ${total.toFixed(2)}</td>
      </tr>
    `;
  });

  atualizarPaginacao();
}

function configurarBotoes() {
  document.getElementById("btnAnterior")?.addEventListener("click", () => {
    if (paginaAtual > 1) {
      paginaAtual--;
      renderizarPagina();
    }
  });

  document.getElementById("btnProximo")?.addEventListener("click", () => {
    const totalPaginas = Math.ceil(
      assinantesCache.length / LIMITE_POR_PAGINA
    );

    if (paginaAtual < totalPaginas) {
      paginaAtual++;
      renderizarPagina();
    }
  });
}

function atualizarPaginacao() {
  const totalPaginas = Math.ceil(
    assinantesCache.length / LIMITE_POR_PAGINA
  );

  document.getElementById("paginaAtual").textContent =
    `${paginaAtual} / ${totalPaginas}`;

  document.getElementById("btnAnterior").disabled =
    paginaAtual === 1;

  document.getElementById("btnProximo").disabled =
    paginaAtual === totalPaginas;
}

function getLocale() {
  const idioma = getCurrentLanguage();
  if (idioma === "en") return "en-US";
  if (idioma === "es") return "es-ES";
  return "pt-BR";
}

function formatarData(data) {
  if (!data) return "-";
  return new Date(data).toLocaleDateString(getLocale(), {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function gerarLinks(modelo_id) {
  const base = `https://bio.mypagess.workers.dev/?id=${modelo_id}`;

  document.getElementById("linkInstagram").value =
    `${base}&src=instagram`;

  document.getElementById("linkTiktok").value =
    `${base}&src=tiktok`;

  document.getElementById("linkDireto").value =
    base;
}

function copiarLink(id) {
  const input = document.getElementById(id);
  navigator.clipboard.writeText(input.value);
 alert(t("areaUsuario.link_copied"));
}


async function carregarResumoModelo() {
  const elHoje = document.getElementById("areaUsuarioGanhosHoje");
  const elMes  = document.getElementById("areaUsuarioGanhosMes");

  if (!elHoje && !elMes) return;

  try {
    const res = await fetch("/api/modelo/financeiro", {
      headers: {
        Authorization: "Bearer " + localStorage.getItem("token")
      }
    });

    if (!res.ok) return;

    const data = await res.json();

    const ganhosHoje =
      Number(data.hoje.midias || 0) +
      Number(data.hoje.assinaturas || 0);

    const ganhosMes =
      Number(data.mes.midias || 0) +
      Number(data.mes.assinaturas || 0);

    if (elHoje) {
      elHoje.innerText = `R$ ${ganhosHoje.toFixed(2).replace(".", ",")}`;
    }

    if (elMes) {
      elMes.innerText = `R$ ${ganhosMes.toFixed(2).replace(".", ",")}`;
    }

  } catch (err) {
    console.error("Erro carregarResumoModelo:", err);
  }
}

function normalizarInstagram(username) {
  if (!username) return null;

  return username
    .trim()
    .replace(/^@/, "") // remove @ do início
    .replace(/\s+/g, ""); // remove espaços
}

async function carregarVipCountModelo() {
  const token = localStorage.getItem("token");
  if (!token) {
    console.warn("VIP count: token ausente");
    return;
  }

  try {
    const res = await fetch("/api/modelo/me/vip-count", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.error("Erro VIP count:", res.status);
      return;
    }

    const { total } = await res.json();

    const el = document.getElementById("vip-total");
    if (el) el.textContent = total;
  } catch (err) {
    console.error("Erro ao carregar VIP count:", err);
  }
}

async function carregarAreaModelo() {
  const res = await fetch("/api/modelo/me", {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token")
    }
  });

  if (!res.ok) return;

  const modelo = await res.json();
  console.log("Modelo logado:", modelo);


  // ===============================
  // 📸 AVATAR / CAPA
  // ===============================
  const avatar = document.getElementById("profileAvatar");
if (avatar) {
  avatar.src = modelo.avatar
    ? modelo.avatar + "?t=" + Date.now()
    : "/assets/avatar.png";
}

const capa = document.getElementById("profileCapa");
if (capa) {
  capa.src = modelo.capa
    ? modelo.capa + "?t=" + Date.now()
    : "/assets/capa.png";
}

  // ===============================
  // 👤 NOME VISUAL (só se existir)
  // ===============================
  const profileName = document.getElementById("profileName");
  if (profileName) {
    profileName.textContent = modelo.nome_exibicao || "";
  }

  // ===============================
  // 👑 VIP COUNT
  // ===============================
carregarVipCountModelo();

  // 🔗 LINKS DO PERFIL
const linkInstagram = document.getElementById("linkInstagram");

if (linkInstagram) {
  if (!modelo?.modelo_id) {
    console.error("❌ modelo.id não veio do /api/modelo/me:", modelo);
    return;
  }

  gerarLinks(modelo.modelo_id);
}
}

async function carregarDadosUsuario() {
  const token = localStorage.getItem("token");
  if (!token) return;

  const usuario = getUsuarioLogado();
  if (!usuario) return;

  let endpoint;

  if (usuario.role === "modelo") {
    endpoint = "/api/modelo/me";
  } else {
    endpoint = "/api/cliente/me";
  }

  const res = await fetch(endpoint, {
    headers: { Authorization: "Bearer " + token }
  });

  if (!res.ok) return;

  const dados = await res.json();

  const form = document.getElementById("formDadosUsuario");
  if (!form) return;

  // 🔥 Campo principal (mesmo input para ambos)
  if (form.nome_exibicao) {
    form.nome_exibicao.value =
      usuario.role === "modelo"
        ? dados.nome_exibicao || ""
        : dados.username || "";
  }

  // 🔥 Campos extras para ambos
  if (form.instagram) form.instagram.value = dados.instagram || "";
  if (form.tiktok) form.tiktok.value = dados.tiktok || "";
  if (form.local) form.local.value = dados.local || "";
  if (form.bio) form.bio.value = dados.bio || "";
}

async function carregarDadosPessoais() {
  if (!paginaTem("formDadosPessoais")) return;

  const token = localStorage.getItem("token");
  if (!token) return;

   const usuario = getUsuarioLogado();

  const res = await fetch("/api/usuario/dados", {
    headers: {
      Authorization: "Bearer " + token
    }
  });

  if (!res.ok) return;

  const dados = await res.json();
 
if (
  usuario?.role === "modelo" &&
  dados.status === "aprovado"
) {
  document.getElementById("areaBanner")?.classList.add("hidden");
}

  const form = document.getElementById("formDadosPessoais");
  if (!form) return;

  // preencher campos
  form.nome_completo.value = dados.nome_completo || "";
  form.data_nascimento.value = dados.data_nascimento
    ? dados.data_nascimento.split("T")[0]
    : "";
  form.telefone.value = dados.telefone || "";
  form.endereco.value = dados.endereco || "";
  form.estado.value   = dados.estado || "";
  form.cidade.value   = dados.cidade || "";
  form.pais.value     = dados.pais || "";

   if (dados.status === "aprovado") {
    bloquearFormulario(form);
    mostrarStatusVerificacao("aprovado");
    form.querySelector(".btn-salvar")?.remove();
  }
}


const btnCapa = document.getElementById("btnCapa");
const btnAvatar = document.getElementById("btnAvatar");
const inputCapa = document.getElementById("inputCapa");
const inputAvatar = document.getElementById("inputAvatar");
const capaImg = document.getElementById("profileCapa");
const avatarImg = document.getElementById("profileAvatar");

btnCapa?.addEventListener("click", () => inputCapa.click());
btnAvatar?.addEventListener("click", () => inputAvatar.click());

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

inputAvatar?.addEventListener("change", async () => {
  const file = inputAvatar.files[0];
  if (!file) return;

  const fd = new FormData();
  fd.append("avatar", file);

  const res = await fetch("/uploadAvatar", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: fd
  });

  const data = await res.json();
 if (data.avatar) {
  avatarImg.src = data.avatar + "?t=" + Date.now();
}
});

const formPessoais = document.getElementById("formDadosPessoais");

formPessoais?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const dados = {
    nome_completo: formPessoais.nome_completo.value.trim(),
    data_nascimento: formPessoais.data_nascimento.value,
    telefone: formPessoais.telefone.value.trim(),
    endereco: formPessoais.endereco.value.trim(),
    estado: formPessoais.estado.value.trim(),
    cidade: formPessoais.cidade.value.trim(),
    pais: formPessoais.pais.value.trim()
  };

  // Elementos de feedback
  const banner     = document.getElementById("dadosPessoaisSalvosBanner");
  const bannerData = document.getElementById("dadosPessoaisSalvosData");
  const btnSalvar  = formPessoais.querySelector(".btn-salvar");

  function mostrarErroPessoais(msg) {
    let erroEl = document.getElementById("erroDadosPessoais");
    if (!erroEl) {
      erroEl = document.createElement("p");
      erroEl.id = "erroDadosPessoais";
      erroEl.style.cssText = "color:#c0392b;font-size:14px;margin:10px 0 0;text-align:center;";
      formPessoais.appendChild(erroEl);
    }
    erroEl.textContent = msg;
    erroEl.style.display = "block";
  }

  function esconderErroPessoais() {
    const erroEl = document.getElementById("erroDadosPessoais");
    if (erroEl) erroEl.style.display = "none";
  }

  if (btnSalvar) { btnSalvar.disabled = true; btnSalvar.textContent = "A salvar..."; }

  try {
    const res = await fetch("/api/usuario/dados", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + localStorage.getItem("token")
      },
      body: JSON.stringify(dados)
    });

    if (res.status === 403) {
      bloquearFormulario(formPessoais);
      mostrarStatusVerificacao("aprovado");
      return;
    }

    if (!res.ok) {
      const erro = await res.text().catch(() => "");
      console.error("Erro ao salvar dados pessoais:", erro);
      mostrarErroPessoais(t("areaUsuario.personal_data_save_error") || "❌ Erro ao salvar. Tenta novamente.");
      if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = "Salvar e continuar"; }
      return;
    }

    // ✅ Sucesso — mostrar banner verde igual ao dos termos
    esconderErroPessoais();
    if (banner) {
      const agora = new Date().toLocaleString("pt-BR", {
        day: "2-digit", month: "long", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
      if (bannerData) bannerData.textContent = "Salvo em " + agora;
      banner.classList.remove("hidden");
      banner.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = "Salvar e continuar"; }

    // Notificar o módulo de contrato que os dados pessoais foram guardados
    document.dispatchEvent(new CustomEvent("dadosPessoaisGuardados"));

    // Scroll suave para o passo seguinte (contrato) após breve pausa
    setTimeout(() => {
      document.getElementById("secaoContrato")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 800);

  } catch (err) {
    console.error("Erro na requisição:", err);
    mostrarErroPessoais(t("areaUsuario.personal_data_connection_error") || "❌ Sem ligação. Verifica a tua internet.");
    if (btnSalvar) { btnSalvar.disabled = false; btnSalvar.textContent = "Salvar e continuar"; }
  }
});

const formModelo = document.getElementById("formDadosUsuario");

formModelo?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const usuario = getUsuarioLogado();
  if (!usuario) return;

  const token = localStorage.getItem("token");
  const formData = new FormData(formModelo);

  const nomeDigitado = formData.get("nome_exibicao")?.trim() || "";

  if (!nomeDigitado) {
   alert(t("areaUsuario.name_required"));
    return;
  }

  let endpoint;
  let dados;

  if (usuario.role === "modelo") {

    endpoint = "/api/usuario/perfil";

    dados = {
      nome_exibicao: nomeDigitado,
      instagram: normalizarInstagram(formData.get("instagram") || ""),
      tiktok: formData.get("tiktok")?.trim() || "",
      local: formData.get("local")?.trim() || "",
      bio: formData.get("bio")?.trim() || ""
    };

  } else {

    endpoint = "/api/cliente/dados";

    dados = {
      username: nomeDigitado,
      instagram: normalizarInstagram(formData.get("instagram") || ""),
      tiktok: formData.get("tiktok")?.trim() || "",
      local: formData.get("local")?.trim() || "",
      bio: formData.get("bio")?.trim() || ""
    };
  }

  const res = await fetch(endpoint, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify(dados)
  });

  if (!res.ok) {
    alert(t("areaUsuario.data_save_error"));
    return;
  }

  alert(t("areaUsuario.data_saved"));

  await carregarPerfilBase(usuario);
});