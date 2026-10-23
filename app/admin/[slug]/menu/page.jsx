import { MenuManager } from '@/components/admin/menu-manager';

export const metadata = { title: 'Menu' };

export default async function AdminMenuPage({ params }) {
  const { slug } = await params;
  return <MenuManager slug={slug} />;
}
