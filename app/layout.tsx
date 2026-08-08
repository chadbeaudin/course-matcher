import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'course-matcher',
  description: 'Generate a local training route matching a race\'s distance and elevation profile.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
