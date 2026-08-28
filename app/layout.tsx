import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FUL-MAR · Órdenes de compra',
  description: 'Gestión de órdenes de compra, firma y entregas parciales.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
