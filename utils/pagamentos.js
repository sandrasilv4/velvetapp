const axios = require("axios");

function calcTaxaStripe(valorBase) {
  const taxaTransacao = Number((valorBase * 0.15).toFixed(2));
  const valorTotal    = Number((valorBase + taxaTransacao).toFixed(2));
  return { taxaTransacao, taxaPlataforma: 0, valorTotal };
}

function calcTaxaAsaas(valorBase) {
  const taxaCalculada = Number((1.99 + valorBase * 0.10).toFixed(2));
  const totalBruto    = Number((valorBase + taxaCalculada).toFixed(2));
  const MINIMO_ASAAS  = 5.00;
  const valorTotal    = Number(Math.max(MINIMO_ASAAS, totalBruto).toFixed(2));
  const taxaTransacao = Number((valorTotal - valorBase).toFixed(2));
  return { taxaTransacao, taxaPlataforma: 0, valorTotal };
}

const ABACATEPAY_BASE = "https://api.abacatepay.com/v2";

async function abacatePayRequest(method, path, body) {
  const res = await axios({
    method,
    url: `${ABACATEPAY_BASE}${path}`,
    data: body,
    headers: {
      "Authorization": `Bearer ${process.env.ABACATEPAY_API_KEY}`,
      "Content-Type": "application/json"
    }
  });
  return res.data;
}

const ASAAS_BASE = process.env.NODE_ENV === "production"
  ? "https://api.asaas.com/v3"
  : "https://sandbox.asaas.com/api/v3";

async function asaasRequest(method, path, body) {
  const res = await axios({
    method,
    url: `${ASAAS_BASE}${path}`,
    data: body,
    headers: {
      "access_token": process.env.ASAAS_API_KEY,
      "Content-Type": "application/json",
      "User-Agent": "Velvet/1.0"
    }
  });
  return res.data;
}

async function criarOuBuscarClienteAsaas(cpfCnpj, nome, email, telefone) {
  try {
    const search = await asaasRequest("GET", `/customers?cpfCnpj=${cpfCnpj}&limit=1`);
    if (search.data?.length > 0) return search.data[0].id;
  } catch (_) {}
  const customer = await asaasRequest("POST", "/customers", {
    name: nome,
    cpfCnpj,
    email,
    mobilePhone: telefone || undefined
  });
  return customer.id;
}

let _rateCache = { rate: null, at: 0 };

async function getBRLtoUSDRate() {
  const age = Date.now() - _rateCache.at;
  if (_rateCache.rate && age < 4 * 60 * 60 * 1000) return _rateCache.rate;
  const resp = await fetch("https://api.exchangerate-api.com/v4/latest/USD");
  if (!resp.ok) throw new Error("Falha ao buscar taxa de câmbio");
  const data = await resp.json();
  const rate = data.rates?.BRL;
  if (!rate) throw new Error("Taxa BRL não encontrada");
  _rateCache = { rate, at: Date.now() };
  return rate;
}

async function calcAsaasAmount(valorBRL, currency) {
  if (currency !== "usd") {
    return { valorReais: valorBRL, valorConvertido: valorBRL, taxaCambio: null };
  }
  const rate = await getBRLtoUSDRate();
  const valorUSD = valorBRL / rate;
  return {
    valorReais: valorBRL,
    valorConvertido: Number(valorUSD.toFixed(2)),
    taxaCambio: rate
  };
}

module.exports = {
  calcTaxaStripe,
  calcTaxaAsaas,
  abacatePayRequest,
  asaasRequest,
  criarOuBuscarClienteAsaas,
  getBRLtoUSDRate,
  calcAsaasAmount
};
