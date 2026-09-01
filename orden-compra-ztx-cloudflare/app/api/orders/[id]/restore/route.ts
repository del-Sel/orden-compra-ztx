import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = getDb();
  await ensureSchema(db);
  const existing = await getOrder(db, { id });
  if (!existing) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  if (!existing.row.archived_at) {
    return Response.json({ error: 'La orden no está archivada.' }, { status: 409 });
  }

  const archivedAt = new Date(existing.row.archived_at).getTime();
  if (!Number.isFinite(archivedAt) || Date.now() - archivedAt >= 24 * 60 * 60 * 1000) {
    return Response.json({ error: 'El plazo de recuperación de la orden ya venció.' }, { status: 410 });
  }

  const now = new Date().toISOString();
  await db.prepare(
    'UPDATE purchase_orders SET archived_at = NULL, updated_at = ?1 WHERE id = ?2',
  ).bind(now, id).run();
  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order) });
}
