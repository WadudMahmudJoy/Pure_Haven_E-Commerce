# Pure Haven BD — Phase 3 Customer Authentication Implementation Plan
**Authoritative Architectural Implementation Plan — Phase 3**
**Date:** 2026-08-26
**Status:** IMPLEMENTATION PLAN (READY FOR LOCK)
**Design Baseline SHA:** `51ca6aed4434c463bd7ef309779ed6c8f4d770e0` (`phase3-auth-design-lock`)
**Commerce Baseline SHA:** `445cb308f2f0dbec0909f6c46f980aacc6531fbb` (`phase2-complete`)
**Authoritative Design Spec:** `docs/superpowers/specs/2026-08-26-phase3-customer-authentication-design.md`

---

## 1. Executive Summary & Locked Baseline

### 1.1 Scope & Objective
This document defines the authoritative, wave-by-wave execution blueprint for **Phase 3 Customer Authentication**. It establishes:
1. **Flexible Customer Identity:** Unified single-form login supporting either **Email + Password** or **Phone Number + Password** on the same account.
2. **PostgreSQL Data Models:** Transactional persistence for `User`, `CustomerSession`, `CustomerAuthToken`, and nullable `Order.userId` (`onDelete: Restrict`).
3. **Opaque Database Sessions:** 256-bit CSPRNG tokens stored hashed (`sha256`) at rest in `CustomerSession`, replacing insecure plaintext legacy cookies.
4. **Order Ownership & IDOR Elimination:** Strict relational ownership (`Order.userId = session.userId`) replacing unverified phone-string matching, with zero automatic claiming of historical guest orders.
5. **Security Controls Shipped With Endpoints:** Asynchronous Node.js `scrypt` hashing, strict Bangladesh phone parsing, `APP_ORIGIN` CSRF validation across all unsafe HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) introduced in Wave B, and rate limiting evaluated before expensive `scrypt` hashing.
6. **Preservation of Prior Phases:** Total isolation and compatibility with locked Phase-1 Admin Auth and Phase-2 Commerce & Inventory Integrity.

### 1.2 Baseline Integrity Check
Every implementation wave must verify:
```bash
git status --short
git rev-parse HEAD
git rev-parse origin/main
git show --no-patch --oneline phase3-auth-design-lock
```
*Expected State:* Working tree clean; `phase3-auth-design-lock` present at `51ca6aed4434c463bd7ef309779ed6c8f4d770e0`.

---

## 2. Implementation Waves Overview & Dependency Graph

```mermaid
flowchart TD
    W0[Discovery Checkpoint: Legacy customer-users.json Metadata Gate] --> WA[Wave A: Schema & Cryptographic Foundation]
    WA --> WB[Wave B: Core Authentication Engine + CSRF & Rate Limits]
    WB --> WC[Wave C: Order Ownership & Dashboard IDOR Elimination]
    WC --> WD[Wave D: Password Recovery, Email Verification & Second Identifiers]
    WD --> WE[Wave E: Auth UX & Hardening Completion]
    WE --> WF[Wave F: Real PostgreSQL Concurrency, Regression & Final Lock]
```

| Wave | Name | Primary Deliverables | Tag Checkpoint |
|---|---|---|---|
| **Wave A** | Schema & Cryptographic Foundation | Legacy data gate, Prisma migration (`User`, `CustomerSession`, `CustomerAuthToken`, `Order.userId`), strict phone parser, async scrypt, token crypto | `phase3-wave-a-auth-foundation` |
| **Wave B** | Core Authentication Engine | `validateSameOrigin` (CSRF), rate-limited login & register, logout, session service, atomic API cutover, legacy cookie retirement | `phase3-wave-b-core-auth` |
| **Wave C** | Order Ownership & Dashboard | Server-derived `Order.userId` in checkout, `/api/customer-orders` rewritten by `userId`, Customer Dashboard cutover | `phase3-wave-c-order-ownership` |
| **Wave D** | Recovery, Verification & Identifiers | Password reset lifecycle, email verification lifecycle, `ADD/CHANGE EMAIL`, `ADD/CHANGE PHONE` with password re-auth | `phase3-wave-d-recovery-identifiers` |
| **Wave E** | Auth UX & Hardening Completion | Unified single login form, responsive mobile UX, autofill semantics, localStorage PII purge, final audit | `phase3-wave-e-auth-ux-hardening` |
| **Wave F** | Full Concurrency & Final Lock | 12 real PostgreSQL concurrency scenarios, full Phase 1/2/3 regression, browser QA across mobile/tablet/desktop | `phase3-complete` |

---

## 3. Wave A — Schema & Cryptographic Foundation

### 3.1 Step 0: Legacy `data/customer-users.json` Metadata Gate
- **Objective:** Programmatically audit [`data/customer-users.json`](file:///E:/Joy/pure-haven-bd-joy/pure-haven-bd/data/customer-users.json) metadata **without** printing passwords or full hashes.
- **Reporting Requirements:**
  1. Record count.
  2. Structure classification (demo/prototype vs meaningful customer accounts).
  3. Legacy password hash format compatibility.
  4. Duplicate detection after canonical email/phone normalization.
- **Decision Gate:**
  - If meaningful customer records exist and retirement would result in unexpected account loss: **STOP** with `LEGACY_CUSTOMER_DATA_DECISION_REQUIRED` for owner decision (safe import vs explicit retirement).
  - If records are verified disposable prototype/test accounts: Document evidence and proceed with clean PostgreSQL cutover.
  - *Invariant:* No runtime dual-write; no JSON fallback after cutover.

### 3.2 Task 1: Cryptographic & Normalization Primitives (`lib/customerAuth.ts`)
- **TDD Requirement:** Behavioral RED unit test suite in `tests/customer-crypto-normalization.test.ts`.
- **Deliverables:**
  1. `parseAndNormalizePhone(raw: string): string | null`: Strict Bangladesh parser. Accepts `01[3-9]\d{8}`, `8801[3-9]\d{8}`, `+8801[3-9]\d{8}`; strips permitted spaces/hyphens/parentheses; returns canonical `01XXXXXXXXX`; strictly rejects extra leading/trailing digits, letters, invalid prefixes (`010`, `011`, `012`), wrong country codes, and embedded text.
  2. `normalizeEmail(raw: string): string | null`: Trims outer whitespace and lowercases; preserves Gmail dots and `+` sub-addressing.
  3. `classifyIdentifier(raw: string): ParsedIdentifier`: Deterministically classifies input into `{ type: "EMAIL", value }`, `{ type: "PHONE", value }`, or `{ type: "INVALID" }`.
  4. `hashPassword(password: string): Promise<string>`: Asynchronous Promisified `scrypt` ($N=16384, r=8, p=1$, 16-byte random salt, 64-byte key length); formats as `scrypt$N=16384,r=8,p=1$<saltHex>$<derivedKeyHex>`.
  5. `verifyPassword(password: string, serializedHash: string): Promise<boolean>`: Constant-time comparison via `crypto.timingSafeEqual`.
  6. `generateSessionToken(): { rawToken: string; tokenHash: string }`: 32 bytes CSPRNG (Base64URL), hashed via `sha256`.
  7. `generateAuthActionToken(): { rawToken: string; tokenHash: string }`: 32 bytes CSPRNG (Base64URL), hashed via `sha256`.
- **Verification Command:** `npx tsx --test tests/customer-crypto-normalization.test.ts`

### 3.3 Task 2: Prisma Schema Extension & Migration
- **Target File:** `prisma/schema.prisma`
- **Models Added:**
  - `User`: `id`, `name`, `email? @unique`, `normalizedPhone? @unique`, `passwordHash`, `emailVerifiedAt?`, `phoneVerifiedAt?`, `isActive @default(true)`, `createdAt`, `updatedAt`. Relations: `orders`, `sessions`, `authTokens`.
  - `CustomerSession`: `id`, `userId`, `tokenHash @unique`, `createdAt`, `expiresAt`, `revokedAt?`, `userAgent?`, `ipAddress?`. Relation: `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`. Indexes: `userId`, `expiresAt`, `revokedAt`.
  - `enum AuthTokenPurpose`: `PASSWORD_RESET`, `EMAIL_VERIFICATION`.
  - `CustomerAuthToken`: `id`, `userId`, `purpose`, `tokenHash @unique`, `expiresAt`, `consumedAt?`, `createdAt`. Relation: `user User @relation(fields: [userId], references: [id], onDelete: Cascade)`. Indexes: `[userId, purpose]`, `expiresAt`, `consumedAt`.
  - `Order`: Add `userId String?` with `user User? @relation(fields: [userId], references: [id], onDelete: Restrict)` and `@@index([userId])`.
- **PostgreSQL Table CHECK Constraints (Added to migration SQL):**
  ```sql
  ALTER TABLE "User" ADD CONSTRAINT "user_has_at_least_one_identifier"
  CHECK ("email" IS NOT NULL OR "normalizedPhone" IS NOT NULL);

  ALTER TABLE "User" ADD CONSTRAINT "user_email_must_be_canonical_lowercase"
  CHECK ("email" IS NULL OR "email" = lower("email"));
  ```
- **Verification Commands:** `npx prisma validate`, `npx prisma generate`
- **Wave A Checkpoint:** Commit message `feat(auth): add PostgreSQL User, CustomerSession, and CustomerAuthToken schema foundation` -> Tag `phase3-wave-a-auth-foundation`.

---

## 4. Wave B — Core Authentication Engine (With CSRF & Rate Limits)

### 4.1 Task 3: CSRF Foundation (`lib/csrf.ts`)
- **TDD Requirement:** Security tests in `tests/csrf-protection.test.ts`.
- **Specification:**
  - Production authority: `process.env.APP_ORIGIN` (fails closed in production if missing/invalid).
  - Evaluates all unsafe HTTP methods: `POST`, `PUT`, `PATCH`, `DELETE`.
  - Compares `Origin` (or `Referer` origin fallback) strictly against `APP_ORIGIN`.
  - Prohibitions: Never derived from `Host`, `X-Forwarded-Host`, request URL, `NEXT_PUBLIC_*`.
  - Development / Test Allowlist: Explicitly permitted origins only (`http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:3005`).

### 4.2 Task 4: Customer Session Service (`lib/customerSession.ts`)
- **TDD Requirement:** Unit/service tests in `tests/customer-session-service.test.ts`.
- **Functions:**
  - `createCustomerSession(userId: string, meta?: { userAgent?: string; ipAddress?: string })`
  - `validateCustomerSession(rawToken: string)`: Hashes token, queries where `tokenHash` matches, `revokedAt IS NULL`, `expiresAt > now`, and `user.isActive === true`.
  - `revokeCustomerSession(rawToken: string)`: Linearization point; updates `revokedAt = now()`.
  - `revokeAllUserSessions(userId: string)`: Updates `revokedAt = now()` across all active sessions for that user.
  - `setCustomerSessionCookie(res: NextResponse, rawToken: string)`: Sets `pure_haven_customer_session` and clears legacy `pure_haven_customer_auth`.
  - `clearCustomerSessionCookie(res: NextResponse)`: Clears both new and legacy cookies.
  - `cleanupStaleCustomerSessions(limit?: number)`: Opportunistic/bounded purge of long-expired/revoked session rows.

### 4.3 Task 5: Core Authentication API Endpoints & Atomic Cutover
- **TDD Requirement:** Route tests in `tests/customer-auth-routes.test.ts` and `tests/customer-rate-limit.test.ts`.
- **Endpoints Implemented (With Full Security Controls Pre-Wired):**
  1. `POST /api/customer-auth/register`:
     - Same-origin CSRF validation (`validateSameOrigin`).
     - Registration rate limiting: **3 attempts / 1 hour per client**, **30 attempts / 1 hour global**.
     - Validates bounds (password 8-128 chars, name 2-100 chars).
     - Transactionally creates `User` and immediate `CustomerSession`; sets cookie; returns user DTO.
     - Maps PostgreSQL `P2002` to generic 409 Conflict without leaking database internals.
  2. `POST /api/customer-auth/login`:
     - Same-origin CSRF validation (`validateSameOrigin`).
     - Login rate limiting: **5 attempts / 15 min per client**, **60 attempts / 60 sec global** evaluated **before** `scrypt`.
     - Normalizes identifier (email or phone).
     - Executes dummy `scrypt` hash if user not found or `isActive === false` (timing attack mitigation).
     - On success: resets client rate-limit bucket, creates `CustomerSession`, sets cookie, clears legacy cookie, returns user DTO.
     - On failure: returns generic 401 `"Email/phone or password is incorrect."`.
  3. `POST /api/customer-auth/logout`:
     - Same-origin CSRF validation (`validateSameOrigin`).
     - Reads `pure_haven_customer_session`, revokes session in DB (`revokedAt = now()`), clears cookies, returns success.
  4. `GET /api/customer-auth/session`:
     - Inspects session cookie, validates against PostgreSQL, returns `{ authenticated: true, user }` or `{ authenticated: false, user: null }`.
- **Atomic Functional Cutover in Wave B:**
  - Deprecate old flat-file handler in `app/api/customer-auth/route.ts`.
  - Update UI callers (`app/user-login/page.tsx`, `components/customer/CustomerDashboardClient.tsx`, `components/layout/Navbar.tsx`) in this same wave so customer auth remains functionally green across the checkpoint.
- **Wave B Checkpoint:** Commit message `feat(auth): implement core customer registration, login, logout, and session engine with CSRF and rate limits` -> Tag `phase3-wave-b-core-auth`.

---

## 5. Wave C — Order Ownership & Customer Dashboard Integration

### 5.1 Task 6: Authenticated Checkout Order Ownership
- **Target File:** `app/api/orders/route.ts`
- **TDD Requirement:** Integration tests in `tests/customer-order-ownership.test.ts`.
- **Execution Flow:**
  1. Before entering Phase-2 commerce transaction, inspect request cookie for `pure_haven_customer_session`.
  2. If session valid and `user.isActive === true` $\rightarrow$ `resolvedUserId = user.id`.
  3. Else $\rightarrow$ `resolvedUserId = null` (Guest Order).
  4. Ignore any `userId` or `customerUserId` provided in the incoming JSON body.
  5. Pass `resolvedUserId` to `prisma.order.create({ data: { ..., userId: resolvedUserId } })`.
- **Commerce Integrity:** Inventory reservation, submission token idempotency, and payment records remain 100% compliant with Phase-2 invariants.

### 5.2 Task 7: Customer Order History & Dashboard IDOR Elimination
- **Target Files:** `app/api/customer-orders/route.ts`, `components/customer/CustomerDashboardClient.tsx`
- **TDD Requirement:** Security isolation tests in `tests/customer-orders-idor.test.ts`.
- **Backend Changes:**
  - Delete legacy phone lookup (`where: { customerPhone: user.phone }`).
  - Require valid session:
    ```ts
    const sessionResult = await getCustomerSessionFromRequest(req);
    if (!sessionResult.authenticated || !sessionResult.user) {
      return NextResponse.json({ success: false, message: "Customer login required." }, { status: 401 });
    }
    const orders = await prisma.order.findMany({
      where: { userId: sessionResult.user.id },
      include: { items: true, paymentRecord: true },
      orderBy: { createdAt: "desc" },
    });
    ```
- **Frontend Changes:**
  - Update `CustomerDashboardClient` to rely on `GET /api/customer-auth/session` for user state.
  - Render user details (Name, Email, Phone), active order summaries, and one-click logout.
  - Redirect unauthenticated users gracefully to `/user-login?next=/customer/dashboard`.
- **Wave C Checkpoint:** Commit message `feat(auth): bind Order.userId in checkout and eliminate customer orders IDOR` -> Tag `phase3-wave-c-order-ownership`.

---

## 6. Wave D — Password Recovery, Email Verification & Second Identifiers

### 6.1 Task 8: Mailer Interface & Token Lifecycles (`lib/customerMailer.ts`)
- **Mailer Interface (`CustomerAuthMailer`):**
  - `sendPasswordReset(email: string, rawToken: string): Promise<boolean>`
  - `sendEmailVerification(email: string, rawToken: string): Promise<boolean>`
  - Test/Dev: Deterministic in-memory test transport exposing tokens strictly inside test code (no raw tokens in ordinary logs).
  - Production: `DEFERRED_LAUNCH_INFRASTRUCTURE`. If unconfigured, do not leak raw token; return enumeration-safe generic response.
  - *Rule:* External mail transport network I/O is never invoked inside a long-lived database transaction.

### 6.2 Task 9: Password Reset & Email Verification Routes
- **Target Files:** `app/api/customer-auth/password-reset/route.ts`, `app/api/customer-auth/email-verification/route.ts`
- **TDD Requirement:** Token lifecycle tests in `tests/customer-auth-tokens.test.ts`.
- **Password Reset Flow (With Immediate Rate Limits & Same-Origin):**
  - Rate limits: **3/hour per client**, **3/hour per account key**, **30/hour global**.
  - Request: Validates recovery email; invalidates previous unconsumed reset tokens; creates `CustomerAuthToken` (`purpose: PASSWORD_RESET`, 30-min expiry, hashed at rest); dispatches email outside DB transaction; returns generic response.
  - Confirm: Same-origin guard; claims active token once; updates `passwordHash`; marks token consumed; revokes **all** active `CustomerSession` rows for that user in single DB transaction.
- **Email Verification Flow (With Immediate Rate Limits & Same-Origin):**
  - Rate limits: **3/hour per client**, **3/hour per user key**, **30/hour global**.
  - Request: Invalidates previous tokens; creates 24-hour verification token; dispatches email outside DB transaction.
  - Confirm: Same-origin guard; claims token once; updates `User.emailVerifiedAt = now()`.

### 6.3 Task 10: Second Identifier Management (Account Settings)
- **Target File:** `app/api/customer-auth/identity/route.ts`
- **TDD Requirement:** Identity mutation tests in `tests/customer-identity-management.test.ts`.
- **Supported Actions:** `ADD_EMAIL`, `CHANGE_EMAIL`, `ADD_PHONE`, `CHANGE_PHONE`.
- **Mandatory Security Controls Pre-Wired:**
  1. Active authenticated customer session.
  2. Same-origin CSRF validation (`validateSameOrigin`).
  3. Current password re-entry verified against `user.passwordHash`.
  4. Server normalization (`parseAndNormalizePhone` or email lowercase/trim).
  5. PostgreSQL uniqueness constraint enforcement.
  6. Email update resets `emailVerifiedAt = null` and sends verification link; Phone update resets `phoneVerifiedAt = null`.
  7. Old identifier immediately stops authenticating upon transaction commit.
  8. Zero historical guest order linking.
- **Wave D Checkpoint:** Commit message `feat(auth): implement password reset, email verification, and second identifier management` -> Tag `phase3-wave-d-recovery-identifiers`.

---

## 7. Wave E — Auth UX & Hardening Completion

### 7.1 Task 11: Unified Auth Form & Client UX Polish
- **Target Files:** `app/user-login/page.tsx`, `components/layout/Navbar.tsx`, `components/customer/CustomerDashboardClient.tsx`
- **Deliverables:**
  1. Unified single login form: "Email or Phone Number", "Password", "Show/Hide Password", "Forgot Password", "Create Account".
  2. Minimal registration form: "Name", "Email or Phone Number", "Password".
  3. Purge legacy localStorage auth keys on app boot and logout: `pure_haven_customer_logged_in`, `pure_haven_customer_name`, `pure_haven_customer_email`, `pure_haven_customer_phone`.
  4. Mobile-first polish: 375px+ responsive viewports, large tap targets, semantic `tel`/`email`/`current-password` inputs, browser autofill and password manager support.
  5. Phone-only recovery notice: Non-blocking dashboard and account settings prompt to add a recovery email address.
  6. Graceful session expiration handling with safe return-to navigation.

### 7.2 Task 12: Consolidated Security Audit & Hardening
- **Target Files:** `lib/csrf.ts`, `lib/rateLimitPolicy.ts`
- **Deliverables:**
  1. Application-wide audit verifying all customer state-changing endpoints enforce `validateSameOrigin`.
  2. Verification that Phase-1 admin authentication remains 100% compatible and isolated.
  3. Verified generic human-friendly error messages across all auth failures (zero Prisma error codes or stack traces).
- **Wave E Checkpoint:** Commit message `feat(auth): polish single-form customer auth UX, mobile responsiveness, and finalize hardening` -> Tag `phase3-wave-e-auth-ux-hardening`.

---

## 8. Wave F — Real PostgreSQL Concurrency, Regression & Final Lock

### 8.1 Task 13: Dedicated Real PostgreSQL Concurrency Suite (`DATABASE_URL_TEST`)
- **Target File:** `tests/integration/customer-auth-concurrency.test.ts`
- **Safety Gate:** Reuses `tests/integration/db-safety.ts` to guarantee `DATABASE_URL_TEST` exists and is isolated from live Neon.
- **12 Mandatory Real PostgreSQL Concurrency Scenarios & Evidence Classification:**

| Scenario | Title | Target Actor / Primitive | Orchestration Level | Key Persisted Invariant |
|---|---|---|---|---|
| **1** | Concurrent Duplicate Email Registration | 2 concurrent registrations with same email | `FULL_PRODUCTION_ORCHESTRATION` (`/api/customer-auth/register`) | Exactly 1 `User` row created, 1 returns 409 Conflict |
| **2** | Concurrent Equivalent-Format Phone Registration | 2 concurrent registrations (`01711223344` vs `+8801711223344`) | `FULL_PRODUCTION_ORCHESTRATION` (`/api/customer-auth/register`) | Canonical `01711223344` unique constraint prevents duplicate insert |
| **3** | Session Token Uniqueness Injection | Direct DB insert race on identical `tokenHash` | `REAL_DB_PRIMITIVE` (`CustomerSession.tokenHash` unique constraint) | Unique B-tree constraint rejects duplicate session token |
| **4** | Concurrent Password Reset Consumption | 2 concurrent requests using the same reset token | `FULL_PRODUCTION_ORCHESTRATION` (`/api/customer-auth/password-reset/confirm`) | Exactly 1 consumes token and updates password, 1 rejected |
| **5** | Concurrent Email Verification Confirmation | 2 concurrent requests using same verification token | `FULL_PRODUCTION_ORCHESTRATION` (`/api/customer-auth/email-verification/confirm`) | Exactly 1 consumes, idempotent replay, `emailVerifiedAt` set once |
| **6** | Logout Revocation Linearization | Concurrent request during logout revocation | `FULL_PRODUCTION_ORCHESTRATION` (`validateCustomerSession` vs `revokeCustomerSession`) | Post-commit validation fails closed (401); pre-commit operation finishes |
| **7** | Disabled User Active Session Invalidation | Active session token inspected after `User.isActive = false` | `FULL_PRODUCTION_ORCHESTRATION` (`validateCustomerSession`) | Validation immediately fails closed with 401 |
| **8** | Multi-Device Session Independence | 2 active sessions for 1 user; Device A logs out | `FULL_PRODUCTION_ORCHESTRATION` (`revokeCustomerSession`) | Device A session revoked; Device B session remains valid |
| **9** | Concurrent Second Identifier Collision | Concurrent attempt to attach an existing identifier in settings | `FULL_PRODUCTION_ORCHESTRATION` (`/api/customer-auth/identity`) | Exactly 1 attaches identifier, 1 fails with unique constraint conflict |
| **10** | Authenticated Checkout Order Ownership | Authenticated checkout with injected body `userId` | `FULL_PRODUCTION_ORCHESTRATION` (`/api/orders`) | Server derives `Order.userId = session.userId`; injected ID ignored |
| **11** | Logged-In Submission Token Idempotency | Concurrent duplicate checkout submissions from logged-in user | `FULL_PRODUCTION_ORCHESTRATION` (`/api/orders`) | Exactly 1 order row created with correct `userId` and inventory lock |
| **12** | Customer Order Isolation (IDOR Block) | User A queries `/api/customer-orders`; victim phone registered | `FULL_PRODUCTION_ORCHESTRATION` (`/api/customer-orders`) | User A sees only own orders; victim phone registration reveals 0 guest orders |

### 8.2 Task 14: Fresh Full Verification Gate & Browser QA Protocol
- **Automated Regression Commands:**
  ```bash
  # 1. Real PostgreSQL Concurrency Suite
  node -e "const { execSync } = require('node:child_process'); execSync('npx tsx --test tests/integration/db-safety.test.ts tests/integration/customer-auth-concurrency.test.ts', { env: { ...process.env, DATABASE_URL_TEST: 'postgresql://purehaven_test:test_isolated_secret_pass_123@127.0.0.1:55499/pure_haven_phase2_test?schema=public' }, stdio: 'inherit' });"

  # 2. Complete Repository Test Suite (Phase 1 Admin + Phase 2 Commerce + Phase 3 Customer Auth)
  npx tsx --test tests/*.test.ts

  # 3. TypeScript, Next.js Build, Lint, Diff Checks
  npx tsc --noEmit
  npm run build
  npx eslint lib/customerAuth.ts lib/customerSession.ts lib/csrf.ts app/api/customer-auth/
  git diff --check

  # 4. Live DB Status & Migration Drift Checks
  npx prisma migrate status
  npx prisma migrate diff --from-config-datasource --to-schema=prisma/schema.prisma --script
  ```
- **Actual Browser QA (`chrome-devtools-mcp` against TEST DB Runtime):**

| Journey | Evidence Type | Validated State & Observations |
|---|---|---|
| **A. Email Registration & Immediate Session** | `ACTUAL_BROWSER` | Form registration with email $\rightarrow$ immediate session issued $\rightarrow$ redirected to `/customer/dashboard`. |
| **B. Phone Registration & Phone-Only Notice** | `ACTUAL_BROWSER` | Form registration with phone $\rightarrow$ immediate session issued $\rightarrow$ non-blocking prompt to add recovery email. |
| **C. Email Password Login** | `ACTUAL_BROWSER` | Unified login form with email $\rightarrow$ successful login $\rightarrow$ 7-day session established. |
| **D. Phone Password Login** | `ACTUAL_BROWSER` | Unified login form with formatted phone $\rightarrow$ canonical normalization $\rightarrow$ successful login. |
| **E. Wrong Password & Error UX** | `ACTUAL_BROWSER` | Invalid password $\rightarrow$ generic `"Email/phone or password is incorrect."` without account enumeration. |
| **F. Authenticated Checkout** | `ACTUAL_BROWSER` | Logged-in user checks out $\rightarrow$ order created with `Order.userId` $\rightarrow$ visible in customer dashboard. |
| **G. Guest Checkout Preservation** | `ACTUAL_BROWSER` | Unauthenticated checkout $\rightarrow$ order created with `Order.userId = null` $\rightarrow$ public tracking works. |
| **H. Second Identifier Management** | `ACTUAL_BROWSER` | Authenticated user adds email/phone with password re-auth $\rightarrow$ can log in with both identifiers. |
| **I. Logout & Session Revocation** | `ACTUAL_BROWSER` | One-click logout $\rightarrow$ session revoked in DB $\rightarrow$ cookie cleared $\rightarrow$ navigating back redirects to login. |
| **J. Responsive Viewports & Accessibility** | `ACTUAL_BROWSER` | Desktop (1920px), Tablet (768px), and Mobile (375px) inspected with 0 horizontal overflow and usable tap targets. |
| **K. Console & Network Health** | `ACTUAL_BROWSER` | 0 unhandled promise rejections, 0 unexpected 500 errors, 0 raw tokens in logs. |

- **Wave F Checkpoint:** Commit message `test(auth): verify real postgres customer auth concurrency, regression, and browser QA` -> Tag `phase3-complete`.

---

## 9. Database Safety & Test Isolation Protocol

1. **Strict Neon Protection:** Normal database (`ep-falling-lake-am490jqe-pooler.c-5.us-east-1.aws.neon.tech / neondb`) must experience **zero** test mutation queries.
2. **Dedicated Test Container:** Real PostgreSQL concurrency tests run exclusively against local Docker container `pure-haven-phase2-test-postgres` on `127.0.0.1:55499` (`DATABASE_URL_TEST`).
3. **Safety Gate Enforcement:** Every integration test invokes `assertDatabaseSafety()` before executing schema operations.

---

## 10. Commercial Infrastructure Dependencies & Risk Register

| Dependency | Classification | Status & Mitigation |
|---|---|---|
| `releaseExpiredReservations` Scheduler | `DEFERRED_LAUNCH_INFRASTRUCTURE` | Preserved from Phase 2; engine ready, cron invocation to be wired prior to launch. |
| Production Outbound Email Transport | `DEFERRED_LAUNCH_INFRASTRUCTURE` | Provider-neutral SMTP/API interface; test mock transport used during Phase 3 development. |
| Automated SMS Gateway (Phone Recovery) | `DEFERRED_PRODUCT_INFRASTRUCTURE` | SMS recovery explicitly out of scope for Phase 3; phone-only users prompted to add recovery email. |
| Production HTTPS | `LAUNCH_PREREQUISITE` | Required for `Secure: true` cookie enforcement in production environment. |

---

## 11. Acceptance Matrix

| Requirement | Design Reference | Implementation Verification |
|---|---|---|
| Single Login Form (Email or Phone + Password) | Spec §2.1, §2.4 | `tests/customer-auth-routes.test.ts` (Login with email & phone) |
| Minimal 3-Field Registration | Spec §6.2 | `tests/customer-auth-routes.test.ts` (Register email-only & phone-only) |
| Strict Bangladesh Phone Normalization | Spec §2.3 | `tests/customer-crypto-normalization.test.ts` (Accepted & rejected patterns) |
| PostgreSQL CHECK Constraints | Spec §3.2 | Schema migration SQL & test DB insertion validation |
| Opaque Database Sessions (Hashed at Rest) | Spec §5.1, §5.2 | `tests/customer-session-service.test.ts` (Token hash in DB, raw in cookie) |
| Order Ownership (`Order.userId`) | Spec §8.1, §8.2 | `tests/customer-order-ownership.test.ts` (Checkout server-derived FK) |
| Customer Orders IDOR Elimination | Spec §8.2 | `tests/customer-orders-idor.test.ts` (Cross-account isolation & phone spoof block) |
| Zero Historical Guest Order Linking | Spec §11 | `tests/customer-orders-idor.test.ts` (Guest orders remain unlinked) |
| Password Reset & Token Invalidation | Spec §7.1, §7.2, §8.1 | `tests/customer-auth-tokens.test.ts` (Single-use, session wipe on reset) |
| Second Identifier Management | Spec §9.1–9.3 | `tests/customer-identity-management.test.ts` (Add/change with password re-auth) |
| CSRF Validation (`APP_ORIGIN`) | Spec §6.1, §6.2 | `tests/csrf-protection.test.ts` (POST, PUT, PATCH, DELETE same-origin check) |
| Rate Limiting (Pre-Hash CPU Protection) | Spec §7 | `tests/customer-rate-limit.test.ts` (Per-client & global safety valves) |
| Phase 1 & 2 Full Regression | Spec §1.2 | `npm test` & `npx tsx --test tests/*.test.ts` (100% green pass) |
| Real PostgreSQL Concurrency Suite | Spec §12 | `tests/integration/customer-auth-concurrency.test.ts` (12 scenarios pass) |
