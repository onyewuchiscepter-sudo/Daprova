import { Resend } from 'resend';
import { env } from '../env.js';

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
  await getClient().emails.send({
    from: env.inviteFromEmail,
    to: opts.to,
    subject: `You've been invited to join ${opts.orgName} on Daprova`,
    html: `
      <p>${opts.inviterEmail} invited you to join <strong>${opts.orgName}</strong> on Daprova.</p>
      <p><a href="${opts.acceptUrl}">Accept invite</a></p>
      <p>This link expires in 7 days.</p>
    `,
  });
}
