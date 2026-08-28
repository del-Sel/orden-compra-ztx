import { parseEmailList } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, getOrderSummaries, serializeOrder, serializeOrderSummary } from '@/lib/db';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const history = url.searchParams.get('history');
  if (history === '1') {
    const db = getDb();
    await ensureSchema(db);
    const orders = await getOrderSummaries(db);
    return Response.json({ orders: orders.map(serializeOrderSummary) });
  }
  const id = url.searchParams.get('id') ?? undefined;
  const token = url.searchParams.get('token') ?? undefined;
  if (!id && !token) return Response.json({ error: 'Falta el identificador de la orden.' }, { status: 400 });

  const db = getDb();
  await ensureSchema(db);
  const order = await getOrder(db, { id, token });
  if (!order) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  return Response.json({ order: serializeOrder(order) });
}

export async function POST(request: Request) {
  const body = await request.json() as Record<string, unknown>;
  const clientEmail = parseEmailList(String(body.clientEmail ?? '')).join(', ');
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const shareToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const db = getDb();
  await ensureSchema(db);

  await db.prepare(`INSERT INTO purchase_orders (
    id, share_token, number, issue_date, requested_by, payment, due_date, buyer,
    product, description, unit_price, total_quantity, product_notes, general_notes,
    client_name, client_email, status, final_status, created_at, updated_at
  ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, 'draft', 'Pendiente de entrega', ?17, ?17)`).bind(
    id,
    shareToken,
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
    clientEmail,
    now,
  ).run();

  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order) }, { status: 201 });
}
