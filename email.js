const { Resend } = require("resend");
const resend = new Resend(process.env.RESEND_API_KEY);

const HEADER = `
  <div style="background:linear-gradient(135deg,#7B2CFF 0%,#a94cff 100%);border-radius:14px 14px 0 0;padding:20px 32px;text-align:center;">
    <span style="color:#7B2CFF;font-size:20px;font-weight:800;letter-spacing:1px;">Velvet</span>
  </div>
`;

const FOOTER = `
  <div style="margin-top:28px;padding-top:18px;border-top:1px solid #f0ebfa;text-align:center;">
    <p style="margin:0 0 4px;color:#6b5a7d;">Equipe Velvet</p>
    <p style="margin:0;font-size:13px;color:#9b87b8;">
      Dúvidas? <a href="mailto:contato@velvet.lat" style="color:#7B2CFF;">contato@velvet.lat</a>
    </p>
  </div>
`;

function wrapEmail(content) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;background:#f0ebfa;padding:32px 16px;color:#2d1f3d;">
      <div style="max-width:600px;margin:0 auto;">
        ${HEADER}
        <div style="background:#fff;padding:32px;border-radius:0 0 14px 14px;border:1px solid #e5d9ff;border-top:none;">
          ${content}
          ${FOOTER}
        </div>
      </div>
    </div>
  `;
}

function btnPrimary(href, texto) {
  return `
    <div style="text-align:center;margin:28px 0 8px;">
      <a href="${href}" style="display:inline-block;background:linear-gradient(135deg,#7B2CFF,#a94cff);color:#fff;text-decoration:none;padding:15px 32px;border-radius:10px;font-weight:bold;font-size:15px;">
        ${texto}
      </a>
    </div>
  `;
}

function infoBox(cor, content) {
  const cores = {
    purple: { bg: "#f8f4ff", text: "#4b2a7b" },
    pink:   { bg: "#fff7fb", text: "#7a1f52" },
  };
  const c = cores[cor] || cores.purple;
  return `
    <div style="background:${c.bg};padding:16px 20px;border-radius:10px;margin:0 0 14px;">
      ${content}
    </div>
  `;
}


async function enviarEmailValidacao(email) {
  await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to: email,
    subject: "Envio de documentos para aprovação",
    html: wrapEmail(`
      <h2 style="margin:0 0 6px;color:#6f42c1;text-align:center;font-size:21px;">
        Seu perfil foi criado! ✨
      </h2>
      <p style="text-align:center;margin:0 0 24px;color:#7a6a9a;font-size:14px;">
        Falta pouco para começar a ganhar
      </p>

      <p style="margin:0 0 16px;line-height:1.7;">Olá,</p>

      <p style="margin:0 0 20px;line-height:1.7;">
        Para ativar seu perfil e começar a ganhar, envie sua documentação através da página <strong>Conta</strong> na plataforma.
      </p>

      ${infoBox("purple", `
        <p style="margin:0 0 6px;font-weight:bold;color:#4b2a7b;">⏳ Prazo para validação</p>
        <p style="margin:0;line-height:1.6;">
          Você tem <strong>14 dias</strong> para concluir a validação da sua conta.
          Após esse período, contas não validadas são removidas automaticamente.
        </p>
      `)}

      ${infoBox("pink", `
        <p style="margin:0 0 6px;font-weight:bold;color:#7a1f52;">Registrou-se por engano como criador(a)?</p>
        <p style="margin:0;line-height:1.6;">
          Envie um email para <a href="mailto:contato@velvet.lat" style="color:#6f42c1;font-weight:bold;">contato@velvet.lat</a>
          e solicite a alteração de influencer para usuário.
        </p>
      `)}

      ${btnPrimary("https://www.velvet.lat", "Acessar a plataforma")}
    `)
  });
}

async function enviarEmailAprovacao(email) {
  await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to: email,
    subject: "Sua conta foi aprovada 🎉",
    html: wrapEmail(`
      <h2 style="margin:0 0 6px;color:#6f42c1;text-align:center;font-size:21px;">
        Conta aprovada! 🎉
      </h2>
      <p style="text-align:center;margin:0 0 24px;color:#7a6a9a;font-size:14px;">
        Estamos felizes em ter você na Velvet
      </p>

      <p style="margin:0 0 16px;line-height:1.7;">Olá,</p>

      <p style="margin:0 0 20px;line-height:1.7;">
        Sua verificação foi aprovada e seu perfil já pode ser utilizado na Velvet!
      </p>

      ${infoBox("purple", `
        <p style="margin:0 0 6px;font-weight:bold;color:#4b2a7b;">📄 Manual do Utilizador</p>
        <p style="margin:0 0 8px;line-height:1.6;">Consulte o guia rápido para começar a usar a plataforma.</p>
        <a href="https://www.velvet.lat/docs/manual.pdf" style="color:#6f42c1;font-weight:bold;">Ver Manual do Utilizador</a>
      `)}

      ${infoBox("pink", `
        <p style="margin:0 0 6px;font-weight:bold;color:#7a1f52;">📋 Termos de Uso do Criador</p>
        <p style="margin:0 0 8px;line-height:1.6;">Antes de começar a faturar, relembre os termos aceitos no seu cadastro.</p>
        <a href="https://www.velvet.lat/docs/creators_terms.pdf" style="color:#b0307d;font-weight:bold;">Ver Termos de Uso do Criador</a>
      `)}

      ${btnPrimary("https://www.velvet.lat", "Acessar minha conta")}
    `)
  });
}

async function enviarEmailRejeicao(email, motivo) {
  await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to: email,
    subject: "Verificação de conta não aprovada",
    html: wrapEmail(`
      <h2 style="margin:0 0 6px;color:#b0307d;text-align:center;font-size:21px;">
        Verificação não aprovada
      </h2>
      <p style="text-align:center;margin:0 0 24px;color:#7a6a9a;font-size:14px;">
        Você pode corrigir e reenviar sua documentação
      </p>

      <p style="margin:0 0 16px;line-height:1.7;">Olá,</p>

      <p style="margin:0 0 20px;line-height:1.7;">
        Infelizmente não foi possível aprovar sua verificação nesta análise.
      </p>

      ${infoBox("pink", `
        <p style="margin:0 0 8px;font-weight:bold;color:#7a1f52;">❌ Motivo da reprovação</p>
        <p style="margin:0;line-height:1.6;">${motivo}</p>
      `)}

      ${infoBox("purple", `
        <p style="margin:0;line-height:1.6;color:#4b2a7b;">
          📤 Você pode acessar sua conta, preencher todos os dados necessários, anexar os documentos e <strong>reenviar para nova análise</strong>.
        </p>
      `)}

      ${btnPrimary("https://www.velvet.lat", "Acessar a plataforma")}
    `)
  });
}

async function enviarEmailBoasVindasCliente(email, nomeCompleto) {
  const nome = (nomeCompleto || "").split(" ")[0] || "você";
  await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to: email,
    subject: "Bem-vindo(a) à Velvet! 💜",
    html: wrapEmail(`
      <h2 style="margin:0 0 6px;color:#6f42c1;text-align:center;font-size:21px;">
        Bem-vindo(a) à Velvet! 💜
      </h2>
      <p style="text-align:center;margin:0 0 24px;color:#7a6a9a;font-size:14px;">
        Conectando fãs e criadores de forma autêntica e segura
      </p>

      <p style="margin:0 0 16px;line-height:1.7;">Olá, <strong>${nome}</strong>!</p>

      <p style="margin:0 0 20px;line-height:1.7;">
        Sua conta foi criada com sucesso. Agora você tem acesso a um espaço pensado para quem quer se conectar de verdade com os criadores que admira.
      </p>

      <p style="margin:0 0 12px;font-weight:bold;color:#4b2a7b;">Como funciona:</p>

      ${infoBox("purple", `<p style="margin:0;line-height:1.6;">🔍 <strong>Descubra criadores</strong> — explore perfis de artistas, influenciadores e produtores de conteúdo das mais diversas áreas.</p>`)}
      ${infoBox("purple", `<p style="margin:0;line-height:1.6;">💬 <strong>Assine e converse</strong> — ao assinar um perfil, você tem acesso ao chat direto e ao conteúdo do criador.</p>`)}
      ${infoBox("purple", `<p style="margin:0;line-height:1.6;">🎁 <strong>Conteúdo premium</strong> — adquira fotos e vídeos avulsos diretamente no perfil de cada criador.</p>`)}
      ${infoBox("purple", `<p style="margin:0;line-height:1.6;">🤝 <strong>Interação direta</strong> — aqui você não é só mais um seguidor. A Velvet existe para criar conexões reais entre criadores e fãs.</p>`)}

      ${btnPrimary("https://www.velvet.lat", "Explorar a plataforma")}
    `)
  });
}

async function enviarEmailBoasVindasModelo(email, nomeCompleto) {
  const nome = (nomeCompleto || "").split(" ")[0] || "você";
  await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to: email,
    subject: "Bem-vindo(a) à Velvet! 💜",
    html: wrapEmail(`
      <h2 style="margin:0 0 6px;color:#6f42c1;text-align:center;font-size:21px;">
        Bem-vindo(a) à Velvet! ✨
      </h2>
      <p style="text-align:center;margin:0 0 24px;color:#7a6a9a;font-size:14px;">
        Um espaço criado para quem leva o próprio conteúdo a sério
      </p>

      <p style="margin:0 0 16px;line-height:1.7;">Olá, <strong>${nome}</strong>!</p>

      <p style="margin:0 0 20px;line-height:1.7;">
        Sua conta foi criada com sucesso. A Velvet existe para conectar criadores com os seus fãs de forma autêntica, segura e sustentável — e estamos felizes em ter você aqui.
      </p>

      ${infoBox("purple", `
        <p style="margin:0 0 8px;font-weight:bold;color:#4b2a7b;">📋 Próximo passo: validação da conta</p>
        <p style="margin:0;line-height:1.6;">
          Para ativar seu perfil e começar a receber assinantes, envie sua documentação pela página <strong>Conta</strong> na plataforma.
        </p>
      `)}

      ${infoBox("pink", `
        <p style="margin:0 0 8px;font-weight:bold;color:#7a1f52;">⏳ Prazo de 14 dias</p>
        <p style="margin:0;line-height:1.6;">
          Você tem <strong>14 dias</strong> para concluir a validação. Após esse período, contas não validadas são removidas automaticamente.
        </p>
      `)}

      <p style="margin:0 0 8px;font-weight:bold;color:#4b2a7b;">O que você pode fazer na Velvet:</p>
      <ul style="margin:0 0 20px;padding-left:20px;line-height:2;color:#2d1f3d;">
        <li>Criar um perfil personalizado com bio, capa e avatar</li>
        <li>Receber assinaturas mensais dos seus fãs</li>
        <li>Publicar mídias exclusivas</li>
        <li>Conversar diretamente com quem assina o seu perfil</li>
        <li>Acompanhar seus ganhos de forma transparente</li>
      </ul>

      ${infoBox("purple", `
        <p style="margin:0;line-height:1.6;font-size:13px;color:#4b2a7b;">
          Registrou-se por engano como criador(a)? Envie um email para
          <a href="mailto:contato@velvet.lat" style="color:#6f42c1;font-weight:bold;">contato@velvet.lat</a>
          e solicite a alteração para conta de fã.
        </p>
      `)}

      ${btnPrimary("https://www.velvet.lat", "Acessar a plataforma")}
    `)
  });
}

// ─────────────────────────────────────────────────────────────
// EMAIL PARA MODELOS ANTIGAS: assinar contrato
// ─────────────────────────────────────────────────────────────
async function enviarEmailContratoModelos(email, nomeCompleto) {
  const nome = (nomeCompleto || "").split(" ")[0] || "você";
  await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to: email,
    subject: "📄 Assine seu contrato — pagamentos a partir de 1º do mês",
    html: wrapEmail(`
      <h2 style="margin:0 0 6px;color:#6f42c1;text-align:center;font-size:22px;">
        Contrato de Parceria Velvet 📄
      </h2>
      <p style="text-align:center;margin:0 0 28px;color:#7a6a9a;font-size:14px;">
        Uma atualização importante sobre seus pagamentos
      </p>

      <p style="margin:0 0 16px;line-height:1.7;">Olá, <strong>${nome}</strong>!</p>

      <p style="margin:0 0 20px;line-height:1.7;">
        Para continuar recebendo seus pagamentos pela Velvet, precisamos que você assine o <strong>Contrato de Parceria</strong> digital.
        O processo é rápido, seguro e feito pela própria plataforma — leva menos de 2 minutos.
      </p>

      ${infoBox("purple", `
        <p style="margin:0 0 8px;font-weight:bold;color:#4b2a7b;">📅 Data de pagamento</p>
        <p style="margin:0;line-height:1.7;">
          Os pagamentos são processados sempre no <strong>1º dia de cada mês</strong>,
          exclusivamente para modelos que tenham:
        </p>
        <ul style="margin:10px 0 0;padding-left:18px;line-height:2;color:#4b2a7b;">
          <li>✅ Conta bancária / Pix <strong>validado</strong></li>
          <li>✅ Contrato de parceria <strong>assinado</strong></li>
        </ul>
      `)}

      ${infoBox("pink", `
        <p style="margin:0 0 6px;font-weight:bold;color:#7a1f52;">⚠️ Atenção</p>
        <p style="margin:0;line-height:1.7;">
          Modelos <strong>sem contrato assinado</strong> ou <strong>sem dados bancários validados</strong>
          não receberão pagamentos até que as pendências sejam resolvidas.
        </p>
      `)}

      <p style="margin:0 0 8px;line-height:1.7;color:#2d1f3d;">
        Para assinar, acesse sua conta na Velvet e vá até a seção <strong>Conta → Contrato</strong>:
      </p>

      ${btnPrimary("https://velvet.lat/conta.html", "✍️ Assinar Contrato Agora")}

      <p style="margin:20px 0 0;font-size:13px;color:#9b87b8;text-align:center;line-height:1.6;">
        O contrato é gerado com os seus dados cadastrais e assinado digitalmente com validade jurídica.<br>
        Dúvidas? Responda este email ou fale com a gente em
        <a href="mailto:contato@velvet.lat" style="color:#7B2CFF;">contato@velvet.lat</a>
      </p>
    `)
  });
}

// ─────────────────────────────────────────────────────────────
// NOTIFICAÇÃO INTERNA: contrato assinado → contato@velvet.lat
// ─────────────────────────────────────────────────────────────
async function enviarEmailNotificacaoContratoAssinado({ nomeCompleto, nomeExibicao, emailModelo, modeloId, assinadoEm, pdfR2Key }) {
  const data = assinadoEm
    ? new Date(assinadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })
    : new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });

  await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to: "contato@velvet.lat",
    subject: `✅ Contrato assinado — ${nomeCompleto || nomeExibicao || emailModelo}`,
    html: wrapEmail(`
      <h2 style="margin:0 0 6px;color:#6f42c1;text-align:center;font-size:21px;">
        ✅ Contrato Assinado
      </h2>
      <p style="text-align:center;margin:0 0 24px;color:#7a6a9a;font-size:14px;">
        Uma modelo acabou de assinar o contrato de parceria
      </p>

      ${infoBox("purple", `
        <p style="margin:0 0 4px;font-weight:bold;color:#4b2a7b;">👤 Dados da modelo</p>
        <table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:14px;color:#2d1f3d;">
          <tr><td style="padding:4px 0;width:140px;color:#7a6a9a;">Nome completo</td><td><strong>${nomeCompleto || "—"}</strong></td></tr>
          <tr><td style="padding:4px 0;color:#7a6a9a;">Nome de exibição</td><td>${nomeExibicao || "—"}</td></tr>
          <tr><td style="padding:4px 0;color:#7a6a9a;">E-mail</td><td>${emailModelo || "—"}</td></tr>
          <tr><td style="padding:4px 0;color:#7a6a9a;">ID na plataforma</td><td>${modeloId || "—"}</td></tr>
          <tr><td style="padding:4px 0;color:#7a6a9a;">Assinado em</td><td>${data}</td></tr>
        </table>
      `)}

      ${pdfR2Key ? infoBox("pink", `
        <p style="margin:0 0 4px;font-weight:bold;color:#7a1f52;">📎 PDF salvo no Cloudflare R2</p>
        <p style="margin:0;font-size:13px;color:#7a1f52;word-break:break-all;">${pdfR2Key}</p>
        <p style="margin:6px 0 0;font-size:12px;color:#9b87b8;">Acesse o painel R2 para fazer o download.</p>
      `) : infoBox("pink", `
        <p style="margin:0;color:#7a1f52;">⏳ O PDF será salvo no R2 em breve (processamento assíncrono do ZapSign).</p>
      `)}

      ${btnPrimary("https://velvet.lat/admin", "Ver Painel Admin")}
    `)
  });
}

// ─────────────────────────────────────────────────────────────
// EMAIL DE VERIFICAÇÃO DE ENDEREÇO DE EMAIL
// ─────────────────────────────────────────────────────────────
async function enviarEmailVerificacao(email, nomeCompleto, token) {
  const nome = (nomeCompleto || "").split(" ")[0] || "você";
  const link = `https://velvet.lat/verificar-email.html?token=${token}`;

  await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to: email,
    subject: "✉️ Confirme o seu endereço de email — Velvet",
    html: wrapEmail(`
      <h2 style="margin:0 0 6px;color:#6f42c1;text-align:center;font-size:22px;font-weight:700;">
        Confirme o seu email ✉️
      </h2>
      <p style="text-align:center;margin:0 0 28px;color:#7a6a9a;font-size:14px;">
        Um passo rápido para ativar a sua conta
      </p>

      <p style="margin:0 0 16px;line-height:1.7;font-size:15px;">Olá, <strong>${nome}</strong>! 👋</p>

      <p style="margin:0 0 20px;line-height:1.7;font-size:15px;">
        Obrigado por se registar na Velvet! Para confirmar que este email é válido
        e garantir que recebes todas as notificações importantes, clica no botão abaixo:
      </p>

      ${btnPrimary(link, "✅ Confirmar meu email")}

      ${infoBox("purple", `
        <p style="margin:0;font-size:13px;color:#4b2a7b;line-height:1.6;">
          ⏳ Este link é válido por <strong>48 horas</strong>.<br>
          Se não solicitaste este registo, podes ignorar este email.
        </p>
      `)}

      <p style="margin:20px 0 0;font-size:12px;color:#b0a0c8;text-align:center;word-break:break-all;">
        Link: ${link}
      </p>
    `)
  });
}

async function enviarEmailOTP(email, codigo) {
  const html = wrapEmail(`
    <h2 style="font-size:22px;font-weight:700;color:#2d1f3d;margin:0 0 8px;">Verificação de Email</h2>
    <p style="color:#4b2a7b;font-size:15px;line-height:1.7;margin:0 0 28px;">
      Usa o código abaixo para confirmar o teu email e concluir o cadastro na <strong>Velvet</strong>.
    </p>

    <div style="text-align:center;margin:32px 0;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:0 auto;">
        <tr>
          <td bgcolor="#7B2CFF" style="background-color:#7B2CFF;border-radius:16px;padding:20px 40px;text-align:center;">
            <span style="color:#ffffff;font-size:40px;font-weight:800;letter-spacing:14px;font-family:'Courier New',Courier,monospace;">${codigo}</span>
          </td>
        </tr>
      </table>
    </div>

    ${infoBox("purple", `
      <p style="margin:0;font-size:13px;color:#4b2a7b;">
        ⏱️ <strong>Este código expira em 15 minutos.</strong><br>
        Se não solicitaste este registo, podes ignorar este email com segurança.
      </p>
    `)}
  `);

  await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to: email,
    subject: `${codigo} — Código de verificação Velvet`,
    html
  });
}

module.exports = {
  enviarEmailValidacao,
  enviarEmailAprovacao,
  enviarEmailRejeicao,
  enviarEmailBoasVindasCliente,
  enviarEmailBoasVindasModelo,
  enviarEmailContratoModelos,
  enviarEmailNotificacaoContratoAssinado,
  enviarEmailVerificacao,
  enviarEmailOTP
};
