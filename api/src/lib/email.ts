import { Resend } from 'resend';
import { env } from '../env.js';
import { escapeHtml } from './messaging.js';

// Lazily constructed — importing `resend` doesn't require an API key, only
// calling it does, and env.resendApiKey may legitimately be unset in
// environments that never send invites (e.g. local dev without a key).
let client: Resend | null = null;
function getClient(): Resend {
  if (!env.resendApiKey) throw new Error('RESEND_API_KEY is not set — cannot send email');
  if (!client) client = new Resend(env.resendApiKey);
  return client;
}

export async function sendInviteEmail(opts: { to: string; orgName: string; inviterEmail: string; acceptUrl: string }) {
  // Resend reports failures (bad key, unverified sender domain, rejected
  // address) in the result rather than by throwing — surface them, or a
  // failed invite looks like a sent one.
  const { error } = await getClient().emails.send({
    from: env.inviteFromEmail,
    to: opts.to,
    subject: `You've been invited to join ${opts.orgName} on Daprova`,
    html: `
      <p>${escapeHtml(opts.inviterEmail)} invited you to join <strong>${escapeHtml(opts.orgName)}</strong> on Daprova.</p>
      <p><a href="${escapeHtml(opts.acceptUrl)}">Accept invite</a></p>
      <p>This link expires in 7 days.</p>
    `,
  });
  if (error) throw new Error(error.message);
}
