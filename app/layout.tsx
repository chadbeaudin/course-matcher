import type { Metadata } from 'next';
import './globals.css';
import { NO_FLASH_THEME_SCRIPT } from '@/lib/theme';

export const metadata: Metadata = {
  title: 'course-matcher',
  description: 'Generate a local training route matching a race\'s distance and elevation profile.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
      </head>
      <body className="bg-white text-gray-900 dark:bg-gray-950 dark:text-gray-100">
        {children}
      </body>
    </html>
  );
}
