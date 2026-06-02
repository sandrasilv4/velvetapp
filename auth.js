// auth.js — guard desativado para modo portfólio público
(function () {
  const token = localStorage.getItem("token");
  void token; // token disponível mas sem redirect obrigatório
})();
