/**
 * Provider-Neutral Customer Auth Mailer Interface (Phase 3 Wave D)
 *
 * Implements provider-neutral mail boundary for password recovery and email verification.
 * In automated test environments (NODE_ENV === "test"), stores sent messages in memory for test assertions.
 * In production/dev without configured SMTP/API vendor, acts as a safe stub (DEFERRED_LAUNCH_INFRASTRUCTURE).
 */

export interface MailPayload {
  to: string;
  token: string;
  expiresAt: Date;
  actionUrl?: string;
}

export interface SentMailRecord {
  to: string;
  purpose: "PASSWORD_RESET" | "EMAIL_VERIFICATION";
  token: string;
  expiresAt: Date;
  actionUrl?: string;
  sentAt: Date;
}

export interface CustomerAuthMailer {
  sendPasswordReset(payload: MailPayload): Promise<{ success: boolean; error?: string }>;
  sendEmailVerification(payload: MailPayload): Promise<{ success: boolean; error?: string }>;
}

// In-memory test mailbox for deterministic test harness assertions
const testMailbox: SentMailRecord[] = [];

export class TestCustomerAuthMailer implements CustomerAuthMailer {
  async sendPasswordReset(payload: MailPayload): Promise<{ success: boolean; error?: string }> {
    testMailbox.push({
      to: payload.to,
      purpose: "PASSWORD_RESET",
      token: payload.token,
      expiresAt: payload.expiresAt,
      actionUrl: payload.actionUrl,
      sentAt: new Date(),
    });
    return { success: true };
  }

  async sendEmailVerification(payload: MailPayload): Promise<{ success: boolean; error?: string }> {
    testMailbox.push({
      to: payload.to,
      purpose: "EMAIL_VERIFICATION",
      token: payload.token,
      expiresAt: payload.expiresAt,
      actionUrl: payload.actionUrl,
      sentAt: new Date(),
    });
    return { success: true };
  }
}

export function maskEmailForLogs(email: string): string {
  const parts = email.split("@");
  if (parts.length !== 2) return "***";
  const [local, domain] = parts;
  if (!local || !domain) return "***";
  const visible = local.slice(0, 1);
  return `${visible}***@${domain}`;
}

export class DeferredLaunchCustomerAuthMailer implements CustomerAuthMailer {
  async sendPasswordReset(payload: MailPayload): Promise<{ success: boolean; error?: string }> {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[CustomerAuthMailer] Password reset email deferred (transport unavailable) for ${maskEmailForLogs(payload.to)}`
      );
    }
    return { success: false, error: "MAIL_TRANSPORT_UNAVAILABLE" };
  }

  async sendEmailVerification(payload: MailPayload): Promise<{ success: boolean; error?: string }> {
    if (process.env.NODE_ENV !== "production") {
      console.log(
        `[CustomerAuthMailer] Email verification deferred (transport unavailable) for ${maskEmailForLogs(payload.to)}`
      );
    }
    return { success: false, error: "MAIL_TRANSPORT_UNAVAILABLE" };
  }
}

let activeMailer: CustomerAuthMailer | null = null;

export function getCustomerAuthMailer(): CustomerAuthMailer {
  if (activeMailer) {
    return activeMailer;
  }

  // Test transport strictly forbidden in production
  if (
    process.env.NODE_ENV !== "production" &&
    (process.env.NODE_ENV === "test" || process.env.TEST_MAIL_TRANSPORT === "true")
  ) {
    activeMailer = new TestCustomerAuthMailer();
    return activeMailer;
  }

  activeMailer = new DeferredLaunchCustomerAuthMailer();
  return activeMailer;
}

export function setCustomerAuthMailer(mailer: CustomerAuthMailer | null): void {
  activeMailer = mailer;
}

/**
 * Test harness helpers — Fail closed outside of test environment
 */
export function getLatestSentMail(to?: string): SentMailRecord | null {
  if (
    process.env.NODE_ENV === "production" ||
    (process.env.NODE_ENV !== "test" && process.env.TEST_MAIL_TRANSPORT !== "true")
  ) {
    throw new Error("Test mailbox is not accessible outside test environment");
  }
  if (!to) {
    return testMailbox[testMailbox.length - 1] ?? null;
  }
  const matching = testMailbox.filter((m) => m.to.toLowerCase() === to.toLowerCase());
  return matching[matching.length - 1] ?? null;
}

export function clearSentMail(): void {
  testMailbox.length = 0;
}
