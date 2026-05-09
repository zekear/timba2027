import './globals.css';
import type { ReactNode } from 'react';
import Script from 'next/script';

const GA_ID = 'G-CPXZSN5G1R';
const enableAnalytics = process.env.NODE_ENV === 'production';

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
  alternates: {
    types: { 'application/atom+xml': '/feed.xml' },
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">
        {children}
        {enableAnalytics && (
          <>
            <Script
              src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
              strategy="afterInteractive"
            />
            <Script id="ga-init" strategy="afterInteractive">
              {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
            </Script>
          </>
        )}
      </body>
    </html>
  );
}
