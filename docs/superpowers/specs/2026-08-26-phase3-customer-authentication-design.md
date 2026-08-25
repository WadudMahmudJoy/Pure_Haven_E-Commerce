# Pure Haven BD â€” Phase 3 Customer Authentication Design & Specification
**Authoritative Architectural Specification â€” Phase 3**
**Date:** 2026-08-26
**Status:** DRAFT SPECIFICATION (READY FOR LOCK)
**Baseline SHA:** `445cb308f2f0dbec0909f6c46f980aacc6531fbb` (`phase2-complete`)

---

## 1. Executive Summary & Primary Product Principles

### 1.1 Product Vision
Pure Haven BD customer authentication must be:
- **SIMPLE:** Minimal fields, clear language, single unified login entry point.
- **FAST:** Minimal round-trips, indexed database lookups, async cryptographic hashing.
- **FLEXIBLE:** Customers can register and authenticate using either **Email + Password** or **Phone Number + Password**.
- **MOBILE-FIRST:** Optimized for 375px+ viewports, semantic input types, responsive tap targets, and browser autofill/password managers.
- **FORGIVING:** Relaxed password rules, clear human-friendly error messages, persistent 7-day sessions.
- **SECURE:** PostgreSQL persistence, database-backed opaque CSPRNG session tokens (hashed at rest), atomic transaction isolation, strict rate limiting, CSRF same-origin validation across all unsafe methods, and complete elimination of IDOR vulnerabilities.

### 1.2 Non-Negotiable Core Tenets
1. **User Convenience Must Not Weaken Security:** Frictionless UX is achieved through thoughtful interface design and backend normalization, never by storing plaintext cookies, trusting client localStorage, or associating orders by unverified string matches.
2. **First-Class Guest Checkout:** Registration and login are strictly optional conveniences. Guest checkout is never blocked or degraded.
3. **Strict Order Ownership Isolation:** Orders belong to a user strictly through the immutable database foreign key `Order.userId`. Legacy phone-string lookup (`customerPhone = user.phone`) is permanently eliminated. Historical guest orders are **never automatically claimed** merely because a phone number or email matches.
4. **Phase-1 & Phase-2 Preservation:** Phase-1 Admin Authentication (`data/admin-auth.json`, `pure_haven_admin_session`, `proxy.ts`, `requireAdmin`) and Phase-2 Commerce & Inventory Integrity (atomic reservations, submission tokens, `PaymentRecord` authority, return restock) remain completely isolated and intact.

---

## 2. Customer Identity & Normalization Architecture

### 2.1 Flexible Customer Identifier Model
A customer account is identified by at least one unique credential:
- **Email Address** (e.g. `customer@example.com`)
- **Phone Number** (e.g. `01711223344`)
- **Both** (if the customer provides or adds both)

A customer with both an email and a phone number registered on their account may log in using **either** identifier with their password.

```
       [ Single Login Form ]
         "Email or Phone Number"
                 â”‚
                 â–¼
       [ Deterministic Identifier Classifier ]
        /                                   \
       / Contains "@"                        \ Strict BD Phone Format
      â–¼                                       â–¼
 [ Canonical Email Normalization ]     [ Strict BD Phone Parser ]
      â”‚                                       â”‚
      â–¼                                       â–¼
 Query User WHERE email = ...          Query User WHERE normalizedPhone = ...
```

---

### 2.2 Canonical Email Normalization
- **Algorithm:**
  1. Trim leading and trailing whitespace: `input.trim()`.
  2. Lowercase the entire string: `input.toLowerCase()`.
- **Prohibitions:**
  - Do NOT remove dots from Gmail addresses (e.g. `john.doe@gmail.com` != `johndoe@gmail.com`).
  - Do NOT strip sub-addressing / plus aliases (e.g. `user+promo@domain.com`).
- **Validation:** Standard RFC 5322 regex / format validation (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), bounded to maximum 255 characters.

---

### 2.3 Strict Bangladesh Phone Parser & Normalization
- **Purpose:** Deterministically parse and normalize only valid Bangladeshi phone numbers, rejecting malformed text, extra digits, or ambiguous inputs.
- **Accepted Semantic Input Forms:**
  - Local format: `01[3-9]\d{8}` (11 digits)
  - International with country code: `8801[3-9]\d{8}` (13 digits)
  - International with plus: `+8801[3-9]\d{8}` (14 characters)
- **Valid Operator Prefixes:** `013`, `014`, `015`, `016`, `017`, `018`, `019`.
- **Formatting Allowance:** Punctuation characters such as whitespace, hyphens (`-`), or parentheses (`()`) may be stripped **only** when they do not alter the semantic sequence.
- **Strict Rejections:**
  - Extra leading or trailing digits (e.g. `017112233445`, `001711223344`).
  - Arbitrary embedded text (e.g. `"call me 01711223344"`).
  - Invalid operator prefixes (e.g. `010`, `011`, `012`).
  - Wrong country codes (e.g. `+101711223344`, `+9101711223344`).
- **Canonical Stored Representation:** **Standard 11-digit local format: `01XXXXXXXXX`** (e.g. `01711223344`).
- **Strict Parser Implementation (`lib/customerAuth.ts`):**
  ```ts
  export function parseAndNormalizePhone(raw: string): string | null {
    if (!raw || typeof raw !== "string") return null;

    const trimmed = raw.trim();
    // Validate that input consists strictly of allowed phone characters
    if (!/^[+\d\s\-()]+$/.test(trimmed)) {
      return null;
    }

    // Strip allowed punctuation
    const clean = trimmed.replace(/[\s\-()]/g, "");

    // Pattern 1: +8801[3-9]\d{8}
    if (/^\+8801[3-9]\d{8}$/.test(clean)) {
      return clean.slice(3); // Returns 01XXXXXXXXX
    }

    // Pattern 2: 8801[3-9]\d{8}
    if (/^8801[3-9]\d{8}$/.test(clean)) {
      return clean.slice(2); // Returns 01XXXXXXXXX
    }

    // Pattern 3: 01[3-9]\d{8}
    if (/^01[3-9]\d{8}$/.test(clean)) {
      return clean;
    }

    return null; // Strict rejection
  }
  ```

---

### 2.4 Deterministic Identifier Classifier
The single-form identifier parser deterministically resolves input type:
```ts
export type ParsedIdentifier =
  | { type: "EMAIL"; value: string }
  | { type: "PHONE"; value: string }
  | { type: "INVALID" };

export function classifyIdentifier(raw: string): ParsedIdentifier {
  if (!raw || typeof raw !== "string") return { type: "INVALID" };
  const trimmed = raw.trim();
  if (!trimmed) return { type: "INVALID" };

  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 255) {
      return { type: "EMAIL", value: email };
    }
    return { type: "INVALID" };
  }

  const phone = parseAndNormalizePhone(trimmed);
  if (phone) {
    return { type: "PHONE", value: phone };
  }

  return { type: "INVALID" };
}
```

---

## 3. Database Schema Design (PostgreSQL / Prisma)

### 3.1 Conceptual Prisma Models (Non-Executed Draft)

```prisma
// =============================================================================
// CUSTOMER IDENTITY & AUTHENTICATION (PHASE 3)
// =============================================================================

model User {
  id              String    @id @default(cuid())
  name            String
  email           String?   @unique
  normalizedPhone String?   @unique
  passwordHash    String
  emailVerifiedAt DateTime?
  phoneVerifiedAt DateTime?
  isActive        Boolean   @default(true)
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  orders          Order[]
  sessions        CustomerSession[]
  authTokens      CustomerAuthToken[]
}

model CustomerSession {
  id        String    @id @default(cuid())
  userId    String
  tokenHash String    @unique // SHA-256 hash of raw CSPRNG cookie token
  createdAt DateTime  @default(now())
  expiresAt DateTime
  revokedAt DateTime?
  userAgent String?
  ipAddress String?

  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([expiresAt])
  @@index([revokedAt])
}

enum AuthTokenPurpose {
  PASSWORD_RESET
  EMAIL_VERIFICATION
}

model CustomerAuthToken {
  id         String           @id @default(cuid())
  userId     String
  purpose    AuthTokenPurpose
  tokenHash  String           @unique // SHA-256 hash of raw CSPRNG token
  expiresAt  DateTime
  consumedAt DateTime?
  createdAt  DateTime         @default(now())

  user       User             @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, purpose])
  @@index([expiresAt])
  @@index([consumedAt])
}

// =============================================================================
// COMMERCE EXTENSION (PHASE 3)
// =============================================================================

model Order {
  // ... existing Phase-2 fields (id, orderId, submissionToken, customerName, etc.)

  userId    String?   // Nullable FK -> User (null indicates Guest Order)
  user      User?     @relation(fields: [userId], references: [id], onDelete: Restrict)

  // ... existing relations (items, paymentRecord)

  @@index([userId])
}
```

### 3.2 PostgreSQL Integrity Authority & CHECK Constraints
Application validation provides human-friendly error messages, but PostgreSQL constraints serve as the final immutable integrity authority.
The Phase-3 migration will explicitly add two table-level CHECK constraints:

```sql
-- 1. Invariant: User must possess at least one identifier
ALTER TABLE "User" ADD CONSTRAINT "user_has_at_least_one_identifier"
CHECK ("email" IS NOT NULL OR "normalizedPhone" IS NOT NULL);

-- 2. Invariant: Stored email must always be canonical lowercase
ALTER TABLE "User" ADD CONSTRAINT "user_email_must_be_canonical_lowercase"
CHECK ("email" IS NULL OR "email" = lower("email"));
```

### 3.3 Index Streamlining & Referential Integrity
- **Redundant Index Removal:** Redundant `@@index([email])`, `@@index([normalizedPhone])`, and `@@index([isActive])` are eliminated. Unique B-trees generated by `@unique` serve all single-column lookups.
- **Retained Demonstrated Indexes:** `CustomerSession(userId)`, `CustomerSession(expiresAt)`, `CustomerSession(revokedAt)`, `CustomerAuthToken(userId, purpose)`, `CustomerAuthToken(expiresAt)`, `CustomerAuthToken(consumedAt)`, `Order(userId)`.
- **Order Referential Action (`onDelete: Restrict`):** Customer lifecycle deactivation uses `isActive = false`. Hard deletion of users with order history is blocked to permanently protect accounting and financial records.

---

## 4. Password Security & Cryptographic Architecture

### 4.1 Asynchronous Node.js `scrypt` Hashing
- **Hashing Function:** Native `node:crypto` `scrypt` (asynchronous Promisified, non-blocking).
- **Parameters (Production Grade):**
  - **Salt:** 16 cryptographically secure random bytes (`crypto.randomBytes(16)`).
  - **Derived Key Length:** 64 bytes (512 bits).
  - **Cost Factor ($N$):** $16384$ ($2^{14}$).
  - **Block Size ($r$):** $8$.
  - **Parallelization ($p$):** $1$.
  - **Max Memory:** $32 \text{ MB}$.
- **Serialized Hash Format:** `scrypt$N=16384,r=8,p=1$<saltHex>$<derivedKeyHex>`
- **Verification:** Constant-time buffer comparison via `crypto.timingSafeEqual(derivedKey, expectedKey)`.

### 4.2 Password Bounds & UX
- **Minimum Length:** **8 characters**.
- **Maximum Length:** **128 characters** (protects server CPU against hash denial-of-service).
- **Complexity Rules:** **NONE**. No arbitrary uppercase/symbol mandates.
- **Trimming:** Passwords are never trimmed or transformed.
- **Client Controls:** Clear "Show / Hide Password" toggle.

---

## 5. Session, Cookie & Logout Linearization Architecture

### 5.1 Opaque Database-Backed Sessions
- **Session Token Generation:** 32 bytes CSPRNG (`crypto.randomBytes(32)`), Base64URL-encoded (256 bits of entropy).
- **Storage at Rest:** Database `CustomerSession.tokenHash` stores `sha256(rawToken)`. Plaintext tokens are **never** stored in the database.
- **Session Duration:** 7 days (`expiresAt = now + 7 days`).

### 5.2 Session Cookie Contract (`pure_haven_customer_session`)
- **Name:** `pure_haven_customer_session`
- **Payload:** Raw Base64URL token string **only**.
- **Attributes:**
  - `HttpOnly`: `true`
  - `SameSite`: `"Lax"`
  - `Secure`: `true` in production (`process.env.NODE_ENV === "production"`)
  - `Path`: `"/"`
  - `Max-Age`: `604800` (7 days)

### 5.3 Logout Revocation & Concurrency Linearization Point
- **Linearization Point:** The commit of the database transaction setting `CustomerSession.revokedAt = now()` is the authoritative linearization point for logout.
- **Semantics:**
  1. Any request that executes session validation **after** the revocation transaction commits **must fail authentication** (returning HTTP 401).
  2. A concurrent request that already completed successful session authorization **before** the revocation transaction committed is permitted to complete normally. (Logout does not retroactively invalidate already-authorized in-flight computations).
- **Password Reset Revocation:** Confirmation of a password reset atomically sets `revokedAt = now()` across **all** active `CustomerSession` rows for that `userId`.
- **Account Disable:** Inactive users (`isActive = false`) immediately fail session validation upon the next database read.
- **Multi-Device Support:** Logging out on Device A revokes Device A's session row without terminating Device B's independent session.

---

## 6. CSRF Protection Across All Unsafe Methods

### 6.1 Server-Side Same-Origin Validation
A reusable server-only validation utility guards all cookie-authenticated state-changing operations across `POST`, `PUT`, `PATCH`, and `DELETE`.

### 6.2 Trusted Origin Authority
- **Production Authority:** The trusted origin is derived **strictly from server-only configuration: `process.env.APP_ORIGIN`**.
- **Prohibitions:** The trusted origin is **never** derived from untrusted client inputs: `Host`, `X-Forwarded-Host`, request URL, `NEXT_PUBLIC_APP_URL`, or any other `NEXT_PUBLIC_*` variable.
- **Fail-Closed Policy:** In production, if `APP_ORIGIN` is missing or invalid, the same-origin guard **fails closed** for all cookie-authenticated unsafe mutations.
- **Development / Test Allowlist:** In non-production environments (`NODE_ENV !== "production"`), only explicitly configured origins are permitted (e.g. `http://localhost:3000`, `http://127.0.0.1:3000`, `http://localhost:3005` for test runners). Arbitrary ports or hosts outside the explicit allowlist are rejected.

```ts
// lib/csrf.ts
const DEV_ALLOWLIST = new Set([
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3005",
]);

export function validateSameOrigin(req: Request): boolean {
  const method = req.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return true; // Safe methods pass
  }

  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");

  // Production check
  if (process.env.NODE_ENV === "production") {
    const trustedOrigin = process.env.APP_ORIGIN;
    if (!trustedOrigin) return false; // Fail closed

    if (origin) return origin === trustedOrigin;
    if (referer) {
      try {
        return new URL(referer).origin === trustedOrigin;
      } catch {
        return false;
      }
    }
    return false; // Reject missing Origin/Referer
  }

  // Development / Test check
  const candidateOrigin = origin || (referer ? new URL(referer).origin : null);
  if (!candidateOrigin) return false;
  return DEV_ALLOWLIST.has(candidateOrigin) || candidateOrigin === process.env.APP_ORIGIN;
}
```

---

## 7. Comprehensive Rate Limiting Policies

All rate limits are evaluated **before** expensive cryptographic hashing operations.

```ts
// lib/rateLimitPolicy.ts (Customer Auth Policies)

// 1. Customer Login
export const CUSTOMER_LOGIN_MAX_ATTEMPTS_PER_CLIENT = 5;
export const CUSTOMER_LOGIN_WINDOW_SECONDS = 900; // 15 minutes
export const CUSTOMER_LOGIN_GLOBAL_MAX_ATTEMPTS = 60;
export const CUSTOMER_LOGIN_GLOBAL_WINDOW_SECONDS = 60; // 60 seconds

// 2. Customer Registration
export const CUSTOMER_REGISTER_MAX_ATTEMPTS_PER_CLIENT = 3;
export const CUSTOMER_REGISTER_WINDOW_SECONDS = 3600; // 1 hour
export const CUSTOMER_REGISTER_GLOBAL_MAX_ATTEMPTS = 30;
export const CUSTOMER_REGISTER_GLOBAL_WINDOW_SECONDS = 3600; // 1 hour

// 3. Password Reset Request
export const CUSTOMER_PASSWORD_RESET_PER_CLIENT = 3;
export const CUSTOMER_PASSWORD_RESET_CLIENT_WINDOW_SECONDS = 3600; // 1 hour
export const CUSTOMER_PASSWORD_RESET_PER_ACCOUNT = 3;
export const CUSTOMER_PASSWORD_RESET_ACCOUNT_WINDOW_SECONDS = 3600; // 1 hour
export const CUSTOMER_PASSWORD_RESET_GLOBAL_MAX_ATTEMPTS = 30;
export const CUSTOMER_PASSWORD_RESET_GLOBAL_WINDOW_SECONDS = 3600; // 1 hour

// 4. Email Verification Resend
export const CUSTOMER_VERIFY_RESEND_PER_CLIENT = 3;
export const CUSTOMER_VERIFY_RESEND_CLIENT_WINDOW_SECONDS = 3600; // 1 hour
export const CUSTOMER_VERIFY_RESEND_PER_USER = 3;
export const CUSTOMER_VERIFY_RESEND_USER_WINDOW_SECONDS = 3600; // 1 hour
export const CUSTOMER_VERIFY_RESEND_GLOBAL_MAX_ATTEMPTS = 30;
export const CUSTOMER_VERIFY_RESEND_GLOBAL_WINDOW_SECONDS = 3600; // 1 hour
```

---

## 8. Auth Token Lifecycles & Invalidation Rules

### 8.1 Password Reset Token Policy
- **Lifetime:** **30 minutes** (`expiresAt = now + 30 minutes`).
- **Single-Use:** Token is marked `consumedAt = now()` upon successful reset.
- **Resend Invalidation:** Requesting a new reset token atomically marks all existing unconsumed `PASSWORD_RESET` tokens for that `userId` as consumed/revoked before creating the new token. Only the newest active reset link remains usable.
- **Session Revocation:** Successful confirmation atomically revokes **all** active `CustomerSession` rows for that user.

### 8.2 Email Verification Token Policy
- **Lifetime:** **24 hours** (`expiresAt = now + 24 hours`).
- **Single-Use:** Token is marked `consumedAt = now()` upon successful confirmation, setting `User.emailVerifiedAt = now()`.
- **Resend Invalidation:** Resending an email verification token atomically marks all existing unconsumed `EMAIL_VERIFICATION` tokens for that `userId` as consumed/revoked. Only the newest verification token is valid.

---

## 9. Second Identifier Management (Account Settings Exact Contract)

Phase 3 supports: **`ADD EMAIL`**, **`CHANGE EMAIL`**, **`ADD PHONE`**, **`CHANGE PHONE`**.

### 9.1 Mandatory Security Prerequisites
Every identity add or change action requires:
1. An active, valid authenticated customer session.
2. Mandatory re-entry of the customer's **current password**.
3. Successful server-side password verification prior to processing the change.
4. Server-side canonical normalization (`parseAndNormalizePhone` or email lowercase/trim).
5. PostgreSQL uniqueness constraint enforcement.
6. Zero client authority over `userId`.

### 9.2 Email Mutation Contract (`ADD EMAIL` / `CHANGE EMAIL`)
- **Login Availability:** Upon transaction commit, the new email becomes an active password-login identifier immediately.
- **Verification State:** `User.emailVerifiedAt` is set to `null`, and a verification email token is dispatched.
- **Old Email Invalidation:** The old email immediately stops authenticating upon transaction commit.
- **Recovery Eligibility:** The new email is **NOT recovery-eligible** until it is verified (`emailVerifiedAt IS NOT NULL`).
- **Identity Proof:** The new unverified email is NOT strong identity proof.
- **UI Warning:** If the customer is replacing an already-verified recovery email, the UI displays a clear warning: *"Changing your email address will require re-verifying the new address before it can be used for password recovery."*

### 9.3 Phone Mutation Contract (`ADD PHONE` / `CHANGE PHONE`)
- **Login Availability:** Upon transaction commit, the canonical normalized phone (`01XXXXXXXXX`) becomes the active phone password-login identifier immediately.
- **Verification State:** `User.phoneVerifiedAt` remains `null` (no SMS verification claimed).
- **Old Phone Invalidation:** The old phone number immediately stops authenticating upon transaction commit.
- **Order Isolation:** Adding or changing an email or phone number **never** links, associates, or exposes historical guest orders.

---

## 10. Phone-Only Password Recovery UX

1. **Infrastructure Reality:** Automated SMS gateway infrastructure is categorized as `DEFERRED_PRODUCT_INFRASTRUCTURE`. Phone-only accounts have no automated SMS password reset channel in Phase 3.
2. **Transparent UX:**
   - Phone-only registration remains fully permitted.
   - After login, the dashboard displays a non-blocking prompt: *"Add an email address to enable self-service password recovery."*
   - Account settings clearly indicates: `Recovery Email: Not configured (Add Email)`.
3. **Enumeration Resistance:** Submitting a phone-only identifier on the `/forgot-password` page returns the generic confirmation: *"If an account exists with an associated email recovery address, reset instructions have been sent."*

---

## 11. Historical Guest Orders Policy

- **LOCKED POLICY:** Phase 3 implements **NO historical guest order claiming**.
- Orders created without an authenticated session remain permanently `userId = null`.
- No automatic linking occurs by phone number, email, or customer name.
- No manual claiming endpoint is exposed in Phase 3.

---

## 12. Real PostgreSQL Concurrency Verification Scenarios

Phase-3 final integration must verify the following real PostgreSQL concurrency scenarios against a live test database:
1. **Logout Revocation Linearization:** Session validation executed concurrently with logout fails closed once revocation commits; in-flight operations authorized prior to commit succeed.
2. **Post-Revocation Authentication Block:** No subsequent authentication succeeds from a revoked session token.
3. **Concurrent Duplicate Email Registration:** 2 concurrent registrations with the same email $\rightarrow$ Exactly 1 succeeds, 1 returns 409 Conflict.
4. **Concurrent Equivalent-Format Phone Registration:** 2 concurrent registrations (e.g. `01711223344` vs `+8801711223344`) $\rightarrow$ Exactly 1 succeeds, 1 returns 409 Conflict.
5. **Concurrent Password Reset Consumption:** 2 concurrent requests using the same reset token $\rightarrow$ Exactly 1 succeeds, 1 is rejected.
6. **Concurrent Email Verification Confirmation:** 2 concurrent requests using the same verification token $\rightarrow$ Exactly 1 consumes, idempotent replay.
7. **Identifier Uniqueness During Add/Change:** Concurrent attempt to attach an already-registered identifier via Account Settings fails with unique constraint conflict.
8. **Authenticated Checkout Order Ownership:** Server derives `Order.userId` exclusively from session; client-supplied `userId` cannot be injected.

---

## 13. Acceptance Checklist & Authoritative Answers

1. **How does strict phone parsing prevent malformed identity aliases?**
   It validates the full semantic structure against Bangladesh operator prefixes (`01[3-9]\d{8}`), rejecting arbitrary embedded numbers or extra digits.
2. **What DB constraints guarantee integrity?**
   Two PostgreSQL CHECK constraints: `CHECK ("email" IS NOT NULL OR "normalizedPhone" IS NOT NULL)` and `CHECK ("email" IS NULL OR "email" = lower("email"))`.
3. **How can a phone-only registrant later add email?**
   Via authenticated Account Settings (`ADD EMAIL`) with current password re-entry, updating `User.email` and triggering email verification.
4. **How can an email-only registrant later add phone?**
   Via authenticated Account Settings (`ADD PHONE`) with current password re-entry, strictly normalized to `01XXXXXXXXX`.
5. **What happens if a phone-only customer forgets their password without a recovery email?**
   Automated recovery is unavailable. The UI encourages adding an email upfront; external requests return enumeration-resistant generic feedback.
6. **Are POST/PUT/PATCH/DELETE all CSRF protected?**
   Yes. `validateSameOrigin(req)` guards all unsafe HTTP methods.
7. **What trusted value defines same-origin?**
   The server-only `process.env.APP_ORIGIN` environment variable (never arbitrary request `Host` headers or `NEXT_PUBLIC_*` variables).
8. **What are the exact reset and verification rate limits?**
   3 requests / hour per client, 3 requests / hour per account/user key, and 30 requests / hour global CPU safety limit.
9. **What happens to old verification/reset tokens after resend?**
   They are atomically marked consumed/revoked; only the newest active token remains valid.
10. **Why can deleting/disabling a User not destroy Orders?**
    `Order.userId` uses `onDelete: Restrict`. Account lifecycle uses `isActive = false`, retaining all financial and order records.
11. **Why can no historical guest order become visible through string matching?**
    `/api/customer-orders` queries strictly by `Order.userId = session.userId`, eliminating phone-string queries entirely.

---

## 14. Open Questions (Non-Core Future Choices)

1. *Phase 4 Default Delivery Address Prefill:* In Phase 4, should the customer profile store a default delivery address to prefill the checkout form while keeping order delivery details snapshot-independent?
