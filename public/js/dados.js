document.addEventListener("DOMContentLoaded", async () => {
  await whenI18nReady();
  const token = localStorage.getItem("token");
  if (!token) return;

  // 1️⃣ Descobrir role
  const resUser = await fetch("/api/me", {
    headers: { Authorization: "Bearer " + token }
  });

  if (!resUser.ok) return;

  const user = await resUser.json();
  const role = user.role;

  let verificada = false;
  let perfilId = null;

  // 2️⃣ Se for modelo
  if (role === "modelo") {

    const resModelo = await fetch("/api/modelo/me", {
      headers: { Authorization: "Bearer " + token }
    });

    if (!resModelo.ok) return;

    const modelo = await resModelo.json();
    verificada = modelo.verificada;
    perfilId = modelo.modelo_id;
  }

  // 3️⃣ Se for cliente
  if (role === "cliente") {

    const resCliente = await fetch("/api/cliente/me", {
      headers: { Authorization: "Bearer " + token }
    });

    if (!resCliente.ok) return;

    const cliente = await resCliente.json();
    verificada = cliente.verificada;
    perfilId = cliente.cliente_id;
  }

  const btn = document.querySelector(".btn-perfil-completo");
  if (!btn) return;

  btn.addEventListener("click", (e) => {
    e.preventDefault();

    if (!verificada) {
      mostrarAvisoValidacao(role);
      return;
    }

    if (role === "modelo") {
      window.location.href = `/perfil.html?modelo_id=${perfilId}`;
    }

    if (role === "cliente") {
      window.location.href = `/perfil-cliente.html?id=${perfilId}`;
    }
  });

});

function mostrarAvisoValidacao(role) {
  const modal = document.createElement("div");
  modal.className = "modal-validacao";

  modal.innerHTML = `
    <div class="modal-backdrop"></div>
    <div class="modal-box">
      <h3>${t("dados.modal_aviso_titulo")}</h3>
      <p>${t("dados.modal_aviso_desc")}</p>
      <p>
        ${t("dados.modal_aviso_validar")}
        <a href="/conta.html">${t("dados.modal_aviso_link")}</a>.
      </p>
      <button class="btn-fechar">${t("dados.modal_aviso_fechar")}</button>
    </div>
  `;

  modal.querySelector(".modal-backdrop").onclick = () => modal.remove();
  modal.querySelector(".btn-fechar").onclick = () => modal.remove();

  document.body.appendChild(modal);
}