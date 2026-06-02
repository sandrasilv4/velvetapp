// =====================================================
// 🔐 FETCH COM AUTENTICAÇÃO (JWT)
// =====================================================
async function authFetch(url, options = {}) {
  const token = localStorage.getItem("token");

  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: "Bearer " + token
    }
  });

  if (!response.ok) {
    console.error("Não autorizado ou erro ao buscar dados");
    return;
  }

  return response;
}



async function carregarRelatorio() {
  try {
    const response = await authFetch('/api/relatorios/transacoes');
    if (!response) return;

    const transacoes = await response.json();

    const tbody = document.getElementById('tabela-transacoes');
    tbody.innerHTML = '';

    transacoes.forEach(t => {
      const tr = document.createElement('tr');

      tr.innerHTML = `
        <td>#${t.transacao_id}</td>
        <td>${t.tipo_transacao}</td>
        <td>${t.cliente_id}</td>
        <td>${formatarData(t.data_hora)}</td>
        <td>R$ ${Number(t.preco).toFixed(2)}</td>
        <td>R$ ${Number(t.ganhos_velvet).toFixed(2)}</td>
        <td>R$ ${Number(t.ganhos_agencia).toFixed(2)}</td>
        <td>R$ ${Number(t.ganhos_modelo).toFixed(2)}</td>
      `;

      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error("Erro ao carregar relatório:", err);
  }
}


function formatarData(data) {
  const d = new Date(data);
  return d.toLocaleDateString('pt-BR') + ' ' + d.toLocaleTimeString('pt-BR');
}

// primeira carga
carregarRelatorio();

// atualiza a cada 5 segundos
setInterval(carregarRelatorio, 5000);
