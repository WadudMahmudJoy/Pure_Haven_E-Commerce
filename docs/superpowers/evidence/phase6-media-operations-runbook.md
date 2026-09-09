# Pure Haven BD — Phase 6 Managed Media Operations & DR Runbook

## 1. Overview & Architecture Summary

This operational runbook defines standard operating procedures, privileged incident responses, disaster recovery (DR) protocols, and cloud provider migration procedures for the Pure Haven BD Managed Media Infrastructure.

### Core Architectural Principles
- **Dual-Storage Isolation**: Private source storage (`PRIVATE_SOURCE`) holds durable canonical masters. Public delivery storage (`PUBLIC_DELIVERY`) contains deterministic WebP/AVIF renditions.
- **Immutable Public Rendition Addressing**: Public renditions are addressed by immutable content paths (`public/<mediaId>/rendition-<width>.<ext>`). Updates produce new IDs; in-place overwrites are strictly prohibited.
- **Deterministic Reproducibility**: Renditions are disposable cache artifacts. The persistent source of truth consists of:
  1. PostgreSQL metadata (`ManagedMedia`, `MediaProcessingRun`, `MediaObject`, `ProductImage`).
  2. Durable canonical masters in private storage.
  3. Versioned profile definitions (`PRODUCT_IMAGE_PROFILE_V1`).

---

## 2. Exceptional CDN Purge & Public Revocation Procedure

### Standard vs. Exceptional Invalidation
- **Standard Operations (No Purge Required)**: Because image renditions use immutable URLs keyed by media UUID and profile version, regular image replacements and gallery updates require **zero CDN cache invalidation**. Browsers and CDN edges naturally fetch new URLs.
- **Exceptional Invalidation (Privileged Incident Only)**: CDN purge is reserved exclusively for:
  - Unsafe, illegal, or DMCA/copyright-infringing media.
  - Accidental exposure of personally identifiable information (PII) or confidential material.
  - Malformed or corrupted renditions that were prematurely cached by edge nodes.

### Security Boundary
- Ordinary store managers and catalog editors **never** receive CDN purge API credentials or console access.
- CDN purges must be initiated by an authorized administrator using `scripts/phase6-media-delivery-control.ts`.

### Execution Steps for Emergency Delivery Suspension & Revocation
1. **Immediate Delivery Suspension**:
   Execute the delivery control script to set `deliveryDisabledAt = now()` in PostgreSQL:
   ```bash
   npx tsx scripts/phase6-media-delivery-control.ts suspend --media-id "<MEDIA_UUID>" --reason "LEGAL_TAKEDOWN"
   ```
   *Effect*: Public catalog queries immediately suppress all renditions for this media ID.
2. **Edge Invalidation (If Cached at CDN)**:
   Purge the specific public paths from Cloudflare / CDN edge:
   ```bash
   # Edge purge target pattern:
   /public/<MEDIA_UUID>/*
   ```
3. **Master Retention vs. Hard Purge**:
   - By default, public revocation does **not** delete the private canonical master. This preserves evidentiary audit history.
   - If a court order or legal requirement mandates complete physical destruction, execute privileged purge:
   ```bash
   npx tsx scripts/phase6-media-delivery-control.ts purge-permanent --media-id "<MEDIA_UUID>" --confirm
   ```

---

## 3. Operational Observability & Severity Taxonomy

### Actionable Observability Signals & Thresholds
| Signal / Metric | Threshold | Potential Root Cause | Initial Remediation |
|---|---|---|---|
| **Stale PENDING** | Age > 15 minutes | Ingest worker crashed or queue blocked | Run `reconcile-managed-media.ts` to sweep orphaned records |
| **Expired PROCESSING Lease** | Lease age > 10 minutes | Processing runner OOM or container restart | Lease will automatically be reclaimed on next runner tick |
| **Processing Failure Rate** | > 2% of uploads | Unsupported format, corrupted buffer, or Sharp memory limit | Check telemetry `failureCode` in operational logs |
| **Checksum / Size Mismatch** | Any occurrence (> 0) | Storage corruption or unauthorized external tampering | **SEV-1**: Quarantine object, trigger immediate rebuild |
| **Cleanup Backlog** | Age > 48 hours | Storage delete API throttling or permissions failure | Check S3/R2 delete credentials and rerun cleanup script |
| **Staging Leftovers** | Age > 24 hours | Upload aborted between staging write and DB commit | Run automated staging reconciliation sweep |

### Incident Severity Classification
- **SEV-1 (Critical)**:
  - Data integrity mismatch (SHA-256 verification failure).
  - Private canonical master inaccessible or leaked to public endpoint.
  - Active catalog displays broken primary images across multiple products.
- **SEV-2 (High)**:
  - Processing runner worker paused or lease expiration backlog growing.
  - Upload API latency > 5000ms or 5xx error rate > 5%.
  - Emergency legal takedown request pending execution.
- **SEV-3 (Medium / Low)**:
  - Transient storage delete failure during automated 24-hour cleanup grace period.
  - Non-retryable upload failure for individual corrupted client file.

---

## 4. Disaster Recovery (DR) & Rendition Rebuild Protocol

### Disaster Recovery Scope
If a catastrophic storage failure, bucket deletion, or data loss affects the public delivery storage:
- **Zero permanent catalog data loss occurs**, provided the private canonical master bucket and PostgreSQL database are intact.

### Rendition Rebuild Procedure
1. **Verify Integrity of Private Storage**:
   Verify that database records have corresponding canonical masters in private storage:
   ```bash
   npx tsx scripts/reconcile-managed-media.ts --verify-masters-only
   ```
2. **Re-run Deterministic Processing Pipeline**:
   Trigger batch regeneration using `scripts/process-managed-media.ts`:
   ```bash
   npx tsx scripts/process-managed-media.ts --regenerate-all --profile "PRODUCT_IMAGE_PROFILE_V1"
   ```
   *Note*: The runner will re-encode WebP and AVIF renditions at all target widths (320, 640, 800, 1200, 1500) and upload them directly to the public storage bucket.
3. **Atomic Cutover / Candidate Activation**:
   Once processing runs reach state `COMPLETE`, the system automatically promotes them to active, restoring public delivery.

---

## 5. Storage Provider Migration & Rollback Procedure

### Migration Protocol: `COPY → VERIFY → CUTOVER → SOAK → RETIRE`

When migrating between object storage providers (e.g., AWS S3 to Cloudflare R2 or MinIO to S3):

#### Stage 1: Synchronize Data (`COPY`)
- Synchronize all objects from source bucket to target bucket while preserving exact object keys:
  ```bash
  # Example S3-to-R2 sync preserving keys:
  rclone sync source:purehaven-private target:purehaven-private --fast-list
  rclone sync source:purehaven-public target:purehaven-public --fast-list
  ```

#### Stage 2: Inventory & Integrity Audit (`VERIFY`)
- Compare source and target inventory:
  - Object count matching.
  - Byte size matching per object.
  - SHA-256 checksum audit on sample (100% of canonical masters, 10% of renditions).
  - Content-Type / MIME metadata preserved.

#### Stage 3: Configuration Cutover (`CUTOVER`)
- Update runtime environment variables in production configuration:
  ```env
  S3_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
  S3_ACCESS_KEY_ID="<NEW_ACCESS_KEY>"
  S3_SECRET_ACCESS_KEY="<NEW_SECRET_KEY>"
  MEDIA_PUBLIC_ORIGIN="https://media.purehavenbd.com"
  ```
- Restart Next.js application server.
- **Zero database migrations or schema alterations are required.**

#### Stage 4: Soak Period (`SOAK`)
- Keep source storage online in read-only mode for a mandatory **7-day soak period**.
- Monitor operational telemetry for:
  - Rendition fetch latency.
  - Upload staging and processing error rates.
  - 404/403 responses at the public delivery origin.

#### Stage 5: Retirement (`RETIRE`)
- After 7 days without incident and with technical owner sign-off:
  - Archive final source bucket audit snapshot.
  - Deprovision old storage bucket.

#### Emergency Rollback Procedure
If the target provider experiences elevated failure rates or connectivity loss during the soak period:
1. Revert environment variables to point back to source provider credentials and endpoint.
2. Restart application server.
3. System immediately resumes reading and writing to source provider with zero downtime.
