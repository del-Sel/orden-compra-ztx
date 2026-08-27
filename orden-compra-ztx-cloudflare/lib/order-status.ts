export type OrderStage = 'draft' | 'sent' | 'signed';

export function calculateFinalStatus(stage: OrderStage, totalQuantity: number, deliveredQuantity: number) {
  if (stage !== 'signed' || deliveredQuantity <= 0) return 'Pendiente de entrega';
  return totalQuantity > 0 && deliveredQuantity >= totalQuantity
    ? 'Entrega completa'
    : 'Entrega parcial';
}
