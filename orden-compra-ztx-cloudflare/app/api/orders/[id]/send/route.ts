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
  if (record.row.archived_at) {
    return Response.json({ error: 'La orden está archivada y debe restaurarse antes de enviarla.' }, { status: 409 });
  }
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
      subject: `Pedido de compra ${record.row.number} para análise e assinatura`,
      headers: initialEmailHeaders(messageId),
         html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Pedido de compra ${record.row.number}</h2><p>Prezado(a) ${record.row.client_name || 'cliente'},</p><p>Encaminhamos o pedido de compra <strong>${record.row.product || 'solicitado'}</strong> para sua análise e assinatura digital.</p><p><a href="${shareUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#c72d32;color:white;text-decoration:none">Revisar e assinar pedido</a></p><p>Após a assinatura, o pedido ficará disponível para o acompanhamento das entregas.</p></div>`,
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
