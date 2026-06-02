(function () {
  const API = "";
  const STORAGE_KEY = "suporte_conversa_id";

  let conversaId = localStorage.getItem(STORAGE_KEY) || null;
  let socket = null;
  let aberto = false;

  // ─── CSS ────────────────────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
    #sp-btn {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      width: 56px; height: 56px; border-radius: 50%;
      background: #7b2cff; border: none; cursor: pointer;
      box-shadow: 0 4px 16px rgba(123,44,255,.4);
      display: flex; align-items: center; justify-content: center;
      transition: transform .2s;
    }
    #sp-btn:hover { transform: scale(1.1); }
    #sp-btn svg { width: 26px; height: 26px; fill: #fff; }
    #sp-badge {
      position: absolute; top: -4px; right: -4px;
      background: #e53e3e; color: #fff; border-radius: 50%;
      width: 18px; height: 18px; font-size: 11px;
      display: none; align-items: center; justify-content: center;
    }
    #sp-box {
      position: fixed; bottom: 90px; right: 24px; z-index: 9998;
      width: 320px; max-height: 460px;
      background: #fff; border-radius: 14px;
      box-shadow: 0 8px 32px rgba(0,0,0,.15);
      display: none; flex-direction: column;
      overflow: hidden; font-family: sans-serif;
    }
    #sp-box.aberto { display: flex; }
    #sp-header {
      background: #7b2cff; padding: 14px 16px;
      display: flex; align-items: center; justify-content: space-between;
    }
    #sp-header span { color: #fff; font-weight: 600; font-size: 15px; }
    #sp-header button {
      background: none; border: none; color: #fff;
      cursor: pointer; font-size: 20px; line-height: 1;
    }
    #sp-status { font-size: 11px; color: rgba(255,255,255,.8); margin-top: 2px; }
    #sp-msgs {
      flex: 1; overflow-y: auto; padding: 14px;
      display: flex; flex-direction: column; gap: 8px;
      background: #f6f6f6;
    }
    #sp-msgs::-webkit-scrollbar { width: 4px; }
    #sp-msgs::-webkit-scrollbar-thumb { background: #ccc; border-radius: 4px; }
    .sp-msg {
      max-width: 80%; padding: 9px 13px; border-radius: 12px;
      font-size: 13px; line-height: 1.4; word-break: break-word;
    }
    .sp-msg.cliente { background: #7b2cff; color: #fff; align-self: flex-end; border-bottom-right-radius: 4px; }
    .sp-msg.admin   { background: #fff; color: #333; align-self: flex-start; border-bottom-left-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
    .sp-hora { font-size: 10px; opacity: .6; margin-top: 3px; text-align: right; }
    #sp-form-nome {
      padding: 16px; display: flex; flex-direction: column; gap: 10px;
      background: #fff;
    }
    #sp-form-nome input {
      background: #f6f6f6; border: 1px solid #ddd; border-radius: 8px;
      color: #333; padding: 10px 12px; font-size: 13px; outline: none;
    }
    #sp-form-nome input:focus { border-color: #7b2cff; }
    #sp-form-nome button {
      background: #7b2cff; border: none; border-radius: 8px;
      color: #fff; padding: 10px; font-size: 14px;
      cursor: pointer; font-weight: 600;
    }
    #sp-input-area {
      display: flex; gap: 8px; padding: 10px 12px;
      border-top: 1px solid #eee; background: #fff;
    }
    #sp-input {
      flex: 1; background: #f6f6f6; border: 1px solid #ddd;
      border-radius: 8px; color: #333; padding: 9px 12px;
      font-size: 13px; outline: none; resize: none;
    }
    #sp-input:focus { border-color: #7b2cff; }
    #sp-send {
      background: #7b2cff; border: none; border-radius: 8px;
      color: #fff; padding: 0 14px; cursor: pointer; font-size: 18px;
    }
    #sp-send:disabled { opacity: .5; cursor: default; }
    .sp-typing { color: #999; font-size: 12px; padding: 0 14px 8px; font-style: italic; background: #f6f6f6; }
    .sp-msg.admin a { color: #7b2cff; text-decoration: underline; }
    #sp-boas-vindas {
      background: #f6f0ff; border-bottom: 1px solid #e8daff;
      padding: 14px 16px; font-size: 13px; color: #4a2a7a; line-height: 1.5;
    }
    #sp-boas-vindas strong { display: block; margin-bottom: 4px; font-size: 14px; }
  `;
  document.head.appendChild(style);

  // ─── HTML ───────────────────────────────────────────────────────────────────
  const btn = document.createElement("button");
  btn.id = "sp-btn";
  btn.innerHTML = `
    <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>
    <span id="sp-badge"></span>
  `;

  const box = document.createElement("div");
  box.id = "sp-box";
  box.innerHTML = `
    <div id="sp-header">
      <div>
        <span>Suporte</span>
        <div id="sp-status">Online</div>
      </div>
      <button id="sp-fechar" title="Fechar">✕</button>
    </div>
    <div id="sp-boas-vindas">
      <strong>👋 Olá! Este é o suporte da Velvet.</strong>
      Aqui você pode tirar dúvidas sobre pagamentos, assinaturas ou qualquer problema com sua conta. Nossa equipe responde em até 48 horas úteis.
    </div>
    <div id="sp-form-nome">
      <input id="sp-nome" placeholder="Seu nome" maxlength="60" />
      <input id="sp-email" placeholder="Seu e-mail (opcional)" maxlength="120" />
      <button id="sp-iniciar">Iniciar conversa</button>
    </div>
    <div id="sp-msgs" style="display:none"></div>
    <div class="sp-typing" id="sp-typing" style="display:none">Suporte está digitando…</div>
    <div id="sp-input-area" style="display:none">
      <textarea id="sp-input" rows="1" placeholder="Digite sua mensagem…" maxlength="1000"></textarea>
      <button id="sp-send">➤</button>
    </div>
  `;

  document.body.appendChild(btn);
  document.body.appendChild(box);

  // ─── REFS ────────────────────────────────────────────────────────────────────
  const badge      = document.getElementById("sp-badge");
  const formNome   = document.getElementById("sp-form-nome");
  const msgsEl     = document.getElementById("sp-msgs");
  const inputArea  = document.getElementById("sp-input-area");
  const inputEl    = document.getElementById("sp-input");
  const sendBtn    = document.getElementById("sp-send");
  const typingEl   = document.getElementById("sp-typing");
  const nomeEl     = document.getElementById("sp-nome");
  const emailEl    = document.getElementById("sp-email");
  const iniciarBtn = document.getElementById("sp-iniciar");

  // ─── TOGGLE ──────────────────────────────────────────────────────────────────
  btn.addEventListener("click", () => {
    aberto = !aberto;
    box.classList.toggle("aberto", aberto);
    if (aberto) {
      badge.style.display = "none";
      badge.textContent = "";
      if (conversaId) carregarMensagens();
    }
  });
  document.getElementById("sp-fechar").addEventListener("click", () => {
    aberto = false;
    box.classList.remove("aberto");
  });

  // ─── INICIAR CONVERSA ────────────────────────────────────────────────────────
  iniciarBtn.addEventListener("click", async () => {
    const nome = nomeEl.value.trim();
    if (!nome) { nomeEl.focus(); return; }

    iniciarBtn.disabled = true;
    iniciarBtn.textContent = "Aguarde…";

    try {
      const r = await fetch(`${API}/api/suporte/conversa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email: emailEl.value.trim() })
      });
      const data = await r.json();
      conversaId = data.conversa_id;
      localStorage.setItem(STORAGE_KEY, conversaId);
      mostrarChat();
      conectarSocket();
    } catch (e) {
      iniciarBtn.disabled = false;
      iniciarBtn.textContent = "Iniciar conversa";
    }
  });

  // ─── MOSTRAR CHAT ────────────────────────────────────────────────────────────
  function mostrarChat() {
    formNome.style.display = "none";
    msgsEl.style.display = "flex";
    inputArea.style.display = "flex";
    carregarMensagens();
  }

  // ─── CARREGAR MENSAGENS ──────────────────────────────────────────────────────
  async function carregarMensagens() {
    if (!conversaId) return;
    try {
      const r = await fetch(`${API}/api/suporte/conversa/${conversaId}/mensagens`);
      const msgs = await r.json();
      msgsEl.innerHTML = "";
      msgs.forEach(adicionarMensagem);
      scrollBaixo();
    } catch (_) {}
  }

  // ─── ADICIONAR MENSAGEM NA TELA ──────────────────────────────────────────────
  function adicionarMensagem(msg) {
    const div = document.createElement("div");
    div.className = `sp-msg ${msg.remetente}`;
    const hora = new Date(msg.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    // mensagens de admin podem ter links; mensagens de cliente são sempre escapadas
    const textoHtml = msg.remetente === "admin"
      ? msg.texto.replace(/\n/g, "<br>")
      : escapeHtml(msg.texto).replace(/\n/g, "<br>");
    div.innerHTML = `${textoHtml}<div class="sp-hora">${hora}</div>`;
    msgsEl.appendChild(div);
  }

  function scrollBaixo() {
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function escapeHtml(t) {
    return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  }

  // ─── AUTO-RESPOSTA ───────────────────────────────────────────────────────────
  const RESPOSTAS = [
    {
      palavras: ["reembolso", "dinheiro de volta", "estorno", "não devolveu", "reembolsar"],
      texto: "Olá! As solicitações de reembolso, são avaliadas individualmente e conforme nossos Termos de Uso. Indicamos que leia novamente os termos: <a href=\"/terms.html\" target=\"_blank\">Termos de Uso</a>, e verifique se seu pedido se enquadra nas situações elegiveis. Caso acredite que sim, pode dar andamento a seu pedido.\n\nPara isso, envie um e-mail para contato@velvet.lat com:\n• E-mail utilizado na compra(login)\n• Data da cobrança\n• Motivo do pedido\n• Prints que comprovam sua elegibilidade ao reembolso e/ou comprovantes de pagamento.\n\nO prazo de resposta é de 24 a 48 horas úteis!💜"
    },
     {
      palavras: ["golpe", "engano", "não condiz", "nao condiz", "comprei por engano", "propaganda enganosa", "propaganda enganosa", "fui enganado", "fui enganada"],
      texto: "Olá! A Velvet é uma plataforma que permite a conexão entre criadores e seus fãs, e não somos responsáveis pelas ações de usuários, mas para manter a integridade do nosso circulo social, sua reclamação é considerada e avaliada individualmente.\n\nCaso acredite que a situação deve ser reportada: \n\nEnvie um e-mail para contato@velvet.lat com:\n• E-mail utilizado(login)\n• Motivo do pedido\n• Prints que comprovam seu relato.\n\nO prazo de resposta é de 24 a 48 horas úteis!💜"
    },
    {
      palavras: ["desejo excluir permanente","excluir conta", "apagar conta", "deletar conta", "exclusão de conta", "exclusao de conta", "excluir minha conta", "cancelar conta", "eliminar conta"],
      texto: "Para excluir sua conta, siga os passos:\n1. Acesse a área do usuário\n2. Vá em Configurações da conta\n3. Role até o final da página\n4. Clique em \"Excluir conta permanentemente\"\n\nSe tiver dificuldades, envie um e-mail para contato@velvet.lat."
    },
    {
      palavras: ["não liberou", "nao liberou", "não ativou", "nao ativou", "paguei e não", "paguei e nao", "vip não ativou", "vip nao ativou", "pagamento não liberou", "pagamento nao liberou", "liberação", "liberacao"],
      texto: "Lamentamos o transtorno! Para resolver, envie um e-mail para contato@velvet.lat com:\n• Comprovante do pagamento\n• Nome da modelo\n• E-mail da sua conta\n\nNossa equipe verificará e ativará o acesso o mais rápido possível."
    },
    {
      palavras: ["esqueci senha", "esqueci a senha", "recuperar senha", "não consigo entrar", "nao consigo entrar", "esqueci minha senha", "resetar senha"],
      texto: "Para recuperar sua senha:\n1. Acesse velvet.lat\n2. Clique em \"Esqueci minha senha\"\n3. Digite o e-mail cadastrado\n4. Verifique também a pasta de spam\n\nSe não receber o e-mail, entre em contato pelo contato@velvet.lat."
    },
      {
      palavras: ["minha assinatura", "assinei e não liberou", "assinatura desativada", "meu VIP", "meu vip", "minha assinatura expirou antes"],
      texto: "Lamentamos o transtorno! Para resolver, envie um e-mail para contato@velvet.lat com:\n• Comprovante do pagamento\n• Nome da modelo\n• E-mail da sua conta\n\nNossa equipe irá solucionar o mais rápido possível."
    },
     {
      palavras: ["tipo de conteudo", "tem previas"],
      texto: "Olá! Aqui é o suporte da plataforma, para ter acesso ao chat da modelo deve assinar o VIP!💜"
    },
     {
      palavras: ["Nao consigo pagar", "Não consigo pagar", "problema no pagamento", "problema para pagar", "erro no pagamento"],
      texto: "Lamentamos o ocorrido. Para analisarmos o problema, envie um e-mail para contato@velvet.lat com:\n• Print do erro\n• Nome da modelo\n• E-mail da sua conta\n\nNossa equipe verificará e resolverá o issue o mais rápido possível."
    },
    {
      palavras: ["cancelar assinatura", "cancelar minha assinatura", "como cancelo", "quero cancelar", "cancelamento de assinatura", "desativar assinatura"],
      texto: "Olá! Para cancelar sua assinatura basta ir em Assinaturas e Pagamentos e clicar em cancelar na assinatura que deseja."
    }
  ];

  const RESPOSTA_FALLBACK = "Olá! No momento não temos uma resposta automática para essa dúvida.\n\nEntre em contato pelo e-mail <a href=\"mailto:contato@velvet.lat\">contato@velvet.lat</a> ou acesse a <a href=\"/contato.html\" target=\"_blank\">página de contato</a>.\n\nO prazo de resposta é de 24 a 48 horas úteis.";

  function detectarResposta(texto) {
    const t = texto.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    for (const r of RESPOSTAS) {
      const match = r.palavras.some(p => {
        const pn = p.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
        return t.includes(pn);
      });
      if (match) return r.texto;
    }
    return null;
  }

  function mostrarAutoResposta(texto) {
    typingEl.style.display = "block";
    scrollBaixo();
    setTimeout(async () => {
      typingEl.style.display = "none";
      const agora = new Date().toISOString();
      const msg = { remetente: "admin", texto, criado_em: agora };
      adicionarMensagem(msg);
      scrollBaixo();
      if (!aberto) {
        const n = parseInt(badge.textContent || "0") + 1;
        badge.textContent = n;
        badge.style.display = "flex";
      }
      // salva no banco para persistir após reload
      try {
        await fetch(`${API}/api/suporte/conversa/${conversaId}/auto-resposta`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texto })
        });
      } catch (_) {}
    }, 1200);
  }

  // ─── ENVIAR MENSAGEM ─────────────────────────────────────────────────────────
  async function enviar() {
    const texto = inputEl.value.trim();
    if (!texto || !conversaId) return;

    sendBtn.disabled = true;
    inputEl.value = "";

    const msgTemp = { remetente: "cliente", texto, criado_em: new Date().toISOString() };
    adicionarMensagem(msgTemp);
    scrollBaixo();

    try {
      await fetch(`${API}/api/suporte/conversa/${conversaId}/mensagem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto })
      });
    } catch (_) {}

    const autoResp = detectarResposta(texto) || RESPOSTA_FALLBACK;
    mostrarAutoResposta(autoResp);

    sendBtn.disabled = false;
    inputEl.focus();
  }

  sendBtn.addEventListener("click", enviar);
  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(); }
  });

  // ─── SOCKET.IO (tempo real) ──────────────────────────────────────────────────
  function conectarSocket() {
    if (!window.io || !conversaId) return;
    const token = localStorage.getItem("token") || sessionStorage.getItem("token");
    socket = window.io({ auth: token ? { token } : {}, transports: ["websocket"] });

    socket.on("connect", () => {
      socket.emit("suporte:entrar", { conversa_id: conversaId });
    });

    socket.on("suporte:resposta", (msg) => {
      adicionarMensagem(msg);
      scrollBaixo();
      typingEl.style.display = "none";
      if (!aberto) {
        const n = parseInt(badge.textContent || "0") + 1;
        badge.textContent = n;
        badge.style.display = "flex";
      }
    });

    socket.on("suporte:typing", () => {
      typingEl.style.display = "block";
      scrollBaixo();
      clearTimeout(window._spTypingTimer);
      window._spTypingTimer = setTimeout(() => { typingEl.style.display = "none"; }, 3000);
    });
  }

  // ─── INIT ────────────────────────────────────────────────────────────────────
  if (conversaId) {
    mostrarChat();
    conectarSocket();
  }
})();
