const db = require("./db");
const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

async function enviarEmail(to, assunto, html) {

  const response = await resend.emails.send({
    from: "Velvet <contato@velvet.lat>",
    to,
    subject: assunto,
    html
  });

  console.log("📨 Resend response:", JSON.stringify(response, null, 2));

  if (response.error) {
    throw new Error(JSON.stringify(response.error));
  }

  return response;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function processarAvisos() {

  console.log("🔔 Verificando assinaturas próximas do vencimento...");

  // ==============================
  // 📅 AVISO 7 DIAS
  // ==============================
const seteDias = await db.query(`
  SELECT v.id, v.modelo_id, u.email
  FROM vip_subscriptions v
  JOIN clientes c ON c.id = v.cliente_id
  JOIN users u ON u.id = c.user_id
  WHERE v.ativo = true
    AND v.aviso_7_dias_enviado = false
    AND v.expiration_at BETWEEN
        NOW() + INTERVAL '6 days'
        AND NOW() + INTERVAL '7 days'
`);

  for (const row of seteDias.rows) {

    const linkPerfil = `https://velvet.lat/perfil.html?modelo_id=${row.modelo_id}`;

    try {

      await enviarEmail(
        row.email,
        "Seu VIP expira em 7 dias 💜",
        `
          <div style="font-family:Arial,Helvetica,sans-serif;background:#f0ebfa;padding:32px 16px;color:#2d1f3d;">
            <div style="max-width:600px;margin:0 auto;">

              <div style="background:linear-gradient(135deg,#7B2CFF 0%,#a94cff 100%);border-radius:14px 14px 0 0;padding:20px 32px;text-align:center;">
                <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:1px;">💜 Velvet</span>
              </div>

              <div style="background:#fff;padding:32px;border-radius:0 0 14px 14px;border:1px solid #e5d9ff;border-top:none;">

                <h2 style="margin:0 0 6px;color:#6f42c1;text-align:center;font-size:20px;">
                  Sua assinatura VIP está chegando ao fim
                </h2>
                <p style="text-align:center;margin:0 0 24px;color:#7a6a9a;font-size:14px;">
                  Renove para manter seu acesso exclusivo
                </p>

                <div style="background:#f8f4ff;border-left:4px solid #7B2CFF;border-radius:0 10px 10px 0;padding:14px 18px;margin:0 0 20px;">
                  <p style="margin:0;font-weight:bold;color:#6f42c1;font-size:15px;">
                    ⏳ Faltam 7 dias para o vencimento
                  </p>
                </div>

                <p style="margin:0 0 20px;line-height:1.7;">
                  Olá! A sua assinatura VIP está próxima do vencimento. Renove agora para continuar com acesso ao conteúdo exclusivo e ao chat direto com a criadora.
                </p>

                <div style="background:#f8f4ff;padding:16px 20px;border-radius:10px;margin:0 0 24px;">
                  <p style="margin:0 0 10px;font-weight:bold;color:#4b2a7b;font-size:14px;">Com o VIP ativo você tem acesso a:</p>
                  <p style="margin:0;line-height:2;font-size:14px;">
                    💬 Chat direto com a criadora<br>
                    🎁 Conteúdo exclusivo do perfil<br>
                    ✨ Benefícios especiais para assinantes
                  </p>
                </div>

                <div style="text-align:center;margin:24px 0 8px;">
                  <a href="${linkPerfil}" style="display:inline-block;background:linear-gradient(135deg,#7B2CFF,#a94cff);color:#fff;text-decoration:none;padding:15px 32px;border-radius:10px;font-weight:bold;font-size:15px;">
                    Renovar VIP agora
                  </a>
                </div>

                <div style="margin-top:28px;padding-top:18px;border-top:1px solid #f0ebfa;text-align:center;">
                  <p style="margin:0 0 4px;color:#6b5a7d;">Equipe Velvet 💜</p>
                  <p style="margin:0;font-size:13px;color:#9b87b8;">
                    Dúvidas? <a href="mailto:contato@velvet.lat" style="color:#7B2CFF;">contato@velvet.lat</a>
                  </p>
                </div>

              </div>
            </div>
          </div>
        `
      );
      await sleep(600);
      console.log("7 dias encontrados:", seteDias.rows.length);

      await db.query(
        "UPDATE vip_subscriptions SET aviso_7_dias_enviado = true WHERE id = $1",
        [row.id]
      );

    } catch (err) {
      console.error("Erro ao enviar aviso 7 dias:", err);
    }
  }

  // ==============================
  // ⏰ AVISO 24 HORAS
  // ==============================
const vinte4h = await db.query(`
  SELECT v.id, v.modelo_id, u.email
  FROM vip_subscriptions v
  JOIN clientes c ON c.id = v.cliente_id
  JOIN users u ON u.id = c.user_id
  WHERE v.ativo = true
    AND v.aviso_24h_enviado = false
    AND v.expiration_at BETWEEN
        NOW()
        AND NOW() + INTERVAL '1 day'
`);

  for (const row of vinte4h.rows) {

    const linkPerfil = `https://velvet.lat/perfil.html?modelo_id=${row.modelo_id}`;

    try {

      await enviarEmail(
        row.email,
        "⏰ Seu VIP expira amanhã — renove agora!",
        `
          <div style="font-family:Arial,Helvetica,sans-serif;background:#f0ebfa;padding:32px 16px;color:#2d1f3d;">
            <div style="max-width:600px;margin:0 auto;">

              <div style="background:linear-gradient(135deg,#7B2CFF 0%,#a94cff 100%);border-radius:14px 14px 0 0;padding:20px 32px;text-align:center;">
                <span style="color:#fff;font-size:20px;font-weight:800;letter-spacing:1px;">💜 Velvet</span>
              </div>

              <div style="background:#fff;padding:32px;border-radius:0 0 14px 14px;border:1px solid #e5d9ff;border-top:none;">

                <h2 style="margin:0 0 6px;color:#b0307d;text-align:center;font-size:20px;">
                  Última chance de renovar seu VIP
                </h2>
                <p style="text-align:center;margin:0 0 24px;color:#7a6a9a;font-size:14px;">
                  Seu acesso expira em menos de 24 horas
                </p>

                <div style="background:#fff2f8;border-left:4px solid #b0307d;border-radius:0 10px 10px 0;padding:14px 18px;margin:0 0 20px;">
                  <p style="margin:0;font-weight:bold;color:#b0307d;font-size:15px;">
                    🚨 Expira amanhã — não perca seu acesso!
                  </p>
                </div>

                <p style="margin:0 0 20px;line-height:1.7;">
                  Olá! A sua assinatura VIP termina amanhã. Renove agora para não perder o acesso ao conteúdo exclusivo e ao chat direto com a criadora.
                </p>

                <div style="background:#fff7fb;padding:16px 20px;border-radius:10px;margin:0 0 24px;">
                  <p style="margin:0 0 10px;font-weight:bold;color:#7a1f52;font-size:14px;">O que você perde ao não renovar:</p>
                  <p style="margin:0;line-height:2;font-size:14px;">
                    💬 Acesso ao chat exclusivo<br>
                    🎁 Todo o conteúdo do perfil<br>
                    ✨ Seus benefícios de assinante
                  </p>
                </div>

                <div style="text-align:center;margin:24px 0 8px;">
                  <a href="${linkPerfil}" style="display:inline-block;background:linear-gradient(135deg,#b0307d,#d45fa0);color:#fff;text-decoration:none;padding:15px 32px;border-radius:10px;font-weight:bold;font-size:15px;">
                    Renovar VIP agora
                  </a>
                </div>

                <div style="margin-top:28px;padding-top:18px;border-top:1px solid #f0ebfa;text-align:center;">
                  <p style="margin:0 0 4px;color:#6b5a7d;">Equipe Velvet 💜</p>
                  <p style="margin:0;font-size:13px;color:#9b87b8;">
                    Dúvidas? <a href="mailto:contato@velvet.lat" style="color:#7B2CFF;">contato@velvet.lat</a>
                  </p>
                </div>

              </div>
            </div>
          </div>
        `
      );
      await sleep(600);

          console.log("24h encontrados:", vinte4h.rows.length);

      await db.query(
        "UPDATE vip_subscriptions SET aviso_24h_enviado = true WHERE id = $1",
        [row.id]
      );

    } catch (err) {
      console.error("Erro ao enviar aviso 24h:", err);
    }
  }

  console.log("✅ Avisos processados");
  process.exit();
}

processarAvisos();