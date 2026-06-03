// if ("serviceWorker" in navigator) {
//   window.addEventListener("load", async () => {
//     try {
//       await navigator.serviceWorker.register("/service-worker.js");
//       console.log("Service worker registrado");
//     } catch (err) {
//       console.error("Erro ao registrar service worker:", err);
//     }
//   });
// }

window.token = localStorage.getItem("token");

const ESTA_NO_INDEX =
  window.location.pathname === "/" ||
  window.location.pathname.includes("index");

// apenas valida sessão
if (ESTA_NO_INDEX && token) {
  fetch("/api/me", {
    headers: { Authorization: "Bearer " + token }
  })
    .then(res => {
      if (!res.ok) {
        localStorage.clear();
      }
    })
    .catch(() => {
      localStorage.clear();
    });
}

const refModelo = localStorage.getItem("ref_modelo");
const srcOrigem = localStorage.getItem("origem_trafego");

// ESTADO GLOBAL

let modalMode     = "login";   // login | register
let registerStage = "email";   // email | otp | form
let otpPreToken   = null;
let otpEmail      = null;
let pendingAction = null;

window.openAgeGate = function (action) {

  // 🔥 LOGIN NÃO PASSA PELO AGE GATE
  if (action === "login") {
  closeAllModals();
  openLoginModal();
  return;
}

  // 🔐 REGISTRO PASSA PELO AGE GATE
  pendingAction = action;

  const confirmed = localStorage.getItem("ageConfirmed");
  if (confirmed === "true") {
    proceedAfterAge();
    return;
  }

  closeAllModals();
  document.getElementById("ageModal")?.classList.remove("hidden");
};

function confirmAge(isAdult) {
  if (!isAdult) {
    alert(t("index.mustBeAdult"));
    
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
  document.getElementById("forgotModal")?.classList.add("hidden");
}

window.selectRole = function () {
  openLoginModal();
};

window.startRegister = function () {
  localStorage.removeItem("ageConfirmed");
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
  localStorage.removeItem("ageConfirmed");
  updateModal();
}

window.switchToLogin = function () {
  modalMode     = "login";
  registerStage = "email";
  otpPreToken   = null;
  otpEmail      = null;
  updateModal();
};

// ── Mensagens de erro inline no modal ────────────────────────────────────────
function getOrCreateModalError() {
  let el = document.getElementById("modalError");
  if (!el) {
    // Criar dinamicamente se o HTML ainda estiver em cache sem o elemento
    el = document.createElement("div");
    el.id = "modalError";
    el.style.cssText = "display:none;background:#fff0f0;border:1px solid #ffb3b3;border-radius:8px;padding:10px 14px;font-size:13px;color:#c0392b;margin-bottom:4px;";
    const submit = document.getElementById("modalSubmit");
    if (submit) submit.insertAdjacentElement("beforebegin", el);
  }
  return el;
}
function showModalError(msg) {
  const el = getOrCreateModalError();
  el.textContent = msg;
  el.style.display = "block";
}
function clearModalError() {
  const el = document.getElementById("modalError");
  if (el) el.style.display = "none";
}
// ─────────────────────────────────────────────────────────────────────────────

// ── Controla visibilidade do bloco Senha (label + input) ─────────────────────
// Funciona com e sem o wrapper #fieldSenhaComum (compatibilidade com HTML cacheado)
function setSenhaVisivel(visivel) {
  const wrapper = document.getElementById("fieldSenhaComum");
  const input   = document.getElementById("loginSenha");
  if (wrapper) {
    visivel ? wrapper.classList.remove("hidden") : wrapper.classList.add("hidden");
  } else if (input) {
    // HTML antigo sem wrapper — esconder/mostrar input e o label anterior
    input.style.display = visivel ? "" : "none";
    const label = input.previousElementSibling;
    if (label && label.tagName === "LABEL") label.style.display = visivel ? "" : "none";
  }
}

// ── Garante que o campo OTP existe no DOM (HTML antigo sem #fieldOtp) ─────────
function getOrCreateFieldOtp() {
  let el = document.getElementById("fieldOtp");
  if (!el) {
    el = document.createElement("div");
    el.id = "fieldOtp";
    el.className = "field hidden";
    el.innerHTML = `
      <p id="otpInfo" style="font-size:13px;color:#7a6a9a;margin:0 0 10px;line-height:1.5;"></p>
      <label for="registerOtp">Código de verificação</label>
      <input id="registerOtp" type="text" inputmode="numeric" pattern="[0-9]*" maxlength="6"
             placeholder="000000" autocomplete="one-time-code"
             style="letter-spacing:8px;font-size:22px;text-align:center;font-weight:700;">
      <p id="otpReenviar" style="font-size:12px;color:#9b87b8;margin-top:8px;text-align:right;display:none;">
        Não recebeste? <span onclick="enviarOTP()" style="color:#7B2CFF;cursor:pointer;font-weight:600;">Reenviar código</span>
      </p>`;
    // Inserir depois do campo de email
    const emailInput = document.getElementById("loginEmail");
    if (emailInput) emailInput.insertAdjacentElement("afterend", el);
  }
  return el;
}
// ─────────────────────────────────────────────────────────────────────────────

function updateModal() {
  const title           = document.getElementById("modalTitle");
  const submit          = document.getElementById("modalSubmit");
  const switchLogin     = document.getElementById("switchToLogin");
  const switchRegister  = document.getElementById("switchToRegister");
  const fieldSenha      = document.getElementById("fieldSenha");
  const fieldNome       = document.getElementById("fieldNome");
  const fieldNascimento = document.getElementById("fieldNascimento");
  const fieldPerfil     = document.getElementById("fieldPerfil");
  const fieldOtp        = getOrCreateFieldOtp();
  const otpInfoEl       = document.getElementById("otpInfo");
  const otpReenviar     = document.getElementById("otpReenviar");
  const registerLegal   = document.getElementById("registerLegal");
  const emailInput      = document.getElementById("loginEmail");

  clearModalError();

  if (modalMode === "login") {
    title.textContent  = t("index.loginTitle");
    submit.textContent = t("index.loginAction");
    submit.onclick     = login;
    submit.disabled    = false;

    setSenhaVisivel(true);
    fieldSenha?.classList.add("hidden");
    fieldNome?.classList.add("hidden");
    fieldNascimento?.classList.add("hidden");
    fieldPerfil?.classList.add("hidden");
    fieldOtp.classList.add("hidden");
    registerLegal?.classList.add("hidden");
    switchRegister?.classList.remove("hidden");
    switchLogin?.classList.add("hidden");
    emailInput?.removeAttribute("readonly");

  } else {
    // ── Modo registo — 3 etapas ──────────────────────────────────────────────
    switchRegister?.classList.add("hidden");
    switchLogin?.classList.remove("hidden");

    if (registerStage === "email") {
      title.textContent  = t("index.registerTitle");
      submit.textContent = "Enviar código de verificação";
      submit.onclick     = enviarOTP;
      submit.disabled    = false;

      setSenhaVisivel(false);
      fieldSenha?.classList.add("hidden");
      fieldNome?.classList.add("hidden");
      fieldNascimento?.classList.add("hidden");
      fieldPerfil?.classList.add("hidden");
      fieldOtp.classList.add("hidden");
      registerLegal?.classList.add("hidden");
      emailInput?.removeAttribute("readonly");

    } else if (registerStage === "otp") {
      title.textContent  = "Verificar Email";
      submit.textContent = "Verificar código";
      submit.onclick     = verificarOTP;
      submit.disabled    = false;

      setSenhaVisivel(false);
      fieldSenha?.classList.add("hidden");
      fieldNome?.classList.add("hidden");
      fieldNascimento?.classList.add("hidden");
      fieldPerfil?.classList.add("hidden");
      fieldOtp.classList.remove("hidden");
      registerLegal?.classList.add("hidden");
      emailInput?.setAttribute("readonly", "true");

      if (otpInfoEl && otpEmail) {
        otpInfoEl.textContent = `📩 Código enviado para ${otpEmail}. Verifica a tua caixa de entrada (e o spam).`;
      }
      if (otpReenviar) otpReenviar.style.display = "block";
      setTimeout(() => document.getElementById("registerOtp")?.focus(), 50);

    } else if (registerStage === "form") {
      title.textContent  = t("index.registerTitle");
      submit.textContent = t("index.registerAction");
      submit.onclick     = register;
      submit.disabled    = false;

      setSenhaVisivel(true);
      fieldSenha?.classList.remove("hidden");
      fieldNome?.classList.remove("hidden");
      fieldNascimento?.classList.remove("hidden");
      fieldPerfil?.classList.remove("hidden");
      fieldOtp.classList.add("hidden");
      registerLegal?.classList.remove("hidden");
      // Resetar checkbox ao chegar à etapa 3
      const cbAge = document.getElementById("registerAgeConfirm");
      if (cbAge) cbAge.checked = false;
      emailInput?.setAttribute("readonly", "true");
      setTimeout(() => document.getElementById("loginSenha")?.focus(), 50);
    }
  }
}

async function login() {
  clearModalError();
  const email = loginEmail.value.trim();
  const senha = loginSenha.value;

  if (!email || !senha) {
    showModalError(t("index.fillEmailPassword"));
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
      showModalError(data.erro || data.error || t("index.invalidLogin"));
      submit.disabled    = false;
      submit.textContent = t("index.loginAction");
      return;
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("role", data.role);
    localStorage.setItem("ageConfirmed", "true");

    if (data.role === "modelo" && data.modelo_id) {
      localStorage.setItem("modelo_id", data.modelo_id);
    }
    if (data.role === "cliente" && data.cliente_id) {
      localStorage.setItem("cliente_id", data.cliente_id);
    }

    const actionRaw = localStorage.getItem("post_login_action");
    const redirect  = localStorage.getItem("redirect_after_auth");
    let action = null;
    try { action = actionRaw ? JSON.parse(actionRaw) : null; } catch (_) {}

    if (redirect) {
      localStorage.removeItem("redirect_after_auth");
      localStorage.removeItem("post_login_action");
      localStorage.removeItem("post_register_action");
      window.location.href = redirect;
      return;
    }

    window.location.href = "/feed.html";

  } catch (_) {
    showModalError("Erro de ligação. Verifica a tua internet.");
    submit.disabled    = false;
    submit.textContent = t("index.loginAction");
  }
}

// ── Etapa 1: enviar OTP ───────────────────────────────────────────────────────
window.enviarOTP = async function enviarOTP() {
  clearModalError();
  const email = document.getElementById("loginEmail").value.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showModalError("Introduz um email válido.");
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

// ── Etapa 2: verificar OTP ────────────────────────────────────────────────────
async function verificarOTP() {
  clearModalError();
  const email  = otpEmail || document.getElementById("loginEmail").value.trim();
  const codigo = document.getElementById("registerOtp")?.value.trim();

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

// ── Etapa 3: criar conta ──────────────────────────────────────────────────────
async function register() {
  clearModalError();
  const email           = otpEmail || document.getElementById("loginEmail").value.trim();
  const senha           = document.getElementById("loginSenha").value;
  const senhaConfirm    = document.getElementById("registerSenhaConfirm").value;
  const nome            = document.getElementById("registerNome").value.trim();
  const nascimento      = document.getElementById("registerNascimento").value;
  const role            = document.getElementById("registerRole")?.value;
  const ref             = localStorage.getItem("ref_modelo");
  const src             = localStorage.getItem("origem_trafego");

  if (!email || !senha || !senhaConfirm || !role || !nome || !nascimento) {
    showModalError(t("index.fillAllFields"));
    return;
  }
  if (senha.length < 6) {
    showModalError(t("index.passwordMinLength"));
    return;
  }
  if (senha !== senhaConfirm) {
    showModalError(t("index.passwordMismatch"));
    return;
  }
  if (!otpPreToken) {
    showModalError("Verificação de email necessária. Inicia o processo novamente.");
    registerStage = "email";
    updateModal();
    return;
  }

  const ageConfirmed = document.getElementById("registerAgeConfirm")?.checked === true;
  if (!ageConfirmed) {
    showModalError("Deves confirmar que tens mais de 18 anos e aceitar os Termos de Uso.");
    return;
  }

  const submit = document.getElementById("modalSubmit");
  submit.disabled    = true;
  submit.textContent = "A criar conta...";

  try {
    const res  = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email,
        senha,
        role,
        nome_completo: nome,
        data_nascimento: nascimento,
        ageConfirmed: true,
        preToken: otpPreToken,
        ref,
        src
      })
    });
    const data = await res.json();

    if (!res.ok) {
      showModalError(data.erro || data.error || t("index.registerError"));
      submit.disabled    = false;
      submit.textContent = t("index.registerAction");
      return;
    }

    localStorage.setItem("token", data.token);
    localStorage.setItem("role", data.role);
    localStorage.setItem("ageConfirmed", "true");

    if (data.cliente_id) localStorage.setItem("cliente_id", data.cliente_id);
    if (data.modelo_id)  localStorage.setItem("modelo_id",  data.modelo_id);

    const actionRaw    = localStorage.getItem("post_register_action") || localStorage.getItem("post_login_action");
    const redirect     = localStorage.getItem("redirect_after_auth");
    let action = null;
    try { action = actionRaw ? JSON.parse(actionRaw) : null; } catch (_) {}

    const destinoFinal = redirect || action?.redirect;
    if (destinoFinal) {
      localStorage.removeItem("redirect_after_auth");
      localStorage.removeItem("post_login_action");
      localStorage.removeItem("post_register_action");
      window.location.href = destinoFinal;
      return;
    }

    window.location.href = "/feed.html";

  } catch (_) {
    showModalError("Erro de ligação. Verifica a tua internet.");
    submit.disabled    = false;
    submit.textContent = t("index.registerAction");
  }
}

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

window.logout = async function () {
  const token = localStorage.getItem("token");
  if (token) {
    try { await fetch("/api/logout", { method: "POST", headers: { Authorization: "Bearer " + token } }); } catch (_) {}
  }
  localStorage.removeItem("token");
  localStorage.removeItem("role");
  window.location.href = "/index.html";
};

function openForgot() {
  closeAllModals();
  document.getElementById("forgotModal").classList.remove("hidden");
  document.getElementById("forgotStepEmail").classList.remove("hidden");
  document.getElementById("forgotStepCode").classList.add("hidden");
}

function closeForgotModal() {
  document.getElementById("forgotModal").classList.add("hidden");
}

async function sendResetCode() {
 const email = document.getElementById("forgotEmail").value;
  if (!email) {
    alert(t("index.enterYourEmail"));
    return;
  }

  // troca o step PRIMEIRO, independente do servidor
  document.getElementById("forgotSpamHint").classList.remove("hidden");
  document.getElementById("forgotStepEmail").classList.add("hidden");
  document.getElementById("forgotStepCode").classList.remove("hidden");

  fetch("/api/password/forgot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email })
  }).catch(() => {});
}

async function confirmReset() {
const email = document.getElementById("forgotEmail").value;
const codigo = document.getElementById("forgotCode").value;
const novaSenha = document.getElementById("forgotNewPassword").value;
const confirmarSenha = document.getElementById("forgotConfirmPassword").value;

  if (!codigo || !novaSenha || !confirmarSenha) {
   alert(t("index.fillAllFields"));
    return;
  }

  if (novaSenha !== confirmarSenha) {
    alert(t("index.passwordMismatch"));
    return;
  }

  if (novaSenha.length < 6) {
    alert(t("index.passwordMinLength"));
    return;
  }

  const res = await fetch("/api/password/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, codigo, novaSenha })
  });

  const data = await res.json();

  if (!res.ok) {
   alert(data.error || t("index.resetError"));
    return;
  }

  alert(t("index.passwordChangedSuccess"));
  closeForgotModal();
  openLoginModal();
}

function capturarOrigemTrafego() {
  const params = new URLSearchParams(window.location.search);

  const origem = {
    ref_modelo: params.get("ref") || params.get("modelo_id") || params.get("id"),
    origem_trafego:
      params.get("src") ||
      params.get("utm_source") ||
      document.referrer ||
      "direto",

    utm_source: params.get("utm_source"),
    utm_medium: params.get("utm_medium"),
    utm_campaign: params.get("utm_campaign"),
    utm_content: params.get("utm_content"),
    utm_term: params.get("utm_term"),

    referer: document.referrer || null,
    landing_page: window.location.pathname,
    current_url: window.location.href
  };

  if (origem.ref_modelo) {
    localStorage.setItem("ref_modelo", origem.ref_modelo);
  }

  if (origem.origem_trafego) {
    localStorage.setItem("origem_trafego", origem.origem_trafego);
  }

  localStorage.setItem("origem_payload", JSON.stringify(origem));

  return origem;
}

document.addEventListener("DOMContentLoaded", async () => {
  await whenI18nReady();
  updateModal();
});
