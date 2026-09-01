import { env } from 'cloudflare:workers';
import { FROM_EMAIL, INTERNAL_EMAILS, parseEmailList } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { orderMessageId, replyEmailHeaders, resolveSentMessageId } from '@/lib/email-thread';
import { isTerminalFinalStatus, normalizeFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };
type WorkerSecrets = { RESEND_API_KEY?: string };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });

  const currentStatus = normalizeFinalStatus(record.row.final_status);
  if (currentStatus === 'Cerrada') return Response.json({ order: serializeOrder(record) });
  if (currentStatus === 'Cancelada') {
    return Response.json({ error: 'La orden está cancelada y no puede cerrarse.' }, { status: 409 });
  }
  if (currentStatus !== 'Entrega completa') {
    return Response.json({ error: 'La orden solo puede cerrarse después de completar todas las entregas.' }, { status: 409 });
  }
  if (isTerminalFinalStatus(currentStatus)) return Response.json({ error: 'La orden ya no admite cambios.' }, { status: 409 });

  const now = new Date().toISOString();
  await db.prepare("UPDATE purchase_orders SET final_status = 'Cerrada', updated_at = ?1 WHERE id = ?2").bind(now, id).run();

  let notificationError = '';
  const apiKey =
    (env as unknown as WorkerSecrets).RESEND_API_KEY ||
    (typeof process !== 'undefined' ? process.env.RESEND_API_KEY : undefined);
  const recipients = parseEmailList(INTERNAL_EMAILS.join(', '));
  if (!apiKey) {
    notificationError = 'La orden se cerró, pero no se pudo enviar el aviso por correo.';
  } else if (recipients.length === 0) {
    notificationError = 'La orden se cerró, pero no hay destinatarios internos configurados.';
  } else {
    const internalUrl = new URL(`/?id=${encodeURIComponent(id)}`, request.url).toString();
    const threadId = record.row.email_thread_id || orderMessageId(id);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: recipients,
        subject: `Re: Orden de compra ${record.row.number} — Orden cerrada`,
        headers: replyEmailHeaders(threadId),
        html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Orden cerrada</h2><p>Se ha cerrado la orden de compra <strong>${record.row.number}</strong> porque se confirmó la recepción de la totalidad de las unidades.</p><p><a href="${internalUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#6f61dd;color:white;text-decoration:none">Abrir orden</a></p></div>`,
      }),
    });
    if (!response.ok) notificationError = `La orden se cerró, pero no se pudo enviar el aviso: ${await response.text()}`;
    else {
      const storedMessageId = await resolveSentMessageId(apiKey, response, threadId);
      await db.prepare('UPDATE purchase_orders SET email_thread_id = COALESCE(email_thread_id, ?1) WHERE id = ?2').bind(record.row.email_thread_id || storedMessageId, id).run();
    }
  }

  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), warning: notificationError || undefined });
}
