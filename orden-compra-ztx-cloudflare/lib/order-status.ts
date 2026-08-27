export type OrderStage = 'draft' | 'sent' | 'signed';

export function calculateFinalStatus(stage: OrderStage, totalQuantity: number, registeredQuantity: number) {
  if (stage !== 'signed' || registeredQuantity <= 0) return 'Pendiente de entrega';
  return totalQuantity > 0 && registeredQuantity >= totalQuantity
    ? 'Entrega completa'
    : 'Entrega parcial';
}
