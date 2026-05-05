import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'Política Bot — Admin',
  description: 'Review queue de drafts del bot',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
