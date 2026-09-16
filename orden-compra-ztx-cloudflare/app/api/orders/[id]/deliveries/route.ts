import { parseEmailList } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { orderMessageId, replyEmailHeaders } from '@/lib/email-thread';
import { sendEmail } from '@/lib/email-provider';
import { calculateFinalStatus, isTerminalFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json() as { date?: string; quantity?: number; shipment?: string; fiscal?: string; notes?: string };
  const quantity = Number(body.quantity);
  if (!quantity || quantity < 1) return Response.json({ error: 'La cantidad debe ser mayor a cero.' }, { status: 400 });

  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  if (record.row.archived_at) {
    return Response.json({ error: 'La orden está archivada y no admite nuevas entregas.' }, { status: 409 });
  }
  if (isTerminalFinalStatus(record.row.final_status)) {
    return Response.json({ error: 'Esta orden ya está cerrada o cancelada y no admite nuevas entregas.' }, { status: 409 });
  }
  if (record.row.status !== 'signed') return Response.json({ error: 'La orden debe estar firmada antes de registrar entregas.' }, { status: 409 });

  const received = record.deliveries.reduce((sum, delivery) => sum + delivery.quantity, 0);
  if (received + quantity > record.row.total_quantity) return Response.json({ error: 'La cantidad supera los equipos pendientes.' }, { status: 400 });
  const nextNumber = record.deliveries.length + 1;
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO deliveries (order_id, delivery_number, delivery_date, quantity, received_quantity, shipment, fiscal, status, notes, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`).bind(
    id,
    nextNumber,
    body.date || now.slice(0, 10),
    quantity,
    0,
    body.shipment || '',
    body.fiscal || '',
    'En tránsito',
    body.notes || '',
    now,
  ).run();
  const deliveredQuantity = record.deliveries.reduce((sum, delivery) => sum + (delivery.received_quantity || (delivery.status === 'Entregado' ? delivery.quantity : 0)), 0);
  const finalStatus = calculateFinalStatus('signed', record.row.total_quantity, deliveredQuantity);
  await db.prepare('UPDATE purchase_orders SET final_status = ?1, updated_at = ?2 WHERE id = ?3').bind(finalStatus, now, id).run();
  let notificationError = '';
  const recipients = parseEmailList(record.row.client_email);
  if (recipients.length === 0) {
    notificationError = 'El despacho quedó registrado, pero la orden no tiene un correo de destino.';
  } else {
    const shareUrl = new URL(`/orden/${record.row.share_token}`, request.url).toString();
    const threadId = record.row.email_thread_id || orderMessageId(id);
    const result = await sendEmail({
      to: recipients,
      subject: `Re: Pedido de compra ${record.row.number} — Entrega parcial ${nextNumber}`,
      headers: replyEmailHeaders(threadId),
      fallbackMessageId: threadId,
      html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Entrega parcial do pedido ${record.row.number}</h2><p>Encaminhamos a entrega parcial <strong>${nextNumber}</strong>, contendo <strong>${quantity}</strong> equipamentos.</p><p>A entrega encontra-se <strong>em trânsito</strong>. Após recebê-la, acesse o link abaixo para confirmar o recebimento informando seu nome e CPF.</p><p><a href="${shareUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#c72d32;color:white;text-decoration:none">Confirmar recebimento</a></p></div>`,
    });
    if (!result.ok) notificationError = `El despacho quedó registrado, pero no se pudo enviar el aviso: ${result.error}`;
    else {
      const storedMessageId = result.messageId || threadId;
      await db.prepare('UPDATE purchase_orders SET email_thread_id = COALESCE(email_thread_id, ?1) WHERE id = ?2').bind(record.row.email_thread_id || storedMessageId, id).run();
    }
  }
  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), warning: notificationError || undefined }, { status: 201 });
}
