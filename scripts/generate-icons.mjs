import { mkdir, readFile } from 'node:fs/promises';
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
}

generateIcons().catch((error) => {
  console.error(error);
  process.exit(1);
});
