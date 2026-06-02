const token = localStorage.getItem("token");
let ofertas = [];
let abaAtual = "ativas";

const lista = document.getElementById("ofertasLista");
const btnCriar = document.getElementById("btnCriarOferta");


if (!lista) {
  console.error("Elemento #ofertasLista não encontrado");
}

/* ===============================
   RENDER
=============================== */
function renderOfertas() {
  if (!lista) return;

  lista.innerHTML = "";

  const temOfertaAtiva = ofertas.some(o => o.ativa);

  if (btnCriar) {
    btnCriar.style.display = temOfertaAtiva ? "none" : "block";
  }

  ofertas
    .filter(o => (abaAtual === "ativas" ? o.ativa : !o.ativa))
    .forEach(o => {
      const dias = diasRestantes(o.fim);

      const card = document.createElement("div");
      card.className = "oferta-card";

      card.innerHTML = `
        <div class="oferta-header">
          <h4>${o.nome}</h4>
        </div>

        <div class="status ${o.ativa ? "status-ativa" : "status-inativa"}">
          <span class="dot"></span>
          ${o.ativa ? t("ofertas.status_ativa") : t("ofertas.status_encerrada")}
        </div>

        <div class="oferta-info">
          ${
            o.ativa
              ? t("ofertas.termina_em")
                  .replace("{dias}", dias)
                  .replace("{data}", formatarData(o.fim))
              : t("ofertas.encerrada_em")
                  .replace("{data}", formatarData(o.fim))
          }
        </div>

        <div class="valores-box">
          <div>
            <span>${t("ofertas.valor_original")} </span>
            <strong>R$ ${(o.valor_original || 0).toFixed(2)}</strong>
          </div>

          <div class="desconto">
            <span>${t("ofertas.desconto")} </span>
            <strong>-${o.desconto}%</strong>
          </div>

          <div>
            <span>${t("ofertas.valor_final")} </span>
            <strong>R$ ${o.valor_final.toFixed(2)}</strong>
          </div>
        </div>

        <div class="oferta-detalhes">
          <div>
            <span>${t("ofertas.inicio")}</span>
            <span>${formatarData(o.inicio)}</span>
          </div>

          <div>
            <span>${t("ofertas.fim")}</span>
            <span>${formatarData(o.fim)}</span>
          </div>

          <div>
            <span>${t("ofertas.participantes")}</span>
            <span>${o.usadas}/${o.limite}</span>
          </div>
        </div>

        ${
          o.ativa
            ? `<button class="btn-encerrar" onclick="encerrarOferta(${o.id})">
                 ${t("ofertas.btn_encerrar")}
               </button>`
            : ""
        }
      `;

      lista.appendChild(card);
    });
}

/* ===============================
   AÇÕES
=============================== */
async function encerrarOferta(id) {
  if (!confirm(t("ofertas.confirm_encerrar"))) return;

  try {
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch(`/api/ofertas/${id}/encerrar`, {
      method: "PUT",
      headers: {
        Authorization: "Bearer " + token
      }
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.erro || t("ofertas.erro_encerrar"));
      return;
    }

    carregarOfertasDoBanco();

  } catch (err) {
    console.error(err);
    alert(t("ofertas.erro_encerrar"));
  }
}

/* ===============================
   HELPERS
=============================== */
function diasRestantes(fim) {
  const hoje = new Date();
  const dataFim = new Date(fim);
  return Math.ceil((dataFim - hoje) / (1000 * 60 * 60 * 24));
}

function formatarData(data) {
  return new Date(data).toLocaleDateString("pt-BR");
}

/* ===============================
   TABS
=============================== */
document.querySelectorAll(".tab").forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    abaAtual = tab.dataset.tab;
    carregarOfertasDoBanco();
  };
});

if (btnCriar) {
  btnCriar.onclick = abrirModalCriarOferta;
}

async function abrirModalCriarOferta() {
  const resPlano = await fetch("/api/modelo/planos/me", {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token")
    }
  });

  if (!resPlano.ok) {
    alert(t("ofertas.erro_buscar_plano"));
    return;
  }

  const plano = await resPlano.json();

  if (!plano || !plano.valor_mensal) {
    alert(t("ofertas.erro_sem_plano"));
    return;
  }

  const VALOR_BASE = Number(plano.valor_mensal);
  const VALOR_MINIMO = VALOR_BASE * 0.5;

  let etapa = 1;

  const dados = {
    nome: "",
    limite: 0,
    dias: 1,
    desconto: 0,
    mensagem: ""
  };

  const modal = document.createElement("div");
  modal.className = "modal-overlay";

  modal.innerHTML = `
    <div class="modal-backdrop"></div>

    <div class="modal-box wizard">
      <div class="wizard-content"></div>

      <div class="wizard-acoes">
        <button class="btn-voltar" disabled>${t("ofertas.btn_voltar")}</button>
        <button class="btn-avancar">${t("ofertas.btn_avancar")}</button>
      </div>
    </div>
  `;

  const content = modal.querySelector(".wizard-content");
  const btnAvancar = modal.querySelector(".btn-avancar");
  const btnVoltar = modal.querySelector(".btn-voltar");

  modal.querySelector(".modal-backdrop").onclick = () => modal.remove();

  function calcularValor() {
    const v = VALOR_BASE * (1 - dados.desconto / 100);
    return v < VALOR_MINIMO ? VALOR_MINIMO : v;
  }

  function render() {
    btnVoltar.disabled = etapa === 1;

    btnVoltar.textContent = t("ofertas.btn_voltar");
    btnAvancar.textContent =
      etapa === 4 ? t("ofertas.btn_criar") :
      etapa === 5 ? t("ofertas.btn_fechar") :
      t("ofertas.btn_avancar");

    if (etapa === 1) {
      content.innerHTML = `
        <h3>${t("ofertas.titulo_nome")}</h3>
        <input
          id="nome"
          placeholder="${t("ofertas.placeholder_nome")}"
          value="${dados.nome || ""}"
        >
      `;
    }

    if (etapa === 2) {
      content.innerHTML = `
        <h3>${t("ofertas.titulo_limite")}</h3>
        <input
          id="limite"
          type="number"
          min="1"
          placeholder="${t("ofertas.placeholder_limite")}"
          value="${dados.limite || ""}"
        >
      `;
    }

    if (etapa === 3) {
      const fim = new Date();
      fim.setDate(fim.getDate() + dados.dias);

      content.innerHTML = `
        <h3>${t("ofertas.titulo_tempo")}</h3>
        <input type="range" min="1" max="15" value="${dados.dias}" id="dias">
        <p class="info">
          ${t("ofertas.info_ativa_ate").replace("{data}", fim.toLocaleDateString("pt-BR"))}
        </p>
      `;

      content.querySelector("#dias").oninput = e => {
        dados.dias = Number(e.target.value);
        render();
      };
    }

    if (etapa === 4) {
      content.innerHTML = `
        <h3>${t("ofertas.titulo_desconto")}</h3>

        <div class="descontos">
          ${[5, 10, 15, 20].map(p => `
            <button class="btn-desc ${dados.desconto === p ? "active" : ""}" data-p="${p}">
              ${p}%
            </button>
          `).join("")}
        </div>

        <p class="info">
          ${t("ofertas.info_desconto_mes")}<br>
          ${t("ofertas.info_valor_minimo")} <strong>R$ 15,00</strong>
        </p>

        <div class="precos">
          <div>
            ${t("ofertas.valor_normal")}
            <strong>R$ ${VALOR_BASE.toFixed(2)}</strong>
          </div>
          <div>
            ${t("ofertas.valor_promocional")}
            <strong>R$ ${calcularValor().toFixed(2)}</strong>
          </div>
        </div>
      `;

      content.querySelectorAll(".btn-desc").forEach(btn => {
        btn.onclick = () => {
          dados.desconto = Number(btn.dataset.p);
          render();
        };
      });
    }

    if (etapa === 5) {
      content.innerHTML = `
        <h3>${t("ofertas.parabens")}</h3>
        <p>${t("ofertas.sucesso_modal")}</p>
      `;
    }
  }

  btnAvancar.onclick = async () => {
    if (etapa === 1) dados.nome = content.querySelector("#nome").value;
    if (etapa === 2) dados.limite = Number(content.querySelector("#limite").value);

    if (etapa < 4) {
      etapa++;
      render();
      return;
    }

    if (etapa === 5) {
      modal.remove();
      return;
    }

    try {
      const token = localStorage.getItem("token");

      const res = await fetch("/api/ofertas", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token
        },
        body: JSON.stringify({
          nome: dados.nome,
          limite: dados.limite,
          dias: dados.dias,
          desconto: dados.desconto
        })
      });

      const data = await res.json();

      if (!res.ok) {
        console.error("ERRO BACKEND:", data);
        alert(data?.erro || t("ofertas.erro_criar"));
        return;
      }

      etapa = 5;
      render();
      carregarOfertasDoBanco();

    } catch (err) {
      console.error(err);
      alert(t("ofertas.erro_criar"));
    }
  };

  btnVoltar.onclick = () => {
    if (etapa > 1) {
      etapa--;
      render();
    }
  };

  render();
  document.body.appendChild(modal);
}


async function carregarOfertasDoBanco() {
  try {
    const token = localStorage.getItem("token");
    if (!token) return;

    const res = await fetch("/api/ofertas", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.error("Erro ao buscar ofertas");
      return;
    }

    const dados = await res.json();

    ofertas = dados.map(o => ({
      id: o.id,
      nome: o.nome,
      ativa: o.ativa,
      inicio: o.data_inicio,
      fim: o.data_fim,
      valor_original: Number(o.valor_base),
      valor_final: Number(o.valor_promocional),
      desconto: Number(o.desconto_percentual),
      limite: o.limite_assinaturas,
      usadas: o.assinaturas_usadas
    }));

    renderOfertas();
  } catch (err) {
    console.error("Erro carregar ofertas:", err);
  }
}

function validarAssinatura() {
  const input = document.getElementById("assinaturaMensal");
  const valor = parseFloat(input.value);

  if (isNaN(valor) || valor < 20) {
    alert(t("ofertas.erro_valor_minimo"));
    input.focus();
    return false;
  }

  return true;
}


document.addEventListener("DOMContentLoaded", async () => {
  carregarOfertasDoBanco();

  const mensalInput = document.getElementById("assinaturaMensal");
  const descontoTriInput = document.getElementById("descontoTrimestral");
  const trimestralInput = document.getElementById("assinaturaTrimestral");
  const btnSalvar = document.getElementById("salvarPlanos");

  if (!mensalInput || !descontoTriInput || !trimestralInput) return;

  function calcularTrimestral() {
    const mensal = parseFloat(mensalInput.value);
    let desconto = parseFloat(descontoTriInput.value) || 0;

    if (desconto > 30) {
      desconto = 30;
      descontoTriInput.value = 30;
    }

    if (isNaN(mensal) || mensal < 20) {
      trimestralInput.value = "0.00";
      return;
    }

    const valorBase = mensal * 3;
    const valorFinal = valorBase * (1 - desconto / 100);

    trimestralInput.value = valorFinal.toFixed(2);
  }

  mensalInput.addEventListener("input", calcularTrimestral);
  descontoTriInput.addEventListener("input", calcularTrimestral);

  mensalInput.addEventListener("blur", () => {
    const valor = parseFloat(mensalInput.value);
    if (isNaN(valor) || valor < 20) {
      mensalInput.value = 20;
      calcularTrimestral();
    }
  });

  if (btnSalvar) {
  btnSalvar.addEventListener("click", async () => {

    const mensal = parseFloat(mensalInput.value);
    const desconto = parseFloat(descontoTriInput.value) || 0;

    if (isNaN(mensal) || mensal < 20) {
      alert(t("ofertas.erro_valor_minimo"));
      return;
    }

    btnSalvar.disabled = true;
    btnSalvar.textContent = t("ofertas.salvando");

    try {
      const res = await fetch("/api/modelo/planos", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + localStorage.getItem("token")
        },
        body: JSON.stringify({
          valor_mensal: mensal,
          desconto_trimestral: desconto
        })
      });

      const data = await res.json();

      if (!res.ok) {
        alert(data.erro);
        btnSalvar.disabled = false;
        btnSalvar.textContent = t("ofertas.btn_salvar_plano");
        return;
      }

      btnSalvar.textContent = t("ofertas.salvo");

      setTimeout(() => {
        btnSalvar.disabled = false;
        btnSalvar.textContent = t("ofertas.btn_salvar_plano");
      }, 1500);

    } catch (err) {
      console.error(err);
      alert(t("ofertas.erro_salvar_plano"));
      btnSalvar.disabled = false;
      btnSalvar.textContent = t("ofertas.btn_salvar_plano");
    }

  });
}

  async function carregarPlano() {
    try {
      const res = await fetch("/api/modelo/planos/me", {
        headers: {
          Authorization: "Bearer " + localStorage.getItem("token")
        }
      });

      const plano = await res.json();
      if (!plano) return;

      mensalInput.value = plano.valor_mensal;
      descontoTriInput.value = plano.desconto_trimestral;

      calcularTrimestral();

    } catch (err) {
      console.error("Erro ao carregar plano", err);
    }
  }

  carregarPlano();

});