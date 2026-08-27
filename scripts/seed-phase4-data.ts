import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import { prisma } from "../lib/prisma.js";
import { FooterLinkGroup } from "../generated/prisma/client.js";

async function seedAdminAuth() {
  const filePath = path.join(process.cwd(), "data", "admin-auth.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    if (data && data.email && (data.passwordHash || data.password)) {
      const email = data.email.trim().toLowerCase();
      const passwordHash = (data.passwordHash || data.password).trim();
      const recoveryEmail = (data.recoveryEmail || "").trim() || null;
      const recoveryPhone = (data.recoveryPhone || "").trim() || null;
      const recoveryCodeHash = (data.recoveryCodeHash || data.recoveryCode || "").trim() || null;

      await prisma.adminCredential.upsert({
        where: { email },
        update: {
          passwordHash,
          recoveryEmail,
          recoveryPhone,
          recoveryCodeHash,
        },
        create: {
          email,
          passwordHash,
          recoveryEmail,
          recoveryPhone,
          recoveryCodeHash,
        },
      });
      console.log(`✓ Seeded AdminCredential for ${email}`);
    }
  } catch (err) {
    console.warn("Could not seed admin auth:", err);
  }
}

async function seedSiteBranding() {
  const filePath = path.join(process.cwd(), "data", "site-settings.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw);
    await prisma.siteBranding.upsert({
      where: { singletonKey: "PRIMARY" },
      update: {
        siteName: data.siteName || "PURE",
        siteSubtitle: data.siteSubtitle || "HAVEN BD",
        logoUrl: data.logoUrl || null,
      },
      create: {
        singletonKey: "PRIMARY",
        siteName: data.siteName || "PURE",
        siteSubtitle: data.siteSubtitle || "HAVEN BD",
        logoUrl: data.logoUrl || null,
      },
    });
    console.log("✓ Upserted SiteBranding (singletonKey = PRIMARY)");
  } catch (err) {
    console.warn("Could not seed site branding:", err);
  }
}

function parseLines(text: string, group: FooterLinkGroup) {
  if (!text) return [];
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const [label, url] = line.split("|").map((p) => p.trim());
      return {
        group,
        label: label || "Link",
        url: url || "#",
        sortOrder: idx + 1,
        isActive: true,
      };
    });
}

async function seedFooterSettings() {
  const filePath = path.join(process.cwd(), "data", "footer-settings.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const data = JSON.parse(raw);

    const linksToCreate = [
      ...parseLines(data.quickLinksText || "", FooterLinkGroup.QUICK_LINKS),
      ...parseLines(data.categoryLinksText || "", FooterLinkGroup.CATEGORY_LINKS),
      ...parseLines(data.policyLinksText || "", FooterLinkGroup.POLICY_LINKS),
    ];

    await prisma.$transaction(async (tx) => {
      const root = await tx.footerSettings.upsert({
        where: { singletonKey: "PRIMARY" },
        update: {
          brandTitle: data.brandTitle || "PURE",
          brandSubtitle: data.brandSubtitle || "HAVEN BD",
          description: data.description || "",
          address: data.address || "",
          phone: data.phone || "",
          email: data.email || "",
          facebookUrl: data.facebookUrl || "#",
          instagramUrl: data.instagramUrl || "#",
          paymentNote: data.paymentNote || "",
          copyright: data.copyright || "",
        },
        create: {
          singletonKey: "PRIMARY",
          brandTitle: data.brandTitle || "PURE",
          brandSubtitle: data.brandSubtitle || "HAVEN BD",
          description: data.description || "",
          address: data.address || "",
          phone: data.phone || "",
          email: data.email || "",
          facebookUrl: data.facebookUrl || "#",
          instagramUrl: data.instagramUrl || "#",
          paymentNote: data.paymentNote || "",
          copyright: data.copyright || "",
        },
      });

      await tx.footerLink.deleteMany({
        where: { footerSettingsId: root.id },
      });

      if (linksToCreate.length > 0) {
        await tx.footerLink.createMany({
          data: linksToCreate.map((l) => ({
            footerSettingsId: root.id,
            group: l.group,
            label: l.label,
            url: l.url,
            sortOrder: l.sortOrder,
            isActive: l.isActive,
          })),
        });
      }
    });
    console.log("✓ Upserted FooterSettings and normalized FooterLink rows");
  } catch (err) {
    console.warn("Could not seed footer settings:", err);
  }
}

async function seedHomePromos() {
  const filePath = path.join(process.cwd(), "data", "home-promos.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const promos = JSON.parse(raw);
    if (Array.isArray(promos)) {
      const existingCount = await prisma.homePromo.count();
      if (existingCount === 0) {
        for (const p of promos) {
          const kind = p.kind === "wide" ? "wide" : p.kind === "small" ? "small" : "slider";
          await prisma.homePromo.create({
            data: {
              kind,
              label: p.label || "",
              title: p.title || "",
              subtitle: p.subtitle || "",
              image: p.image || "",
              href: p.href || "/shop",
              isActive: p.isActive ?? true,
              sortOrder: Number(p.sortOrder) || 0,
            },
          });
        }
        console.log(`✓ Seeded ${promos.length} HomePromo banners`);
      } else {
        console.log(`ℹ HomePromo already has ${existingCount} records`);
      }
    }
  } catch (err) {
    console.warn("Could not seed home promos:", err);
  }
}

async function seedCustomerMessages() {
  const filePath = path.join(process.cwd(), "data", "customer-messages.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const msgs = JSON.parse(raw);
    if (Array.isArray(msgs) && msgs.length > 0) {
      const existingCount = await prisma.customerMessage.count();
      if (existingCount === 0) {
        for (const m of msgs) {
          await prisma.customerMessage.create({
            data: {
              name: m.name || "Customer",
              phone: m.phone || null,
              email: m.email || null,
              message: m.message || "",
              status: "new",
            },
          });
        }
        console.log(`✓ Seeded ${msgs.length} CustomerMessages`);
      } else {
        console.log(`ℹ CustomerMessage already has ${existingCount} records`);
      }
    }
  } catch (err) {
    console.warn("Could not seed customer messages:", err);
  }
}

async function main() {
  console.log("Starting Phase 4 data seeding...");
  await seedAdminAuth();
  await seedSiteBranding();
  await seedFooterSettings();
  await seedHomePromos();
  await seedCustomerMessages();
  console.log("Phase 4 data seeding complete!");
}

main()
  .catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());