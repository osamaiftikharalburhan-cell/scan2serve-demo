'use client';

import { RotateCcw } from 'lucide-react';
import { CustomerMessage } from '@/components/customer/customer-message';

export default function CustomerError({ reset }) {
  return (
    <CustomerMessage
      title="Something went wrong"
      text="We couldn't load the menu. Please try again."
      action={
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-brand-gradient font-bold text-white shadow-glow"
        >
          <RotateCcw className="h-5 w-5" /> Try again
        </button>
      }
    />
  );
}
