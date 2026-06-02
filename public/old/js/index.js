// ===============================
// INDEX — SCRIPT FINAL (VELVET)
// ===============================

// ===============================
// REDIRECIONAMENTO SE JÁ LOGADO
// ===============================
// const token = localStorage.getItem("token");
// const role  = localStorage.getItem("role");

// // if (token && role) {
// //   if (role === "modelo") {
// //     window.location.href = "/app/inbox.html";
// //   } else {
// //     window.location.href = "/app/inbox.html";
// //   }
// // }

// ===============================
// DETECTA APP / PWA
// ===============================
const isApp =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

if (isApp) {
  document.body.classList.add("is-app");
}

// ===============================
// PWA INSTALL
// ===============================
let deferredPrompt;
const btnInstall = document.getElementById("btnInstallPWA");

// captura evento do browser
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  btnInstall.hidden = false;
});

// clique no botão
btnInstall?.addEventListener("click", async () => {
  if (!deferredPrompt) return;

  deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;

  deferredPrompt = null;
  btnInstall.hidden = true;
});

// ===============================
// ESTADO GLOBAL
// ===============================
let modalMode = "login";       // login | register
let pendingAction = null;     // login | register

// ===============================
// AGE GATE (+18)
// ===============================
function openAgeGate(action) {
  pendingAction = action;

  const confirmed = localStorage.getItem("ageConfirmed");
  if (confirmed === "true") {
    proceedAfterAge();
    return;
  }

  closeAllModals();
  document.getElementById("ageModal")?.classList.remove("hidden");
}

window.confirmAge = function (isAdult) {
  if (!isAdult) {
    alert("Você precisa ter 18 anos ou mais para acessar a plataforma.");
    window.location.href = "/index.html";
    return;
  }

  localStorage.setItem("ageConfirmed", "true");
  document.getElementById("ageModal")?.classList.add("hidden");
  proceedAfterAge();
};

function proceedAfterAge() {
  if (pendingAction === "login") {
    openLoginModal();
  }

  if (pendingAction === "register") {
    openLoginModal();
    setRegisterMode();
  }

  pendingAction = null;
}

// ===============================
// MODAIS (UTIL)
// ===============================
function closeAllModals() {
  document.getElementById("loginModal")?.classList.add("hidden");
  document.getElementById("legalModal")?.classList.add("hidden");
  document.getElementById("ageModal")?.classList.add("hidden");
}

// ===============================
// LOGIN / REGISTER MODAL
// ===============================
window.selectRole = function () {
  openAgeGate("login");
};

window.startRegister = function () {
  openAgeGate("register");
};

function openLoginModal() {
  modalMode = "login";
  updateModal();
  document.getElementById("loginModal")?.classList.remove("hidden");
}

window.closeLoginModal = function () {
  document.getElementById("loginModal")?.classList.add("hidden");
};

function setRegisterMode() {
  modalMode = "register";
  updateModal();
}

window.switchToLogin = function () {
  modalMode = "login";
  updateModal();
};

function updateModal() {
  const title        = document.getElementById("modalTitle");
  const submit       = document.getElementById("modalSubmit");
  const roleSelect   = document.getElementById("registerRole");
  const switchLogin  = document.getElementById("switchToLogin");
  const switchReg    = document.querySelector(".modal-switch");

  if (modalMode === "login") {
    title.textContent = "Entrar";
    submit.textContent = "Entrar";
    submit.onclick = login;

    roleSelect.classList.add("hidden");
    switchReg.classList.remove("hidden");
    switchLogin.classList.add("hidden");
  } else {
    title.textContent = "Criar Conta";
    submit.textContent = "Criar conta";
    submit.onclick = register;

    roleSelect.classList.remove("hidden");
    switchReg.classList.add("hidden");
    switchLogin.classList.remove("hidden");
  }
}

// ===============================
// LOGIN
// ===============================
async function login() {
  const email = loginEmail.value.trim();
  const senha = loginSenha.value.trim();

  if (!email || !senha) {
    alert("Preencha email e senha");
    return;
  }

  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, senha })
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.erro || "Erro ao fazer login");
    return;
  }

  localStorage.setItem("token", data.token);
  localStorage.setItem("role", data.role);

  // MODELO
  if (data.role === "modelo") {
    window.location.href = "/app/inbox.html";
    return;
  }

  // CLIENTE
  const ref = localStorage.getItem("ref_modelo");

  if (ref) {
    localStorage.setItem("modelo_id", ref);
    localStorage.removeItem("ref_modelo");
    window.location.href = "/profile.html";
  } else {
    window.location.href = "/clientHome.html";
  }
}

// ===============================
// REGISTER
// ===============================
function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function register() {
  const email = loginEmail.value.trim();
  const senha = loginSenha.value.trim();
  const role  = registerRole.value;

  if (!email || !senha || !role) {
    alert("Preencha todos os campos");
    return;
  }

  if (!emailValido(email)) {
    alert("Email inválido");
    return;
  }

  const ref = localStorage.getItem("ref_modelo");
  const src = localStorage.getItem("origem_trafego");

  const res = await fetch("/api/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      senha,
      role,
      nome: email.split("@")[0],
      ageConfirmed: true,
      ref,
      src
    })
  });

  const data = await res.json();
  if (!res.ok) {
    alert(data.erro || "Erro ao criar conta");
    return;
  }

  alert("Conta criada com sucesso! Faça login.");
  switchToLogin();
}

// ===============================
// MODAL LEGAL
// ===============================
window.openLegalModal = function (event, url) {
  event.preventDefault();
  closeAllModals();

  const modal  = document.getElementById("legalModal");
  const iframe = document.getElementById("modalFrame");

  if (!modal || !iframe) return;

  iframe.src = url;
  modal.classList.remove("hidden");
};

window.closeLegalModal = function () {
  const modal  = document.getElementById("legalModal");
  const iframe = document.getElementById("modalFrame");

  if (iframe) iframe.src = "";
  if (modal) modal.classList.add("hidden");
};

// ===============================
// LOGOUT (UTIL)
// ===============================
window.logout = function () {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("ageConfirmed");
  window.location.href = "/index.html";
};
