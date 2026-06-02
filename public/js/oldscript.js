// ===============================
// INDEX — SCRIPT LIMPO (VELVET)
// ===============================

// 🔁 REDIRECIONAMENTO SE LOGADO
const token = localStorage.getItem("token");
const role  = localStorage.getItem("role");

if (token && role) {
  window.location.href =
    role === "modelo" ? "/chat-app.html" : "/chat-app.html";
}

const isApp =
  window.matchMedia("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

if (isApp) {
  document.body.classList.add("is-app");
}

// ===============================
// PWA INSTALL HANDLER (SEM DOM)
// ===============================
let deferredPrompt = null;

window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log("📲 PWA disponível para instalação");
});

// função global para disparar instalação
window.installPWA = async function () {
  if (!deferredPrompt) {
    alert("Instalação indisponível neste dispositivo");
    return;
  }

  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
};

// ===============================
// ESTADO GLOBAL
// ===============================
let modalMode = "login"; 
let pendingAction = null; 

// ===============================
// AGE GATE
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

function confirmAge(isAdult) {
  if (!isAdult) {
    alert("Você precisa ter 18 anos ou mais para acessar a Plataforma.");
    
    document.getElementById("ageModal")?.classList.add("hidden");
    window.location.href = "/index.html";
    return;
  }

  localStorage.setItem("ageConfirmed", "true");
  document.getElementById("ageModal")?.classList.add("hidden");
  proceedAfterAge();
}

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

function closeAllModals() {
  document.getElementById("loginModal")?.classList.add("hidden");
  document.getElementById("legalModal")?.classList.add("hidden");
  document.getElementById("ageModal")?.classList.add("hidden");
}


// ===============================
// MODAL LOGIN / REGISTER
// ===============================
window.selectRole = function () {
  openLoginModal();
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
  const title = document.getElementById("modalTitle");
  const submit = document.getElementById("modalSubmit");
  const roleSelect = document.getElementById("registerRole");
  const switchLogin = document.getElementById("switchToLogin");
  const switchRegister = document.querySelector(".modal-switch");

  if (modalMode === "login") {
    title.textContent = "Entrar";
    submit.textContent = "Entrar";
    submit.onclick = login;
    roleSelect.classList.add("hidden");
    switchRegister.classList.remove("hidden");
    switchLogin.classList.add("hidden");
  } else {
    title.textContent = "Criar Conta";
    submit.textContent = "Criar conta";
    submit.onclick = register;
    roleSelect.classList.remove("hidden");
    switchRegister.classList.add("hidden");
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
  if (!res.ok) return alert(data.erro);

  localStorage.setItem("token", data.token);
  localStorage.setItem("role", data.role);

  if (data.role === "modelo") {
  window.location.href = "/chat-app.html";
  return;
}
// 🔥 CLIENTE
const ref = localStorage.getItem("ref_modelo");

if (ref) {
  // simula clique no feed
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

  // 🔹 PEGA A ORIGEM DO CLIENTE (já salva no index.html)
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

      ref,   // modelo que trouxe
      src    // instagram / tiktok
    })
  });

  const data = await res.json();
  if (!res.ok) return alert(data.erro);

  alert("Conta criada com sucesso! Faça login.");
  switchToLogin();
}

// ===============================
// MODAL LEGAL (TERMOS / POLÍTICAS)
// ===============================
window.openLegalModal = function (event, url) {
  event.preventDefault();

  closeAllModals();

  const modal = document.getElementById("legalModal");
  const iframe = document.getElementById("modalFrame");

  if (!modal || !iframe) {
    console.error("❌ Modal legal não encontrado no DOM");
    return;
  }

  iframe.src = url;
  modal.classList.remove("hidden");
};

window.closeLegalModal = function () {
  const modal = document.getElementById("legalModal");
  const iframe = document.getElementById("modalFrame");

  if (iframe) iframe.src = "";
  if (modal) modal.classList.add("hidden");
};



window.logout = function () {
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("ageConfirmed"); 
  window.location.href = "https://www.velvet.lat";
};