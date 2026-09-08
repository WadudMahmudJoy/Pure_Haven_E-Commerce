# Pure Haven BD — Phase 6 Media / Image Infrastructure
## Formal Architectural Design Specification

**Spec path:** `docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md`  
**Status:** **FORMAL SPEC — REVISED, PENDING FINAL OWNER APPROVAL**  
**Repository-lock status:** **NOT YET VERIFIED — final approved artifact must be SHA-256-matched in the real repository before implementation execution**  
**Architecture status:** Sections 1–6 approved; architectural design complete  
**Implementation status:** **NOT STARTED / NOT AUTHORIZED**  
**Approved direction:** **Approach C — Provider-Agnostic ManagedMedia + MediaStorage Hybrid**  
**Phase-6 starting Git baseline:** `7e4a750466b609f359ea26bd4233f7399b9f66ca`  
**Baseline tag:** `pre-phase6-ux-corrections-complete`  
**Production/shared Prisma migration status:** **BLOCKED pending historical checksum investigation**

---

## 1. Purpose

Phase 6 replaces Pure Haven BD's URL/path-oriented product-image infrastructure with a durable, provider-independent managed-media foundation while preserving the already-locked product gallery contract.

The governing objective is:

> **MAXIMUM PERCEIVED VISUAL QUALITY + MINIMUM NECESSARY TRANSFER SIZE + FAST DELIVERY + SECURE OWNERSHIP/LIFECYCLE + SCALABLE STORAGE.**

Phase 6 is not a storefront redesign and is not the whole-site performance phase. Its responsibility is to remove the major avoidable architectural bottlenecks in media ingestion, image processing, storage, delivery, ownership, cleanup, and provider portability.

Phase 6 must eventually pass five independent acceptance dimensions:

1. **Security**
2. **Premium visual quality**
3. **Responsive media-delivery performance**
4. **Lifecycle / recovery safety**
5. **Provider / persistence portability**

Compilation, unit tests, or generating WebP/AVIF files alone do not constitute completion.

---

## 2. Current-State Baseline and Constraints

The accepted pre-Phase-6 UX correction baseline is locked at:

```text
HEAD = origin/main = pre-phase6-ux-corrections-complete
     = 7e4a750466b609f359ea26bd4233f7399b9f66ca
```

The repository is expected to remain clean at the start of Phase-6 implementation.

The verified current product-media architecture has these relevant properties:

- `POST /api/upload` authenticates Admin before media parsing/storage work.
- Product uploads currently write to local application storage under `public/uploads/products/`.
- Current upload security includes a roughly 5 MB file-size ceiling, raster MIME allow-list, magic-byte checks, generated filenames, traversal protection, and exclusive creation.
- Current upload validation does **not** perform real image decoding, dimension/pixel validation, decompression-bomb protection, EXIF/privacy sanitation, or rendition generation.
- `ProductImage` is the authoritative ordered product gallery.
- `Product.image` is the compatibility primary-image mirror.
- Product gallery writes remain server-authoritative through `PUT /api/products`.
- Current `ProductImage` persistence is URL/order oriented rather than managed-asset oriented.
- Upload happens before final product save, so abandoned/failed saves can leave physical orphan files.
- Existing product-image removal does not safely delete physical media.
- Existing public catalog reads batch ProductImage data and must remain bounded; Phase 6 must not introduce provider N+1 calls.
- Existing secondary ProductCard gallery loading is intentionally lazy and must remain bounded.
- Legacy local and external media must continue rendering throughout rollout.

The historical Prisma migration checksum divergence remains an explicit deployment-risk record:

```text
migration:
20260526183231_sync_current_schema_security_fix

repository-observed checksum:
6ebbf1104c5fd06f0414e7ee01b6f8ebfbe340334e1dfed14d610337d104669c

Neon-recorded checksum:
ac0c8d8f465e09a5e69c1d4330668e5a320e03392ed4e47105d4355b6ac57013

checksumMatch = false
```

The UTF-8 BOM hypothesis is **not proven** until exact historical bytes produce the recorded Neon checksum.

**Hard rule:** no shared/non-local Phase-6 Prisma migration may run until this mismatch is investigated, documented, and explicitly approved.

---

# 3. Architecture Overview

## 3.1 Core architecture

Pure Haven owns the media domain, processing policy, and lifecycle. Storage providers remain infrastructure adapters.

```text
Admin upload
    |
    v
Managed-media ingestion boundary
    |
    +-- authentication / admission / validation
    +-- durable PENDING identity
    +-- private recoverable staging
    |
    v
Application-owned ImageProcessor
    |
    +-- decode / security validation
    +-- orientation / metadata sanitation / color handling
    +-- high-quality canonical MASTER
    +-- responsive delivery renditions
    |
    v
MediaStorage
    |
    +-- LocalMediaStorage                  development/demo
    +-- InMemoryMediaStorage               deterministic tests
    +-- S3CompatibleMediaStorage           production
           |
           +-- Cloudflare R2               leading first candidate
           +-- AWS S3                      replaceable alternative
           +-- other compatible object storage
    |
    v
ManagedMedia + MediaProcessingRun + MediaObject
    |
    v
ProductImage                           authoritative ordered gallery
    |
    v
Product.image                          compatibility primary mirror
    |
    v
Responsive media DTO
    |
    v
Browser <picture>/srcset/sizes
    |
    v
CDN/direct public rendition delivery
```

No ProductCard, Product Detail component, Admin product editor, ProductImage business rule, or catalog query may depend on R2/S3/Cloudinary-specific identifiers or APIs.

## 3.2 Responsibility separation

### ProductImage
Owns product usage and ordering:

- product relationship;
- gallery order;
- primary position through ordering;
- usage-specific `altText`;
- managed vs legacy source classification.

### ManagedMedia
Owns the logical Pure Haven-managed asset:

- permanent provider-independent identity;
- asset lifecycle;
- ingest idempotency identity;
- private staging locator/state;
- active delivery processing-run authority;
- canonical-master object authority;
- unreferenced/cleanup lifecycle;
- asset-level ingest/lifecycle/cleanup failure summary;
- tombstone state.

### MediaProcessingRun
Owns one pinned processing-profile execution for one ManagedMedia asset:

- `profileVersion`;
- deterministic profile-definition hash;
- processing state and lease;
- processing retry/failure details;
- completion status;
- immutable output inventory through MediaObject.

### MediaObject
Owns one durable physical MASTER or rendition identity:

- processing run that created the object;
- logical variant;
- access class;
- provider configuration key;
- provider-neutral object key;
- MIME/dimensions/byte size/SHA-256;
- physical-deletion tombstone metadata.

### MediaStorage
Owns physical object persistence semantics only.

It must not decide gallery order, Product ownership, image quality policy, lifecycle eligibility, or Admin authorization.

### MediaDeliveryResolver
Turns approved public MediaObject identity into customer delivery URLs without provider API/network calls.

---

# 4. Domain Model

## 4.1 ManagedMedia identity

`ManagedMedia.id` is an opaque application/server-generated durable ID, preferably PostgreSQL UUID-backed.

It is **not**:

- a URL;
- an R2/S3 object key;
- a Cloudinary public ID;
- a Product ID;
- a filename;
- a CDN hostname.

It remains unchanged across:

- provider migration;
- CDN hostname/origin changes;
- gallery reorder;
- profile regeneration;
- WebP/AVIF encoder improvements.

A DELETED ManagedMedia identity is never reused.

## 4.2 Ownership classification

A ManagedMedia row means Pure Haven owns that asset's managed lifecycle. Unmanaged legacy media does not receive fake ManagedMedia rows.

`ProductImage.sourceKind` has three values:

```text
MANAGED
LEGACY_LOCAL
LEGACY_EXTERNAL
```

### MANAGED

```text
managedMediaId != null
```

Pure Haven owns storage, renditions, lifecycle cleanup, provider migration, and physical deletion eligibility.

### LEGACY_LOCAL

Historical Pure Haven application paths, initially including only roots proven by repository/data audit such as:

```text
/uploads/products/...
/images/...
```

They remain renderable but are **unmanaged** during the first Phase-6 increment. Their physical files are not deletion targets merely because a ProductImage relationship is removed.

### LEGACY_EXTERNAL

Historical approved HTTPS references:

```text
https://...
```

Pure Haven owns only the ProductImage relationship, not the external object. No provider lifecycle, deletion, rendition cleanup, or migration is attempted against them.

## 4.3 New-media policy

Normal new Admin product media is **MANAGED only**.

Arbitrary external URL creation is not a first-class ProductImage creation path after Phase-6 cutover.

A future `Import from URL` feature, if separately approved, must be:

```text
external URL
→ authorized hardened import
→ validation/decode/processing
→ MediaStorage
→ ManagedMedia
→ ProductImage
```

The source URL is an ingestion source, never the permanent media identity.

## 4.4 ProductImage authority

For managed rows:

```text
ProductImage.managedMediaId
= durable media identity

ProductImage.url
= server-derived compatibility delivery mirror only
```

`ProductImage.url` is never independently editable/authoritative for a MANAGED row.

For legacy rows:

```text
ProductImage.url
= legacy reference
managedMediaId = null
```

For every product:

```text
first ordered ProductImage.url
→ Product.image compatibility mirror
```

No `Product.primaryManagedMediaId` or competing primary-image authority is introduced.

## 4.5 Usage-specific alt text

`ProductImage.altText` is optional and usage-specific.

Fallback:

```text
Product.name
```

Caption metadata is deferred until a genuine product/Admin UX requirement exists.

---

# 5. Resolved Lifecycle Model

This specification deliberately distinguishes **asset lifecycle** from **processing-run lifecycle**.

## 5.1 ManagedMedia lifecycle semantics

```text
PENDING
PROCESSING
READY
CLEANUP_PENDING
DELETING
DELETED
FAILED
```

### PENDING

A durable logical ingest identity exists, but initial canonical media has not been successfully finalized.

### PROCESSING

Used only when the asset has no valid active complete processing run yet and the **initial ingest** is actively being processed.

### READY

The asset has a valid active COMPLETE processing run and is technically delivery-capable under normal policy. READY does not mean currently referenced, and an orthogonal `deliveryDisabledAt` suspension may still block customer delivery/attachment without changing the lifecycle state.

A future v2 profile may be PROCESSING while ManagedMedia remains READY on v1.

### CLEANUP_PENDING

The asset is fully processed, currently unreferenced, and inside a safety/grace period.

It is normally attachable during grace **only when `deliveryDisabledAt IS NULL`**.

```text
CLEANUP_PENDING + valid attachment transaction
→ READY
```

### DELETING

The final grace condition and authoritative zero-reference check have succeeded atomically and the media has been deletion-claimed.

This is the **non-attachable point of no return**.

### DELETED

All owned physical objects have reached the desired absent state. ManagedMedia remains a tombstone; it is never attachable or reusable.

### FAILED

Asset-level initial ingest/lifecycle/cleanup could not safely complete. The detailed processing failure belongs to the corresponding MediaProcessingRun when relevant.

## 5.2 MediaProcessingRun lifecycle

```text
PENDING
PROCESSING
COMPLETE
FAILED
```

One run is uniquely identified by:

```text
ManagedMedia + profileVersion
```

Retries belong to the same run. Material processing-policy changes require a new profile version.

### First ingest

```text
ManagedMedia PENDING
ProcessingRun PENDING

→ claim

ManagedMedia PROCESSING
ProcessingRun PROCESSING

→ success

ProcessingRun COMPLETE
ManagedMedia READY or CLEANUP_PENDING
```

### Future regeneration

```text
ManagedMedia READY
active run = v1 COMPLETE

v2 run = PROCESSING
```

ManagedMedia remains READY because v1 is healthy.

If v2 fails:

```text
v2 = FAILED
v1 remains active
ManagedMedia remains READY
```

A COMPLETE run does **not** become active automatically.

## 5.3 Failure authority

Failure facts must not drift between tables.

### MediaProcessingRun failure fields
Own detailed processing/profile execution failures:

- decode/processing-stage operational failure;
- encoder failure;
- processing storage-write failure;
- profile-definition mismatch;
- processing retry state.

### ManagedMedia failure fields
Own asset-level ingest/lifecycle/cleanup failures or a safe summary of initial-ingest terminal failure:

- staging/ingest lifecycle failure;
- initial asset cannot become usable because its first run failed;
- cleanup failure;
- other asset-level lifecycle terminal state.

The same detailed failure is not independently authoritative in both places.

For a retryable **initial** processing failure where no active COMPLETE run exists, a claimed retry may transition the same initial ProcessingRun from FAILED back to PROCESSING and the ManagedMedia asset-level state from FAILED back to PROCESSING. Non-retryable invalid input remains FAILED and requires Admin re-upload. A failed future regeneration never changes a healthy READY ManagedMedia asset to FAILED.

## 5.4 Cleanup semantics

Attachment truth is derived from explicit owner relations, not from `isAttached` or `referenceCount`.

First implementation owner relation:

```text
ProductImage.managedMediaId
```

Future approved owner surfaces add explicit relational checkers as they adopt ManagedMedia.

Normal detach flow:

```text
owner relation removed
→ authoritative owner check
→ zero references
→ CLEANUP_PENDING
→ configurable grace period
→ final owner check
→ DELETING
→ physical deletion
→ DELETED
```

Initial grace candidate: **7 days**, configurable and not a permanent invariant.

## 5.5 Canonical master vs delivery profile lifecycle

The retained canonical master is logically independent from whichever delivery processing run is currently ACTIVE.

The initial ingest run creates the canonical MASTER and first delivery rendition set. Future ordinary delivery-profile runs consume the retained canonical master and are rendition-generation runs; they are not required to create another MASTER. `ManagedMedia` retains an explicit `canonicalMasterObjectId` pointing to the approved MASTER MediaObject. Future delivery-profile regeneration normally reads that canonical master and creates a new rendition set; it does **not** duplicate or replace the master merely because WebP/AVIF widths or encoder settings changed.

Therefore a healthy asset may be:

```text
canonical master → object created by initial ingest run
active delivery run → v1 COMPLETE
new delivery run → v2 PROCESSING
```

If a future design intentionally changes canonical-master normalization itself, master replacement is a separate guarded operation: generate/verify a new high-quality master, atomically switch `canonicalMasterObjectId`, preserve the prior master through a rollback window, then defer old-master cleanup. It must never occur implicitly as a side effect of ordinary rendition-profile activation.

Three destructive workflows are explicitly distinct:

1. **Delivery-profile cleanup** may remove only obsolete `PUBLIC_DELIVERY` / `RENDITION` MediaObjects from an inactive processing run after its rollback/cache-safety window. It must never delete the MediaObject referenced by `ManagedMedia.canonicalMasterObjectId`, even when that canonical master was created by the same initial run whose v1 delivery renditions are now obsolete. After such cleanup, the historical ProcessingRun may remain `COMPLETE` for audit/history, but it is no longer activatable unless its required public output inventory is still complete.
2. **ManagedMedia full cleanup** occurs only after the normal lifecycle reaches `DELETING`. It may then remove the canonical master, remaining renditions, and recoverable staging through the approved idempotent cleanup process.
3. **Canonical-master replacement** is a separately guarded workflow. Only after a verified replacement master is atomically installed as `canonicalMasterObjectId` and the rollback window expires may the previous master become eligible for its own explicit cleanup. Generic old-profile cleanup is never allowed to delete a canonical master.

Dedicated regression coverage must prove the critical case: initial v1 run contains MASTER + v1 renditions → v2 becomes COMPLETE and ACTIVE → inactive-v1 delivery cleanup removes eligible v1 `PUBLIC_DELIVERY` renditions → the original canonical MASTER remains physically intact, not tombstoned, and `canonicalMasterObjectId` remains valid.

The canonical-master pointer must reference a `MASTER` / `PRIVATE_SOURCE` object created by a ProcessingRun belonging to the same ManagedMedia. This is enforced by the application transaction and integration tests; no trigger is introduced.

## 5.6 Emergency takedown and durable delivery suspension

Emergency public-delivery suspension is orthogonal to normal lifecycle. It does **not** add another value to `PENDING / PROCESSING / READY / CLEANUP_PENDING / DELETING / DELETED / FAILED`.

Phase 6 therefore locks one minimal durable orthogonal guard:

```text
ManagedMedia.deliveryDisabledAt?
```

Semantics:

```text
deliveryDisabledAt IS NULL
→ normal lifecycle/delivery rules apply

deliveryDisabledAt IS NOT NULL
→ media cannot be newly attached
→ CLEANUP_PENDING is not attachable while suspended
→ no processing run may be activated as customer-deliverable for that media
→ public managed-media DTO assembly must not expose it as normally available
→ canonical PRIVATE master may remain retained
→ normal ownership/cleanup lifecycle continues independently
```

A privileged emergency takedown establishes the durable suspension **before** relying on relationship removal or CDN actions. It then removes/disables storefront ownership as required and performs exceptional purge/revocation of public renditions where immediate takedown is necessary. This closes the gap where a merely unreferenced `CLEANUP_PENDING` asset would otherwise remain attachable.

A privileged reviewed recovery action may clear `deliveryDisabledAt` only after confirming the media is safe and not `DELETING`/`DELETED`, and that a complete valid customer-delivery profile is available. If emergency hard removal physically deleted/tombstoned public renditions, recovery must generate/activate a complete new immutable delivery set before clearing the suspension; deleted immutable object keys are never reused.

---

# 6. Processing and Quality Policy

## 6.1 Supported input policy

Required Phase-6 launch inputs:

- JPEG/JPG;
- PNG;
- still WebP.

Capability-gated optional input:

- still SDR AVIF.

AVIF input is not a Phase-6 completion blocker.

Rejected ProductImage inputs:

- SVG;
- GIF;
- animated WebP;
- animated AVIF;
- APNG/multipage/animated raster formats.

ProductImage remains still-raster specific.

## 6.2 Security validation sequence

A managed upload must pass:

```text
Admin authentication/authorization
→ earliest practical request admission
→ per-file size limit
→ declared MIME allow-list
→ signature/sniff validation
→ server-derived SHA-256
→ real image decode
→ actual format agreement
→ single-frame validation
→ dimension/pixel/resource limits
→ orientation/color/metadata processing
```

MIME/signature checks without real decode are insufficient.

## 6.3 Initial upload-size baseline

The current approximately **5 MB maximum file size remains the initial security baseline**.

It may be increased only after representative premium-source fixtures demonstrate that legitimate quality is being rejected. Any increase must be the smallest evidence-backed change; an 8 MB-class limit may be considered if justified.

The upload limit is an ingestion/security limit, not a customer-delivery target.

## 6.4 Decode limits

Hard rule:

> **Decode is always bounded.**

Initial benchmark candidates, not permanent invariants:

```text
40 MP maximum decoded pixels
12,000 px maximum input axis
```

These values must be benchmarked against the intended deployment CPU/RAM/runtime before implementation lock.

## 6.5 Canonical master

Raw Admin upload bytes are temporary staging input.

Preferred conceptual pipeline:

```text
raw upload
→ validate/decode
→ orientation normalization
→ privacy/unnecessary metadata sanitation
→ controlled color normalization
→ HIGH-QUALITY CANONICAL MASTER
→ responsive renditions
→ READY DB finalization
→ staging cleanup
```

The canonical master:

- preserves premium source quality and future reprocessing capability;
- preserves color fidelity and necessary transparency;
- is not aggressively compressed;
- is not unnecessarily downscaled;
- is never upscaled;
- is never normal storefront delivery.

### Master encoding is not yet locked

Before `product-image-v1` is finalized, representative benchmarks must compare at minimum:

- lossless WebP;
- PNG where transparency/graphics genuinely justify it;
- another normalized visually lossless/high-fidelity strategy if technically justified.

The selected master policy must demonstrate:

```text
no visible degradation
+ future reprocessing capability
+ color fidelity
+ no destructive generational compression
+ safe sanitation
+ reasonable storage amplification
```

## 6.6 Master dimensions

Initial calibration candidate:

```text
maximum long edge ≈ 5120 px
maximum canonical master ≈ 24 MP
```

These are benchmark values only.

No upscaling is a hard invariant.

## 6.7 Color management

Color fidelity is a hard commercial requirement.

The pipeline must:

```text
read source color information
→ controlled conversion
→ consistent web-delivery color space
→ remove only unnecessary/private metadata
```

It must not blindly strip ICC/profile information in a way that materially changes product color.

Profile v1 is expected to target consistent SDR web delivery, typically sRGB, after verified color management.

If HDR/wide-gamut content cannot be normalized safely under the approved profile, fail clearly rather than silently altering appearance.

## 6.8 Transparency

Preserve transparency when source content requires it. Do not flatten transparent product assets merely to save bytes. Halo artifacts around transparent edges are quality failures.

## 6.9 Resizing

Hard rules:

- preserve aspect ratio;
- no automatic crop;
- no stretching;
- no generative/upscale processing;
- high-quality downsampling;
- do not generate renditions larger than the canonical master.

Lanczos3-class downsampling is the initial quality candidate, subject to implementation validation.

Low-resolution sources remain low-resolution; the system does not invent detail.

## 6.10 Responsive rendition ladder

Initial `product-image-v1` calibration:

```text
320
640
960
1280
1600
2048
```

Generate only useful widths `<= canonical master width` and avoid nearly redundant terminal outputs.

Example:

```text
master = 1500px
→ 320, 640, 960, 1280, 1500
```

Semantic role mapping is a UI/delivery selection concern; physical rendition files use a shared width ladder to avoid duplicate role-specific bytes.

## 6.11 Delivery formats

Managed customer delivery baseline:

```text
WebP = mandatory modern fallback/baseline
AVIF = preferred enhanced source where stable
```

AVIF **delivery** is conditional on the selected processing/deployment environment proving stable, safe encoding and passing the full visual/color/network acceptance matrix. If that environment cannot provide AVIF delivery safely or reliably, Phase 6 may complete with the mandatory responsive WebP baseline, provided every other Phase-6 acceptance dimension passes and the AVIF-disabled decision/evidence is recorded. If AVIF delivery is enabled, it is fully acceptance-gated and receives no quality exemption merely because it is an enhanced format.

The decision is finalized in the **processing profile definition**, not silently varied per job/environment after a profile is pinned. Output formats are part of profile semantics. Therefore:

- if benchmark/capability evidence disables AVIF before `product-image-v1` is locked, that concrete v1 definition excludes AVIF and WebP is its required delivery inventory;
- if a pinned profile includes AVIF, its required AVIF variants must be generated/verified for that run to become COMPLETE/active;
- enabling AVIF later is a material processing-policy change and uses a new processing-profile version rather than silently changing the meaning of the existing version.

Do not generate JPEG/PNG at every width without a demonstrated support requirement.

Initial encoder calibration, not release thresholds:

```text
WebP quality ≈ 88
AVIF quality ≈ 65
```

If visual QA shows blur, banding, texture loss, packaging-text loss, or color shift, increase quality/change profile even if files become larger.

There is no universal ProductCard/detail KB release limit.

## 6.12 Browser-native responsive selection

Delivery uses:

```text
<picture>
+ srcset
+ sizes
```

or a framework-equivalent implementation preserving native browser selection.

Do not manually choose DPR-specific URLs in React.

ProductCard/card layouts expose only relevant card candidates; Product Detail exposes larger approved candidates. Canonical master is absent from all normal storefront source sets.

## 6.13 Loading policy

Preserve existing bounded/lazy gallery behavior:

- primary/current image prioritized;
- secondary gallery images structurally lazy;
- no eager preload of all four images;
- only a bounded number of genuine above-fold/LCP images may receive eager/high priority.

An optional limited next-slide prefetch is allowed only if browser evidence justifies it.

## 6.14 Processing execution model

Hard rule:

> **Processing execution must be durable, bounded, and recoverable.**

Preferred simplest first option:

```text
bounded synchronous request processing
```

**only if deployment benchmarks prove it safely fits** the real runtime envelope for representative and worst-accepted images, including WebP/AVIF generation and storage writes.

If not safe:

```text
brokerless durable DB-backed processing execution
```

is preferred before introducing Redis/BullMQ/SQS/Kafka.

The ManagedMedia/service contracts do not change between these execution modes.

---

# 7. Processing Profile Versioning

## 7.1 Profile identity

Application-owned profile example:

```text
product-image-v1
```

It defines the processing semantics:

- accepted input policy;
- master normalization;
- color policy;
- width ladder;
- output formats;
- encoder settings;
- resize policy;
- metadata policy.

Provider endpoints, credentials, bucket names, CDN domains, or environment-specific storage values are **not** part of the processing profile.

## 7.2 Canonical profile hash

Each MediaProcessingRun persists:

```text
profileVersion
profileDefinitionHash
```

The hash is generated from a deterministic canonical representation with fixed key ordering/types/normalization. Environment values and unrelated runtime configuration are excluded.

If current code's definition for `product-image-v1` no longer hashes to the stored definition:

```text
fail closed
→ do not reinterpret existing/in-flight v1 work
→ create product-image-v2 for material semantic changes
```

## 7.3 Profile regeneration and activation

Example:

```text
v1 COMPLETE + ACTIVE
v2 PROCESSING
```

ManagedMedia remains READY on v1.

When v2 becomes COMPLETE it is **not automatically active**.

Each profile definition also carries an application-owned **compatibility selection policy** (exact target width/format remains calibration). The policy deterministically selects one actually generated PUBLIC_DELIVERY rendition from that run for legacy compatibility mirrors; it must handle narrow source images without referring to a nonexistent fixed width.

Activation transaction must verify:

- run belongs to the same ManagedMedia;
- run is COMPLETE;
- required output inventory is complete;
- required objects are not marked deleted;
- profile/hash is valid;
- `ManagedMedia.deliveryDisabledAt IS NULL` before the run can become customer-deliverable.

Then, in the same database transaction, the service:

- changes `ManagedMedia.activeProcessingRunId`;
- deterministically selects the approved compatibility rendition from the activated run using the profile's compatibility selection policy and derives its URL;
- refreshes every MANAGED `ProductImage.url` referencing that ManagedMedia;
- refreshes `Product.image` for each affected Product whose first ordered ProductImage uses that ManagedMedia.

This keeps compatibility mirrors synchronized without making them authoritative. Public managed-media DTOs still resolve from ManagedMedia + active run, not from the mirrors.

Old v1 objects remain through a rollback/cache-safety window and are cleaned later through an explicit operations policy. Activation never performs immediate old-profile physical deletion. **Ordinary old-profile cleanup is rendition-only:** it may delete obsolete inactive-run `PUBLIC_DELIVERY` objects, but it must explicitly exclude the current `canonicalMasterObjectId` and must not perform canonical-master replacement/full-asset cleanup semantics.

---

# 8. Storage and CDN Architecture

## 8.1 Access classes

Hard application-level security classes:

```text
PRIVATE_SOURCE
PUBLIC_DELIVERY
```

`PRIVATE_SOURCE` contains canonical masters and temporary private staging infrastructure.

`PUBLIC_DELIVERY` contains approved immutable customer-facing renditions only.

For R2, separate private and delivery buckets are the preferred mapping, but "exactly two buckets" is not a universal domain invariant. Other providers may use equivalent isolation through private origin/CDN controls or namespaces.

## 8.2 MediaStorage interface

Conceptual responsibilities:

```text
putImmutable
headObject
getObject            privileged/internal only
deleteObject
```

`putImmutable` semantics:

```text
object absent
→ create

same immutable identity + matching expected content
→ idempotent success

same immutable identity + different content
→ INTEGRITY_MISMATCH / hard conflict
→ never silently overwrite
```

`deleteObject` semantics:

```text
object exists
→ delete

object already absent
→ idempotent success
```

Provider-specific conditional semantics vary; the adapter contract, not assumptions about universal S3 behavior, defines required application behavior.

## 8.3 Required adapters

- `InMemoryMediaStorage` — deterministic unit/domain testing.
- `LocalMediaStorage` — development/demo; must model production semantics where practical.
- `S3CompatibleMediaStorage` — production adapter.

LocalMediaStorage must preserve:

- provider-neutral keys;
- immutable-put behavior;
- HEAD/existence behavior;
- idempotent deletion;
- private/public access separation;
- typed failures.

Canonical masters must never be stored under a web-public local directory.

## 8.4 Production provider

Cloudflare R2 is the leading first production candidate **through `S3CompatibleMediaStorage`**.

R2 is not a domain dependency.

Immediately before provisioning, revalidate:

- current pricing;
- required S3-compatible operations;
- custom-domain behavior;
- DNS/deployment compatibility;
- account/operational ownership;
- credential/permission model.

If R2 is no longer suitable, another approved S3-compatible backend may be selected without changing Product/Admin/UI/domain contracts.

## 8.5 Provider keys

Database stores stable non-secret configuration identifiers such as:

```text
storageProviderKey
stagingProviderKey
```

A provider key identifies one immutable logical backend identity. It must never be silently repointed from one physical backend to another while MediaObjects depend on its prior meaning.

A provider migration introduces a new backend identity.

Provider keys do not contain credentials.

## 8.6 Environment isolation

Environment boundaries are structural:

```text
development → dev/local provider keys
staging/test → isolated test provider keys/namespaces
production → production provider keys
```

Startup/configuration should fail closed when an environment is connected to an unauthorized provider key. Test cleanup must never be able to operate on production media.

## 8.7 Object keys

Durable object keys are application-controlled and provider-neutral.

They may encode:

- ManagedMedia identity indirectly through processing-run/media identity;
- processing profile;
- variant;
- content identity/hash where useful.

They must not encode:

- R2/AWS/vendor names;
- bucket/account IDs;
- Product names;
- user filenames;
- customer/Admin PII.

The same immutable keys should be portable between providers where practical.

## 8.8 Delivery URL resolution

Public delivery URL is derived deterministically from:

```text
approved PUBLIC_DELIVERY MediaObject
+ configured delivery resolver
```

Customer-facing DTO assembly must additionally require `ManagedMedia.deliveryDisabledAt IS NULL`. A suspended asset is not emitted as normally customer-deliverable even if an owner relation temporarily remains during an emergency takedown sequence. The delivery resolver itself does not perform lifecycle queries; the application read-mapping boundary supplies only approved delivery-enabled objects.

No provider API/HEAD call is needed to resolve a URL.

Preferred customer-facing form:

```text
https://<Pure-Haven-controlled-media-host>/managed-media/...
```

The exact hostname is deployment configuration.

Provider migration must not require ProductCard/ProductImage/domain redesign.

## 8.9 CDN/direct delivery

Production/real object-storage flow:

```text
Browser
→ Pure Haven media/CDN endpoint
→ CDN cache
→ object storage on cache miss
```

Normal public rendition GET must not require:

- Next.js route handler;
- Prisma;
- PostgreSQL;
- ManagedMedia query;
- Product query;
- application storage-SDK call.

**Local development exception:** LocalMediaStorage may use an approved development-serving mechanism. The direct-CDN rule applies to production/real object-storage acceptance.

## 8.10 Cache policy

Public rendition URLs are immutable/profile-versioned. A long-lived policy equivalent to:

```http
Cache-Control: public, max-age=31536000, immutable
```

is approved.

New bytes require a new immutable identity/URL. CDN purge is exceptional, not normal replacement behavior.

## 8.11 Private master access

Canonical masters must never appear in:

- ProductImage.url;
- Product.image;
- ProductCard markup/srcset;
- Product Detail markup/srcset;
- public catalog DTO/customer APIs;
- normal Admin preview responses;
- public media hostname;
- anonymous GET paths.

Master access is server-side only for authorized reprocessing, integrity verification, provider migration, and approved operations.

A private-master leak is a Phase-6 release blocker.

---

# 9. Persistence Model

The final persistence foundation consists of:

```text
ManagedMedia
MediaProcessingRun
MediaObject
ProductImage (extended)
```

## 9.1 Resolved MediaObject ownership decision

**Decision: eliminate redundant `managedMediaId` from MediaObject.**

MediaObject belongs only to MediaProcessingRun:

```text
MediaObject
→ MediaProcessingRun
→ ManagedMedia
```

Rationale:

- eliminates contradictory duplicated ownership facts;
- one extra relational join is acceptable because MediaObject inventory/cleanup is not the public hot path;
- normal catalog reads use assembled managed-media/rendition metadata and never provider lookups;
- correctness is more valuable than a speculative cleanup-query micro-optimization.

If future query-plan evidence demonstrates a real need, a denormalized ownership field may be reconsidered only with DB-enforced consistency.

## 9.2 Conceptual ManagedMedia fields

```text
id                         UUID PK
mediaType                  IMAGE initially
lifecycleState

ingestPurpose              PRODUCT_IMAGE initially
ingestActorScope           stable authenticated internal actor identity
ingestIdempotencyKey
ingestSha256               server-derived SHA-256 of received bytes
ingestByteSize
ingestMimeType
originalFilename?          optional, sanitized, bounded
sourceWidth?
sourceHeight?

stagingProviderKey
stagingObjectKey
stagingState

activeProcessingRunId?
canonicalMasterObjectId?
deliveryDisabledAt?          orthogonal durable customer-delivery/attachment suspension

unreferencedAt?
cleanupEligibleAt?
cleanupAttemptCount
cleanupLastAttemptAt?

failurePhase?
failureCode?               bounded machine-readable code

deletedAt?
createdAt
updatedAt
```

### Staging semantics

`stagingProviderKey` and `stagingObjectKey` remain durable/non-null once ManagedMedia is allocated. Null does not ambiguously mean "never created" vs "deleted".

`stagingState` carries meaning:

```text
ALLOCATED     locator allocated; physical object may not yet exist
PRESENT       staging object verified present
CLEANUP_PENDING
DELETED       desired absent state reached
```

If ingest fails before staging creation, state remains `ALLOCATED` or transitions according to failure lifecycle; the deterministic key allows reconciliation to HEAD/verify whether storage actually occurred.

### Delivery-suspension semantics

`deliveryDisabledAt` is nullable but semantically unambiguous:

- `NULL` means the media is not delivery-suspended; normal lifecycle/attachability rules apply.
- non-null means a privileged emergency/review action has suspended new attachment and customer delivery independently of lifecycle state.

It is not an ownership counter, not a replacement lifecycle state, and not physical-deletion authority. No index is required initially unless measured operational/query evidence justifies one. Application-service transactions enforce attachment/profile-activation/public-DTO guards.

## 9.3 Conceptual MediaProcessingRun fields

```text
id
managedMediaId              FK → ManagedMedia
profileVersion
profileDefinitionHash
state                       PENDING | PROCESSING | COMPLETE | FAILED
attemptCount
startedAt?
lastHeartbeatAt?
leaseExpiresAt?
failurePhase?
failureCode?
completedAt?
createdAt
updatedAt
```

Unique:

```text
(managedMediaId, profileVersion)
```

## 9.4 Conceptual MediaObject fields

```text
id
processingRunId             FK → MediaProcessingRun
role                        MASTER | RENDITION
accessClass                 PRIVATE_SOURCE | PUBLIC_DELIVERY
variantKey
storageProviderKey
objectKey
mimeType
width
height
byteSize                    PostgreSQL/Prisma BigInt
checksumSha256
verifiedAt?
deletedAt?
createdAt
updatedAt
```

Unique:

```text
(processingRunId, variantKey)
(storageProviderKey, objectKey)
```

Tombstoned MediaObject rows retain their immutable identity and object key after physical deletion. Keys are never recycled for new bytes.

### Role/access-class DB invariant

```text
MASTER    → PRIVATE_SOURCE
RENDITION → PUBLIC_DELIVERY
```

Variant grammar/profile semantics stay in application validation/tests rather than a fragile SQL grammar CHECK.

## 9.5 ProductImage extension

Conceptual fields:

```text
id
productId
sourceKind                  MANAGED | LEGACY_LOCAL | LEGACY_EXTERNAL
managedMediaId?             FK → ManagedMedia, onDelete RESTRICT
url                         required compatibility/reference field
altText?
sortOrder
createdAt
updatedAt
```

Existing unique `(productId, sortOrder)` remains.

Index `managedMediaId` for authoritative ownership checks.

### Source-kind DB invariant

```text
MANAGED
→ managedMediaId IS NOT NULL

LEGACY_LOCAL / LEGACY_EXTERNAL
→ managedMediaId IS NULL
```

Legacy URL checks remain narrow and based on audited real data. Unknown schemes/roots stop migration.

## 9.6 Canonical-master pointer

`ManagedMedia.canonicalMasterObjectId` identifies the one retained canonical source object used for future reprocessing. It is a normal FK to MediaObject.

The application finalization transaction must prove that the referenced object:

- is reachable through a ProcessingRun belonging to the same ManagedMedia;
- has `role = MASTER`;
- has `accessClass = PRIVATE_SOURCE`;
- is not marked deleted.

A simple FK proves existence; the cross-row same-media/role/access rules remain application-service invariants with integration tests rather than triggers. Initial READY finalization requires this pointer. Ordinary delivery-profile regeneration does not change it.

## 9.7 Active processing-run relationship

`ManagedMedia.activeProcessingRunId` has a normal FK to a real MediaProcessingRun.

**Resolved DB-strengthening decision:** do not introduce a cyclic/composite active-run FK or trigger in the initial schema. The stronger "run belongs to same ManagedMedia and is COMPLETE" rule is enforced transactionally by the profile-activation application service and dedicated integration tests.

Rationale:

- avoids a brittle circular/composite ORM relation for a condition that also requires run-state and inventory validation;
- a composite FK alone still cannot prove `COMPLETE` or output completeness;
- the activation transaction already must perform those checks atomically;
- no trigger is introduced.

This remains an explicit application-service invariant, not an accidental omission.

## 9.8 BigInt DTO handling

Byte-size fields may remain `BigInt` in persistence. Any API/DTO exposure converts them explicitly to a JSON-safe representation, such as a bounded number when guaranteed safe or a decimal string according to the formal API contract. Raw Prisma BigInt values must never be blindly JSON-serialized.

## 9.9 Narrow database CHECK constraints

Use PostgreSQL CHECK constraints for stable row-local facts such as:

- ProductImage source-kind/managedMediaId consistency;
- audited legacy URL-class sanity;
- MASTER/RENDITION access-class consistency;
- DELETED requires `deletedAt`;
- CLEANUP_PENDING requires cleanup timestamps;
- FAILED requires safe failure classification;
- ProcessingRun COMPLETE requires `completedAt`;
- ProcessingRun PROCESSING requires lease information;
- width/height/byteSize positive;
- SHA-256 shape where practical.

Do not encode the full lifecycle graph, owner queries, provider availability, active-profile completeness, or Product.image synchronization in triggers/giant constraints.

## 9.10 Indexes

Initial justified index set:

```text
ProductImage(managedMediaId)

ManagedMedia(lifecycleState, cleanupEligibleAt)
ManagedMedia(lifecycleState, updatedAt)
UNIQUE(ingestActorScope, ingestPurpose, ingestIdempotencyKey)

MediaProcessingRun(state, leaseExpiresAt)
MediaProcessingRun(managedMediaId, state)
UNIQUE(managedMediaId, profileVersion)

UNIQUE(MediaObject.processingRunId, variantKey)
UNIQUE(MediaObject.storageProviderKey, objectKey)
INDEX(MediaObject.processingRunId)
```

Implementation rehearsal must inspect representative PostgreSQL query plans before adding speculative indexes.

---

# 10. Application Services and API Boundaries

## 10.1 Service boundaries

### MediaIngestService

- authorization/admission;
- scoped idempotency;
- PENDING creation;
- staging orchestration;
- initial processing execution orchestration.

### ImageProcessingService

- real decode;
- security/image validation;
- normalization;
- canonical master generation;
- rendition generation;
- profile semantics.

### ProductMediaAttachmentService

- structured gallery validation;
- attach/detach managed media;
- legacy relational identity handling;
- ProductImage.url compatibility derivation;
- Product.image synchronization.

### MediaLifecycleService

- authoritative owner checks;
- cleanup hints;
- grace/eligibility;
- deletion claims;
- physical cleanup orchestration.

### MediaReconciliationService

- stale PENDING/PROCESSING recovery;
- partial-output recovery;
- orphan-state repair;
- cleanup retry;
- staging cleanup;
- eventual convergence.

## 10.2 Product-first ingestion endpoint

A dedicated managed-media ingestion boundary is introduced conceptually:

```text
POST /api/media/uploads
purpose = PRODUCT_IMAGE
```

Exact route naming is finalized during implementation planning.

It ingests/processes media only. It does **not** create/reorder ProductImage or replace product business mutation APIs.

Existing `/api/upload` remains a legacy upload boundary for unmigrated non-product surfaces during the first product-first increment. It is not silently changed for every existing caller.

## 10.3 Product mutation authority

Existing:

```text
PUT /api/products
```

remains the sole product/gallery business mutation boundary.

Existing semantics remain conceptually preserved:

- authoritative gallery replacement;
- server-authoritative ProductImage ordering;
- Product.image mirror synchronization;
- metadata-only product updates leave gallery untouched.

## 10.4 New structured gallery identity

New Admin editor structured payload uses relational identity:

```text
new managed item
→ managedMediaId

existing legacy item
→ existing ProductImage.id
```

The server proves that a legacy ProductImage ID:

- belongs to the target Product;
- has `LEGACY_LOCAL` or `LEGACY_EXTERNAL` source kind.

The new contract does not identify legacy rows by arbitrary submitted URL.

Legacy `images: string[]` parsing may remain temporarily only where genuinely required for compatibility. It must not become a backdoor for new arbitrary external media creation.

## 10.5 Legacy `image:` compatibility

The legacy primary `image:` field remains narrowly supported only where required by genuine legacy behavior.

Once a product has a managed gallery, direct independent `image:` mutation cannot override:

```text
ManagedMedia
→ ProductImage.url
→ Product.image
```

The formal API contract must explicitly define accepted/rejected compatibility cases.

---

# 11. Ingestion and Cross-System Orchestration

## 11.1 Scoped idempotency

Uniqueness authority:

```text
stable authenticated Admin actor ID
+ PRODUCT_IMAGE purpose
+ idempotency key
```

The actor scope is server-derived from the verified existing Admin auth/audit domain, never from mutable display name/email/client input when a stable internal ID exists.

The database unique constraint, not SELECT-then-INSERT, guarantees one creator.

### Same-key concurrent request semantics

When a second request finds an existing scoped operation whose server-derived content fingerprint is not yet established, it does **not** start an independent byte stream or assume content equality.

The existing operation owns the ingest stream. The second request returns/resumes that operation's durable state through a bounded protocol; it cannot upload different bytes under the same scoped key while fingerprint establishment is in progress. Once the first operation's server-derived SHA-256 is known:

```text
same key + same actual SHA-256
→ same logical operation

same key + different actual SHA-256
→ conflict
```

A client checksum may be a hint only.

## 11.2 Durable PENDING before managed storage

After preliminary admission and scoped idempotency allocation:

```text
DB creates PENDING ManagedMedia
+ deterministic staging locator
+ pinned initial ProcessingRun/profile
```

before the durable managed staging write.

If DB identity creation fails, no managed storage write occurs.

## 11.3 Deterministic private staging

Staging key derives from durable application identity. The reconciler can reconstruct it after process failure.

Crash example:

```text
staging write succeeds
→ DB stagingState update fails
```

Recovery:

```text
reconciler knows deterministic key
→ HEAD object
→ verify SHA/size where available
→ reconcile state
```

Staging is not MediaObject.

## 11.4 Processing and immutable output writes

Initial processing run is pinned before processing starts.

Expected output set is deterministic from:

```text
ManagedMedia ID
+ profileVersion/profile hash
+ variant identities
+ deterministic object-key policy
+ private staging source
```

Partial output does not become READY.

If an expected immutable object exists with different bytes/checksum:

```text
INTEGRITY_MISMATCH
→ fail closed
→ never overwrite silently
```

## 11.5 READY finalization

Object writes occur before final DB READY commit because object storage and PostgreSQL cannot share one atomic transaction.

The DB finalization transaction verifies/persists:

- processing run still valid;
- expected logical MediaObject inventory complete;
- canonical master metadata;
- required renditions;
- profile/hash validity;
- run completion;
- canonicalMasterObjectId pointing to the verified MASTER;
- initial active-processing-run authority;
- ManagedMedia READY state/failure cleanup.

Only then may staging become cleanup-eligible.

## 11.6 Storage succeeds but DB finalization fails

ManagedMedia remains non-READY/PROCESSING. Deterministic immutable objects and private staging remain recoverable.

Reconciliation:

```text
load pinned processing profile
→ determine expected outputs
→ HEAD/verify existing immutable objects
→ persist/rebuild missing metadata/output safely
→ retry finalization
```

No invisible orphan object is accepted as final state.

## 11.7 READY but unattached

A newly processed upload has zero ProductImage references.

It enters:

```text
CLEANUP_PENDING
```

with configurable grace timing.

If Admin attaches it during grace, attachment transaction changes it back to READY.

## 11.8 Product attachment transaction

The Product PUT transaction must revalidate attachability **inside the same transactional decision**.

Allowed only when `deliveryDisabledAt IS NULL`:

```text
READY
CLEANUP_PENDING + complete active profile + not deletion-claimed
```

Rejected:

```text
PENDING
PROCESSING
FAILED
DELETING
DELETED
ANY otherwise attachable state with deliveryDisabledAt IS NOT NULL
```

The transaction:

- validates desired 1–4 ordered gallery;
- rejects duplicate managed-media identity within the same Product gallery, preserving the existing no-duplicate gallery semantic;
- loads/validates existing legacy ProductImage IDs;
- validates managed IDs and attachability;
- moves CLEANUP_PENDING managed media to READY when attached;
- replaces/reorders ProductImage rows;
- derives MANAGED compatibility URLs server-side;
- updates `Product.image` from first ordered ProductImage;
- checks detached managed-media ownership;
- marks newly zero-reference managed assets CLEANUP_PENDING.

No physical object deletion occurs inside this transaction.

## 11.9 Product deletion/cascade

Before Product deletion/cascade removes ProductImage rows, collect affected managed IDs inside the application transaction.

After cascade:

```text
re-check explicit owners
→ zero reference → CLEANUP_PENDING
```

No physical media deletion inside Product deletion.

Periodic reconciliation remains the safety net if an immediate hint is missed.

## 11.10 Cleanup claim transaction

Eligibility requires:

```text
state = CLEANUP_PENDING
cleanupEligibleAt <= now
all registered owner relations = 0
no live in-flight processing run that still requires the asset
```

An in-flight processing run is an operational deletion blocker, not an ownership relation. Cleanup defers until the run completes/fails/is safely recovered; this does not introduce `isAttached` or reference-count authority.

The final owner re-check and:

```text
CLEANUP_PENDING → DELETING
```

occur atomically in PostgreSQL.

Only after commit may physical deletion begin.

## 11.11 Partial cleanup failure

Physical deletion is idempotent. Missing objects count as the desired absent state.

If some object deletions succeed and another fails:

```text
ManagedMedia = FAILED
failurePhase = CLEANUP
```

Retry:

```text
FAILED(CLEANUP) → DELETING
```

and reissues deletion safely. Already absent objects remain successful.

## 11.12 Legacy deletion safety

MediaLifecycleService accepts ManagedMedia identity only.

Never:

```text
ProductImage.url
→ physical deletion authority
```

Therefore removing LEGACY_LOCAL or LEGACY_EXTERNAL performs zero managed-storage deletion.

---

# 12. Reconciliation and Execution

## 12.1 Reconciliation is required

Normal lifecycle hints improve timeliness; authoritative reconciliation guarantees eventual correctness.

`MediaReconciliationService.runBatch()` handles bounded batches of:

- stale PENDING;
- stale initial PROCESSING;
- recoverable partial outputs;
- READY with zero references but missing cleanup hint;
- CLEANUP_PENDING with restored references;
- cleanup-eligible media;
- FAILED cleanup;
- leftover staging after READY;
- deterministic staging state drift.

## 12.2 Concurrency-safe claiming

Multiple scheduler/worker instances must be safe.

Use PostgreSQL-safe claiming such as:

- row locking / `SKIP LOCKED`; or
- compare-and-set/version-based claiming.

Do not rely on "there will only be one cron."

The exact persistence mechanism is selected during implementation planning/rehearsal.

## 12.3 Processing lease

Initial ProcessingRun must carry enough lease/timing information to distinguish healthy work from abandoned work:

```text
startedAt
lastHeartbeatAt
leaseExpiresAt
attemptCount
```

No PROCESSING run may remain stuck forever.

## 12.4 Scheduler model

Do not use a permanent `setInterval` inside a Next.js web process as durable scheduling infrastructure.

The same reconciliation application service may be invoked by:

- platform cron;
- CLI scheduled command;
- protected internal scheduler;
- later worker if justified.

Initial cadence such as hourly is an operational calibration, not a domain invariant.

## 12.5 No external broker required initially

Redis/BullMQ/SQS/Kafka/RabbitMQ are not Phase-6 completion requirements.

If synchronous processing benchmarks fail, prefer a brokerless DB-backed durable processor/scheduler first.

---

# 13. Security Architecture

## 13.1 Threat model coverage

Phase 6 must explicitly defend against:

- unauthenticated/unauthorized upload;
- oversized request/file abuse;
- MIME spoofing;
- malformed raster payloads;
- decompression bombs/pathological dimensions;
- animated-image abuse;
- SVG active content;
- EXIF/GPS privacy leakage;
- color-profile damage;
- path/object-key manipulation;
- immutable-object overwrite;
- duplicate/replayed requests;
- processing resource exhaustion;
- storage/provider credential exposure;
- public master leakage;
- orphan accumulation;
- destructive cleanup races;
- provider failure/integrity mismatch;
- legacy-media accidental deletion.

Antivirus/malware-scanning infrastructure is **not** required unless implementation evidence identifies a concrete need beyond the approved still-raster decode/sanitize/re-encode pipeline.

## 13.2 Authorization

Reuse verified existing Admin/Super Admin/privileged authorization primitives. Do not invent a parallel role system.

Ordinary product editors may perform approved product-image ingestion/attachment.

Higher-risk operations such as provider migration, forced cleanup, emergency purge, or bulk regeneration must map to the strongest suitable existing privilege. If the existing model is insufficient, stop and surface the gap before implementation.

## 13.3 Least-privilege credentials

Normal application media credentials should be scoped only to required object operations and approved namespaces. Higher-privilege list/copy/migration credentials, where needed, should be separate operational credentials.

Provider secrets remain server-side, outside committed files, client bundles, domain rows, and logs.

## 13.4 Future URL-import SSRF reservation

Import-from-URL is not required for first Phase-6 completion.

Its future contract is reserved as an Admin-authorized, HTTPS-only, redirect/DNS-revalidated, private/internal-network-blocking, bounded fetch that feeds the normal ManagedMedia pipeline.

No URL-import fetching/SSRF subsystem is implemented merely because this contract is documented.

---

# 14. Logging, Audit, Metrics, and Operations

## 14.1 Redaction

Never log:

- raw image bytes;
- private master URLs;
- provider secrets;
- signed tokens/URLs;
- Authorization headers;
- sessions/cookies;
- database credentials;
- EXIF GPS/location;
- unredacted provider errors containing infrastructure secrets.

Safe identifiers include ManagedMedia ID, ProcessingRun ID, Product ID, stable internal Admin actor ID, profile version, safe failure code, dimensions, byte size, and duration.

## 14.2 Audit vs telemetry

Reuse existing privileged audit infrastructure only for meaningful actor/business/security state-changing events, such as:

- ingest created;
- media attached/detached;
- retry requested;
- cleanup/deletion claimed/completed;
- profile activated;
- emergency takedown;
- provider cutover.

High-volume technical measurements belong to structured operational telemetry, not the privileged audit log.

## 14.3 Required Phase-6 operational visibility

Enough structured logs/metrics must exist to diagnose:

- ingest attempts/validation failures;
- processing duration/success/failure;
- source/master/rendition bytes;
- rendition count;
- provider write/delete failures;
- integrity mismatches;
- PENDING/PROCESSING backlog and stale work;
- CLEANUP_PENDING/eligible backlog;
- cleanup failures/retries;
- staging leftovers;
- reconciliation repairs.

This is actionable Phase-6 observability, not a full Phase-11 enterprise monitoring platform.

## 14.4 Fail-closed integrity mismatch

Unexpected bytes under an immutable identity cause:

```text
INTEGRITY_MISMATCH
→ no overwrite
→ preserve known-good state
→ operational alert/evidence
```

This applies to retries, reconciliation, immutable puts, and provider migration.

## 14.5 Capacity

Local development/demo must have bounded media roots and safe capacity handling. Test cleanup is constrained to the configured environment root.

Production object-storage consumption/billing/request trends are observable but never optimized by deleting the only high-quality master of active media or visibly damaging product quality.

---

# 15. Disaster Recovery and Provider Migration

## 15.1 Critical recovery assets

Recovery requires:

```text
DATABASE METADATA
+ DURABLE CANONICAL MASTER
+ PROCESSING PROFILE DEFINITIONS
```

Public renditions are reconstructable from canonical master/profile.

PostgreSQL backup alone is insufficient; object storage alone is insufficient for ownership reconstruction.

Always-on active-active cross-cloud replication is not required in Phase 6.

## 15.2 Provider migration

Approved process:

```text
COPY
→ VERIFY
→ CUTOVER
→ SOAK
→ RETIRE
```

Verification includes expected inventory/count, byte size, application SHA-256, relevant MIME metadata, and accessibility of required delivery objects.

Prefer preserving immutable object keys across providers.

ManagedMedia ID, ProductImage ID/order, and processing-profile identity do not change merely because the backend changes.

## 15.3 Rollback-safe cutover

Old provider remains available through a rollback window.

Only after destination verification does the Pure Haven media hostname/CDN origin cut over. If soak evidence fails, revert delivery origin while the old provider remains intact.

Permanent generalized `MediaReplica` modeling is deferred unless active multi-provider redundancy becomes a real requirement.

---

# 16. Migration and Rollout Strategy

Approved rollout:

```text
EXPAND
→ BRIDGE
→ CLASSIFY
→ CONTRACT
→ VERIFY
→ ENABLE MANAGED INGESTION
```

## 16.1 Migration A — EXPAND

Backward-compatible additive changes:

- new media tables/enums;
- nullable `ProductImage.sourceKind` initially;
- nullable `ProductImage.managedMediaId`;
- nullable `ProductImage.altText`;
- additive indexes/FKs;
- ProductImage.url remains required;
- Product.image unchanged.

Managed ingestion remains disabled.

## 16.2 Bridge application

Before final constraints:

- understands old + new schema;
- reads explicit sourceKind when present;
- safely derives temporary legacy kind from URL when sourceKind is null;
- writes explicit classification for compatibility writes;
- understands managedMediaId;
- preserves compatibility URLs;
- keeps managed ingestion disabled initially.

This bridge becomes the **post-CONTRACT rollback floor**.

## 16.3 Migration B — CLASSIFY

Before classification, audit all existing ProductImage URLs and record counts by detected class.

Known historical classes only:

```text
verified approved local roots → LEGACY_LOCAL
https://                     → LEGACY_EXTERNAL
```

Any unknown local root or protocol such as HTTP/data/blob/protocol-relative causes **STOP and investigation**.

Classification changes only sourceKind.

It does not:

- create ManagedMedia;
- move files;
- fetch external media;
- change URL;
- change ProductImage ID/product/order;
- change Product.image.

Backfill is idempotent and guarded, e.g. operates only where `sourceKind IS NULL`.

Required postconditions:

```text
sourceKind NULL = 0
unknown URL class = 0
ProductImage row count unchanged
IDs unchanged
productId unchanged
sortOrder unchanged
url unchanged
Product.image unchanged
historical managedMediaId all NULL
classification-created ManagedMedia rows = 0
```

## 16.4 Migration C — CONTRACT

Only after:

```text
bridge healthy
old writers drained
classification complete
unknown count = 0
```

apply final:

- `sourceKind NOT NULL`;
- source-kind CHECKs;
- MediaObject access CHECKs;
- lifecycle/run row-local CHECKs;
- remaining final integrity constraints.

After CONTRACT, the original URL-only pre-Phase-6 writer is not a supported write rollback target.

## 16.5 VERIFY and ENABLE

Before enabling new managed uploads, verify:

- schema/constraints;
- legacy storefront/Admin behavior;
- mixed managed/legacy behavior in controlled environment;
- compatibility mirrors;
- browser/network behavior;
- lifecycle/reconciliation;
- provider integration.

Then enable managed ingestion through a reversible feature gate.

Disabling the gate stops **new** managed uploads only; existing managed and legacy media continue rendering.

## 16.6 Fresh and upgrade migration rehearsals

Required on disposable/local PostgreSQL:

### Fresh path

```text
empty DB
→ complete committed historical migration chain
→ Phase-6 migrations
→ final schema/constraint verification
```

### Upgrade path

```text
representative pre-Phase-6 DB
→ EXPAND
→ simulated compatibility writes
→ CLASSIFY
→ CONTRACT
→ final data/schema/application tests
```

Do not use `prisma db push` as migration proof.

Raw PostgreSQL CHECK constraints must be inspected/tested directly through database metadata (`pg_constraint`, indexes/catalogs) because final integrity must be proven at PostgreSQL level, not inferred from Prisma schema text alone.

## 16.7 Historical checksum gate

No shared/non-local Phase-6 migration may run until a separate guarded task proves/remediates the existing checksum mismatch.

Required investigation:

1. exact current migration bytes → SHA-256;
2. historical Git versions → SHA-256;
3. explicit BOM form → SHA-256;
4. explicit BOM-stripped form → SHA-256;
5. compare all to Neon recorded checksum;
6. separately verify SQL semantic equivalence;
7. document evidence and approved remediation.

Forbidden speculative actions:

- manual `_prisma_migrations` checksum editing;
- speculative `migrate resolve`;
- rewriting historical SQL;
- reapplying old migration;
- deleting migration history;
- deploying Phase-6 migrations past the unresolved mismatch.

---

# 17. Admin UX Contract

The backend may be sophisticated; ordinary Admin product editing remains simple.

Human-facing states:

```text
Uploading…
Processing…
Ready
Upload failed — Retry
Invalid image — Choose another
```

Do not expose ordinary editors to:

- CLEANUP_PENDING;
- MediaObject terminology;
- processing leases;
- provider endpoints;
- R2/S3 details;
- internal failure phases.

Retryable operational failures may offer `Retry`. Invalid input requires a new image. The Admin editor only submits new managed items once the server reports them attachable.

No Phase-8 visual redesign is included.

---

# 18. Emergency Operations

## 18.1 Feature disable

A reversible managed-ingestion feature gate is required.

When disabled:

```text
new managed uploads → disabled/rejected safely
existing managed media → continues rendering
legacy media → continues rendering
```

## 18.2 Emergency takedown

Exceptional legal/privacy/security/corruption events use the durable orthogonal `ManagedMedia.deliveryDisabledAt` guard rather than distorting the normal lifecycle.

Required sequence:

1. privileged action sets `deliveryDisabledAt` durably, immediately blocking new attachment/profile activation and normal public DTO delivery;
2. remove/disable authorized storefront references as required;
3. verify no approved owner should continue serving the asset;
4. privileged CDN purge of known public renditions where immediate takedown is required;
5. revoke/delete `PUBLIC_DELIVERY` objects if hard removal is required;
6. retain the PRIVATE canonical master unless policy specifically requires its destruction;
7. record privileged audit evidence.

Suspension and normal lifecycle remain independent. A suspended asset may become `CLEANUP_PENDING` after its owners are removed and may later progress through ordinary grace/deletion rules. While suspended it is not attachable, even though `CLEANUP_PENDING` is normally attachable.

Privileged recovery may clear `deliveryDisabledAt` only after safety review and validation that the media has a complete, non-deleted customer-delivery profile and is not `DELETING`/`DELETED`. If hard takedown deleted public objects, recovery requires a new complete immutable delivery set rather than reusing tombstoned object keys. Both suspension and suspension-clear/recovery are privileged audited operations.

Ordinary product editors do not receive suspension-clear or CDN purge privileges.

CDN purge is not the normal replacement mechanism.

---

# 19. Testing and Acceptance

## 19.1 Automated lifecycle/state tests

Cover every legal/illegal ManagedMedia and MediaProcessingRun transition, including:

- initial ingest;
- validation failure;
- processing retry;
- READY;
- CLEANUP_PENDING/re-attach;
- DELETING/DELETED;
- partial cleanup;
- v2 generation while v1 stays active;
- v2 failure while v1 remains active;
- profile activation;
- v1 initial run contains canonical MASTER + v1 renditions → v2 activation → inactive-v1 delivery cleanup removes only eligible PUBLIC_DELIVERY renditions while the canonical MASTER and `canonicalMasterObjectId` remain intact;
- emergency `deliveryDisabledAt` suspension blocks attachment/profile activation/public DTO delivery while leaving normal lifecycle orthogonal, and privileged recovery restores delivery only after required validation.

Hard invariant:

> No valid ProductImage may reference DELETING or DELETED ManagedMedia.

## 19.2 Auth/admission tests

Required:

- unauthorized upload rejected;
- authorization happens before expensive media processing;
- request/file limits;
- MIME/signature mismatch;
- malformed decode;
- animated-format rejection;
- dimension/pixel resource rejection;
- server-derived fingerprint behavior.

## 19.3 Idempotency/race tests

Required:

- same scoped key/same content → one ManagedMedia;
- concurrent same scoped key → one creator;
- second request while fingerprint pending → no second independent ingest;
- same key/different actual content → conflict;
- attach vs cleanup claim;
- attach/profile activation vs emergency delivery suspension;
- two cleanup workers;
- reconciliation vs normal attachment;
- product deletion while another owner remains;
- profile activation vs generation.

## 19.4 Cross-system failure injection

Inject failure at every non-atomic boundary, including:

- PENDING created / staging write fails;
- staging write succeeds / DB state update fails;
- master write succeeds / rendition fails;
- partial rendition set;
- all objects written / DB READY finalization fails;
- READY commits / staging delete fails;
- DELETING commits / storage delete fails;
- some objects deleted / later delete fails.

Every case must prove:

```text
recoverable durable state
+ no false READY
+ no lost identity
+ no invisible permanent orphan
+ idempotent retry/reconciliation
```

## 19.5 Legacy safety tests

Prove:

- LEGACY_LOCAL renders;
- LEGACY_EXTERNAL renders;
- mixed galleries render/order correctly;
- legacy rows retain/reorder/remove by ProductImage identity;
- normal new arbitrary external creation is rejected;
- legacy removal causes zero managed-storage delete calls.

## 19.6 Storage-adapter contract tests

All adapters must share required semantics:

- immutable put new;
- same-content idempotent put;
- conflicting immutable put;
- HEAD existing/missing;
- authorized private GET where required;
- delete existing;
- delete already missing;
- typed provider failures;
- integrity mismatch.

Mocks/in-memory tests do not replace LocalMediaStorage and real isolated S3-compatible provider integration.

## 19.7 Provider N+1 negative test

Normal shop/category/product-detail/catalog assembly must perform:

```text
0 MediaStorage HEAD
0 MediaStorage GET
0 MediaStorage LIST
```

Provider calls are allowed for processing, migration, reconciliation, and diagnostics only.

## 19.8 Private-master leak negative test

Master identity/URL must be absent from:

- ProductImage.url;
- Product.image;
- ProductCard/product detail markup and responsive sources;
- public catalog DTO/API;
- normal Admin preview response;
- public media domain/anonymous paths.

Any master leak blocks Phase 6.

---

# 20. Browser, Visual, and Network QA

## 20.1 Mandatory owner-inspectable matrix

At minimum prepare real browser evidence for:

```text
Mobile:   375 × 667
Tablet:   768 × 1024
Desktop:  1280 × 800
High-DPI: DPR >= 2 where appropriate
```

## 20.2 Representative image fixtures

Include at least:

- normal product photo;
- text-heavy packaging;
- fine texture;
- sharp/high-contrast edges;
- dark/gradient-sensitive image;
- transparent product image;
- color-profile-bearing/shade-sensitive image.

Always compare:

```text
source
vs canonical master
vs WebP rendition
```

If the selected profile/environment enables AVIF delivery, also compare the AVIF rendition through the **same full visual, color-fidelity, responsive-source, and network acceptance matrix**. If AVIF delivery is disabled because benchmark/deployment evidence shows it cannot be provided safely/stably, record that decision/evidence; absence of the disabled optional AVIF path is not a Phase-6 completion failure.

## 20.3 Visual failure conditions

Reject visible:

- softness/blur;
- pixelation;
- macroblocking;
- ringing/halos;
- gradient banding;
- color shift;
- transparency halos;
- lost packaging text;
- lost texture;
- oversharpening;
- aspect-ratio distortion.

For cosmetics, shade/color fidelity is a hard commercial requirement.

## 20.4 Browser network evidence

For representative assets record real:

- source dimensions/bytes;
- master dimensions/bytes/MIME;
- rendition dimensions/bytes/MIME;
- viewport;
- rendered CSS width;
- DPR;
- `currentSrc`;
- `naturalWidth`;
- transferred bytes;
- cache result;
- initial image request count;
- secondary-gallery request timing.

Do not claim responsive delivery merely because `srcset` exists. Prove the browser chose a sensible source.

## 20.5 ProductCard acceptance

Prove:

- master not requested;
- detail-only oversized rendition not normally requested for small card;
- high-DPI card remains genuinely crisp;
- secondary images are not all initially fetched.

## 20.6 Product Detail acceptance

Prove:

- appropriate detail/large rendition selected;
- primary media prioritized appropriately;
- high-DPI detail remains premium;
- master never requested;
- secondary gallery loading remains bounded.

## 20.7 Direct-delivery acceptance

Production/real object-storage environment must prove public rendition GET flow bypasses application/DB.

Local development is not failed merely because LocalMediaStorage uses a development-serving mechanism.

---

# 21. Completion Criteria and Status Model

## 21.1 Five required acceptance dimensions

Phase 6 must pass all five:

### Security

No unauthorized mutation, master leak, provider-secret leak, unbounded decode, legacy deletion authority, or silent immutable overwrite.

### Premium visual quality

Owner/manual + technical evidence confirms crystal-clear, color-faithful, high-DPI product presentation.

### Responsive delivery performance

Real browser evidence confirms appropriately sized modern renditions, bounded gallery loading, material reduction of unnecessary transfer, correct cache behavior, and no master delivery.

### Lifecycle/recovery safety

Abandoned upload, failed product save, crash mid-processing, detach, race, and partial cleanup all converge safely through durable lifecycle/reconciliation.

### Provider/persistence portability

Common adapter tests pass, vendor contracts do not leak into domain/UI, migration rehearsals pass, and provider change does not rewrite product-media business contracts.

## 21.2 Phase 6 IMPLEMENTATION READY

May be declared when:

- implementation is complete;
- disposable/local migration paths are green;
- isolated real-provider integration is green;
- automated/lifecycle/race/security tests are green;
- browser/network QA is green;
- premium visual QA is green;
- code review/secret scans are clean;
- shared rollout may still be intentionally blocked.

This status does **not** imply managed media is live in production.

## 21.3 Phase 6 COMPLETE / LOCKED — preferred Path A

Preferred commercial lock requires:

```text
historical checksum issue resolved/documented
→ shared migration safely deployed
→ selected production provider authorized/configured
→ managed ingestion enabled through controlled rollout
→ live acceptance passes
→ owner manual acceptance
→ commit/push/tag
→ prove HEAD = origin/main = completion tag
→ clean working tree
```

## 21.4 Deferred activation Path B

If external infrastructure prevents Path A and the owner explicitly chooses deferral:

```text
IMPLEMENTATION LOCKED / PRODUCTION ACTIVATION DEFERRED
```

must be the exact status meaning.

It may not imply managed media is live in production.

## 21.5 Approved-spec repository execution gate

After final owner approval and before any Phase-6 **implementation execution**, the exact approved specification artifact must be present in the real repository at:

```text
docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md
```

The repository copy's SHA-256 must equal the final owner-approved artifact SHA-256. Until that equality is proven, the design may be owner-approved but it is **not repository-locked**. This workflow gate does not authorize application/schema/provider/database changes by itself.

---

# 22. Scope Boundary

| Category | Included / Deferred |
|---|---|
| **REQUIRED IN PHASE 6** | ManagedMedia persistence/domain; MediaProcessingRun; MediaObject; ProductImage managed/legacy classification; secure real decode; normalized high-quality master; responsive rendition pipeline; mandatory responsive WebP baseline; AVIF delivery only when the selected environment enables it safely/stably; high-DPI responsive delivery; MediaStorage abstraction; Local/InMemory/S3-compatible adapters; private master/public rendition split; direct production CDN delivery; immutable URLs/cache policy; product-first Admin managed ingest; existing PUT `/api/products` attachment; compatibility mirrors; durable staging; idempotency; reconciliation; grace cleanup; safe deletion; lifecycle/race/failure tests; migration rehearsals; browser/network/visual QA; operational runbook; historical checksum investigation before shared migration. |
| **DEFERRED TO PHASE 7** | Whole-site LCP optimization beyond media foundation; INP; CLS; TTFB; JS bundle size; React rendering; API latency; DB latency; broad query/performance tuning; sitewide caching; full production load engineering; total transfer budget and third-party performance. |
| **FUTURE OPTIONAL MEDIA** | Import from URL; video; GIF/animation; SVG ProductImage ingestion; browser-direct signed uploads; automatic bulk legacy import; global physical deduplication; active multi-cloud replication; MediaReplica; AI enhancement/background removal; focal-point/art-directed crop editor; advanced DAM; customer uploads; watermarks/DRM; provider-specific dynamic transformation contracts; Phase-8 visual redesign. |

Phase-6 completion must not silently expand to include deferred items.

---

# 23. Decision Register

| Decision | Rationale | Locked architectural rule | Calibration / deployment value | Deferred capability |
|---|---|---|---|---|
| Storage architecture | Avoid provider lock-in/rewrite | `MediaStorage` + provider-independent domain | S3-compatible production adapter | Additional provider adapters |
| First production candidate | Strong CDN/object-storage fit without domain coupling | R2 is infrastructure only | Revalidate R2 immediately before provisioning | AWS/other compatible backend |
| Product adoption | Bound risk | Product/ProductImage first | Other Admin media unchanged initially | Category/HomePromo/etc. adoption |
| Gallery authority | Preserve locked Phase-5 contract | ProductImage owns order/gallery; Product.image mirror only | 1–4 images remains current contract | Separate domain change only if approved |
| Managed vs legacy | Safe lifecycle ownership | New Admin media MANAGED; existing local/external unmanaged | Legacy rows classified only | Explicit legacy import later |
| Managed compatibility URL | Avoid second authority | `managedMediaId` is identity; `ProductImage.url` server-derived mirror | Compatibility rendition chosen in implementation spec/profile | Eventual mirror removal future-only |
| Master retention | Preserve reprocessing quality | Active media retains high-quality canonical master | Master encoding benchmark pending | None required |
| Raw upload | Remove privacy/format baggage | Temporary private staging only | Cleanup after READY finalization | Long-term raw-original retention not required |
| Upload size | Preserve current security posture | Bounded upload required | ~5 MB initial; evidence required to raise | Smallest justified increase only |
| Decode bounds | Prevent bombs/resource exhaustion | Bounded decode required | 40 MP / 12k axis initial candidates | Tune from benchmarks |
| Master ceiling | Balance future quality/resources | No upscaling; master remains high quality | 5120px/24MP candidates | Tune from benchmarks |
| Master encoding | Avoid destructive source loss/storage amplification | Normalized high-quality canonical master | Benchmark lossless WebP/PNG/other high-fidelity strategy | Final choice after evidence |
| Rendition ladder | Responsive delivery | Multiple useful widths; no master storefront delivery | 320/640/960/1280/1600/2048 initial | Tune from actual layouts |
| Delivery formats | Modern efficient browser delivery without hidden blockers or profile drift | WebP is mandatory baseline; AVIF delivery is conditional enhanced output and fully QA-gated when enabled; enabled format set is part of immutable processing-profile semantics | WebP~88 / AVIF~65 starting calibration; AVIF capability decision occurs before profile lock | AVIF input optional; later enabling AVIF requires a new profile version |
| Browser selection | Correct DPR/viewport behavior | Native `picture/srcset/sizes` | Exact `sizes` strings derived from layout QA | Manual JS DPR selection prohibited |
| Processing execution | Keep operations simple without risking reliability | Durable bounded recoverable execution | Sync only if deployment benchmark safe | DB-backed async execution if needed |
| External broker | YAGNI | Not required initially | None | Add only on evidence |
| Staging | Crash recovery | Durable deterministic PRIVATE staging | Provider/key/state on ManagedMedia | Direct signed uploads future-only |
| MediaObject ownership | Eliminate duplicated authority | MediaObject → ProcessingRun → ManagedMedia | One extra join accepted | Denormalize only on measured need + DB enforcement |
| Active run | Explicit quality-safe profile cutover | Active is explicit; never latest-complete inference | App transaction verifies same media + COMPLETE + inventory | Stronger DB relation only if later clean/valuable |
| Cleanup | Avoid destructive distributed transaction | Grace + final DB reference check + DELETING claim + idempotent delete | 7-day grace initial candidate | Tune operationally |
| Inactive-profile cleanup | Protect retained source while reclaiming obsolete delivery bytes | Ordinary profile cleanup may delete only obsolete PUBLIC_DELIVERY renditions and must never delete current `canonicalMasterObjectId` | Rollback/cache-safety window is operational calibration | Canonical-master replacement is separate guarded workflow |
| Emergency delivery suspension | Prevent legal/security/privacy takedown media from being reattached | Durable orthogonal `deliveryDisabledAt`; suspended media cannot attach/activate/deliver normally | Clear only through privileged reviewed recovery | Does not add lifecycle states |
| Deduplication | Preserve lifecycle semantics | Detection-first, no automatic shared lifecycle collapse | SHA-256 retained | Physical dedup future design |
| Public delivery | Avoid app/DB image hot path | Production rendition GET bypasses Next.js/Prisma/PostgreSQL | Pure Haven-controlled media hostname | Local dev may use dev serving |
| Cache | Exploit immutable identity | New bytes → new URL; purge exceptional | ~1-year immutable policy | Emergency purge only |
| Provider migration | Avoid data/domain rewrite | Copy → verify → cutover → soak → retire | Preserve keys where practical | Active multi-provider replication future |
| Rollout | Prevent schema/app incompatibility | Expand → Bridge → Classify → Contract → Verify → Enable | Feature gate controls enablement | None |
| Production migration gate | Protect migration history | No shared migration until checksum issue resolved | Exact-byte investigation required | None |
| Completion status | Avoid false production claims | Separate IMPLEMENTATION READY from COMPLETE/LOCKED | Path A preferred; Path B explicit deferral | None |
| Approved-spec repository lock | Prevent spec drift between owner approval and execution | Exact final owner-approved spec must exist at `docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md` in the real repository before implementation execution; repository file SHA-256 must match approved artifact | Occurs after final owner approval and before implementation execution | Planning may occur earlier; repository lock cannot be claimed until verification |

---

# 24. Acceptance Traceability Matrix

| Requirement | Design mechanism | Implementation area | Required evidence |
|---|---|---|---|
| Premium product quality | High-quality canonical master + calibrated rendition profile | ImageProcessor/profile | Always compare source/master/WebP; if AVIF delivery is enabled, AVIF must pass the same full manual/browser quality matrix |
| Color fidelity | Controlled color handling, no blind ICC stripping | ImageProcessor | Color-profile/shade-sensitive fixture comparisons |
| High-DPI clarity | Width ladder + browser-native responsive selection | Responsive media renderer | DPR≥2 `currentSrc`, naturalWidth, visual inspection |
| Avoid arbitrary KB damage | Quality-first profile calibration | ImageProcessor/profile QA | No fixed KB gate; bytes + visual evidence reviewed together |
| Real image security | MIME + signature + actual decode + bounded pixels | Ingest/ImageProcessor | Invalid/malformed/spoof/bomb tests |
| Preserve current upload attack surface | ~5 MB baseline until evidence | Ingest boundary/runtime config | Request/file rejection tests and deployment benchmark |
| No master leak | PRIVATE_SOURCE + DTO/delivery separation | MediaDeliveryResolver/DTO/UI | Negative API/markup/network tests |
| Responsive transfer | Shared width ladder + `srcset/sizes` | Media DTO/rendering | CSS width/DPR/currentSrc/naturalWidth/transferred bytes |
| Secondary lazy gallery | Structural lazy loading retained | ProductCardCarousel | Initial vs interaction network request evidence |
| Direct production delivery | Public rendition CDN URL | Delivery resolver/CDN config | Image GET absent from Next.js/DB request path |
| No provider N+1 | DB metadata assembly only | Catalog read mapping | Instrumented adapter = zero provider calls on normal reads |
| Provider independence | MediaStorage + common contracts | Infrastructure adapters | InMemory/Local/S3-compatible contract tests; no vendor types in business contracts |
| Durable media identity | ManagedMedia ID | Domain/persistence | Provider-migration tests preserve IDs |
| Product gallery authority | ProductImage order + managedMediaId | Product mutation service | 1–4/order/primary mirror integration tests |
| No second URL authority | Managed URL server-derived; profile activation refreshes mirrors transactionally | Product attachment/profile activation/read mapping | Client URL mutation rejected/ignored; stale-mirror authority test |
| Legacy compatibility | sourceKind + existing ProductImage ID | Product gallery service | Legacy local/external/mixed browser/API tests |
| No legacy deletion | Cleanup accepts ManagedMedia ID only | MediaLifecycleService | Removal triggers zero storage deletes |
| Abandoned upload cleanup | CLEANUP_PENDING + grace + reconciliation | Lifecycle/reconciler | Abandoned-editor convergence test |
| Failed save cleanup | Unattached ManagedMedia lifecycle | Lifecycle/reconciler | Product PUT failure → eventual cleanup test |
| Safe replacement | DB attach/detach + deferred cleanup | Product mutation/lifecycle | Replace and rollback/failure injection tests |
| Cleanup race safety | Final DB owner check + no live processing blocker + DELETING claim | Lifecycle persistence | Attach-vs-cleanup and processing-vs-cleanup concurrency tests |
| Partial cleanup recovery | Idempotent delete + tombstones | Lifecycle/storage | Inject partial delete failure then retry to DELETED |
| Crash recovery | deterministic staging/output + durable states | Ingest/reconciler | Failure injection at DB/storage boundaries |
| Idempotent upload | scoped DB uniqueness + server SHA | Ingest persistence | Same-key concurrent/retry/different-content tests |
| Pinned processing semantics | profileVersion + canonical profile hash | ProcessingRun/profile registry | Hash stability and profile-mutation fail-closed tests |
| Safe profile upgrade | separate ProcessingRun + explicit activation + compatibility-mirror refresh | Profile service | v2 fail keeps v1 active; activation refreshes ProductImage.url/Product.image transactionally |
| Canonical master protected from old-profile cleanup | Separate delivery-profile cleanup from full ManagedMedia cleanup/master replacement | Profile cleanup/lifecycle service | v1 MASTER+rends → activate v2 → clean inactive v1 PUBLIC_DELIVERY only → canonical master/pointer remain intact |
| Emergency takedown reattachment guard | Orthogonal durable `deliveryDisabledAt` | ManagedMedia persistence, attachment/profile activation, public DTO mapping, privileged emergency ops | Suspend → remove refs/purge → reattach/activate rejected → master remains private/intact; privileged recovery tested |
| Conditional AVIF acceptance | WebP mandatory; AVIF enhanced only when enabled/stable; output-format set is pinned in processing-profile semantics | Processing profile/browser renderer/QA | AVIF-enabled profile → required AVIF inventory + full visual/color/network matrix; WebP-only profile selected from evidence → Phase 6 may still pass; later AVIF enablement uses new profile version |
| Secure provider credentials | server-only least privilege | Deployment/config | Secret scan/client-bundle inspection/permission test |
| Environment isolation | stable environment-specific provider keys | Config/bootstrap | Startup fail-closed and test-vs-prod isolation evidence |
| Integrity protection | SHA-256 + immutable puts | Storage/reconciliation/migration | INTEGRITY_MISMATCH tests; no overwrite |
| Migration safety | Expand/Bridge/Classify/Contract | Prisma/PostgreSQL migrations | Fresh + upgrade rehearsals; pg_constraint/index checks |
| Classification safety | sourceKind backfill only | Migration B | pre/post row/count/ID/order/url/Product.image evidence |
| Rollback safety | bridge floor + reversible ingest gate | Deployment/runbook | Managed ingest disable test; existing media still renders |
| Operational recoverability | structured telemetry + reconciliation | Ops/reconciler | stale/backlog/failure metrics and runbook evidence |
| Canonical-master continuity | explicit canonicalMasterObjectId independent of active delivery run | ingest finalization/profile regeneration | v2 rendition regeneration reuses canonical master; ordinary activation does not replace it |
| DR | durable master + DB metadata + profile defs | Backup/runbook | inventory reconciliation/regeneration/provider migration rehearsal |
| Phase-6 completion | five acceptance dimensions | Entire phase | Owner-approved acceptance bundle + Git lock evidence |
| Approved-spec execution gate | Exact owner-approved artifact copied into real repository and hash-verified | Repository workflow/runbook | Repository-path SHA-256 equals final approved artifact before implementation execution begins |

---

# 25. Known Risks and External Gates

These do **not** make the architecture incomplete; they are explicit implementation/deployment gates.

## 25.1 Historical Prisma checksum divergence — HARD shared-deployment gate

Status: **OPEN / BLOCKING shared Phase-6 migrations**.

No non-local migration until exact-byte investigation and approved remediation are complete.

## 25.2 Final `product-image-v1` calibration

Status: **OPEN calibration**.

Pending benchmark/visual evidence for:

- input pixel/dimension thresholds;
- canonical master maximum dimensions;
- exact rendition usefulness by layout;
- WebP quality and, only when AVIF delivery is enabled, AVIF quality;
- AVIF-delivery enablement itself, which remains conditional on stable processor/runtime evidence and full QA;
- exact responsive `sizes` values;
- processing concurrency/time budget.

These are calibration values, not architecture gaps.

## 25.3 Canonical-master encoding

Status: **OPEN calibration**.

Benchmark lossless WebP, PNG where appropriate, and another high-fidelity normalized strategy if justified. Choose the safest high-quality approach with reasonable storage amplification.

## 25.4 Processing execution mode

Status: **OPEN deployment calibration**.

Synchronous processing is preferred only if real deployment benchmarks prove it safe. Otherwise use brokerless durable DB-backed execution without changing domain contracts.

## 25.5 R2 production authorization

Status: **OPEN infrastructure gate**.

R2 remains preferred but requires implementation-time revalidation and isolated integration evidence before production authorization.

## 25.6 Production activation

Status: **NOT AUTHORIZED**.

Provider readiness and database migration readiness are independent gates. Both must pass for Path-A activation.

## 25.7 Final approved-spec repository placement

Status: **OPEN WORKFLOW GATE UNTIL FINAL OWNER APPROVAL IS COPIED/VERIFIED**.

Before Phase-6 implementation execution begins, the exact final owner-approved specification artifact must exist in the real repository at:

```text
docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md
```

Compute SHA-256 from the repository copy and prove it matches the final owner-approved artifact. Do not claim the specification is repository-locked before that equality is verified. This gate authorizes no production code/schema/provider/database change by itself.

---

# 26. Formal Architectural Invariants

The following rules are the consolidated authoritative Phase-6 architecture:

1. ProductImage remains the authoritative ordered product gallery.
2. Product.image remains the first ProductImage compatibility primary mirror.
3. ManagedMedia is the permanent provider-independent identity for new Pure Haven-owned media.
4. New normal Admin product media becomes MANAGED only.
5. Existing local/external ProductImage references remain unmanaged and renderable initially.
6. MANAGED ProductImage identity is `managedMediaId`; URL is server-derived compatibility data only.
7. Legacy structured writes identify existing rows by ProductImage ID, not arbitrary URL.
8. Cleanup never accepts a URL string as physical deletion authority.
9. ManagedMedia lifecycle and MediaProcessingRun lifecycle are distinct; future regeneration never takes a healthy active asset out of READY.
10. CLEANUP_PENDING is fully processed and unreferenced; it is normally attachable during grace only when no orthogonal delivery suspension is active.
11. Final deletion claim also requires that no live in-flight processing run still depends on the asset.
12. DELETING is the non-attachable point of no return after an atomic final reference check.
13. DELETED identities and MediaObject keys are never reused.
14. Attachment truth comes from explicit relational owners, not counters/booleans.
15. Staging is deterministic, private, recoverable temporary infrastructure, not MediaObject.
16. Staging survives until READY DB finalization succeeds.
17. MediaObject ownership derives through MediaProcessingRun; no redundant ManagedMedia ownership fact is stored initially.
18. ManagedMedia keeps an explicit canonicalMasterObjectId; ordinary delivery-profile regeneration reuses that master rather than duplicating/replacing it.
19. Processing semantics are pinned by profile version plus deterministic definition hash.
20. A material profile change requires a new version.
21. COMPLETE does not mean ACTIVE; profile activation is explicit and transactional.
22. Profile activation refreshes managed ProductImage.url and affected Product.image compatibility mirrors in the same DB transaction.
23. Canonical master remains private, high quality, and retained for active/legitimately owned media.
24. Master is never normal storefront delivery.
25. Decode, processing, queue/admission, retry, and reconciliation work are bounded.
26. Current ~5 MB upload ceiling remains the initial baseline until evidence justifies change.
27. JPEG/PNG/still WebP are required inputs; AVIF input is optional/capability-gated.
28. SVG/GIF/animated product-image formats are rejected in Phase 6.
29. No upscaling; aspect ratio preserved; resizing uses high-quality downsampling.
30. Responsive public delivery uses useful width renditions and browser-native selection.
31. WebP is the mandatory modern baseline; AVIF is conditional enhanced delivery that is fully acceptance-gated when enabled and is not a completion blocker when disabled for evidenced processor/deployment safety or stability reasons.
32. There is no universal KB release limit.
33. Color fidelity and premium product presentation are hard acceptance requirements.
34. MediaStorage is provider-independent; R2 is infrastructure-only.
35. Production uses S3CompatibleMediaStorage with R2 as leading first candidate.
36. Local and test adapters reproduce required storage semantics and environment isolation.
37. PUBLIC_DELIVERY and PRIVATE_SOURCE are hard access classes; physical bucket count is provider-specific.
38. Public rendition URLs are immutable/versioned and aggressively cacheable.
39. Normal production rendition GET bypasses Next.js/Prisma/PostgreSQL.
40. Normal catalog reads perform zero provider HEAD/GET/LIST calls.
41. Provider credentials never enter client/domain records/logs.
42. Immutable identity conflicts fail closed as INTEGRITY_MISMATCH.
43. PUT /api/products remains product/gallery mutation authority.
44. The same managed media may not appear twice in one Product gallery.
45. Physical deletion never occurs inside product attach/detach/delete transactions.
46. Cross-system consistency uses durable state, immutable operations, idempotent retry, and reconciliation rather than fake distributed transactions.
47. Periodic authoritative reconciliation is required.
48. No external message broker is required unless runtime evidence later justifies one.
49. Provider migration uses copy → verify → cutover → soak → retire.
50. No automatic legacy-media import is required for Phase-6 success.
51. Rollout uses Expand → Bridge → Classify → Contract → Verify → Enable.
52. After CONTRACT, URL-only pre-Phase-6 writers are not supported rollback targets.
53. New managed ingestion is reversibly feature-gated; disabling it does not disable existing media.
54. Shared/non-local Prisma migration is blocked until the historical checksum issue is resolved/documented.
55. Phase-6 completion requires security, premium quality, responsive delivery, lifecycle safety, and portability evidence.
56. Broader whole-site performance remains Phase 7.
57. Future URL import, video, direct signed uploads, bulk legacy import, active multi-cloud replication, advanced DAM, and Phase-8 visual redesign are outside first Phase-6 completion.
58. Ordinary inactive delivery-profile cleanup may delete only obsolete PUBLIC_DELIVERY renditions and must never delete the current `canonicalMasterObjectId`; full ManagedMedia cleanup and canonical-master replacement are separate guarded workflows.
59. Emergency delivery/attachment suspension is durably orthogonal through `deliveryDisabledAt`; while non-null, media cannot be newly attached, activated for customer delivery, or emitted as normally customer-deliverable, while the PRIVATE master may remain retained.
60. AVIF delivery is conditional enhanced output: when enabled it must pass the full quality/color/network matrix; when disabled for evidenced processor/deployment safety or stability reasons, responsive WebP remains sufficient for the media-format portion of Phase-6 completion. The enabled delivery-format set is part of immutable processing-profile semantics; it may not silently vary under the same profile version/hash.
61. Before implementation execution, the exact final owner-approved specification must be copied into the real repository at the approved path and SHA-256 verified against the approved artifact; repository lock must not be claimed before this check.

---

# 27. Self-Review Resolution Register

The formal-spec consolidation performed the required contradiction/gap review and resolved the following issues:

| Review item | Resolution |
|---|---|
| ManagedMedia lifecycle vs ProcessingRun lifecycle | ManagedMedia tracks logical asset availability/ownership/deletion; ProcessingRun tracks one profile generation. Initial ingest may put both into processing states; later regeneration never downgrades a healthy READY asset. |
| First ingest vs future regeneration | Initial run controls first usable asset creation and may retry FAILED→PROCESSING; future run proceeds independently while active run keeps media READY. |
| CLEANUP_PENDING semantics | Explicitly defined as fully processed and unreferenced; normally attachable during configurable grace only when `deliveryDisabledAt` is null. |
| DELETING semantics | Atomic final zero-reference claim plus no live processing blocker; never attachable afterward. |
| Staging vs MediaObject | Staging remains temporary deterministic locator/state on ManagedMedia; only canonical master/renditions are MediaObjects. |
| MediaObject redundant ownership | Resolved by removing `managedMediaId` from MediaObject; ownership derives through ProcessingRun. |
| Canonical master persistence vs profile regeneration | Resolved with ManagedMedia.canonicalMasterObjectId so the retained master survives independently of whichever delivery run is active. |
| ActiveProcessingRun same-media consistency | Kept as simple FK + mandatory transaction validation/integration tests rather than introducing brittle cyclic/composite ORM relation or trigger. Activation also refreshes compatibility mirrors atomically. |
| ProductImage.url vs managedMediaId | Managed ID is authority; URL is server-derived compatibility-only for MANAGED rows. |
| Product.image vs ProductImage | Product.image remains server-derived from first ordered ProductImage.url; no new primary FK. |
| Legacy structured identity | New structured API uses existing ProductImage.id for legacy rows; arbitrary URL cannot manufacture a new legacy relationship. |
| Calibration values vs invariants | All numeric size/quality/concurrency/grace/master values are explicitly isolated as calibration unless stated as hard rule. |
| Sync processing vs runtime safety | Spec does not promise request-bound processing; benchmark selects sync or brokerless DB-backed execution. |
| Private master vs public rendition | Separate access classes; master leak is release blocker. |
| R2 preference vs provider independence | R2 appears only as leading S3-compatible infrastructure candidate; domain contracts stay provider-neutral. |
| Implementation-ready vs production-complete | Two explicit statuses, with Path A preferred and Path B named `IMPLEMENTATION LOCKED / PRODUCTION ACTIVATION DEFERRED`. |
| Failure authority duplication | ProcessingRun owns detailed profile-execution failure; ManagedMedia owns asset-level ingest/lifecycle/cleanup status/summary. |
| Idempotency race before fingerprint | Second same-key request resumes existing operation; it cannot establish a second byte stream while the first fingerprint is pending. |
| Canonical master vs active delivery run | Added explicit canonicalMasterObjectId. Future delivery-profile runs reuse the retained master; ordinary activation does not duplicate or replace it. |
| Canonical master vs old-profile cleanup | Resolved explicitly: ordinary inactive-profile cleanup is rendition-only and excludes the current canonicalMasterObjectId. Full ManagedMedia cleanup and canonical-master replacement are separate destructive workflows. Added the v1 MASTER+rends → v2 activation → v1 rendition-cleanup regression requirement. |
| Active old-profile cleanup | Activation never deletes previous profile immediately; cleanup is deferred through rollback/cache-safety policy and may only remove eligible obsolete PUBLIC_DELIVERY renditions. |
| Emergency suspension vs normal lifecycle | Added durable orthogonal `deliveryDisabledAt`. CLEANUP_PENDING remains normally attachable, but not while suspended. Suspension blocks attachment/profile activation/public DTO delivery without adding a lifecycle state; privileged recovery is separately guarded. |
| AVIF optionality vs QA requirements | WebP remains mandatory. AVIF receives the full QA matrix whenever enabled; a deployment with AVIF delivery disabled for evidenced safety/stability reasons can still complete Phase 6 if all other dimensions pass. |
| AVIF optionality vs profile immutability | Resolved by making the enabled output-format set part of the pinned processing-profile definition. A WebP-only v1 is valid if benchmark evidence disables AVIF before lock; later AVIF enablement requires a new profile version instead of environment-specific omission under the same profile. |
| Local dev vs direct production delivery | Direct CDN bypass is a production/real-object-store requirement; LocalMediaStorage may use an approved dev serving path. |
| Approved artifact vs real-repository spec | Added an execution/workflow gate: after final owner approval, copy the exact spec to the real repository path and verify repository SHA-256 equals the approved artifact before implementation execution. No repository-lock claim before that proof. |

**Placeholder scan:** no unresolved implementation placeholders remain. Open items are explicitly labeled as calibration or external gates rather than hidden ambiguity.

**Scope check:** the design remains one coherent product-first media infrastructure phase. Future URL import/video/direct uploads/bulk import/multi-cloud replication remain deferred.

**Focused contradiction check:** canonical-master retention now survives inactive-profile rendition cleanup by explicit destructive-workflow separation; emergency suspension is orthogonal to lifecycle yet durably blocks reattachment/re-delivery; AVIF acceptance is conditional without weakening QA when AVIF is enabled.

**Ambiguity check:** the main prior dual-authority risks—URL vs managed ID, asset vs processing run, staging vs MediaObject, managed vs legacy deletion, canonical master vs inactive-profile cleanup, and lifecycle vs emergency delivery suspension—are explicitly resolved above.

---

# 28. Owner Review Gate

This formal specification is **not implementation authorization**.

After owner approval of this written spec, the next workflow step is to invoke the approved implementation-planning process and produce a separate implementation plan for review. Before any later **implementation execution**, the exact final owner-approved artifact must also be copied into the real repository at `docs/superpowers/specs/2026-09-04-phase-6-media-infrastructure-design.md` and its repository SHA-256 verified equal to the approved artifact. Planning does not constitute repository lock, and repository lock must not be claimed until that verification succeeds.

Until that approval:

- do not implement Phase 6;
- do not modify Prisma/schema;
- do not create migrations;
- do not install processing/storage packages;
- do not provision R2/S3;
- do not alter DNS/credentials;
- do not perform shared/non-local database operations.

