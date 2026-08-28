import { env } from 'cloudflare:workers';
import { FROM_EMAIL, parseEmailList } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { calculateFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };
type WorkerSecrets = { RESEND_API_KEY?: string };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json() as { date?: string; quantity?: number; shipment?: string; fiscal?: string; notes?: string };
  const quantity = Number(body.quantity);
  if (!quantity || quantity < 1) return Response.json({ error: 'La cantidad debe ser mayor a cero.' }, { status: 400 });

  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  if (record.row.status !== 'signed') return Response.json({ error: 'La orden debe estar firmada antes de registrar entregas.' }, { status: 409 });

  const received = record.deliveries.reduce((sum, delivery) => sum + delivery.quantity, 0);
  if (received + quantity > record.row.total_quantity) return Response.json({ error: 'La cantidad supera los equipos pendientes.' }, { status: 400 });
  const nextNumber = record.deliveries.length + 1;
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO deliveries (order_id, delivery_number, delivery_date, quantity, shipment, fiscal, status, notes, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`).bind(
    id,
    nextNumber,
    body.date || now.slice(0, 10),
    quantity,
    body.shipment || '',
    body.fiscal || '',
    'En tránsito',
    body.notes || '',
    now,
  ).run();
  const deliveredQuantity = record.deliveries.filter((delivery) => delivery.status === 'Entregado').reduce((sum, delivery) => sum + delivery.quantity, 0);
  const finalStatus = calculateFinalStatus('signed', record.row.total_quantity, deliveredQuantity);
  await db.prepare('UPDATE purchase_orders SET final_status = ?1, updated_at = ?2 WHERE id = ?3').bind(finalStatus, now, id).run();
  let notificationError = '';
  const apiKey =
    (env as unknown as WorkerSecrets).RESEND_API_KEY ||
    (typeof process !== 'undefined' ? process.env.RESEND_API_KEY : undefined);
  const recipients = parseEmailList(record.row.client_email);
  if (!apiKey) {
    notificationError = 'El despacho quedó registrado, pero no se pudo enviar el aviso por correo.';
  } else if (recipients.length === 0) {
    notificationError = 'El despacho quedó registrado, pero la orden no tiene un correo de destino.';
  } else {
    const shareUrl = new URL(`/orden/${record.row.share_token}`, request.url).toString();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: recipients,
        subject: `Entrega parcial ${nextNumber} de la orden ${record.row.number}`,
        html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Entrega parcial de la orden ${record.row.number}</h2><p>Enviamos la entrega parcial <strong>${nextNumber}</strong> por <strong>${quantity}</strong> equipos.</p><p>La entrega se encuentra <strong>en tránsito</strong>. Cuando la recibas, ingresá al siguiente enlace para confirmar la recepción con tu nombre y DNI.</p><p><a href="${shareUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#6f61dd;color:white;text-decoration:none">Confirmar recepción</a></p></div>`,
      }),
    });
    if (!response.ok) notificationError = `El despacho quedó registrado, pero no se pudo enviar el aviso: ${await response.text()}`;
  }
  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), warning: notificationError || undefined }, { status: 201 });
}
