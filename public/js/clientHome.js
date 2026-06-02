// ===============================
// AUTH GUARD — CLIENT HOME
// ===============================
const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

if (!token) {
  window.location.href = "/index.html";
  throw new Error("Sem token");
}


async function logout() {
  const token = localStorage.getItem("token");
  if (token) {
    try { await fetch("/api/logout", { method: "POST", headers: { Authorization: "Bearer " + token } }); } catch (_) {}
  }
  localStorage.clear();
  window.location.href = "https://www.velvet.lat";
}

document.addEventListener("DOMContentLoaded", () => {
  const lista = document.getElementById("listaModelos");
  const token = localStorage.getItem("token");

  if (!lista) {
    console.error("❌ listaModelos não encontrada no DOM");
    return;
  }

  if (!token) {
    console.error("❌ Token ausente");
    window.location.href = "/index.html";
    return;
  }

  fetch("/api/feed/modelos", {
    headers: {
      Authorization: "Bearer " + token
    }
  })
    .then(res => {
      if (!res.ok) {
        throw new Error("Erro ao carregar feed de modelos");
      }
      return res.json();
    })
    .then(modelos => {
      console.log("📥 Modelos recebidos:", modelos);

      lista.innerHTML = "";

      if (!Array.isArray(modelos) || modelos.length === 0) {
        lista.innerHTML = "<p>Nenhuma modelo disponível</p>";
        return;
      }

      modelos.forEach(modelo => {
        const card = document.createElement("div");
        card.className = "modelItem";

        card.innerHTML = `
          <img
            src="${modelo.avatar || "/assets/avatarDefault.png"}"
            alt="${modelo.nome || "Modelo"}">
        `;

        card.addEventListener("click", () => {
          // 🔑 contrato de ID (backend antigo ou novo)
          const modeloId = modelo.id ?? modelo.user_id;

          if (!modeloId) {
            console.error("❌ Modelo sem id:", modelo);
            alert("Erro ao abrir perfil da modelo.");
            return;
          }

          localStorage.setItem("modelo_id", modeloId.toString());
          window.location.href = `profile.html?id=${modeloId}`;
        });

        // ➕ adiciona o card ao DOM
        lista.appendChild(card);
      });
    })
    .catch(err => {
      console.error("❌ Erro no feed de modelos:", err);
      lista.innerHTML = "<p>Erro ao carregar modelos</p>";
    });
});
