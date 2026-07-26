/**
 * EmailSender seam — M1 task L.A1.14 item 3 (PROGRESS D37; Q5 ruling
 * 2026-07-20: interface only, NO vendor binding — vendor selection waits
 * until invite mail is ready to ship; the real adapter is ledger F15).
 *
 * App infra, NOT under the leagues time-guard (D37) — but it takes no time
 * reads anyway. The invite routes compose an `EmailSender` implementation;
 * production wiring stays on the dev/log sender until Chris picks a vendor
 * (flipping it on is config + a ~20-line adapter, per the Q5 ruling).
 *
 * The v1 minimum bar (Q5 ruling) is unaffected by this seam: the league
 * join link is always visible and copyable by the league manager (L.A2.5).
 */

export interface EmailMessage {
  to: string
  subject: string
  text: string
}

export interface EmailSendResult {
  ok: boolean
  /** Dev/log sender: 'dev-log'. Future vendor adapters name themselves. */
  sender: string
  error?: string
}

export interface EmailSender {
  send(message: EmailMessage): Promise<EmailSendResult>
}

/** Invite-email content contract (task item 3): league name, team label,
 *  claim link `/join/[token]`. Pure — testable without any sender. */
export function renderLeagueInviteEmail(params: {
  leagueName: string
  teamLabel: string | null
  claimUrl: string
  inviterName: string | null
}): Pick<EmailMessage, 'subject' | 'text'> {
  const { leagueName, teamLabel, claimUrl, inviterName } = params
  const invitedTo = teamLabel
    ? `manage ${teamLabel} in ${leagueName}`
    : `join ${leagueName}`
  const from = inviterName ? ` by ${inviterName}` : ''
  return {
    subject: `You're invited to ${invitedTo} on FieldScout`,
    text:
      `You've been invited${from} to ${invitedTo} on FieldScout.\n\n` +
      `Claim your seat: ${claimUrl}\n\n` +
      `This invite link is personal — if you weren't expecting it, you can ignore this email.`,
  }
}

/** Builds the claim link for a token (§16.1 `/join/[token]`). */
export function buildClaimUrl(token: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  return `${base.replace(/\/$/, '')}/join/${token}`
}

/**
 * Dev/log implementation (the Q5 interim): logs the message instead of
 * sending. Never throws — a send failure must never fail the invite write
 * (the send-intent is already recorded on the invite row, D46).
 */
export class DevLogEmailSender implements EmailSender {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async send(message: EmailMessage): Promise<EmailSendResult> {
    // eslint-disable-next-line no-console
    console.info(
      `[email:dev] to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`,
    )
    return { ok: true, sender: 'dev-log' }
  }
}

/** The composition default until a vendor is chosen (F15). */
export function getEmailSender(): EmailSender {
  return new DevLogEmailSender()
}
