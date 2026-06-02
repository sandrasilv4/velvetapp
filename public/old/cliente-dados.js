// ===============================
// AUTH GUARD 
// ===============================
const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

if (!token) {
  window.location.href = "/index.html";
  throw new Error("Sem token");
}

function logout() {
  localStorage.clear();
  window.location.href = "/index.html";
}

async function carregarDadosCliente() {
  const res = await fetch("/api/cliente/dados", {
    headers: {
      Authorization: "Bearer " + localStorage.getItem("token")
    }
  });

  if (!res.ok) return;

  const dados = await res.json();
  if (!dados) return;

  document.getElementById("username").value = dados.username || "";
  document.getElementById("nomeCompleto").value = dados.nome_completo || "";
  document.getElementById("dataNascimento").value =
    dados.data_nascimento
      ? dados.data_nascimento.split("T")[0]
      : "";
  document.getElementById("pais").value = dados.pais || "";

  const avatar = document.getElementById("avatarPreview");

if (dados.avatar) {
  avatar.src = dados.avatar;
}

avatar.onerror = () => {
  avatar.src = "/assets/avatarDefault.png";
};

}


const form = document.getElementById("dadosForm");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const dataNascimento = new Date(
    document.getElementById("dataNascimento").value
  );

  const hoje = new Date();
  const idade =
    hoje.getFullYear() - dataNascimento.getFullYear();

  if (idade < 18) {
    alert("Você precisa ter mais de 18 anos.");
    return;
  }

  const payload = {
    username: document.getElementById("username").value,
    nome_completo: document.getElementById("nomeCompleto").value,
    data_nascimento: document.getElementById("dataNascimento").value,
    pais: document.getElementById("pais").value,
  };

  const res = await fetch("/api/cliente/dados", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + localStorage.getItem("token")
    },
    body: JSON.stringify(payload)
  });

  if (res.ok) {
  localStorage.setItem(
    "username",
    document.getElementById("username").value
  );

  alert("Dados salvos com sucesso!");
}
 else {
    alert("Erro ao salvar dados");
  }
});

const inputAvatar = document.getElementById("inputAvatar");
const avatarPreview = document.getElementById("avatarPreview");

if (inputAvatar) {
  inputAvatar.addEventListener("change", async () => {
    const file = inputAvatar.files[0];
    if (!file) return;

    const fd = new FormData();
    fd.append("avatar", file);

    const res = await fetch("/api/cliente/avatar", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + localStorage.getItem("token")
      },
      body: fd
    });

    const data = await res.json();

    if (data.url) {
      avatarPreview.src = data.url;
    } else {
      alert("Erro ao atualizar foto, preencha suas informações primeiro");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  carregarDadosCliente();
});

async function confirmarExclusaoConta() {
  const token = localStorage.getItem("token");
  const senha = document.getElementById("senhaConfirmacao").value;
  const erro = document.getElementById("erroExclusao");

  erro.classList.add("hidden");

  if (!senha || senha.length < 4) {
    erro.textContent = "Digite sua senha para continuar.";
    erro.classList.remove("hidden");
    return;
  }

  try {
    const res = await fetch("/api/conta/excluir", {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify({ senha })
    });

    if (res.ok) {
      localStorage.clear();
      window.location.href = "/index.html";
    } else {
      erro.textContent = "Senha incorreta.";
      erro.classList.remove("hidden");
    }

  } catch (err) {
    erro.textContent = "Erro de conexão.";
    erro.classList.remove("hidden");
  }
}

function abrirConfirmacaoExclusao() {
  const modal = document.getElementById("modalExcluirConta");
  if (modal) {
    modal.classList.remove("hidden");
  }
}

function fecharModalExclusao() {
  const modal = document.getElementById("modalExcluirConta");
  if (modal) {
    modal.classList.add("hidden");
  }

  // limpa campo e erro ao fechar
  const senhaInput = document.getElementById("senhaConfirmacao");
  const erro = document.getElementById("erroExclusao");

  if (senhaInput) senhaInput.value = "";
  if (erro) erro.classList.add("hidden");
}




