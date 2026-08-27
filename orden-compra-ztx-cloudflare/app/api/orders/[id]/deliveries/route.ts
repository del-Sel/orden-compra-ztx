import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };
type DeliveryStatus = 'Entregado' | 'Pendiente' | 'En tránsito';

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json() as { date?: string; quantity?: number; shipment?: string; fiscal?: string; status?: DeliveryStatus; notes?: string };
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
    body.status || 'Entregado',
    body.notes || '',
    now,
  ).run();
  await db.prepare('UPDATE purchase_orders SET final_status = ?1, updated_at = ?2 WHERE id = ?3').bind(received + quantity >= record.row.total_quantity ? 'Entrega completa' : 'Entrega parcial', now, id).run();
  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order) }, { status: 201 });
}
