'use client';

import { VPSCard } from '@/components/VPSCard';

export default function Home() {
  const handleReset = () => {
    localStorage.removeItem('vps_credentials');
    window.location.reload();
  };

  return (
    <main className="min-h-screen bg-default-50 py-8">
      <VPSCard onReset={handleReset} />
    </main>
  );
} 