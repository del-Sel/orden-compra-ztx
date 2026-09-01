import { env } from 'cloudflare:workers';
import { FROM_EMAIL, INTERNAL_EMAILS, parseEmailList } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { orderMessageId, replyEmailHeaders, resolveSentMessageId } from '@/lib/email-thread';
import { calculateFinalStatus, isTerminalFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };
type WorkerSecrets = { RESEND_API_KEY?: string };

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
  const apiKey =
  (env as unknown as WorkerSecrets).RESEND_API_KEY ||
  (typeof process !== 'undefined'
    ? process.env.RESEND_API_KEY
    : undefined);
  if (!apiKey) {
    notificationError = 'La firma quedó registrada, pero el aviso no pudo enviarse. Verificá la configuración de correo.';
  } else {
    const internalUrl = new URL(`/?id=${encodeURIComponent(id)}`, request.url).toString();
    const recipients = parseEmailList(INTERNAL_EMAILS.join(', '));
    const threadId = record.row.email_thread_id || orderMessageId(id);
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: recipients,
        subject: `Re: Orden de compra ${record.row.number} — Firmada por ${signatureName}`,
        headers: replyEmailHeaders(threadId),
         html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Orden firmada</h2><p>La orden <strong>${record.row.number}</strong> fue firmada por ${signatureName} (DNI: ${signatureDni}).</p><p>Ya podés continuar con el registro de entregas parciales.</p><p><a href="${internalUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#6f61dd;color:white;text-decoration:none">Abrir orden firmada</a></p></div>`,
      }),
    });
    if (!response.ok) notificationError = `La firma quedó guardada, pero no se pudo enviar el aviso: ${await response.text()}`;
    else {
      const storedMessageId = await resolveSentMessageId(apiKey, response, threadId);
      await db.prepare('UPDATE purchase_orders SET email_thread_id = COALESCE(email_thread_id, ?1) WHERE id = ?2').bind(record.row.email_thread_id || storedMessageId, id).run();
    }
  }

  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), notificationSent: !notificationError, warning: notificationError || undefined });
}
