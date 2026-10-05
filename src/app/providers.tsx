'use client';

import { HeroUIProvider } from '@heroui/react';
import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">
    <HeroUIProvider>{children}</HeroUIProvider>
  </MotionConfig>;
}
