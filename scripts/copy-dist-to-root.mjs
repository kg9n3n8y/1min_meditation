#!/usr/bin/env node
import { cpSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const distDir = path.join(rootDir, 'dist');

const copyTargets = [
  'index.html',
  'registerSW.js',
  'sw.js',
  'manifest.webmanifest',
  'thumbnail.png',
];

function copyWorkboxFile() {
  const workboxFile = readdirSync(distDir).find((name) => name.startsWith('workbox-') && name.endsWith('.js'));
  if (!workboxFile) {
    throw new Error('workbox bundle not found in dist');
  }
  cpSync(path.join(distDir, workboxFile), path.join(rootDir, workboxFile));
}

function copyDirectory(name) {
  const sourceDir = path.join(distDir, name);
  const targetDir = path.join(rootDir, name);
  rmSync(targetDir, { recursive: true, force: true });
  cpSync(sourceDir, targetDir, { recursive: true });
}

if (!readdirSync(distDir).length) {
  throw new Error('dist is empty. Run npm run build first.');
}

copyTargets.forEach((target) => {
  cpSync(path.join(distDir, target), path.join(rootDir, target));
});

copyDirectory('assets');
copyDirectory('icons');
copyWorkboxFile();

cpSync(path.join(distDir, '.nojekyll'), path.join(rootDir, '.nojekyll'));

console.log('Copied dist/ to repository root for GitHub Pages.');
