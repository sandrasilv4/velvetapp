
// ===============================
// SOCKET GLOBAL
async function carregarHeader() {
  if (document.querySelector(".app-header")) {
    return;
  }

  const container = document.getElementById("header-container");
  if (!container) {
    console.warn("❌ header-container não encontrado");
    return;
  }

  try {
    const res = await fetch("/header.html");
    const html = await res.text();

    container.insertAdjacentHTML("afterbegin", html);

    const user = {
      avatar_url: localStorage.getItem("avatar_url"),
      avatar: localStorage.getItem("avatar")
    };

    atualizarAvatarHeader(user);

    await inicializarIdioma();
    initLanguageSwitcher();
    sincronizarIconeNotificacoes();
  } catch (err) {
    console.error("Erro ao carregar header:", err);
  }
}

const menuVisitante = `
  <div class="menu-header">Bem-vindo à Velvet</div>

  <button onclick="abrirPopupVelvet({ tipo: 'login' })">
    Entrar / Criar conta
  </button>
`;

async function initUsuario() {
  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const res = await fetch("/api/me", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) throw new Error("não autenticado");

    const user = await res.json();

    // SEMPRE atualiza
    localStorage.setItem("role", user.role);
    localStorage.setItem("nome", user.nome);

    if (user.avatar_url) {
  localStorage.setItem("avatar_url", user.avatar_url);
} else if (user.avatar) {
  localStorage.setItem("avatar_url", user.avatar);
}

    // limpa flag pós-registro sem afetar lógica
    if (localStorage.getItem("post_register_action") === "just_registered") {
      setTimeout(() => {
        localStorage.removeItem("post_register_action");
      }, 1000);
    }


  } catch (e) {
    console.warn("Sessão inválida no header");

    localStorage.clear();

    if (!window.location.pathname.includes("index")) {
      window.location.href = "/index.html";
    }
  }
}

// =========================================================
// BADGE GLOBAL DE MENSAGENS NÃO LIDAS
function atualizarBadgeHeader(total) {
  const badge = document.getElementById("badgeUnread");
  if (!badge) return;

  if (!total || total <= 0) {
    badge.classList.add("hidden");
    badge.innerText = "0";
  } else {
    badge.innerText = total > 9 ? "9+" : total;
    badge.classList.remove("hidden");
  }
}

// =========================================================
// SOM DE NOTIFICAÇÃO GLOBAL
function tocarSomNotificacaoHeader() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {
    // silencia — áudio pode ser bloqueado antes de interação do usuário
  }
}

// =========================================================
// SOCKET HEADER — MODELO
// Ativo em todas as páginas exceto inbox.html e chat.html
// (que já têm socket próprio)
function initHeaderSocketModelo() {
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");

  if (!token || role !== "modelo") return;

  const path = window.location.pathname || "";
  if (path.includes("/inbox.html") || path.includes("/chat.html") || path.includes("/chat-agency.html")) {
    return; // inbox.js, chat.js e chat-agency.js já gerenciam o socket nessas páginas
  }

  if (typeof io === "undefined") {
    console.warn("Socket.IO não carregado — notificações desativadas");
    return;
  }

  const socket = io({
    transports: ["websocket", "polling"],
    auth: { token }
  });

  socket.on("connect", () => {
    // entra na sala inbox para receber inboxMessage em qualquer página
    socket.emit("joinInbox", (res) => {
      if (res?.ok) {
        console.log("📬 Header modelo na inbox:", res.sala);
      }
    });
  });

  socket.on("inboxMessage", () => {
    tocarSomNotificacaoHeader();
    atualizarUnreadModeloHeader();
  });

  socket.on("unreadUpdate", () => {
    atualizarUnreadModeloHeader();
  });

  socket.on("mensagemLida", () => {
  atualizarUnreadModeloHeader();
});

  socket.on("connect_error", (err) => {
    console.error("❌ Erro socket header modelo:", err.message);
  });
}

// =========================================================
// SOCKET HEADER — CLIENTE
// Ativo em todas as páginas exceto inboxc.html e chatc.html
// (que já têm socket próprio)
function initHeaderSocketCliente() {
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");

  if (!token || role !== "cliente") return;

  const path = window.location.pathname || "";
  if (path.includes("/inboxc.html") || path.includes("/chatc.html")) {
    return; // inboxc.js e chatc.js já gerenciam o socket nessas páginas
  }

  if (typeof io === "undefined") {
    console.warn("Socket.IO não carregado — notificações desativadas");
    return;
  }

  const socket = io({
    transports: ["websocket", "polling"],
    auth: { token }
  });

  socket.on("connect", () => {
    // entra na sala inbox para receber inboxMessage em qualquer página
    socket.emit("joinInbox", (res) => {
      if (res?.ok) {
        console.log("📬 Header cliente na inbox:", res.sala);
      }
    });
  });

  socket.on("inboxMessage", () => {
    tocarSomNotificacaoHeader();
    atualizarUnreadClienteHeader();
  });

  socket.on("connect_error", (err) => {
    console.error("❌ Erro socket header cliente:", err.message);
  });
}

// =========================================================

async function atualizarUnreadClienteHeader() {
  const role = localStorage.getItem("role");
  if (role !== "cliente") return;

  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const res = await fetch("/api/chat/unread/cliente", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) return;

    const unreadIds = await res.json();

    atualizarBadgeHeader(unreadIds.length);
  } catch (e) {
    console.warn("Erro ao buscar unread cliente");
  }
}

async function atualizarUnreadModeloHeader() {
  const role = localStorage.getItem("role");
  if (role !== "modelo") return;

  const token = localStorage.getItem("token");
  if (!token) return;

  try {
    const res = await fetch("/api/chat/unread/modelo", {
      headers: {
        Authorization: "Bearer " + token
      }
    });

    if (!res.ok) return;

    const unreadIds = await res.json();

    atualizarBadgeHeader(unreadIds.length);
  } catch (e) {
    console.warn("Erro ao buscar unread modelo");
  }
}

// =========================================================
// INIT HEADER (ORDEM CORRETA)

document.addEventListener("DOMContentLoaded", async () => {
  await initUsuario();
  await carregarHeader();

  // await carregarVapidPublicKey();

  atualizarUnreadClienteHeader();
  atualizarUnreadModeloHeader();

  // socket global — toca som e atualiza badge em qualquer página
  initHeaderSocketModelo();
  initHeaderSocketCliente();
});

// =========================================================
// LOGO → HOME POR ROLE

document.addEventListener("click", (e) => {
 const logo = e.target.closest(".velvet-logo");
  if (!logo) return;

  const role = localStorage.getItem("role");

  if (role === "modelo") {
    window.location.href = "/feed.html";
  } else if (role === "cliente") {
    window.location.href = "/feed.html";
  } else {
    window.location.href = "/index.html";
  }
});

// =========================================================
// LOGOUT
document.addEventListener("click", (e) => {
  const btn = e.target.closest("#btnLogout");
  if (!btn) return;

  e.preventDefault();

  localStorage.clear();

  window.location.href = "/index.html";
});

// =========================================================

document.addEventListener("click", (e) => {

  const avatar = e.target.closest("#linkPerfil");
  if (!avatar) return;

  e.preventDefault();
  e.stopPropagation();

  const modeloId = localStorage.getItem("modelo_id");

  if (!modeloId) {
    console.warn("Apenas criadoras verificadas tem perfil publico");
    return;
  }

  window.location.href = `/perfil.html?id=${modeloId}`;

});

// =========================================================
document.addEventListener("click", async (e) => {
  const btnNotif = e.target.closest("#btnNotificacoes");
  if (!btnNotif) return;

  e.preventDefault();

  const ativo = localStorage.getItem("notificacoes_ativas") === "true";

  if (ativo) {
    await desativarNotificacoes();
  } else {
    await ativarNotificacoes();
  }
});
//===========================================================

async function irParaInbox() {
  const token = localStorage.getItem("token");
  if (!token) {
    window.location.href = "/index.html";
    return;
  }

  const res = await fetch("/api/me", {
    headers: {
      Authorization: "Bearer " + token
    }
  });

  if (!res.ok) return;

  const user = await res.json();

  if (user.role === "modelo") {
    window.location.href = "/inbox.html";
  } else {
    window.location.href = "/inboxc.html";
  }
}

function atualizarAvatarHeader(user = {}) {
  const avatar = document.getElementById("headerAvatar");
  if (!avatar) return;

  const avatarUrl =
    user.avatar_url ||
    user.avatar ||
    user.foto_perfil ||
    user.foto ||
    localStorage.getItem("avatar_url") ||
    localStorage.getItem("avatar") ||
    "";

  if (avatarUrl && typeof avatarUrl === "string" && avatarUrl.trim() !== "") {
    avatar.src = avatarUrl;
  } else {
    avatar.src = "assets/avatar.png";
  }

  avatar.onerror = () => {
    avatar.src = "assets/avatar.png";
  };
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }

  return outputArray;
}

function atualizarIconeNotificacoes(ativo) {
  const icon = document.getElementById("iconNotificacoes");
  if (!icon) return;

  icon.src = ativo ? "assets/noton.png" : "assets/notoff.png";
  icon.alt = ativo ? t("header.notificationsOn") : t("header.notificationsOff");
  icon.title = ativo ? t("header.disableNotifications") : t("header.enableNotifications");
}

async function obterEstadoRealNotificacoes() {
  try {
    if (isCapacitorNative()) {
      // No APK nativo, a Web Push API não funciona — usa localStorage + verifica permissão nativa
      const stored = localStorage.getItem("notificacoes_ativas") === "true";
      if (!stored) return false;
      const { PushNotifications } = window.Capacitor.Plugins;
      const status = await PushNotifications.checkPermissions();
      return status.receive === "granted";
    }

    if (!("serviceWorker" in navigator)) return false;
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    return !!subscription;
  } catch (err) {
    console.warn("Erro ao verificar subscription push:", err);
    return localStorage.getItem("notificacoes_ativas") === "true";
  }
}

async function sincronizarIconeNotificacoes() {
  const ativo = await obterEstadoRealNotificacoes();
  localStorage.setItem("notificacoes_ativas", ativo ? "true" : "false");
  atualizarIconeNotificacoes(ativo);
}

function isCapacitorNative() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}

async function ativarNotificacoesNativas() {
  try {
    const { PushNotifications } = window.Capacitor.Plugins;
    const token = localStorage.getItem("token");
    if (!token) {
      alert("Você precisa estar logado para ativar notificações.");
      return;
    }

    const permResult = await PushNotifications.requestPermissions();
    if (permResult.receive !== "granted") {
      atualizarIconeNotificacoes(false);
      localStorage.setItem("notificacoes_ativas", "false");
      return;
    }

    // Listeners ANTES de register() — o evento pode chegar imediatamente
    await PushNotifications.addListener("registration", async (regToken) => {
      try {
        const res = await fetch("/api/notificacoes/inscrever-dispositivo", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + token
          },
          body: JSON.stringify({ token: regToken.value, platform: window.Capacitor.getPlatform() })
        });
        if (res.ok) {
          localStorage.setItem("notificacoes_ativas", "true");
          atualizarIconeNotificacoes(true);
        }
      } catch (err) {
        console.error("Erro ao registrar token FCM:", err);
      }
    });

    await PushNotifications.addListener("registrationError", (err) => {
      console.error("Erro de registro FCM:", err);
      localStorage.setItem("notificacoes_ativas", "false");
      atualizarIconeNotificacoes(false);
    });

    await PushNotifications.register();
  } catch (err) {
    console.error("Erro ao ativar notificações nativas:", err);
    localStorage.setItem("notificacoes_ativas", "false");
    atualizarIconeNotificacoes(false);
  }
}

async function ativarNotificacoes() {
  try {
    if (isCapacitorNative()) {
      await ativarNotificacoesNativas();
      return;
    }

    if (!("Notification" in window)) {
      alert("Este navegador não suporta notificações.");
      return;
    }

    if (!("serviceWorker" in navigator)) {
      alert("Este navegador não suporta service worker.");
      return;
    }

    if (!("PushManager" in window)) {
      alert("Este navegador não suporta notificações push.");
      return;
    }

    const token = localStorage.getItem("token");
    if (!token) {
      alert("Você precisa estar logado para ativar notificações.");
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      atualizarIconeNotificacoes(false);
      localStorage.setItem("notificacoes_ativas", "false");
      return;
    }

    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();

    if (!subscription) {
      let vapidPublicKey =
        window.VAPID_PUBLIC_KEY ||
        localStorage.getItem("VAPID_PUBLIC_KEY") ||
        localStorage.getItem("vapid_public_key");

      if (!vapidPublicKey) {
        vapidPublicKey = await carregarVapidPublicKey();
      }

      if (!vapidPublicKey) {
        console.error("VAPID public key não encontrada.");
        alert("Chave pública de notificação não configurada.");
        return;
      }

      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      });
    }

    const res = await fetch("/api/notificacoes/inscrever", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token
      },
      body: JSON.stringify(subscription)
    });

    if (!res.ok) {
      const erro = await res.json().catch(() => null);
      console.error("Erro ao inscrever notificações:", erro || res.status);
      alert("Não foi possível ativar as notificações.");
      return;
    }

    localStorage.setItem("notificacoes_ativas", "true");
    atualizarIconeNotificacoes(true);
  } catch (err) {
    console.error("Erro ao ativar notificações:", err);
    alert("Erro ao ativar notificações.");
  }
}

async function desativarNotificacoes() {
  try {
    const token = localStorage.getItem("token");

    if (isCapacitorNative()) {
      const { PushNotifications } = window.Capacitor.Plugins;
      await PushNotifications.removeAllListeners();
    } else if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await subscription.unsubscribe();
      }
    }

    if (token) {
      await fetch("/api/notificacoes/desinscrever", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token
        }
      });
    }

    localStorage.setItem("notificacoes_ativas", "false");
    atualizarIconeNotificacoes(false);
  } catch (err) {
    console.error("Erro ao desativar notificações:", err);
    alert("Erro ao desativar notificações.");
  }
}

// async function carregarVapidPublicKey() {
//   try {
//     const jaExiste =
//       window.VAPID_PUBLIC_KEY ||
//       localStorage.getItem("VAPID_PUBLIC_KEY") ||
//       localStorage.getItem("vapid_public_key");

//     if (jaExiste) {
//       window.VAPID_PUBLIC_KEY = jaExiste;
//       return jaExiste;
//     }

//     const res = await fetch("/api/push/public-key", {
//       method: "GET",
//       headers: { Accept: "application/json" }
//     });

//     if (!res.ok) {
//       const texto = await res.text().catch(() => "");
//       console.error("Erro ao buscar VAPID public key:", res.status, texto);
//       return null;
//     }

//     const data = await res.json();
//     const publicKey = data?.publicKey || null;

//     if (!publicKey) {
//       console.error("Resposta sem publicKey:", data);
//       return null;
//     }

//     window.VAPID_PUBLIC_KEY = publicKey;
//     localStorage.setItem("VAPID_PUBLIC_KEY", publicKey);
//     localStorage.setItem("vapid_public_key", publicKey);

//     return publicKey;
//   } catch (err) {
//     console.error("Erro ao carregar VAPID public key:", err);
//     return null;
//   }
// }