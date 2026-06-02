const AWS = require("aws-sdk");
const multer = require("multer");
const multerS3 = require("multer-s3");
const { createClient } = require("@supabase/supabase-js");

const s3 = new AWS.S3({
  endpoint: new AWS.Endpoint(process.env.R2_ENDPOINT),
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: "auto",
  signatureVersion: "v4",
  s3ForcePathStyle: true
});

const s3Privado = new AWS.S3({
  endpoint: new AWS.Endpoint(process.env.R2_ENDPOINT),
  accessKeyId: process.env.R2_ACCESS_KEY_ID,
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  region: "auto",
  signatureVersion: "v4",
  s3ForcePathStyle: true
});

const supabaseStorage = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
  : null;

const uploadB2 = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 }
});

const uploadVerificacao = multer({
  storage: multerS3({
    s3: s3Privado,
    bucket: process.env.R2_BUCKET_PRIVATE,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: (req, file, cb) => {
      const ext = file.originalname.split(".").pop();
      const nome = `verificacao/${req.user.id}/${Date.now()}-${file.fieldname}.${ext}`;
      cb(null, nome);
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 }
});

module.exports = { s3, s3Privado, supabaseStorage, uploadB2, uploadVerificacao };
