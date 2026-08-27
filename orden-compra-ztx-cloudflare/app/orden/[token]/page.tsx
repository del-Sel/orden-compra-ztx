import OrderWorkspace from '@/components/order-workspace';

export default async function ClientOrderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <OrderWorkspace initialMode="cliente" token={token} />;
}
