import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'http://localhost:3000'),
  title: {
    default: 'política — datos automatizados de la elección 2027',
    template: '%s · política',
  },
  description: 'Bot automatizado que cruza Polymarket + encuestas + noticias para reportar el ciclo electoral argentino.',
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    siteName: 'política',
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
