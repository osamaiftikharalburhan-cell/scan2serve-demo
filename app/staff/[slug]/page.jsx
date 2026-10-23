import { RoleGuard } from '@/components/auth/role-guard';
import { StaffHome } from '@/components/staff/staff-home';
import { restaurant } from '@/lib/mockMenu';

export const metadata = { title: 'Staff' };

// /staff/* — Owner and Staff allowed (owner can see the staff page too); not logged in → /login
export default async function StaffPage({ params }) {
  const { slug } = await params;
  return (
    <RoleGuard allow={['owner', 'staff']}>
      <StaffHome slug={slug} restaurantName={restaurant.name} />
    </RoleGuard>
  );
}
