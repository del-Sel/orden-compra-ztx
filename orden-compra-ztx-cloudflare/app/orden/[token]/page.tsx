import type { Metadata } from 'next';
import OrderWorkspace from '@/components/order-workspace';

export const metadata: Metadata = {
  title: 'Pedido de compra · FUL-MAR',
  description: 'Consulte e confirme o recebimento do pedido de compra.',
};

export default async function ClientOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderWorkspace initialMode="cliente" token={token} />;
}
