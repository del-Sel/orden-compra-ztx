import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { calculateFinalStatus } from '@/lib/order-status';

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
  if (record.row.status !== 'signed') return Response.json({ error: 'La orden debe estar firmada antes de confirmar entregas.' }, { status: 409 });

  const delivery = record.deliveries.find((item) => item.id === numericDeliveryId);
  if (!delivery) return Response.json({ error: 'No encontramos esta entrega.' }, { status: 404 });
  if (delivery.status === 'Entregado') return Response.json({ order: serializeOrder(record) });

  const receivedAt = new Date().toISOString();
  await db.prepare(`UPDATE deliveries
    SET status = 'Entregado', received_by_name = ?1, received_by_dni = ?2, received_at = ?3
    WHERE id = ?4 AND order_id = ?5`).bind(
    signatureName,
    signatureDni,
    receivedAt,
    numericDeliveryId,
    id,
  ).run();

  const deliveredQuantity = record.deliveries
    .filter((item) => item.status === 'Entregado' || item.id === numericDeliveryId)
    .reduce((sum, item) => sum + item.quantity, 0);
  const finalStatus = calculateFinalStatus('signed', record.row.total_quantity, deliveredQuantity);
  await db.prepare('UPDATE purchase_orders SET final_status = ?1, updated_at = ?2 WHERE id = ?3').bind(finalStatus, receivedAt, id).run();

  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order) });
}
