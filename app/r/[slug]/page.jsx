import { MenuPage } from '@/components/customer/menu-page';
import { restaurant } from '@/lib/mockMenu';

export const metadata = {
  title: `${restaurant.name} — Menu`,
};

// Permanent QR URL: /r/[slug]?table=N (PLANNING.md Part 4 §1.1)
function parseTable(value) {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export default async function CustomerMenuRoute({ params, searchParams }) {
  // Next 15+: params and searchParams are Promises
  const [{ slug }, { table }] = await Promise.all([params, searchParams]);
  return <MenuPage slug={slug} table={parseTable(table)} />;
}
