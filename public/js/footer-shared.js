/* footer-shared.js — footer único para todas as páginas internas
   Para atualizar o footer em todas as páginas, edite apenas este arquivo.
   Cada página deve ter: <div id="footer-container"></div>
   e carregar este script: <script src="/testes/footer-shared.js"></script>
*/
(function () {
  const html = `
  <footer class="footer">
    <div class="footer-links">
      <a href="/terms.html" target="_blank" rel="noopener noreferrer" data-i18n="footer.termos">Termos de Uso</a>
      <a href="/privacy.html" target="_blank" rel="noopener noreferrer" data-i18n="footer.privacidade">Política de Privacidade</a>
      <a href="/policies.html" data-i18n="footer.politicas">Política de Utilização</a>
    </div>
    <div class="footer-copy" data-i18n="footer.copy">© 2026 Velvet. Todos os direitos reservados.</div>
  </footer>`;

  function inject() {
    const container = document.getElementById('footer-container');
    if (container) container.innerHTML = html;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
