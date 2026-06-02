// AUTH
async function register() {
  const email = document.getElementById("email").value;
  const senha = document.getElementById("senha").value;
  const role = document.getElementById("role").value;

  try {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
  email,
  password: senha
    })
  });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Erro no registro");
      return;
    }

    alert("Registrado com sucesso");
  } catch (err) {
    console.error(err);
    alert("Erro de conexão");
  }
}

async function login() {
  const emailInput = document.getElementById("email");
  const senhaInput = document.getElementById("senha");

  if (!emailInput || !senhaInput) {
    alert("Erro interno: campos de login não encontrados");
    console.error("Inputs não encontrados:", {
      email: emailInput,
      senha: senhaInput
    });
    return;
  }

  const email = emailInput.value.trim();
  const senha = senhaInput.value.trim();

  if (!email || !senha) {
    alert("Preencha email e senha");
    return;
  }

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
  email, senha
})
  });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Login inválido");
      return;
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("role", data.role);

    console.log("REDIRECT AGORA");
    window.location.replace("/app/inbox.html");

  } catch (err) {
    console.error("ERRO LOGIN:", err);
    alert("Erro de conexão");
  }
}

