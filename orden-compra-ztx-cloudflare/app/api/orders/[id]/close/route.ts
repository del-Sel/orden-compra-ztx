import { parseEmailList } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { orderMessageId, replyEmailHeaders } from '@/lib/email-thread';
import { sendEmail } from '@/lib/email-provider';
import { isTerminalFinalStatus, normalizeFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  if (record.row.archived_at) {
    return Response.json({ error: 'La orden está archivada y debe restaurarse antes de modificarla.' }, { status: 409 });
  }

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
  const recipients = parseEmailList(record.row.client_email);
  if (recipients.length === 0) {
    notificationError = 'La orden se cerró, pero la orden no tiene correos de destino.';
  } else {
    const internalUrl = new URL(`/?id=${encodeURIComponent(id)}`, request.url).toString();
    const threadId = record.row.email_thread_id || orderMessageId(id);
    const result = await sendEmail({
      to: recipients,
      subject: `Re: Pedido de compra ${record.row.number} — Pedido encerrado`,
      headers: replyEmailHeaders(threadId),
      fallbackMessageId: threadId,
      html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Pedido encerrado</h2><p>O pedido de compra <strong>${record.row.number}</strong> foi encerrado após a confirmação do recebimento de todas as unidades.</p><p><a href="${internalUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#6f61dd;color:white;text-decoration:none">Abrir pedido</a></p></div>`,
    });
    if (!result.ok) notificationError = `La orden se cerró, pero no se pudo enviar el aviso: ${result.error}`;
    else {
      const storedMessageId = result.messageId || threadId;
      await db.prepare('UPDATE purchase_orders SET email_thread_id = COALESCE(email_thread_id, ?1) WHERE id = ?2').bind(record.row.email_thread_id || storedMessageId, id).run();
    }
  }

  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), warning: notificationError || undefined });
}

