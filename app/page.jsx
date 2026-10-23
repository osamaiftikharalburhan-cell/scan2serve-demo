import Link from 'next/link';
import { ArrowRight, ChefHat, LayoutDashboard, LogIn, QrCode, ShoppingBag, Zap, CheckCircle2, XCircle } from 'lucide-react';
import { Logo } from '@/components/shared/logo';
import { Badge } from '@/components/ui/badge';
import { restaurant } from '@/lib/mockMenu';

// Public info page (white + red, same theme as the customer menu). Customers never land here —
// table QRs go straight to /r/[slug]?table=N. Staff use /login (Login button in the header).
const DEMO = restaurant.slug;

const features = [
  {
    icon: QrCode,
    title: 'Table QR',
    text: 'Print once, never expires. Add unlimited tables and download all QRs as a PDF.',
    href: `/admin/${DEMO}/tables`,
    cta: 'Manage tables',
  },
  {
    icon: ShoppingBag,
    title: 'Order from the table',
    text: 'Customers browse, add to cart and order — no app, no login.',
    href: `/r/${DEMO}?table=1`,
    cta: 'Try as a customer',
  },
  {
    icon: ChefHat,
    title: 'Live kitchen board',
    text: 'New orders appear instantly with a chime — no refresh needed.',
    href: `/kitchen/${DEMO}`,
    cta: 'Open kitchen',
  },
  {
    icon: Zap,
    title: 'One-tap stock out',
    text: 'Mutton Karahi finished? One tap and customers can’t order it.',
    href: `/admin/${DEMO}/menu`,
    cta: 'Manage menu',
  },
];

export default function HomePage() {
  const envOk = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return (
    <main className="theme-red min-h-dvh bg-white text-black">
      <header className="sticky top-0 z-30 border-b border-zinc-100 bg-white/95 backdrop-blur-md">
        <div className="container flex h-16 items-center justify-between">
        <Logo />
        <div className="flex items-center gap-2">
          <Badge variant={envOk ? 'success' : 'warning'} className="hidden sm:inline-flex">
            {envOk ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
            Supabase {envOk ? 'connected' : 'not configured'}
          </Badge>
          <Link
            href="/login"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-red-600 px-4 text-sm font-bold text-white shadow-red hover:bg-red-700"
          >
            <LogIn className="h-4 w-4" /> Login
          </Link>
        </div>
        </div>
      </header>

      <section className="container pb-10 pt-6 sm:pt-16">
        <div className="relative overflow-hidden rounded-3xl border border-zinc-100 bg-white p-6 shadow-soft sm:p-12">
          <div className="absolute -right-16 -top-16 h-56 w-56 rounded-full bg-red-50" />
          <div className="absolute -bottom-20 right-24 h-40 w-40 rounded-full bg-red-50/70" />
          <div className="relative max-w-xl animate-fade-up">
            <Badge className="bg-red-50 text-red-600">QR ordering for restaurants</Badge>
            <h1 className="mt-4 text-3xl font-extrabold leading-tight text-black sm:text-5xl">
              Scan. Order. <span className="text-red-600">Serve.</span>
            </h1>
            <p className="mt-3 text-zinc-600 sm:text-lg">
              Your menu on every table. Orders straight to the kitchen. Sales at a glance.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href={`/admin/${DEMO}`}
                className="inline-flex h-14 items-center gap-2 rounded-2xl bg-red-600 px-6 font-bold text-white shadow-red transition hover:bg-red-700 active:scale-[0.98]"
              >
                <LayoutDashboard className="h-5 w-5" /> Owner dashboard
              </Link>
              <Link
                href={`/r/${DEMO}?table=1`}
                className="inline-flex h-14 items-center gap-2 rounded-2xl border-2 border-red-600 bg-white px-6 font-bold text-red-600 transition hover:bg-red-50 active:scale-[0.98]"
              >
                <QrCode className="h-5 w-5" /> Demo menu
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="container grid gap-4 pb-16 sm:grid-cols-2 lg:grid-cols-4">
        {features.map(({ icon: Icon, title, text, href, cta }) => (
          <Link
            key={title}
            href={href}
            className="group flex animate-fade-up flex-col rounded-2xl border border-zinc-100 bg-white p-5 shadow-soft transition hover:-translate-y-1 hover:border-red-200 hover:shadow-red focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-red-500"
          >
            <span className="grid h-11 w-11 place-items-center rounded-xl bg-red-50 text-red-600 transition group-hover:bg-red-600 group-hover:text-white">
              <Icon className="h-5 w-5" />
            </span>
            <h3 className="mt-3 text-base font-bold leading-tight text-black">{title}</h3>
            <p className="mt-1.5 flex-1 text-sm text-zinc-600">{text}</p>
            <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-red-600">
              {cta} <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" />
            </span>
          </Link>
        ))}
      </section>
    </main>
  );
}
