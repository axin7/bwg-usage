import { Providers } from "./providers";
import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'VPS 控制面板',
  description: 'VPS Traffic Monitoring Dashboard',
};

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <html lang="zh-CN" className="light">
      <body>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
