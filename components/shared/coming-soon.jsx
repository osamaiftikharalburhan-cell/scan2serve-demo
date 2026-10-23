import Link from 'next/link';
import { Hammer } from 'lucide-react';
import { Logo } from '@/components/shared/logo';

export function ComingSoon({ title, step, detail }) {
  return (
    <main className="min-h-dvh">
      <header className="container flex h-16 items-center">
        <Logo />
      </header>
      <section className="container grid place-items-center py-16 text-center">
        <div className="max-w-md animate-fade-up rounded-2xl border bg-card p-8 shadow-soft">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-secondary text-primary">
            <Hammer className="h-7 w-7" />
          </span>
          <h1 className="mt-4 text-2xl font-extrabold">{title}</h1>
          <p className="mt-2 text-muted-foreground">{detail}</p>
          <p className="mt-4 text-sm font-semibold text-primary">Coming in build step {step}</p>
          <Link href="/" className="mt-6 inline-block text-sm font-semibold underline-offset-4 hover:underline">
            ← Back home
          </Link>
        </div>
      </section>
    </main>
  );
}
