import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: 'Gym App',
  description: 'Track your workouts. Measure your progress.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="bg-white font-sans text-slate-900 antialiased">
        <a
          href="#main-content"
          className="sr-only z-50 rounded-lg bg-white p-3 focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:outline-2 focus:outline-teal-700"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
