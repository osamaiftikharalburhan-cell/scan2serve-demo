import { OrdersToday } from '@/components/admin/orders-today';

export const metadata = { title: 'Orders' };

export default async function AdminOrdersPage({ params }) {
  const { slug } = await params;
  return <OrdersToday slug={slug} />;
}
