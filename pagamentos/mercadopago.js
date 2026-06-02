const axios = require("axios");

// async function criarPixMercadoPago({
//   valor,
//   cpf,
//   nome,
//   email,
//   conteudo_id,
//   cliente_id,
//   modelo_id
// }) {

//   const res = await axios.post(
//     "https://api.mercadopago.com/v1/payments",
//     {
//       transaction_amount: Number(valor),
//       description: "Midia Velvet",
//       payment_method_id: "pix",

//       payer: {
//         email: email,
//         first_name: nome || "Cliente Velvet",
//         identification: {
//           type: "CPF",
//           number: cpf
//         }
//       },

//       metadata: {
//         tipo: "conteudo_pix",
//         message_id: conteudo_id,
//         cliente_id,
//         modelo_id
//       }
//     },
//     {
//       headers: {
//         Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
//         "X-Idempotency-Key": `pix_${cliente_id}_${conteudo_id}`,
//         "Content-Type": "application/json"
//       }
//     }
//   );

//   const payment = res.data;
//   const pix = payment.point_of_interaction.transaction_data;

//   return {
//     qr_code: pix.qr_code,
//     qr_code_base64: pix.qr_code_base64,
//     payment_id: paymentId
//   };
// }

// module.exports = criarPixMercadoPago;