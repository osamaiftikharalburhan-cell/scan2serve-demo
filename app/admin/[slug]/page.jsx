import { Overview } from '@/components/admin/overview';

export const metadata = { title: 'Today' };

export default async function AdminOverviewPage({ params }) {
  const { slug } = await params;
  return <Overview slug={slug} />;
}
