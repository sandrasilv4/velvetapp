function authFetch(url) {
  return fetch(url, {
    headers: { Authorization: "Bearer " + localStorage.getItem("token") }
  });
}

const filtroPeriodo = document.getElementById("filtroPeriodo");
const filtroModelo = document.getElementById("filtroModelo");
let chartMensal;

// =========================
// MODELOS
// =========================
async function carregarModelos() {
  const res = await authFetch("/api/allmessage/modelos");
  const modelos = await res.json();
  modelos.forEach(m => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.nome;
    filtroModelo.appendChild(opt);
  });
}

// =========================
// KPIs MENSAIS
// =========================
async function carregarKPIs() {
  const mes = filtroPeriodo.value;
  const modelo = filtroModelo.value || "";

  const res = await authFetch(
    `/api/relatorios/kpis-mensais?mes=${mes}&modelo_id=${modelo}`
  );
  const k = await res.json();

  document.getElementById("kpiTotal").innerText = `$${k.ganhos_totais}`;
  document.getElementById("kpiAssinaturas").innerText = `$${k.ganhos_assinaturas}`;
  document.getElementById("kpiMedia").innerText =
    `$${(k.ganhos_totais / Math.max(k.dias_com_venda,1)).toFixed(2)}`;
  document.getElementById("kpiAssinantes").innerText = k.assinantes_mes;
  document.getElementById("kpiChargebacks").innerText = k.chargebacks;
}

// =========================
// GANHOS DIÁRIOS
// =========================
async function graficoMensal() {
  const mes = filtroPeriodo.value;
  const modelo = filtroModelo.value || "";

  const res = await authFetch(
    `/api/transacoes/diario?mes=${mes}&modelo_id=${modelo}`
  );
  const dados = await res.json();

  if (chartMensal) {
    chartMensal.destroy();
  }

  chartMensal = new Chart(
    document.getElementById("graficoMensal"),
    {
      type: "line",
      data: {
        labels: dados.map(d => d.dia),
        datasets: [{
          label: "Ganhos",
          data: dados.map(d =>
            Number(d.ganhos_midias) + Number(d.ganhos_assinaturas)
          ),
          borderColor: "#7B2CFF",
          tension: 0.3
        }]
      }
    }
  );
}


// =========================
// INIT
// =========================
async function carregarTudo() {
  await carregarKPIs();
  await graficoMensal();
}

document.addEventListener("DOMContentLoaded", async () => {
  await carregarModelos();
  await carregarTudo();
  filtroPeriodo.onchange = carregarTudo;
  filtroModelo.onchange = carregarTudo;
});
