import { Injectable } from "@nestjs/common";

import type { Mailer } from "../mailer";

export type RecordedEmailKind = "verification" | "password_reset";

export interface RecordedEmail {
  kind: RecordedEmailKind;
  to: string;
  token: string;
}

/**
 * Development / test Mailer that records every dispatched email in memory
 * instead of sending it. Tests can assert on what was "sent" via the
 * accessor methods; dev wiring gets a no-op mailer until a concrete
 * transactional email provider (SMTP / Resend / SES) is chosen.
 */
@Injectable()
export class RecordingMailer implements Mailer {
  private readonly emails: RecordedEmail[] = [];

  sendVerificationEmail(to: string, token: string): Promise<void> {
    this.emails.push({ kind: "verification", to, token });
    return Promise.resolve();
  }

  sendPasswordResetEmail(to: string, token: string): Promise<void> {
    this.emails.push({ kind: "password_reset", to, token });
    return Promise.resolve();
  }

  /** All recorded emails in dispatch order. */
  get sent(): readonly RecordedEmail[] {
    return this.emails;
  }

  /** Recorded verification emails in dispatch order. */
  get verificationEmails(): readonly RecordedEmail[] {
    return this.emails.filter((email) => email.kind === "verification");
  }

  /** Recorded password-reset emails in dispatch order. */
  get passwordResetEmails(): readonly RecordedEmail[] {
    return this.emails.filter((email) => email.kind === "password_reset");
  }

  /** The most recently recorded email, or undefined when none were sent. */
  get lastEmail(): RecordedEmail | undefined {
    return this.emails.at(-1);
  }

  /** Number of emails recorded so far. */
  get count(): number {
    return this.emails.length;
  }

  /** Clears all recorded emails (useful between test cases). */
  reset(): void {
    this.emails.length = 0;
  }
}
