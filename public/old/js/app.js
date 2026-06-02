function abrirInbox() {
  document.getElementById("view-inbox").innerHTML = `
    <div class="inbox">
      <p style="padding:16px">Inbox carregado com sucesso ✅</p>
    </div>
  `;

  document.getElementById("view-inbox").classList.add("active");
  document.getElementById("view-chat").classList.remove("active");
  document.getElementById("topbar-title").innerText = "Velvet";
}

function abrirChat() {
  document.getElementById("view-chat").innerHTML = `
    <div style="padding:16px">
      <p><strong>Chat aberto 💬</strong></p>
      <p>A barra de endereço NÃO voltou 🎉</p>
    </div>
  `;

  document.getElementById("view-chat").classList.add("active");
  document.getElementById("view-inbox").classList.remove("active");
  document.getElementById("topbar-title").innerText = "Modelo Teste";
}


function voltarInbox() {
  abrirInbox();
}


abrirInbox();
