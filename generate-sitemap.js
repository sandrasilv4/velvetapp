const fs = require('fs');
const path = require('path');

// ─── CONFIGURAÇÃO ───────────────────────────────────────────────
const BASE_URL = 'https://velvet.lat';
const HTML_DIR = path.join(__dirname);        // pasta raiz do projecto
const OUTPUT   = path.join(__dirname, 'public', 'sitemap.xml');

// Ficheiros/pastas a ignorar
const IGNORE = ['node_modules', '.git', 'public', '404.html'];
// ────────────────────────────────────────────────────────────────

function findHtmlFiles(dir, fileList = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (IGNORE.includes(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      findHtmlFiles(fullPath, fileList);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      fileList.push(fullPath);
    }
  }

  return fileList;
}

function buildUrl(filePath) {
  let relative = path.relative(HTML_DIR, filePath);

  // Converter separadores Windows → /
  relative = relative.split(path.sep).join('/');

  // index.html → URL limpo sem ficheiro
  if (relative === 'index.html') return BASE_URL + '/';
  if (relative.endsWith('/index.html')) {
    relative = relative.replace('/index.html', '/');
  }

  return `${BASE_URL}/${relative}`;
}

function generateSitemap() {
  const files = findHtmlFiles(HTML_DIR);
  const today = new Date().toISOString().split('T')[0];

  const urls = files.map(f => {
    const url = buildUrl(f);
    return `
  <url>
    <loc>${url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${url === BASE_URL + '/' ? '1.0' : '0.8'}</priority>
  </url>`;
  });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>`;

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, xml, 'utf8');

  console.log(`✅ Sitemap gerado com ${files.length} páginas → ${OUTPUT}`);
  files.forEach(f => console.log('   •', buildUrl(f)));
}

generateSitemap();