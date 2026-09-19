import { Resend } from 'resend';
import { env } from '../env.js';

// Outbound learner messages (reminders). Email via Resend, SMS via Termii.
// WhatsApp needs no provider: the admin gets click-to-chat links that open
// WhatsApp with the message prefilled (lib callers build those with
// whatsappLink()).

export type OutboundEmail = { to: string; subject: string; html: string; text: string };
export type SendResult = { ok: true } | { ok: false; error: string };

let resend: Resend | null = null;

export function emailConfigured() {
  return !!env.resendApiKey;
}
export function smsConfigured() {
  return !!env.termiiApiKey;
}

// Resend's batch endpoint takes up to 100 emails per call; results come
// back in order, so each message's outcome is reported individually.
export async function sendEmails(messages: OutboundEmail[]): Promise<SendResult[]> {
  if (!env.resendApiKey) return messages.map(() => ({ ok: false, error: 'Email is not configured (RESEND_API_KEY)' }));
  resend ??= new Resend(env.resendApiKey);
  const results: SendResult[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    const { error } = await resend.batch.send(chunk.map((m) => ({ from: env.reminderFromEmail, to: m.to, subject: m.subject, html: m.html, text: m.text })));
    for (let j = 0; j < chunk.length; j++) results.push(error ? { ok: false, error: error.message } : { ok: true });
  }
  return results;
}

// Nigerian numbers are the common case: 0803… and +234803… both become
// 234803…, the international form Termii and wa.me expect. Other numbers
// must already include their country code.
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/[^0-9+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.startsWith('0') && digits.length === 11) digits = `234${digits.slice(1)}`;
  digits = digits.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? digits : null;
}

export async function sendSms(to: string, text: string): Promise<SendResult> {
  if (!env.termiiApiKey) return { ok: false, error: 'SMS is not configured (TERMII_API_KEY)' };
  const phone = normalizePhone(to);
  if (!phone) return { ok: false, error: 'Invalid phone number' };
  try {
    const res = await fetch(`${env.termiiBaseUrl.replace(/\/$/, '')}/api/sms/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: env.termiiApiKey, to: phone, from: env.termiiSenderId, sms: text, type: 'plain', channel: 'generic' }),
    });
    const body = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
    if (!res.ok || (body.code && body.code !== 'ok')) return { ok: false, error: body.message ?? `Termii error ${res.status}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export function whatsappLink(phone: string, text: string): string | null {
  const digits = normalizePhone(phone);
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}
