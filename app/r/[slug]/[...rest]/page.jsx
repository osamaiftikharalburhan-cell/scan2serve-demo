import { notFound } from 'next/navigation';

// Any unknown customer URL (e.g. /r/kababjees-fried-chicken/xyz) shows the customer 404 — not the owner site.
export default function UnknownCustomerPage() {
  notFound();
}
