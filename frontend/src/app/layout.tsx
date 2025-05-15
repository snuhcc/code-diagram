import '@/app/globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'CodeFlow' };

export default function RootLayout({ children }:{ children:ReactNode }) {
  return (
    <html lang="en">
      <body className="h-full">{children}</body>
    </html>
  );
}
