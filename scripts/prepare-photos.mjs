#!/usr/bin/env node
/**
 * Scan the photo folder (default: the parent of this project, i.e. D:\uncle),
 * find every supported image, and build the assets the sphere needs:
 *
 *   public/photos/thumb/pNN.jpg   small square-ish textures for the 3D tiles
 *   public/photos/original/pNN.*  untouched copy of the photograph for the viewer
 *   src/data/photos.json          metadata consumed by the app
 *
 * Originals in the source folder are only ever read — never modified or deleted.
 *
 * Usage: node scripts/prepare-photos.mjs [photoFolder]
 */
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const photosRoot = path.resolve(process.argv[2] ?? path.join(projectDir, '..'));

const THUMB_W = 384;
const THUMB_H = 512;
const THUMB_QUALITY = 82;

const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp', '.tif', '.tiff', '.heic', '.heif',
]);
/** Formats a browser can display byte-for-byte. */
const BROWSER_SAFE = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif', '.gif', '.bmp']);

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', '.cache', '.freebuff', '.cloud-attachments',
]);
const OUT_DIR = path.join(projectDir, 'public', 'photos');

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

const log = (...args) => console.log(...args);

async function findImages(dir, found = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (path.resolve(full) === path.resolve(OUT_DIR)) continue;
      if (path.resolve(full) === projectDir) continue;
      await findImages(full, found);
    } else if (entry.isFile()) {
      if (entry.name.startsWith('.')) continue;
      if (IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) found.push(full);
    }
  }
  return found;
}

function slugFromIndex(index, total) {
  const width = Math.max(2, String(total).length);
  return `p${String(index + 1).padStart(width, '0')}`;
}

async function main() {
  log(`\n📷  Scanning photographs in: ${photosRoot}`);
  const files = (await findImages(photosRoot)).sort((a, b) =>
    collator.compare(path.relative(photosRoot, a), path.relative(photosRoot, b)),
  );

  if (files.length === 0) {
    throw new Error(`No supported images found in ${photosRoot}`);
  }

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(OUT_DIR, 'thumb'), { recursive: true });
  await fs.mkdir(path.join(OUT_DIR, 'original'), { recursive: true });

  const photos = [];
  const skipped = [];

  for (const [index, file] of files.entries()) {
    const ext = path.extname(file).toLowerCase();
    const id = slugFromIndex(index, files.length);
    const relativeSource = path.relative(photosRoot, file).split(path.sep).join('/');

    try {
      const image = sharp(file, { failOn: 'none' }).rotate(); // honour EXIF orientation
      const meta = await image.metadata();
      if (!meta.width || !meta.height) throw new Error('could not read image dimensions');

      const thumbName = `${id}.jpg`;
      const thumbInfo = await image
        .clone()
        .resize({ width: THUMB_W, height: THUMB_H, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: THUMB_QUALITY, mozjpeg: true, progressive: true })
        .toFile(path.join(OUT_DIR, 'thumb', thumbName));

      let originalName = `${id}${ext}`;
      if (BROWSER_SAFE.has(ext)) {
        await fs.copyFile(file, path.join(OUT_DIR, 'original', originalName));
      } else {
        // e.g. HEIC / TIFF: browsers cannot render these, so store a high quality JPEG.
        originalName = `${id}.jpg`;
        await image
          .clone()
          .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 92, mozjpeg: true })
          .toFile(path.join(OUT_DIR, 'original', originalName));
      }

      const stat = await fs.stat(file);
      const hash = createHash('sha1')
        .update(`${relativeSource}:${stat.size}:${meta.width}x${meta.height}`)
        .digest('hex')
        .slice(0, 12);

      photos.push({
        id,
        key: hash,
        source: relativeSource,
        thumb: `photos/thumb/${thumbName}`,
        original: `photos/original/${originalName}`,
        width: meta.width,
        height: meta.height,
        thumbWidth: thumbInfo.width,
        thumbHeight: thumbInfo.height,
        aspect: +(meta.width / meta.height).toFixed(4),
      });
    } catch (error) {
      skipped.push({ file: relativeSource, reason: error.message });
    }
  }

  const dataFile = path.join(projectDir, 'src', 'data', 'photos.json');
  await fs.mkdir(path.dirname(dataFile), { recursive: true });
  await fs.writeFile(
    dataFile,
    JSON.stringify({ source: photosRoot, count: photos.length, photos }, null, 2) + '\n',
  );

  log(`✅  ${photos.length} photographs ready`);
  if (skipped.length) {
    log(`⚠️   ${skipped.length} file(s) skipped:`);
    for (const item of skipped) log(`    • ${item.file} — ${item.reason}`);
  }
  log(`    thumbnails → public/photos/thumb`);
  log(`    originals  → public/photos/original`);
  log(`    metadata   → src/data/photos.json\n`);
}

main().catch((error) => {
  console.error(`\n❌  ${error.message}\n`);
  process.exit(1);
});
