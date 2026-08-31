import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { isTerminalFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  if (isTerminalFinalStatus(record.row.final_status)) {
    return Response.json({ error: 'La orden ya está cerrada o cancelada.' }, { status: 409 });
  }

  const now = new Date().toISOString();
  await db.prepare("UPDATE purchase_orders SET final_status = 'Cancelada', updated_at = ?1 WHERE id = ?2").bind(now, id).run();
  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order) });
}
