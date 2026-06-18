import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const publicDir = path.join(rootDir, 'public');
const iconsDir = path.join(publicDir, 'icons');
const svgPath = path.join(iconsDir, 'icon.svg');

const ICON_SIZES = [192, 512];

async function generateIcons() {
  await mkdir(iconsDir, { recursive: true });
  const svgBuffer = await readFile(svgPath);

  await Promise.all(ICON_SIZES.map(async (size) => {
    const outputPath = path.join(iconsDir, `icon-${size}.png`);
    await sharp(svgBuffer, { density: Math.ceil((size / 512) * 300) })
      .resize(size, size)
      .png()
      .toFile(outputPath);
  }));

  const thumbnailSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0b1220"/>
          <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <linearGradient id="accent" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#0ea5e9"/>
          <stop offset="100%" stop-color="#22d3ee"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <circle cx="360" cy="315" r="150" fill="none" stroke="url(#accent)" stroke-width="24"/>
      <circle cx="360" cy="315" r="118" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="14"/>
      <text x="560" y="280" fill="#e5e7eb" font-family="sans-serif" font-size="72" font-weight="700">スキマ瞑想</text>
      <text x="560" y="360" fill="#9ca3af" font-family="sans-serif" font-size="34">呼吸リズムに合わせた短時間瞑想タイマー</text>
    </svg>
  `;

  await sharp(Buffer.from(thumbnailSvg))
    .resize(1200, 630)
    .png()
    .toFile(path.join(publicDir, 'thumbnail.png'));
}

generateIcons().catch((error) => {
  console.error(error);
  process.exit(1);
});
