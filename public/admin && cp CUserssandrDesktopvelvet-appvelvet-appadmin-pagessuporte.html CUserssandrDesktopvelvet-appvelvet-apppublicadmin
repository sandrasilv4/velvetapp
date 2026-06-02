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

// ACUMULADO
const acumulado =
  Number(data.total.midias || 0) +
  Number(data.total.assinaturas || 0);

document.getElementById("acumuladoAnterior").innerText =
  `R$ ${Number(data.total.acumulado_2026 || 0).toFixed(2)}`;

  } catch (err) {
    console.error("Erro carregarResumoModelo:", err);
  }
}

// ===============================
// 🚀 INIT
// ===============================
document.addEventListener("DOMContentLoaded", () => {
  carregarResumoModelo();
});
