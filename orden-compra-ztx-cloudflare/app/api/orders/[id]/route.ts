import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { parseEmailList } from '@/lib/order-config';
import { calculateFinalStatus, isTerminalFinalStatus, type OrderStage } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json() as Record<string, unknown>;
  const db = getDb();
  await ensureSchema(db);
  const existing = await getOrder(db, { id });
  if (!existing) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  if (isTerminalFinalStatus(existing.row.final_status)) {
    return Response.json({ error: 'Esta orden ya está cerrada o cancelada y no puede editarse.' }, { status: 409 });
  }
  const now = new Date().toISOString();
  const stage = (existing.row.status || 'draft') as OrderStage;
  const deliveredQuantity = existing.deliveries.filter((delivery) => delivery.status === 'Entregado').reduce((sum, delivery) => sum + delivery.quantity, 0);
  const finalStatus = calculateFinalStatus(stage, Math.max(Number(body.totalQuantity) || 0, 0), deliveredQuantity);
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
    parseEmailList(String(body.clientEmail ?? '')).join(', '),
    finalStatus,
    now,
    id,
  ).run();
  if (!result.meta.changes) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order) });
}

export async function DELETE(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = getDb();
  await ensureSchema(db);
  const existing = await getOrder(db, { id });
  if (!existing) return Response.json({ error: "No encontramos esta orden." }, { status: 404 });

  await db.batch([
    db.prepare("DELETE FROM deliveries WHERE order_id = ?1").bind(id),
    db.prepare("DELETE FROM purchase_orders WHERE id = ?1").bind(id),
  ]);

  return Response.json({ ok: true, id });
}
