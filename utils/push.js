const db = require("../db");
const { webpush, admin } = require("../config/services");

async function enviarPush(subscription, mensagem, url = "/inbox.html", remetente = "Nova mensagem") {
  const payload = JSON.stringify({ title: remetente, body: mensagem, url });
  await webpush.sendNotification(subscription, payload);
}

async function enviarFCM(deviceToken, titulo, mensagem, url) {
  if (!admin.apps.length) return;
  await admin.messaging().send({
    token: deviceToken,
    notification: { title: titulo, body: mensagem },
    data: { url: url || "/inbox.html" },
    android: { priority: "high" },
    apns: { payload: { aps: { sound: "default" } } }
  });
}

async function notificarNovaMensagem(userIdDestino, textoMensagem, url = "/inbox.html", remetente = "Nova mensagem") {
  const erros = [];

  if (process.env.VAPID_SUBJECT && process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    try {
      const subRes = await db.query(
        `SELECT subscription_json FROM push_subscriptions WHERE user_id = $1 LIMIT 1`,
        [userIdDestino]
      );
      if (subRes.rowCount > 0) {
        await enviarPush(subRes.rows[0].subscription_json, textoMensagem, url, remetente);
      }
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [userIdDestino]);
      } else {
        erros.push(err);
      }
    }
  }

  if (admin.apps.length) {
    try {
      const tokRes = await db.query(
        `SELECT token, platform FROM device_push_tokens WHERE user_id = $1`,
        [userIdDestino]
      );
      for (const row of tokRes.rows) {
        try {
          await enviarFCM(row.token, remetente, textoMensagem, url);
        } catch (err) {
          if (err.code === "messaging/registration-token-not-registered") {
            await db.query(
              `DELETE FROM device_push_tokens WHERE user_id = $1 AND platform = $2`,
              [userIdDestino, row.platform]
            );
          } else {
            erros.push(err);
          }
        }
      }
    } catch (err) {
      erros.push(err);
    }
  }

  if (erros.length) {
    console.error("Erros ao enviar push:", erros);
  }
}

module.exports = { enviarPush, enviarFCM, notificarNovaMensagem };
