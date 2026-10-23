import { Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';

const fontSans = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
  display: 'swap',
});

export const metadata = {
  title: {
    default: 'Scan2Serve — QR Restaurant Ordering',
    template: '%s · Scan2Serve',
  },
  description: 'Scan the QR on your table, browse the menu and order in seconds.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#ea580c',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={fontSans.variable}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
