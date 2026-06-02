const form = document.getElementById("contatoForm");
const status = document.getElementById("status");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  status.className = "status";
  status.textContent = t("contato.contact_sending");
  status.style.color = "#7B2CFF";

  const data = Object.fromEntries(new FormData(form));

  try {
    const response = await fetch("/api/contato", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });

    if (!response.ok) throw new Error();

    status.className = "status success";
    status.textContent = t("contato.contact_success");
    form.reset();
  } catch {
    status.className = "status error";
    status.textContent = t("contato.contact_error");
  }
});




