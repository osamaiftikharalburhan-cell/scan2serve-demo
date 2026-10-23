import { KitchenBoard } from '@/components/kitchen/kitchen-board';
import { RoleGuard } from '@/components/auth/role-guard';
import { restaurant } from '@/lib/mockMenu';

export const metadata = { title: 'Kitchen' };

// Kitchen = staff area: Owner and Staff allowed, not logged in → /login
export default async function KitchenPage({ params }) {
  const { slug } = await params;
  return (
    <RoleGuard allow={['owner', 'staff']}>
      <KitchenBoard slug={slug} restaurantName={restaurant.name} />
    </RoleGuard>
  );
}
