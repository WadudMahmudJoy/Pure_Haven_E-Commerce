import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from "fs";
import path from "path";

const root = process.cwd();
const file = "components/ui/SafeImage.tsx";
const backupDir = path.join(root, "_phase5_hotfix_upload_image_optimizer_backup");
mkdirSync(backupDir, { recursive: true });

const fullPath = path.join(root, file);
copyFileSync(fullPath, path.join(backupDir, "SafeImage.tsx"));

let source = readFileSync(fullPath, "utf8").replace(/^\uFEFF/, "");

source = source.replace(
`function canUseNextImage(src: string) {
  const value = src.trim().toLowerCase();

  if (!value.startsWith("/")) return false;
  if (value.endsWith(".svg")) return false;
  if (value.startsWith("/api/")) return false;

  return true;
}`,
`function canUseNextImage(src: string) {
  const value = src.trim().toLowerCase();

  if (!value.startsWith("/")) return false;
  if (value.endsWith(".svg")) return false;
  if (value.startsWith("/api/")) return false;

  // Uploaded product files can be missing after moving the project between machines.
  // Let browser <img> handle them so onError can switch to fallback without Next optimizer spam.
  if (value.startsWith("/uploads/")) return false;

  return true;
}`
);

writeFileSync(fullPath, source, "utf8");

console.log("Phase 5 hotfix applied: /uploads/* images now bypass next/image optimizer.");
console.log(`Backup saved in: ${backupDir}`);
