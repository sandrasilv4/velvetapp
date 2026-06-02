// ============================================================
// contrato-assinatura.js
// Gestão do passo 3 do onboarding: assinatura do contrato ZapSign
// ============================================================

(function () {
  "use strict";

  // ── Elementos ────────────────────────────────────────────────
  const secaoContrato      = document.getElementById("secaoContrato");
  const contratoJaAssinado = document.getElementById("contratoJaAssinado");
  const contratoAssinadoData = document.getElementById("contratoAssinadoData");
  const contratoAAssinar   = document.getElementById("contratoAAssinar");
  const contratoLoadingMsg = document.getElementById("contratoLoadingMsg");
  const contratoIframeWrap = document.getElementById("contratoIframeWrap");
  const iframeContrato     = document.getElementById("iframeContrato");
  const contratoAcoesExternas = document.getElementById("contratoAcoesExternas");
  const linkAssinaturaExterno  = document.getElementById("linkAssinaturaExterno");
  const contratoPollingMsg = document.getElementById("contratoPollingMsg");
  const contratoErro       = document.getElementById("contratoErro");
  const secaoDocumentos    = document.getElementById("secaoDocumentos");

  if (!secaoContrato) return; // Só corre em conta.html

  // ── Estado ──────────────────────────────────────────────────
  let pollingInterval = null;
  let pollingAttempts = 0;
  const MAX_POLLING = 120; // ~10 min a cada 5s

  // ── Helpers ──────────────────────────────────────────────────
  function mostrarErro(msg) {
    if (!contratoErro) return;
    contratoErro.textContent = msg;
    contratoErro.style.display = "block";
  }

  function esconderErro() {
    if (!contratoErro) return;
    contratoErro.style.display = "none";
  }

  function bloquearDocumentos() {
    if (!secaoDocumentos) return;
    secaoDocumentos.style.opacity = "0.4";
    secaoDocumentos.style.pointerEvents = "none";
    secaoDocumentos.style.userSelect = "none";
    // Adicionar overlay de bloqueio se não existir
    if (!secaoDocumentos.querySelector(".bloqueio-overlay")) {
      const overlay = document.createElement("div");
      overlay.className = "bloqueio-overlay";
      overlay.innerHTML = `<p class="bloqueio-msg">🔒 Assina o contrato (Passo 3) antes de enviar os documentos</p>`;
      secaoDocumentos.style.position = "relative";
      secaoDocumentos.appendChild(overlay);
    }
  }

  function desbloquearDocumentos() {
    if (!secaoDocumentos) return;
    secaoDocumentos.style.opacity = "";
    secaoDocumentos.style.pointerEvents = "";
    secaoDocumentos.style.userSelect = "";
    const overlay = secaoDocumentos.querySelector(".bloqueio-overlay");
    if (overlay) overlay.remove();
  }

  function mostrarContratoAssinado(assinadoEm) {
    if (pollingInterval) { clearInterval(pollingInterval); pollingInterval = null; }
    if (contratoJaAssinado) contratoJaAssinado.classList.remove("hidden");
    if (contratoAAssinar)   contratoAAssinar.style.display = "none";
    if (contratoAssinadoData && assinadoEm) {
      const d = new Date(assinadoEm);
      contratoAssinadoData.textContent = `Assinado em ${d.toLocaleDateString("pt-BR")} às ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
    }
    desbloquearDocumentos();
    // Rolar suavemente para a secção de documentos
    setTimeout(() => {
      if (secaoDocumentos) {
        secaoDocumentos.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 600);
  }

  function mostrarFormularioAssinatura(signUrl) {
    if (contratoLoadingMsg) contratoLoadingMsg.style.display = "none";

    // Tentar iframe primeiro
    if (iframeContrato && contratoIframeWrap) {
      // ZapSign suporta iframe — usar URL com ?iframe=true
      const iframeUrl = signUrl + (signUrl.includes("?") ? "&" : "?") + "iframe=true";
      iframeContrato.src = iframeUrl;
      contratoIframeWrap.classList.remove("hidden");
    }

    // Link externo como fallback/alternativa
    if (linkAssinaturaExterno && contratoAcoesExternas) {
      linkAssinaturaExterno.href = signUrl;
      contratoAcoesExternas.classList.remove("hidden");
    }

    // Iniciar polling de confirmação
    iniciarPolling();
  }

  // ── Polling ──────────────────────────────────────────────────
  function iniciarPolling() {
    if (pollingInterval) return;
    if (contratoPollingMsg) contratoPollingMsg.classList.remove("hidden");
    pollingInterval = setInterval(verificarStatus, 5000);
  }

  async function verificarStatus() {
    pollingAttempts++;
    if (pollingAttempts > MAX_POLLING) {
      clearInterval(pollingInterval);
      pollingInterval = null;
      if (contratoPollingMsg) contratoPollingMsg.classList.add("hidden");
      mostrarErro("O tempo de verificação expirou. Actualiza a página após assinar.");
      return;
    }

    try {
      const token = localStorage.getItem("token");
      const resp = await fetch("/api/verificacao/contrato/status", {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.assinado) {
        mostrarContratoAssinado(data.assinado_em);
      }
    } catch (_) {
      // Silencioso — tentar novamente
    }
  }

  // ── Inicialização ─────────────────────────────────────────────
  async function init() {
    const token = localStorage.getItem("token");
    if (!token) return;

    // Bloquear documentos por defeito
    bloquearDocumentos();

    try {
      // Verificar estado actual do contrato
      const statusResp = await fetch("/api/verificacao/contrato/status", {
        headers: { Authorization: `Bearer ${token}` }
      });

      if (!statusResp.ok) {
        if (statusResp.status === 401 || statusResp.status === 403) return;
        throw new Error("Erro ao verificar contrato");
      }

      const statusData = await statusResp.json();

      if (statusData.assinado) {
        // Já assinou — mostrar banner e desbloquear documentos
        mostrarContratoAssinado(statusData.assinado_em);
        return;
      }

      // Se já tem URL de assinatura gerada mas ainda não assinou
      if (statusData.sign_url) {
        mostrarFormularioAssinatura(statusData.sign_url);
        return;
      }

      // Gerar novo contrato no ZapSign
      if (contratoLoadingMsg) {
        contratoLoadingMsg.style.display = "block";
        const p = contratoLoadingMsg.querySelector("p");
        if (p) p.textContent = "A gerar o contrato...";
      }

      const criarResp = await fetch("/api/verificacao/contrato", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      });

      const criarData = await criarResp.json();

      if (!criarResp.ok) {
        if (contratoLoadingMsg) contratoLoadingMsg.style.display = "none";
        // Se o problema é dados pessoais em falta — não mostrar secção de contrato ainda
        if (criarData.erro && criarData.erro.includes("dados pessoais")) {
          secaoContrato.style.display = "none";
        } else {
          mostrarErro(criarData.erro || "Erro ao preparar o contrato. Tenta novamente.");
        }
        return;
      }

      if (criarData.ja_assinado) {
        mostrarContratoAssinado(null);
        return;
      }

      if (criarData.sign_url) {
        mostrarFormularioAssinatura(criarData.sign_url);
      }

    } catch (err) {
      console.error("[Contrato] Erro:", err);
      if (contratoLoadingMsg) contratoLoadingMsg.style.display = "none";
      mostrarErro("Não foi possível carregar o contrato. Tenta actualizar a página.");
    }
  }

  // Aguardar que os dados pessoais sejam guardados para iniciar
  // O aceite-termos.js emite um evento customizado "termosAceitos" quando os termos são confirmados
  // O areaUsuario.js deve emitir "dadosPessoaisGuardados" após salvar dados pessoais
  // Mas também corremos init() directamente para quem já passou essas etapas

  // Ouvir evento do passo anterior (dados pessoais guardados)
  document.addEventListener("dadosPessoaisGuardados", () => {
    init();
  });

  // Correr init() assim que a página carrega (para quem já passou os passos anteriores)
  // Só corremos se a secção de contrato está visível (não bloqueada)
  init();

})();
