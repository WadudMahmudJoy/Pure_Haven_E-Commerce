# Pure Haven BD Phase 6 Media Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace URL-only product-image handling with a provider-independent ManagedMedia foundation that preserves premium image quality, adds secure processing and responsive delivery, supports safe lifecycle cleanup, and keeps ProductImage as the ordered gallery authority.

**Architecture:** Product media is ingested through an authenticated ManagedMedia boundary, normalized into one private canonical master, and processed into immutable public renditions owned by profile-pinned `MediaProcessingRun` records. `MediaStorage` isolates local/S3-compatible persistence, `MediaDeliveryResolver` emits provider-neutral public URLs, ProductImage retains gallery/order authority, and database lifecycle state plus reconciliation handles cross-system failures without pretending PostgreSQL and object storage share a transaction.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma 7.9.1, PostgreSQL/Neon, Node test runner used by the repository, Sharp/libvips only after Task 2 calibration gate, Playwright/browser QA patterns already present in the repository, S3-compatible object storage with Cloudflare R2 as the leading production candidate.

**Spec:** `docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md` — owner-approved SHA-256 `6d528f2730c1d0a195ededea5bd7987f4c0770bc2b3db7759041212bea7a501a`.

## Global Constraints

- **Execution baseline:** `main`; initial `HEAD = origin/main = pre-phase6-ux-corrections-complete = 7e4a750466b609f359ea26bd4233f7399b9f66ca`; working tree clean. If not exact, STOP; do not auto-fix/reset/rebase.
- **Repository-lock gate:** before Task 1 or any implementation work, the real repository copies of both approved spec and approved plan must exist at their approved paths and their SHA-256 hashes must match owner-approved values. The plan hash is supplied at execution time through `PHASE6_APPROVED_PLAN_SHA256`; the plan does not self-embed its hash.
- **Main-only workflow:** no branch creation, no worktree, no history rewrite, no force-push.
- **Windows execution:** commands in this plan are PowerShell unless explicitly labeled otherwise.
- **Guarded edits:** inspect/precondition before mutation; stage only task-owned files; never use `git add .`.
- **TDD:** behavioral/security/integrity work uses compileable shell/setup → behavioral RED for the intended reason → minimal implementation → GREEN → focused regression → fresh verification → commit. Missing module, missing fixture, syntax error, or environment/configuration failure is not an acceptable behavioral RED.
- **Product-first scope:** new Admin-created Product/ProductImage media becomes MANAGED; historical local/external ProductImage media remains unmanaged initially; no automatic bulk legacy import.
- **Authority:** ProductImage remains ordered gallery authority; `Product.image` remains first-ProductImage compatibility mirror; for MANAGED rows `managedMediaId` is durable authority and `ProductImage.url` is server-derived compatibility only.
- **Master security:** canonical master is `PRIVATE_SOURCE`, never normal storefront delivery, never `ProductImage.url`/`Product.image`, and inactive-profile cleanup must never delete `ManagedMedia.canonicalMasterObjectId`.
- **Suspension:** `ManagedMedia.deliveryDisabledAt != null` blocks new attachment, active-profile/customer-delivery activation, and normal public managed-media DTO delivery; suspension is orthogonal to lifecycle.
- **Delivery formats:** WebP responsive delivery is mandatory baseline. AVIF is conditional; if enabled by a profile it receives full QA. Changing enabled output formats changes immutable processing-profile semantics and therefore requires a new profile version.
- **Quality:** no universal KB release threshold. Premium clarity, packaging-text readability, texture, transparency, high-DPI detail, and color fidelity win over arbitrary byte targets.
- **Provider independence:** domain/Admin/storefront contracts contain no R2/AWS/Cloudinary business identifiers. R2 is infrastructure-only through `S3CompatibleMediaStorage`.
- **Read path:** normal catalog reads make zero provider HEAD/GET/LIST calls. Production rendition GET bypasses Next.js/Prisma/PostgreSQL; LocalMediaStorage development may use an approved dev-serving mechanism.
- **Cleanup:** physical deletion is deferred, idempotent, reference-verified, and reconciled. A URL/path is never physical deletion authority.
- **Migration hard gate:** no shared/non-local Phase-6 Prisma migration until Task 1's historical checksum investigation is resolved/documented and owner explicitly authorizes remediation/deployment. No speculative `migrate resolve`, manual `_prisma_migrations` edit, historical SQL rewrite/reapply, or history erasure.
- **Calibration:** current ~5 MB upload ceiling, 40 MP/12k input limits, 5120px/24MP master limits, canonical-master encoding, 320/640/960/1280/1600/2048 ladder, WebP/AVIF quality, concurrency, timeout/execution mode, responsive `sizes`, and cleanup grace are evidence-driven values, not immutable architecture.
- **Completion claims:** report exact command output/exit status. The historical full-suite baseline had zero failed tests but 8 intentional guarded cancellations and process exit 1; never relabel a nonzero exit as PASS.

---

## Repository File Map Used by This Plan

### Workflow authority documents

- `docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md`
- `docs/superpowers/plans/2026-09-05-phase-6-media-infrastructure.md`

### Existing application/domain files expected to be modified or characterized

- `package.json`, `package-lock.json`, `.env.example`, `.gitignore`
- `prisma/schema.prisma`, `prisma.config.ts`
- `prisma/migrations/20260526183231_sync_current_schema_security_fix/migration.sql` — historical checksum investigation target; inspect only until evidence gate is resolved
- `app/api/upload/route.ts` — legacy uploader retained for unmigrated non-product surfaces during first adoption
- `app/api/products/route.ts` — existing Product/ProductImage mutation authority
- `app/admin/products/[id]/edit/page.tsx` — existing product gallery editor
- `lib/adminSession.ts`
- `lib/catalog/adminGalleryState.ts`
- `lib/catalog/galleryPersistence.ts`
- `lib/catalog/galleryWrite.ts`
- `lib/catalog/publicCatalogQuery.ts`
- `lib/catalog/types.ts`
- `lib/getProducts.ts`
- `lib/imagePaths.ts`
- `components/ui/SafeImage.tsx`
- `components/ui/ProductCard.tsx`
- `components/ui/ProductCardCarousel.tsx`
- `components/product/ProductDetailsClient.tsx`

### New focused media units

- `lib/media/domain.ts`
- `lib/media/processingProfile.ts`
- `lib/media/config.ts`
- `lib/media/storage/contracts.ts`
- `lib/media/storage/inMemoryMediaStorage.ts`
- `lib/media/storage/localMediaStorage.ts`
- `lib/media/storage/s3CompatibleMediaStorage.ts`
- `lib/media/storage/registry.ts`
- `lib/media/delivery.ts`
- `lib/media/publicMediaDto.ts`
- `lib/media/imageProcessor.ts`
- `lib/media/mediaRepository.ts`
- `lib/media/mediaIngestService.ts`
- `lib/media/mediaProcessingRunner.ts`
- `lib/media/productMediaAttachmentService.ts`
- `lib/media/mediaLifecycleService.ts`
- `lib/media/mediaReconciliationService.ts`
- `lib/media/mediaTelemetry.ts`
- `components/ui/ResponsiveProductImage.tsx`
- `app/api/media/uploads/route.ts`
- `app/api/media/uploads/[id]/route.ts`
- `lib/media/mediaUploadStatusService.ts`
- `scripts/phase6-media-calibration.ts`
- `scripts/reconcile-managed-media.ts`
- `scripts/process-managed-media.ts`
- `scripts/phase6-media-delivery-control.ts`

### New/extended tests and evidence

- `tests/helpers/mediaFixtures.ts`
- `tests/helpers/mediaStorageContract.ts`
- `tests/media-fixtures.test.ts`
- `tests/media-domain.test.ts`
- `tests/media-processing-profile.test.ts`
- `tests/media-storage-contract.test.ts`
- `tests/media-local-storage.test.ts`
- `tests/media-s3-storage.test.ts`
- `tests/media-r2-integration.test.ts`
- `tests/media-image-security.test.ts`
- `tests/media-renditions.test.ts`
- `tests/media-ingest-service.test.ts`
- `tests/media-upload-route.test.ts`
- `tests/media-lifecycle-reconciliation.test.ts`
- `tests/product-managed-media-write.test.ts`
- `tests/public-managed-media-query.test.ts`
- `tests/media-delivery-contract.test.ts`
- `tests/admin-managed-media-ui.test.ts`
- `tests/media-operations-telemetry.test.ts`
- `tests/media-browser-network-qa.test.ts`
- `tests/product-card-responsive-media.test.ts`
- `tests/product-detail-responsive-media.test.ts`
- existing regression files: `tests/product-image-schema.test.ts`, `tests/migration-rehearsal-postgres.test.ts`, `tests/product-gallery-write.test.ts`, `tests/admin-gallery-edit-ui.test.ts`, `tests/admin-product-gallery-read.test.ts`, `tests/public-catalog-gallery-query.test.ts`, `tests/product-card-carousel.test.ts`, `tests/product-detail-shared-gallery.test.ts`, `tests/storefront-responsive-browser-qa.test.ts`
- `docs/superpowers/evidence/phase6-migration-checksum-investigation.md`
- `docs/superpowers/evidence/phase6-media-calibration.md`
- `docs/superpowers/evidence/phase6-media-acceptance.md`
- `docs/superpowers/evidence/phase6-media-operations-runbook.md`
- `artifacts/phase6-media-browser/` — owner-inspectable screenshots/network captures produced by Task 24
- `artifacts/phase6-media-browser.zip` — packaged Task-24 evidence

### Planned local/disposable-only migration units

- `prisma/migrations/20260905010000_phase6_media_expand/migration.sql`
- `prisma/migrations/20260905020000_phase6_product_image_classification/migration.sql`
- `prisma/migrations/20260905030000_phase6_media_contract/migration.sql`

The exact repository map is re-verified in Task 0 before any code task. If an expected existing path differs, STOP that task, report the real path, and update only the plan path mapping with owner/technical-owner review; do not invent a parallel module.

### Task 0: Repository-Lock Approved Spec + Plan and Reverify Repository Map/Baseline

**Files:**
- Create/verify exact copy: `docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md`
- Create/verify exact copy: `docs/superpowers/plans/2026-09-05-phase-6-media-infrastructure.md`
- Inspect only: repository paths listed in **Repository File Map Used by This Plan**

**Interfaces:**
- Consumes: owner-approved spec SHA-256 `6d528f2730c1d0a195ededea5bd7987f4c0770bc2b3db7759041212bea7a501a`; execution environment variables `PHASE6_APPROVED_SPEC_SOURCE`, `PHASE6_APPROVED_PLAN_SOURCE`, `PHASE6_APPROVED_PLAN_SHA256`.
- Produces: repository-locked spec/plan copies, exact baseline evidence, and the first Phase-6 documentation commit. No application behavior changes.

- [ ] **Step 1: Verify the untouched pre-Phase-6 baseline before copying either artifact**

```powershell
$ErrorActionPreference = 'Stop'
Set-Location 'E:\Joy\pure-haven-bd-joy\pure-haven-bd'
$expected = '7e4a750466b609f359ea26bd4233f7399b9f66ca'
$branch = (git branch --show-current).Trim()
$head = (git rev-parse HEAD).Trim()
$origin = (git rev-parse origin/main).Trim()
$tag = (git rev-parse pre-phase6-ux-corrections-complete).Trim()
$status = git status --porcelain=v1 -uall
if ($branch -ne 'main') { throw "BASELINE_BRANCH_MISMATCH:$branch" }
if ($head -ne $expected) { throw "BASELINE_HEAD_MISMATCH:$head" }
if ($origin -ne $expected) { throw "BASELINE_ORIGIN_MISMATCH:$origin" }
if ($tag -ne $expected) { throw "BASELINE_TAG_MISMATCH:$tag" }
if ($status) { throw "BASELINE_WORKTREE_NOT_CLEAN`n$status" }
```

Expected: no output and exit 0. Any mismatch is a hard STOP; do not reset, pull, merge, rebase, or clean automatically.

- [ ] **Step 2: Verify artifact-source variables and copy the exact approved bytes into the repository**

```powershell
$specSource = $env:PHASE6_APPROVED_SPEC_SOURCE
$planSource = $env:PHASE6_APPROVED_PLAN_SOURCE
$expectedPlanSha256 = $env:PHASE6_APPROVED_PLAN_SHA256
if (-not $specSource -or -not (Test-Path $specSource)) { throw 'APPROVED_SPEC_SOURCE_MISSING' }
if (-not $planSource -or -not (Test-Path $planSource)) { throw 'APPROVED_PLAN_SOURCE_MISSING' }
if (-not $expectedPlanSha256) { throw 'PHASE6_APPROVED_PLAN_SHA256_MISSING' }
New-Item -ItemType Directory -Force 'docs\superpowers\specs' | Out-Null
New-Item -ItemType Directory -Force 'docs\superpowers\plans' | Out-Null
Copy-Item -LiteralPath $specSource -Destination 'docs\superpowers\specs\2026-09-04-phase-6-media-infrastructure-design.md' -Force
Copy-Item -LiteralPath $planSource -Destination 'docs\superpowers\plans\2026-09-05-phase-6-media-infrastructure.md' -Force
```

- [ ] **Step 3: Prove both repository copies match the owner-approved byte hashes**

```powershell
$specHash = (Get-FileHash 'docs\superpowers\specs\2026-09-04-phase-6-media-infrastructure-design.md' -Algorithm SHA256).Hash.ToLowerInvariant()
$planHash = (Get-FileHash 'docs\superpowers\plans\2026-09-05-phase-6-media-infrastructure.md' -Algorithm SHA256).Hash.ToLowerInvariant()
if ($specHash -ne '6d528f2730c1d0a195ededea5bd7987f4c0770bc2b3db7759041212bea7a501a') { throw "SPEC_HASH_MISMATCH:$specHash" }
if ($planHash -ne $expectedPlanSha256.ToLowerInvariant()) { throw "PLAN_HASH_MISMATCH:$planHash" }
"SPEC_SHA256=$specHash"
"PLAN_SHA256=$planHash"
```

Expected: both exact hashes printed. This is the repository-lock gate; Task 1 must not begin unless it passes.

- [ ] **Step 4: Re-map every planned existing path without mutating the repository**

```powershell
$requiredExisting = @(
  'package.json','package-lock.json','.env.example','.gitignore','prisma/schema.prisma','prisma.config.ts',
  'prisma/migrations/20260526183231_sync_current_schema_security_fix/migration.sql',
  'app/api/upload/route.ts','app/api/products/route.ts','app/admin/products/[id]/edit/page.tsx',
  'lib/adminSession.ts','lib/catalog/adminGalleryState.ts','lib/catalog/galleryPersistence.ts','lib/catalog/galleryWrite.ts',
  'lib/catalog/publicCatalogQuery.ts','lib/catalog/types.ts','lib/getProducts.ts','lib/imagePaths.ts',
  'components/ui/SafeImage.tsx','components/ui/ProductCard.tsx','components/ui/ProductCardCarousel.tsx',
  'components/product/ProductDetailsClient.tsx',
  'tests/product-image-schema.test.ts','tests/migration-rehearsal-postgres.test.ts','tests/product-gallery-write.test.ts',
  'tests/admin-gallery-edit-ui.test.ts','tests/admin-product-gallery-read.test.ts','tests/public-catalog-gallery-query.test.ts',
  'tests/product-card-carousel.test.ts','tests/product-detail-shared-gallery.test.ts','tests/storefront-responsive-browser-qa.test.ts'
)
$missing = $requiredExisting | Where-Object { -not (Test-Path -LiteralPath $_) }
if ($missing) { throw ('REPOSITORY_MAP_MISMATCH:' + ($missing -join ',')) }
```

Expected: exit 0. If a required path is absent, STOP and report the real repository structure before changing implementation paths.

- [ ] **Step 5: Verify the checksum gate text exists in both approved repository artifacts**

```powershell
$needle = '20260526183231_sync_current_schema_security_fix'
if (-not (Select-String -LiteralPath 'docs\superpowers\specs\2026-09-04-phase-6-media-infrastructure-design.md' -SimpleMatch $needle -Quiet)) { throw 'SPEC_CHECKSUM_GATE_MISSING' }
if (-not (Select-String -LiteralPath 'docs\superpowers\plans\2026-09-05-phase-6-media-infrastructure.md' -SimpleMatch $needle -Quiet)) { throw 'PLAN_CHECKSUM_GATE_MISSING' }
```

- [ ] **Step 6: Review the documentation-only diff and commit the repository-lock artifacts**

```powershell
git diff --check
git diff -- docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md docs/superpowers/plans/2026-09-05-phase-6-media-infrastructure.md
git add -- docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md docs/superpowers/plans/2026-09-05-phase-6-media-infrastructure.md
git diff --cached --check
git commit -m "docs: lock phase 6 media design and plan"
```

Expected: exactly the approved documentation artifacts are committed; no application files are staged.

---

### Task 1: Guarded Historical Prisma Checksum Investigation — Evidence Only

**Files:**
- Create: `docs/superpowers/evidence/phase6-migration-checksum-investigation.md`
- Inspect only: `prisma/migrations/20260526183231_sync_current_schema_security_fix/migration.sql`, Git history for that path, and read-only Neon `_prisma_migrations` evidence only if an already-authorized read-only connection is available.

**Interfaces:**
- Consumes: known repository-observed checksum `6ebbf1104c5fd06f0414e7ee01b6f8ebfbe340334e1dfed14d610337d104669c` and Neon-recorded checksum `ac0c8d8f465e09a5e69c1d4330668e5a320e03392ed4e47105d4355b6ac57013`.
- Produces: evidence report with exact candidate byte hashes and a status of `MATCH_EXPLAINED`, `MISMATCH_UNRESOLVED`, or `READ_EVIDENCE_UNAVAILABLE`. It does **not** remediate migration history and does not unlock non-local migration by itself.

- [ ] **Step 1: Re-assert prohibited actions before investigation**

```powershell
@'
NO speculative prisma migrate resolve
NO manual _prisma_migrations mutation
NO edit/rewrite of previously applied migration SQL
NO historical migration reapply
NO migration-history deletion
NO shared/non-local Phase-6 migration deployment
'@ | Write-Host
```

- [ ] **Step 2: Hash the exact current repository bytes and explicit BOM variants**

```powershell
$path = 'prisma\migrations\20260526183231_sync_current_schema_security_fix\migration.sql'
$current = [System.IO.File]::ReadAllBytes((Resolve-Path $path))
$sha = [System.Security.Cryptography.SHA256]::Create()
function Get-HexSha([byte[]]$bytes) { -join ($sha.ComputeHash($bytes) | ForEach-Object { $_.ToString('x2') }) }
$currentHash = Get-HexSha $current
$bom = [byte[]](0xEF,0xBB,0xBF)
$hasBom = $current.Length -ge 3 -and $current[0] -eq 0xEF -and $current[1] -eq 0xBB -and $current[2] -eq 0xBF
$bomAdded = if ($hasBom) { $current } else { [byte[]]($bom + $current) }
$bomStripped = if ($hasBom) { [byte[]]$current[3..($current.Length-1)] } else { $current }
"CURRENT=$currentHash"
"BOM_FORM=$(Get-HexSha $bomAdded)"
"BOM_STRIPPED=$(Get-HexSha $bomStripped)"
```

Expected: exact hashes printed. Do not interpret the BOM hypothesis as proven unless a candidate equals the recorded Neon checksum.

- [ ] **Step 3: Enumerate historical Git versions and hash the exact bytes without modifying the working tree**

```powershell
$gitPath = 'prisma/migrations/20260526183231_sync_current_schema_security_fix/migration.sql'
$commits = git log --format=%H --all -- $gitPath
$rows = foreach ($commit in $commits) {
  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    cmd /c "git show $commit`:$gitPath > `"$tmp`""
    $bytes = [System.IO.File]::ReadAllBytes($tmp)
    [pscustomobject]@{ Commit=$commit; Bytes=$bytes.Length; Sha256=(Get-HexSha $bytes) }
  } finally { Remove-Item $tmp -Force -ErrorAction SilentlyContinue }
}
$rows | Format-Table -AutoSize
```

Expected: historical candidate hashes. If shell redirection changes bytes on the current platform, use `git cat-file blob` to a binary-safe stream and document that method instead; never checkout/rewrite the historical file.

- [ ] **Step 4: If an authorized read-only Neon query is available, capture only the migration record**

```sql
SELECT migration_name, checksum, finished_at, rolled_back_at, applied_steps_count
FROM "_prisma_migrations"
WHERE migration_name = '20260526183231_sync_current_schema_security_fix';
```

Expected known record: checksum `ac0c8d8f465e09a5e69c1d4330668e5a320e03392ed4e47105d4355b6ac57013`, `rolled_back_at IS NULL`, `applied_steps_count = 0`. If no authorized read-only connection is available, record `READ_EVIDENCE_UNAVAILABLE`; do not create or change credentials in this task.

- [ ] **Step 5: Compare byte evidence and SQL semantics separately, then write the evidence report**

```powershell
$historyLines = ($rows | ForEach-Object { "- $($_.Commit): $($_.Sha256) ($($_.Bytes) bytes)" }) -join "`n"
$recorded = 'ac0c8d8f465e09a5e69c1d4330668e5a320e03392ed4e47105d4355b6ac57013'
$candidates = @($currentHash, (Get-HexSha $bomAdded), (Get-HexSha $bomStripped)) + @($rows.Sha256)
$exactConclusion = if ($candidates -contains $recorded) { 'MATCH_EXPLAINED' } else { 'MISMATCH_UNRESOLVED' }
$report = @"
# Phase 6 Historical Prisma Checksum Investigation

- Migration: ``20260526183231_sync_current_schema_security_fix``
- Current repository SHA-256: ``$currentHash``
- Neon recorded SHA-256: ``$recorded``
- BOM-form SHA-256: ``$(Get-HexSha $bomAdded)``
- BOM-stripped SHA-256: ``$(Get-HexSha $bomStripped)``
- Historical Git candidates:
$historyLines
- Exact-byte conclusion: ``$exactConclusion``
- SQL semantic comparison: record the separately inspected semantic result before commit; semantic equality never substitutes for byte equality.
- Shared/non-local migration gate: ``BLOCKED`` unless a separately owner-approved remediation has been completed and reverified.
"@
Set-Content -LiteralPath 'docs\superpowers\evidence\phase6-migration-checksum-investigation.md' -Value $report -Encoding utf8
```

Before commit, append the separately inspected SQL semantic comparison result as a concrete sentence and verify the file contains no unresolved marker text.

- [ ] **Step 6: Verify no migration/database state changed and commit evidence only**

```powershell
git status --short
git diff --check
git add -- docs/superpowers/evidence/phase6-migration-checksum-investigation.md
git diff --cached --name-only
```

Expected staged path: only `docs/superpowers/evidence/phase6-migration-checksum-investigation.md`.

```powershell
git commit -m "docs: investigate historical prisma checksum"
```

The shared/non-local migration gate remains BLOCKED until a later explicit owner decision based on this evidence.

---

### Task 2: Install Processor Dependency and Evidence-Backed Profile/Runtime Calibration

**Files:**
- Modify: `package.json`, `package-lock.json`
- Create: `scripts/phase6-media-calibration.ts`
- Create: `tests/helpers/mediaFixtures.ts`
- Create: `tests/media-fixtures.test.ts`
- Create: `docs/superpowers/evidence/phase6-media-calibration.md`

**Interfaces:**
- Consumes: current ~5 MB upload baseline; candidate input limits 40 MP/12k; candidate master limits 5120px/24MP; candidate rendition widths 320/640/960/1280/1600/2048; candidate WebP quality 88; candidate AVIF quality 65.
- Produces: pinned image-processing dependency, verified deterministic calibration fixtures, and measured calibration evidence. None of the candidate values become permanent architecture merely by appearing in this task.

- [ ] **Step 1: Verify processor/runtime support before installing anything**

```powershell
node --version
npm --version
npm view sharp version engines --json
```

Expected: the current Node runtime satisfies the selected Sharp release's engine requirements. If not, STOP this task and report the incompatibility rather than forcing an unsupported dependency.

- [ ] **Step 2: Pin the exact approved compatible Sharp version**

```powershell
$sharpVersion = (npm view sharp version).Trim()
if (-not $sharpVersion) { throw 'SHARP_VERSION_LOOKUP_FAILED' }
npm install --save-exact "sharp@$sharpVersion"
```

- [ ] **Step 3: Create a compileable deterministic-fixture shell with a valid decodable sentinel image**

Create `tests/helpers/mediaFixtures.ts`:

```ts
import sharp from "sharp";

export type MediaFixtureKind =
  | "photo"
  | "text-packaging"
  | "fine-texture"
  | "dark-gradient"
  | "transparent"
  | "icc-profile";

export async function createPhase6MediaFixture(
  kind: MediaFixtureKind,
  width: number,
  height: number
): Promise<Uint8Array> {
  void kind;
  return new Uint8Array(
    await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 127, g: 127, b: 127, alpha: 1 },
      },
    }).png().toBuffer()
  );
}
```

This shell exists only so the behavioral test can load and decode a valid image. It intentionally does **not** yet distinguish fixture classes and must not be used as calibration evidence.

- [ ] **Step 4: Write behavioral RED tests for the fixture generator**

Create `tests/media-fixtures.test.ts` with assertions shaped as follows:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import { createPhase6MediaFixture, type MediaFixtureKind } from "./helpers/mediaFixtures";

const kinds: readonly MediaFixtureKind[] = [
  "photo",
  "text-packaging",
  "fine-texture",
  "dark-gradient",
  "transparent",
  "icc-profile",
];

test("phase 6 fixtures are non-empty deterministic decodable and dimension-correct", async () => {
  for (const kind of kinds) {
    const a = await createPhase6MediaFixture(kind, 640, 480);
    const b = await createPhase6MediaFixture(kind, 640, 480);
    assert.ok(a.byteLength > 0, `${kind} must be non-empty`);
    assert.deepEqual(a, b, `${kind} must be deterministic`);
    const metadata = await sharp(a).metadata();
    assert.equal(metadata.width, 640);
    assert.equal(metadata.height, 480);
  }
});

test("fixture classes expose the requested representative properties", async () => {
  const outputs = new Map<MediaFixtureKind, Uint8Array>();
  for (const kind of kinds) outputs.set(kind, await createPhase6MediaFixture(kind, 768, 512));
  assert.notDeepEqual(outputs.get("photo"), outputs.get("text-packaging"));
  assert.notDeepEqual(outputs.get("text-packaging"), outputs.get("fine-texture"));
  assert.notDeepEqual(outputs.get("fine-texture"), outputs.get("dark-gradient"));

  const transparent = await sharp(outputs.get("transparent")!).metadata();
  assert.equal(transparent.hasAlpha, true);

  const profiled = await sharp(outputs.get("icc-profile")!).metadata();
  assert.ok(profiled.icc && profiled.icc.length > 0, "icc-profile fixture must carry ICC/profile metadata");
});
```

Also add deterministic class-specific pixel/statistics assertions so the test proves that:
- `photo` contains smooth tonal variation plus edge/detail regions;
- `text-packaging` contains high-contrast text-like bars/blocks;
- `fine-texture` contains repeatable high-frequency detail;
- `dark-gradient` contains a dark low-amplitude gradient suitable for banding inspection;
- `transparent` contains both alpha-zero/alpha-partial/alpha-one regions;
- `icc-profile` contains an embedded ICC/profile payload that Sharp reports.

- [ ] **Step 5: Run the fixture test and prove meaningful RED**

```powershell
node --test tests/media-fixtures.test.ts
```

Expected RED: modules load and every fixture decodes, but class-specific assertions fail because the compileable sentinel implementation produces the same generic image and lacks the required class-specific content/profile behavior. Module-not-found, missing fixture, syntax error, Sharp load failure, or environment/configuration failure is **not** valid RED.

- [ ] **Step 6: Implement `createPhase6MediaFixture()` with deterministic representative content**

Replace the sentinel body with a deterministic switch. Use only generated pixels/SVG primitives owned by the test suite; no production/copyrighted imagery. The implementation shape is:

```ts
export async function createPhase6MediaFixture(
  kind: MediaFixtureKind,
  width: number,
  height: number
): Promise<Uint8Array> {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("MEDIA_FIXTURE_DIMENSIONS_INVALID");
  }

  switch (kind) {
    case "photo":
      return createPhotoFixture(width, height);
    case "text-packaging":
      return createTextPackagingFixture(width, height);
    case "fine-texture":
      return createFineTextureFixture(width, height);
    case "dark-gradient":
      return createDarkGradientFixture(width, height);
    case "transparent":
      return createTransparentFixture(width, height);
    case "icc-profile":
      return createIccProfileFixture(width, height);
  }
}
```

Implement helper functions with fixed formulas/seeds only. `createIccProfileFixture()` must embed a deterministic test ICC profile supported by the selected Sharp/libvips build; if that build cannot create/embed one reproducibly, STOP calibration and record the capability gap rather than silently substituting an unprofiled fixture.

- [ ] **Step 7: Run fixture GREEN before creating any calibration evidence**

```powershell
node --test tests/media-fixtures.test.ts
```

Expected: exit 0; all classes are non-empty, deterministic, decodable, correct-dimension, and satisfy their representative-class assertions.

Calibration is forbidden if this step is not GREEN.

- [ ] **Step 8: Create the calibration script with explicit benchmark candidates**

Create `scripts/phase6-media-calibration.ts`. It must import the verified `createPhase6MediaFixture()` and record, per fixture: source dimensions/bytes, decode time, peak-process memory sample, master dimensions/bytes/encoding time, WebP/AVIF rendition bytes/encoding time, and failures.

```ts
export const MASTER_STRATEGIES = [
  "lossless-webp",
  "lossless-png",
  "lossless-tiff",
] as const;

export const CANDIDATE_WIDTHS = [320, 640, 960, 1280, 1600, 2048] as const;
export const CANDIDATE_WEBP_QUALITY = 88;
export const CANDIDATE_AVIF_QUALITY = 65;
export const CANDIDATE_INPUT_PIXEL_LIMIT = 40_000_000;
export const CANDIDATE_INPUT_AXIS_LIMIT = 12_000;
export const CANDIDATE_MASTER_LONG_EDGE = 5_120;
export const CANDIDATE_MASTER_PIXEL_LIMIT = 24_000_000;
```

Use lossless PNG only where alpha/graphics genuinely justify it; lossless TIFF/deflate is the third high-fidelity opaque-photo benchmark candidate, not a preselected production master.

- [ ] **Step 9: Add a calibration preflight assertion that rejects dummy/empty fixtures**

Before timing any fixture, the script must run:

```ts
const bytes = await createPhase6MediaFixture(kind, width, height);
if (bytes.byteLength === 0) throw new Error(`CALIBRATION_FIXTURE_EMPTY:${kind}`);
const metadata = await sharp(bytes).metadata();
if (metadata.width !== width || metadata.height !== height) {
  throw new Error(`CALIBRATION_FIXTURE_DIMENSION_MISMATCH:${kind}`);
}
```

The benchmark must not contain a fallback that substitutes empty bytes or skips decode verification.

- [ ] **Step 10: Execute calibration only after fixture GREEN**

```powershell
node --test tests/media-fixtures.test.ts
if ($LASTEXITCODE -ne 0) { throw 'MEDIA_FIXTURE_GATE_FAILED' }
npx tsx scripts/phase6-media-calibration.ts --output docs/superpowers/evidence/phase6-media-calibration.md
```

Expected: evidence file contains measured rows for all six representative classes and bounded worst-case inputs. If `tsx` is not already present, use the repository's existing TypeScript script runner; do not install a second runner solely for this script without owner review.

- [ ] **Step 11: Decide only evidence-backed profile-v1 calibration values in the evidence document**

The evidence must explicitly record:

```text
UPLOAD_FILE_LIMIT: preserve approximately 5 MB unless legitimate premium fixtures exceed it
INPUT_PIXEL_LIMIT: selected measured value; 40 MP only if safe
INPUT_AXIS_LIMIT: selected measured value; 12k only if safe
MASTER_DIMENSION_POLICY: selected measured ceiling; 5120px/24MP only if justified
MASTER_ENCODING: selected from measured high-fidelity strategies
WIDTH_LADDER: useful measured widths only
WEBP_QUALITY: selected after visual evidence; 88 is only starting point
AVIF_ENABLED: true only if stable and quality-validated; otherwise false
AVIF_QUALITY: meaningful only when enabled
PROCESSING_CONCURRENCY: measured bounded value
PROCESSING_BUDGET: measured bounded value
EXECUTION_MODE: SYNC only if request/runtime benchmark is safe; otherwise DB_BACKED
```

No fixed KB limit is permitted.

- [ ] **Step 12: Verify package integrity, fixture gate, calibration script, and commit calibration package**

```powershell
node --test tests/media-fixtures.test.ts
node --test tests/product-image-schema.test.ts
npx tsc --noEmit
npm run lint -- --file scripts/phase6-media-calibration.ts --file tests/helpers/mediaFixtures.ts --file tests/media-fixtures.test.ts
git diff --check
git add -- package.json package-lock.json scripts/phase6-media-calibration.ts tests/helpers/mediaFixtures.ts tests/media-fixtures.test.ts docs/superpowers/evidence/phase6-media-calibration.md
git commit -m "chore: calibrate phase 6 image processing"
```

---

### Task 3: Lock Media Domain Semantics + Immutable Processing-Profile Identity

**Files:**
- Create: `lib/media/domain.ts`
- Create: `lib/media/processingProfile.ts`
- Create: `tests/media-domain.test.ts`
- Create: `tests/media-processing-profile.test.ts`

**Interfaces:**
- Consumes: Task 2 evidence-selected calibration values.
- Produces: canonical domain unions, `ProductImageProcessingProfile`, deterministic `canonicalizeProcessingProfile()`, `hashProcessingProfile()`, lifecycle-transition predicates, and immutable output-format semantics.

- [ ] **Step 1: Create compileable domain/profile shells before behavioral tests**

```ts
// lib/media/domain.ts
export type ManagedMediaType = "IMAGE";
export type ManagedMediaLifecycleState =
  | "PENDING" | "PROCESSING" | "READY" | "CLEANUP_PENDING"
  | "DELETING" | "DELETED" | "FAILED";
export type ProductImageSourceKind = "MANAGED" | "LEGACY_LOCAL" | "LEGACY_EXTERNAL";
export type MediaObjectRole = "MASTER" | "RENDITION";
export type MediaAccessClass = "PRIVATE_SOURCE" | "PUBLIC_DELIVERY";
export type MediaStagingState = "ALLOCATED" | "PRESENT" | "CLEANUP_PENDING" | "DELETED";
export type MediaIngestPurpose = "PRODUCT_IMAGE";
export type MediaProcessingRunState = "PENDING" | "PROCESSING" | "COMPLETE" | "FAILED";
export type MediaFailurePhase = "INGEST" | "PROCESSING" | "STORAGE" | "CLEANUP";

// lib/media/processingProfile.ts
export type ProductImageProcessingProfile = Readonly<{
  version: string;
  enabledDeliveryFormats: readonly ("webp" | "avif")[];
  widths: readonly number[];
  webpQuality: number;
  avifQuality: number | null;
  inputPixelLimit: number;
  inputAxisLimit: number;
  masterLongEdgeLimit: number;
  masterPixelLimit: number;
  masterStrategy: Readonly<{
    opaque: "lossless-webp" | "lossless-tiff";
    alpha: "lossless-webp" | "lossless-png";
  }>;
}>;
```

- [ ] **Step 2: Write behavioral RED tests for lifecycle semantics, access classes, and deterministic profile hashing**

Tests must assert: `CLEANUP_PENDING` is attachable only when unsuspended; `DELETING/DELETED` never attach; initial first-ingest processing may move asset to PROCESSING but future profile regeneration does not; MASTER maps to PRIVATE_SOURCE; RENDITION maps to PUBLIC_DELIVERY; reordering object keys in the profile representation yields the same canonical hash; changing `enabledDeliveryFormats` changes the hash and requires a different profile version.

```ts
assert.equal(canAttachManagedMedia("CLEANUP_PENDING", null), true);
assert.equal(canAttachManagedMedia("CLEANUP_PENDING", new Date()), false);
assert.equal(canAttachManagedMedia("DELETING", null), false);
assert.notEqual(hashProcessingProfile(webpOnly), hashProcessingProfile(webpAndAvif));
```

- [ ] **Step 3: Run RED and verify assertion failures come from missing semantics, not loading/configuration failures**

```powershell
node --test tests/media-domain.test.ts tests/media-processing-profile.test.ts
```

Expected RED: tests load both new modules successfully, then fail assertions because shell predicates/hash behavior are neutral/incomplete. A module-resolution, syntax, fixture, or environment error invalidates the RED and must be fixed before continuing.

- [ ] **Step 4: Implement minimal deterministic domain/profile behavior**

Implement `canAttachManagedMedia`, `assertMediaObjectRoleAccessClass`, a canonical profile serializer that sorts semantic object keys deterministically but preserves rendition-width order, and SHA-256 hashing over only semantic processing settings. Exclude provider endpoints, buckets, credentials, environment name, CDN hostname, and unrelated runtime configuration from the hash.


```ts
export function canAttachManagedMedia(state: ManagedMediaLifecycleState, deliveryDisabledAt: Date | null): boolean {
  return deliveryDisabledAt === null && (state === "READY" || state === "CLEANUP_PENDING");
}

export function assertMediaObjectRoleAccessClass(role: MediaObjectRole, accessClass: MediaAccessClass): void {
  const valid = (role === "MASTER" && accessClass === "PRIVATE_SOURCE") ||
    (role === "RENDITION" && accessClass === "PUBLIC_DELIVERY");
  if (!valid) throw new Error("MEDIA_OBJECT_ROLE_ACCESS_CLASS_INVALID");
}

export function hashProcessingProfile(profile: ProductImageProcessingProfile): string {
  return createHash("sha256").update(canonicalizeProcessingProfile(profile)).digest("hex");
}
```
- [ ] **Step 5: Run GREEN and focused regression**

```powershell
node --test tests/media-domain.test.ts tests/media-processing-profile.test.ts
node --test tests/product-gallery-write.test.ts tests/product-image-schema.test.ts
npx tsc --noEmit
```

Expected: all targeted tests exit 0.

- [ ] **Step 6: Commit the domain/profile contract**

```powershell
git diff --check
git add -- lib/media/domain.ts lib/media/processingProfile.ts tests/media-domain.test.ts tests/media-processing-profile.test.ts
git commit -m "feat: define managed media domain contracts"
```

---

### Task 4: Add Backward-Compatible EXPAND Persistence Schema Locally

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260905010000_phase6_media_expand/migration.sql`
- Modify: `tests/product-image-schema.test.ts`
- Modify: `tests/migration-rehearsal-postgres.test.ts`

**Interfaces:**
- Consumes: Task 3 domain semantics; local/disposable PostgreSQL only.
- Produces: additive `ManagedMedia`, `MediaProcessingRun`, `MediaObject` schema and nullable ProductImage extension. No shared database change.

- [ ] **Step 1: Create an empty compileable migration unit so RED is not a missing-file failure**

```powershell
New-Item -ItemType Directory -Force 'prisma\migrations\20260905010000_phase6_media_expand' | Out-Null
Set-Content -NoNewline 'prisma\migrations\20260905010000_phase6_media_expand\migration.sql' "-- Phase 6 EXPAND migration shell`n"
```

- [ ] **Step 2: Write RED schema tests for the exact additive model shape**

Require: `ManagedMedia`, `MediaProcessingRun`, `MediaObject`; nullable `ProductImage.sourceKind`, `managedMediaId`, `altText`; restrictive ProductImage→ManagedMedia FK intent; no Product-level primary media FK; no `referenceCount`, `isAttached`, polymorphic owner table, or redundant `MediaObject.managedMediaId`.


```ts
assert.match(schema, /model ManagedMedia\s*\{/);
assert.match(schema, /model MediaProcessingRun\s*\{/);
assert.match(schema, /model MediaObject\s*\{/);
assert.match(schema, /sourceKind\s+ProductImageSourceKind\?/);
assert.match(schema, /managedMediaId\s+String\?/);
assert.doesNotMatch(schema, /referenceCount|isAttached|ownerType\s+String/);
assert.doesNotMatch(mediaObjectModel, /managedMediaId/);
```
- [ ] **Step 3: Run RED against current schema and shell migration**

```powershell
node --test tests/product-image-schema.test.ts tests/migration-rehearsal-postgres.test.ts
```

Expected RED: explicit assertions such as `ManagedMedia model expected`/`sourceKind field expected` fail. The migration file exists and test harness connects only to disposable PostgreSQL; missing migration file or unavailable DB is not acceptable RED evidence.

- [ ] **Step 4: Implement the additive Prisma schema with nonredundant ownership**

Model ownership must be:

```text
MediaObject.processingRunId -> MediaProcessingRun.id
MediaProcessingRun.managedMediaId -> ManagedMedia.id
```

Do not add `MediaObject.managedMediaId`. Include `ManagedMedia.activeProcessingRunId?`, `canonicalMasterObjectId?`, `deliveryDisabledAt?`, scoped idempotency fields, ingest SHA/bytes/MIME, deterministic staging provider/key/state, cleanup timing/failure fields, and tombstone `deletedAt?`. `sourceKind` remains nullable in EXPAND. During local schema authoring, evaluate a clean composite active-run same-media FK: if Prisma validates a stable `(activeProcessingRunId, id) -> (MediaProcessingRun.id, managedMediaId)` relation with non-brittle migration SQL, retain it; otherwise use the simple active-run FK and require the later lifecycle/activation service to perform transactional same-media validation plus integration tests. Do not add a trigger.

- [ ] **Step 5: Generate/review EXPAND SQL without applying to any shared database**

Use the repository's disposable PostgreSQL migration authoring process. If a Prisma command would target a URL that is not clearly disposable/local, STOP. The generated SQL must be inspected before use and must not contain destructive Product/ProductImage rewrites.

```powershell
if (-not $env:PHASE6_DISPOSABLE_DATABASE_URL) { throw 'PHASE6_DISPOSABLE_DATABASE_URL_MISSING' }
if ($env:DATABASE_URL -ne $env:PHASE6_DISPOSABLE_DATABASE_URL) { throw 'DATABASE_TARGET_NOT_DISPOSABLE' }
Get-Content 'prisma\migrations\20260905010000_phase6_media_expand\migration.sql'
```

- [ ] **Step 6: Run GREEN on fresh disposable PostgreSQL and verify old fields remain usable**

```powershell
npx prisma validate
node --test tests/product-image-schema.test.ts tests/migration-rehearsal-postgres.test.ts
npx tsc --noEmit
```

Expected: all targeted checks exit 0; rehearsal proves old `Product.image` and `ProductImage.url` remain non-null/current-compatible.

- [ ] **Step 7: Commit EXPAND only**

```powershell
git diff --check
git add -- prisma/schema.prisma prisma/migrations/20260905010000_phase6_media_expand/migration.sql tests/product-image-schema.test.ts tests/migration-rehearsal-postgres.test.ts
git commit -m "feat: expand schema for managed media"
$expandReleaseCommit = (git rev-parse HEAD).Trim()
"EXPAND_RELEASE_COMMIT=$expandReleaseCommit"
```

Record `EXPAND_RELEASE_COMMIT` in the Task-4 checkpoint report. Task 26 must use this exact immutable commit for the staged production EXPAND release; do not infer it from final HEAD.

---

### Task 5: Build Bridge for Nullable `sourceKind` Without Enabling Managed Ingestion

**Files:**
- Modify: `lib/catalog/galleryPersistence.ts`
- Modify: `lib/catalog/galleryWrite.ts`
- Modify: `lib/catalog/types.ts`
- Test: `tests/product-gallery-write.test.ts`
- Test: `tests/admin-product-gallery-read.test.ts`

**Interfaces:**
- Consumes: `ProductImageSourceKind` from `@/lib/media/domain`; EXPAND schema where `sourceKind` may be null.
- Produces: bridge classifier/reader that treats known current `/uploads/products/` and `/images/` as legacy-local, `https://` as legacy-external, and preserves null-row compatibility while ManagedMedia creation remains disabled.

- [ ] **Step 1: Add a compileable bridge classifier shell**

```ts
import type { ProductImageSourceKind } from "@/lib/media/domain";

export function classifyLegacyProductImageUrl(url: string): ProductImageSourceKind | null {
  return null;
}
```

- [ ] **Step 2: Write behavioral RED cases for known roots and unsafe/unknown schemes**

Assert exact classifications for `/uploads/products/a.jpg`, `/images/a.jpg`, and `https://example.com/a.jpg`; return `null` for `http://`, `data:`, `blob:`, protocol-relative, unknown local roots, or traversal. Read logic must derive classification for temporarily null `sourceKind`; write logic must never create MANAGED media yet.


```ts
assert.equal(classifyLegacyProductImageUrl("/uploads/products/a.jpg"), "LEGACY_LOCAL");
assert.equal(classifyLegacyProductImageUrl("/images/a.jpg"), "LEGACY_LOCAL");
assert.equal(classifyLegacyProductImageUrl("https://cdn.example/a.jpg"), "LEGACY_EXTERNAL");
assert.throws(() => classifyLegacyProductImageUrl("http://example/a.jpg"), /UNSUPPORTED/);
assert.throws(() => classifyLegacyProductImageUrl("data:image/png;base64,abc"), /UNSUPPORTED/);
```
- [ ] **Step 3: Run RED for classifier behavior**

```powershell
node --test tests/product-gallery-write.test.ts tests/admin-product-gallery-read.test.ts
```

Expected RED: module loads; known-root classification assertions fail because shell returns null. No missing-module/configuration RED is accepted.

- [ ] **Step 4: Implement the bridge with explicit known current roots only**

Use the existing `normalizeProductImageReference` rules and imported `ProductImageSourceKind`; do not duplicate a second enum. Null `sourceKind` is tolerated only during the bridge window. Managed ingestion remains feature-disabled and no arbitrary external URL creation is added.


```ts
export function classifyLegacyProductImageUrl(url: string): "LEGACY_LOCAL" | "LEGACY_EXTERNAL" {
  if (url.startsWith("/uploads/products/") || url.startsWith("/images/")) return "LEGACY_LOCAL";
  if (url.startsWith("https://")) return "LEGACY_EXTERNAL";
  throw new Error("PRODUCT_IMAGE_REFERENCE_UNSUPPORTED");
}

export function resolveBridgeSourceKind(row: { sourceKind: ProductImageSourceKind | null; url: string }): ProductImageSourceKind {
  return row.sourceKind ?? classifyLegacyProductImageUrl(row.url);
}
```
- [ ] **Step 5: Run GREEN and legacy regression**

```powershell
node --test tests/product-gallery-write.test.ts tests/admin-product-gallery-read.test.ts tests/admin-gallery-edit-ui.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit bridge behavior**

```powershell
git diff --check
git add -- lib/catalog/galleryPersistence.ts lib/catalog/galleryWrite.ts lib/catalog/types.ts tests/product-gallery-write.test.ts tests/admin-product-gallery-read.test.ts tests/admin-gallery-edit-ui.test.ts
git commit -m "feat: bridge legacy product image classification"
$bridgeReleaseCommit = (git rev-parse HEAD).Trim()
"BRIDGE_RELEASE_COMMIT=$bridgeReleaseCommit"
```

Record `BRIDGE_RELEASE_COMMIT` in the Task-5 checkpoint report. This exact commit is the post-EXPAND bridge application release used by Task 26 with managed ingestion disabled.

---

### Task 6: Author/Prove CLASSIFY Migration With Pre/Post Evidence

**Files:**
- Create: `prisma/migrations/20260905020000_phase6_product_image_classification/migration.sql`
- Modify: `tests/migration-rehearsal-postgres.test.ts`
- Modify: `tests/product-image-schema.test.ts`

**Interfaces:**
- Consumes: EXPAND + bridge semantics.
- Produces: idempotent classification-only migration and pre/post evidence; creates zero ManagedMedia rows.

- [ ] **Step 1: Audit representative/disposable ProductImage URL classes before writing classification SQL**

Rehearsal fixtures must include `/uploads/products/...`, `/images/...`, `https://...`, and one deliberate unknown/unsafe scheme. The migration precondition query must count every detected class and STOP if any value is outside the approved classes.

- [ ] **Step 2: Create a compileable SQL shell then write RED migration tests**

```powershell
New-Item -ItemType Directory -Force 'prisma\migrations\20260905020000_phase6_product_image_classification' | Out-Null
Set-Content -NoNewline 'prisma\migrations\20260905020000_phase6_product_image_classification\migration.sql' "-- Phase 6 ProductImage classification shell`n"
```

RED assertions must prove the shell leaves `sourceKind` null and therefore fails expected classification while preserving row IDs/order/URLs.

- [ ] **Step 3: Run RED on disposable PostgreSQL**

```powershell
node --test tests/migration-rehearsal-postgres.test.ts tests/product-image-schema.test.ts
```

Expected RED: classification assertions fail after a successful disposable DB setup and successful shell migration application. Unknown-class fixture must already produce the planned STOP signal when classification SQL is enabled later.

- [ ] **Step 4: Implement idempotent `sourceKind IS NULL` classification SQL**

Classify only verified `/uploads/products/%` and `/images/%` as `LEGACY_LOCAL`, and `https://%` as `LEGACY_EXTERNAL`. Before UPDATE, SQL must fail if null rows include any other local/scheme class. Do not alter `id`, `productId`, `sortOrder`, `url`, or `Product.image`; do not create ManagedMedia rows.


```sql
UPDATE "ProductImage"
SET "sourceKind" = 'LEGACY_LOCAL'
WHERE "sourceKind" IS NULL
  AND ("url" LIKE '/uploads/products/%' OR "url" LIKE '/images/%');

UPDATE "ProductImage"
SET "sourceKind" = 'LEGACY_EXTERNAL'
WHERE "sourceKind" IS NULL
  AND "url" LIKE 'https://%';
```
- [ ] **Step 5: Run GREEN and assert exact pre/post invariants**

Required evidence: unknown class count 0 for valid fixture; `sourceKind IS NULL = 0`; ProductImage count/IDs/productId/sortOrder/url unchanged; Product.image unchanged; historical managedMediaId all null; classification-created ManagedMedia count 0. Also prove re-running classification logic is idempotent.

```powershell
node --test tests/migration-rehearsal-postgres.test.ts tests/product-image-schema.test.ts
```

- [ ] **Step 6: Commit CLASSIFY only**

```powershell
git diff --check
git add -- prisma/migrations/20260905020000_phase6_product_image_classification/migration.sql tests/migration-rehearsal-postgres.test.ts tests/product-image-schema.test.ts
git commit -m "feat: classify legacy product images"
$classifyReleaseCommit = (git rev-parse HEAD).Trim()
"CLASSIFY_RELEASE_COMMIT=$classifyReleaseCommit"
```

Record `CLASSIFY_RELEASE_COMMIT` in the Task-6 checkpoint report. Task 26 must use this exact immutable commit for the staged CLASSIFY release after EXPAND is already recorded as applied.

---

### Task 7: Apply CONTRACT Constraints + Rehearse Full Migration Chain

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260905030000_phase6_media_contract/migration.sql`
- Modify: `tests/product-image-schema.test.ts`
- Modify: `tests/migration-rehearsal-postgres.test.ts`

**Interfaces:**
- Consumes: successful CLASSIFY with zero null/unknown rows.
- Produces: final sourceKind NOT NULL + narrow PostgreSQL CHECK/FK/unique/index constraints and fresh/upgrade migration rehearsal evidence on disposable PostgreSQL only.

- [ ] **Step 1: Create a SQL shell and write RED database-integrity tests**

RED invalid-state inserts must attempt: MANAGED+null managedMediaId; legacy+non-null managedMediaId; LEGACY_EXTERNAL with local URL; LEGACY_LOCAL with HTTPS URL; MASTER+PUBLIC_DELIVERY; RENDITION+PRIVATE_SOURCE; duplicate `(managedMediaId, profileVersion)`; duplicate `(processingRunId, variantKey)`; duplicate `(storageProviderKey, objectKey)`. The shell exists so failures are missing constraints, not missing-file errors.


```sql
-- migration shell exists before RED; no constraint is added yet.
SELECT COUNT(*) AS null_source_kind
FROM "ProductImage"
WHERE "sourceKind" IS NULL;
```

```ts
await assert.rejects(insertInvalidManagedRow(db), /constraint/i);
await assert.rejects(insertInvalidRoleAccessPair(db), /constraint/i);
```
- [ ] **Step 2: Run RED on disposable PostgreSQL**

```powershell
node --test tests/product-image-schema.test.ts tests/migration-rehearsal-postgres.test.ts
```

Expected RED: at least the intended invalid insert succeeds when it should be rejected, producing a precise assertion such as `expected PostgreSQL CHECK rejection`. Environment/configuration failure invalidates RED.

- [ ] **Step 3: Implement CONTRACT schema/SQL with narrow row-local constraints**

Set `ProductImage.sourceKind` non-null. Add reviewed raw SQL CHECK constraints for source-kind/managedMediaId consistency, verified legacy URL classes, MASTER→PRIVATE_SOURCE, RENDITION→PUBLIC_DELIVERY, positive object dimensions/bytes, CLEANUP_PENDING timestamps, DELETED tombstone time, FAILED failure metadata, COMPLETE completedAt, and PROCESSING lease. Add ordinary indexes from the spec. Do not add triggers or lifecycle transition graph SQL.


```sql
ALTER TABLE "ProductImage" ALTER COLUMN "sourceKind" SET NOT NULL;
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_source_kind_managed_ck"
CHECK (
  ("sourceKind" = 'MANAGED' AND "managedMediaId" IS NOT NULL)
  OR
  ("sourceKind" IN ('LEGACY_LOCAL','LEGACY_EXTERNAL') AND "managedMediaId" IS NULL)
);

ALTER TABLE "MediaObject" ADD CONSTRAINT "MediaObject_role_access_ck"
CHECK (
  ("role" = 'MASTER' AND "accessClass" = 'PRIVATE_SOURCE')
  OR
  ("role" = 'RENDITION' AND "accessClass" = 'PUBLIC_DELIVERY')
);
```
- [ ] **Step 4: Inspect actual PostgreSQL metadata after migration**

Query `pg_constraint`, `pg_indexes`, and `information_schema` in the disposable database and assert every intended FK/CHECK/unique/index exists. Do not rely solely on `prisma validate`.

- [ ] **Step 5: Run both mandatory migration paths**

```text
FRESH: empty disposable PostgreSQL -> full committed migration chain -> A -> B -> C -> final schema checks
UPGRADE: representative pre-Phase-6 DB -> A -> simulated bridge-compatible writes -> B -> C -> final data/schema checks
```

Use the repository's guarded disposable-PostgreSQL harness. `prisma db push` is not accepted as migration proof.

- [ ] **Step 6: Run GREEN and query-plan sanity checks**

```powershell
npx prisma validate
node --test tests/product-image-schema.test.ts tests/migration-rehearsal-postgres.test.ts
npx tsc --noEmit
```

Capture `EXPLAIN`/query-plan evidence for owner lookup by `ProductImage.managedMediaId`, cleanup candidates `(lifecycleState, cleanupEligibleAt)`, and stale processing `(state, leaseExpiresAt)`; add no speculative index unless measured plans require it.

- [ ] **Step 7: Commit CONTRACT/rehearsal package**

```powershell
git diff --check
git add -- prisma/schema.prisma prisma/migrations/20260905030000_phase6_media_contract/migration.sql tests/product-image-schema.test.ts tests/migration-rehearsal-postgres.test.ts
git commit -m "feat: enforce managed media persistence contracts"
$contractReleaseCommit = (git rev-parse HEAD).Trim()
"CONTRACT_RELEASE_COMMIT=$contractReleaseCommit"
```

Record `CONTRACT_RELEASE_COMMIT` in the Task-7 checkpoint report. Task 26 must use this exact immutable commit for the staged CONTRACT release after EXPAND and CLASSIFY are already recorded as applied.

**Hard gate remains:** these migrations are authored/rehearsed locally only. No shared/non-local migration command is authorized by Task 7.

### Task 8: Define `MediaStorage` Contract + `InMemoryMediaStorage`

**Files:**
- Create: `lib/media/storage/contracts.ts`
- Create: `lib/media/storage/inMemoryMediaStorage.ts`
- Create: `tests/helpers/mediaStorageContract.ts`
- Create: `tests/media-storage-contract.test.ts`

**Interfaces:**
- Consumes: Task 3 media access classes and provider-independent semantics.
- Produces: `MediaStorage`, `MediaStorageError`, typed error codes, immutable put/head/get/delete contracts, and deterministic in-memory test adapter.

- [ ] **Step 1: Create compileable interfaces and neutral in-memory shell**

```ts
export type MediaStorageErrorCode =
  | "AUTHORIZATION" | "UNAVAILABLE" | "TIMEOUT" | "CONFLICT"
  | "NOT_FOUND" | "RATE_LIMITED" | "INTEGRITY_MISMATCH" | "UNKNOWN";

export class MediaStorageError extends Error {
  constructor(public readonly code: MediaStorageErrorCode, message: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

export type PutImmutableInput = Readonly<{
  objectKey: string;
  bytes: Uint8Array;
  contentType: string;
  cacheControl?: string;
  checksumSha256: string;
}>;

export type StoredObjectMetadata = Readonly<{
  objectKey: string;
  byteSize: bigint;
  contentType: string;
  checksumSha256: string;
}>;

export interface MediaStorage {
  putImmutable(input: PutImmutableInput): Promise<StoredObjectMetadata>;
  headObject(objectKey: string): Promise<StoredObjectMetadata | null>;
  getObject(objectKey: string): Promise<Uint8Array>;
  deleteObject(objectKey: string): Promise<void>;
}
```

The in-memory shell must compile and store nothing yet; methods may return neutral empty metadata so tests can reach behavioral assertions.

- [ ] **Step 2: Write one shared contract test suite**

`tests/helpers/mediaStorageContract.ts` must exercise: absent create; same-key/same-SHA idempotent success; same-key/different bytes hard `INTEGRITY_MISMATCH` or `CONFLICT` with no overwrite; HEAD existing/missing; authorized GET; delete existing; delete missing as success; typed injected provider errors.


```ts
export function defineMediaStorageContract(create: () => MediaStorage): void {
  test("immutable put is idempotent for identical bytes and rejects conflicting bytes", async () => {
    const storage = create();
    const first = await storage.putImmutable(validPut("a/key", bytesA));
    const second = await storage.putImmutable(validPut("a/key", bytesA));
    assert.deepEqual(second, first);
    await assert.rejects(storage.putImmutable(validPut("a/key", bytesB)), /INTEGRITY_MISMATCH|CONFLICT/);
    assert.deepEqual(await storage.getObject("a/key"), bytesA);
  });
}
```
- [ ] **Step 3: Run RED for immutable semantics**

```powershell
node --test tests/media-storage-contract.test.ts
```

Expected RED: adapter loads, then behavioral assertions such as `expected stored bytes` or `expected integrity conflict` fail. Missing module/syntax/configuration failure is invalid RED.

- [ ] **Step 4: Implement minimal `InMemoryMediaStorage` to satisfy the shared contract**

Use an internal `Map<string,{bytes,metadata}>`; verify SHA-256 from actual bytes before accepting immutable identity; same identity+same checksum returns metadata; same identity+different content fails closed; `deleteObject` is idempotent.


```ts
async putImmutable(input: PutImmutableInput): Promise<StoredObjectMetadata> {
  const actualSha = sha256(input.bytes);
  if (actualSha !== input.checksumSha256) throw new MediaStorageError("INTEGRITY_MISMATCH", "checksum mismatch");
  const existing = this.objects.get(input.objectKey);
  if (existing) {
    if (existing.metadata.checksumSha256 !== actualSha) throw new MediaStorageError("INTEGRITY_MISMATCH", "immutable key conflict");
    return existing.metadata;
  }
  const metadata = { objectKey: input.objectKey, byteSize: BigInt(input.bytes.byteLength), contentType: input.contentType, checksumSha256: actualSha };
  this.objects.set(input.objectKey, { bytes: input.bytes.slice(), metadata });
  return metadata;
}
```
- [ ] **Step 5: Run GREEN and typecheck**

```powershell
node --test tests/media-storage-contract.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit contract + in-memory adapter**

```powershell
git diff --check
git add -- lib/media/storage/contracts.ts lib/media/storage/inMemoryMediaStorage.ts tests/helpers/mediaStorageContract.ts tests/media-storage-contract.test.ts
git commit -m "feat: define media storage contract"
```

---

### Task 9: `LocalMediaStorage` With Production-Like Semantics / Private-Public Separation

**Files:**
- Create: `lib/media/config.ts`
- Create: `lib/media/storage/localMediaStorage.ts`
- Create: `lib/media/storage/registry.ts`
- Modify: `.env.example`, `.gitignore`
- Create: `tests/media-local-storage.test.ts`

**Interfaces:**
- Consumes: Task 8 `MediaStorage`/`MediaStorageError` contract.
- Produces: environment-isolated LocalMediaStorage with separate private/public roots, immutable keys, typed failures, provider registry lookup by stable provider key, and `isManagedMediaIngestionEnabled(): boolean` from server-only configuration.

- [ ] **Step 1: Create compileable local/config shells**

```ts
export type MediaStorageConfig = Readonly<{
  environment: "development" | "test" | "staging" | "production";
  managedMediaIngestionEnabled: boolean;
  providers: Readonly<Record<string, Readonly<{
    kind: "local" | "s3-compatible";
    accessClass: "PRIVATE_SOURCE" | "PUBLIC_DELIVERY";
  }>>>;
}>;

export function isManagedMediaIngestionEnabled(): boolean {
  return false;
}

export class LocalMediaStorage implements MediaStorage {
  constructor(private readonly root: string) {}
  async putImmutable(input: PutImmutableInput): Promise<StoredObjectMetadata> {
    return { objectKey: input.objectKey, byteSize: 0n, contentType: input.contentType, checksumSha256: input.checksumSha256 };
  }
  async headObject(): Promise<StoredObjectMetadata | null> { return null; }
  async getObject(): Promise<Uint8Array> { return new Uint8Array(); }
  async deleteObject(): Promise<void> {}
}
```

- [ ] **Step 2: Write RED shared-contract + path-safety tests**

Run the Task 8 contract against a temporary local root. Add behavioral assertions for traversal rejection, provider-neutral object keys, private/public root separation, canonical master never under a public web directory, idempotent delete, free-space/write failure typed as `UNAVAILABLE`, and startup fail-closed when a non-production environment points at a production-labeled provider key.


```ts
defineMediaStorageContract(() => new LocalMediaStorage(tempRoot));
await assert.rejects(storage.putImmutable(validPut("../escape", bytesA)), /INVALID_OBJECT_KEY/);
assert.equal(path.resolve(privateRoot).startsWith(path.resolve(publicRoot)), false);
await assert.doesNotReject(storage.deleteObject("missing/object"));
```
- [ ] **Step 3: Run RED**

```powershell
node --test tests/media-local-storage.test.ts
```

Expected RED: adapter module loads, then real filesystem semantics/path-safety assertions fail; no missing fixture/module RED.

- [ ] **Step 4: Implement production-like local semantics**

Use server-generated object keys only; resolve and verify every full path remains under configured root; create parent directories; write to a sibling temporary file then atomically rename where supported; if destination exists verify actual SHA-256 and never overwrite different bytes; HEAD reads file metadata/checksum; GET reads private/internal bytes; DELETE treats not-found as success.


```ts
private resolveObjectPath(objectKey: string): string {
  if (!/^[a-zA-Z0-9/_\-.]+$/.test(objectKey) || objectKey.includes("..")) {
    throw new MediaStorageError("AUTHORIZATION", "invalid object key");
  }
  const resolved = path.resolve(this.root, objectKey);
  if (!resolved.startsWith(path.resolve(this.root) + path.sep)) throw new MediaStorageError("AUTHORIZATION", "path escape");
  return resolved;
}
```

Use exclusive create (`fs.open(path, "wx")`) for the first write; on `EEXIST`, read/verify the existing bytes and metadata. Do not overwrite an existing immutable file.
- [ ] **Step 5: Configure development/test roots without exposing canonical masters**

`.env.example` must document non-secret local roots/provider keys. `.gitignore` must ignore the private local-media root and any generated public dev rendition root. Do not add production secrets or `NEXT_PUBLIC_*` storage credentials.

```dotenv
MEDIA_ENVIRONMENT=development
MEDIA_PRIVATE_ROOT=.local-media/private
MEDIA_PUBLIC_ROOT=.local-media/public
MEDIA_PRIVATE_PROVIDER_KEY=dev-private-local-01
MEDIA_PUBLIC_PROVIDER_KEY=dev-public-local-01
MANAGED_MEDIA_INGESTION_ENABLED=false
```

```gitignore
.local-media/
```

- [ ] **Step 6: Run GREEN + shared contract + focused regression**

```powershell
node --test tests/media-local-storage.test.ts tests/media-storage-contract.test.ts
npx tsc --noEmit
git diff --check
```

- [ ] **Step 7: Commit local/config package**

```powershell
git add -- lib/media/config.ts lib/media/storage/localMediaStorage.ts lib/media/storage/registry.ts tests/media-local-storage.test.ts .env.example .gitignore
git commit -m "feat: add local managed media storage"
```

---

### Task 10: `S3CompatibleMediaStorage` With Atomic Immutable Create Semantics

**Files:**
- Create: `lib/media/storage/s3CompatibleMediaStorage.ts`
- Modify: `lib/media/storage/registry.ts`
- Modify: `package.json`, `package-lock.json`
- Create: `tests/media-s3-storage.test.ts`

**Interfaces:**
- Consumes: Task 8 `MediaStorage` contract; Task 9 registry/config.
- Produces: generic S3-compatible adapter configured outside domain DTOs, provider-independent errors/SHA-256 integrity, and a hard provider-capability gate for concurrency-safe immutable object creation.

- [ ] **Step 1: Verify and pin the minimal AWS SDK package required by the generic adapter**

```powershell
$s3Version = (npm view '@aws-sdk/client-s3' version).Trim()
if (-not $s3Version) { throw 'AWS_S3_SDK_VERSION_LOOKUP_FAILED' }
npm install --save-exact "@aws-sdk/client-s3@$s3Version"
```

Do not install an R2-specific SDK.

- [ ] **Step 2: Create the compileable adapter shell and injectable S3-client seam**

```ts
export type S3CompatibleStorageOptions = Readonly<{
  endpoint?: string;
  region: string;
  bucket: string;
  forcePathStyle?: boolean;
  credentials?: Readonly<{ accessKeyId: string; secretAccessKey: string }>;
}>;

export interface AtomicS3Client {
  send(command: unknown): Promise<unknown>;
}

export class S3CompatibleMediaStorage implements MediaStorage {
  constructor(options: S3CompatibleStorageOptions, client?: AtomicS3Client) {}
  async putImmutable(input: PutImmutableInput): Promise<StoredObjectMetadata> {
    return { objectKey: input.objectKey, byteSize: 0n, contentType: input.contentType, checksumSha256: input.checksumSha256 };
  }
  async headObject(_objectKey: string): Promise<StoredObjectMetadata | null> { return null; }
  async getObject(_objectKey: string): Promise<Uint8Array> { return new Uint8Array(); }
  async deleteObject(_objectKey: string): Promise<void> {}
}
```

- [ ] **Step 3: Write RED tests proving atomic-create intent and typed provider mapping**

Use an injectable deterministic fake S3 client and assert:
- first `putImmutable()` sends a conditional create request equivalent to S3 `If-None-Match: *`;
- no implementation path performs `HEAD → unconditional PUT` as the immutable-create primitive;
- provider precondition failure for an already-existing key triggers HEAD/metadata verification only to distinguish same-content idempotent success from content conflict;
- same key + same SHA/size/content type returns idempotent success;
- same key + different expected SHA/bytes fails `INTEGRITY_MISMATCH`/`CONFLICT` and never overwrites;
- provider `NoSuchKey`→null/idempotent delete, access denied→AUTHORIZATION, throttling→RATE_LIMITED, timeout→TIMEOUT;
- provider ETag is never application integrity authority;
- exported business/domain types contain no R2/Cloudflare/Cloudinary identifiers.


```ts
test("uses atomic conditional create and maps provider errors", async () => {
  const fake = new FakeAtomicS3Client();
  const storage = new S3CompatibleMediaStorage(options, fake);
  await storage.putImmutable(validPut("managed/x", bytesA));
  assert.equal(fake.lastPut?.IfNoneMatch, "*");
  assert.equal(fake.unconditionalPutCount, 0);
  fake.failNextWith("AccessDenied");
  await assert.rejects(storage.headObject("x"), (e: MediaStorageError) => e.code === "AUTHORIZATION");
});
```
- [ ] **Step 4: Add a concurrency RED test to the fake provider**

The fake provider must atomically allow exactly one of two simultaneous create attempts for the same absent key. Run:

```ts
const results = await Promise.allSettled([
  storage.putImmutable(a),
  storage.putImmutable(b),
]);
```

For different content, assert exactly one physical create wins and the loser does not overwrite; the loser resolves only as an integrity conflict after reading the already-created object's application SHA-256 metadata. Do not assume which caller wins.

- [ ] **Step 5: Run RED**

```powershell
node --test tests/media-s3-storage.test.ts
```

Expected RED: module/fake provider load successfully; tests fail because the shell does not yet issue atomic conditional creation or map conflicts correctly. Module/configuration failure is invalid RED.

- [ ] **Step 6: Implement SHA-256 preverification before provider mutation**

Before constructing the provider request, compute SHA-256 from `input.bytes` and require exact equality with `input.checksumSha256`. If it differs, throw `MediaStorageError("INTEGRITY_MISMATCH", ...)` and make **zero** provider calls.


```ts
const actualSha = createHash("sha256").update(input.bytes).digest("hex");
if (actualSha !== input.checksumSha256) {
  throw new MediaStorageError("INTEGRITY_MISMATCH", "input checksum mismatch");
}
```
- [ ] **Step 7: Implement concurrency-safe immutable create using proven atomic provider semantics**

For the selected S3-compatible capability, issue `PutObject` with conditional create semantics equivalent to:

```ts
new PutObjectCommand({
  Bucket: bucket,
  Key: input.objectKey,
  Body: input.bytes,
  ContentType: input.contentType,
  CacheControl: input.cacheControl,
  Metadata: { sha256: input.checksumSha256 },
  IfNoneMatch: "*",
});
```

If the configured provider/SDK combination cannot provide a proven atomic create-if-absent primitive required by this contract, throw a provider-capability/configuration error and fail that provider's authorization gate. **Do not** downgrade to check-then-put, HEAD→PUT→verify, unconditional overwrite, or other race-prone behavior.

- [ ] **Step 8: Implement precondition-conflict recovery without overwrite**

When the atomic create reports “already exists”/precondition failure, HEAD the existing object and compare application-owned SHA-256 metadata, byte size, and content type. Matching immutable content is idempotent success. Missing/mismatching integrity metadata is `INTEGRITY_MISMATCH` or `CONFLICT`. Never issue a second PUT to overwrite the existing key.


```ts
try {
  return await this.atomicCreate(input);
} catch (error) {
  if (!isPreconditionFailed(error)) throw normalizeS3Error(error);
  const existing = await this.headObject(input.objectKey);
  if (!existing || existing.checksumSha256 !== input.checksumSha256 || existing.byteSize !== BigInt(input.bytes.byteLength)) {
    throw new MediaStorageError("INTEGRITY_MISMATCH", "immutable object conflict");
  }
  return existing;
}
```
- [ ] **Step 9: Implement HEAD/GET/DELETE and provider-independent error normalization**

Use only the conservative common S3 operations needed by the approved contract. Delete-not-found is desired-end-state success. Normalize raw provider errors into `MediaStorageError` without leaking bucket, endpoint, credentials, or raw provider details to domain/UI callers.


```ts
async deleteObject(objectKey: string): Promise<void> {
  try { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey })); }
  catch (error) { if (!isNotFound(error)) throw normalizeS3Error(error); }
}

function normalizeS3Error(error: unknown): MediaStorageError {
  if (isAccessDenied(error)) return new MediaStorageError("AUTHORIZATION", "storage authorization failed");
  if (isRateLimited(error)) return new MediaStorageError("RATE_LIMITED", "storage rate limited");
  if (isTimeout(error)) return new MediaStorageError("TIMEOUT", "storage timeout");
  return new MediaStorageError("UNKNOWN", "storage operation failed");
}
```
- [ ] **Step 10: Run GREEN plus shared contract/concurrency regression**

```powershell
node --test tests/media-s3-storage.test.ts tests/media-storage-contract.test.ts
npx tsc --noEmit
```

Expected: atomic-create, idempotency, conflict, error mapping, and shared contract tests all exit 0.

- [ ] **Step 11: Commit generic S3 adapter**

```powershell
git diff --check
git add -- lib/media/storage/s3CompatibleMediaStorage.ts lib/media/storage/registry.ts tests/media-s3-storage.test.ts package.json package-lock.json
git commit -m "feat: add s3 compatible media storage"
```

---

### Task 11: Isolated Real-R2 Integration Authorization + Atomic-Create Capability Gate

**Files:**
- Create: `tests/media-r2-integration.test.ts`
- Create: `docs/superpowers/evidence/phase6-media-acceptance.md`
- No production R2/DNS/credential resource may be created by default.

**Interfaces:**
- Consumes: Task 10 generic S3-compatible adapter and atomic immutable-create contract.
- Produces: isolated real-provider evidence proving R2 suitability, including concurrent create-if-absent behavior, or a documented open provider gate that leaves the architecture provider-independent.

- [ ] **Step 1: Revalidate R2 at execution time before any cloud mutation**

Record current pricing, required S3 operations, conditional/atomic create behavior, custom-domain behavior, DNS compatibility, credential scope, account ownership, and deployment compatibility in `docs/superpowers/evidence/phase6-media-acceptance.md`.

- [ ] **Step 2: STOP for explicit owner authorization before creating/using isolated R2 test resources**

If owner does not authorize isolated R2 test resources/credentials, record `R2_INTEGRATION_PENDING`; do not fabricate evidence. Application development may continue against Local/InMemory, but Path-A production-provider authorization remains open.

- [ ] **Step 3: When authorized, configure test-only credentials outside Git/client bundles**

Use test-process environment variables only. Never write credentials into `.env.example`, logs, evidence, screenshots, committed files, or client bundles.

```powershell
$requiredR2TestVariables = @(
  'PHASE6_R2_ENDPOINT',
  'PHASE6_R2_ACCESS_KEY_ID',
  'PHASE6_R2_SECRET_ACCESS_KEY',
  'PHASE6_R2_PRIVATE_BUCKET',
  'PHASE6_R2_PUBLIC_BUCKET'
)
foreach ($name in $requiredR2TestVariables) {
  if (-not [Environment]::GetEnvironmentVariable($name)) { throw "R2_TEST_VARIABLE_MISSING:$name" }
}
```

The owner/operator supplies the isolated test values outside Git before this step; the task only verifies they are present in process environment.

- [ ] **Step 4: Write the shared real-provider contract test**

Run the Task-8 storage contract against isolated PRIVATE_SOURCE and PUBLIC_DELIVERY namespaces. Verify write/head/get/delete, SHA-256 metadata, delete/not-found semantics, private-master anonymous access failure, public rendition behavior where intentionally configured, cache metadata, and environment isolation.


```ts
defineMediaStorageContract(() => createAuthorizedR2Adapter());
test("private master is not anonymously readable", async () => {
  const response = await fetch(privateMasterPublicCandidateUrl, { redirect: "manual" });
  assert.notEqual(response.status, 200);
});
```
- [ ] **Step 5: Add a real concurrent immutable-create capability test**

Use one previously absent immutable key and launch two simultaneous Task-10 `putImmutable()` calls with different bytes/SHA values. Assert:
- the selected provider honors the atomic create-if-absent primitive;
- exactly one byte sequence becomes the object;
- the loser cannot overwrite the winner;
- loser reports provider-independent conflict/integrity result after verification;
- final object SHA-256 metadata matches the winning actual bytes;
- no result depends on ETag as integrity authority.

If the provider does not satisfy this contract, record `R2_ATOMIC_CREATE_CAPABILITY=FAIL`, keep R2 unauthorized, and do not weaken Task-10 semantics.


```ts
const [a, b] = await Promise.allSettled([
  storage.putImmutable(validPut(key, bytesA)),
  storage.putImmutable(validPut(key, bytesB)),
]);
assert.equal([a, b].filter((x) => x.status === "fulfilled").length, 1);
const stored = await storage.getObject(key);
assert.ok(equalBytes(stored, bytesA) || equalBytes(stored, bytesB));
```
- [ ] **Step 6: Run exact real-provider tests and capture results**

```powershell
node --test tests/media-r2-integration.test.ts
```

Expected when authorized/configured: exit 0 with shared contract **and concurrent immutable-create** assertions passing. If unauthorized/skipped, record exact skipped/open status and do not call the provider gate passed.

- [ ] **Step 7: Commit test/evidence only; never commit credentials**

```powershell
git diff --check
git add -- tests/media-r2-integration.test.ts docs/superpowers/evidence/phase6-media-acceptance.md
git commit -m "test: verify isolated media provider integration"
```

---

### Task 12: `MediaDeliveryResolver` + Provider-Neutral Public Responsive DTOs

**Files:**
- Create: `lib/media/delivery.ts`
- Create: `lib/media/publicMediaDto.ts`
- Create: `tests/media-delivery-contract.test.ts`

**Interfaces:**
- Consumes: Task 3 profile semantics; Task 8 storage identity metadata; selected active run metadata from persistence.
- Produces: deterministic public URL resolver and provider-neutral DTO builder; suspended/deleted/non-complete media is not deliverable.

- [ ] **Step 1: Create compileable provider-neutral DTO/input shells**

```ts
export type DeliveryReadyManagedMediaInput = Readonly<{
  mediaId: string;
  lifecycleState: "READY" | "CLEANUP_PENDING";
  deliveryDisabledAt: Date | null;
  activeProfileVersion: string;
  width: number;
  height: number;
  objects: readonly Readonly<{
    variantKey: string;
    role: "RENDITION";
    accessClass: "PUBLIC_DELIVERY";
    mimeType: "image/webp" | "image/avif";
    width: number;
    height: number;
    byteSize: bigint;
    objectKey: string;
    deletedAt: Date | null;
  }>[];
}>;

export type PublicResponsiveImageDto = Readonly<{
  mediaId: string;
  width: number;
  height: number;
  fallbackSrc: string;
  sources: readonly Readonly<{ type: "image/avif" | "image/webp"; srcSet: string }>[];
}>;
```

```ts
export interface MediaDeliveryResolver {
  resolvePublicUrl(objectKey: string): string;
}
```

`resolvePublicUrl()` is pure: configured public origin + validated application-owned key, with no provider network request.

- [ ] **Step 2: Write RED delivery tests**

Assert: only PUBLIC_DELIVERY/nondeleted active-run renditions appear; canonical master/private objects never appear; `deliveryDisabledAt != null` rejects DTO generation; DELETING/DELETED/FAILED reject; WebP fallback always exists; AVIF source appears only when the active immutable profile enables AVIF; **DTO source ordering is authoritative and deterministic: AVIF first, WebP second** when AVIF is enabled, and WebP only when AVIF is disabled; BigInt byte size is converted to JSON-safe number/string only in explicitly exposed diagnostics, never serialized raw; URLs contain no R2/AWS bucket/account identifiers supplied as domain fields.

```ts
assert.throws(() => buildPublicResponsiveImageDto({ ...readyInput, deliveryDisabledAt: new Date() }, resolver), /UNAVAILABLE/);
const dto = buildPublicResponsiveImageDto(readyInputWithAvif, resolver);
assert.deepEqual(dto.sources.map((source) => source.type), ["image/avif", "image/webp"]);
const webpOnly = buildPublicResponsiveImageDto(readyInputWebpOnly, resolver);
assert.deepEqual(webpOnly.sources.map((source) => source.type), ["image/webp"]);
assert.equal(JSON.stringify(dto).includes("MASTER"), false);
```
- [ ] **Step 3: Run RED**

```powershell
node --test tests/media-delivery-contract.test.ts
```

Expected RED: module loads; shell DTO behavior fails security/delivery assertions. Module, fixture, syntax, or configuration failure is invalid RED.

- [ ] **Step 4: Implement pure resolver/DTO builder**

The resolver concatenates provider-neutral configured media origin with application-owned immutable key after path validation. DTO builder groups width descriptors by MIME type and sorts width descriptors ascending inside each MIME group; no master fallback. **`buildPublicResponsiveImageDto()` is the single source-order authority**: emit AVIF source metadata first when the pinned active profile actually has AVIF renditions, then WebP; emit WebP only when AVIF is disabled. `fallbackSrc` always comes from WebP. Suspended media returns a typed unavailable result rather than a public source.

```ts
const PUBLIC_SOURCE_PREFERENCE = ["image/avif", "image/webp"] as const;

export function resolvePublicUrl(objectKey: string): string {
  assertPublicObjectKey(objectKey);
  return new URL(objectKey, mediaOrigin.endsWith("/") ? mediaOrigin : `${mediaOrigin}/`).toString();
}

export function buildPublicResponsiveImageDto(input: DeliveryReadyManagedMediaInput, resolver: MediaDeliveryResolver): PublicResponsiveImageDto {
  if (input.deliveryDisabledAt) throw new Error("MEDIA_DELIVERY_DISABLED");
  const renditions = input.objects.filter((o) => o.role === "RENDITION" && o.accessClass === "PUBLIC_DELIVERY" && o.deletedAt === null);
  if (!renditions.some((o) => o.mimeType === "image/webp")) throw new Error("WEBP_FALLBACK_REQUIRED");
  return toResponsiveDto(input, renditions, resolver, PUBLIC_SOURCE_PREFERENCE);
}
```

`toResponsiveDto()` must omit the AVIF group entirely when the immutable profile did not generate AVIF. Rendering components consume this order and must not introduce a competing sort policy.
- [ ] **Step 5: Run GREEN + static provider-leak scan**

```powershell
node --test tests/media-delivery-contract.test.ts
npx tsc --noEmit
$businessPaths = @('lib/media/publicMediaDto.ts','lib/media/delivery.ts')
Select-String -Path $businessPaths -Pattern 'r2Bucket|cloudinaryPublicId|awsS3Key|Cloudflare.*Account' -CaseSensitive:$false
```

Expected provider-leak scan: no matches.

- [ ] **Step 6: Commit delivery contract**

```powershell
git diff --check
git add -- lib/media/delivery.ts lib/media/publicMediaDto.ts tests/media-delivery-contract.test.ts
git commit -m "feat: add provider neutral media delivery dto"
```

---

### Task 13: Real Decode/Canonical-Master Normalization/Security Limits

**Files:**
- Create: `lib/media/imageProcessor.ts`
- Create: `tests/media-image-security.test.ts`
- Modify: `tests/helpers/mediaFixtures.ts`

**Interfaces:**
- Consumes: Task 2 selected calibration evidence; Task 3 `ProductImageProcessingProfile`.
- Produces: lightweight `validateProductImageUploadEnvelope()` for cheap pre-staging MIME/signature/container admission, plus `ImageProcessor.processInitialProductImage()` for full real decode/normalization/canonical processing and `generateDeliveryRenditions()` for later profile runs.

- [ ] **Step 1: Create compileable processor contract and neutral shell**

```ts
export type ProductImageSourceInput = Readonly<{
  bytes: Uint8Array;
  declaredMimeType: string;
}>;

export type ProductImageUploadEnvelopeValidation = Readonly<{
  normalizedMimeType: "image/jpeg" | "image/png" | "image/webp" | "image/avif";
  detectedContainer: "jpeg" | "png" | "webp" | "avif";
}>;

export function validateProductImageUploadEnvelope(
  input: ProductImageSourceInput
): ProductImageUploadEnvelopeValidation {
  throw new Error("UPLOAD_ENVELOPE_VALIDATION_NOT_IMPLEMENTED");
}

export type CanonicalMasterInput = Readonly<{
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  sha256: string;
}>;

export type ProcessedMediaObject = Readonly<{
  role: "MASTER" | "RENDITION";
  accessClass: "PRIVATE_SOURCE" | "PUBLIC_DELIVERY";
  variantKey: string;
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
  sha256: string;
}>;

export type ProcessedProductImage = Readonly<{
  canonicalMaster: ProcessedMediaObject;
  renditions: readonly ProcessedMediaObject[];
}>;

export interface ImageProcessor {
  processInitialProductImage(
    input: ProductImageSourceInput,
    profile: ProductImageProcessingProfile
  ): Promise<ProcessedProductImage>;

  generateDeliveryRenditions(
    master: CanonicalMasterInput,
    profile: ProductImageProcessingProfile
  ): Promise<readonly ProcessedMediaObject[]>;
}
```

- [ ] **Step 2: Write behavioral RED security tests using valid generated bytes**

First test the lightweight pre-staging envelope validator independently: declared MIME allow-list; supported JPEG/PNG/WebP/AVIF container signatures; MIME/signature agreement; obvious SVG/GIF rejection; and obvious animation-container rejection where safely detectable from the container envelope (for example WebP `ANIM`, PNG `acTL`, or a known AVIF sequence brand). This validator is intentionally cheap and does **not** replace real decode.

Then test the full processor: JPEG/PNG/still WebP accepted; AVIF input accepted only when capability-gated; animated WebP/animated AVIF/APNG/multipage rejected even when not caught by preliminary admission; MIME/signature/decoded-format mismatch rejected; truncated/malformed raster rejected by real decode; candidate pixel/axis limits rejected; orientation normalized; EXIF/GPS/unnecessary metadata removed; ICC/color handling produces controlled sRGB output; transparency preserved; no upscaling; aspect ratio preserved.

```ts
assert.deepEqual(validateProductImageUploadEnvelope(jpegInput), {
  normalizedMimeType: "image/jpeg",
  detectedContainer: "jpeg",
});
assert.throws(() => validateProductImageUploadEnvelope(mimeMismatchInput), /FORMAT_MISMATCH/);
assert.throws(() => validateProductImageUploadEnvelope(gifInput), /UNSUPPORTED_FORMAT/);
await assert.doesNotReject(() => processor.processInitialProductImage(jpegInput, profile));
await assert.rejects(() => processor.processInitialProductImage(animatedWebpInput, profile), /ANIMATED_MEDIA_UNSUPPORTED/);
```
- [ ] **Step 3: Run RED**

```powershell
node --test tests/media-image-security.test.ts
```

Expected RED: valid fixture helpers and processor module load; security assertions fail because shell processing is incomplete. No missing fixture, unsupported local test environment, or syntax error is accepted as RED.

- [ ] **Step 4: Implement the lightweight upload-envelope validator, then full decode/normalization**

Implement `validateProductImageUploadEnvelope()` without invoking Sharp: normalize the declared MIME against the approved allow-list, inspect only enough leading/container bytes to identify JPEG/PNG/WebP/AVIF, reject obvious SVG/GIF/known animated-container markers where safely detectable, and require declared MIME/container agreement. It must not perform pixel limits, orientation, ICC/color conversion, metadata sanitation, or canonical encoding.

Then configure Sharp input pixel limit from profile; inspect decoded metadata/pages; reject frame/page count >1; verify decoded format matches the preliminary container/declared MIME after alias normalization; auto-orient pixels; use controlled color-space conversion to sRGB; preserve alpha; strip private/unnecessary metadata; reject unsupported HDR/wide-gamut cases rather than silently distorting; resize master only when selected calibrated limits require it and never upscale.

```ts
export function validateProductImageUploadEnvelope(input: ProductImageSourceInput): ProductImageUploadEnvelopeValidation {
  const normalizedMimeType = normalizeDeclaredProductImageMime(input.declaredMimeType);
  const detectedContainer = detectSupportedRasterContainer(input.bytes);
  rejectObviousUnsupportedOrAnimatedContainer(input.bytes, detectedContainer);
  assertMimeMatchesContainer(normalizedMimeType, detectedContainer);
  return { normalizedMimeType, detectedContainer };
}
```


```ts
const image = sharp(input.bytes, { limitInputPixels: profile.inputPixelLimit, animated: false });
const metadata = await image.metadata();
if (!metadata.width || !metadata.height) throw new Error("IMAGE_DIMENSIONS_MISSING");
if (metadata.pages && metadata.pages !== 1) throw new Error("ANIMATED_MEDIA_UNSUPPORTED");
assertAllowedDecodedFormat(input.declaredMimeType, metadata.format);
const normalized = image.rotate().toColourspace("srgb");
```
- [ ] **Step 5: Implement evidence-selected canonical-master strategy**

Use Task 2's measured `masterStrategy.opaque`/`masterStrategy.alpha`. The output must be visually lossless/high-fidelity, `role=MASTER`, `accessClass=PRIVATE_SOURCE`, and never use an aggressively compressed card rendition as source. Compute SHA-256 from produced bytes.


```ts
const masterBytes = await encodeCanonicalMaster(normalized, hasAlpha, profile.masterStrategy);
const masterMeta = await sharp(masterBytes).metadata();
return {
  role: "MASTER",
  accessClass: "PRIVATE_SOURCE",
  variantKey: "master",
  bytes: new Uint8Array(masterBytes),
  mimeType: masterMime(profile.masterStrategy, hasAlpha),
  width: masterMeta.width!,
  height: masterMeta.height!,
  sha256: sha256(masterBytes),
};
```
- [ ] **Step 6: Run GREEN + focused security regression**

```powershell
node --test tests/media-image-security.test.ts tests/media-processing-profile.test.ts
npx tsc --noEmit
```

- [ ] **Step 7: Commit processor security/master package**

```powershell
git diff --check
git add -- lib/media/imageProcessor.ts tests/media-image-security.test.ts tests/helpers/mediaFixtures.ts
git commit -m "feat: securely normalize product image masters"
```

---

### Task 14: Responsive Renditions — WebP Baseline + Immutable Conditional AVIF

**Files:**
- Modify: `lib/media/imageProcessor.ts`
- Modify: `lib/media/processingProfile.ts`
- Create: `tests/media-renditions.test.ts`
- Modify: `docs/superpowers/evidence/phase6-media-calibration.md`

**Interfaces:**
- Consumes: retained `CanonicalMasterInput`; Task 2/3 calibrated immutable processing profile.
- Produces: `generateDeliveryRenditions(master, profile)` with useful widths only, mandatory WebP, conditional AVIF, no master leak/upscale.

- [ ] **Step 1: Write RED rendition tests against the compileable Task 13 processor**

Assert for a 1500px master: widths exactly useful subset such as 320/640/960/1280 plus a nonredundant terminal 1500 only when profile policy selects it; no 1600/2048; all outputs aspect-preserving/no-upscale; WebP exists for each chosen width; AVIF exists only when `enabledDeliveryFormats` contains `avif`; changing format set under same version is rejected by profile registry/hash guard; every rendition is PUBLIC_DELIVERY; master bytes never appear in rendition list.


```ts
const outputs = await processor.generateDeliveryRenditions(master1500, webpOnlyProfile);
assert.deepEqual(outputs.map((x) => x.width), expectedUsefulWidths);
assert.ok(outputs.every((x) => x.role === "RENDITION" && x.accessClass === "PUBLIC_DELIVERY"));
assert.ok(outputs.some((x) => x.mimeType === "image/webp"));
assert.equal(outputs.some((x) => x.mimeType === "image/avif"), false);
```
- [ ] **Step 2: Run RED**

```powershell
node --test tests/media-renditions.test.ts
```

Expected RED: processor module loads and canonical master fixture is valid; width/format assertions fail because delivery generation is incomplete. Module, fixture, syntax, or environment/configuration failure is invalid RED.

- [ ] **Step 3: Implement high-quality resize/rendition generation**

Use high-quality Lanczos3-class downsampling, no crop/stretch/upscale. Use calibrated WebP quality; AVIF only if profile enables it and runtime capability was proven. Do not silently change a pinned profile's format set or qualities; a semantic change requires a new version/hash.


```ts
for (const width of usefulWidths(master.width, profile.widths)) {
  outputs.push(await encodeRendition(master, width, "webp", profile.webpQuality));
  if (profile.enabledDeliveryFormats.includes("avif")) {
    outputs.push(await encodeRendition(master, width, "avif", profile.avifQuality!));
  }
}
```
- [ ] **Step 4: Verify visual calibration samples before accepting encoder values**

Generate representative source/master/WebP pairs and, when AVIF is enabled, AVIF pairs. Record dimensions/bytes/encoding time and visual findings for packaging text, fine texture, dark gradients, transparency, color. If quality is visibly harmed, adjust profile calibration and bump profile version when semantics already became immutable; do not optimize to arbitrary KB.

- [ ] **Step 5: Run GREEN + profile consistency regression**

```powershell
node --test tests/media-renditions.test.ts tests/media-processing-profile.test.ts tests/media-image-security.test.ts
npx tsc --noEmit
```

- [ ] **Step 6: Commit rendition/profile package**

```powershell
git diff --check
git add -- lib/media/imageProcessor.ts lib/media/processingProfile.ts tests/media-renditions.test.ts docs/superpowers/evidence/phase6-media-calibration.md
git commit -m "feat: generate responsive managed media renditions"
```

---

### Task 15: Durable ManagedMedia Repository Ops, Scoped Idempotency, Private Staging

**Files:**
- Create: `lib/media/mediaRepository.ts`
- Create: `lib/media/mediaIngestService.ts`
- Create: `tests/media-ingest-service.test.ts`

**Interfaces:**
- Consumes: Task 3 immutable profile contract; Tasks 4–7 persistence; Tasks 8–9 storage.
- Produces: database transaction abstraction, scoped idempotent ingest creation, deterministic PRIVATE_SOURCE staging, first-run pinning, partial-output recovery metadata.

- [ ] **Step 1: Create compileable repository/service contracts**

```ts
import type { Prisma } from "@prisma/client";
export type MediaDbTransaction = Prisma.TransactionClient;

export type StartProductImageIngestInput = Readonly<{
  actorScope: string;
  idempotencyKey: string;
  bytes: Uint8Array;
  declaredMimeType: string;
  originalFilename?: string;
}>;

export type MediaIngestResult = Readonly<{
  mediaId: string;
  lifecycleState: "PENDING" | "PROCESSING" | "READY" | "CLEANUP_PENDING" | "FAILED";
  attachable: boolean;
}>;

export interface MediaIngestService {
  startProductImageIngest(input: StartProductImageIngestInput): Promise<MediaIngestResult>;
}
```

- [ ] **Step 2: Write RED idempotency/staging/recovery tests**

Use disposable PostgreSQL + InMemory/Local storage. Assert stable actor ID + `PRODUCT_IMAGE` + key uniqueness; two concurrent same-key requests yield one ManagedMedia; if first request hash is not yet established, the second request joins/returns existing operation state rather than starting a second byte stream; same key+same server-derived SHA resumes; same key+different SHA conflicts; staging key derives deterministically from media ID+ingest identity; crash after staging write but before PRESENT is recoverable by HEAD; staging is not MediaObject. Also seed a retryable FAILED initial ingest with intact verified staging and assert the same key+same bytes reuses the same media ID and transactionally returns its initial ProcessingRun/media to durable PENDING for Task-17 execution; nonretryable failure is not requeued by this path.


```ts
const [a, b] = await Promise.all([
  service.startProductImageIngest(inputWithKey("same-key", bytesA)),
  service.startProductImageIngest(inputWithKey("same-key", bytesA)),
]);
assert.equal(a.mediaId, b.mediaId);
await assert.rejects(service.startProductImageIngest(inputWithKey("same-key", bytesB)), /CONFLICT/);
```
- [ ] **Step 3: Run RED**

```powershell
node --test tests/media-ingest-service.test.ts
```

Expected RED: service loads and disposable DB/storage work; concurrency/idempotency assertions fail because shell persistence logic is incomplete. Database connectivity failure is not valid RED.

- [ ] **Step 4: Implement PENDING allocation and deterministic staging**

Create ManagedMedia + initial MediaProcessingRun/profile hash in DB before storage write. Use DB unique constraint as creator authority; on unique conflict load existing operation. Compute SHA-256 from actual bytes. Allocate stable staging provider/key/state before physical PUT; after PUT verify HEAD/checksum then mark PRESENT.


```ts
const created = await prisma.$transaction(async (tx) => createOrLoadScopedIngest(tx, scopedKey));
const stagingObjectKey = `staging/${created.mediaId}/source`;
await persistStagingLocator(created.mediaId, stagingProviderKey, stagingObjectKey, "ALLOCATED");
await privateStorage.putImmutable(stagingPut(stagingObjectKey, input.bytes));
await markStagingPresent(created.mediaId);
```
- [ ] **Step 5: Implement initial processing orchestration metadata without assuming HTTP lifetime**

Task 15 stops after durable ingest allocation/staging plus the pinned initial `MediaProcessingRun`. It does **not** invoke image processing. Return the durable state for later execution wiring once the processing runner exists. This keeps Task 15 independently compilable and prevents a forward implementation dependency.

For a same-key/same-SHA retry of an existing retryable FAILED ingest, first verify the deterministic staging object still matches expected SHA/size and then reset only the durable execution state in one DB transaction: initial ProcessingRun `FAILED→PENDING`, ManagedMedia `FAILED→PENDING`, clear the current retryable failure summary, preserve the same IDs/profile/staging locator, and do not create new bytes/objects. Nonretryable failure codes reject retry.

```ts
if (existing.lifecycleState === "FAILED" && isRetryableInitialIngestFailure(existing.failureCode)) {
  await verifyExistingStaging(existing);
  await resetInitialRunForRetry(existing.id);
}
return {
  mediaId: media.id,
  lifecycleState: media.lifecycleState,
  attachable: canAttachManagedMedia(media.lifecycleState, media.deliveryDisabledAt),
};
```

The initial ProcessingRun already stores the selected immutable profile version/hash and recoverable staging locator/state. Object generation, READY finalization, and staging cleanup are introduced only by the later lifecycle/processing-runner package.
- [ ] **Step 6: Run GREEN + concurrency repetition**

```powershell
node --test tests/media-ingest-service.test.ts
npx tsc --noEmit
```

Repeat concurrent same-key test multiple times in the test itself; exactly one logical media ID must result.

- [ ] **Step 7: Commit ingest repository/service package**

```powershell
git diff --check
git add -- lib/media/mediaRepository.ts lib/media/mediaIngestService.ts tests/media-ingest-service.test.ts
git commit -m "feat: add durable managed media ingestion"
```

---

### Task 16: Authenticated Product-Image Managed Upload API + Early Admission + Durable Status Contract

**Files:**
- Create: `app/api/media/uploads/route.ts`
- Create: `app/api/media/uploads/[id]/route.ts`
- Create: `lib/media/mediaUploadStatusService.ts`
- Create: `tests/media-upload-route.test.ts`
- Modify conditionally only if runtime evidence requires a streaming parser: `package.json`, `package-lock.json`
- Characterize only unless required: `app/api/upload/route.ts`

**Interfaces:**
- Consumes: existing `requireAdmin` from `lib/adminSession.ts`; Task 9 `isManagedMediaIngestionEnabled()`; Task 12 public-delivery DTO/resolver; Task 13 `validateProductImageUploadEnvelope()`; Task 15 `MediaIngestService.startProductImageIngest()` and durable ManagedMedia/ProcessingRun persistence.
- Produces: authenticated POST ingest and authenticated GET status contracts. Task 16 creates/reads durable state only; it does **not** import, invoke, or require the processing runner introduced by the subsequent lifecycle/runner task.

```ts
export type ManagedMediaUploadStatusResponse = Readonly<{
  mediaId: string;
  state: ManagedMediaLifecycleState;
  attachable: boolean;
  previewUrl?: string;
  failureCode?: string;
}>;

export interface MediaUploadStatusService {
  getProductImageUploadStatus(mediaId: string): Promise<ManagedMediaUploadStatusResponse>;
}
```

`previewUrl` may be present only when a safe nondeleted `PUBLIC_DELIVERY` rendition from the valid active run is publicly deliverable. The status contract never contains provider key, object key, canonical-master URL, credential, signed private URL, or raw provider error.

- [ ] **Step 1: Create compileable POST/GET route and status-service shells**

Create `POST /api/media/uploads` and `GET /api/media/uploads/[id]`. POST shell performs the existing feature gate + Admin auth before reading the request body. GET shell performs Admin auth but **does not use the new-ingestion feature gate**, so an Admin can continue checking already-created media after new ingestion is disabled.

```ts
export const mediaUploadStatusService: MediaUploadStatusService = {
  async getProductImageUploadStatus(mediaId) {
    return { mediaId, state: "PENDING", attachable: false };
  },
};
```

- [ ] **Step 2: Write RED route/status tests for auth, admission order, preliminary validation, and safe response shape**

Instrument request-body reads and the ingest-service call. Assert unauthenticated and disabled-POST requests return before body parsing; authorized over-limit input returns 413; after bytes are admitted the route calls `validateProductImageUploadEnvelope()` before `startProductImageIngest()`; invalid MIME/signature/container causes **zero** durable ingest/staging calls; valid input reaches ingest. Assert GET requires Admin auth, works even when `isManagedMediaIngestionEnabled()` is false, and returns only the safe application fields.

```ts
assert.equal(await requestBodyReadCount(unauthenticatedRequest), 0);
assert.equal(await requestBodyReadCount(featureDisabledPost), 0);
assert.equal((await POST(authorizedOversizeRequest)).status, 413);
await POST(authorizedBadSignatureRequest);
assert.deepEqual(callOrder(), ["requireAdmin", "requestBound", "fileBound", "validateEnvelope"]);
assert.equal(mediaIngestCallCount(), 0);
setManagedMediaIngestionEnabled(false);
assert.equal((await GET(statusRequestFor(existingMediaId), { params: Promise.resolve({ id: existingMediaId }) })).status, 200);
```

- [ ] **Step 3: Write RED status projection tests for PENDING/PROCESSING/READY/FAILED**

Seed durable media rows directly. Assert PENDING/PROCESSING return `attachable=false` and no server preview; READY or valid CLEANUP_PENDING returns `attachable=true` plus a safe PUBLIC_DELIVERY `previewUrl`; FAILED returns a sanitized application `failureCode`; suspended/DELETING/DELETED media never receives a public preview. Assert JSON contains none of `storageProviderKey`, `objectKey`, `canonicalMasterObjectId`, bucket/account identifiers, or private URLs.

```ts
assert.deepEqual(await status(existingPendingId), { mediaId: existingPendingId, state: "PENDING", attachable: false });
const ready = await status(existingReadyId);
assert.equal(ready.attachable, true);
assert.match(ready.previewUrl ?? "", /^https?:\/\//);
assert.equal(JSON.stringify(ready).includes("objectKey"), false);
assert.equal((await status(existingFailedId)).failureCode, "MEDIA_STORAGE_UNAVAILABLE");
```

- [ ] **Step 4: Run RED and reject harness/configuration failures**

```powershell
node --test tests/media-upload-route.test.ts
```

Expected RED: route/auth/DB harnesses and Task-13 validator module load; behavioral order/status assertions fail because shells lack final admission/status behavior. Missing auth mock, module, fixture, disposable DB, syntax, or runtime configuration is invalid RED.

- [ ] **Step 5: Inspect actual Next.js request behavior before choosing multipart implementation**

Verify the strongest practical early-body/per-file controls supported by the current Next.js runtime/deployment. Record evidence; do not claim a buffering model without measurement.

- [ ] **Step 6: Pin a streaming parser only if Step 5 proves it is necessary**

If required:

```powershell
$busboyVersion = (npm view busboy version).Trim()
$busboyTypesVersion = (npm view '@types/busboy' version).Trim()
if (-not $busboyVersion -or -not $busboyTypesVersion) { throw 'BUSBOY_VERSION_LOOKUP_FAILED' }
npm install --save-exact "busboy@$busboyVersion"
npm install --save-dev --save-exact "@types/busboy@$busboyTypesVersion"
```

Otherwise do not add the dependency.

- [ ] **Step 7: Implement exact POST admission order with explicit Task-13 preliminary validator ownership**

The POST flow is:

```text
managed-ingestion feature gate
→ requireAdmin
→ purpose = PRODUCT_IMAGE
→ earliest practical request-body limit
→ multipart/per-file limit
→ extract bytes + declared MIME + sanitized optional filename
→ validateProductImageUploadEnvelope({ bytes, declaredMimeType })
→ mediaIngestService.startProductImageIngest(...)
```

```ts
const envelope = validateProductImageUploadEnvelope({ bytes, declaredMimeType });
const result = await mediaIngestService.startProductImageIngest({
  actorScope: stableAuthenticatedAdminId,
  idempotencyKey,
  bytes,
  declaredMimeType: envelope.normalizedMimeType,
  originalFilename,
});
```

The actor scope comes from a stable internal authenticated Admin identity, never display name/email/client input. Full decode/frame/pixel/orientation/color/metadata/canonical processing remains Task-13 `ImageProcessor` work executed by the later runner. Do not alter legacy `/api/upload` callers.

- [ ] **Step 8: Implement safe status projection and GET route**

`MediaUploadStatusService` reads ManagedMedia + active ProcessingRun + required nondeleted PUBLIC_DELIVERY metadata in bounded DB work and uses the Task-12 pure DTO/delivery resolver to select the safe preview. It performs **zero provider HEAD/GET/LIST calls**. `previewUrl` is the safe WebP fallback/public preview from the active delivery DTO, never a canonical master or staging object.

```ts
export async function getProductImageUploadStatus(mediaId: string): Promise<ManagedMediaUploadStatusResponse> {
  const media = await loadManagedMediaStatusProjection(mediaId);
  const attachable = canAttachManagedMedia(media.lifecycleState, media.deliveryDisabledAt);
  const preview = attachable && media.activeDeliveryInput
    ? buildPublicResponsiveImageDto(media.activeDeliveryInput, mediaDeliveryResolver).fallbackSrc
    : undefined;
  return {
    mediaId: media.id,
    state: media.lifecycleState,
    attachable,
    ...(preview ? { previewUrl: preview } : {}),
    ...(media.safeFailureCode ? { failureCode: media.safeFailureCode } : {}),
  };
}

const status = await mediaUploadStatusService.getProductImageUploadStatus(mediaId);
return Response.json(status);
```

GET authorization is independent of the new-ingestion feature flag. Unknown/not-owned media returns the repository's normal sanitized 404/authorization behavior without infrastructure disclosure.

- [ ] **Step 9: Implement bounded durable POST response without future-runner dependency**

Task 16 returns current durable ingest state, normally PENDING before Task-17 execution exists:

```ts
return Response.json({
  mediaId: result.mediaId,
  state: result.lifecycleState,
  attachable: result.attachable,
} satisfies ManagedMediaUploadStatusResponse);
```

If Task-2 selected `DB_BACKED`, POST returns durable PENDING/PROCESSING and stops. It does not call a runner. If Task-2 selected bounded synchronous execution, the subsequent lifecycle/runner task later adds the runner wiring and re-reads `MediaUploadStatusService` before returning the current state/optional safe preview. Task 16 itself has no compile-time dependency on future runner code.

- [ ] **Step 10: Run GREEN plus auth/security/status regressions**

```powershell
node --test tests/media-upload-route.test.ts tests/media-ingest-service.test.ts tests/media-image-security.test.ts tests/media-delivery-contract.test.ts
npx tsc --noEmit
```

Expected: auth/body/admission order, explicit pre-staging validation, feature-disabled status reads, safe preview projection, and secret/master-negative assertions pass.

- [ ] **Step 11: Commit the upload/status API package**

```powershell
git diff --check
git add -- app/api/media/uploads/route.ts 'app/api/media/uploads/[id]/route.ts' lib/media/mediaUploadStatusService.ts tests/media-upload-route.test.ts
git diff --cached --name-only
```

If Task 16 pinned a streaming parser, stage exactly `package.json package-lock.json` in addition to the files above.

```powershell
git commit -m "feat: add managed product media upload status api"
```

---

### Task 17: Lifecycle, Suspension, Profile Activation, Reconciliation, Deferred Cleanup + Brokerless Processing Runner

**Files:**
- Create: `lib/media/mediaProcessingRunner.ts`
- Create: `lib/media/productMediaAttachmentService.ts`
- Create: `lib/media/mediaLifecycleService.ts`
- Create: `lib/media/mediaReconciliationService.ts`
- Create: `scripts/process-managed-media.ts`
- Create: `scripts/reconcile-managed-media.ts`
- Create: `tests/media-lifecycle-reconciliation.test.ts`
- Modify conditionally when Task-2 evidence selected bounded `SYNC`: `app/api/media/uploads/route.ts`

**Interfaces:**
- Consumes: Task 3 lifecycle/profile semantics; Task 8 storage contract; Task 12 delivery resolver; Tasks 13–14 processor; Task 15 durable ingest/repository state; Task 16 endpoint leaves DB-backed work as durable rows only.
- Produces: processing-run claim/retry, first-ingest finalization, future profile regeneration/activation, suspension-aware lifecycle, three distinct cleanup workflows, reconciliation, and brokerless DB-backed execution wiring.

```ts
export type ReconciliationSummary = Readonly<{
  stalePendingRecovered: number;
  staleProcessingRecovered: number;
  cleanupCandidatesMarked: number;
  cleanupClaims: number;
  cleanupCompleted: number;
  cleanupFailed: number;
  stagingCleaned: number;
}>;

export interface ProductMediaAttachmentService {
  refreshCompatibilityMirrorsForMedia(
    tx: MediaDbTransaction,
    mediaId: string,
    compatibilityUrl: string
  ): Promise<void>;
}

export interface MediaProcessingRunner {
  runMedia(mediaId: string, budgetMs: number): Promise<Readonly<{ completed: boolean; state: ManagedMediaLifecycleState }>>;
  runBatch(limit: number): Promise<Readonly<{ claimed: number; completed: number; failed: number }>>;
  requestProfileRegeneration(
    mediaId: string,
    profileVersion: string,
    actorScope: string
  ): Promise<Readonly<{ processingRunId: string }>>;
  activateProcessingRun(mediaId: string, processingRunId: string): Promise<void>;
}

export interface MediaReconciliationService {
  runBatch(limit: number): Promise<ReconciliationSummary>;
}

export interface MediaLifecycleService {
  suspendDelivery(mediaId: string, actorScope: string, reasonCode: string): Promise<void>;
  recoverDelivery(mediaId: string, actorScope: string, candidateProcessingRunId?: string): Promise<void>;
  claimCleanupBatch(limit: number): Promise<readonly string[]>;
  cleanupClaimedMedia(mediaId: string): Promise<void>;
  cleanupInactiveProfile(mediaId: string, processingRunId: string): Promise<void>;
  replaceCanonicalMaster(mediaId: string, replacement: ProcessedMediaObject): Promise<void>;
}
```

- [ ] **Step 1: Create compileable lifecycle/runner shells with no destructive behavior**

Create all four service modules and two scripts so imports succeed. Shell methods return zero-count/no-op results; no storage deletion, profile activation, or lifecycle transition is performed yet.


```ts
export const mediaProcessingRunner: MediaProcessingRunner = {
  async runMedia(_mediaId, _budgetMs) { return { completed: false, state: "PENDING" }; },
  async runBatch() { return { claimed: 0, completed: 0, failed: 0 }; },
  async requestProfileRegeneration() { return { processingRunId: "shell" }; },
  async activateProcessingRun() {},
};

export const mediaReconciliationService: MediaReconciliationService = {
  async runBatch() { return { stalePendingRecovered: 0, staleProcessingRecovered: 0, cleanupCandidatesMarked: 0, cleanupClaims: 0, cleanupCompleted: 0, cleanupFailed: 0, stagingCleaned: 0 }; },
};
```
- [ ] **Step 2: Write RED tests for processing-run claim exclusivity and stale leases**

In `tests/media-lifecycle-reconciliation.test.ts`, create two concurrent claimers for one PENDING run and assert exactly one claim succeeds. Add a PROCESSING run with expired lease and assert it becomes recoverable; an unexpired lease must not be stolen.


```ts
const [a, b] = await Promise.all([claimNextRun(1), claimNextRun(1)]);
assert.equal([a, b].filter(Boolean).length, 1);
assert.equal(await claimSpecificRun(activeLeaseRun.id), null);
assert.equal((await claimSpecificRun(expiredLeaseRun.id))?.id, expiredLeaseRun.id);
```
- [ ] **Step 3: Write RED tests for initial-ingest finalization and staging retention**

Assert first ingest consumes deterministic PRIVATE staging, creates one canonical MASTER plus required PUBLIC_DELIVERY renditions, persists MediaObjects, sets `canonicalMasterObjectId`, marks the initial run COMPLETE, activates it, moves the asset to READY then CLEANUP_PENDING when zero-owned, and does not delete staging until READY finalization commits.


```ts
await runner.runBatch(1);
const media = await readMedia(mediaId);
assert.equal(media.canonicalMasterObjectId !== null, true);
assert.equal(media.activeProcessingRun?.state, "COMPLETE");
assert.ok(["READY", "CLEANUP_PENDING"].includes(media.lifecycleState));
assert.equal(await stagingExists(mediaId), true, "staging deletion happens only after READY finalization commit");
```
- [ ] **Step 4: Write RED tests for storage-success/DB-finalization-failure recovery**

Inject DB failure after immutable object writes. Assert the media remains non-READY, deterministic object identities/staging survive, and rerun verifies/reuses existing correct outputs instead of creating duplicate logical MediaObjects.


```ts
injectDbFinalizationFailureOnce();
await runner.runBatch(1);
assert.notEqual((await readMedia(mediaId)).lifecycleState, "READY");
clearInjectedFailure();
await runner.runBatch(1);
assert.equal(await logicalObjectDuplicateCount(mediaId), 0);
```
- [ ] **Step 5: Write RED tests for partial-output recovery and integrity mismatch**

Fixture: MASTER + some renditions exist, a later rendition failed. Assert retry reuses verified outputs and generates only missing outputs. If an expected immutable key contains unexpected SHA-256 bytes, assert `INTEGRITY_MISMATCH` and no overwrite.


```ts
seedPartialOutputs({ master: true, webp320: true, webp640: false });
await runner.runBatch(1);
assert.equal(await wasObjectRewritten("master"), false);
assert.equal(await objectExists("webp640"), true);
seedIntegrityMismatch("webp960");
await assert.rejects(runner.runBatch(1), /INTEGRITY_MISMATCH/);
```
- [ ] **Step 6: Write RED tests for future profile regeneration while current media stays READY**

Fixture: v1 COMPLETE/ACTIVE and media READY. Request v2. Assert one v2 ProcessingRun exists for `(mediaId, profileVersion)`, v1 remains active while v2 PROCESSING, generation reads retained private canonical master, ordinary v2 creates only renditions, and v2 failure leaves v1 active/media READY.


```ts
const v2 = await runner.requestProfileRegeneration(mediaId, "product-image-v2", actorId);
assert.equal((await readMedia(mediaId)).activeProcessingRunId, v1RunId);
await failProcessingRun(v2.processingRunId);
assert.equal((await readMedia(mediaId)).lifecycleState, "READY");
assert.equal((await readMedia(mediaId)).activeProcessingRunId, v1RunId);
```
- [ ] **Step 7: Write RED tests for explicit profile activation**

Assert activation rejects wrong-media run, non-COMPLETE run, bad profile hash, incomplete/deleted required rendition inventory, DELETING/DELETED media, and `deliveryDisabledAt != null`. Successful activation switches `activeProcessingRunId` atomically and performs no provider I/O inside the DB transaction.


```ts
await assert.rejects(runner.activateProcessingRun(mediaA, runFromMediaB), /RUN_MEDIA_MISMATCH/);
await assert.rejects(runner.activateProcessingRun(mediaA, incompleteRun), /RUN_NOT_COMPLETE|RENDITION_SET_INCOMPLETE/);
await suspendMedia(mediaA);
await assert.rejects(runner.activateProcessingRun(mediaA, completeRun), /MEDIA_DELIVERY_DISABLED/);
```
- [ ] **Step 8: Write RED tests for compatibility-mirror refresh after activation**

Assert successful activation derives a compatibility rendition through the pure delivery resolver, updates every managed `ProductImage.url` referencing that media, and updates `Product.image` only where that media is the first ordered ProductImage.


```ts
await runner.activateProcessingRun(mediaId, v2RunId);
assert.equal((await readProductImage(productImageId)).url, expectedV2CompatibilityUrl);
assert.equal((await readProduct(productId)).image, expectedV2CompatibilityUrl);
```
- [ ] **Step 9: Write RED canonical-master protection tests for inactive-profile cleanup**

Fixture: v1 initial run owns `MASTER + PUBLIC_DELIVERY` renditions; `canonicalMasterObjectId` points to that v1 MASTER; v2 rendition-only run becomes COMPLETE/ACTIVE. Run v1 inactive-profile cleanup and assert obsolete v1 PUBLIC_DELIVERY renditions may be removed/tombstoned but the canonical master is never selected/deleted and `canonicalMasterObjectId` remains valid.


```ts
await lifecycle.cleanupInactiveProfile(mediaId, v1RunId);
assert.equal(await objectExists(canonicalMasterObjectKey), true);
assert.equal((await readMedia(mediaId)).canonicalMasterObjectId, canonicalMasterObjectId);
assert.equal(await obsoleteV1PublicRenditionCount(), 0);
```
- [ ] **Step 10: Write RED tests for full ManagedMedia cleanup claim races**

Assert `CLEANUP_PENDING` is attachable only while unsuspended and before delete claim. Final cleanup claim transaction rechecks all explicit ProductImage owners and blocks when any owner exists or a live PROCESSING run needs the asset. Two cleanup workers may discover the same row but exactly one commits `CLEANUP_PENDING→DELETING`; after that attachment rejects.


```ts
const [a, b] = await Promise.all([lifecycle.claimCleanupBatch(1), lifecycle.claimCleanupBatch(1)]);
assert.equal([...a, ...b].filter((id) => id === mediaId).length, 1);
assert.equal((await readMedia(mediaId)).lifecycleState, "DELETING");
await assert.rejects(attachMedia(mediaId), /MEDIA_NOT_ATTACHABLE/);
```
- [ ] **Step 11: Write RED tests for idempotent physical cleanup and partial failure recovery**

After DELETING, delete all owned MediaObjects across processing runs, including canonical master, only as part of full ManagedMedia cleanup. Missing object is success. Inject one failed delete after earlier objects are removed; assert `FAILED` + `failurePhase=CLEANUP`, retry returns to DELETING, re-deletes idempotently, and only reaches DELETED after every owned object reaches absent/tombstoned state.


```ts
injectDeleteFailureFor(objectKeyB);
await lifecycle.cleanupClaimedMedia(mediaId);
assert.equal((await readMedia(mediaId)).failurePhase, "CLEANUP");
clearInjectedDeleteFailure();
await lifecycle.cleanupClaimedMedia(mediaId);
assert.equal((await readMedia(mediaId)).lifecycleState, "DELETED");
```
- [ ] **Step 12: Write RED tests for separately guarded canonical-master replacement**

Assert replacement writes/verifies a new PRIVATE_SOURCE master under new immutable identity, atomically switches `canonicalMasterObjectId`, retains the old master through rollback-safety policy, and later cleans the old master through the replacement workflow only. Inactive-profile cleanup must never perform canonical-master replacement/deletion.


```ts
await lifecycle.replaceCanonicalMaster(mediaId, replacementMaster);
assert.notEqual((await readMedia(mediaId)).canonicalMasterObjectId, oldMasterId);
assert.equal(await objectExists(oldMasterKey), true, "rollback-safety retention");
await lifecycle.cleanupInactiveProfile(mediaId, oldRunId);
assert.equal(await objectExists(oldMasterKey), true, "profile cleanup cannot remove old/current canonical master workflow objects");
```
- [ ] **Step 13: Write RED tests for suspension and privileged recovery invariants**

Assert `suspendDelivery()` sets `deliveryDisabledAt` without rewriting READY/CLEANUP_PENDING lifecycle. While suspended, new attachment, normal `activateProcessingRun()`, and ordinary public delivery are blocked; canonical master remains intact.

Prove both recovery cases without weakening that invariant:

- **Case A — existing active delivery set remains complete/safe:** privileged `recoverDelivery(mediaId, actorId)` validates current active-run ownership, profile hash, nondeleted required PUBLIC_DELIVERY inventory, and media state, then clears `deliveryDisabledAt` atomically.
- **Case B — takedown deleted/tombstoned public renditions:** while still suspended, `requestProfileRegeneration()` may create/process a new immutable delivery run to COMPLETE, but that run remains INACTIVE. Normal activation still rejects. Then privileged `recoverDelivery(mediaId, actorId, candidateRunId)` validates same-media ownership, COMPLETE state, profile hash, complete/nondeleted required public inventory, and non-DELETING/non-DELETED media; in one DB transaction it sets `activeProcessingRunId=candidateRunId`, refreshes all managed `ProductImage.url` mirrors and affected first-image `Product.image` mirrors, and clears `deliveryDisabledAt`.

```ts
await lifecycle.suspendDelivery(mediaId, actorId, "LEGAL_REVIEW");
assert.ok((await readMedia(mediaId)).deliveryDisabledAt);
await assert.rejects(attachMedia(mediaId), /MEDIA_DELIVERY_DISABLED/);
await assert.rejects(runner.activateProcessingRun(mediaId, completeRunId), /MEDIA_DELIVERY_DISABLED/);

await lifecycle.recoverDelivery(mediaWithSafeActiveRunId, actorId);
assert.equal((await readMedia(mediaWithSafeActiveRunId)).deliveryDisabledAt, null);

const candidate = await runner.requestProfileRegeneration(mediaId, "product-image-v2-recovery", actorId);
await completeProcessingRunWithoutActivation(candidate.processingRunId);
await assert.rejects(runner.activateProcessingRun(mediaId, candidate.processingRunId), /MEDIA_DELIVERY_DISABLED/);
await lifecycle.recoverDelivery(mediaId, actorId, candidate.processingRunId);
const recovered = await readMedia(mediaId);
assert.equal(recovered.activeProcessingRunId, candidate.processingRunId);
assert.equal(recovered.deliveryDisabledAt, null);
assert.equal((await readProductImage(productImageId)).url, expectedRecoveryCompatibilityUrl);
assert.equal((await readProduct(productId)).image, expectedRecoveryCompatibilityUrl);
```
- [ ] **Step 14: Write RED tests for authoritative reconciliation drift repair**

Create: stale PENDING; stale PROCESSING; READY with zero ProductImage refs but no cleanup hint; CLEANUP_PENDING with a restored owner; FAILED(CLEANUP); ALLOCATED staging that physically exists; READY with leftover staging. Assert one bounded `runBatch()` converges each recoverable state or leaves an explicit actionable FAILED state.


```ts
const summary = await reconciliation.runBatch(100);
assert.equal(summary.stalePendingRecovered, 1);
assert.equal(summary.staleProcessingRecovered, 1);
assert.equal(summary.cleanupCandidatesMarked, 1);
assert.equal(summary.stagingCleaned, 1);
assert.equal((await readMedia(restoredOwnerMediaId)).lifecycleState, "READY");
```
- [ ] **Step 15: Run the complete lifecycle RED suite**

```powershell
node --test tests/media-lifecycle-reconciliation.test.ts
```

Expected RED: all modules/DB/storage harnesses load, then the intended state/race/recovery assertions fail. Missing DB fixture, module, syntax, scheduler config, or provider config is invalid RED.

- [ ] **Step 16: Implement transactional processing-run claim/lease acquisition**

Implement one-row claim using PostgreSQL row locking/compare-and-set according to the persistence layer. Pin `profileVersion` and `profileDefinitionHash` before work; set lease timestamps/attempt metadata atomically. `runBatch(limit)` must claim at most `limit` rows and never rely on “only one scheduler exists.”


```ts
export async function claimProcessingRuns(tx: MediaDbTransaction, limit: number, now: Date): Promise<readonly ClaimedProcessingRun[]> {
  return tx.$queryRaw<ClaimedProcessingRun[]>`
    SELECT * FROM "MediaProcessingRun"
    WHERE ("state" = 'PENDING' OR ("state" = 'PROCESSING' AND "leaseExpiresAt" < ${now}))
    ORDER BY "createdAt"
    FOR UPDATE SKIP LOCKED
    LIMIT ${limit}
  `;
}
```
- [ ] **Step 17: Implement first-ingest processing/finalization using Task-15 durable rows**

For each claimed initial run: load deterministic staging, call `processInitialProductImage()`, immutable-put canonical master + required profile renditions, verify storage metadata, then in one DB transaction persist complete MediaObject inventory, set `canonicalMasterObjectId`, set run COMPLETE, set `activeProcessingRunId`, clear processing failure summary, set asset READY, and if owner count is zero set CLEANUP_PENDING/timestamps. Delete staging only after this transaction commits.


```ts
const processed = await imageProcessor.processInitialProductImage(stagedSource, profile);
const masterStored = await privateStorage.putImmutable(toPut(processed.canonicalMaster));
const renditionStored = await Promise.all(processed.renditions.map((r) => publicStorage.putImmutable(toPut(r))));
await finalizeInitialRunTransaction({ mediaId, runId, masterStored, renditionStored, profile });
await deleteStagingAfterReadyCommit(mediaId);
```
- [ ] **Step 18: Implement partial-output/retry reconciliation without overwrite**

Build the expected logical output manifest from `(mediaId, profileVersion, variantKey)` and deterministic object keys. On retry, HEAD/verify already-written objects by application SHA-256/size/MIME, reuse correct objects, generate missing ones, and fail closed on mismatches. Do not create a second logical `(processingRunId, variantKey)` row.


```ts
for (const expected of expectedObjectManifest(run, profile)) {
  const existing = await storageFor(expected.accessClass).headObject(expected.objectKey);
  if (existing && matchesExpected(existing, expected)) continue;
  if (existing) throw new MediaStorageError("INTEGRITY_MISMATCH", "existing immutable object differs");
  await storageFor(expected.accessClass).putImmutable(await buildMissingObject(expected));
}
```
- [ ] **Step 19: Implement future rendition-only profile regeneration**

`requestProfileRegeneration()` creates/recovers one run for a new immutable profile. Runner reads the retained `canonicalMasterObjectId` through PRIVATE storage, builds `CanonicalMasterInput`, calls `generateDeliveryRenditions(master, profile)`, and creates no ordinary second master. ManagedMedia stays READY with the old active run until explicit activation. A delivery-suspended asset may generate a new immutable candidate run while suspended, provided it is not DELETING/DELETED; that candidate may become COMPLETE but must remain INACTIVE until either suspension is cleared or the privileged atomic recovery transaction in Step 24 selects it.


```ts
const master = await loadCanonicalMasterInput(media.canonicalMasterObjectId!);
const renditions = await imageProcessor.generateDeliveryRenditions(master, targetProfile);
await persistRenditionOnlyRun(runId, renditions);
// ManagedMedia.activeProcessingRunId is intentionally unchanged here.
```
- [ ] **Step 20: Implement explicit profile activation transaction and mirror refresh**

Within one DB transaction verify same-media ownership, run COMPLETE, exact profile hash, complete/nondeleted required PUBLIC_DELIVERY inventory, lifecycle attachability for delivery, and `deliveryDisabledAt IS NULL`; update `activeProcessingRunId`. Resolve the new compatibility URL without provider I/O and call `refreshCompatibilityMirrorsForMedia(tx, mediaId, compatibilityUrl)` before commit.


```ts
await prisma.$transaction(async (tx) => {
  const run = await loadCompleteOwnedRunForUpdate(tx, mediaId, processingRunId);
  await assertActivationInventoryComplete(tx, run);
  const media = await loadMediaForUpdate(tx, mediaId);
  if (media.deliveryDisabledAt) throw new Error("MEDIA_DELIVERY_DISABLED");
  const compatibilityUrl = resolveCompatibilityUrl(run);
  await tx.managedMedia.update({ where: { id: mediaId }, data: { activeProcessingRunId: processingRunId } });
  await attachment.refreshCompatibilityMirrorsForMedia(tx, mediaId, compatibilityUrl);
});
```
- [ ] **Step 21: Implement inactive delivery-profile cleanup with canonical-master exclusion**

Select only obsolete `PUBLIC_DELIVERY` MediaObjects belonging to the inactive run and outside the rollback/cache-safety window. Add an explicit predicate excluding `object.id === managedMedia.canonicalMasterObjectId` even if schema/data drift placed that master under the inactive run. Delete/tombstone selected renditions idempotently; never select PRIVATE_SOURCE canonical master.


```ts
const candidates = await listInactivePublicRenditions(processingRunId);
for (const object of candidates) {
  if (object.id === media.canonicalMasterObjectId) continue;
  if (object.accessClass !== "PUBLIC_DELIVERY") continue;
  await deleteAndTombstoneObject(object);
}
```
- [ ] **Step 22: Implement full ManagedMedia cleanup claim and physical cleanup**

Claim transaction: lock media, require CLEANUP_PENDING + eligible time, recheck all registered explicit owner relations, reject if a live processing run needs the asset, otherwise commit DELETING. Outside transaction enumerate all owned MediaObjects across runs (including canonical master) and delete idempotently. Finalize DELETED only after all physical objects are absent/tombstoned; partial failure records `failurePhase=CLEANUP` for retry.


```ts
const claimed = await claimDeletingAfterFinalOwnerCheck(mediaId);
if (!claimed) return;
for (const object of await listAllOwnedObjects(mediaId)) await deleteAndTombstoneObjectIdempotently(object);
await finalizeDeletedWhenAllObjectsAbsent(mediaId);
```
- [ ] **Step 23: Implement separately guarded canonical-master replacement**

Write/verify replacement PRIVATE_SOURCE object first; persist its MediaObject; atomically switch `canonicalMasterObjectId`; retain prior master until explicit rollback-safety expiry; delete prior master only through this replacement workflow after proving it is no longer canonical. Do not couple this operation to ordinary profile activation/cleanup.


```ts
const replacement = await privateStorage.putImmutable(toPut(replacementMaster));
const replacementObject = await persistReplacementMaster(mediaId, replacement);
await prisma.managedMedia.update({ where: { id: mediaId }, data: { canonicalMasterObjectId: replacementObject.id } });
await markOldMasterRollbackRetained(oldMasterId);
```
- [ ] **Step 24: Implement durable suspension/recovery service semantics**

`suspendDelivery()` records `deliveryDisabledAt` and safe reason/audit input while leaving lifecycle unchanged. Keep normal `activateProcessingRun()` unchanged: it always rejects `deliveryDisabledAt != null`. `recoverDelivery()` is the only privileged atomic exception.

Case A validates the existing active run and clears suspension only if its required PUBLIC_DELIVERY inventory is complete/nondeleted. Case B accepts a previously generated COMPLETE-but-INACTIVE candidate run and, without provider I/O inside the transaction, atomically activates that run, refreshes `ProductImage.url`/affected `Product.image` compatibility mirrors, and clears suspension.

```ts
async function recoverDelivery(
  mediaId: string,
  actorScope: string,
  candidateProcessingRunId?: string
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const media = await lockManagedMediaForRecovery(tx, mediaId);
    assertRecoverableLifecycle(media); // rejects DELETING/DELETED
    const run = candidateProcessingRunId
      ? await requireCompleteRecoveryCandidate(tx, mediaId, candidateProcessingRunId)
      : await requireSafeActiveRun(tx, media);
    await assertCompleteNondeletedPublicInventory(tx, run);
    const compatibilityUrl = deriveCompatibilityUrlFromRun(run);
    if (candidateProcessingRunId) {
      await setActiveProcessingRun(tx, mediaId, run.id);
      await productMediaAttachmentService.refreshCompatibilityMirrorsForMedia(tx, mediaId, compatibilityUrl);
    }
    await clearDeliverySuspension(tx, mediaId, actorScope);
  });
}
```

Never expose a private master during suspension/recovery, and never clear suspension in UI/route code.
- [ ] **Step 25: Implement bounded reconciliation and brokerless scheduler/CLI wiring**

`MediaReconciliationService.runBatch(limit)` repairs the exact drift cases from Step 14 in bounded, concurrency-safe batches. `scripts/process-managed-media.ts` invokes `MediaProcessingRunner.runBatch(limit)`; `scripts/reconcile-managed-media.ts` invokes `MediaReconciliationService.runBatch(limit)`. No permanent `setInterval` in Next.js.

If Task-2 evidence selected `DB_BACKED`, the scripts/platform scheduler consume the durable rows created by Tasks 15–16 and the upload route remains unchanged; the Admin discovers transitions through Task-16 authenticated status GET. If Task-2 evidence selected bounded `SYNC`, this task now has the runner available and may modify `app/api/media/uploads/route.ts` to call `mediaProcessingRunner.runMedia(ingest.mediaId, processingBudgetMs)` after durable ingest creation. Whether processing completes or exhausts the measured budget, POST must re-read `MediaUploadStatusService` and return the same Task-16 safe status contract, including `previewUrl` only when READY/attachable.

```ts
// scripts/process-managed-media.ts
const limit = parsePositiveInt(process.argv[2] ?? "10");
console.log(JSON.stringify(await mediaProcessingRunner.runBatch(limit)));

// scripts/reconcile-managed-media.ts
const reconcileLimit = parsePositiveInt(process.argv[2] ?? "100");
console.log(JSON.stringify(await mediaReconciliationService.runBatch(reconcileLimit)));

// conditional SYNC wiring in app/api/media/uploads/route.ts
const ingest = await mediaIngestService.startProductImageIngest(input);
if (executionMode === "SYNC") {
  await mediaProcessingRunner.runMedia(ingest.mediaId, processingBudgetMs);
}
return Response.json(await mediaUploadStatusService.getProductImageUploadStatus(ingest.mediaId));
```
- [ ] **Step 26: Run GREEN, race/failure regression, and commit lifecycle package**

```powershell
node --test tests/media-lifecycle-reconciliation.test.ts tests/media-ingest-service.test.ts tests/media-renditions.test.ts
npx tsc --noEmit
git diff --check
git add -- lib/media/mediaProcessingRunner.ts lib/media/productMediaAttachmentService.ts lib/media/mediaLifecycleService.ts lib/media/mediaReconciliationService.ts scripts/process-managed-media.ts scripts/reconcile-managed-media.ts tests/media-lifecycle-reconciliation.test.ts
$routeDiff = git diff -- app/api/media/uploads/route.ts
if ($routeDiff) { git add -- app/api/media/uploads/route.ts }
git commit -m "feat: orchestrate managed media lifecycle"
```

---

### Task 18: Existing `PUT /api/products` Managed Attachment + Structured Legacy ProductImage-ID + Mirrors

**Files:**
- Modify: `app/api/products/route.ts`
- Modify: `lib/catalog/galleryWrite.ts`
- Modify: `lib/catalog/adminGalleryState.ts`
- Modify: `lib/catalog/types.ts`
- Modify: `lib/media/productMediaAttachmentService.ts`
- Create: `tests/product-managed-media-write.test.ts`
- Modify: `tests/product-gallery-write.test.ts`
- Modify: `tests/admin-product-gallery-read.test.ts`
- Modify: `tests/admin-gallery-edit-ui.test.ts`

**Interfaces:**
- Consumes: Task 17 `ProductMediaAttachmentService`, Task 12 pure delivery resolver/DTO, Task 4–7 persistence.
- Produces: structured gallery write contract: managed item by `managedMediaId`; retained legacy item by existing `ProductImage.id`; same `PUT /api/products` remains authority; compatibility mirrors are server-derived; detach/delete only schedules lifecycle hints.

- [ ] **Step 1: Add the compileable structured gallery write union**

```ts
export type ProductGalleryWriteItem =
  | Readonly<{ kind: "managed"; managedMediaId: string; altText?: string }>
  | Readonly<{ kind: "legacy-existing"; productImageId: number; altText?: string }>;
```

Keep any old URL parser isolated behind explicit backward-compatibility handling; the new Admin contract never uses arbitrary URL as identity.

- [ ] **Step 2: Write RED tests for managed state/suspension validation inside the product transaction**

Assert READY and unsuspended CLEANUP_PENDING attach; PENDING/PROCESSING/FAILED/DELETING/DELETED reject; `deliveryDisabledAt != null` rejects; active profile/inventory must be complete at the same transactional decision point.


```ts
await assert.doesNotReject(() => saveGallery([managed(readyMediaId)]));
await assert.doesNotReject(() => saveGallery([managed(cleanupPendingUnsuspendedId)]));
for (const id of [pendingId, processingId, failedId, deletingId, deletedId, suspendedId]) {
  await assert.rejects(saveGallery([managed(id)]), /MEDIA_NOT_ATTACHABLE|MEDIA_DELIVERY_DISABLED/);
}
```
- [ ] **Step 3: Write RED tests for relational legacy identity**

Assert `legacy-existing.productImageId` must exist, belong to the target Product, and have LEGACY_LOCAL/LEGACY_EXTERNAL source kind. IDs from another product or MANAGED row reject. Structured DTO cannot manufacture a new `https://...` or `/uploads/...` relationship.


```ts
await assert.doesNotReject(saveGallery([legacyExisting(targetProductLegacyImageId)]));
await assert.rejects(saveGallery([legacyExisting(otherProductImageId)]), /PRODUCT_IMAGE_OWNERSHIP_MISMATCH/);
await assert.rejects(saveGalleryPayload({ kind: "legacy", url: "https://new.example/x.jpg" }), /INVALID_GALLERY_ITEM/);
```
- [ ] **Step 4: Write RED tests for compatibility mirrors and client URL rejection**

Assert MANAGED `ProductImage.url` is derived from the active compatibility rendition and cannot be supplied independently by client input. After ordered gallery write, `Product.image` equals the first ProductImage compatibility URL. Direct legacy `image:` cannot override an existing managed gallery.


```ts
await saveGallery([managed(mediaId, { clientUrl: "https://attacker.invalid/x.jpg" })]);
const row = await readFirstProductImage(productId);
assert.equal(row.url, expectedServerDerivedCompatibilityUrl);
assert.equal((await readProduct(productId)).image, expectedServerDerivedCompatibilityUrl);
```
- [ ] **Step 5: Write RED tests for detach/replacement/product deletion lifecycle hints**

Assert removing/replacing a managed ProductImage performs no MediaStorage delete inside the product transaction; zero-reference managed media receives CLEANUP_PENDING/timing hint after authoritative relational recheck. Product deletion collects managed IDs before ProductImage cascade, then owner-checks/marks zero-reference media without physical object deletion. Removing legacy rows causes zero MediaStorage deletes.


```ts
await replaceManagedWithLegacy(productId, managedImageId, legacyImageId);
assert.equal(storageDeleteCallCount(), 0);
assert.equal((await readMedia(managedMediaId)).lifecycleState, "CLEANUP_PENDING");
await removeLegacyImage(productId, legacyImageId);
assert.equal(storageDeleteCallCount(), 0);
```
- [ ] **Step 6: Run RED**

```powershell
node --test tests/product-managed-media-write.test.ts tests/product-gallery-write.test.ts tests/admin-product-gallery-read.test.ts
```

Expected RED: DB/API harness loads; assertions fail on current URL-centric behavior/state enforcement. Missing DB fixture/module/configuration is invalid RED.

- [ ] **Step 7: Implement server parsing of the structured union and reject new URL authority**

Parse only `managedMediaId` or existing `productImageId` for the new payload. Preserve old compatibility parser only for explicitly supported pre-cutover clients. The new Admin path must not accept a URL field for managed or newly-created legacy media.


```ts
export function parseProductGalleryWriteItem(value: unknown): ProductGalleryWriteItem {
  if (isManagedItem(value)) return { kind: "managed", managedMediaId: value.managedMediaId, altText: value.altText };
  if (isLegacyExistingItem(value)) return { kind: "legacy-existing", productImageId: value.productImageId, altText: value.altText };
  throw new Error("PRODUCT_GALLERY_ITEM_INVALID");
}
```
- [ ] **Step 8: Implement transaction-local managed-media attachability query/lock**

Inside the existing product transaction, load/lock every desired ManagedMedia and active run/object inventory. Require lifecycle `READY` or `CLEANUP_PENDING`, `deliveryDisabledAt IS NULL`, complete active profile, and not DELETING/DELETED/FAILED. For CLEANUP_PENDING attachment, transition to READY and clear cleanup timestamps in the same transaction.


```ts
const media = await loadManagedMediaForUpdate(tx, item.managedMediaId);
if (!canAttachManagedMedia(media.lifecycleState, media.deliveryDisabledAt)) throw new Error("MEDIA_NOT_ATTACHABLE");
await assertActiveDeliveryInventoryComplete(tx, media);
if (media.lifecycleState === "CLEANUP_PENDING") {
  await tx.managedMedia.update({ where: { id: media.id }, data: { lifecycleState: "READY", unreferencedAt: null, cleanupEligibleAt: null } });
}
```
- [ ] **Step 9: Implement relational legacy retention/reorder**

Load each `legacy-existing` row by ID and target `productId`; require legacy source kind. Reuse its stored URL/source kind; never trust a client-resubmitted URL. Preserve 1–4 cap, deterministic order, and duplicate-gallery rules.


```ts
const row = await tx.productImage.findFirst({ where: { id: item.productImageId, productId } });
if (!row || !["LEGACY_LOCAL", "LEGACY_EXTERNAL"].includes(row.sourceKind!)) throw new Error("LEGACY_PRODUCT_IMAGE_INVALID");
return { sourceKind: row.sourceKind!, managedMediaId: null, url: row.url, altText: item.altText ?? row.altText };
```
- [ ] **Step 10: Implement server-derived managed `ProductImage.url` and first-image `Product.image` mirror**

For each MANAGED item resolve the designated compatibility rendition through the active run metadata + pure `MediaDeliveryResolver`. Create/update ProductImage using `managedMediaId` as authority. After ordering, set `Product.image` to the first ProductImage URL in the same transaction.


```ts
const compatibilityUrl = resolveCompatibilityUrlFromActiveRun(media);
const orderedRows = await replaceOrderedProductImages(tx, productId, normalizedItems);
await tx.product.update({ where: { id: productId }, data: { image: orderedRows[0].url } });
```
- [ ] **Step 11: Implement detachment/replacement lifecycle hints without storage deletion**

Capture previously referenced managed IDs, compute desired IDs, then after ProductImage mutation recheck explicit relational owners for removed IDs. Zero-reference media becomes CLEANUP_PENDING with configurable grace timestamps. Do not call `MediaStorage.deleteObject()` from this path.


```ts
const removedManagedIds = difference(previousManagedIds, desiredManagedIds);
for (const mediaId of removedManagedIds) {
  if (await countProductImageOwners(tx, mediaId) === 0) {
    await markCleanupPending(tx, mediaId, now, cleanupGraceMs);
  }
}
```
- [ ] **Step 12: Implement Product DELETE cascade safety**

Before deleting Product, collect its managed IDs in the transaction. Delete Product/ProductImages through existing cascade. Recheck each collected media against remaining ProductImage owners and mark zero-reference assets CLEANUP_PENDING. Legacy URLs/paths are never handed to lifecycle/storage deletion services.


```ts
await prisma.$transaction(async (tx) => {
  const managedIds = await listManagedIdsForProduct(tx, productId);
  await tx.product.delete({ where: { id: productId } });
  for (const mediaId of managedIds) if (await countProductImageOwners(tx, mediaId) === 0) await markCleanupPending(tx, mediaId, now, cleanupGraceMs);
});
```
- [ ] **Step 13: Implement narrow legacy `image:` compatibility rule**

For genuinely legacy-only products, retain the old behavior required by existing clients/tests. Once a managed gallery exists, reject/ignore direct `image:` according to one explicit API rule tested here; it must not overwrite managed authority or create a new external/local ProductImage.


```ts
if (hasManagedGallery(existingImages) && request.image !== undefined) {
  throw new Error("LEGACY_PRIMARY_IMAGE_MUTATION_NOT_ALLOWED_FOR_MANAGED_GALLERY");
}
```
- [ ] **Step 14: Expose safe Admin detail identity for the editor**

Admin detail read returns `productImageId`, `sourceKind`, `managedMediaId`, `altText`, and safe preview URL. Never expose canonical master, object keys, provider credentials, or bucket/account identifiers.

```ts
export type AdminProductGalleryItemDto = Readonly<{
  productImageId: number;
  sourceKind: "MANAGED" | "LEGACY_LOCAL" | "LEGACY_EXTERNAL";
  managedMediaId: string | null;
  altText: string;
  previewUrl: string;
}>;
```

- [ ] **Step 15: Run GREEN plus gallery/legacy regressions**

```powershell
node --test tests/product-managed-media-write.test.ts tests/product-gallery-write.test.ts tests/admin-product-gallery-read.test.ts tests/admin-gallery-edit-ui.test.ts
npx tsc --noEmit
```

- [ ] **Step 16: Commit product attachment integration**

```powershell
git diff --check
git add -- app/api/products/route.ts lib/catalog/galleryWrite.ts lib/catalog/adminGalleryState.ts lib/catalog/types.ts lib/media/productMediaAttachmentService.ts tests/product-managed-media-write.test.ts tests/product-gallery-write.test.ts tests/admin-product-gallery-read.test.ts tests/admin-gallery-edit-ui.test.ts
git commit -m "feat: attach managed media through product gallery"
```

---

### Task 19: Admin Editor Managed Upload/Status/Retry UX + Structured Legacy Identity

**Files:**
- Modify: `app/admin/products/[id]/edit/page.tsx`
- Modify: `lib/catalog/adminGalleryState.ts`
- Create: `tests/admin-managed-media-ui.test.ts`
- Modify: `tests/admin-gallery-edit-ui.test.ts`

**Interfaces:**
- Consumes: Task 16 POST `ManagedMediaUploadStatusResponse` + authenticated GET `/api/media/uploads/[id]`; Task 18 structured gallery contract/admin detail read.
- Produces: Admin client state that uses `managedMediaId` for new media and existing ProductImage ID for legacy rows; bounded status polling/backoff; temporary browser-local preview lifecycle; simple Uploading/Processing/Ready/Retry/Invalid states.

- [ ] **Step 1: Add compileable client-state/status types with required status populated**

```ts
export type AdminManagedUploadStatus = "Uploading" | "Processing" | "Ready" | "Retry" | "Invalid";

export type AdminGalleryManagedItem = Readonly<{
  kind: "managed";
  managedMediaId: string;
  previewUrl: string;
  temporaryObjectUrl?: string;
  status: AdminManagedUploadStatus;
  failureCode?: string;
  idempotencyKey: string;
  altText?: string;
}>;

export type AdminGalleryLegacyItem = Readonly<{
  kind: "legacy-existing";
  productImageId: number;
  previewUrl: string;
  sourceKind: "LEGACY_LOCAL" | "LEGACY_EXTERNAL";
  altText?: string;
}>;
```

Every managed-item construction example in this task must supply `status` and `idempotencyKey`; no partial object may bypass the type.

- [ ] **Step 2: Add compileable server-state mapping and bounded poller shells**

In `lib/catalog/adminGalleryState.ts` define one UI mapping authority. PENDING/PROCESSING → Processing; attachable READY/CLEANUP_PENDING → Ready; FAILED maps to Retry only for the approved safe retryable application failure-code set, otherwise Invalid; DELETING/DELETED or suspended/nonattachable terminal state → Invalid.

```ts
const RETRYABLE_UPLOAD_FAILURE_CODES = new Set([
  "MEDIA_STORAGE_UNAVAILABLE",
  "MEDIA_STORAGE_TIMEOUT",
  "MEDIA_RATE_LIMITED",
  "MEDIA_PROCESSING_INTERRUPTED",
]);

export function toAdminManagedUploadStatus(status: ManagedMediaUploadStatusResponse): AdminManagedUploadStatus {
  if (status.attachable && (status.state === "READY" || status.state === "CLEANUP_PENDING")) return "Ready";
  if (status.state === "PENDING" || status.state === "PROCESSING") return "Processing";
  if (status.state === "FAILED") return RETRYABLE_UPLOAD_FAILURE_CODES.has(status.failureCode ?? "") ? "Retry" : "Invalid";
  return "Invalid";
}
```

Define a poll helper that uses Task-2 runtime evidence to choose a maximum polling window and caps backoff at a small bounded interval. Abort on unmount/navigation. If the bounded window expires while still processing, keep the visible state `Processing` and expose an accessible `Refresh status` action that starts another bounded poll window; do not add WebSocket/SSE.

- [ ] **Step 3: Write RED state-machine tests for POST → PENDING → PROCESSING → READY**

Mock one file-selection action and an API sequence: POST returns PENDING/no server preview; GET returns PROCESSING; later GET returns READY/attachable with `previewUrl`. Assert the editor creates a browser-local Object URL immediately, inserts a managed item with `status: "Processing"`, keeps Product Save disabled while non-Ready, replaces the temporary preview with the safe server preview on READY, revokes the Object URL exactly once, and then enables Product Save.

```ts
const localPreview = "blob:phase6-local-preview";
mockCreateObjectURL(localPreview);
mockUploadPost({ mediaId: "m1", state: "PENDING", attachable: false });
mockStatusSequence([
  { mediaId: "m1", state: "PROCESSING", attachable: false },
  { mediaId: "m1", state: "READY", attachable: true, previewUrl: "https://media.example/rendition.webp" },
]);
await selectManagedFile(file);
assert.equal(currentManagedItem().status, "Ready");
assert.equal(currentManagedItem().previewUrl, "https://media.example/rendition.webp");
assert.deepEqual(revokedObjectUrls(), [localPreview]);
assert.equal(isProductSaveEnabled(), true);
```

- [ ] **Step 4: Write RED FAILED/Retry/Invalid/idempotency tests**

Assert retryable FAILED becomes Retry and reuses the original `idempotencyKey` + same file bytes when the Admin chooses Retry; nonretryable validation failure becomes Invalid/Choose another image; non-Ready managed items block save; status GET still refreshes existing media after the new-ingestion feature is disabled. Existing legacy items retain/reorder/remove by `productImageId`; new arbitrary URL entry remains absent.

```ts
assert.equal(toAdminManagedUploadStatus({ mediaId: "m1", state: "FAILED", attachable: false, failureCode: "MEDIA_STORAGE_UNAVAILABLE" }), "Retry");
assert.equal(toAdminManagedUploadStatus({ mediaId: "m2", state: "FAILED", attachable: false, failureCode: "UNSUPPORTED_FORMAT" }), "Invalid");
await clickRetry();
assert.equal(lastUploadRequest().idempotencyKey, originalIdempotencyKey);
```

- [ ] **Step 5: Write RED cleanup tests for temporary Object URLs**

Assert temporary Object URLs are revoked when replaced by server preview, when the item is removed before READY, and when the editor unmounts. Never revoke a normal HTTPS/public rendition URL.

```ts
unmountEditor();
assert.ok(revokedObjectUrls().includes(localPreview));
assert.equal(revokedObjectUrls().some((url) => url.startsWith("https://")), false);
```

- [ ] **Step 6: Run RED**

```powershell
node --test tests/admin-managed-media-ui.test.ts tests/admin-gallery-edit-ui.test.ts tests/media-upload-route.test.ts
```

Expected RED: page/module/status route harnesses load; intended state/polling/save/object-URL assertions fail because final client orchestration is absent. Missing route/module/fixture/browser API shim/syntax/configuration is invalid RED.

- [ ] **Step 7: Implement file-selection POST + temporary preview state**

On selection, create one idempotency key and `URL.createObjectURL(file)`, set Uploading, POST to `/api/media/uploads`, then construct the managed item with every required field. PENDING/PROCESSING maps to Processing; a READY POST with safe preview may transition directly to Ready.

```ts
const temporaryObjectUrl = URL.createObjectURL(file);
const idempotencyKey = crypto.randomUUID();
const upload = await postManagedMedia(file, idempotencyKey);
const status = toAdminManagedUploadStatus(upload);
setGallery((items) => [...items, {
  kind: "managed",
  managedMediaId: upload.mediaId,
  previewUrl: upload.previewUrl ?? temporaryObjectUrl,
  temporaryObjectUrl: upload.previewUrl ? undefined : temporaryObjectUrl,
  status,
  failureCode: upload.failureCode,
  idempotencyKey,
  altText: "",
}]);
if (upload.previewUrl) URL.revokeObjectURL(temporaryObjectUrl);
```

- [ ] **Step 8: Implement bounded authenticated status polling/backoff**

While the item maps to Processing, call authenticated `GET /api/media/uploads/{mediaId}` with bounded exponential/backoff delays capped by the selected Admin polling policy. Stop on Ready/Retry/Invalid, abort/unmount, or polling-window expiry. On expiry keep `Processing` and show `Refresh status`; that action restarts a bounded poll window rather than opening SSE/WebSocket infrastructure.

```ts
for (const delayMs of boundedStatusPollDelays(selectedProcessingBudgetMs)) {
  await abortableDelay(delayMs, signal);
  const next = await getManagedMediaStatus(mediaId, signal);
  if (toAdminManagedUploadStatus(next) !== "Processing") return next;
}
return null; // UI remains Processing and exposes Refresh status
```

- [ ] **Step 9: Implement READY preview replacement and Object-URL revocation**

When status returns Ready, require `previewUrl`; atomically update the item to safe server preview, clear `temporaryObjectUrl`, set Ready, then revoke the old blob URL. If status becomes Retry/Invalid, retain the local preview only while the selected File is intentionally retained for Retry; revoke it on discard/replacement/unmount.

```ts
function applyManagedUploadStatus(item: AdminGalleryManagedItem, next: ManagedMediaUploadStatusResponse): AdminGalleryManagedItem {
  const status = toAdminManagedUploadStatus(next);
  if (status === "Ready") {
    if (!next.previewUrl) throw new Error("READY_MEDIA_PREVIEW_REQUIRED");
    const temporaryObjectUrl = item.temporaryObjectUrl;
    if (temporaryObjectUrl) URL.revokeObjectURL(temporaryObjectUrl);
    return { ...item, status, previewUrl: next.previewUrl, temporaryObjectUrl: undefined, failureCode: undefined };
  }
  return { ...item, status, failureCode: next.failureCode };
}
```

- [ ] **Step 10: Implement Retry/Invalid and structured submit transformation**

Retry reuses the same idempotency key for the same selected bytes. Invalid requires choosing another file and creates a new user action/idempotency key. Product Save is enabled only when every managed item is Ready. Serialize managed items only by `managedMediaId`; serialize existing legacy items only by `productImageId`.

```ts
const payload = gallery.map((item) => item.kind === "managed"
  ? { kind: "managed", managedMediaId: item.managedMediaId, altText: item.altText }
  : { kind: "legacy-existing", productImageId: item.productImageId, altText: item.altText });
```

- [ ] **Step 11: Preserve accessibility and existing gallery controls**

Keep accessible Up/Down ordering, first-image primary semantics, 1–4 limit, altText with Product.name fallback, and current layout except status/retry/Refresh-status controls. Do not broaden into Phase-8 visual redesign.

```tsx
<button type="button" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => moveImage(index, -1)}>Up</button>
<button type="button" aria-label={`Move ${label} down`} disabled={index === gallery.length - 1} onClick={() => moveImage(index, 1)}>Down</button>
<input aria-label={`Alt text for ${label}`} value={item.altText ?? product.name} onChange={onAltTextChange} />
```

- [ ] **Step 12: Run GREEN + focused lint/typecheck**

```powershell
node --test tests/admin-managed-media-ui.test.ts tests/admin-gallery-edit-ui.test.ts tests/media-upload-route.test.ts
npx eslint 'app/admin/products/[id]/edit/page.tsx' lib/catalog/adminGalleryState.ts tests/admin-managed-media-ui.test.ts
npx tsc --noEmit
```

Expected: POST→PENDING→PROCESSING→READY flow, FAILED/Retry/Invalid, temporary-preview revocation, save gating, structured identity, and feature-disabled status refresh all pass.

- [ ] **Step 13: Commit Admin integration**

```powershell
git diff --check
git add -- 'app/admin/products/[id]/edit/page.tsx' lib/catalog/adminGalleryState.ts tests/admin-managed-media-ui.test.ts tests/admin-gallery-edit-ui.test.ts
git commit -m "feat: manage product media by durable upload status"
```

---

### Task 20: Batch Managed Rendition Metadata Into Public Catalog Reads + Zero Provider N+1 + Suspension-Safe Primary Projection

**Files:**
- Modify: `lib/catalog/publicCatalogQuery.ts`
- Modify: `lib/catalog/types.ts`
- Modify: `lib/getProducts.ts`
- Create: `tests/public-managed-media-query.test.ts`
- Modify: `tests/public-catalog-gallery-query.test.ts`

**Interfaces:**
- Consumes: Task 12 DTO builder; ProductImage/ManagedMedia persistence.
- Produces: bounded mixed-gallery DTO assembly, zero provider I/O during ordinary reads, and a public primary-image projection that can never leak suspended managed media through stale `Product.image` compatibility data.

- [ ] **Step 1: Add the compileable public gallery union and explicit public-primary projection**

```ts
export type PublicProductGalleryImage =
  | Readonly<{ kind: "managed"; media: PublicResponsiveImageDto; altText: string }>
  | Readonly<{ kind: "legacy"; src: string; altText: string }>;

export type PublicProductMediaProjection = Readonly<{
  gallery: readonly PublicProductGalleryImage[];
  primarySrc: string | null;
  primaryKind: "managed" | "legacy" | "fallback" | "unavailable";
}>;
```

`primarySrc` is a customer-delivery projection, not new DB authority.

- [ ] **Step 2: Write RED tests proving bounded DB assembly and zero provider calls**

Instrument a fake MediaStorage registry that throws on HEAD/GET/LIST. Query multiple products with multiple managed/legacy images. Assert deterministic gallery order and bounded ProductImage + managed metadata query shape with zero provider calls.


```ts
const provider = throwingProviderRegistry();
const products = await getPublicProducts({ prisma: countingPrisma, providerRegistry: provider });
assert.equal(provider.callCount, 0);
assert.ok(countingPrisma.productImageQueryCount <= 1);
assert.ok(countingPrisma.managedMetadataQueryCount <= 1);
assert.deepEqual(products[0].media.gallery.map(orderKey), expectedOrder);
```
- [ ] **Step 3: Write RED regression for stale `Product.image` suspension bypass**

Fixture:

```text
first ProductImage = MANAGED media A
A.deliveryDisabledAt != null
Product.image = A's persisted compatibility URL
```

Assert public catalog/product DTO does **not** expose that URL in `primarySrc`, gallery, fallbackSrc, or any normally deliverable source.

- [ ] **Step 4: Write RED mixed-gallery suspension fallback test**

Fixture: first ProductImage is suspended managed A; second ProductImage is safe unsuspended managed B or valid legacy image. Assert A is excluded from normal public delivery and `primarySrc` becomes the first safe delivery-enabled gallery item's public source. If no safe item exists, assert an explicit existing storefront fallback/unavailable state—not stale `Product.image`.


```ts
const dto = await readPublicProduct(productWithSuspendedFirstAndSafeSecond);
assert.notEqual(dto.media.primarySrc, suspendedCompatibilityUrl);
assert.equal(dto.media.primarySrc, safeSecondPublicUrl);
assert.equal(JSON.stringify(dto).includes(suspendedCompatibilityUrl), false);
```
- [ ] **Step 5: Run RED**

```powershell
node --test tests/public-managed-media-query.test.ts tests/public-catalog-gallery-query.test.ts
```

Expected RED: query modules/provider harness load; managed batching/suspension-primary assertions fail. Missing DB fixture/module/configuration is invalid RED.

- [ ] **Step 6: Implement one bounded ProductImage read and one bounded managed-metadata read**

Fetch ProductImage rows ordered by `productId, sortOrder, id`; collect unique non-null `managedMediaId`s; fetch needed ManagedMedia + active ProcessingRun + nondeleted PUBLIC_DELIVERY MediaObjects in one bounded relation/query shape. Do not call `MediaStorage`, S3, R2, HEAD, GET, or LIST.


```ts
const rows = await prisma.productImage.findMany({ where: { productId: { in: productIds } }, orderBy: [{ productId: "asc" }, { sortOrder: "asc" }, { id: "asc" }] });
const managedIds = [...new Set(rows.flatMap((row) => row.managedMediaId ? [row.managedMediaId] : []))];
const managed = await prisma.managedMedia.findMany({ where: { id: { in: managedIds } }, include: activeDeliveryInclude });
```
- [ ] **Step 7: Build safe gallery items through source-kind authority**

For LEGACY rows, normalize and retain their stored URL. For MANAGED rows, require delivery-enabled lifecycle + `deliveryDisabledAt IS NULL` + complete active run and build `PublicResponsiveImageDto` through the pure resolver. Suspended managed rows are excluded/represented unavailable according to the public DTO contract and never get a public source.

```ts
function projectGalleryRow(row: ProductImageRow, managedById: ReadonlyMap<string, DeliveryReadyManagedMediaInput>): PublicProductGalleryImage | null {
  if (row.sourceKind === "LEGACY_LOCAL" || row.sourceKind === "LEGACY_EXTERNAL") {
    return { kind: "legacy", src: normalizeProductImageReference(row.url), altText: row.altText ?? row.productName };
  }
  const media = row.managedMediaId ? managedById.get(row.managedMediaId) : undefined;
  if (!media || media.deliveryDisabledAt) return null;
  return { kind: "managed", media: buildPublicResponsiveImageDto(media, deliveryResolver), altText: row.altText ?? row.productName };
}
```

- [ ] **Step 8: Derive public primary from the safe projected gallery, never blindly from `Product.image`**

```ts
const firstSafe = projectedGallery.find(isCustomerDeliverable);
const primarySrc = firstSafe ? getPublicPrimarySrc(firstSafe) : storefrontFallbackOrNull;
```

`Product.image` remains stored compatibility data for legacy/internal compatibility, but public read mapping must not emit it blindly when the corresponding first ProductImage is MANAGED and suspended/unavailable. This does not mutate Product.image or lifecycle authority.

- [ ] **Step 9: Preserve legacy-only compatibility without creating a second authority**

When a product is genuinely legacy-only and its first ProductImage is safe, the projected primary naturally equals that first legacy ProductImage URL. Existing fallback behavior remains available when gallery data is empty/unavailable. Do not use `Product.image` to bypass source-kind/delivery checks.

```ts
const firstSafe = gallery.find((item): item is PublicProductGalleryImage => item !== null);
const primarySrc = firstSafe
  ? firstSafe.kind === "managed" ? firstSafe.media.fallbackSrc : firstSafe.src
  : getExistingStorefrontFallback(product);
return { gallery: gallery.filter(isPresent), primarySrc, primaryKind: classifyPrimary(firstSafe, primarySrc) };
```

- [ ] **Step 10: Run GREEN plus N+1/suspension regressions**

```powershell
node --test tests/public-managed-media-query.test.ts tests/public-catalog-gallery-query.test.ts tests/admin-product-gallery-read.test.ts
npx tsc --noEmit
```

Expected: provider-call sentinel remains untouched; stale suspended `Product.image` URL never appears as customer-deliverable output; mixed gallery selects first safe item.

- [ ] **Step 11: Commit public managed read path**

```powershell
git diff --check
git add -- lib/catalog/publicCatalogQuery.ts lib/catalog/types.ts lib/getProducts.ts tests/public-managed-media-query.test.ts tests/public-catalog-gallery-query.test.ts
git commit -m "feat: batch managed media catalog reads"
```

---

### Task 21: Responsive ProductCard + Preserve Structurally Lazy Carousel

**Files:**
- Create: `components/ui/ResponsiveProductImage.tsx`
- Modify: `components/ui/ProductCard.tsx`
- Modify: `components/ui/ProductCardCarousel.tsx`
- Create: `tests/product-card-responsive-media.test.ts`
- Modify: `tests/product-card-carousel.test.ts`
- Modify: `docs/superpowers/evidence/phase6-media-acceptance.md`

**Interfaces:**
- Consumes: Task 20 `PublicProductGalleryImage`; Task 12 responsive DTO.
- Produces: `<picture>`/`srcset`/`sizes` ProductCard rendering with WebP baseline, conditional AVIF, primary priority discipline, structurally lazy secondary slides.

- [ ] **Step 1: Measure current ProductCard rendered widths before choosing exact `sizes`**

Use the existing real-browser harness at 375×667, 768×1024, and 1280×800. Record actual card image CSS width and DPR in `docs/superpowers/evidence/phase6-media-acceptance.md`. Derive an exact `sizes` expression from measured layout; do not copy a guessed string from design candidates.

- [ ] **Step 2: Add a compileable responsive-image rendering helper/shell inside existing component structure**

The shell may initially render only WebP fallback from the managed DTO so tests can load; it must preserve SafeImage behavior for legacy images. Task 12 is the **single source-order authority**: this component renders `image.sources` exactly in DTO order and must not sort or reverse it.


```tsx
export type ResponsiveProductImageProps = Readonly<{
  image: PublicResponsiveImageDto;
  sizes: string;
  alt: string;
  loading?: "eager" | "lazy";
  fetchPriority?: "high" | "low" | "auto";
}>;

export function ResponsiveProductImage({ image, sizes, alt, loading = "lazy", fetchPriority = "auto" }: ResponsiveProductImageProps) {
  return (
    <picture>
      {image.sources.map((source) => (
        <source key={source.type} type={source.type} srcSet={source.srcSet} sizes={sizes} />
      ))}
      <img src={image.fallbackSrc} sizes={sizes} alt={alt} loading={loading} fetchPriority={fetchPriority} />
    </picture>
  );
}
```
- [ ] **Step 3: Write behavioral RED tests**

Assert managed primary produces WebP `srcset` with exact calibrated `sizes`; when DTO provides AVIF, `<source type="image/avif">` precedes WebP; WebP-only DTO emits no AVIF source; no master/private URL; secondary managed images are absent from initial DOM/network-triggering structure until interaction according to existing carousel behavior; no all-four priority/eager load; legacy URL uses existing SafeImage path.


```ts
assert.match(rendered, /<picture/);
assert.match(rendered, /image\/webp/);
assert.ok(rendered.indexOf('type="image/avif"') < rendered.indexOf('type="image/webp"'));
assert.equal(initialRequestedGalleryIndices(result).join(","), "0");
assert.equal(rendered.includes("canonical-master"), false);
```
- [ ] **Step 4: Run RED**

```powershell
node --test tests/product-card-responsive-media.test.ts tests/product-card-carousel.test.ts
```

Expected RED: component loads; responsive/source/lazy assertions fail because shell lacks final `<picture>` behavior. Module, fixture, syntax, browser-harness, or environment/configuration failure is invalid RED.

- [ ] **Step 5: Implement minimal browser-native responsive rendering**

Use `<picture>` and render Task-12 `image.sources` in its authoritative order (AVIF first when present, then WebP), with WebP fallback `<img srcSet sizes>`, or a framework-equivalent that preserves browser-native selection. Do not independently sort sources and do not manually branch on `devicePixelRatio` in React. Keep current/primary image eligible for load; secondary slides remain structurally lazy; optional next-slide prefetch stays bounded and only if existing evidence justifies it.


```tsx
<ResponsiveProductImage
  image={gallery[currentIndex].media}
  sizes={measuredCardSizes}
  alt={gallery[currentIndex].altText}
  loading={currentIndex === 0 ? "eager" : "lazy"}
  fetchPriority={currentIndex === 0 ? "high" : "auto"}
/>
```

Keep existing carousel index controls and structural lazy insertion for secondary slides; only the current/approved next slide may exist in the requestable DOM according to measured behavior.
- [ ] **Step 6: Run GREEN + existing card regressions**

```powershell
node --test tests/product-card-responsive-media.test.ts tests/product-card-carousel.test.ts tests/storefront-responsive-browser-qa.test.ts
npx tsc --noEmit
```

- [ ] **Step 7: Commit ProductCard responsive media**

```powershell
git diff --check
git add -- components/ui/ResponsiveProductImage.tsx components/ui/ProductCard.tsx components/ui/ProductCardCarousel.tsx tests/product-card-responsive-media.test.ts tests/product-card-carousel.test.ts docs/superpowers/evidence/phase6-media-acceptance.md
git commit -m "feat: deliver responsive product card media"
```

---

### Task 22: Responsive Product Detail + Shared Gallery Authority

**Files:**
- Modify: `components/product/ProductDetailsClient.tsx`
- Create: `tests/product-detail-responsive-media.test.ts`
- Modify: `tests/product-detail-shared-gallery.test.ts`
- Modify: `docs/superpowers/evidence/phase6-media-acceptance.md`

**Interfaces:**
- Consumes: Task 20 public gallery DTO; Task 21 `ResponsiveProductImage` shared rendering helper.
- Produces: responsive primary/detail sources, high-DPI appropriate candidates, same ProductImage gallery authority, bounded/lazy secondaries.

- [ ] **Step 1: Measure real product-detail rendered widths at mobile/tablet/desktop before fixing `sizes`**

Record actual image CSS width at 375×667, 768×1024, 1280×800 and DPR≥2 in acceptance evidence. Derive exact `sizes` from measured layout.

- [ ] **Step 2: Add compileable managed responsive shell while preserving legacy detail rendering**

Keep current gallery ordering/interaction. Import the Task-21 shared helper explicitly:

```tsx
import { ResponsiveProductImage } from "@/components/ui/ResponsiveProductImage";
```

Then render managed vs legacy media with the existing gallery state:

```tsx
const primary = product.media.gallery[activeIndex];
return primary.kind === "managed"
  ? <ResponsiveProductImage image={primary.media} sizes={measuredDetailSizes} alt={primary.altText} />
  : <SafeImage src={primary.src} alt={primary.altText} />;
```
- [ ] **Step 3: Write RED detail tests**

Assert `<picture>`/sources include detail-appropriate candidates only; no canonical master; high-DPI candidates available without upscaling; first/current image gets appropriate eager/high priority but not all gallery images; secondaries remain bounded/lazy; legacy and mixed galleries preserve ordering.


```ts
assert.equal(detailMarkup.includes("canonical-master"), false);
assert.match(detailMarkup, /sizes=/);
assert.equal(eagerGalleryImageCount(detailMarkup), 1);
assert.equal(legacyDetailStillUsesSafeImage, true);
```
- [ ] **Step 4: Run RED**

```powershell
node --test tests/product-detail-responsive-media.test.ts tests/product-detail-shared-gallery.test.ts
```

Expected RED: detail component loads and old gallery works, but managed responsive assertions fail. Module, fixture, syntax, browser-harness, or environment/configuration failure is invalid RED.

- [ ] **Step 5: Implement minimal responsive detail rendering**

Use browser-native `<picture>`/`srcset`/measured `sizes`; AVIF only when DTO supplies it; WebP mandatory baseline; no master fallback. Preserve shared ProductImage gallery authority and current interaction semantics.


```tsx
const loading = activeIndex === 0 ? "eager" : "lazy";
const fetchPriority = activeIndex === 0 ? "high" : "auto";
return <ResponsiveProductImage image={managed.media} sizes={measuredDetailSizes} alt={managed.altText} loading={loading} fetchPriority={fetchPriority} />;
```
- [ ] **Step 6: Run GREEN + focused regression**

```powershell
node --test tests/product-detail-responsive-media.test.ts tests/product-detail-shared-gallery.test.ts tests/public-managed-media-query.test.ts
npx tsc --noEmit
```

- [ ] **Step 7: Commit product-detail responsive media**

```powershell
git diff --check
git add -- components/product/ProductDetailsClient.tsx tests/product-detail-responsive-media.test.ts tests/product-detail-shared-gallery.test.ts docs/superpowers/evidence/phase6-media-acceptance.md
git commit -m "feat: deliver responsive product detail media"
```

---

### Task 23: Safe Operational Telemetry + Delivery Suspension/Recovery + Audit Hooks + Operations/DR Runbook

**Files:**
- Create: `lib/media/mediaTelemetry.ts`
- Create: `scripts/phase6-media-delivery-control.ts`
- Create: `tests/media-operations-telemetry.test.ts`
- Create: `docs/superpowers/evidence/phase6-media-operations-runbook.md`
- Consume without modifying where possible: existing privileged audit helper identified during repository inspection; if no reusable authorization/audit primitive exists for a dangerous operation, STOP and report that gap rather than inventing a parallel role model.

**Interfaces:**
- Consumes: Task 17 lifecycle/suspension services and existing verified Admin/Super Admin/privileged authorization/audit primitives.
- Produces: redacted structured operational telemetry, privileged suspend/recover commands, and practical reconciliation/DR/provider-migration/emergency-takedown procedures.

```ts
export type MediaOperationalEvent = Readonly<{
  event: string;
  mediaId?: string;
  processingRunId?: string;
  productId?: number;
  failureCode?: string;
  durationMs?: number;
  byteSize?: string;
  count?: number;
}>;

export interface MediaTelemetry {
  record(event: MediaOperationalEvent): void;
}
```

Byte sizes exposed to JSON telemetry are decimal strings, never raw JavaScript `bigint` values.

- [ ] **Step 1: Create compileable telemetry and command shells using only existing authorization entry points**

`mediaTelemetry.ts` exposes `record()` with no-op shell. `phase6-media-delivery-control.ts` parses commands `suspend`, `recover`, and approved exceptional operations but performs no mutation yet. It imports the current repository's privileged authorization/audit primitive discovered at execution time; if none safely applies, STOP this task.


```ts
export const mediaTelemetry: MediaTelemetry = { record(_event) {} };

export type DeliveryControlCommand =
  | { action: "suspend"; mediaId: string; reasonCode: string }
  | { action: "recover"; mediaId: string };
```
- [ ] **Step 2: Write RED telemetry-redaction tests**

Pass an event/error context containing provider endpoint, access key, signed URL, auth header, cookies, EXIF/GPS, private master URL, and raw provider body. Assert emitted telemetry/audit representation contains none of those values and retains only approved identifiers/codes/counts/durations/JSON-safe byte strings.


```ts
mediaTelemetry.record({ event: "PROCESSING_FAILED", mediaId, failureCode: "STORAGE_UNAVAILABLE", byteSize: "12345" });
const output = capturedTelemetryJson();
for (const forbidden of [secret, signedUrl, privateMasterUrl, gpsValue, rawProviderBody]) assert.equal(output.includes(forbidden), false);
```
- [ ] **Step 3: Write RED privileged suspension/recovery command tests**

Assert ordinary product-editor privilege cannot invoke emergency suspend/recover/purge/migration commands. Authorized suspend calls Task-17 `suspendDelivery`; authorized recovery calls `recoverDelivery`. Suspended media remains blocked from public DTO/attachment/profile activation and keeps private master intact.


```ts
await assert.rejects(runDeliveryControl(editorActor, { action: "suspend", mediaId, reasonCode: "LEGAL_REVIEW" }), /FORBIDDEN/);
await runDeliveryControl(privilegedActor, { action: "suspend", mediaId, reasonCode: "LEGAL_REVIEW" });
assert.ok((await readMedia(mediaId)).deliveryDisabledAt);
```
- [ ] **Step 4: Run RED**

```powershell
node --test tests/media-operations-telemetry.test.ts tests/media-lifecycle-reconciliation.test.ts tests/media-delivery-contract.test.ts
```

Expected RED: modules/auth harness load, then redaction/privileged-command assertions fail. Missing authorization mock/module/configuration is invalid RED.

- [ ] **Step 5: Implement deterministic redaction and JSON-safe telemetry serialization**

Whitelist emitted properties from `MediaOperationalEvent`; never spread raw error/request/provider objects. Convert any measured `bigint` byte value using `.toString(10)` before constructing JSON. Separate high-volume operational events from privileged audit calls.


```ts
export function toSafeOperationalEvent(input: MediaOperationalEvent): MediaOperationalEvent {
  return {
    event: input.event,
    mediaId: input.mediaId,
    processingRunId: input.processingRunId,
    productId: input.productId,
    failureCode: input.failureCode,
    durationMs: input.durationMs,
    byteSize: input.byteSize,
    count: input.count,
  };
}
```
- [ ] **Step 6: Implement privileged suspend/recover command wiring**

Map the verified existing privilege primitive to `MediaLifecycleService.suspendDelivery()` / `recoverDelivery()`. Do not add a new role hierarchy. Recovery remains subject to Task-17 safety checks; the script cannot clear `deliveryDisabledAt` directly in Prisma.


```ts
if (!canPerformMediaEmergencyOperation(actor)) throw new Error("FORBIDDEN");
if (command.action === "suspend") await lifecycle.suspendDelivery(command.mediaId, actor.id, command.reasonCode);
else await lifecycle.recoverDelivery(command.mediaId, actor.id);
```
- [ ] **Step 7: Document exceptional CDN purge/revocation as a privileged operational procedure**

The runbook must state: normal replacement uses new immutable URLs and no purge; purge is exceptional for unsafe/legal/privacy/corrupted media. Ordinary Admin editors never receive purge credentials. Public revocation does not delete the private canonical master unless a separately approved destruction requirement exists.

- [ ] **Step 8: Document reconciliation observability and actionable conditions**

Record required signals: stale PENDING, expired PROCESSING leases, failed processing, integrity mismatch, storage failures, cleanup-eligible backlog/oldest age, FAILED(CLEANUP), staging leftovers, reconciliation repairs/repeated failures. Define initial severity classes without expanding into a Phase-11 monitoring platform.

- [ ] **Step 9: Document practical DR/recovery assets and rendition rebuild procedure**

Critical assets are DB metadata + durable canonical masters + deterministic processing-profile definitions. Renditions may be regenerated. Document how to reconcile DB MediaObject inventory with storage SHA-256 metadata and how to regenerate an active delivery set from the canonical master.

- [ ] **Step 10: Document provider migration/rollback procedure**

Use `COPY → VERIFY → CUTOVER → SOAK → RETIRE`. Verify inventory/count, byte size, SHA-256, MIME/metadata and required public accessibility. Preserve object keys where practical. Keep old provider through rollback window. Do not require active-active R2+S3.

- [ ] **Step 11: Implement only the telemetry hooks needed by the new media services**

Instrument ingest-created/failure, processing completion/failure, cleanup claim/completion/failure, staging cleanup, profile activation, suspension/recovery, and reconciliation summary. Use safe IDs/codes only; do not emit provider secrets or private master URLs.


```ts
telemetry.record({ event: "PROCESSING_COMPLETE", mediaId, processingRunId, durationMs });
telemetry.record({ event: "CLEANUP_FAILED", mediaId, failureCode });
telemetry.record({ event: "RECONCILIATION_BATCH", count: summary.cleanupCompleted + summary.stagingCleaned });
```
- [ ] **Step 12: Run GREEN plus secret/redaction scan**

```powershell
node --test tests/media-operations-telemetry.test.ts tests/media-lifecycle-reconciliation.test.ts tests/media-delivery-contract.test.ts
npx tsc --noEmit
git grep -n -E 'AWS_SECRET_ACCESS_KEY|R2_SECRET|BEGIN PRIVATE KEY' -- . ':!docs/superpowers/specs/*' ':!docs/superpowers/plans/*'
```

Expected secret scan: no newly introduced secrets.

- [ ] **Step 13: Commit operations package**

```powershell
git diff --check
git add -- lib/media/mediaTelemetry.ts scripts/phase6-media-delivery-control.ts tests/media-operations-telemetry.test.ts docs/superpowers/evidence/phase6-media-operations-runbook.md
git diff --cached --name-only
git commit -m "feat: add managed media operations safeguards"
```

If implementation requires modifying an existing privileged audit helper rather than only consuming it, STOP and obtain owner/technical-owner review before expanding the task-owned file set.

---

### Task 24: Browser-Native Responsive Selection, No-Master Leak, Cache Behavior, Production Direct Delivery, Visual/Network Evidence

**Files:**
- Create: `tests/media-browser-network-qa.test.ts`
- Modify: `tests/storefront-responsive-browser-qa.test.ts`
- Modify: `docs/superpowers/evidence/phase6-media-acceptance.md`
- Modify conditionally when measured QA exposes a defect: `components/ui/ResponsiveProductImage.tsx`, `components/ui/ProductCard.tsx`, `components/ui/ProductCardCarousel.tsx`, `components/product/ProductDetailsClient.tsx`; stage only the exact files actually changed.
- Create evidence directory: `artifacts/phase6-media-browser/`
- Create evidence archive: `artifacts/phase6-media-browser.zip`; copy a duplicate to `~/Downloads` where useful while preserving repository evidence.

**Interfaces:**
- Consumes: Tasks 20–22 public media/storefront integration; Task 11 real-provider evidence when authorized.
- Produces: actual browser/network proof of responsive source choice, no master leak, lazy gallery behavior, suspension-safe public projection, cache/direct-delivery behavior, and premium owner-inspectable visual evidence.

- [ ] **Step 1: Define the exact browser evidence record shape**

In `tests/media-browser-network-qa.test.ts` define:

```ts
export type BrowserMediaEvidence = Readonly<{
  viewport: string;
  dpr: number;
  renderedWidth: number;
  currentSrc: string;
  naturalWidth: number;
  mimeType: string;
  transferredBytes: number;
  cacheResult: string;
  initialRequests: readonly string[];
  secondaryRequestTimesMs: readonly number[];
}>;
```

Use the repository's existing browser harness rather than introducing a second browser framework.

- [ ] **Step 2: Add representative managed-media test products/pages**

Use the verified Task-2 generated classes: photo, text-packaging, fine-texture, dark-gradient, transparent, ICC/profile-bearing. Include mixed managed/legacy gallery and a product whose first MANAGED image is suspended while a second safe image exists. Do not use a private master URL as public fixture input.


```ts
const qaProducts = await seedPhase6BrowserQaProducts({
  fixtureKinds: ["photo", "text-packaging", "fine-texture", "dark-gradient", "transparent", "icc-profile"],
  includeMixedLegacyManaged: true,
  includeSuspendedPrimaryWithSafeSecondary: true,
});
assert.ok(qaProducts.length >= 6);
```
- [ ] **Step 3: Write RED ProductCard browser assertions at mobile/tablet/desktop/DPR≥2**

At 375×667, 768×1024, 1280×800 and DPR≥2 capture actual rendered width/currentSrc/naturalWidth/MIME/transfer/cache values. Assert selected width is sensible for rendered CSS×DPR, not routinely a detail/master asset, and high-DPI is not undersized. Assert only primary/current gallery request is initially loaded and secondaries remain structurally lazy.


```ts
for (const viewport of [{ width: 375, height: 667 }, { width: 768, height: 1024 }, { width: 1280, height: 800 }]) {
  const evidence = await captureProductCardEvidence(page, viewport);
  assert.ok(evidence.currentSrc);
  assert.ok(evidence.naturalWidth >= Math.ceil(evidence.renderedWidth * evidence.dpr * 0.9));
  assert.equal(evidence.initialRequests.filter(isGalleryImageRequest).length <= 2, true);
}
```
- [ ] **Step 4: Write RED Product Detail browser assertions**

Assert primary detail media chooses an appropriate larger rendition, remains crisp at DPR≥2, no master URL is selected, only bounded above-fold priority is used, and secondaries are not all eagerly downloaded.


```ts
const detail = await captureProductDetailEvidence(page, { width: 1280, height: 800, dpr: 2 });
assert.ok(detail.naturalWidth >= Math.ceil(detail.renderedWidth * detail.dpr * 0.9));
assert.equal(detail.initialRequests.filter(isSecondaryGalleryRequest).length, 0);
assert.equal(isMasterUrl(detail.currentSrc), false);
```
- [ ] **Step 5: Write RED suspension-public-projection browser regression**

For first ProductImage suspended + stale `Product.image` compatibility URL, assert browser markup/network never receives that suspended URL as normal customer media. In the mixed-gallery fixture, assert the first safe image becomes the visible/public primary.


```ts
const suspended = await captureSuspendedPrimaryProduct(page);
assert.equal(suspended.networkUrls.includes(suspendedCompatibilityUrl), false);
assert.equal(suspended.visiblePrimarySrc, expectedSafeSecondaryUrl);
```
- [ ] **Step 6: Write RED global no-master-leak assertions**

Inspect ProductCard markup/srcset, Product Detail markup/srcset, public catalog/API responses captured by the test, Admin normal preview response where available, and network requests. Assert no canonical/private master object key/URL appears anywhere in those public/normal-preview surfaces.


```ts
for (const surface of [cardMarkup, detailMarkup, publicCatalogJson, adminPreviewJson, networkLog]) {
  assert.equal(surface.includes(canonicalMasterObjectKey), false);
  assert.equal(surface.includes(privateMasterUrl), false);
}
```
- [ ] **Step 7: Run behavioral RED and repair harness failures before counting RED**

```powershell
node --test tests/media-browser-network-qa.test.ts
```

Expected RED: browser launches and pages load; one or more intended responsive/lazy/suspension/network assertions fail before final QA calibration. Browser launch, missing fixture, route configuration, syntax, or environment failure is invalid RED.

- [ ] **Step 8: Measure and correct ProductCard `sizes`/loading only when evidence proves a mismatch**

Read actual CSS width from the browser evidence, then adjust the Task-21 ProductCard `sizes` string/source ordering or lazy-loading attributes only if `currentSrc`/requests are measurably wrong. Do not use a guessed `sizes` value or unrelated visual redesign.

- [ ] **Step 9: Measure and correct Product Detail `sizes`/priority only when evidence proves a mismatch**

Use actual detail rendered width/DPR/currentSrc to change only Task-22 responsive source/priority behavior necessary to satisfy the measured contract. Do not preload all gallery images.

- [ ] **Step 10: Verify public DTO suspension fallback remains correct after component wiring**

Re-run the Task-20 public query tests and browser suspended-primary fixture. No component may fall back to raw persisted `Product.image` when the corresponding managed media is suspended/unavailable.

- [ ] **Step 11: Verify LocalMediaStorage behavior without misapplying the production direct-CDN gate**

In local/dev mode, record the approved dev-serving request path and confirm no private master is public. Do not fail Phase-6 local development solely because LocalMediaStorage uses app-local/dev serving.

- [ ] **Step 12: Verify real production-style direct delivery when the provider gate is authorized**

Against the authorized isolated S3/R2 delivery environment, prove public rendition request is Browser→media hostname/CDN→object storage on cache miss and does not appear in Next.js request logs or require Prisma/PostgreSQL/provider SDK calls through the application. If Task-11 real-provider authorization remains open, record `PRODUCTION_DIRECT_DELIVERY=OPEN`; do not fabricate closure.

- [ ] **Step 13: Capture cache behavior evidence**

For immutable public renditions record response `Cache-Control`, first-request cache result, repeat-request/browser/CDN cache result where observable, and immutable URL. Expected policy is the approved long-lived equivalent to `public, max-age=31536000, immutable`; normal replacement must not depend on purge.

- [ ] **Step 14: Capture mandatory source/master/WebP visual comparisons**

For each representative class, capture source vs canonical master vs WebP at relevant mobile/tablet/desktop/high-DPI display sizes. Inspect packaging text, color fidelity, fine texture, edges, gradients/banding, transparency halos, aspect ratio, and sharpening. Record actual bytes/dimensions and visual decision; no universal KB threshold.

- [ ] **Step 15: Capture AVIF visual/network comparisons only when the active immutable profile enables AVIF**

If AVIF is enabled, run the same visual/color/network matrix against AVIF. In a browser that supports AVIF, prove actual `<picture>` selection honors Task-12 preference: the recorded network MIME is `image/avif` and `currentSrc` belongs to the AVIF srcset rather than WebP; inspect markup to prove the AVIF `<source>` precedes WebP. If the selected profile is WebP-only because AVIF was not proven safe/stable, prove there is no AVIF `<source>` and record that evidence; do not make AVIF a hidden completion blocker.

- [ ] **Step 16: Run GREEN browser/network + catalog suspension/N+1 regressions**

```powershell
node --test tests/media-browser-network-qa.test.ts tests/storefront-responsive-browser-qa.test.ts tests/public-managed-media-query.test.ts tests/public-catalog-gallery-query.test.ts
```

Expected: exit 0 for locally closable assertions; any explicitly external production-provider gate remains recorded OPEN rather than misreported as pass.

- [ ] **Step 17: Package owner-inspectable evidence**

Write screenshots/network JSON into `artifacts/phase6-media-browser/`, create `artifacts/phase6-media-browser.zip`, and where `~/Downloads` is available copy a duplicate there. Preserve the original repository evidence.

```powershell
Compress-Archive -Path 'artifacts\phase6-media-browser\*' -DestinationPath 'artifacts\phase6-media-browser.zip' -Force
$downloads = Join-Path $HOME 'Downloads'
if (Test-Path $downloads) { Copy-Item 'artifacts\phase6-media-browser.zip' (Join-Path $downloads 'phase6-media-browser.zip') -Force }
```

- [ ] **Step 18: Commit browser/network QA package with exact conditional file staging**

```powershell
git diff --check
git add -- tests/media-browser-network-qa.test.ts tests/storefront-responsive-browser-qa.test.ts docs/superpowers/evidence/phase6-media-acceptance.md artifacts/phase6-media-browser artifacts/phase6-media-browser.zip
```

If Steps 8–9 changed Task-21/22 component files, stage exactly those changed component files as well and list them in the checkpoint report before commit.

```powershell
git diff --cached --check
git commit -m "test: verify phase 6 media browser delivery"
```

---

### Task 25: Full Regression/Acceptance Bundle, Owner Manual Gate, Decide IMPLEMENTATION READY

**Files:**
- Modify: `docs/superpowers/evidence/phase6-media-acceptance.md`
- No feature code should be added unless a failing acceptance test identifies a defect; any defect fix must receive its own RED→GREEN mini-cycle and be limited to the responsible files.

**Interfaces:**
- Consumes: Tasks 0–24.
- Produces: complete five-dimension acceptance bundle and an evidence-backed status of `IMPLEMENTATION_READY` or `NOT_READY`.

- [ ] **Step 1: Run all targeted Phase-6 tests fresh**

```powershell
node --test `
  tests/media-fixtures.test.ts `
  tests/media-domain.test.ts `
  tests/media-processing-profile.test.ts `
  tests/media-storage-contract.test.ts `
  tests/media-local-storage.test.ts `
  tests/media-s3-storage.test.ts `
  tests/media-image-security.test.ts `
  tests/media-renditions.test.ts `
  tests/media-ingest-service.test.ts `
  tests/media-upload-route.test.ts `
  tests/media-lifecycle-reconciliation.test.ts `
  tests/product-managed-media-write.test.ts `
  tests/admin-managed-media-ui.test.ts `
  tests/public-managed-media-query.test.ts `
  tests/media-delivery-contract.test.ts `
  tests/product-card-responsive-media.test.ts `
  tests/product-detail-responsive-media.test.ts `
  tests/media-operations-telemetry.test.ts `
  tests/media-browser-network-qa.test.ts
```

If real R2 integration was authorized, include `tests/media-r2-integration.test.ts`; otherwise report it as an open production-provider gate, not a pass.

- [ ] **Step 2: Run existing focused regressions and migration rehearsals**

```powershell
node --test tests/product-image-schema.test.ts tests/migration-rehearsal-postgres.test.ts tests/product-gallery-write.test.ts tests/admin-gallery-edit-ui.test.ts tests/admin-product-gallery-read.test.ts tests/public-catalog-gallery-query.test.ts tests/product-card-carousel.test.ts tests/product-detail-shared-gallery.test.ts tests/storefront-responsive-browser-qa.test.ts
```

- [ ] **Step 3: Run compiler, Prisma validation, lint, build, and full repository suite**

```powershell
npx tsc --noEmit
npx prisma validate
npm run lint
npm run build
npm test
```

Record exact exit codes/counts. Historical full-suite reference was 731 total / 723 passed / 0 failed / 8 cancelled / exit 1. The fresh run controls the report. If there are zero failures but intentional guarded cancellations still make exit 1, state exactly that; never label exit 1 as PASS.

- [ ] **Step 4: Verify five acceptance dimensions explicitly**

In `phase6-media-acceptance.md`, mark each with evidence links/commands: SECURITY; PREMIUM VISUAL QUALITY; RESPONSIVE MEDIA DELIVERY PERFORMANCE; LIFECYCLE/RECOVERY SAFETY; PROVIDER/PERSISTENCE PORTABILITY. `IMPLEMENTATION_READY` requires all implementation-level evidence green; production/provider/shared-migration gates may remain separately open only under the approved status distinction.

- [ ] **Step 5: Run static hard-gate scans**

Prove no master/private URL leaks into ProductImage.url/Product.image/public DTO/components; no R2/AWS/Cloudinary business contract names in Product/Admin/storefront domain files; no provider HEAD/GET/LIST in normal catalog read paths; no arbitrary legacy URL physical deletion authority; no new direct `image:` override of managed galleries.

- [ ] **Step 6: Prepare owner manual acceptance bundle and STOP for owner inspection**

Provide mobile 375×667, tablet 768×1024, desktop 1280×800, DPR≥2 evidence with actual `currentSrc`, `naturalWidth`, rendered width, DPR, MIME, bytes, cache, primary/secondary request timing, source/master/WebP comparison and conditional AVIF comparison. Copy evidence ZIP/screenshots to `~/Downloads` where available.

- [ ] **Step 7: Record owner decision without advancing automatically**

If owner rejects visual/network/security evidence, status stays `NOT_READY`; fix only through explicit reviewed RED→GREEN defect packages. If owner approves and all implementation gates are green, record `PHASE 6 IMPLEMENTATION READY`. Do not call it production COMPLETE/LOCKED yet unless the later separately authorized production-rollout/final-lock package passes.

Record exactly one of these evidence blocks according to the actual owner decision:

```text
OWNER_MANUAL_ACCEPTANCE=APPROVED
PHASE6_IMPLEMENTATION_STATUS=IMPLEMENTATION_READY
PRODUCTION_ACTIVATION_STATUS=OPEN
```

or:

```text
OWNER_MANUAL_ACCEPTANCE=REJECTED
PHASE6_IMPLEMENTATION_STATUS=NOT_READY
PRODUCTION_ACTIVATION_STATUS=NOT_AUTHORIZED
```

- [ ] **Step 8: Commit acceptance evidence only after owner manual decision is recorded**

```powershell
git diff --check
git add -- docs/superpowers/evidence/phase6-media-acceptance.md artifacts/phase6-media-browser artifacts/phase6-media-browser.zip
git diff --cached --check
git commit -m "test: record phase 6 media acceptance"
```

The Task-24 evidence paths are fixed above; do not stage unrelated evidence.

---

### Task 26: Conditional Staged Shared Rollout/Final Phase-6 Lock Only After Separate Owner Authorization

**Files:**
- Potentially no production-code changes.
- Shared database/provider/deployment state only if all explicit gates below are satisfied and owner separately authorizes Path A.
- Modify final evidence/runbook only with actual rollout results: `docs/superpowers/evidence/phase6-media-acceptance.md`, `docs/superpowers/evidence/phase6-media-operations-runbook.md`.

**Interfaces:**
- Consumes: Task 25 IMPLEMENTATION READY; Task 1 checksum evidence and separately approved remediation; Task 11 actual selected-provider authorization; exact checkpoint values `EXPAND_RELEASE_COMMIT`, `BRIDGE_RELEASE_COMMIT`, `CLASSIFY_RELEASE_COMMIT`, and `CONTRACT_RELEASE_COMMIT` recorded by Tasks 4–7.
- Produces: an executable staged migration/application rollout using immutable release commits/artifacts, or Path B `IMPLEMENTATION LOCKED / PRODUCTION ACTIVATION DEFERRED`. No implied live activation.

- [ ] **Step 1: Re-check independent database/provider gates and exact release commit identities**

Path A is forbidden unless: historical checksum issue is resolved/documented with owner-approved remediation; migration history is safe after remediation; actual selected production provider is authorized/revalidated; production credentials/DNS/custom media domain are separately approved; Task 25 owner acceptance passed; and all four release commit IDs are available from the approved task checkpoint evidence.

```powershell
$requiredReleaseCommits = @{
  EXPAND   = $env:PHASE6_EXPAND_RELEASE_COMMIT
  BRIDGE   = $env:PHASE6_BRIDGE_RELEASE_COMMIT
  CLASSIFY = $env:PHASE6_CLASSIFY_RELEASE_COMMIT
  CONTRACT = $env:PHASE6_CONTRACT_RELEASE_COMMIT
}
foreach ($entry in $requiredReleaseCommits.GetEnumerator()) {
  if (-not $entry.Value) { throw "PHASE6_RELEASE_COMMIT_MISSING:$($entry.Key)" }
  git cat-file -e "$($entry.Value)^{commit}"
}
```

Verify ancestry without changing main:

```powershell
git merge-base --is-ancestor $requiredReleaseCommits.EXPAND $requiredReleaseCommits.BRIDGE
if ($LASTEXITCODE -ne 0) { throw 'EXPAND_NOT_ANCESTOR_OF_BRIDGE' }
git merge-base --is-ancestor $requiredReleaseCommits.BRIDGE $requiredReleaseCommits.CLASSIFY
if ($LASTEXITCODE -ne 0) { throw 'BRIDGE_NOT_ANCESTOR_OF_CLASSIFY' }
git merge-base --is-ancestor $requiredReleaseCommits.CLASSIFY $requiredReleaseCommits.CONTRACT
if ($LASTEXITCODE -ne 0) { throw 'CLASSIFY_NOT_ANCESTOR_OF_CONTRACT' }
git merge-base --is-ancestor $requiredReleaseCommits.CONTRACT (git rev-parse HEAD)
if ($LASTEXITCODE -ne 0) { throw 'CONTRACT_NOT_ANCESTOR_OF_FINAL_HEAD' }
```

- [ ] **Step 2: Prove each immutable release commit contains the expected Phase-6 migration horizon**

Inspect migration directories at each commit without checking them out in the real working tree:

```powershell
$phase6MigrationPattern = 'prisma/migrations/202609050(10000_phase6_media_expand|20000_phase6_product_image_classification|30000_phase6_media_contract)/migration.sql'
$expandFiles = @(git ls-tree -r --name-only $requiredReleaseCommits.EXPAND | Select-String $phase6MigrationPattern | ForEach-Object { $_.Line })
$bridgeFiles = @(git ls-tree -r --name-only $requiredReleaseCommits.BRIDGE | Select-String $phase6MigrationPattern | ForEach-Object { $_.Line })
$classifyFiles = @(git ls-tree -r --name-only $requiredReleaseCommits.CLASSIFY | Select-String $phase6MigrationPattern | ForEach-Object { $_.Line })
$contractFiles = @(git ls-tree -r --name-only $requiredReleaseCommits.CONTRACT | Select-String $phase6MigrationPattern | ForEach-Object { $_.Line })
if ($expandFiles.Count -ne 1 -or $expandFiles[0] -notmatch '010000_phase6_media_expand') { throw 'EXPAND_RELEASE_MIGRATION_HORIZON_INVALID' }
if ($bridgeFiles.Count -ne 1 -or $bridgeFiles[0] -notmatch '010000_phase6_media_expand') { throw 'BRIDGE_RELEASE_MIGRATION_HORIZON_INVALID' }
if ($classifyFiles.Count -ne 2) { throw 'CLASSIFY_RELEASE_MIGRATION_HORIZON_INVALID' }
if ($contractFiles.Count -ne 3) { throw 'CONTRACT_RELEASE_MIGRATION_HORIZON_INVALID' }
```

Also inspect `git show --stat --oneline` for each exact commit and record the evidence. This proves staged artifacts are materially different from final HEAD.

- [ ] **Step 3: STOP for separate owner authorization before any shared/non-local migration or production provisioning**

No implementation-plan approval alone authorizes shared Neon migration, production bucket creation, DNS change, credential creation, exact-release deployment, or managed-ingestion enablement. Choose Path A or Path B only after this separate decision.

- [ ] **Step 4: If Path A is authorized, create isolated exact-commit deployment workspaces/artifacts without changing/resetting main**

Use the deployment platform's immutable commit-artifact mechanism when available. If local release workspaces are needed, create separate temporary clones/checkouts outside the real working tree; do not reset/rebase/rewrite main.

```powershell
$releaseRoot = Join-Path $env:TEMP ("purehaven-phase6-rollout-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $releaseRoot | Out-Null
foreach ($name in @('EXPAND','BRIDGE','CLASSIFY','CONTRACT')) {
  $path = Join-Path $releaseRoot $name.ToLowerInvariant()
  git clone --no-checkout (Get-Location).Path $path
  git -C $path checkout --detach $requiredReleaseCommits[$name]
  $actual = (git -C $path rev-parse HEAD).Trim()
  if ($actual -ne $requiredReleaseCommits[$name]) { throw "RELEASE_WORKSPACE_SHA_MISMATCH:$name:$actual" }
}
```

If the actual deployment environment cannot safely deploy/build from exact immutable commit artifacts or equivalent isolated release workspaces, **STOP and request an alternative owner-approved rollout mechanism**. Never emulate staged rollout by editing migration history.

- [ ] **Step 5: Apply the exact pre-migration guard before every shared migration invocation**

For the release workspace about to run a migration:

1. verify workspace `HEAD` equals the expected release commit;
2. verify the target database identity/environment with the approved production-target guard;
3. run `npx prisma migrate status` and capture full output/exit code;
4. inspect that release artifact's migration directories;
5. compare them with the database's read-only applied migration evidence;
6. prove the expected newly pending Phase-6 set is exact;
7. STOP if any unrelated/unexpected migration is pending.

Expected newly-pending Phase-6 sets:

```text
EXPAND release:   20260905010000_phase6_media_expand only
CLASSIFY release: 20260905020000_phase6_product_image_classification only
CONTRACT release: 20260905030000_phase6_media_contract only
```

Hard prohibition:

> **DO NOT run final-HEAD `prisma migrate deploy` when EXPAND/CLASSIFY/CONTRACT are all still pending and expect staged rollout semantics.**

Do not use `_prisma_migrations` edits, speculative `migrate resolve`, raw history manipulation, migration rewrites, or reapplication to fake these stages.

- [ ] **Step 6: Deploy/run the EXPAND release artifact only**

From the exact `EXPAND_RELEASE_COMMIT` workspace/artifact, install/build using that immutable release's lockfile as required by the deployment environment, run Step 5, and only then run the separately authorized shared migration command:

```powershell
npx prisma migrate status
# Record exact pending set: EXPAND only.
npx prisma migrate deploy
```

Immediately verify migration status/read-only migration evidence shows EXPAND applied and that CLASSIFY/CONTRACT do not exist in this release artifact. STOP on any discrepancy.

- [ ] **Step 7: Deploy the exact BRIDGE application release with managed ingestion disabled**

Deploy/build `BRIDGE_RELEASE_COMMIT`. Verify the application reads null/legacy bridge rows correctly, legacy storefront/Admin behavior remains healthy, and ManagedMedia ingestion feature gate remains disabled. Do not deploy CLASSIFY yet. Record bridge health and pre-classification ProductImage URL-class counts.

- [ ] **Step 8: Run the exact CLASSIFY release migration only, then verify postconditions**

From `CLASSIFY_RELEASE_COMMIT`, run Step 5. It must prove EXPAND is already applied and CLASSIFY is the only newly pending Phase-6 migration in that artifact. Then:

```powershell
npx prisma migrate status
# Record exact pending set: CLASSIFY only.
npx prisma migrate deploy
```

Verify Task-6 postconditions: unknown URL class=0; `sourceKind IS NULL`=0; ProductImage count/IDs/productId/sortOrder/url unchanged; `Product.image` unchanged; historical `managedMediaId` null; zero ManagedMedia rows created by classification. STOP on any mismatch.

- [ ] **Step 9: Run the exact CONTRACT release migration only, then verify constraints**

From `CONTRACT_RELEASE_COMMIT`, run Step 5. It must prove EXPAND+CLASSIFY are already applied and CONTRACT is the only newly pending Phase-6 migration. Then:

```powershell
npx prisma migrate status
# Record exact pending set: CONTRACT only.
npx prisma migrate deploy
```

Verify expected CHECK/FK/unique/index constraints and final migration state. Do not advance if the original pre-Phase-6 URL-only writer is still serving writes after CONTRACT.

- [ ] **Step 10: Deploy the final/current application release with managed ingestion still disabled**

Deploy the final approved application release only after CONTRACT verification. Prove managed + legacy reads remain healthy and the new-ingestion gate is still disabled. The post-CONTRACT rollback floor is now the Phase-6-compatible bridge/application, never the original URL-only writer.

- [ ] **Step 11: Re-check production provider/custom-domain readiness, then separately enable ManagedMedia ingestion**

Only after DB rollout is verified and the selected provider gate is green may the owner authorize enabling new managed uploads. Provider and DB approvals remain independent. Keep the feature gate reversible; disabling new ingestion must not disable existing managed delivery.

- [ ] **Step 12: Run live Path-A acceptance one checkpoint at a time**

Use a safe test product: managed upload → status PENDING/PROCESSING if applicable → READY safe preview → ProductImage attach → responsive direct CDN GET → legacy mixed gallery → suspension rejection/recovery → inactive-profile cleanup canonical-master protection → no-master leak → owner visual/network smoke. Preserve old provider/origin through the approved soak/rollback window.

- [ ] **Step 13: If Path B is selected instead, prove production activation remained untouched**

Record exact status `IMPLEMENTATION LOCKED / PRODUCTION ACTIVATION DEFERRED`; prove no shared Phase-6 migration/provisioning/DNS/credential change occurred and re-run implementation-ready local/isolated evidence. Do not execute Steps 4–12 as production actions under Path B.

- [ ] **Step 14: Commit final rollout evidence, then push/tag only if the approved completion path permits it**

```powershell
git status --short
git diff --check
git add -- docs/superpowers/evidence/phase6-media-acceptance.md docs/superpowers/evidence/phase6-media-operations-runbook.md
if (git diff --cached --quiet) {
  Write-Host 'NO_NEW_ROLLOUT_EVIDENCE_TO_COMMIT'
} else {
  git diff --cached --check
  git commit -m "docs: record phase 6 rollout status"
}
```

After owner accepts the selected completion status and all task-owned evidence is committed:

```powershell
git push origin main
```

For Path A only, or Path B only if owner explicitly requests an implementation-lock tag, create the owner-approved annotated tag name and push that exact tag. Do not invent a tag.

- [ ] **Step 15: Prove synchronization and clean working tree**

```powershell
$head = (git rev-parse HEAD).Trim()
$origin = (git rev-parse origin/main).Trim()
$status = git status --porcelain=v1 -uall
"HEAD=$head"
"ORIGIN_MAIN=$origin"
if ($head -ne $origin) { throw 'FINAL_SYNC_MISMATCH' }
if ($status) { throw "FINAL_WORKTREE_NOT_CLEAN`n$status" }
```

Only after exact selected-path evidence and owner approval may status be reported as `PHASE 6 COMPLETE / LOCKED` (Path A) or `IMPLEMENTATION LOCKED / PRODUCTION ACTIVATION DEFERRED` (Path B).

---

## Requirement-to-Task Coverage

| Approved Phase-6 requirement | Task(s) |
|---|---|
| Exact baseline + approved spec/plan repository-lock gate | 0 |
| Historical Prisma checksum exact-byte investigation; no speculative remediation | 1, 26 |
| Current ~5 MB baseline and all processing/runtime calibration evidence | 2 |
| Deterministic non-empty/decodable/class-representative calibration fixture gate before benchmark execution | 2 |
| Canonical-master encoding benchmark | 2, 13 |
| Immutable profile semantics / conditional AVIF | 3, 14, 17 |
| Domain lifecycle/source/access/suspension types | 3 |
| ManagedMedia/MediaProcessingRun/MediaObject/ProductImage persistence | 4 |
| Nonredundant MediaObject ownership via ProcessingRun | 4, 7 |
| EXPAND → Bridge → CLASSIFY → CONTRACT schema/application rollout design | 4, 5, 6, 7 |
| Exact release-commit capture + staged shared rollout artifacts; no final-HEAD migration collapse | 4, 5, 6, 7, 26 |
| PostgreSQL CHECK/FK/unique/index constraints | 7 |
| Fresh + historical upgrade migration rehearsals | 4, 6, 7, 25 |
| Legacy classification only; no automatic import | 5, 6, 7, 18, 20 |
| `MediaStorage` + `InMemoryMediaStorage` | 8 |
| `LocalMediaStorage` / environment isolation / private master root | 9 |
| S3-compatible adapter / provider-independent errors | 10 |
| Atomic concurrency-safe immutable create; no check-then-put fallback | 10, 11 |
| R2 implementation-time revalidation + isolated real-provider capability gate | 11 |
| Provider-neutral delivery resolver / public DTO / suspended delivery rejection | 12, 23 |
| Preliminary pre-staging MIME/signature/container admission + full decode/decoded agreement/malformed/animation/security limits | 13, 16 |
| Orientation, metadata/privacy sanitation, color, transparency, no-upscale | 13 |
| Responsive WebP baseline / width ladder / conditional AVIF | 14 |
| Deterministic public source preference: AVIF before WebP when enabled; WebP-only otherwise | 12, 21, 24 |
| Durable staging / scoped idempotency / server-derived SHA / partial recovery | 15 |
| Auth-before-parse + early request/file admission + ingestion feature gate | 16 |
| Sync-if-safe vs brokerless DB-backed processing | 2, 15, 16, 17 |
| Lifecycle state machine / leases / retries / reconciliation | 17 |
| `deliveryDisabledAt` attachment, activation, public delivery, recovery | 12, 17, 18, 23 |
| Canonical master retained/reused; future profile regeneration rendition-only | 13, 14, 17 |
| Inactive profile cleanup must not delete canonicalMasterObjectId | 17, 25 |
| Full ManagedMedia cleanup vs canonical-master replacement separation | 17, 23 |
| Existing `PUT /api/products` remains gallery mutation authority | 18 |
| Structured legacy identity by existing ProductImage ID | 18, 19 |
| ProductImage.url server-derived mirror / Product.image first-image mirror | 17, 18 |
| Product deletion/cascade cleanup hint without storage delete | 18 |
| Authenticated upload status API + DB_BACKED Processing→Ready/Failed discovery | 16, 17, 19 |
| Admin upload/status polling/retry UX + temporary Object URL cleanup | 19 |
| Bounded managed catalog reads / zero provider N+1 | 20, 24, 25 |
| Suspended managed media cannot leak through stale Product.image/public primary compatibility reads | 20, 24, 25 |
| Responsive ProductCard + structural secondary lazy behavior | 21, 24 |
| Responsive Product Detail + high-DPI behavior | 22, 24 |
| Audit/telemetry/redaction/operational visibility | 23 |
| Emergency suspension/takedown + exceptional purge policy | 23 |
| DR/provider migration/rollback runbook | 23, 26 |
| No private-master leak | 12, 20, 21, 22, 24, 25 |
| Production direct CDN/object rendition GET bypasses app/DB | 11, 24, 25 |
| Mobile/tablet/desktop/high-DPI browser/network evidence | 21, 22, 24, 25 |
| Premium visual/color/packaging/texture/transparency acceptance | 2, 13, 14, 24, 25 |
| Storage adapter common-contract proof | 8, 9, 10, 11, 25 |
| Legacy media render/reorder/remove with zero managed physical deletion | 18, 20, 24, 25 |
| Media fixture gate included in final targeted acceptance + five acceptance dimensions + owner manual gate | 2, 25 |
| IMPLEMENTATION READY vs production COMPLETE/LOCKED distinction | 25, 26 |
| Independent DB/provider production gates | 11, 26 |
| Conditional production rollout / push / tag / clean verification | 26 |

## Remaining Calibration and External Gates

- Upload file limit starts at current ~5 MB and changes only if Task 2 premium fixtures prove need.
- Decode limits 40 MP / 12k axis are candidates until Task 2 runtime/memory evidence.
- Canonical-master 5120px / 24MP candidates and encoding strategy remain benchmark-driven.
- Rendition widths 320/640/960/1280/1600/2048 are profile-v1 candidates; generate only useful widths and a nonredundant terminal width.
- WebP quality 88 and AVIF quality 65 are starting values only; visual acceptance controls final values.
- AVIF delivery is optional if unstable/unavailable; if enabled, it is immutable profile semantics and must pass the same visual/network gate.
- Processing concurrency, timeout, and SYNC vs DB_BACKED execution remain deployment-benchmark decisions.
- ProductCard/Product Detail `sizes` strings are set only after measured CSS widths.
- Cleanup grace begins with the approved conservative candidate (7 days) only if implementation evidence does not justify another configurable value.
- Historical Prisma checksum divergence blocks shared/non-local Phase-6 migrations until exact-byte evidence + owner-approved remediation.
- R2 remains preferred but production authorization requires implementation-time pricing/S3/custom-domain/DNS/credential/deployment revalidation, isolated real-provider evidence, and successful atomic immutable-create capability testing; failure keeps R2 unauthorized rather than weakening the adapter contract.
- Production activation, shared DB migration, R2 provisioning, DNS/credentials, final push/tag remain separately owner-authorized Task 26 actions.

## Plan Execution Discipline

Execute Task 0 through Task 26 in order. Each task is an independently reviewable commit/evidence package. After every task, report: task, files changed, RED evidence when applicable, implementation summary, GREEN evidence, focused regression, typecheck/lint/build status when applicable, DB/migration status when applicable, Git diff summary, current HEAD, worktree status, and next task. Do not advance past a failed prerequisite or hard gate. No task may silently broaden Product-first Phase-6 scope.

