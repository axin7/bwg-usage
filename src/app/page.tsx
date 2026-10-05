import { VPSCard } from '@/components/VPSCard';
import { getServerVEID } from '@/lib/server/vps-credentials';
import { readAccessConfig } from '@/lib/server/security-config';
import { readSecurityEnvironment } from '@/lib/server/security-env';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const authEnabled = Boolean(readAccessConfig(await readSecurityEnvironment()).panel);
  let serverVEID: string | null;
  try {
    serverVEID = getServerVEID();
  } catch {
    return <main className="mx-auto max-w-4xl px-4 py-12">
      <h1 className="mb-6 text-2xl font-semibold">VPS 控制面板</h1>
      <p role="alert">服务端 VPS 配置不完整或无效。</p>
    </main>;
  }
  return (
    <main className="min-h-screen bg-background py-6 sm:py-10">
      <VPSCard serverVEID={serverVEID} authEnabled={authEnabled} />
    </main>
  );
}
