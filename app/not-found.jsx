import Link from 'next/link';
import { UtensilsCrossed } from 'lucide-react';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="animate-fade-up">
        <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-secondary text-primary">
          <UtensilsCrossed className="h-8 w-8" />
        </span>
        <h1 className="mt-4 text-2xl font-extrabold">Page not found</h1>
        <p className="mt-1 text-muted-foreground">This restaurant or page doesn&apos;t exist.</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center rounded-2xl bg-brand-gradient px-5 font-semibold text-white shadow-glow"
        >
          Go home
        </Link>
      </div>
    </main>
  );
}
