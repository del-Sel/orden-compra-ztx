import { env } from 'cloudflare:workers';
import { parseEmailList } from '@/lib/order-config';
import { sendEmail } from '@/lib/email-provider';

type Body = {
  to?: unknown;
  subject?: unknown;
  text?: unknown;
  html?: unknown;
};

function getMailTokens() {
  const bindings = env as unknown as { REPORT_MAIL_TOKEN?: string; PORTAL_REPORT_MAIL_TOKEN?: string };
  return [bindings.REPORT_MAIL_TOKEN, bindings.PORTAL_REPORT_MAIL_TOKEN].filter((token): token is string => Boolean(token));
}

export async function POST(request: Request) {
  const expectedTokens = getMailTokens();
  const providedToken = request.headers.get('X-Report-Mail-Token') || '';
  if (!expectedTokens.length || !expectedTokens.includes(providedToken)) {
    return Response.json({ error: 'No autorizado.' }, { status: 401 });
  }

  try {
    const body = await request.json() as Body;
    const recipients = parseEmailList(String(body.to ?? ''));
    const subject = String(body.subject ?? 'Informe Gestión Comercial Ful-Mar').trim();
    const text = String(body.text ?? '').trim();
    const html = String(body.html ?? '').trim();
    if (recipients.length === 0) return Response.json({ error: 'Ingresá un correo destinatario válido.' }, { status: 400 });
    if (!text) return Response.json({ error: 'El informe no tiene contenido para enviar.' }, { status: 400 });

    const result = await sendEmail({
      to: recipients,
      subject,
      html: html || `<pre style="font-family:Arial,sans-serif;white-space:pre-wrap">${text.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] ?? character)}</pre>`,
    });
    if (!result.ok) return Response.json({ error: `No se pudo enviar el correo: ${result.error}` }, { status: 502 });
    return Response.json({ ok: true, messageId: result.messageId });
  } catch (error) {
    console.error('report email relay failed', error);
    return Response.json({ error: 'No se pudo procesar el envío del informe.' }, { status: 500 });
  }
}
