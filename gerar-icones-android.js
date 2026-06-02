const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SRC = path.join(__dirname, 'store_icon.png');

const icons = [
  { dir: 'mipmap-mdpi',    size: 48  },
  { dir: 'mipmap-hdpi',    size: 72  },
  { dir: 'mipmap-xhdpi',   size: 96  },
  { dir: 'mipmap-xxhdpi',  size: 144 },
  { dir: 'mipmap-xxxhdpi', size: 192 },
];

const base = path.join(__dirname, 'android', 'app', 'src', 'main', 'res');

async function run() {
  for (const { dir, size } of icons) {
    const folder = path.join(base, dir);
    for (const name of ['ic_launcher.png', 'ic_launcher_round.png']) {
      const dest = path.join(folder, name);
      await sharp(SRC).resize(size, size).toFile(dest);
      console.log(`✓ ${dir}/${name} (${size}x${size})`);
    }
    const fg = path.join(folder, 'ic_launcher_foreground.png');
    await sharp(SRC).resize(size, size).toFile(fg);
    console.log(`✓ ${dir}/ic_launcher_foreground.png`);
  }
  console.log('\nÍcones gerados com sucesso!');
}

run().catch(console.error);
