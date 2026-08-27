import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { CLIENT_EMAIL } from '@/lib/order-config';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json() as Record<string, unknown>;
  const db = getDb();
  await ensureSchema(db);
  const now = new Date().toISOString();
  const result = await db.prepare(`UPDATE purchase_orders SET
    number = ?1, issue_date = ?2, requested_by = ?3, payment = ?4, due_date = ?5, buyer = ?6,
    product = ?7, description = ?8, unit_price = ?9, total_quantity = ?10, product_notes = ?11,
    general_notes = ?12, client_name = ?13, client_email = ?14, final_status = ?15, updated_at = ?16
    WHERE id = ?17`).bind(
    String(body.number ?? ''),
    String(body.issueDate ?? ''),
    String(body.requestedBy ?? ''),
    String(body.payment ?? ''),
    String(body.dueDate ?? ''),
    String(body.buyer ?? ''),
    String(body.product ?? ''),
    String(body.description ?? ''),
    String(body.unitPrice ?? ''),
    Math.max(Number(body.totalQuantity) || 0, 0),
    String(body.productNotes ?? ''),
    String(body.generalNotes ?? ''),
    String(body.clientName ?? ''),
    CLIENT_EMAIL,
    String(body.finalStatus ?? 'Pendiente de entrega'),
    now,
    id,
  ).run();
  if (!result.meta.changes) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order) });
}
