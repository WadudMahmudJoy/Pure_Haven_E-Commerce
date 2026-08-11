import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "fs";
import path from "path";

const root = process.cwd();
const backupDir = path.join(root, "_phase8_backup_slider_cleanup");
mkdirSync(backupDir, { recursive: true });

const files = [
  "components/admin/AdminShell.tsx",
  "app/admin/slides/page.tsx",
];

for (const file of files) {
  const full = path.join(root, file);
  if (existsSync(full)) {
    copyFileSync(full, path.join(backupDir, file.replace(/[\\/]/g, "__")));
  }
}

function read(file) {
  return readFileSync(path.join(root, file), "utf8").replace(/^\uFEFF/, "");
}

function write(file, content) {
  writeFileSync(path.join(root, file), content, "utf8");
}

/**
 * 1. Redirect unused /admin/slides page to active homepage promo manager.
 */
mkdirSync(path.join(root, "app/admin/slides"), { recursive: true });

write(
  "app/admin/slides/page.tsx",
`import { redirect } from "next/navigation";

export default function AdminSlidesRedirectPage() {
  redirect("/admin/home-promos");
}
`
);

/**
 * 2. If admin navigation still points to /admin/slides, point it to /admin/home-promos.
 *    This is conservative; it does not delete nav structure.
 */
const adminShellPath = path.join(root, "components/admin/AdminShell.tsx");

if (existsSync(adminShellPath)) {
  let source = read("components/admin/AdminShell.tsx");

  source = source.replaceAll(`"/admin/slides"`, `"/admin/home-promos"`);
  source = source.replaceAll(`'/admin/slides'`, `'/admin/home-promos'`);
  source = source.replaceAll(`href="/admin/slides"`, `href="/admin/home-promos"`);
  source = source.replaceAll(`href='/admin/slides'`, `href='/admin/home-promos'`);

  // Normalize visible label if exact simple label exists.
  source = source.replaceAll(`label: "Slides"`, `label: "Home Slider"`);
  source = source.replaceAll(`label: 'Slides'`, `label: 'Home Slider'`);

  write("components/admin/AdminShell.tsx", source);
}

console.log("Phase 8 slider cleanup applied.");
console.log("Active slider manager: /admin/home-promos");
console.log("Old /admin/slides now redirects to /admin/home-promos");
console.log(`Backups saved in: ${backupDir}`);
