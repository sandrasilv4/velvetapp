const { supabaseStorage } = require("../config/storage");

async function uploadToSupabase(buffer, mimetype, originalname, bucket) {
  if (!supabaseStorage) throw new Error("Supabase Storage não configurado");
  const ext = (originalname || "file").split(".").pop().split("?")[0] || "bin";
  const caminho = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error } = await supabaseStorage.storage
    .from(bucket)
    .upload(caminho, buffer, { contentType: mimetype, upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabaseStorage.storage
    .from(bucket)
    .getPublicUrl(caminho);
  return { url: publicUrl, thumb_url: publicUrl };
}

async function uploadCloudflareImage(fileBuffer, filename, bucket = "feed") {
  const result = await uploadToSupabase(fileBuffer, "image/jpeg", filename, bucket);
  return { variants: [result.url] };
}

async function uploadVideoCloudflare(buffer, filename, bucket = "feed") {
  const result = await uploadToSupabase(buffer, "video/mp4", filename, bucket);
  return { uid: null, url: result.url, thumbnail: result.thumb_url, _publicUrl: result.url };
}

module.exports = { uploadToSupabase, uploadCloudflareImage, uploadVideoCloudflare };
