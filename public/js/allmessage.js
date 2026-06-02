let paginaConteudos = 1;
const limiteConteudos = 9;
let carregandoConteudos = false;
let fimConteudos = false;
let conteudosSelecionados = new Set();

const observerLazy = new IntersectionObserver(entries=>{

  entries.forEach(entry=>{

    if(!entry.isIntersecting) return;

    const img = entry.target;
    const src = img.dataset.src;

    if(src){
      img.src = src;
      img.removeAttribute("data-src");
    }

    observerLazy.unobserve(img);

  });

},{
  rootMargin:"200px"
});


document.addEventListener("DOMContentLoaded", async () => {
  await carregarModelo();

  document
    .getElementById("btnAbrirConteudos")
    ?.addEventListener("click", abrirPopupConteudos);

  document
    .getElementById("btnConfirmarConteudos")
    ?.addEventListener("click", confirmarConteudosSelecionados);

  document
    .getElementById("btnFecharConteudos")
    ?.addEventListener("click", fecharPopupConteudos);

  document
    .getElementById("btnEnviar")
    ?.addEventListener("click", () => enviar(false));

  const grid = document.getElementById("conteudosGrid");

  if(grid){

grid.addEventListener("scroll", async () => {
  const nearBottom =
    grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 150;

  if (nearBottom && !carregandoConteudos && !fimConteudos) {
    await carregarConteudos();
  }
});

  }

});


function fecharPopupConteudos() {
  const popup = document.getElementById("popupConteudos");
  if (!popup) return;

  popup.classList.add("hidden");
}

// ===============================
// MODELO LOGADO
// ===============================
async function carregarModelo() {
  const token = localStorage.getItem("token");

  const res = await fetch("/api/modelo/me", {
    headers: { Authorization: "Bearer " + token }
  });

  const modelo = await res.json();

  document.getElementById("modeloSelect").innerHTML = `
    <option value="${modelo.id}">
      ${modelo.nome_exibicao || t("allmessage.modelo_padrao")}
    </option>
  `;
}

// ===============================
// CONTEÚDOS DA MODELO
// ===============================
async function abrirPopupConteudos() {
  const popup = document.getElementById("popupConteudos");
  const grid  = document.getElementById("conteudosGrid");

  if (!popup || !grid) return;

  popup.classList.remove("hidden");

  // reset estado
  paginaConteudos = 1;
  fimConteudos = false;
  carregandoConteudos = false;
  conteudosSelecionados.clear();
  atualizarContadorMidias();

  grid.innerHTML = "";

  // carrega primeira página
  await carregarConteudos();

  // se ainda não criou scroll, continua carregando
  while (!fimConteudos && grid.scrollHeight <= grid.clientHeight) {
    await carregarConteudos();
  }
}

// ===============================
// MOSTRAR SELECIONADOS
// ===============================
function renderizarSelecionados() {
  const container = document.getElementById("conteudosSelecionados");

  const selecionados = Array.from(
    document.querySelectorAll("#conteudosGrid input:checked")
  );

  container.innerHTML = "";

  selecionados.forEach(input => {
    const img = input.nextElementSibling.cloneNode();
    container.appendChild(img);
  });
}

async function enviar(modoTeste) {
  const modelo_id = document.getElementById("modeloSelect").value;
  const texto = document.getElementById("mensagem").value.trim();
  const preco = Number(document.getElementById("preco").value || 0);
  const conteudos = [...conteudosSelecionados];

  if (!texto) {
    alert(t("allmessage.erro_mensagem_vazia"));
    return;
  }

  if (!modoTeste) {
   const ok = confirm(t("allmessage.confirm_enviar_todos"));
    if (!ok) return;
  }

  const payload = {
    modelo_id,
    texto,
    preco,
    conteudos,
    modo_teste: modoTeste
  };

  try {
    abrirPopupEnvioPPV();

    const res = await fetch("/api/allmessage", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + localStorage.getItem("token")
      },
      body: JSON.stringify(payload)
    });

const data = await parseJsonSafe(res);

if (!res.ok) {
  fecharPopupEnvioPPV();
  alert(data?.error || t("allmessage.erro_iniciar_envio"));
  return;
}

    const jobId = data.jobId;

    if (!jobId) {
      fecharPopupEnvioPPV();
     alert(t("allmessage.erro_sem_job"));
      return;
    }

    await acompanharProgressoEnvio(jobId, modoTeste);

  } catch (err) {
    console.error(err);
    fecharPopupEnvioPPV();
    alert(t("allmessage.erro_enviar"));
  }
}

function confirmarConteudosSelecionados(){

  const container = document.getElementById("conteudosSelecionados");
  container.innerHTML = "";

  if(conteudosSelecionados.size === 0){
    container.innerHTML =
   `<span style='opacity:.6'>${t("allmessage.nenhuma_midia")}</span>`
    fecharPopupConteudos();
    return;
  }

  conteudosSelecionados.forEach(id=>{

    const el = document.querySelector(
      `.preview-item[data-conteudo-id="${id}"] img`
    );

    if(!el) return;

    const img = el.cloneNode(true);

    img.style.width = "70px";
    img.style.height = "90px";
    img.style.objectFit = "cover";
    img.style.borderRadius = "8px";
    img.style.border = "2px solid #7B2CFF";

    container.appendChild(img);

  });

  fecharPopupConteudos();
}

async function carregarConteudos(){

  if(carregandoConteudos || fimConteudos) return;

  carregandoConteudos = true;

  const grid = document.getElementById("conteudosGrid");
  const token = localStorage.getItem("token");

  try{

    const res = await fetch(
      `/api/conteudos?venda=true&page=${paginaConteudos}&limit=${limiteConteudos}`,
      {
        headers:{
          Authorization:"Bearer "+token
        }
      }
    );

    if(!res.ok){
      console.error("Erro ao carregar conteúdos");
      carregandoConteudos = false;
      return;
    }

    const data = await res.json();
    const conteudos = data.conteudos || [];

    if(conteudos.length === 0){
      fimConteudos = true;
      carregandoConteudos = false;
      return;
    }

    conteudos.forEach(c=>{

      const item = document.createElement("div");
      item.className = "preview-item";
      item.dataset.conteudoId = c.id;

      if(c.tipo === "video"){
        item.classList.add("video");
      }

      const thumb = c.thumbnail_url || c.url;

      // placeholder para lazy load
      const img = document.createElement("img");
      img.dataset.src = thumb;
      img.loading = "lazy";

      item.appendChild(img);

      // restaurar seleção se já estava selecionado
      const id = Number(c.id);
      if(conteudosSelecionados.has(id)){
        item.classList.add("selected");
      }

      item.onclick = ()=>{

  if(conteudosSelecionados.has(id)){
    conteudosSelecionados.delete(id);
    item.classList.remove("selected");
  }else{
    conteudosSelecionados.add(id);
    item.classList.add("selected");
  }

  atualizarContadorMidias();

};

      grid.appendChild(item);

      observerLazy.observe(img);

    });

    paginaConteudos++;

  }catch(err){
    console.error(err);
  }

  carregandoConteudos = false;
}

function atualizarContadorMidias(){

  const contador = document.getElementById("contadorSelecionados");
  if(!contador) return;

contador.textContent = t("allmessage.contador_dinamico")
  .replace("{count}", conteudosSelecionados.size);

}

function abrirPopupEnvioPPV() {
  document.getElementById("popupEnvioPPV")?.classList.remove("hidden");
  atualizarProgressoEnvio({
    percentual: 0,
   texto: t("allmessage.status_preparando")
  });
}

function fecharPopupEnvioPPV() {
  document.getElementById("popupEnvioPPV")?.classList.add("hidden");
}

function atualizarProgressoEnvio({ percentual = 0, texto = "" }) {
  const fill = document.getElementById("barraProgressoFill");
  const percentualEl = document.getElementById("statusEnvioPercentual");
  const textoEl = document.getElementById("statusEnvioTexto");

  if (fill) fill.style.width = `${percentual}%`;
  if (percentualEl) percentualEl.textContent = `${percentual}%`;
  if (textoEl) textoEl.textContent = texto;
}

async function acompanharProgressoEnvio(jobId, modoTeste) {
  let concluido = false;

  while (!concluido) {
    await new Promise(resolve => setTimeout(resolve, 1200));

    const res = await fetch(`/api/allmessage/status/${jobId}`, {
      headers: {
        Authorization: "Bearer " + localStorage.getItem("token")
      }
    });

const data = await parseJsonSafe(res);

if (!res.ok) {
  fecharPopupEnvioPPV();
  alert(data?.error || t("allmessage.erro_progresso"));
  return;
}

    const total = Number(data.total || 0);
    const processados = Number(data.processados || 0);
    const enviados = Number(data.enviados || 0);
    const falhas = Number(data.falhas || 0);

    const percentual = total > 0
      ? Math.min(100, Math.round((processados / total) * 100))
      : 0;

    atualizarProgressoEnvio({
      percentual,
     texto: t("allmessage.status_enviando")
     .replace("{processados}", processados)
     .replace("{total}", total)
     .replace("{enviados}", enviados)
     .replace("{falhas}", falhas)
    });

    if (data.status === "concluido") {
      atualizarProgressoEnvio({
        percentual: 100,
       texto: t("allmessage.status_sucesso")
       .replace("{enviados}", enviados)
      });

      await new Promise(resolve => setTimeout(resolve, 900));
      fecharPopupEnvioPPV();

      alert(
        modoTeste
        ? t("allmessage.sucesso_teste")
       : t("allmessage.sucesso_envio").replace("{enviados}", enviados)
      );

      window.location.reload();
      concluido = true;
    }

    if (data.status === "erro") {
      fecharPopupEnvioPPV();
      alert(data.error || t("allmessage.erro_durante_envio"));
      return;
    }
  }
}

async function parseJsonSafe(res) {
  const text = await res.text();

  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}