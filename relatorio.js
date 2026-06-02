let chartMensalInstance = null;
let chartDiarioInstance = null;

document.addEventListener("DOMContentLoaded", () => {

  const token = localStorage.getItem("token");
  if (!token) {
    console.warn("Sem token");
    return;
  }

  async function carregarDashboard() {

    const res = await fetch("/api/modelo/dashboard-ganhos", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) {
      console.error("Erro ao buscar dashboard:", res.status);
      return;
    }

    const data = await res.json();
    console.log("Dashboard retornado:", data);

    document.getElementById("totalGanhos").innerText =
      `$${Number(data.total || 0).toFixed(2)}`;

    document.getElementById("saldo").innerText =
      `$${Number(data.saldoDisponivel || 0).toFixed(2)}`;

    document.getElementById("proximoPagamento").innerText =
      data.proximoPagamento || "-";

    renderMensal(data.mensal || []);
    renderDiario(data.diario || []);
  }

  function renderMensal(dados) {
    const ctx = document.getElementById("chartMensal");

    if (!ctx) return;

    if (chartMensalInstance) {
      chartMensalInstance.destroy();
    }

    chartMensalInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: dados.map(i => i.label),
        datasets: [{
          label: "Total",
          data: dados.map(i => Number(i.total)),
          borderColor: "#7B2CFF",
          tension: 0.3
        }]
      },
      options: { responsive: true }
    });
  }

  function renderDiario(dados) {
    const ctx = document.getElementById("chartDiario");

    if (!ctx) return;

    if (chartDiarioInstance) {
      chartDiarioInstance.destroy();
    }

    chartDiarioInstance = new Chart(ctx, {
      type: "line",
      data: {
        labels: dados.map(i => i.label),
        datasets: [{
          label: "Total",
          data: dados.map(i => Number(i.total)),
          borderColor: "#00c2a8",
          tension: 0.3
        }]
      },
      options: { responsive: true }
    });
  }

  carregarDashboard();
});
