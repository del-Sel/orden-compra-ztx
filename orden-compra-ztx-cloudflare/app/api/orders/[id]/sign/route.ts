import { env } from 'cloudflare:workers';
import { FROM_EMAIL, INTERNAL_EMAIL } from '@/lib/order-config';
import { ensureSchema, getDb, getOrder, serializeOrder } from '@/lib/db';
import { calculateFinalStatus } from '@/lib/order-status';

type RouteContext = { params: Promise<{ id: string }> };
type WorkerSecrets = { RESEND_API_KEY?: string };

export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;
  const body = await request.json() as { signatureName?: string; signatureDni?: string };
  const signatureName = body.signatureName?.trim() ?? '';
  const signatureDni = body.signatureDni?.trim() ?? '';
  if (!signatureName || !signatureDni) return Response.json({ error: 'La firma requiere nombre completo y DNI.' }, { status: 400 });

  const db = getDb();
  await ensureSchema(db);
  const record = await getOrder(db, { id });
  if (!record) return Response.json({ error: 'No encontramos esta orden.' }, { status: 404 });
  const signedAt = new Date().toISOString();
  const finalStatus = calculateFinalStatus('signed', record.row.total_quantity, record.deliveries.reduce((sum, delivery) => sum + delivery.quantity, 0));
  await db.prepare("UPDATE purchase_orders SET status = 'signed', final_status = ?1, signature_name = ?2, signature_dni = ?3, signed_at = ?4, updated_at = ?4 WHERE id = ?5").bind(finalStatus, signatureName, signatureDni, signedAt, id).run();

  let notificationError = '';
  const apiKey =
  (env as unknown as WorkerSecrets).RESEND_API_KEY ||
  (typeof process !== 'undefined'
    ? process.env.RESEND_API_KEY
    : undefined);
  if (!apiKey) {
    notificationError = 'La firma quedó registrada, pero el aviso no pudo enviarse. Verificá la configuración de correo.';
  } else {
    const internalUrl = new URL(`/?id=${encodeURIComponent(id)}`, request.url).toString();
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [INTERNAL_EMAIL],
        subject: `Orden ${record.row.number} firmada por ${signatureName}`,
         html: `<div style="font-family:Arial,sans-serif;color:#1e2d43;line-height:1.6;max-width:620px"><h2>Orden firmada</h2><p>La orden <strong>${record.row.number}</strong> fue firmada por ${signatureName} (DNI: ${signatureDni}).</p><p>Ya podés continuar con el registro de entregas parciales.</p><p><a href="${internalUrl}" style="display:inline-block;padding:12px 18px;border-radius:6px;background:#6f61dd;color:white;text-decoration:none">Abrir orden firmada</a></p></div>`,
      }),
    });
    if (!response.ok) notificationError = `La firma quedó guardada, pero no se pudo enviar el aviso: ${await response.text()}`;
  }

  const order = await getOrder(db, { id });
  return Response.json({ order: serializeOrder(order), notificationSent: !notificationError, warning: notificationError || undefined });
}
