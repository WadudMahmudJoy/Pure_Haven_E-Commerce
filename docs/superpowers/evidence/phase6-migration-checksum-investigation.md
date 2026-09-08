# Phase 6 Historical Prisma Checksum Investigation

- Migration: `20260526183231_sync_current_schema_security_fix`
- Current repository SHA-256: `6ebbf1104c5fd06f0414e7ee01b6f8ebfbe340334e1dfed14d610337d104669c`
- Neon recorded SHA-256: `ac0c8d8f465e09a5e69c1d4330668e5a320e03392ed4e47105d4355b6ac57013`
- BOM-form SHA-256: `ec41663f09c1601a49fa871131d5e4e44e1d0187fface1a7c61669178f6f4f5e`
- BOM-stripped SHA-256: `6ebbf1104c5fd06f0414e7ee01b6f8ebfbe340334e1dfed14d610337d104669c`
- Historical Git candidates:
  - 87f8dfcc4b01ed1506f616d0a9581b74133841a9: 8b6c896b539a18e2705d1e23db277cca4ac1154d45f61bc744e66af6a279a2d9 (2859 bytes, LF blob)
  - f173e923ed771644d74ac224608afda14431cf44: 2900215896d279bfc53a33566cfb2c6c3c942eebc711a565d4ca15f667783596 (2862 bytes, LF blob with UTF-8 BOM)
- Live Neon _prisma_migrations record:
  - checksum: `ac0c8d8f465e09a5e69c1d4330668e5a320e03392ed4e47105d4355b6ac57013`
  - finished_at: `2026-08-17T19:17:09.766Z`
  - rolled_back_at: `null`
  - applied_steps_count: 0
- Exact-byte conclusion: `MISMATCH_UNRESOLVED`
- SQL semantic comparison: SQL semantic inspection confirms that the migration statements in migration.sql are purely additive and idempotent schema synchronizations (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS) and are textually identical across commits aside from the UTF-8 BOM removal in commit 87f8dfc, but SQL semantic equality never substitutes for byte equality under Prisma migrate deploy.
- Shared/non-local migration gate: `BLOCKED` unless a separately owner-approved remediation has been completed and reverified.
