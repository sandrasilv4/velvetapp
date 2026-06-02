/* ========================================
   VELVET agency DASHBOARD — JS
   ======================================== */

  const token = localStorage.getItem("token_agency");

if (!token) {
  window.location.href = "/agencias/login.html";
  throw new Error("Sem token agency");
}

async function authFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: token ? `Bearer ${token}` : ""
    }
  });
}

async function fetchJSON(url) {
  const res = await authFetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function postJSON(url, body) {
  const res = await authFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.erro || err.error || err.message || `HTTP ${res.status}`);
  }

  return res.json();
}

async function putJSON(url, body) {
  const res = await authFetch(url, {
    method: 'PUT',
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.erro || err.message || `HTTP ${res.status}`);
  }

  return res.json();
}

async function deleteJSON(url) {
  const res = await authFetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json().catch(() => ({}));
}

// ========== HELPERS ==========

function $(id) { return document.getElementById(id); }

function money(v) {
  return Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('pt-BR');
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('pt-BR');
}

function toast(msg, type = '') {
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast active ' + type;
  setTimeout(() => t.className = 'toast', 3500);
}

function emptyRow(cols) {
  return `<tr class="empty-row"><td colspan="${cols}">Nenhum registro encontrado</td></tr>`;
}

function badgeStatus(status) {
  const map = {
    pendente: 'badge-warning',
    aprovado: 'badge-success',
    rejeitado: 'badge-danger',
    pago: 'badge-success',
    ativo: 'badge-success',
    normal: 'badge-success',
    em_analise: 'badge-info',
    expirado: 'badge-muted',
    falhou: 'badge-danger',
    iniciado: 'badge-info',
    cancelado: 'badge-danger'
  };
  return `<span class="badge ${map[status] || 'badge-muted'}">${status || '—'}</span>`;
}

function populateMonthSelect(el, startYear = 2025) {
  const now = new Date();
  const months = [];
  for (let y = now.getFullYear(); y >= startYear; y--) {
    const maxM = (y === now.getFullYear()) ? now.getMonth() + 1 : 12;
    for (let m = maxM; m >= 1; m--) {
      const val = `${y}-${String(m).padStart(2, '0')}`;
      const label = new Date(y, m - 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
      months.push({ val, label });
    }
  }
  el.innerHTML = months.map((m, i) =>
    `<option value="${m.val}" ${i === 0 ? 'selected' : ''}>${m.label}</option>`
  ).join('');
}

function buildPagination(containerId, currentPage, totalPages, callback) {
  const container = $(containerId);
  if (!container || totalPages <= 1) {
    if (container) container.innerHTML = '';
    return;
  }
  let html = '';
  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  if (currentPage > 1) html += `<button onclick="${callback}(${currentPage - 1})">&laquo;</button>`;
  for (let i = start; i <= end; i++) {
    html += `<button class="${i === currentPage ? 'active' : ''}" onclick="${callback}(${i})">${i}</button>`;
  }
  if (currentPage < totalPages) html += `<button onclick="${callback}(${currentPage + 1})">&raquo;</button>`;
  container.innerHTML = html;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

async function carregarAgencia() {
  const res = await fetch("/agency/dashboard/name-agency", {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token_agency")
    }
  });

  const data = await res.json();

  document.querySelector(".agency-badge").textContent = data.nome;
}

carregarAgencia();

// ========== NAVIGATION ==========

const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
const pageTitles = {
  overview: 'Visão Geral',
  acessos: 'Acessos por Origem',
  agency: 'Agência',
  fechamento: 'Fechamentos Mensais',
  bancarios: 'Dados Bancários',
  modelos: 'Modelos',
  ranking: 'Ranking',
  'pagamentos-agencia': 'Recebimentos da Agência'
};

const pageLoaders = {};

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const page = item.dataset.page;
    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    pages.forEach(p => p.classList.remove('active'));
    const pageEl = $('page-' + page);
    if (pageEl) pageEl.classList.add('active');
    $('pageTitle').textContent = pageTitles[page] || page;
    if (pageLoaders[page]) pageLoaders[page]();
  });
});

// Sidebar toggle
$('sidebarToggle').addEventListener('click', () => {
  $('sidebar').classList.toggle('collapsed');
});

// Mobile sidebar toggle
document.querySelector('.topbar-menu-btn')?.addEventListener('click', () => {
  document.querySelector('.sidebar').classList.toggle('mobile-open');
  document.querySelector('.sidebar-overlay').classList.toggle('active');
});

document.querySelector('.sidebar-overlay')?.addEventListener('click', () => {
  document.querySelector('.sidebar').classList.remove('mobile-open');
  document.querySelector('.sidebar-overlay').classList.remove('active');
});

// Tab handling
document.querySelectorAll('.tabs').forEach(tabGroup => {
  tabGroup.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabGroup.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const parent = tabGroup.parentElement;
      parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      const target = parent.querySelector('#tab-' + tab.dataset.tab);
      if (target) target.classList.add('active');
    });
  });
});

// ========== MODALS ==========

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  const overlay = document.getElementById('modalOverlay');
  if (modal) modal.classList.add('active');
  if (overlay) overlay.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');

  const overlay = document.getElementById('modalOverlay');
  const aindaExisteModalAberto = document.querySelector('.modal.active');

  if (overlay && !aindaExisteModalAberto) {
    overlay.classList.remove('active');
  }
}

function closeAllModals() {
  document.querySelectorAll('.modal.active').forEach(m => m.classList.remove('active'));
  const overlay = document.getElementById('modalOverlay');
  if (overlay) overlay.classList.remove('active');
}

function logout() {
  localStorage.removeItem('token_agency');
  window.location.href = '/agencias/login.html';
}

function abrirResetSenha() {
  const el = document.getElementById('novaSenha');
  if (el) el.value = '';
  openModal('modalAgency');
}

// ========== 1. OVERVIEW ==========

let chartFat, chartAcessosOverview;

pageLoaders.overview = async function () {
  try {
    const data = await fetchJSON('/agency/dashboard/overview');

    $('kpi-modelos').textContent = Number(data.total_modelos ?? 0);
    $('kpi-vips').textContent = Number(data.vips_ativos ?? 0);
    $('kpi-fatd').textContent = money(Number(data.faturamento_dia ?? 0));
    $('kpi-fatm').textContent = money(Number(data.faturamento_mes ?? 0));

    // Chart faturamento últimos 12 meses
    if (chartFat) {
      chartFat.destroy();
      chartFat = null;
    }

    chartFat = new Chart($('chartOverviewFat'), {
      type: 'bar',
      data: {
        labels: (data.faturamento_12m || []).map(d => d.mes),
        datasets: [{
          label: 'Faturamento',
          data: (data.faturamento_12m || []).map(d => Number(d.total || 0)),
          backgroundColor: 'rgba(123,44,255,0.7)',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          y: {
            beginAtZero: true
          }
        }
      }
    });

    // Chart acessos por origem do mês atual
    if (chartAcessosOverview) {
      chartAcessosOverview.destroy();
      chartAcessosOverview = null;
    }

    chartAcessosOverview = new Chart($('chartOverviewAcessos'), {
      type: 'doughnut',
      data: {
        labels: (data.acessos_origem || []).map(d => d.origem),
        datasets: [{
          data: (data.acessos_origem || []).map(d => Number(d.total || 0)),
          backgroundColor: ['#7B2CFF', '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#14B8A6']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom'
          }
        }
      }
    });

    // Top 5 modelos do mês
    const tbody = $('tableTopModelos').querySelector('tbody');
    tbody.innerHTML = (data.top_modelos || []).map((m, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${m.nome || 'Modelo #' + m.modelo_id}</td>
        <td>${money(Number(m.ganhos || 0))}</td>
        <td>${money(Number(m.ganhos_agencia || 0))}</td>
        <td>${Number(m.assinantes || 0)}</td>
      </tr>
    `).join('') || emptyRow(5);

  } catch (err) {
    console.error('Erro overview:', err);

    $('kpi-modelos').textContent = '--';
    $('kpi-vips').textContent = '--';
    $('kpi-fatd').textContent = '--';
    $('kpi-fatm').textContent = '--';

    const tbody = $('tableTopModelos')?.querySelector('tbody');
    if (tbody) tbody.innerHTML = emptyRow(5);
  }
};

// ========== 2. ACESSOS ==========

let chartAcessosBar, chartAcessosPie;

pageLoaders.acessos = async function () {
  populateMonthSelect($('acessosMes'));
  await carregarAcessos();
  $('acessosMes').onchange = carregarAcessos;
};

async function carregarAcessos() {
  try {
    const mes = $('acessosMes').value;
    const data = await fetchJSON(`/agency/dashboard/acessos-origem?mes=${mes}`);

    $('kpi-insta').textContent = data.instagram ?? 0;
    $('kpi-tiktok').textContent = data.tiktok ?? 0;
    $('kpi-direto').textContent = data.direto ?? 0;
    $('kpi-totalAcessos').textContent = data.total ?? 0;

    if (data.diario) {
      if (chartAcessosBar) chartAcessosBar.destroy();
      chartAcessosBar = new Chart($('chartAcessosBar'), {
        type: 'bar',
        data: {
          labels: data.diario.map(d => d.dia),
          datasets: [
            { label: 'Instagram', data: data.diario.map(d => d.instagram), backgroundColor: '#7B2CFF', borderRadius: 4 },
            { label: 'TikTok', data: data.diario.map(d => d.tiktok), backgroundColor: '#3B82F6', borderRadius: 4 },
            { label: 'Direto', data: data.diario.map(d => d.direto), backgroundColor: '#10B981', borderRadius: 4 }
          ]
        },
        options: { plugins: { legend: { position: 'top' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } }
      });
    }

    if (data.distribuicao) {
      if (chartAcessosPie) chartAcessosPie.destroy();
      chartAcessosPie = new Chart($('chartAcessosPie'), {
        type: 'doughnut',
        data: {
          labels: ['Instagram', 'TikTok', 'Direto', 'Outros'],
          datasets: [{
            data: [data.instagram, data.tiktok, data.direto, (data.total - data.instagram - data.tiktok - data.direto)],
            backgroundColor: ['#7B2CFF', '#3B82F6', '#10B981', '#9CA3AF']
          }]
        },
        options: { plugins: { legend: { position: 'bottom' } } }
      });
    }

    const tbody = $('tableAcessosTop').querySelector('tbody');
    tbody.innerHTML = (data.top_modelos || []).map((m, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${m.nome || 'Modelo #' + m.modelo_id}</td>
        <td>${m.instagram ?? 0}</td>
        <td>${m.tiktok ?? 0}</td>
        <td>${m.direto ?? 0}</td>
        <td><strong>${m.total ?? 0}</strong></td>
      </tr>
    `).join('') || emptyRow(6);

  } catch (err) {
    console.error('Erro acessos:', err);
  }
}

// ========== 3. agency ==========

pageLoaders.agency = async function () {
  try {
    const data = await fetchJSON('/agency/dashboard/agency');
    const tbody = $('tableAgency').querySelector('tbody');
    const agencia = (data || [])[0];

    tbody.innerHTML = agencia ? `
      <tr>
        <td>${agencia.id}</td>
        <td>${escapeHtml(agencia.nome || '—')}</td>
        <td>${agencia.email}</td>
        <td>${fmtDateTime(agencia.created_at)}</td>
        <td>
          <button class="btn btn-sm btn-danger" onclick="abrirResetSenha()">Resetar Senha</button>
        </td>
      </tr>
    ` : emptyRow(5);

    if (agencia) {
      const inpAg = $('inputPercentualAgencia');
      const inpMod = $('inputPercentualModelo');
if (inpAg) inpAg.value = (agencia.percentual_agencia * 100).toFixed(2);
if (inpMod) inpMod.value = (agencia.percentual_modelo * 100).toFixed(2);
      atualizarSoma();
    }
  } catch (err) {
    console.error('Erro agency:', err);
  }
};

function atualizarSoma() {
  const ag  = Number($('inputPercentualAgencia')?.value || 0);
  const mod = Number($('inputPercentualModelo')?.value || 0);

  const velvet = 20;
  const total = velvet + ag + mod;

  const info = $('percentualSomaInfo');
  if (!info) return;

  if (ag + mod > 80) {
    info.style.color = 'var(--red)';
    info.textContent = `❌ Excede limite: ${total.toFixed(2)}% (máx: 100%)`;
  } else if (ag + mod === 80) {
    info.style.color = 'var(--green)';
    info.textContent = `✔ Perfeito: ${total.toFixed(2)}%`;
  } else {
    info.style.color = 'var(--text-muted)';
    info.textContent = `Total: ${total.toFixed(2)}% (Velvet ${velvet}% + Agência ${ag}% + Modelo ${mod}%)`;
  }
}

async function salvarPercentuais(e) {
  e.preventDefault();

  const ag  = Number($('inputPercentualAgencia').value);
  const mod = Number($('inputPercentualModelo').value);

  const velvet = 20;

  if (ag + mod > (100 - velvet)) {
    toast(
      `Soma inválida: Velvet ${velvet}% + Agência ${ag}% + Modelo ${mod}% = ${velvet + ag + mod}%`,
      'error'
    );
    return;
  }

  try {
    await putJSON('/agency/dashboard/agency/percentuais', {
      percentual_agencia: ag,
      percentual_modelo: mod
    });

    toast('Percentuais atualizados com sucesso!', 'success');
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function resetSenha() {
  const senha = document.getElementById('novaSenha').value;

  if (!senha || senha.length < 6) {
    toast('Senha inválida (mínimo 6 caracteres)', 'error');
    return;
  }

  try {
    await putJSON('/agency/dashboard/agency/reset-password', { senha });
    toast('Senha atualizada com sucesso', 'success');
    closeModal('modalAgency');
  } catch (err) {
    console.error('Erro reset senha:', err);
    toast('Erro ao atualizar senha', 'error');
  }
}


// ========== 7. FECHAMENTO ==========

pageLoaders.fechamento = async function () {
  try {
    const data = await fetchJSON('/agency/dashboard/fechamentos-agency');
    const tbody = $('tableFechamento').querySelector('tbody');
    tbody.innerHTML = (data || []).map(r => `
      <tr>
        <td>${r.ano}</td>
        <td>${r.mes}</td>
        <td>${money(r.total_bruto)}</td>
        <td>${money(r.total_agencia)}</td>
        <td>${money(r.total_modelo)}</td>
        <td>${money(r.total_bruto_midia)}</td>
        <td>${money(r.total_bruto_assinatura)}</td>
        <td>${fmtDateTime(r.created_at)}</td>
      </tr>
    `).join('') || emptyRow(8);
  } catch (err) { 
    console.error('Erro fechamento:', err); 
    toast('Erro ao carregar fechamentos', 'error');
  }
};

async function criarFechamento() {
  if (!confirm('Criar fechamento para o mês atual?')) return;
  try {
    await postJSON('/agency/dashboard/fechamentos-agency', {});
    toast('Fechamento criado!', 'success');
    pageLoaders.fechamento();
  } catch (err) { 
    toast('Erro: ' + (err.message || 'Não foi possível criar fechamento'), 'error'); 
  }
}

// ========== 8. DADOS BANCÁRIOS ==========

pageLoaders.bancarios = function () {
  carregarBancarios(1);
  $('bancariosFiltro').onchange = () => carregarBancarios(1);
};

async function carregarBancarios(page) {
  try {
    const status = $('bancariosFiltro').value;
    const data = await fetchJSON(`/agency/dashboard/dados-bancarios?page=${page}&limit=20&status=${status}`);
    const tbody = $('tableBancarios').querySelector('tbody');
    tbody.innerHTML = (data.rows || []).map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${r.modelo_nome || 'Modelo #' + r.modelo_id}</td>
        <td>${r.tipo}</td>
        <td>${r.pix_chave || '—'}</td>
        <td>${r.titular_nome}</td>
        <td>${badgeStatus(r.status)}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="editarBancario(${r.id})">Editar</button>
          ${r.status === 'pendente' ? `
            <button class="btn btn-sm btn-success" onclick="aprovarBancario(${r.id})">Aprovar</button>
            <button class="btn btn-sm btn-danger" onclick="rejeitarBancario(${r.id})">Rejeitar</button>
          ` : ''}
        </td>
      </tr>
    `).join('') || emptyRow(7);
    buildPagination('paginationBancarios', page, data.totalPages || 1, 'carregarBancarios');
  } catch (err) { console.error('Erro bancários:', err); }
}

async function aprovarBancario(id) {
  try {
    await putJSON('/agency/dashboard/dados-bancarios/' + id, { status: 'aprovado' });
    toast('Dados bancários aprovados!', 'success');
    carregarBancarios(1);
  } catch (err) { toast('Erro: ' + err.message, 'error'); }
}

async function rejeitarBancario(id) {
  const motivo = prompt('Motivo da rejeição:');
  if (!motivo) return;
  try {
    await putJSON('/agency/dashboard/dados-bancarios/' + id, { status: 'rejeitado', motivo_rejeicao: motivo });
    toast('Dados bancários rejeitados', 'success');
    carregarBancarios(1);
  } catch (err) { toast('Erro: ' + err.message, 'error'); }
}

async function editarBancario(id) {
  try {
    const data = await fetchJSON('/agency/dashboard/dados-bancarios/' + id);
    openEditModal('Editar Dados Bancários', '/agency/dashboard/dados-bancarios/' + id, 'PUT', [
      { name: 'tipo', label: 'Tipo', value: data.tipo },
      { name: 'pix_tipo', label: 'Tipo PIX', value: data.pix_tipo },
      { name: 'pix_chave', label: 'Chave PIX', value: data.pix_chave },
      { name: 'banco', label: 'Banco', value: data.banco },
      { name: 'agencia', label: 'Agência', value: data.agencia },
      { name: 'conta', label: 'Conta', value: data.conta },
      { name: 'titular_nome', label: 'Titular Nome', value: data.titular_nome },
      { name: 'titular_documento', label: 'Titular Documento', value: data.titular_documento },
      { name: 'status', label: 'Status', type: 'select', value: data.status, options: ['pendente', 'aprovado', 'rejeitado'] }
    ], () => carregarBancarios(1));
  } catch (err) { toast('Erro: ' + err.message, 'error'); }
}

// ========== 9. MODELOS ==========

let modelosSearchTimeout;

pageLoaders.modelos = function () {
  carregarModelos(1);
  $('modelosBusca').oninput = () => {
    clearTimeout(modelosSearchTimeout);
    modelosSearchTimeout = setTimeout(() => carregarModelos(1), 400);
  };
};

async function carregarModelos(page) {
  try {
    const busca = $('modelosBusca').value;
    const data = await fetchJSON(`/agency/dashboard/modelos?page=${page}&limit=20&busca=${encodeURIComponent(busca)}`);
    const tbody = $('tableModelos').querySelector('tbody');
    tbody.innerHTML = (data.rows || []).map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${r.nome}</td>
        <td>${r.email || '—'}</td>
        <td>${r.verificada ? '<span class="badge badge-success">Sim</span>' : '<span class="badge badge-muted">Não</span>'}</td>
        <td>${r.feed ? '<span class="badge badge-success">Sim</span>' : '<span class="badge badge-muted">Não</span>'}</td>
        <td>${r.agencia_nome || '—'}</td>
        <td>
          <button class="btn btn-sm btn-primary" onclick="editarModelo(${r.id})">Editar</button>
          <button class="btn btn-sm btn-ghost" onclick="verDadosModelo(${r.id})">Dados</button>
        </td>
      </tr>
    `).join('') || emptyRow(7);
    buildPagination('paginationModelos', page, data.totalPages || 1, 'carregarModelos');
  } catch (err) { console.error('Erro modelos:', err); }
}

async function editarModelo(id) {
  try {
    const [data, agencias] = await Promise.all([
      fetchJSON('/agency/dashboard/modelos/' + id),
    ]);

    openEditModal('Editar Modelo #' + id, '/agency/dashboard/modelos/' + id, 'PUT', [
      { name: 'nome', label: 'Nome', value: data.nome || '' },
      { name: 'nome_exibicao', label: 'Nome Exibição', value: data.nome_exibicao || '' },
      { name: 'bio', label: 'Bio', type: 'textarea', value: data.bio || '' },
      { name: 'local', label: 'Local', value: data.local || '' },
      { name: 'created_at_view', label: 'Criado em', value: fmtDateTime(data.created_at), disabled: true},
      { name: 'ativo', label: 'Ativo', type: 'checkbox', value: !!data.ativo }
    ], () => carregarModelos(1));
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function verDadosModelo(id) {
  try {
    const data = await fetchJSON('/agency/dashboard/modelos-dados/' + id);
    openEditModal('Dados do Modelo #' + id, '/agency/dashboard/modelos-dados/' + id, 'PUT', [
      { name: 'nome_completo', label: 'Nome Completo', value: data.nome_completo },
      { name: 'data_nascimento', label: 'Nascimento', type: 'date', value: data.data_nascimento },
      { name: 'telefone', label: 'Telefone', value: data.telefone },
      { name: 'endereco', label: 'Endereço', value: data.endereco },
      { name: 'pais', label: 'País', value: data.pais },
      { name: 'estado', label: 'Estado', value: data.estado },
      { name: 'cidade', label: 'Cidade', value: data.cidade },
      { name: 'instagram', label: 'Instagram', value: data.instagram },
      { name: 'tiktok', label: 'TikTok', value: data.tiktok },
      { name: 'vip_preco', label: 'Preço VIP', type: 'number', value: data.vip_preco }
    ], () => carregarModelos(1));
  } catch (err) { toast('Erro: ' + err.message, 'error'); }
}

// ========== 10. RANKING ==========

let chartRanking;

pageLoaders.ranking = async function () {
  populateMonthSelect($('rankingMes'));
  await carregarRanking();

  $('rankingMes').onchange = carregarRanking;
};

async function carregarRanking() {
  try {
    const mes = $('rankingMes')?.value || '';
    const url = mes
      ? `/agency/dashboard/ranking?mes=${encodeURIComponent(mes)}`
      : '/agency/dashboard/ranking';

    const data = await fetchJSON(url);

    const tbody = $('tableRanking').querySelector('tbody');
    tbody.innerHTML = (data || []).map((r, i) => `
      <tr>
        <td><strong>${i + 1}</strong></td>
        <td>${r.nome || 'Modelo #' + r.modelo_id}</td>
        <td>${money(r.ganhos_total)}</td>
        <td>${money(r.ganhos_agencia)}</td>
        <td>${fmtDateTime(r.atualizado_em)}</td>
      </tr>
    `).join('') || emptyRow(5);

    const top10 = (data || []).slice(0, 10);

    if (chartRanking) chartRanking.destroy();

    chartRanking = new Chart($('chartRanking'), {
      type: 'bar',
      data: {
        labels: top10.map(r => r.nome || '#' + r.modelo_id),
        datasets: [{
          label: 'Ganhos do mês',
          data: top10.map(r => Number(r.ganhos_total || 0)),
          backgroundColor: 'rgba(123,44,255,0.7)',
          borderRadius: 6
        }]
      },
      options: {
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true }
        }
      }
    });
  } catch (err) {
    console.error('Erro ranking:', err);
  }
}

// ========== 15. PAGAMENTOS ==========

pageLoaders['pagamentos-agencia'] = async function () {
  await carregarSaldoAgenciaGeral();
  await carregarPagAgencia(1);
};

async function carregarSaldoAgenciaGeral() {
  try {
    const data = await fetchJSON('/agency/dashboard/agencia-pagamentos/saldo');
    $('saldoAgenciaGeral').textContent = money(data.saldo || 0);
  } catch (err) {
    console.error('Erro saldo agência:', err);
    $('saldoAgenciaGeral').textContent = '—';
  }
}

async function carregarPagAgencia(page) {
  try {
    const data = await fetchJSON(
      `/agency/dashboard/agencia-pagamentos?page=${page}&limit=20`
    );

    const tbody = $('tablePagAgencia').querySelector('tbody');

    tbody.innerHTML = (data.rows || []).map(r => `
      <tr>
        <td>${r.id}</td>
        <td>${fmtDate(r.mes)}</td>
        <td>${money(r.total_bruto)}</td>
        <td>${money(r.total_agencia)}</td>
        <td>${money(r.total_modelos)}</td>
        <td>${badgeStatus(r.status)}</td>
        <td>${fmtDateTime(r.pago_em)}</td>
        <td>
          ${r.recibo_signed_url
            ? `<a href="${r.recibo_signed_url}" target="_blank" class="btn btn-sm btn-ghost">Comprovativo</a>`
            : `<span class="badge badge-muted">Sem comprovativo</span>`}

          ${r.status !== 'pago'
            ? `<button class="btn btn-sm btn-success" onclick="marcarPagAgenciaPago(${r.id})">Marcar Recebido</button>`
            : ''}

          <button class="btn btn-sm btn-primary" onclick="editarPagAgencia(${r.id})">Editar</button>
        </td>
      </tr>
    `).join('') || emptyRow(8);

    buildPagination('paginationPagAgencia', page, data.totalPages || 1, 'carregarPagAgencia');
  } catch (err) {
    console.error('Erro pgto agência:', err);
  }
}

async function carregarSaldoPagAgencia() {
  try {
    const data = await fetchJSON('/agency/dashboard/agencia-pagamentos/saldo');
    $('saldoDisponivelPagAgencia').textContent = money(data.saldo);
  } catch (err) {
    console.error('Erro saldo pgto agência:', err);
    $('saldoDisponivelPagAgencia').textContent = '—';
  }
}

function atualizarTotalPagAgencia() {
  const bruto = Number($('pagamentoTotalBruto').value || 0);
  const agencia = Number($('pagamentoTotalAgencia').value || 0);
  $('pagamentoTotalModelos').value = (bruto - agencia).toFixed(2);
}

async function salvarPagAgencia(e) {
  e.preventDefault();

  try {
    const form = $('formPagAgencia');
    const formData = new FormData(form);

    const bruto = Number(formData.get('total_bruto') || 0);
    const agencia = Number(formData.get('total_agencia') || 0);
    const modelos = bruto - agencia;

    if (modelos < 0) {
      toast('Comissão da agência não pode ser maior que o total bruto', 'error');
      return;
    }

    formData.set('total_modelos', modelos);

    const resSaldo = await fetchJSON('/agency/dashboard/agencia-pagamentos/saldo');

    if (agencia > Number(resSaldo.saldo || 0)) {
      toast(`Saldo insuficiente. Disponível: ${money(resSaldo.saldo)}`, 'error');
      return;
    }

    const res = await authFetch('/agency/dashboard/agencia-pagamentos', {
      method: 'POST',
      body: formData
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.erro || data.message || `HTTP ${res.status}`);
    }

    toast('Recebimento registrado!', 'success');
    closeAllModals();
    form.reset();
    carregarSaldoAgenciaGeral();
    carregarPagAgencia(1);
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function editarPagAgencia(id) {
  try {
    const data = await fetchJSON('/agency/dashboard/agencia-pagamentos/' + id);
    openEditModal('Editar Recebimento #' + id, '/agency/dashboard/agencia-pagamentos/' + id, 'PUT', [
      { name: 'total_bruto', label: 'Total Bruto', type: 'number', value: data.total_bruto },
      { name: 'total_agencia', label: 'Comissão Agência', type: 'number', value: data.total_agencia },
      { name: 'total_modelos', label: 'Total Modelos', type: 'number', value: data.total_modelos },
      { name: 'status', label: 'Status', type: 'select', value: data.status, options: ['pendente', 'pago'] },
      { name: 'recibo_url', label: 'Recibo URL', value: data.recibo_url || '' }
    ], () => {
      carregarSaldoAgenciaGeral();
      carregarPagAgencia(1);
    });
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function marcarPagAgenciaPago(id) {
  if (!confirm('Confirmar este recebimento como pago?')) return;

  try {
    await postJSON(`/agency/dashboard/agencia-pagamentos/${id}/pagar`, {});
    toast('Recebimento marcado como pago!', 'success');
    carregarSaldoAgenciaGeral();
    carregarPagAgencia(1);
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function abrirModalPagAgencia() {
  await carregarSaldoPagAgencia();
  $('formPagAgencia').reset();
  openModal('modalPagAgencia');
}


// ========== GENERIC EDIT MODAL ==========

let editCallback = null;
let editUrl = '';
let editMethod = 'PUT';

function openEditModal(title, url, method, fields, callback) {
  editUrl = url;
  editMethod = method;
  editCallback = callback;

  $('modalEditTitle').textContent = title;
  const container = $('modalEditFields');

  function escapeHtml(v) {
    return String(v ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function formatDate(v) {
    if (!v) return '';
    try {
      return new Date(v).toISOString().split('T')[0];
    } catch {
      return '';
    }
  }

  container.innerHTML = fields.map(f => {
    const disabled = f.disabled ? 'disabled' : '';
    const required = f.required ? 'required' : '';

    // ✔️ CHECKBOX
    if (f.type === 'checkbox') {
      return `<label class="checkbox-label">
        <input type="checkbox" name="${f.name}" ${f.value ? 'checked' : ''} ${disabled}>
        ${f.label}
      </label>`;
    }

    // ✔️ TEXTAREA
    if (f.type === 'textarea') {
      return `<label>${f.label}
        <textarea name="${f.name}" ${disabled} ${required}>${escapeHtml(f.value)}</textarea>
      </label>`;
    }

    // ✔️ SELECT
    if (f.type === 'select') {
      return `<label>${f.label}
        <select name="${f.name}" ${disabled} ${required}>
          ${(f.options || []).map(o => {
            const val = typeof o === 'object' ? o.value : o;
            const label = typeof o === 'object' ? o.label : o;
            return `<option value="${escapeHtml(val)}"
              ${String(val) === String(f.value ?? '') ? 'selected' : ''}>
              ${escapeHtml(label)}
            </option>`;
          }).join('')}
        </select>
      </label>`;
    }

    // ✔️ DATE FIX (CRÍTICO)
    let value = f.value ?? '';
    if (f.type === 'date') {
      value = formatDate(value);
    }

    // ✔️ NUMBER STEP DINÂMICO
    let step = '';
    if (f.type === 'number') {
      step = f.step ? `step="${f.step}"` : 'step="any"';
    }

    return `<label>${f.label}
      <input
        type="${f.type || 'text'}"
        name="${f.name}"
        value="${escapeHtml(value)}"
        ${step}
        ${disabled}
        ${required}
      >
    </label>`;
  }).join('');

  openModal('modalEdit');
}

async function salvarEdicao(e) {
  e.preventDefault();
  const form = new FormData(e.target);
  const body = {};

  const container = $('modalEditFields');
  container.querySelectorAll('input, textarea, select').forEach(el => {
    if (el.type === 'checkbox') {
      body[el.name] = el.checked;
    } else if (el.type === 'number') {
      body[el.name] = el.value ? Number(el.value) : null;
    } else {
      body[el.name] = el.value || null;
    }
  });

  console.log('body enviado:', body);

  try {
    if (editMethod === 'PUT') {
      await putJSON(editUrl, body);
    } else {
      await postJSON(editUrl, body);
    }
    toast('Salvo com sucesso!', 'success');
    closeAllModals();
    if (editCallback) editCallback();
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

// ========== INIT ==========

document.addEventListener('DOMContentLoaded', () => {
  if (!token) {
    window.location.href = '/agency/login';
    return;
  }

  document.getElementById('inputPercentualAgencia')?.addEventListener('input', atualizarSoma);
  document.getElementById('inputPercentualModelo')?.addEventListener('input', atualizarSoma);

  pageLoaders.overview();
});
