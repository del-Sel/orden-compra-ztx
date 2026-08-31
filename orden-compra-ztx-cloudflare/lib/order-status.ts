export type OrderStage = 'draft' | 'sent' | 'signed';
export type FinalStatus = 'Pendiente de entrega' | 'Entrega parcial' | 'Cerrada' | 'Cancelada';

export function normalizeFinalStatus(value: string | null | undefined): FinalStatus {
  if (value === 'Entrega completa') return 'Cerrada';
  if (value === 'Entrega parcial') return 'Entrega parcial';
  if (value === 'Cerrada') return 'Cerrada';
  if (value === 'Cancelada') return 'Cancelada';
  return 'Pendiente de entrega';
}

export function isTerminalFinalStatus(value: string | null | undefined) {
  const status = normalizeFinalStatus(value);
  return status === 'Cerrada' || status === 'Cancelada';
}

export function calculateFinalStatus(stage: OrderStage, totalQuantity: number, deliveredQuantity: number): FinalStatus {
  if (stage !== 'signed' || deliveredQuantity <= 0) return 'Pendiente de entrega';
  return totalQuantity > 0 && deliveredQuantity >= totalQuantity
    ? 'Cerrada'
    : 'Entrega parcial';
}
