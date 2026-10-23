import { redirect } from 'next/navigation';

// Old address. The kitchen lives outside the customer area now: /kitchen/[slug]
export default async function OldKitchenUrl({ params }) {
  const { slug } = await params;
  redirect(`/kitchen/${slug}`);
}
