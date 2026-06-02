const axios = require("axios");

async function criarPixPagarme({
  valor,
  cpf,
  nome,
  email,
  conteudo_id,
  cliente_id,
  modelo_id
}) {

  const valorCentavos = Math.round(valor * 100);

  const res = await axios.post(
    "https://api.pagar.me/core/v5/orders",
    {
      items: [{
        amount: valorCentavos,
        description: "Midia Velvet",
        quantity: 1
      }],

      customer: {
        name: nome || "Cliente Velvet",
        email: email,
        document: cpf,
        type: "individual"
      },

      payments: [{
        payment_method: "pix",
        pix: { expires_in: 3600 }
      }],

      metadata: {
        tipo: "conteudo_pix",
        message_id: conteudo_id,
        cliente_id,
        modelo_id
      }
    },
    {
      headers: {
        Authorization: `Basic ${Buffer
          .from(process.env.PAGARME_SECRET_KEY + ":")
          .toString("base64")}`,
        "Content-Type": "application/json"
      }
    }
  );

  const order = res.data;
  const pix = order.charges[0].last_transaction;

  return {
    qr_code: pix.qr_code,
    qr_code_base64: null,
    payment_id: order.id
  };
}

module.exports = criarPixPagarme;