async function abrirPopupPix() {
  if (!modelo_id) {
    alert("Modelo não identificada");
    return;
  }

  // 🔢 VALOR BASE (APENAS PARA UI)
  const valorAssinatura = 20.00;

  // 🔥 CÁLCULO APENAS VISUAL (BACKEND RECALCULA)
  const taxaTransacao  = Number((valorAssinatura * 0.10).toFixed(2));
  const taxaPlataforma = Number((valorAssinatura * 0.05).toFixed(2));
  const valorTotal     = Number(
    (valorAssinatura + taxaTransacao + taxaPlataforma).toFixed(2)
  );

  // 🧾 PREENCHE UI
  document.getElementById("pixValorBase").innerText =
    valorBRL(valorAssinatura);

  document.getElementById("pixTaxaTransacao").innerText =
    valorBRL(taxaTransacao);

  document.getElementById("pixTaxaPlataforma").innerText =
    valorBRL(taxaPlataforma);

  document.getElementById("pixValorTotal").innerText =
    valorBRL(valorTotal);

  // 🔓 ABRE POPUP
  document.getElementById("popupPix").classList.remove("hidden");

  // 🔥 CRIA PIX NO BACKEND
  const res = await fetch("/api/pagamento/vip/pix", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({
      modelo_id,
      valor_assinatura: valorAssinatura // 👈 SÓ ISSO
    })
  });

  const data = await res.json();

  if (!res.ok) {
    alert(data.error || "Erro ao gerar PIX");
    return;
  }
  
  // 📲 MOSTRA PIX
  document.getElementById("pixQr").src =
    "data:image/png;base64," + data.qr_code;

  document.getElementById("pixCopia").value = data.copia_cola;

  // guarda id do pagamento
  window.__PIX_PAYMENT_ID__ = data.payment_id;
}

function copiarPix() {
  const textarea = document.getElementById("pixCopia");
  textarea.select();
  document.execCommand("copy");
  alert("Código Pix copiado 💜");
}


async function pagarComCartao() {
  fecharEscolha();

  // 🔢 VALOR BASE (ASSINATURA)
  const valorAssinatura = 20.00;

  // 🔥 TAXAS PERCENTUAIS (CORRETO)
  const taxaTransacao  = Number((valorAssinatura * 0.10).toFixed(2)); // 10%
  const taxaPlataforma = Number((valorAssinatura * 0.05).toFixed(2)); // 5%

  const valorTotal = Number(
    (valorAssinatura + taxaTransacao + taxaPlataforma).toFixed(2)
  );

  // 🧾 UI
  document.getElementById("cartaoValorBase").innerText =
    valorBRL(valorAssinatura);

  document.getElementById("cartaoTaxaTransacao").innerText =
    valorBRL(taxaTransacao);

  document.getElementById("cartaoTaxaPlataforma").innerText =
    valorBRL(taxaPlataforma);

  document.getElementById("cartaoValorTotal").innerText =
    valorBRL(valorTotal);

  // 🔓 ABRE MODAL
  document.getElementById("paymentModal").classList.remove("hidden");

  // 🔥 CRIA PAYMENT INTENT
  const res = await fetch("/api/pagamento/vip/cartao", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token
    },
    body: JSON.stringify({
      modelo_id,
      valor_assinatura: valorAssinatura,
      taxa_transacao: taxaTransacao,
      taxa_plataforma: taxaPlataforma
    })
   });

   const data = await res.json();

   if (!res.ok) {
    alert(data.error || "Erro no pagamento");
    return;
  }

  elements = stripe.elements({ clientSecret: data.clientSecret });

  const paymentElement = elements.create("payment");
  paymentElement.mount("#payment-element");
}


 // ===============================
 // 💳 CONFIRMAR PAGAMENTO CARTÃO
 // ===============================
 document
  .querySelector("#paymentModal .btn-confirmar-desbloqueio")
  ?.addEventListener("click", async () => {

    if (!elements) {
      alert("Pagamento ainda não inicializado");
      return;
    }

    const { error } = await stripe.confirmPayment({
      elements,
      confirmParams: {
        return_url: window.location.href // fallback se Stripe pedir redirect
      }
    });

    if (error) {
      alert(error.message);
    }
});