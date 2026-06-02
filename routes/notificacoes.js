const express = require("express");
const router = express.Router();
const db = require("../db");
const auth = require("../middleware/auth");

router.post("/inscrever", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const subscription = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ error: "Subscription inválida" });
    }
    await db.query(
      `INSERT INTO push_subscriptions (user_id, subscription_json, created_at, updated_at)
       VALUES ($1, $2, NOW(), NOW())
       ON CONFLICT (user_id)
       DO UPDATE SET subscription_json = EXCLUDED.subscription_json, updated_at = NOW()`,
      [userId, JSON.stringify(subscription)]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao salvar subscription:", err);
    return res.status(500).json({ error: "Erro ao salvar subscription" });
  }
});

router.post("/inscrever-dispositivo", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    const { token, platform } = req.body;
    if (!token || !platform) {
      return res.status(400).json({ error: "Token ou plataforma inválidos" });
    }
    await db.query(
      `INSERT INTO device_push_tokens (user_id, token, platform, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT (user_id, platform)
       DO UPDATE SET token = EXCLUDED.token, updated_at = NOW()`,
      [userId, token, platform]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao salvar device token:", err);
    return res.status(500).json({ error: "Erro ao salvar token do dispositivo" });
  }
});

router.post("/desinscrever", auth, async (req, res) => {
  try {
    const userId = req.user.id;
    await db.query(`DELETE FROM push_subscriptions WHERE user_id = $1`, [userId]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("Erro ao remover subscription:", err);
    return res.status(500).json({ error: "Erro ao remover subscription" });
  }
});

module.exports = router;
