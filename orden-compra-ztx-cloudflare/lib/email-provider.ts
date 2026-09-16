import { env } from 'cloudflare:workers';
import { FROM_EMAIL } from '@/lib/order-config';
import { resolveSentMessageId } from '@/lib/email-thread';

type EmailSecrets = {
  MAIL_PROVIDER?: string;
  MAIL_FROM_EMAIL?: string;
  RESEND_API_KEY?: string;
  GMAIL_CLIENT_ID?: string;
  GMAIL_CLIENT_SECRET?: string;
  GMAIL_REFRESH_TOKEN?: string;
};

export type EmailInput = {
  to: string[];
  subject: string;
  html: string;
  headers?: Record<string, string>;
  fallbackMessageId?: string;
};

export type EmailResult = {
  ok: boolean;
  messageId?: string;
  error?: string;
};

function getSecret(name: keyof EmailSecrets) {
  const bindings = env as unknown as EmailSecrets;
  const processValue = typeof process !== 'undefined' ? process.env[name] : undefined;
  return bindings[name] || processValue || '';
}

function configuredProvider() {
  const explicitProvider = getSecret('MAIL_PROVIDER').trim().toLowerCase();
  if (explicitProvider) return explicitProvider;
  return getSecret('GMAIL_REFRESH_TOKEN') ? 'gmail' : 'resend';
}

function cleanHeaderValue(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function base64Encode(bytes: Uint8Array) {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function base64UrlEncode(value: string) {
  return base64Encode(new TextEncoder().encode(value))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function encodeMimeHeader(value: string) {
  const cleaned = cleanHeaderValue(value);
  if (/^[\x20-\x7e]*$/.test(cleaned)) return cleaned;
  return `=?UTF-8?B?${base64Encode(new TextEncoder().encode(cleaned))}?=`;
}

function buildRawGmailMessage(input: EmailInput, from: string) {
  const headers = [
    `From: ${cleanHeaderValue(from)}`,
    `To: ${input.to.map(cleanHeaderValue).join(', ')}`,
    `Subject: ${encodeMimeHeader(input.subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    ...Object.entries(input.headers ?? {}).map(
      ([name, value]) => `${cleanHeaderValue(name)}: ${cleanHeaderValue(value)}`,
    ),
  ];
  return base64UrlEncode(`${headers.join('\r\n')}\r\n\r\n${input.html}`);
}

async function sendWithResend(input: EmailInput): Promise<EmailResult> {
  const apiKey = getSecret('RESEND_API_KEY');
  if (!apiKey) return { ok: false, error: 'Falta configurar RESEND_API_KEY.' };

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: getSecret('MAIL_FROM_EMAIL') || FROM_EMAIL,
      to: input.to,
      subject: input.subject,
      headers: input.headers,
      html: input.html,
    }),
  });
  if (!response.ok) return { ok: false, error: await response.text() };

  return {
    ok: true,
    messageId: await resolveSentMessageId(apiKey, response, input.fallbackMessageId ?? ''),
  };
}

async function sendWithGmail(input: EmailInput): Promise<EmailResult> {
  const clientId = getSecret('GMAIL_CLIENT_ID');
  const clientSecret = getSecret('GMAIL_CLIENT_SECRET');
  const refreshToken = getSecret('GMAIL_REFRESH_TOKEN');
  const from = getSecret('MAIL_FROM_EMAIL');
  if (!clientId || !clientSecret || !refreshToken || !from) {
    return {
      ok: false,
      error: 'Falta configurar la autorización OAuth de Gmail y MAIL_FROM_EMAIL.',
    };
  }

  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  if (!tokenResponse.ok) return { ok: false, error: `Google OAuth: ${await tokenResponse.text()}` };

  const tokenPayload = await tokenResponse.json() as { access_token?: string };
  if (!tokenPayload.access_token) return { ok: false, error: 'Google OAuth no devolvió un access token.' };

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${tokenPayload.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw: buildRawGmailMessage(input, from) }),
  });
  if (!response.ok) return { ok: false, error: `Gmail API: ${await response.text()}` };

  return {
    ok: true,
    messageId:
      input.headers?.['Message-ID'] ||
      input.headers?.['In-Reply-To'] ||
      input.fallbackMessageId,
  };
}

export async function sendEmail(input: EmailInput): Promise<EmailResult> {
  try {
    const provider = configuredProvider();
    if (provider === 'gmail') return await sendWithGmail(input);
    if (provider === 'resend') return await sendWithResend(input);
    return { ok: false, error: `Proveedor de correo no reconocido: ${provider}.` };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}
