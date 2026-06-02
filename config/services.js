const { Resend } = require("resend");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const webpush = require("web-push");
const admin = require("firebase-admin");

const resend = new Resend(process.env.RESEND_API_KEY);

if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    }
  } catch (e) {
    console.warn("Firebase Admin não inicializado:", e.message);
  }
}

if (
  process.env.VAPID_SUBJECT &&
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  console.log("VAPID configurado com sucesso");
} else {
  console.warn("VAPID não configurado. Push desativado por enquanto.");
}

module.exports = { resend, stripe, webpush, admin };
