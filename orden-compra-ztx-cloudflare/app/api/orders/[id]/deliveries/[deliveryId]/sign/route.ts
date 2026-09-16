import { parseEmailList } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { orderMessageId, replyEmailHeaders } from '@/lib/email-thread';
import { sendEmail } from '@/lib/email-provider';
import { calculateFinalStatus, isTerminalFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string; deliveryId: string }> };
export async function POST(request: Request, context: RouteContext) {
  const { id, deliveryId } = await context.params;
  const body = await request.json() as { signatureName?: string; signatureDni?: string };
  const signatureName = body.signatureName?.trim() ?? '';
  const signatureDni = body.signatureDni?.trim() ?? '';
  const numericDeliveryId = Number(deliveryId);
  if (!signatureName || !signatureDni) return Response.json({ error: 'La confirmación requiere nombre completo y DNI.' }, { status: 400 });
  if (!Number.isInteger(numericDeliveryId) || numericDeliveryId < 1) return Response.json({ error: 'La entrega indicada no es válida.' }, { status: 400 });

  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  if (record.row.archived_at) {
    return Response.json({ error: 'La orden está archivada y no admite confirmaciones.' }, { status: 409 });
  }
  if (isTerminalFinalStatus(record.row.final_status)) {
    return Response.json({ error: 'Esta orden ya está cerrada o cancelada.' }, { status: 409 });
  }
  if (record.row.status !== 'signed') return Response.json({ error: 'La orden debe estar firmada antes de confirmar entregas.' }, { status: 409 });

  const delivery = record.deliveries.find((item) => item.id === numericDeliveryId);
  if (!delivery) return Response.json({ error: 'No encontramos esta entrega.' }, { status: 404 });
  if (delivery.status === 'Entregado') return Response.json({ order: serializeOrder(record) });

  const receivedAt = new Date().toISOString();
  await db.prepare(`UPDATE deliveries
    SET status = 'Entregado', received_quantity = quantity, received_by_name = ?1, received_by_dni = ?2, received_at = ?3
    WHERE id = ?4 AND order_id = ?5`).bind(
    signatureName,
    signatureDni,
    receivedAt,
    numericDeliveryId,
    id,
  ).run();

  const deliveredQuantity = record.deliveries
    .reduce((sum, item) => sum + (item.received_quantity || (item.id === numericDeliveryId ? item.quantity : 0)), 0);
  const finalStatus = calculateFinalStatus('signed', record.row.total_quantity, deliveredQuantity);
  await db.prepare('UPDATE purchase_orders SET final_status = ?1, updated_at = ?2 WHERE id = ?3').bind(finalStatus, receivedAt, id).run();

  let notificationError = '';
  const recipients = parseEmailList(record.row.client_email);
  if (recipients.length === 0) {
    notificationError = 'La recepción quedó registrada, pero la orden no tiene correos de destino.';
  } else {
    const internalUrl = new URL(`/?id=${encodeURIComponent(id)}`, request.url).toString();
    const threadId = record.row.email_thread_id || orderMessageId(id);
    const closedMessage = finalStatus === 'Entrega completa'
      ? `<p>A entrega total do pedido foi concluída. O pedido está pronto para ser encerrado.</p>`
      : `<p>O pedido permanece aberto para o registro das entregas pendentes.</p>`;
    const result = await sendEmail({
      to: recipients,
      subject: `Re: Pedido de compra ${record.row.number} — ${finalStatus === 'Entrega completa' ? 'Entrega completa' : `Entrega ${delivery.delivery_number} confirmada`}`,
      headers: replyEmailHeaders(threadId),
      fallbackMessageId: threadId,
      html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>${finalStatus === 'Entrega completa' ? 'Entrega completa' : 'Entrega parcial confirmada'}</h2><p>A entrega parcial <strong>${delivery.delivery_number}</strong> do pedido <strong>${record.row.number}</strong> foi recebida.</p><p>Quantidade recebida: <strong>${delivery.quantity}</strong> equipamentos.</p><p>Recebimento confirmado por: <strong>${signatureName}</strong> (CPF: ${signatureDni}).</p>${closedMessage}<p><a href="${internalUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#6f61dd;color:white;text-decoration:none">Abrir pedido</a></p></div>`,
    });
    if (!result.ok) notificationError = `La recepción quedó registrada, pero no se pudo enviar el aviso: ${result.error}`;
    else {
      const storedMessageId = result.messageId || threadId;
      await db.prepare('UPDATE purchase_orders SET email_thread_id = COALESCE(email_thread_id, ?1) WHERE id = ?2').bind(record.row.email_thread_id || storedMessageId, id).run();
    }
  }

  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), warning: notificationError || undefined });
}

