const token = localStorage.getItem("token");
const params = new URLSearchParams(window.location.search);
const cliente_id = Number(params.get("cliente_id"));

function formatarMoeda(valor) {
  return Number(valor || 0).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL"
  });
}

function formatarData(data) {
  if (!data) return "-";
  return new Date(data).toLocaleString("pt-BR");
}

function renderizarEstadoTabela(mensagem) {
  const tbody = document.getElementById("listaTransacoes");
  if (!tbody) return;

  tbody.innerHTML = `
    <tr>
      <td colspan="6" class="estado-tabela">${mensagem}</td>
    </tr>
  `;
}

function renderizarTransacoes(transacoes = []) {
  const tbody = document.getElementById("listaTransacoes");
  if (!tbody) return;

  if (!transacoes.length) {
    renderizarEstadoTabela("Nenhuma transação encontrada");
    return;
  }

  tbody.innerHTML = transacoes.map(t => {
    const tipo = String(t.tipo || "").toLowerCase();

    const tipoClasse =
      tipo === "assinatura" ? "tipo-assinatura" : "tipo-conteudo";

    const status = String(t.status || "").toLowerCase();

    const statusClasse =
      status === "paid" || status === "pago" ? "status-pago" :
      status === "pending" || status === "pendente" ? "status-pendente" :
      "status-cancelado";

    const tipoLabel =
      tipo === "midia" ? "Conteúdo" :
      tipo === "assinatura" ? "Assinatura" :
      (t.tipo || "-");

    return `
      <tr>
        <td>#${t.id ?? "-"}</td>
        <td>
          <span class="tipo-badge ${tipoClasse}">
            ${tipoLabel}
          </span>
        </td>
        <td>${formatarData(t.created_at)}</td>
        <td>${formatarMoeda(t.valor_modelo)}</td>
        <td class="${statusClasse}">${t.status || "-"}</td>
        <td>-</td>
      </tr>
    `;
  }).join("");
}

function preencherResumo(resumo = {}) {
  const totalCompras = document.getElementById("totalCompras");
  const totalPago = document.getElementById("totalPago");
  const totalConteudos = document.getElementById("totalConteudos");
  const totalAssinaturas = document.getElementById("totalAssinaturas");

  if (totalCompras) {
    totalCompras.textContent = Number(resumo.total_compras || 0);
  }

  if (totalPago) {
    totalPago.textContent = formatarMoeda(resumo.total_pago || 0);
  }

  if (totalConteudos) {
    totalConteudos.textContent = Number(resumo.conteudos_pagos || 0);
  }

  if (totalAssinaturas) {
    totalAssinaturas.textContent = Number(resumo.assinaturas || 0);
  }
}

function preencherCliente(cliente, total) {
  const nome = document.getElementById("clienteNome");
  const avatar = document.getElementById("clienteAvatar");
  const resumo = document.getElementById("clienteResumo");

  if (nome) nome.textContent = cliente?.nome || "Cliente";
  if (avatar) avatar.src = cliente?.avatar_url || "/assets/avatar.png";
  if (resumo) resumo.textContent = `${total} transação(ões) encontrada(s)`;
}

async function carregarTransacoesCliente() {
  if (!token) {
    renderizarEstadoTabela("Token não encontrado.");
    return;
  }

  if (!cliente_id) {
    renderizarEstadoTabela("cliente_id inválido.");
    return;
  }

  try {
    const res = await fetch(`/api/modelo/clientes/${cliente_id}/transacoes`, {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      renderizarEstadoTabela(data.error || "Erro ao carregar transações.");
      return;
    }

    preencherCliente(data.cliente, data.totalRegistros || 0);
    preencherResumo(data.resumo || {});
    renderizarTransacoes(data.registros || []);

  } catch (err) {
    console.error("Erro carregarTransacoesCliente:", err);
    renderizarEstadoTabela("Erro ao carregar transações.");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  carregarTransacoesCliente();
});