import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'Timba 2027 — la timba electoral argentina',
    template: '%s · Timba 2027',
  },
  description: 'Bot automatizado que cruza Polymarket + encuestas locales + noticias mainstream para reportar el mercado electoral argentino 2027. Sin opinión, con fuente.',
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    siteName: 'Timba 2027',
    images: ['/og-default.png'],
  },
  twitter: { card: 'summary_large_image' },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
