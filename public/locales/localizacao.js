// ===========================
// DETECÇÃO DE PAÍS E LOCALIZAÇÃO
// ===========================

const PAISES_CONFIG = {
  BR: {
    pais: "Brasil",
    moeda: "brl",
    simbolo: "R$",
    locale: "pt-BR",
    telefone: {
      mascara: "(00) 00000-0000",
      padrao: /^(\d{0,2})(\d{0,5})(\d{0,4})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length >= 10 && numeros.length <= 11;
      }
    },
    documento: {
      tipo: "CPF",
      mascara: "000.000.000-00",
      padrao: /^(\d{0,3})(\d{0,3})(\d{0,3})(\d{0,2})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        if (numeros.length !== 11) return false;
        if (/^(\d)\1{10}$/.test(numeros)) return false;
        return true;
      }
    }
  },
  US: {
    pais: "Estados Unidos",
    moeda: "usd",
    simbolo: "US$",
    locale: "en-US",
    telefone: {
      mascara: "(000) 000-0000",
      padrao: /^(\d{0,3})(\d{0,3})(\d{0,4})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 10;
      }
    },
    documento: {
      tipo: "SSN",
      mascara: "000-00-0000",
      padrao: /^(\d{0,3})(\d{0,2})(\d{0,4})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 9;
      }
    }
  },
  MX: {
    pais: "México",
    moeda: "usd",
    simbolo: "US$",
    locale: "es-MX",
    telefone: {
      mascara: "+52 (000) 0000-0000",
      padrao: /^(\d{0,2})(\d{0,3})(\d{0,4})(\d{0,4})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 10;
      }
    },
    documento: {
      tipo: "RFC",
      mascara: "XXXXXXXXXX000",
      padrao: /^([A-ZÑ&]{3,4})(\d{6})([A-V0-9]{3})(\d{3})$/i,
      validar: (valor) => {
        return valor.replace(/\D/g, "").length >= 13;
      }
    }
  },
  AR: {
    pais: "Argentina",
    moeda: "usd",
    simbolo: "US$",
    locale: "es-AR",
    telefone: {
      mascara: "+54 (000) 0000-0000",
      padrao: /^(\d{0,2})(\d{0,3})(\d{0,4})(\d{0,4})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 10;
      }
    },
    documento: {
      tipo: "DNI",
      mascara: "00.000.000",
      padrao: /^(\d{0,2})(\d{0,3})(\d{0,3})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 8;
      }
    }
  },
  PT: {
    pais: "Portugal",
    moeda: "eur",
    simbolo: "€",
    locale: "pt-PT",
    telefone: {
      mascara: "+351 000 000 000",
      padrao: /^(\d{0,3})(\d{0,3})(\d{0,3})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 9;
      }
    },
    documento: {
      tipo: "Cartão de Cidadão",
      mascara: "0000000 0 ZZ0",
      padrao: /^(\d{0,7})(\d{0,1})([A-Z]{0,2})(\d{0,1})$/i,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 8;
      }
    }
  },
  ES: {
    pais: "Espanha",
    moeda: "eur",
    simbolo: "€",
    locale: "es-ES",
    telefone: {
      mascara: "+34 000 00 00 00",
      padrao: /^(\d{0,3})(\d{0,2})(\d{0,2})(\d{0,2})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 9;
      }
    },
    documento: {
      tipo: "DNI",
      mascara: "00000000-X",
      padrao: /^(\d{0,8})([A-Z]?)$/i,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 8;
      }
    }
  },
  GB: {
    pais: "Reino Unido",
    moeda: "gbp",
    simbolo: "£",
    locale: "en-GB",
    telefone: {
      mascara: "+44 0000 000000",
      padrao: /^(\d{0,4})(\d{0,6})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length >= 10 && numeros.length <= 11;
      }
    },
    documento: {
      tipo: "Passport",
      mascara: "000000000",
      padrao: /^([A-Z]{1,2})(\d{0,7})$/i,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length >= 6 && numeros.length <= 9;
      }
    }
  },
  DE: {
    pais: "Alemanha",
    moeda: "eur",
    simbolo: "€",
    locale: "de-DE",
    telefone: {
      mascara: "+49 0000 000000",
      padrao: /^(\d{0,4})(\d{0,6})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length >= 10 && numeros.length <= 13;
      }
    },
    documento: {
      tipo: "Personalausweis",
      mascara: "000000000000000",
      padrao: /^(\d{0,15})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 12;
      }
    }
  },
  CO: {
    pais: "Colômbia",
    moeda: "usd",
    simbolo: "US$",
    locale: "es-CO",
    telefone: {
      mascara: "+57 (000) 0000-0000",
      padrao: /^(\d{0,2})(\d{0,3})(\d{0,4})(\d{0,4})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length === 10;
      }
    },
    documento: {
      tipo: "Cédula de Ciudadanía",
      mascara: "0000000000",
      padrao: /^(\d{0,10})$/,
      validar: (valor) => {
        const numeros = valor.replace(/\D/g, "");
        return numeros.length >= 8 && numeros.length <= 10;
      }
    }
  }
};

const MAPA_PAIS = {
  "pt": "BR",
  "pt-br": "BR",
  "pt-pt": "PT",
  "en-us": "US",
  "en-gb": "GB",
  "es": "ES",
  "es-mx": "MX",
  "es-ar": "AR",
  "es-co": "CO",
  "de": "DE",
  "de-de": "DE",
  "de-at": "DE",
  "de-ch": "DE"
};

let PAIS_DETECTADO = null;

/**
 * ✅ CORRIGIDO: Múltiplas APIs com headers corretos
 * Evita erro 403 adicionando User-Agent e headers apropriados
 */
async function detectarPaisPorGeolocation() {
  const apis = [
    {
      url: "https://api.country.is/",
      extrair: (data) => data.country?.toUpperCase(),
      nome: "country.is"
    },
    {
      url: "https://ipwho.is/",
      extrair: (data) => data.country_code?.toUpperCase(),
      nome: "ipwho.is"
    },
    {
      url: "https://ip-api.com/json/?fields=countryCode",
      extrair: (data) => data.countryCode?.toUpperCase(),
      nome: "ip-api.com"
    },
    {
      url: "https://ipapi.co/json/",
      extrair: (data) => data.country_code?.toUpperCase(),
      nome: "ipapi.co"
    }
  ];

  for (const api of apis) {
    try {
      console.log(`🌍 Tentando geolocalização: ${api.nome}`);
      
      // ✅ Headers corretos para evitar 403
      const response = await fetch(api.url, {
        method: "GET",
        headers: {
          "Accept": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        mode: "cors",
        cache: "no-cache"
      });

      if (!response.ok) {
        console.warn(`⚠️ ${api.nome} retornou status ${response.status}`);
        continue;
      }

      const data = await response.json();
      const codigoPais = api.extrair(data);

      if (codigoPais && PAISES_CONFIG[codigoPais]) {
        console.log(`✅ País detectado (${api.nome}): ${codigoPais}`);
        return codigoPais;
      }
    } catch (err) {
      console.warn(`❌ Erro na API ${api.nome}:`, err.message);
      continue;
    }
  }

  console.warn("⚠️ Nenhuma API de geolocalização funcionou");
  return null;
}

async function detectarPais() {
  // 1. Verificar se já tem salvo
  const paisSalvo = localStorage.getItem("pais_preferido");
  if (paisSalvo && PAISES_CONFIG[paisSalvo]) {
    PAIS_DETECTADO = paisSalvo;
    console.log(`✅ País carregado do localStorage: ${paisSalvo}`);
    return paisSalvo;
  }

  try {
    // 2. Tentar geolocalização com múltiplas APIs
    const paisPorGeo = await detectarPaisPorGeolocation();
    if (paisPorGeo) {
      PAIS_DETECTADO = paisPorGeo;
      return paisPorGeo;
    }
  } catch (err) {
    console.warn("❌ Erro ao detectar geolocalização:", err);
  }

  // 3. Fallback: Detectar por idioma do navegador
  console.log("↪️ Usando fallback: detecção por idioma do navegador");
  const paisPorIdioma = detectarPaisPorIdioma();
  PAIS_DETECTADO = paisPorIdioma;
  console.log(`✅ País detectado por idioma: ${paisPorIdioma}`);
  return paisPorIdioma;
}

function detectarPaisPorIdioma() {
  const lang = (navigator.language || navigator.languages?.[0] || "pt-BR").toLowerCase();
  
  if (MAPA_PAIS[lang]) {
    return MAPA_PAIS[lang];
  }

  const prefixo = lang.split("-")[0];
  for (const [chave, pais] of Object.entries(MAPA_PAIS)) {
    if (chave.startsWith(prefixo)) {
      return pais;
    }
  }
  return "BR"; // Fallback padrão
}

/**
 * Define manualmente o país preferido
 */
function definirPaisPreferido(codigoPais) {
  if (PAISES_CONFIG[codigoPais]) {
    PAIS_DETECTADO = codigoPais;
    localStorage.setItem("pais_preferido", codigoPais);
    return true;
  }
  return false;
}

/**
 * Obtém a configuração do país atual
 */
function obterConfigPaisAtual() {
  if (!PAIS_DETECTADO) {
    throw new Error("País não foi detectado. Chame detectarPais() primeiro.");
  }
  return PAISES_CONFIG[PAIS_DETECTADO];
}

// ===========================
// FUNÇÕES DE FORMATAÇÃO
// ===========================

/**
 * Formata valor de moeda de acordo com o país
 */
function formatarValorMoeda(valor, paisCode = null) {
  const pais = paisCode ? PAISES_CONFIG[paisCode] : obterConfigPaisAtual();
  const locale = pais.locale;
  
  return Number(valor || 0).toLocaleString(locale, {
    style: "currency",
    currency: pais.moeda.toUpperCase()
  });
}

/**
 * Aplica máscara de telefone
 */
function aplicarMascaraTelefone(valor, paisCode = null) {
  const pais = paisCode ? PAISES_CONFIG[paisCode] : obterConfigPaisAtual();
  const numeros = valor.replace(/\D/g, "");
  
  if (!pais.telefone.mascara) return numeros;

  let resultado = "";
  let indiceNumeros = 0;
  
  for (let i = 0; i < pais.telefone.mascara.length && indiceNumeros < numeros.length; i++) {
    if (pais.telefone.mascara[i] === "0") {
      resultado += numeros[indiceNumeros];
      indiceNumeros++;
    } else {
      resultado += pais.telefone.mascara[i];
    }
  }

  return resultado;
}

/**
 * Valida telefone
 */
function validarTelefone(valor, paisCode = null) {
  const pais = paisCode ? PAISES_CONFIG[paisCode] : obterConfigPaisAtual();
  return pais.telefone.validar(valor);
}

/**
 * Aplica máscara de documento
 */
function aplicarMascaraDocumento(valor, paisCode = null) {
  const pais = paisCode ? PAISES_CONFIG[paisCode] : obterConfigPaisAtual();
  const numeros = valor.replace(/\D/g, "");
  
  if (!pais.documento.mascara) return numeros;

  let resultado = "";
  let indiceNumeros = 0;
  
  for (let i = 0; i < pais.documento.mascara.length && indiceNumeros < numeros.length; i++) {
    if (pais.documento.mascara[i] === "0") {
      resultado += numeros[indiceNumeros];
      indiceNumeros++;
    } else {
      resultado += pais.documento.mascara[i];
    }
  }

  return resultado;
}

/**
 * Valida documento
 */
function validarDocumento(valor, paisCode = null) {
  const pais = paisCode ? PAISES_CONFIG[paisCode] : obterConfigPaisAtual();
  return pais.documento.validar(valor);
}

/**
 * Obtém tipo de documento para o país
 */
function obterTipoDocumento(paisCode = null) {
  const pais = paisCode ? PAISES_CONFIG[paisCode] : obterConfigPaisAtual();
  return pais.documento.tipo;
}

// ===========================
// INTEGRAÇÃO COM FORM
// ===========================

/**
 * Inicializa os campos de formulário de acordo com o país
 */
async function inicializarFormularioLocalizado() {
  const pais = await detectarPais();
  const config = PAISES_CONFIG[pais];

  // Atualizar labels
  const labelTelefone = document.querySelector('[data-i18n="chatc.label_phone"]');
  if (labelTelefone) {
    labelTelefone.textContent = `Telefone (${config.telefone.mascara})`;
  }

  const labelDocumento = document.querySelector('[data-i18n="chatc.label_cpf"]');
  if (labelDocumento) {
    labelDocumento.textContent = config.documento.tipo;
  }

  // Atualizar máxima de caracteres
  const inputTelefone = document.getElementById("phonePagamento");
  if (inputTelefone) {
    inputTelefone.maxLength = Math.max(config.telefone.mascara.length + 5, 20);
  }

  const inputDocumento = document.getElementById("cpfPagamento");
  if (inputDocumento) {
    inputDocumento.maxLength = Math.max(config.documento.mascara.length + 5, 20);
  }

  // Atualizar símbolos de moeda nos labels
  const labelConteudo = document.querySelector('[data-i18n="chatc.label_content"]');
  if (labelConteudo) {
    labelConteudo.textContent = `Conteúdo: ${config.simbolo}`;
  }

  const labelTaxa = document.querySelector('[data-i18n="chatc.label_fee"]');
  if (labelTaxa) {
    labelTaxa.textContent = `Taxa de Transação: ${config.simbolo}`;
  }

  const labelTotal = document.querySelector('[data-i18n="chatc.label_total"]');
  if (labelTotal) {
    labelTotal.textContent = `Total: ${config.simbolo}`;
  }
}

/**
 * Bind para inputs com formatação automática
 */
function bindInputsLocalizados() {
  const inputTelefone = document.getElementById("phonePagamento");
  if (inputTelefone) {
    inputTelefone.removeEventListener("input", aplicarMascaraInput);
    inputTelefone.addEventListener("input", aplicarMascaraInput);
  }

  const inputDocumento = document.getElementById("cpfPagamento");
  if (inputDocumento) {
    inputDocumento.removeEventListener("input", aplicarMascaraDocumentoInput);
    inputDocumento.addEventListener("input", aplicarMascaraDocumentoInput);
  }
}

/**
 * Handler para aplicar máscara de telefone
 */
function aplicarMascaraInput(e) {
  e.target.value = aplicarMascaraTelefone(e.target.value);
}

/**
 * Handler para aplicar máscara de documento
 */
function aplicarMascaraDocumentoInput(e) {
  e.target.value = aplicarMascaraDocumento(e.target.value);
}

/**
 * Valida dados iniciais com localização
 */
function validarDadosIniciaisLocalizados() {
  const documento = document.getElementById("cpfPagamento")?.value || "";
  const telefone = document.getElementById("phonePagamento")?.value || "";

  if (!validarDocumento(documento)) {
    alert(`${obterTipoDocumento()} inválido`);
    return false;
  }

  if (!validarTelefone(telefone)) {
    alert("Telefone inválido");
    return false;
  }

  return true;
}

// ===========================
// INICIALIZAÇÃO
// ===========================

// Executar ao carregar a página
document.addEventListener("DOMContentLoaded", async () => {
  await inicializarFormularioLocalizado();
  bindInputsLocalizados();
});

// Exportar para uso global
window.PAIS_DETECTADO = PAIS_DETECTADO;
window.PAISES_CONFIG = PAISES_CONFIG;
window.obterConfigPaisAtual = obterConfigPaisAtual;
window.definirPaisPreferido = definirPaisPreferido;
window.validarDocumento = validarDocumento;
window.validarTelefone = validarTelefone;
window.inicializarFormularioLocalizado = inicializarFormularioLocalizado;
window.detectarPais = detectarPais;
window.formatarValorMoeda = formatarValorMoeda;
window.aplicarMascaraTelefone = aplicarMascaraTelefone;
