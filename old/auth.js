// auth.js — simples, seguro e estável

(function () {
  const token = localStorage.getItem("token");

  if (!token) {
    alert("Sessão expirada. Faça login novamente.");
    window.location.href = "/";
  }
})();
