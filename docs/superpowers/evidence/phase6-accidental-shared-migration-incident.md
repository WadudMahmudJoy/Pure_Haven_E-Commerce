# Phase 6 — Accidental Shared Migration Incident Record

- **Incident Identifier:** `PHASE6_SHARED_SCHEMA_APPLIED_EARLY_INCIDENT`
- **Timestamp:** 2026-09-09T00:19:18Z – 2026-09-09T00:19:33Z (Local: 2026-09-09 06:19:18+06:00)
- **Status:** Contained, Audited Read-Only, Worktree Clean
- **Classification:** `INCIDENT_SCHEMA_CONSISTENT`

---

## 1. Incident Description & Triggering Command

During Task 15 preparation to ensure local database schema availability for repository ops, a migration deployment was initiated with the intention of targeting the local disposable container (`127.0.0.1:55439`).

The exact command line executed in PowerShell was:
```powershell
$env:DATABASE_URL = $env:DATABASE_URL_TEST; npx prisma migrate deploy
```

---

## 2. Root Cause Analysis

1. `DATABASE_URL_TEST` was configured within the repository's `.env` file, but was **not** exported as an environment variable in the ambient Windows PowerShell process.
2. In PowerShell, referencing an undefined environment variable (`$env:DATABASE_URL_TEST`) evaluates to an empty string (`""`).
3. `$env:DATABASE_URL = ""` assigned an empty string to `DATABASE_URL` in the process environment.
4. When `npx prisma migrate deploy` launched, Prisma loaded `prisma.config.ts`, which executed `import "dotenv/config";`.
5. Because `process.env.DATABASE_URL` was empty, `dotenv/config` populated `DATABASE_URL` from the `.env` file.
6. In `.env`, `DATABASE_URL` targets the shared Neon cloud database.
7. Consequently, `npx prisma migrate deploy` connected to the shared Neon database and deployed the five Phase-6 migrations.

---

## 3. Redacted Target Configuration

- **Host:** `ep-falling-lake-am490jqe-pooler.c-5.us-east-1.aws.neon.tech`
- **Database:** `neondb`
- **SSL:** `require` (libpq `verify-full` alias)
- **Connection Timeout:** 5000 ms
- **Statement Timeout:** 10000 ms

*(Credentials and full connection strings omitted in accordance with security policy).*

---

## 4. Containment Actions Taken

1. **Immediate Execution Halt:** As soon as the command finished and the output identified the Neon datasource, all execution was immediately halted.
2. **Zero Remediation / Zero Mutation:**
   - No `prisma migrate resolve` was executed.
   - No SQL `ALTER`, `UPDATE`, `DELETE`, or `ROLLBACK` was executed.
   - No records in `_prisma_migrations` were modified.
   - No `db push` was executed.
   - No production data was altered or deleted.
   - Task 17 was not started.
3. **Read-Only Audit Only:** The shared database was accessed exclusively for bounded read-only inspection queries.

---

## 5. Read-Only Audit Results

### 5.1 Migration Records in `_prisma_migrations`

| migration_name | checksum | started_at | finished_at | rolled_back_at | applied_steps_count |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `20260526183231_sync_current_schema_security_fix` | `ac0c8d8f465e09a5e69c1d4330668e5a320e03392ed4e47105d4355b6ac57013` | 2026-08-17T19:17:09.766Z | 2026-08-17T19:17:09.766Z | NULL | 0 |
| `20260905010000_phase6_media_expand` | `7e671a3a28ccaae636eae5ac0875a07a1db60255608ee40706d03628eeaf28e1` | 2026-09-09T00:19:18.413Z | 2026-09-09T00:19:26.018Z | NULL | 1 |
| `20260905020000_phase6_product_image_classification` | `275527f92d81ad6f33b231a1c5965661a0a3fd1d565dbf92997899e368011479` | 2026-09-09T00:19:26.479Z | 2026-09-09T00:19:27.655Z | NULL | 1 |
| `20260905030000_phase6_media_contract` | `e3e127903668fcf6ebb1c12d93ef2db90dcb1cbc3ed0bbb3cf667e29c51727bc` | 2026-09-09T00:19:28.116Z | 2026-09-09T00:19:29.278Z | NULL | 1 |
| `20260905030100_phase6_bounded_columns` | `ef1d9338665657431a5f884c3bc7d2fe85616f625e2341c8b207f1959df99dd5` | 2026-09-09T00:19:29.739Z | 2026-09-09T00:19:31.405Z | NULL | 1 |
| `20260905030200_phase6_persistence_contract_corrections` | `a414aba7231a360937c348c89de15108eb1d4c27f1dbb9892155d0ea698ed5ef` | 2026-09-09T00:19:31.866Z | 2026-09-09T00:19:33.123Z | NULL | 1 |

All five Phase-6 migrations have exactly one completed, non-rolled-back record.

### 5.2 Production Data Counts

- **`ProductImage` Total:** 63
- **`ProductImage.sourceKind` NULL:** 0
- **`ProductImage` `LEGACY_LOCAL`:** 63
- **`ProductImage` `LEGACY_EXTERNAL`:** 0
- **`ProductImage` `MANAGED`:** 0
- **`ProductImage.managedMediaId` non-null:** 0
- **Rule Violations (invalid URL prefix or invalid sourceKind):** 0
- **`ManagedMedia` Rows:** 0
- **`MediaProcessingRun` Rows:** 0
- **`MediaObject` Rows:** 0

### 5.3 PostgreSQL Catalog Invariants Verified

1. **UUID Columns:** `ManagedMedia.id`, `MediaProcessingRun.id`, `MediaObject.id`, and `ProductImage.managedMediaId` are all of type `uuid`.
2. **`ProductImage.sourceKind`:** Enum `ProductImageSourceKind`, `is_nullable = NO`.
3. **CHECK Constraints Active:**
   - `ProductImage_source_kind_managed_ck`
   - `ProductImage_legacy_url_ck`
   - `MediaObject_role_access_ck`
   - `MediaObject_dimensions_bytes_positive_ck`
   - `ManagedMedia_cleanup_pending_ck`
   - `ManagedMedia_deleted_tombstone_ck`
   - `ManagedMedia_failed_classification_ck`
   - `MediaProcessingRun_complete_ck`
   - `MediaProcessingRun_processing_lease_ck`
4. **Foreign Keys Active with `ON DELETE RESTRICT`:**
   - `ProductImage.managedMediaId -> ManagedMedia.id` (`confdeltype: 'r'`)
   - `ManagedMedia.activeProcessingRunId -> MediaProcessingRun.id` (`confdeltype: 'r'`)
   - `ManagedMedia.canonicalMasterObjectId -> MediaObject.id` (`confdeltype: 'r'`)
   - `MediaProcessingRun.managedMediaId -> ManagedMedia.id` (`confdeltype: 'r'`)
   - `MediaObject.processingRunId -> MediaProcessingRun.id` (`confdeltype: 'r'`)
5. **Indexes Active:**
   - Primary keys, unique keys, and foreign key indexes on `ProductImage`, `ManagedMedia`, `MediaProcessingRun`, and `MediaObject` are fully established.

---

## 6. Historical Checksum Gate & Ongoing Prohibition

- **Historical Checksum Gate:**
  `20260526183231_sync_current_schema_security_fix` remains **`MISMATCH_UNRESOLVED`**.
  The accidental forward application of Phase-6 migrations does **not** resolve, explain, or alter this historical checksum status.
- **Ongoing Prohibition:**
  **NO FURTHER SHARED/NON-LOCAL PRISMA MIGRATIONS PERMITTED.**
  Neon remains strictly read-only for any required future audit.

---

## 7. Fail-Closed Guard for Local Database Execution

To permanently prevent recurrence, any future local Prisma/pg command must use an explicit fail-closed target verification script before setting `DATABASE_URL`. It must prove:
1. Target URL is explicitly loaded from `.env` or verified source;
2. `hostname` is strictly in `@('127.0.0.1', 'localhost')`;
3. `port` is strictly `55439` (or explicitly authorized local container port);
4. Redacted parameters are printed prior to execution.

---

## 8. Operational Consequence for Task 26

Because the five Phase-6 migrations were already applied to shared Neon:
- **Phase 6 production rollout is NOT complete.**
- Task 26 rollout procedures must be updated operationally by the technical owner before final deployment, accounting for the fact that schema migrations are already present on Neon.
- The locked specification and implementation plan are not rewritten.
