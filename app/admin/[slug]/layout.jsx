import { AdminShell } from '@/components/admin/admin-shell';
import { RoleGuard } from '@/components/auth/role-guard';
import { restaurant } from '@/lib/mockMenu';

export const metadata = {
  title: { default: 'Owner dashboard', template: '%s · Owner dashboard' },
};

// /admin/* = Owner only. RoleGuard checks localStorage.role on page load:
// none → /login · staff → "Access Denied - Owner Only" → /staff/<slug> after 2 s · owner → dashboard.
export default async function AdminLayout({ params, children }) {
  const { slug } = await params; // Next 15+: params is a Promise
  return (
    <RoleGuard allow={['owner']}>
      <AdminShell slug={slug} restaurantName={restaurant.name}>
        {children}
      </AdminShell>
    </RoleGuard>
  );
}
