import { env } from 'cloudflare:workers';
import { FROM_EMAIL, parseEmailList } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { initialEmailHeaders, orderMessageId, resolveSentMessageId } from '@/lib/email-thread';
import { isTerminalFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };
type WorkerSecrets = { RESEND_API_KEY?: string };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  if (isTerminalFinalStatus(record.row.final_status)) {
    return Response.json({ error: 'Esta orden ya está cerrada o cancelada y no puede volver a enviarse.' }, { status: 409 });
  }
  const recipients = parseEmailList(record.row.client_email);
  if (recipients.length === 0) return Response.json({ error: 'Agregá al menos un correo del cliente antes de enviar la orden.' }, { status: 400 });

  const apiKey =
  (env as unknown as WorkerSecrets).RESEND_API_KEY ||
  (typeof process !== 'undefined'
    ? process.env.RESEND_API_KEY
    : undefined);
  if (!apiKey) return Response.json({ error: 'El servicio de correo no está disponible en este momento. Verificá la configuración antes de volver a intentar.' }, { status: 503 });

  const shareUrl = new URL(`/orden/${record.row.share_token}`, request.url).toString();
  const messageId = record.row.email_thread_id || orderMessageId(id);
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: recipients,
      subject: `Orden de compra ${record.row.number} para revisar y firmar`,
      headers: initialEmailHeaders(messageId),
         html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Orden de compra ${record.row.number}</h2><p>Hola ${record.row.client_name || 'cliente'},</p><p>Enviamos la orden de compra <strong>${record.row.product || 'solicitada'}</strong> para que la revises y la firmes online.</p><p><a href="${shareUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#6f61dd;color:white;text-decoration:none">Revisar y firmar orden</a></p><p>Una vez firmada, la orden quedará disponible para continuar con el seguimiento de entregas.</p></div>`,
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    return Response.json({ error: `No se pudo enviar el correo: ${error}` }, { status: 502 });
  }

  const storedMessageId = await resolveSentMessageId(apiKey, response, messageId);
  const now = new Date().toISOString();
  await db.prepare("UPDATE purchase_orders SET status = 'sent', email_thread_id = COALESCE(email_thread_id, ?1), updated_at = ?2 WHERE id = ?3").bind(storedMessageId, now, id).run();
  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), shareUrl });
}
