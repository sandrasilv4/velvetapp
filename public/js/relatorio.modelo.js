// ===============================
// 📊 RELATÓRIO DE GANHOS — MODELO
// ===============================

async function carregarResumoModelo() {
  try {
    const res = await fetch("/api/modelo/financeiro", {
      headers: {
        Authorization: "Bearer " + localStorage.getItem("token")
      }
    });

    if (!res.ok) {
      console.error("Erro ao carregar ganhos da modelo");
      return;
    }

    const data = await res.json();

   // HOJE
document.getElementById("hojeMidias").innerText =
  `R$ ${Number(data.hoje.midias || 0).toFixed(2)}`;

document.getElementById("hojeAssinaturas").innerText =
  `R$ ${Number(data.hoje.assinaturas || 0).toFixed(2)}`;

  // ASSINANTES
document.getElementById("totalAssinantes").innerText =
  data.assinantes?.total ?? 0;

document.getElementById("assinantesHoje").innerText =
  data.assinantes?.hoje ?? 0;

// MÊS
document.getElementById("mesMidias").innerText =
  `R$ ${Number(data.mes.midias || 0).toFixed(2)}`;

document.getElementById("mesAssinaturas").innerText =
  `R$ ${Number(data.mes.assinaturas || 0).toFixed(2)}`;

const totalMesAtual =
  Number(data.mes.midias || 0) +
  Number(data.mes.assinaturas || 0);

document.getElementById("totalMesAtual").innerText =
  `R$ ${totalMesAtual.toFixed(2)}`;

const totalMesAnterior =
  Number(data.mesAnterior?.midias || 0) +
  Number(data.mesAnterior?.assinaturas || 0);

document.getElementById("totalMesAnterior").innerText =
  `R$ ${totalMesAnterior.toFixed(2)}`;

// ACUMULADO
document.getElementById("acumuladoAnterior").innerText =
  `R$ ${Number(data.total.acumulado_ano_atual || 0).toFixed(2)}`;

  } catch (err) {
    console.error("Erro carregarResumoModelo:", err);
  }
}

async function carregarTransacoes(pagina = 1) {
  const lista = document.getElementById("listaTransacoes");
  const paginacao = document.getElementById("paginacaoTransacoes");

  if (!lista) {
    console.warn("listaTransacoes não existe nesta página");
    return;
  }

  lista.innerHTML = t("relatorio.carregando_transacoes");
  if (paginacao) paginacao.innerHTML = "";

  const token = localStorage.getItem("token");
if (!token) {
  lista.innerText = t("relatorio.nao_autenticada");
  return;
  }

  function obterMesAtualSP() {
    const partes = new Intl.DateTimeFormat("sv-SE", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit"
    }).formatToParts(new Date());

    const ano = partes.find(p => p.type === "year")?.value;
    const mes = partes.find(p => p.type === "month")?.value;

    return `${ano}-${mes}`;
  }

  function formatarDataHoraSP(dataIso) {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date(dataIso));
  }

  try {
    const mesAtual = obterMesAtualSP();

    const res = await fetch(`/api/transacoes?mes=${mesAtual}&page=${pagina}`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

if (!res.ok) {
  lista.innerText = t("relatorio.erro_transacoes");
  return;
}

    const data = await res.json();
    const dados = data.registros || [];

    lista.innerHTML = "";

    if (!dados.length) {
    lista.innerText = t("relatorio.sem_transacoes");
      return;
    }

    paginaAtualTransacoes = data.paginaAtual;

dados.forEach(tr => {
  lista.innerHTML += `
    <div class="transacao">
      <strong>#${tr.codigo}</strong> · ${tr.tipo}<br>
      ${formatarDataHoraSP(tr.created_at)}<br>
      ${t("relatorio.valor")}: ${emReais(tr.valor)}
    </div>
  `;
});

    if (paginacao && data.totalPaginas > 1) {
      renderizarPaginacaoTransacoes(data.totalPaginas);
    }

} catch (err) {
  console.error(err);
  lista.innerText = t("relatorio.erro_inesperado");
}
}

function renderizarPaginacaoTransacoes(totalPaginas) {
  const paginacao = document.getElementById("paginacaoTransacoes");
  if (!paginacao) return;

  paginacao.innerHTML = `
    <button 
      class="pag-btn"
      ${paginaAtualTransacoes === 1 ? "disabled" : ""}
      onclick="carregarTransacoes(${paginaAtualTransacoes - 1})">
      ${t("relatorio.anterior")}
    </button>

    <span class="pag-info">
      ${paginaAtualTransacoes} / ${totalPaginas}
    </span>

    <button 
      class="pag-btn"
      ${paginaAtualTransacoes === totalPaginas ? "disabled" : ""}
      onclick="carregarTransacoes(${paginaAtualTransacoes + 1})">
      ${t("relatorio.proxima")}
    </button>
  `;
}


function emReais(valor) {
  return Number(valor).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

async function carregarPagamentos() {
  const lista = document.getElementById("listaPagamentos");
  if (!lista) return;

  lista.innerHTML = t("relatorio.carregando_pagamentos");

  const token = localStorage.getItem("token");
if (!token) {
  lista.innerText = t("relatorio.nao_autenticada");
  return;
}

  try {
    const res = await fetch("/api/modelo/pagamentos", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const dados = await res.json();
    lista.innerHTML = "";

    if (!dados.length) {
      lista.innerText = t("relatorio.sem_pagamentos");
      return;
    }

    dados.forEach(p => {
      const inicio = new Date(p.mes);
      const fim = new Date(inicio);
      fim.setMonth(fim.getMonth() + 1);
      fim.setDate(fim.getDate() - 1);

      const statusTexto = p.status === "pago"
  ? t("relatorio.status_pago")
  : t("relatorio.status_pendente");

const pagoEm = p.pago_em
  ? new Date(p.pago_em).toLocaleDateString("pt-BR")
  : t("relatorio.nao_aplicavel");

lista.innerHTML += `
  <div class="transacao">
    <div class="linha">
      <strong>${t("relatorio.periodo")}:</strong>
      ${inicio.toLocaleDateString("pt-BR")}
      ${t("relatorio.ate")}
      ${fim.toLocaleDateString("pt-BR")}
    </div>

    <div class="linha">
      <strong>${t("relatorio.status")}:</strong> ${statusTexto}
    </div>

    <div class="linha">
      <strong>${t("relatorio.pago_em")}:</strong> ${pagoEm}
    </div>

    <div class="linha">
      <strong>${t("relatorio.midias")}:</strong> R$ ${Number(p.total_midias).toFixed(2)}
    </div>

    <div class="linha">
      <strong>${t("relatorio.assinaturas")}:</strong> R$ ${Number(p.total_assinaturas).toFixed(2)}
    </div>

    <div class="linha">
      <strong>${t("relatorio.total")}:</strong> R$ ${Number(p.total_geral).toFixed(2)}
    </div>
  </div>
`;
    });

  } catch (err) {
    console.error(err);
    lista.innerText = t("relatorio.erro_pagamentos");
  }
}

function alteracaoBloqueada() {
  const hoje = new Date();
  const dia = hoje.getDate();

  // bloqueia do dia 5 até o dia do pagamento (10)
  return dia >= 1 && dia <= 5;
}

function mostrarStatusDadosBancarios(status) {
  const box = document.getElementById("statusDadosBancarios");
  if (!box) return;

  box.style.display = "block";
  box.className = "status-box";

if (status === "aprovado") {
  box.classList.add("status-aprovado");
  box.innerText = t("relatorio.status_aprovado");
  return;
}

  box.style.display = "none";
}

let statusAtual = null;

async function carregarDadosBancarios() {
  console.log("Form:", document.getElementById("formDadosBancarios"));
  const token = localStorage.getItem("token");
  const res = await fetch("/api/modelo/dados-bancarios", {
    headers: { Authorization: "Bearer " + token }
  });

  if (!res.ok) return;

  const dados = await res.json();
  if (!dados) return;

  // 🔹 guarda status global
  statusAtual = dados.status;
  mostrarStatusDadosBancarios(statusAtual);

  // 🔹 inputs
  const tipoRecebimento = document.getElementById("tipoRecebimento");
  const titularNome = document.getElementById("titularNome");
  const titularDocumento = document.getElementById("titularDocumento");
  const confirmarTitular = document.getElementById("confirmarTitular");

  const pixCampos = document.getElementById("pixCampos");
  const pixTipo = document.getElementById("pixTipo");
  const pixChave = document.getElementById("pixChave");

  const transferenciaCampos = document.getElementById("transferenciaCampos");
  const banco = document.getElementById("banco");
  const agencia = document.getElementById("agencia");
  const conta = document.getElementById("conta");
  const contaTipo = document.getElementById("contaTipo");


const form = document.getElementById("formDadosBancarios");
const btnAlterar = document.getElementById("btnAlterarDados");


  // 🔹 preencher campos comuns
  tipoRecebimento.value = dados.tipo;
  titularNome.value = dados.titular_nome;
  titularDocumento.value = dados.titular_documento;
  confirmarTitular.checked = true;

  // 🔹 PIX
  if (dados.tipo === "pix") {
    pixCampos.style.display = "block";
    transferenciaCampos.style.display = "none";
    pixTipo.value = dados.pix_tipo;
    pixChave.value = dados.pix_chave;
  }

  // 🔹 TRANSFERÊNCIA
  if (dados.tipo === "transferencia") {
    transferenciaCampos.style.display = "block";
    pixCampos.style.display = "none";
    banco.value = dados.banco;
    agencia.value = dados.agencia;
    conta.value = dados.conta;
    contaTipo.value = dados.conta_tipo;
  }

  // 🔒 CONTROLE DE ESTADO
  if (alteracaoBloqueada()) {
    bloquearFormulario(form);

    if (btnAlterar) {
      btnAlterar.style.display = "none";
    }
    
    mostrarAviso(t("relatorio.bloqueio_periodo"));
    return;
  }

  if (statusAtual === "aprovado") {
    bloquearFormulario(form);

    if (btnAlterar) {
      btnAlterar.style.display = "inline-block";
    }
    return;
  }

  if (statusAtual === "pendente") {
    bloquearFormulario(form);

    if (btnAlterar) {
      btnAlterar.style.display = "none";
    }
    return;
  }

  if (statusAtual === "alteracao_pendente") {
    bloquearFormulario(form);

    if (btnAlterar) {
      btnAlterar.style.display = "none";
    }

    mostrarAviso(t("relatorio.alteracao_pendente"));
    return;
  }

  liberarFormulario(form);
}

function mostrarAviso(texto) {
  let aviso = document.getElementById("avisoDadosBancarios");

  if (!aviso) {
    aviso = document.createElement("div");
    aviso.id = "avisoDadosBancarios";
    aviso.className = "card";
    aviso.style.background = "#fff7e6";
    aviso.style.marginBottom = "16px";

    document
      .getElementById("tab-dados-bancarios")
      .prepend(aviso);
  }

  aviso.innerText = texto;
}

function liberarFormulario(form) {
  if (!form) return;

  form.querySelectorAll("input, select, textarea").forEach(el => {
    el.disabled = false;
  });
}

function bloquearFormulario(form) {
  if (!form) return;

  form.querySelectorAll("input, select, textarea").forEach(el => {
    el.disabled = true;
  });
}


let paginaAtualTransacoes = 1;

document.addEventListener("DOMContentLoaded", async () => {
  await inicializarIdioma()

  carregarResumoModelo();

  // ===============================
  // TABS
  // ===============================
  document.querySelectorAll(".tabs .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(c => c.classList.remove("active"));

      btn.classList.add("active");
      const tabContent = document.getElementById(`tab-${btn.dataset.tab}`);
      if (tabContent) {
        tabContent.classList.add("active");
      }

      if (btn.dataset.tab === "transacoes") carregarTransacoes(1);
      if (btn.dataset.tab === "pagamentos") carregarPagamentos();
      if (btn.dataset.tab === "dados-bancarios") carregarDadosBancarios();
    });
  });

  // ===============================
  // FORM DADOS BANCÁRIOS
  // ===============================

  const form = document.getElementById("formDadosBancarios");

if (!form) {
  console.warn("Form de dados bancários não encontrado");
  return;
}

  const tipoRecebimento = document.getElementById("tipoRecebimento");
  const pixCampos = document.getElementById("pixCampos");
  const pixTipo = document.getElementById("pixTipo");
  const pixChave = document.getElementById("pixChave");

  const transferenciaCampos = document.getElementById("transferenciaCampos");
  const banco = document.getElementById("banco");
  const agencia = document.getElementById("agencia");
  const conta = document.getElementById("conta");
  const contaTipo = document.getElementById("contaTipo");

  const titularNome = document.getElementById("titularNome");
  const titularDocumento = document.getElementById("titularDocumento");
  const confirmarTitular = document.getElementById("confirmarTitular");
  const justificativa = document.getElementById("justificativa");

  const btnAlterar = document.getElementById("btnAlterarDados");

  // 🔁 troca de tipo
  tipoRecebimento.addEventListener("change", () => {
    pixCampos.style.display = tipoRecebimento.value === "pix" ? "block" : "none";
    transferenciaCampos.style.display =
      tipoRecebimento.value === "transferencia" ? "block" : "none";
  });

  // ✏️ botão alterar
  btnAlterar?.addEventListener("click", () => {
  if (statusAtual !== "aprovado") return;

  liberarFormulario(form);
  const justificativaBox = document.getElementById("justificativaBox");
  const justificativa = document.getElementById("justificativa");

  justificativaBox.style.display = "block";
  justificativa.disabled = false;
  justificativa.focus();
  document.getElementById("justificativaBox").style.display = "block";
 });

form.addEventListener("submit", async e => {
  e.preventDefault();

  try {
    console.log("SUBMIT disparado");

    const endpoint =
      statusAtual === "aprovado"
        ? "/api/modelo/dados-bancarios/alterar"
        : "/api/modelo/dados-bancarios";

    const payload = {
      tipo: tipoRecebimento.value,
      pix_tipo: pixTipo.value,
      pix_chave: pixChave.value,
      banco: banco.value,
      agencia: agencia.value,
      conta: conta.value,
      conta_tipo: contaTipo.value,
      titular_nome: titularNome.value,
      titular_documento: titularDocumento.value,
      confirmado_titular: confirmarTitular.checked,
      justificativa: justificativa?.value?.trim() || null
    };

    console.log("statusAtual:", statusAtual);
    console.log("endpoint:", endpoint);
    console.log("payload:", payload);

if (statusAtual === "aprovado" && !payload.justificativa) {
  alert(t("relatorio.justificativa_obrigatoria"));
  return;
}

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + localStorage.getItem("token")
      },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    let r = {};

    try {
      r = text ? JSON.parse(text) : {};
    } catch {
      r = { error: text || `${t("relatorio.resposta_invalida_servidor")} (${res.status})` };
    }

    console.log("status resposta:", res.status);
    console.log("resposta backend:", r);

    if (!res.ok) {
      alert(t("relatorio.erro_envio"));
      return;
    }

    alert(t("relatorio.sucesso_envio"));

    statusAtual =
      statusAtual === "aprovado"
        ? "alteracao_pendente"
        : "pendente";

    bloquearFormulario(form);
    mostrarStatusDadosBancarios(statusAtual);

    const justificativaBox = document.getElementById("justificativaBox");
    if (justificativaBox) justificativaBox.style.display = "none";

    await carregarDadosBancarios();

} catch (err) {
  console.error("Erro no submit dos dados bancários:", err);
  alert(t("relatorio.erro_envio_console"));
}
});
});