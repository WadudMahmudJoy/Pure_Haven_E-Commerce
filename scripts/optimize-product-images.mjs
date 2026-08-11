import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const rootDir = path.join(process.cwd(), "public", "uploads", "products");
const minSizeBytes = 500 * 1024;

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...await walk(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function isSupportedImage(filePath) {
  return /\.(jpe?g|png|webp)$/i.test(filePath);
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2);
}

async function optimizeImage(filePath) {
  const before = await fs.stat(filePath);

  if (before.size < minSizeBytes) return null;

  const ext = path.extname(filePath).toLowerCase();
  const tempPath = `${filePath}.optimizing`;

  let pipeline = sharp(filePath, { failOn: "none" }).rotate();

  const metadata = await pipeline.metadata();

  if ((metadata.width ?? 0) > 1600) {
    pipeline = pipeline.resize({
      width: 1600,
      withoutEnlargement: true,
    });
  }

  if (ext === ".jpg" || ext === ".jpeg") {
    await pipeline
      .jpeg({
        quality: 82,
        mozjpeg: true,
      })
      .toFile(tempPath);
  } else if (ext === ".png") {
    await pipeline
      .png({
        compressionLevel: 9,
        palette: true,
      })
      .toFile(tempPath);
  } else if (ext === ".webp") {
    await pipeline
      .webp({
        quality: 82,
      })
      .toFile(tempPath);
  } else {
    return null;
  }

  const after = await fs.stat(tempPath);

  if (after.size < before.size) {
    await fs.rename(tempPath, filePath);

    return {
      file: path.relative(process.cwd(), filePath),
      before: before.size,
      after: after.size,
      saved: before.size - after.size,
    };
  }

  await fs.rm(tempPath, { force: true });
  return null;
}

async function main() {
  const files = (await walk(rootDir)).filter(isSupportedImage);

  const results = [];

  for (const file of files) {
    try {
      const result = await optimizeImage(file);
      if (result) results.push(result);
    } catch (error) {
      console.error(`FAILED: ${file}`);
      console.error(error instanceof Error ? error.message : error);
    }
  }

  results.sort((a, b) => b.saved - a.saved);

  let totalBefore = 0;
  let totalAfter = 0;

  console.log("");
  console.log("=== Optimized product images ===");

  for (const item of results) {
    totalBefore += item.before;
    totalAfter += item.after;

    console.log(
      `${item.file} | ${mb(item.before)} MB -> ${mb(item.after)} MB | saved ${mb(item.saved)} MB`
    );
  }

  console.log("");
  console.log(`Optimized files: ${results.length}`);
  console.log(`Total before: ${mb(totalBefore)} MB`);
  console.log(`Total after : ${mb(totalAfter)} MB`);
  console.log(`Total saved : ${mb(totalBefore - totalAfter)} MB`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
