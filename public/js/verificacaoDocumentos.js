document.addEventListener("DOMContentLoaded", async () => {
  const statusContainer = document.getElementById("statusContainer");
  const form = document.getElementById("formDocumentos");
  const token = localStorage.getItem("token");

  if (!token) {
    console.warn("Usuário não autenticado");
    return;
  }

  // ===============================
  // BUSCAR STATUS NO BACKEND
  // ===============================
  async function buscarStatusVerificacao() {
    const res = await fetch("/api/verificacao/status", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      throw new Error("Erro ao buscar status da verificação");
    }

    return await res.json();
  }

  // ===============================
  // RENDERIZA STATUS
  // ===============================
function renderStatus(verificacao) {
  if (!statusContainer) return;

  statusContainer.innerHTML = "";
  statusContainer.className = "";

  // Banner de rejeição separado e destacado
  const bannerRejeicao   = document.getElementById("bannerRejeicao");
  const bannerMotivo     = document.getElementById("bannerRejeicaoMotivo");
  const bannerData       = document.getElementById("bannerRejeicaoData");

  // Esconder banner por defeito
  if (bannerRejeicao) bannerRejeicao.classList.add("hidden");

  let html = "";

  switch (verificacao.status) {
    case "em_analise":
      statusContainer.classList.add("status-verificacao", "status-em-analise");
      html = `
        <strong>${t("verificacao.status_label")}</strong>
        <span class="status-texto">${t("verificacao.status_em_analise")}</span>
        <p class="status-descricao">${t("verificacao.desc_em_analise")}</p>
      `;
      break;

    case "aprovado":
      statusContainer.classList.add("status-verificacao", "status-aprovado");
      html = `
        <strong>${t("verificacao.status_label")}</strong>
        <span class="status-texto">${t("verificacao.status_aprovado")}</span>
        <p class="status-descricao">${t("verificacao.desc_aprovado")}</p>
      `;
      break;

    // ── BUG 1 CORRIGIDO: DB usa "rejeitado", não "recusado" ──────────
    case "rejeitado":
      // Esconder o statusContainer genérico e usar o banner destacado
      statusContainer.style.display = "none";

      if (bannerRejeicao) {
        // BUG 2 CORRIGIDO: campo é motivo_rejeicao, não motivo
        const motivo = verificacao.motivo_rejeicao || verificacao.motivo || "";
        if (bannerMotivo) bannerMotivo.textContent = motivo || "Não especificado";
        if (bannerData && verificacao.verificado_em) {
          const d = new Date(verificacao.verificado_em);
          bannerData.textContent = "em " + d.toLocaleDateString("pt-BR");
        }
        bannerRejeicao.classList.remove("hidden");
        // Scroll suave para o banner
        setTimeout(() => bannerRejeicao.scrollIntoView({ behavior: "smooth", block: "nearest" }), 300);
      }
      return;

    case "bloqueado":
      statusContainer.classList.add("status-verificacao", "status-bloqueado");
      html = `
        <strong>${t("verificacao.status_label")}</strong>
        <span class="status-texto">${t("verificacao.status_bloqueado")}</span>
        <p class="status-descricao">${t("verificacao.desc_bloqueado")}</p>
      `;
      break;

    default:
      statusContainer.style.display = "none";
      return;
  }

  statusContainer.innerHTML = html;
  statusContainer.style.display = "block";
}

  function controlarFormulario(status) {
  if (!form) return;

  // BUG 1 CORRIGIDO: usar "rejeitado" (valor real do DB), não "recusado"
  if (!status || status === "pendente" || status === "rejeitado") {
    form.style.display = "block";
  } else {
    form.style.display = "none";
  }
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const btnSubmit = form.querySelector('button[type="submit"]');

  try {
    const token = localStorage.getItem("token");

    const confirmacaoIdentidade = document.getElementById("confirmacao_identidade")?.checked;
    const aceitePrivacidade = document.getElementById("aceite_privacidade")?.checked;
    const aceiteTermosCriador = document.getElementById("aceite_termos_criador")?.checked;

    if (!confirmacaoIdentidade) {
  alert(t("verificacao.alert_confirmar_identidade"));
  return;
}

if (!aceitePrivacidade) {
  alert(t("verificacao.alert_aceite_privacidade"));
  return;
}

if (!aceiteTermosCriador) {
  alert(t("verificacao.alert_aceite_termos"));
  return;
}

    if (btnSubmit) btnSubmit.disabled = true;

    const formData = new FormData(form);

    formData.set("confirmacao_identidade", "true");
    formData.set("aceite_privacidade", "true");
    formData.set("aceite_termos_criador", "true");
    formData.set("versao_privacidade", "2026-04-06");
    formData.set("versao_termos_criador", "2026-04-06");

    const res = await fetch("/api/verificacao", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token
      },
      body: formData
    });

    const payload = await res.json().catch(() => null);

    if (!res.ok) {
      // Contrato ainda não assinado — redirecionar para a secção de contrato
      if (payload?.erro === "CONTRACT_NOT_SIGNED") {
        alert("Tens de assinar o contrato de parceria antes de enviar os documentos. Conclui o Passo 3.");
        const secaoContrato = document.getElementById("secaoContrato");
        if (secaoContrato) secaoContrato.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      throw new Error(payload?.message || payload?.erro || t("verificacao.alert_falha_envio"));
    }

    renderStatus({ status: "em_analise" });
    controlarFormulario("em_analise");
  } catch (err) {
    console.error(err);
    alert(err.message || t("verificacao.alert_falha_envio"));
  } finally {
    if (btnSubmit) btnSubmit.disabled = false;
  }
});

try {
  const verificacao = await buscarStatusVerificacao();
  renderStatus(verificacao);
  controlarFormulario(verificacao?.status || "pendente");
} catch (err) {
  console.error(err);
  controlarFormulario("pendente");
}


});

function abrirConfirmacaoExclusao() {
  const modal = document.getElementById("modalExcluirConta");
  if (modal) {
    modal.classList.remove("hidden");
  }
}

function fecharModalExclusao() {
  const modal = document.getElementById("modalExcluirConta");
  if (modal) {
    modal.classList.add("hidden");
  }

  // limpa campo e erro ao fechar
  const senhaInput = document.getElementById("senhaConfirmacao");
  const erro = document.getElementById("erroExclusao");

  if (senhaInput) senhaInput.value = "";
  if (erro) erro.classList.add("hidden");
}

async function confirmarExclusaoConta() {
  const token = localStorage.getItem("token");
  const senha = document.getElementById("senhaConfirmacao").value;
  const erro = document.getElementById("erroExclusao");

  erro.classList.add("hidden");

if (!senha || senha.length < 4) {
  erro.textContent = t("conta.erro_senha_curta");
  erro.classList.remove("hidden");
  return;
}

  try {
    const res = await fetch("/api/conta/excluir", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ senha })
    });

    if (res.ok) {
   localStorage.clear();
   window.location.href = "/index.html";
    } else {
   const data = await res.json().catch(() => ({}));

   erro.textContent = data.error || t("conta.erro_excluir_interno");
   erro.classList.remove("hidden");
  }


  } catch (err) {
    erro.textContent = t("conta.erro_conexao");
    erro.classList.remove("hidden");
  }
}


