import { TablesManager } from '@/components/admin/tables-manager';
import { restaurant } from '@/lib/mockMenu';

export const metadata = { title: 'Tables & QR' };

export default async function AdminTablesPage({ params }) {
  const { slug } = await params;
  return <TablesManager slug={slug} restaurantName={restaurant.name} />;
}
