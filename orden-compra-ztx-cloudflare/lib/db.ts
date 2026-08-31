import { env } from 'cloudflare:workers';
import { schemaStatements } from '@/db/schema';

type WorkerBindings = { DB: D1Database };

export type OrderRow = {
  id: string;
  share_token: string;
  number: string;
  issue_date: string | null;
  requested_by: string | null;
  payment: string | null;
  due_date: string | null;
  buyer: string | null;
  product: string | null;
  description: string | null;
  unit_price: string | null;
  total_quantity: number;
  product_notes: string | null;
  general_notes: string | null;
  client_name: string | null;
  client_email: string;
  status: 'draft' | 'sent' | 'signed';
  final_status: string;
  signature_name: string | null;
  signature_dni: string | null;
  signed_at: string | null;
  email_thread_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DeliveryRow = {
  id: number;
  order_id: string;
  delivery_number: number;
  delivery_date: string;
  quantity: number;
  shipment: string | null;
  fiscal: string | null;
  status: 'Entregado' | 'Pendiente' | 'En tránsito';
  notes: string | null;
  received_by_name: string | null;
  received_by_dni: string | null;
  received_at: string | null;
  created_at: string;
};

export type OrderSummaryRow = Pick<
  OrderRow,
  'id' | 'number' | 'product' | 'client_name' | 'status' | 'final_status' | 'total_quantity' | 'updated_at'
>;

export function getDb() {
  return (env as unknown as WorkerBindings).DB;
}

export async function ensureSchema(db: D1Database) {
  await db.batch(schemaStatements.map((statement) => db.prepare(statement)));
  const compatibilityColumns = [
    'ALTER TABLE purchase_orders ADD COLUMN signature_dni TEXT',
    'ALTER TABLE deliveries ADD COLUMN received_by_name TEXT',
    'ALTER TABLE deliveries ADD COLUMN received_by_dni TEXT',
    'ALTER TABLE deliveries ADD COLUMN received_at TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN email_thread_id TEXT',
  ];
  for (const statement of compatibilityColumns) {
    try {
      await db.prepare(statement).run();
    } catch (error) {
      if (!String(error).toLowerCase().includes('duplicate column')) throw error;
    }
  }
  await db.prepare("UPDATE purchase_orders SET final_status = 'Cerrada' WHERE final_status = 'Entrega completa'").run();
}

export async function getOrder(db: D1Database, lookup: { id?: string; token?: string }) {
  const row = lookup.id
    ? await db.prepare('SELECT * FROM purchase_orders WHERE id = ?1').bind(lookup.id).first<OrderRow>()
    : await db.prepare('SELECT * FROM purchase_orders WHERE share_token = ?1').bind(lookup.token ?? '').first<OrderRow>();
  if (!row) return null;
  const deliveries = await db.prepare('SELECT * FROM deliveries WHERE order_id = ?1 ORDER BY delivery_number ASC').bind(row.id).all<DeliveryRow>();
  return { row, deliveries: deliveries.results };
}

export async function getOrderSummaries(db: D1Database, limit = 50) {
  const result = await db.prepare(`
    SELECT id, number, product, client_name, status, final_status, total_quantity, updated_at
    FROM purchase_orders
    ORDER BY updated_at DESC
    LIMIT ?1
  `).bind(Math.min(Math.max(limit, 1), 100)).all<OrderSummaryRow>();
  return result.results;
}

export function serializeOrder(order: Awaited<ReturnType<typeof getOrder>>) {
  if (!order) return null;
  return {
    id: order.row.id,
    shareToken: order.row.share_token,
    number: order.row.number,
    issueDate: order.row.issue_date ?? '',
    requestedBy: order.row.requested_by ?? '',
    payment: order.row.payment ?? '',
    dueDate: order.row.due_date ?? '',
    buyer: order.row.buyer ?? '',
    product: order.row.product ?? '',
    description: order.row.description ?? '',
    unitPrice: order.row.unit_price ?? '',
    totalQuantity: order.row.total_quantity,
    productNotes: order.row.product_notes ?? '',
    generalNotes: order.row.general_notes ?? '',
    clientName: order.row.client_name ?? '',
    clientEmail: order.row.client_email,
    status: order.row.status,
    finalStatus: order.row.final_status,
    signatureName: order.row.signature_name,
    signatureDni: order.row.signature_dni,
    signedAt: order.row.signed_at,
    deliveries: order.deliveries.map((delivery) => ({
      id: delivery.id,
      deliveryNumber: delivery.delivery_number,
      date: delivery.delivery_date,
      quantity: delivery.quantity,
      shipment: delivery.shipment ?? '',
      fiscal: delivery.fiscal ?? '',
      status: delivery.status,
      notes: delivery.notes ?? '',
      receivedByName: delivery.received_by_name ?? '',
      receivedByDni: delivery.received_by_dni ?? '',
      receivedAt: delivery.received_at,
    })),
  };
}

export function serializeOrderSummary(row: OrderSummaryRow) {
  return {
    id: row.id,
    number: row.number,
    product: row.product ?? '',
    clientName: row.client_name ?? '',
    status: row.status,
    finalStatus: row.final_status,
    totalQuantity: row.total_quantity,
    updatedAt: row.updated_at,
  };
}
