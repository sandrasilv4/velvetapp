async function carregarChargebacks() {
  const res = await fetch("/api/relatorios/chargebacks");
  const dados = await res.json();

  const tbody = document.getElementById("tabelaChargebacks");

  dados.forEach(cb => {
    tbody.innerHTML += `
      <tr>
        <td>#${cb.codigo}</td>
        <td>${cb.tipo}</td>
        <td>${cb.cliente_id}</td>
        <td>${cb.modelo_id}</td>
        <td>$${cb.valor_bruto}</td>
        <td>${cb.chargeback_result.toUpperCase()}</td>
        <td>${cb.origem_cliente}</td>
        <td>${new Date(cb.created_at).toLocaleDateString()}</td>
      </tr>
    `;
  });
}
