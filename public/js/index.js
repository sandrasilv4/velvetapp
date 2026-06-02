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
let modalMode      = "login";  // login | register
let registerStage  = "email";  // email | otp | form
let otpPreToken    = null;     // token devolvido após verificação OTP
let otpEmail       = null;     // email usado no processo OTP
let pendingAction  = null;     // login | register

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
  modalMode     = "register";
  registerStage = "email";
  otpPreToken   = null;
  otpEmail      = null;
  updateModal();
}

window.switchToLogin = function () {
  modalMode     = "login";
  registerStage = "email";
  otpPreToken   = null;
  otpEmail      = null;
  updateModal();
};

// ── Utilitários de mensagem de erro no modal ──────────────────────────────────
function showModalError(msg) {
  const el = document.getElementById("modalError");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
}
function clearModalError() {
  const el = document.getElementById("modalError");
  if (el) el.style.display = "none";
}
// ──────────────────────────────────────────────────────────────────────────────

function updateModal() {
  const title           = document.getElementById("modalTitle");
  const submit          = document.getElementById("modalSubmit");
  const switchLogin     = document.getElementById("switchToLogin");
  const switchReg       = document.querySelector(".modal-switch");
  const fieldSenhaComum = document.getElementById("fieldSenhaComum");
  const fieldSenha      = document.getElementById("fieldSenha");
  const fieldNome       = document.getElementById("fieldNome");
  const fieldNascimento = document.getElementById("fieldNascimento");
  const fieldPerfil     = document.getElementById("fieldPerfil");
  const fieldOtp        = document.getElementById("fieldOtp");
  const otpInfo         = document.getElementById("otpInfo");
  const otpReenviar     = document.getElementById("otpReenviar");
  const registerLegal   = document.getElementById("registerLegal");
  const emailInput      = document.getElementById("loginEmail");

  clearModalError();

  if (modalMode === "login") {
    title.textContent      = "Entrar";
    submit.textContent     = "Entrar";
    submit.onclick         = login;
    submit.disabled        = false;

    fieldSenhaComum?.classList.remove("hidden");
    fieldSenha?.classList.add("hidden");
    fieldNome?.classList.add("hidden");
    fieldNascimento?.classList.add("hidden");
    fieldPerfil?.classList.add("hidden");
    fieldOtp?.classList.add("hidden");
    registerLegal?.classList.add("hidden");
    switchReg?.classList.remove("hidden");
    switchLogin?.classList.add("hidden");
    emailInput?.removeAttribute("readonly");

  } else {
    // Modo registo — 3 etapas
    switchReg?.classList.add("hidden");
    switchLogin?.classList.remove("hidden");

    if (registerStage === "email") {
      // ── Etapa 1: introduzir email ──────────────────────────────────────────
      title.textContent  = "Criar Conta";
      submit.textContent = "Enviar código de verificação";
      submit.onclick     = enviarOTP;
      submit.disabled    = false;

      fieldSenhaComum?.classList.add("hidden");
      fieldSenha?.classList.add("hidden");
      fieldNome?.classList.add("hidden");
      fieldNascimento?.classList.add("hidden");
      fieldPerfil?.classList.add("hidden");
      fieldOtp?.classList.add("hidden");
      registerLegal?.classList.add("hidden");
      emailInput?.removeAttribute("readonly");

    } else if (registerStage === "otp") {
      // ── Etapa 2: verificar código ──────────────────────────────────────────
      title.textContent  = "Verificar Email";
      submit.textContent = "Verificar código";
      submit.onclick     = verificarOTP;
      submit.disabled    = false;

      fieldSenhaComum?.classList.add("hidden");
      fieldSenha?.classList.add("hidden");
      fieldNome?.classList.add("hidden");
      fieldNascimento?.classList.add("hidden");
      fieldPerfil?.classList.add("hidden");
      fieldOtp?.classList.remove("hidden");
      registerLegal?.classList.add("hidden");
      emailInput?.setAttribute("readonly", "true");

      if (otpInfo && otpEmail) {
        otpInfo.textContent = `📩 Código enviado para ${otpEmail}. Verifica a tua caixa de entrada (e o spam).`;
      }
      if (otpReenviar) otpReenviar.style.display = "block";
      // Focar no input de OTP
      setTimeout(() => document.getElementById("registerOtp")?.focus(), 50);

    } else if (registerStage === "form") {
      // ── Etapa 3: preencher dados e criar conta ─────────────────────────────
      title.textContent  = "Criar Conta";
      submit.textContent = "Criar conta";
      submit.onclick     = register;
      submit.disabled    = false;

      fieldSenhaComum?.classList.remove("hidden");
      fieldSenha?.classList.remove("hidden");
      fieldNome?.classList.remove("hidden");
      fieldNascimento?.classList.remove("hidden");
      fieldPerfil?.classList.remove("hidden");
      fieldOtp?.classList.add("hidden");
      registerLegal?.classList.remove("hidden");
      emailInput?.setAttribute("readonly", "true");
      // Focar no campo de senha
      setTimeout(() => document.getElementById("loginSenha")?.focus(), 50);
    }
  }
}

// ===============================
// LOGIN
// ===============================
async function login() {
  clearModalError();
  const email = document.getElementById("loginEmail").value.trim();
  const senha = document.getElementById("loginSenha").value;

  if (!email || !senha) {
    showModalError("Preenche o email e a senha.");
    return;
  }

  const submit = document.getElementById("modalSubmit");
  submit.disabled    = true;
  submit.textContent = "A entrar...";

  try {
    const res  = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, senha })
    });
    const data = await res.json();

    if (!res.ok) {
      showModalError(data.erro || "Email ou senha incorretos.");
      submit.disabled    = false;
      submit.textContent = "Entrar";
      return;
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("role",  data.role);

    if (data.role === "modelo") {
      window.location.href = "/app/inbox.html";
      return;
    }

    const ref = localStorage.getItem("ref_modelo");
    if (ref) {
      localStorage.setItem("modelo_id", ref);
      localStorage.removeItem("ref_modelo");
      window.location.href = "/profile.html";
    } else {
      window.location.href = "/clientHome.html";
    }
  } catch (_) {
    showModalError("Erro de ligação. Verifica a tua internet.");
    submit.disabled    = false;
    submit.textContent = "Entrar";
  }
}

// ===============================
// REGISTER — ETAPA 1: enviar OTP
// ===============================
function emailValido(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

window.enviarOTP = async function enviarOTP() {
  clearModalError();
  const email = document.getElementById("loginEmail").value.trim();

  if (!email) {
    showModalError("Preenche o teu email.");
    return;
  }
  if (!emailValido(email)) {
    showModalError("Email inválido. Verifica e tenta novamente.");
    return;
  }

  const submit = document.getElementById("modalSubmit");
  submit.disabled    = true;
  submit.textContent = "A enviar...";

  try {
    const res  = await fetch("/api/pre-registro/enviar-codigo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email })
    });
    const data = await res.json();

    if (!res.ok) {
      showModalError(data.erro || "Erro ao enviar código. Tenta novamente.");
      submit.disabled    = false;
      submit.textContent = "Enviar código de verificação";
      return;
    }

    otpEmail      = email;
    registerStage = "otp";
    updateModal();

  } catch (_) {
    showModalError("Erro de ligação. Verifica a tua internet.");
    submit.disabled    = false;
    submit.textContent = "Enviar código de verificação";
  }
};

// ===============================
// REGISTER — ETAPA 2: verificar OTP
// ===============================
async function verificarOTP() {
  clearModalError();
  const email  = otpEmail || document.getElementById("loginEmail").value.trim();
  const codigo = document.getElementById("registerOtp").value.trim();

  if (!codigo || codigo.length < 6) {
    showModalError("Insere o código de 6 dígitos enviado para o teu email.");
    return;
  }

  const submit = document.getElementById("modalSubmit");
  submit.disabled    = true;
  submit.textContent = "A verificar...";

  try {
    const res  = await fetch("/api/pre-registro/verificar-codigo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, codigo })
    });
    const data = await res.json();

    if (!res.ok) {
      showModalError(data.erro || "Código inválido. Tenta novamente.");
      submit.disabled    = false;
      submit.textContent = "Verificar código";
      return;
    }

    otpPreToken   = data.preToken;
    registerStage = "form";
    updateModal();

  } catch (_) {
    showModalError("Erro de ligação. Verifica a tua internet.");
    submit.disabled    = false;
    submit.textContent = "Verificar código";
  }
}

// ===============================
// REGISTER — ETAPA 3: criar conta
// ===============================
async function register() {
  clearModalError();
  const email           = otpEmail || document.getElementById("loginEmail").value.trim();
  const senha           = document.getElementById("loginSenha").value;
  const senhaConfirm    = document.getElementById("registerSenhaConfirm").value;
  const nome_completo   = document.getElementById("registerNome").value.trim();
  const data_nascimento = document.getElementById("registerNascimento").value;
  const role            = document.getElementById("registerRole").value;

  if (!email || !senha || !nome_completo || !data_nascimento || !role) {
    showModalError("Preenche todos os campos obrigatórios.");
    return;
  }
  if (senha.length < 6) {
    showModalError("A senha deve ter pelo menos 6 caracteres.");
    return;
  }
  if (senha !== senhaConfirm) {
    showModalError("As senhas não coincidem.");
    return;
  }
  if (!otpPreToken) {
    showModalError("Verificação de email necessária. Começa novamente.");
    registerStage = "email";
    updateModal();
    return;
  }

  const submit = document.getElementById("modalSubmit");
  submit.disabled    = true;
  submit.textContent = "A criar conta...";

  const ref = localStorage.getItem("ref_modelo");
  const src = localStorage.getItem("origem_trafego");

  try {
    const res  = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        senha,
        role,
        nome_completo,
        data_nascimento,
        ageConfirmed: true,
        preToken: otpPreToken,
        ref,
        src
      })
    });
    const data = await res.json();

    if (!res.ok) {
      showModalError(data.erro || "Erro ao criar conta. Tenta novamente.");
      submit.disabled    = false;
      submit.textContent = "Criar conta";
      return;
    }

    // Sucesso — guardar token e redirecionar
    localStorage.setItem("token", data.token);
    localStorage.setItem("role",  data.role);

    if (data.role === "modelo") {
      window.location.href = "/app/inbox.html";
      return;
    }

    const refModelo = localStorage.getItem("ref_modelo");
    if (refModelo) {
      localStorage.setItem("modelo_id", refModelo);
      localStorage.removeItem("ref_modelo");
      window.location.href = "/profile.html";
    } else {
      window.location.href = "/clientHome.html";
    }

  } catch (_) {
    showModalError("Erro de ligação. Verifica a tua internet.");
    submit.disabled    = false;
    submit.textContent = "Criar conta";
  }
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
window.logout = async function () {
  const token = localStorage.getItem("token");
  if (token) {
    try { await fetch("/api/logout", { method: "POST", headers: { Authorization: "Bearer " + token } }); } catch (_) {}
  }
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  localStorage.removeItem("ageConfirmed");
  window.location.href = "/index.html";
};
