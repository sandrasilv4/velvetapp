/**
 * aceite-termos.js
 * Controla o Step 0 de conta.html: Termo Digital de Aceite para Modelos
 *
 * Fluxo:
 *  1. Ao carregar, chama GET /api/modelo/aceite-termos/status
 *  2. Se já aceitou:  esconde a secção de termos, mostra banner de confirmação
 *  3. Se não aceitou: mostra a secção de termos, desactiva visualmente os Steps 1 e 2
 *  4. Submissão:      envia POST /api/modelo/aceite-termos com os 5 aceites + UA
 *  5. Sucesso:        mostra banner, activa Steps 1 e 2
 */

(function () {
  "use strict";

  const VERSAO_TERMOS = "2026-05";

  // ── Referências DOM ──────────────────────────────────────────────────────
  const secaoTermos      = document.getElementById("secaoTermos");
  const secaoDados       = document.getElementById("secaoDadosPessoais");
  const formAceite       = document.getElementById("formAceiteTermos");
  const bannerAceito     = document.getElementById("termosJaAceitos");
  const dataAceitoEl     = document.getElementById("termosAceitosData");
  const statusEl         = document.getElementById("statusAceiteTermos");
  const btnAceitar       = document.getElementById("btnAceitarTermos");

  // ── Utilitários ──────────────────────────────────────────────────────────
  function getToken() {
    return localStorage.getItem("token");
  }

  function formatarData(isoString) {
    if (!isoString) return "";
    const d = new Date(isoString);
    return d.toLocaleDateString("pt-PT", {
      day: "2-digit", month: "long", year: "numeric",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function mostrarStatus(msg, tipo) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.display = "block";
    statusEl.style.color = tipo === "erro" ? "#c0392b" : "#27ae60";
  }

  // ── Mostrar estado "já aceitou" ──────────────────────────────────────────
  function mostrarTermosAceitos(aceiteEm) {
    if (!secaoTermos) return;

    // Esconde o formulário das declarações
    if (formAceite) formAceite.style.display = "none";

    // Mostra o banner de confirmação
    if (bannerAceito) bannerAceito.classList.remove("hidden");
    if (dataAceitoEl && aceiteEm) {
      dataAceitoEl.textContent = "Aceite em " + formatarData(aceiteEm);
    }

    // Garante que a secção de termos está visível (só o banner)
    secaoTermos.style.display = "block";

    // Desbloqueia Steps 1 e 2
    desbloquearPassosSeguintes();
  }

  // ── Mostrar estado "precisa aceitar" ─────────────────────────────────────
  function mostrarFormularioTermos() {
    if (!secaoTermos) return;
    secaoTermos.style.display = "block";
    if (formAceite) formAceite.style.display = "block";

    // Bloqueia os passos seguintes até ao aceite
    bloquearPassosSeguintes();
  }

  // ── Bloquear / desbloquear passos seguintes ──────────────────────────────
  function bloquearPassosSeguintes() {
    // Adiciona overlay de bloqueio em todos os passos seguintes
    const secoes = [
      secaoDados,
      document.getElementById("secaoContrato"),
      document.getElementById("secaoDocumentos")
    ];
    secoes.forEach(s => {
      if (!s) return;
      s.classList.add("secao-bloqueada");
      if (!s.querySelector(".bloqueio-overlay")) {
        const overlay = document.createElement("div");
        overlay.className = "bloqueio-overlay";
        overlay.innerHTML = `
          <div class="bloqueio-msg">
            🔒 Aceita os termos no passo 1 para continuar
          </div>
        `;
        s.style.position = "relative";
        s.appendChild(overlay);
      }
    });
  }

  function desbloquearPassosSeguintes() {
    document.querySelectorAll(".secao-bloqueada").forEach(s => {
      s.classList.remove("secao-bloqueada");
      s.querySelectorAll(".bloqueio-overlay").forEach(o => o.remove());
      s.style.position = "";
    });
  }

  // ── Verificar status no backend ──────────────────────────────────────────
  async function verificarStatusTermos() {
    const token = getToken();
    if (!token) {
      // Não autenticado — não mostrar a secção de termos
      if (secaoTermos) secaoTermos.style.display = "none";
      return;
    }

    try {
      const res = await fetch("/api/modelo/aceite-termos/status", {
        headers: { Authorization: "Bearer " + token }
      });

      if (!res.ok) {
        // Pode ser cliente ou erro — esconde a secção silenciosamente
        if (secaoTermos) secaoTermos.style.display = "none";
        return;
      }

      const data = await res.json();

      if (data.aceito) {
        mostrarTermosAceitos(data.aceite_em);
      } else {
        mostrarFormularioTermos();
      }
    } catch (err) {
      console.warn("[aceite-termos] Erro ao verificar status:", err);
      if (secaoTermos) secaoTermos.style.display = "none";
    }
  }

  // ── Submissão do formulário ──────────────────────────────────────────────
  if (formAceite) {
    formAceite.addEventListener("submit", async (e) => {
      e.preventDefault();

      const token = getToken();
      if (!token) {
        mostrarStatus("Precisas de estar autenticada.", "erro");
        return;
      }

      // Verificar todos os checkboxes manualmente (para mensagens claras)
      const campos = [
        { id: "aceite_maioridade",   nome: "Declaração de Maioridade" },
        { id: "aceite_conteudo",     nome: "Consentimento de Conteúdo" },
        { id: "aceite_tributario",   nome: "Responsabilidade Tributária" },
        { id: "aceite_independente", nome: "Relação Independente" },
        { id: "aceite_financeiro",   nome: "Política Financeira" }
      ];

      for (const campo of campos) {
        const el = document.getElementById(campo.id);
        if (!el || !el.checked) {
          mostrarStatus(`⚠️ É obrigatório aceitar: "${campo.nome}"`, "erro");
          el?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }

      if (btnAceitar) {
        btnAceitar.disabled = true;
        btnAceitar.textContent = "A registar aceite...";
      }

      try {
        const res = await fetch("/api/modelo/aceite-termos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token
          },
          body: JSON.stringify({
            aceite_maioridade:   true,
            aceite_conteudo:     true,
            aceite_tributario:   true,
            aceite_independente: true,
            aceite_financeiro:   true,
            user_agent:          navigator.userAgent,
            versao:              VERSAO_TERMOS
          })
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(payload?.erro || "Erro ao registar aceite");
        }

        // Sucesso — mostrar banner e desbloquear passos
        mostrarTermosAceitos(payload.aceite_em || new Date().toISOString());

        // Scroll suave para o passo seguinte
        setTimeout(() => {
          secaoDados?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 400);

      } catch (err) {
        console.error("[aceite-termos] Erro:", err);
        mostrarStatus("❌ " + (err.message || "Erro ao registar. Tenta novamente."), "erro");
        if (btnAceitar) {
          btnAceitar.disabled = false;
          btnAceitar.textContent = "Aceitar todos os termos e continuar";
        }
      }
    });
  }

  // ── Inicialização ────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", () => {
    // Esconder secções de dados/documentos enquanto verificamos os termos
    // (evita flash de conteúdo antes de sabermos o estado)
    verificarStatusTermos();
  });

})();
