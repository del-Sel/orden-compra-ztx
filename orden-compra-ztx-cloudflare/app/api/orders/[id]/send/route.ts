import { env } from 'cloudflare:workers';
import { FROM_EMAIL, CLIENT_EMAIL } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';

type RouteContext = { params: Promise<{ id: string }> };
type WorkerSecrets = { RESEND_API_KEY?: string };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });

  const apiKey =
  (env as unknown as WorkerSecrets).RESEND_API_KEY ||
  (typeof process !== 'undefined'
    ? process.env.RESEND_API_KEY
    : undefined);
  if (!apiKey) return Response.json({ error: 'El servicio de correo no está disponible en este momento. Verificá la configuración antes de volver a intentar.' }, { status: 503 });

  const shareUrl = new URL(`/orden/${record.row.share_token}`, request.url).toString();
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [CLIENT_EMAIL],
      subject: `Orden de compra ${record.row.number} para revisar y firmar`,
         html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Orden de compra ${record.row.number}</h2><p>Hola ${record.row.client_name || 'cliente'},</p><p>Te enviamos la orden de compra <strong>${record.row.product || 'solicitada'}</strong> para que la revises y la firmes online.</p><p><a href="${shareUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#6f61dd;color:white;text-decoration:none">Revisar y firmar orden</a></p><p>Una vez firmada, la orden quedará disponible para continuar con el seguimiento de entregas.</p></div>`,
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    return Response.json({ error: `No se pudo enviar el correo: ${error}` }, { status: 502 });
  }

  const now = new Date().toISOString();
  await db.prepare("UPDATE purchase_orders SET status = 'sent', updated_at = ?1 WHERE id = ?2").bind(now, id).run();
  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), shareUrl });
}
