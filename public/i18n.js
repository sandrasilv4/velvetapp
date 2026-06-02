const IDIOMAS_DISPONIVEIS = ["pt", "en", "es"];
const IDIOMA_PADRAO = "pt";

let _traducoes = {};
let _i18nReady = Promise.resolve();
let _i18nInicializado = false;

function getCurrentLanguage() {
  const guardado = localStorage.getItem("idioma");
  if (guardado && IDIOMAS_DISPONIVEIS.includes(guardado)) return guardado;

  const browser = navigator.language?.slice(0, 2);
  if (IDIOMAS_DISPONIVEIS.includes(browser)) return browser;

  return IDIOMA_PADRAO;
}

function setCurrentLanguage(lang) {
  if (IDIOMAS_DISPONIVEIS.includes(lang)) {
    localStorage.setItem("idioma", lang);
  }
}

function t(key) {
  const partes = key.split(".");
  let valor = _traducoes;

  for (const parte of partes) {
    if (valor && typeof valor === "object" && parte in valor) {
      valor = valor[parte];
    } else {
      console.warn(`[i18n] chave não encontrada: ${key}`);
      return key;
    }
  }

  return typeof valor === "string" ? valor : key;
}

function applyTranslations(root = document) {
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });

  root.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  });

  root.querySelectorAll("[data-i18n-title]").forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });

  root.querySelectorAll("[data-i18n-alt]").forEach(el => {
    el.alt = t(el.dataset.i18nAlt);
  });
}

async function carregarIdioma(idioma) {
  if (!IDIOMAS_DISPONIVEIS.includes(idioma)) idioma = IDIOMA_PADRAO;

  try {
    const res = await fetch(`/locales/${idioma}.json`);
    if (!res.ok) throw new Error(`Erro ao carregar /locales/${idioma}.json`);

    _traducoes = await res.json();
    localStorage.setItem("idioma", idioma);
    return _traducoes;
  } catch (err) {
    console.error("[i18n]", err);

    if (idioma !== IDIOMA_PADRAO) {
      return carregarIdioma(IDIOMA_PADRAO);
    }

    _traducoes = {};
    return _traducoes;
  }
}

async function inicializarIdioma() {
  const idioma = getCurrentLanguage();
  await carregarIdioma(idioma);
  applyTranslations();
  _i18nInicializado = true;
}

function initLanguageSwitcher() {
  const select = document.getElementById("languageSwitcher");
  if (!select) return;

  select.value = getCurrentLanguage();

  if (select.dataset.i18nBound === "true") return;
  select.dataset.i18nBound = "true";

  select.addEventListener("change", async () => {
    _i18nReady = (async () => {
      await carregarIdioma(select.value);
      applyTranslations();

      window.dispatchEvent(new CustomEvent("languageChanged", {
        detail: { language: select.value }
      }));
    })();

    await _i18nReady;
  });
}

function whenI18nReady() {
  return _i18nReady;
}

window.t = t;
window.applyTranslations = applyTranslations;
window.inicializarIdioma = inicializarIdioma;
window.carregarIdioma = carregarIdioma;
window.getCurrentLanguage = getCurrentLanguage;
window.setCurrentLanguage = setCurrentLanguage;
window.initLanguageSwitcher = initLanguageSwitcher;
window.whenI18nReady = whenI18nReady;

document.addEventListener("DOMContentLoaded", () => {
  _i18nReady = (async () => {
    await inicializarIdioma();
    initLanguageSwitcher();
  })();
});