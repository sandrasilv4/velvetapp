const PDFDocument = require("pdfkit");
const axios = require("axios");
const db = require("../db");
const { s3Privado } = require("../config/storage");

function gerarContratoPDFBuffer(dados) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 60, bufferPages: true });
    const chunks = [];
    doc.on("data", c => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const L = 60;
    const W = doc.page.width - L * 2;

    function titulo(txt) {
      doc.moveDown(0.6)
         .font("Helvetica-Bold").fontSize(10)
         .text(txt, L, doc.y, { width: W })
         .font("Helvetica").fontSize(9);
    }
    function corpo(txt) {
      doc.font("Helvetica").fontSize(9)
         .text(txt, L, doc.y, { width: W, lineGap: 2 });
    }
    function lista(itens) {
      itens.forEach(it => {
        doc.font("Helvetica").fontSize(9)
           .text(`• ${it}`, L + 12, doc.y, { width: W - 12, lineGap: 1 });
      });
    }

    doc.font("Helvetica-Bold").fontSize(12)
       .text("CONTRATO DE PARCERIA DIGITAL, INTERMEDIAÇÃO TECNOLÓGICA", L, L, { width: W, align: "center" })
       .text("E USO DA PLATAFORMA VELVET", L, doc.y, { width: W, align: "center" });
    doc.moveDown(0.8);

    doc.font("Helvetica").fontSize(9)
       .text("Pelo presente instrumento particular, de um lado:", L, doc.y, { width: W });
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(9)
       .text("VELVET ENTERTAINMENT LTDA", L, doc.y, { width: W, continued: true })
       .font("Helvetica")
       .text(`, pessoa jurídica de direito privado, inscrita no CNPJ sob nº 66.615.892/0001-43, com sede na Rua Cel. José Eusébio, nº 95, Casa 13, Higienópolis, São Paulo/SP, CEP 01.239-030, doravante denominada simplesmente "VELVET";`, { width: W });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9).text("e, de outro lado,", L, doc.y, { width: W });
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(9)
       .text("CRIADORA DE CONTEÚDO / MODELO / INFLUENCER", L, doc.y, { width: W, continued: true })
       .font("Helvetica")
       .text(`, pessoa física maior de 18 (dezoito) anos, devidamente cadastrada na plataforma digital Velvet, doravante denominada simplesmente "CRIADORA";`, { width: W });
    doc.moveDown(0.5);
    doc.font("Helvetica").fontSize(9)
       .text("resolvem celebrar o presente CONTRATO DE PARCERIA DIGITAL E INTERMEDIAÇÃO TECNOLÓGICA, mediante as cláusulas e condições abaixo:", L, doc.y, { width: W });

    titulo("CLÁUSULA 1 – OBJETO");
    corpo("1.1. O presente contrato regula a utilização da plataforma digital Velvet pela CRIADORA para:");
    lista(["publicação;", "hospedagem;", "monetização;", "comercialização;", "distribuição digital;", "disponibilização de conteúdo online."]);
    corpo("1.2. A VELVET atua exclusivamente como:");
    lista(["plataforma tecnológica;", "marketplace digital;", "intermediadora de pagamentos;", "hospedeira de conteúdo;", "facilitadora de monetização digital."]);

    titulo("CLÁUSULA 2 – NATUREZA AUTÔNOMA DA RELAÇÃO");
    corpo("2.1. A CRIADORA reconhece expressamente que exerce atividade autônoma e independente.");
    corpo("2.2. O presente contrato não caracteriza: vínculo empregatício, relação trabalhista, sociedade ou representação comercial de qualquer natureza.");

    titulo("CLÁUSULA 3 – COMISSÃO E REPASSES");
    corpo("3.1. Pela disponibilização da infraestrutura tecnológica, a VELVET fará jus à comissão de 20% sobre os valores líquidos efetivamente recebidos.");
    corpo("3.2. O percentual remanescente pertencerá integralmente à CRIADORA.");

    titulo("CLÁUSULA 16 – FORO");
    corpo("16.1. Fica eleito o foro da Comarca de São Paulo/SP para resolução de quaisquer controvérsias oriundas deste contrato.");

    doc.moveDown(0.8);
    doc.font("Helvetica-Bold").fontSize(10)
       .text("DECLARAÇÃO FINAL DA CRIADORA", L, doc.y, { width: W, align: "center" });
    doc.moveDown(0.4);
    doc.font("Helvetica").fontSize(9)
       .text("Ao aceitar este contrato, a CRIADORA declara expressamente que:", L, doc.y, { width: W });
    doc.moveDown(0.3);
    lista([
      "I – atua de forma autônoma e independente;",
      "II – compreende que a VELVET é apenas plataforma digital;",
      "III – reconhece inexistência de vínculo empregatício;",
      "IV – é maior de 18 anos;",
      "V – assume responsabilidade integral pelos conteúdos publicados."
    ]);

    doc.moveDown(1.2);
    doc.font("Helvetica").fontSize(9)
       .text(`São Paulo/SP, ${dados.dataHoje}.`, L, doc.y, { width: W });
    doc.moveDown(1.2);

    const metade = (W - 40) / 2;
    const col2 = L + metade + 40;

    doc.font("Helvetica-Bold").fontSize(9)
       .text("VELVET ENTERTAINMENT LTDA", L, doc.y, { width: metade });
    const yAssin = doc.y;
    doc.font("Helvetica").fontSize(9)
       .text("CNPJ: 66.615.892/0001-43", L, doc.y, { width: metade })
       .text("Representante Legal: _________________________", L, doc.y, { width: metade });

    doc.font("Helvetica-Bold").fontSize(9)
       .text("CRIADORA / MODELO / INFLUENCER", col2, yAssin, { width: metade });
    doc.font("Helvetica").fontSize(9)
       .text(`Nome: ${dados.nome || "________________________________"}`, col2, doc.y + 4, { width: metade })
       .text(`E-mail: ${dados.email || "______________________________"}`, col2, doc.y, { width: metade })
       .text("Assinatura Eletrônica: [ZapSign]", col2, doc.y, { width: metade });

    doc.end();
  });
}

async function enviarContratoZapSign(pdfBuffer, nomeModelo, emailModelo) {
  const base64Pdf = pdfBuffer.toString("base64");
  const resp = await axios.post(
    "https://api.zapsign.com.br/api/v1/docs/",
    {
      name: `Contrato Velvet — ${nomeModelo}`,
      base64_pdf: base64Pdf,
      sandbox: process.env.ZAPSIGN_SANDBOX === "true",
      signers: [
        {
          name: nomeModelo,
          email: emailModelo,
          auth_mode: "assinaturaTela",
          send_automatic_email: false
        }
      ],
      lang: "pt-br",
      disable_signer_emails: true
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.ZAPSIGN_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      timeout: 30000
    }
  );
  const doc = resp.data;
  const signer = doc.signers?.[0];
  if (!signer) throw new Error("ZapSign não retornou signatário");
  const signUrl = `https://app.zapsign.com.br/verificar/${signer.token}`;
  return { token: doc.token, signerToken: signer.token, signUrl };
}

async function descarregarPDFAssinadoZapSign(docToken, modeloId) {
  try {
    if (!process.env.ZAPSIGN_API_TOKEN) return null;

    const zapDoc = await axios.get(
      `https://api.zapsign.com.br/api/v1/docs/${docToken}/`,
      {
        headers: { Authorization: `Bearer ${process.env.ZAPSIGN_API_TOKEN}` },
        timeout: 15000
      }
    );

    const signedFileUrl = zapDoc.data?.signed_file || zapDoc.data?.original_file || null;
    if (!signedFileUrl) return null;

    const pdfResp = await axios.get(signedFileUrl, {
      responseType: "arraybuffer",
      timeout: 30000
    });
    const pdfBuffer = Buffer.from(pdfResp.data);

    const r2Key = `contratos/${modeloId}/contrato-assinado-${Date.now()}.pdf`;
    await s3Privado.putObject({
      Bucket: process.env.R2_BUCKET_PRIVATE,
      Key: r2Key,
      Body: pdfBuffer,
      ContentType: "application/pdf"
    }).promise();

    await db.query("UPDATE modelos SET contrato_pdf_url = $1 WHERE id = $2", [r2Key, modeloId]);
    await db.query(
      `UPDATE modelos_verificacao SET contrato_pdf_url = $1
       WHERE modelo_id = $2 AND (contrato_pdf_url IS NULL OR contrato_pdf_url = '')`,
      [r2Key, modeloId]
    );

    console.log(`[ZapSign] PDF assinado guardado em R2: ${r2Key}`);
    return r2Key;
  } catch (err) {
    console.warn(`[ZapSign] Erro ao descarregar PDF assinado: ${err.message}`);
    return null;
  }
}

module.exports = { gerarContratoPDFBuffer, enviarContratoZapSign, descarregarPDFAssinadoZapSign };
