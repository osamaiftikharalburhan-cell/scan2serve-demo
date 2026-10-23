import Link from 'next/link';
import { QrCode } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Logo({ className, href = '/' }) {
  return (
    <Link href={href} className={cn('inline-flex items-center gap-2 font-extrabold', className)}>
      <span className="grid h-9 w-9 place-items-center rounded-xl bg-brand-gradient text-white shadow-glow">
        <QrCode className="h-5 w-5" />
      </span>
      <span className="text-lg tracking-tight">
        Scan<span className="text-primary">2</span>Serve
      </span>
    </Link>
  );
}
