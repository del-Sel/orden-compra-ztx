import { parseEmailList } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { orderMessageId, replyEmailHeaders } from '@/lib/email-thread';
import { sendEmail } from '@/lib/email-provider';
import { calculateFinalStatus, isTerminalFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json() as { signatureName?: string; signatureDni?: string };
  const signatureName = body.signatureName?.trim() ?? '';
  const signatureDni = body.signatureDni?.trim() ?? '';
  if (!signatureName || !signatureDni) return Response.json({ error: 'La firma requiere nombre completo y DNI.' }, { status: 400 });

  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  if (record.row.archived_at) {
    return Response.json({ error: 'La orden está archivada y no admite firmas.' }, { status: 409 });
  }
  if (isTerminalFinalStatus(record.row.final_status)) {
    return Response.json({ error: 'Esta orden ya está cerrada o cancelada.' }, { status: 409 });
  }
  const signedAt = new Date().toISOString();
  const deliveredQuantity = record.deliveries.reduce((sum, delivery) => sum + (delivery.received_quantity || (delivery.status === 'Entregado' ? delivery.quantity : 0)), 0);
  const finalStatus = calculateFinalStatus('signed', record.row.total_quantity, deliveredQuantity);
  await db.prepare("UPDATE purchase_orders SET status = 'signed', final_status = ?1, signature_name = ?2, signature_dni = ?3, signed_at = ?4, updated_at = ?4 WHERE id = ?5").bind(finalStatus, signatureName, signatureDni, signedAt, id).run();

  let notificationError = '';
  const recipients = parseEmailList(record.row.client_email);
  if (recipients.length === 0) {
    notificationError = 'La firma quedó registrada, pero la orden no tiene correos de destino.';
  } else {
    const internalUrl = new URL(`/?id=${encodeURIComponent(id)}`, request.url).toString();
    const threadId = record.row.email_thread_id || orderMessageId(id);
    const result = await sendEmail({
      to: recipients,
      subject: `Re: Pedido de compra ${record.row.number} — Assinado por ${signatureName}`,
      headers: replyEmailHeaders(threadId),
      fallbackMessageId: threadId,
      html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Pedido assinado</h2><p>O pedido <strong>${record.row.number}</strong> foi assinado por ${signatureName} (CPF: ${signatureDni}).</p><p>Já é possível prosseguir com o registro das entregas parciais.</p><p><a href="${internalUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#6f61dd;color:white;text-decoration:none">Abrir pedido assinado</a></p></div>`,
    });
    if (!result.ok) notificationError = `La firma quedó guardada, pero no se pudo enviar el aviso: ${result.error}`;
    else {
      const storedMessageId = result.messageId || threadId;
      await db.prepare('UPDATE purchase_orders SET email_thread_id = COALESCE(email_thread_id, ?1) WHERE id = ?2').bind(record.row.email_thread_id || storedMessageId, id).run();
    }
  }

  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), notificationSent: !notificationError, warning: notificationError || undefined });
}

