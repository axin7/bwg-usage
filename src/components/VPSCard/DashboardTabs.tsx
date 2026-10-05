import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Tab, Tabs } from '@heroui/react';
import { Activity, LayoutDashboard, List } from 'lucide-react';
import type { VPSController } from './useVPSController';
import { useInitialLiveResources } from './useInitialLiveResources';
import { useSessionAudit } from './useSessionAudit';

const TrafficHistory = lazy(() => import('./TrafficHistory')
  .then((module) => ({ default: module.TrafficHistory })));
const AuditHistory = lazy(() => import('./AuditHistory')
  .then((module) => ({ default: module.AuditHistory })));

function LoadingHistory() {
  return <div role="status" className="min-h-64 py-8 text-sm text-default-600">加载中…</div>;
}

function TabTitle({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return <span className="flex items-center justify-center gap-2">{icon}{children}</span>;
}

export function DashboardTabs({ controller, overview }: {
  controller: VPSController; overview: ReactNode;
}) {
  const [selected, setSelected] = useState('overview');
  const [visited, setVisited] = useState(() => new Set(['overview']));
  const { session, reads, actions } = controller;
  const events = useSessionAudit(actions.result, session.credentials?.veid ?? '');
  useInitialLiveResources(controller, selected === 'overview');
  if (!session.credentials) return null;
  const props = { credentials: session.credentials, revision: session.revision,
    blocked: session.editing || reads.offline || actions.pending !== null };
  return <Tabs aria-label="VPS 数据视图" selectedKey={selected} variant="underlined"
    destroyInactiveTabPanel={false} onSelectionChange={(key) => {
      const next = String(key);
      setSelected(next); setVisited((previous) => new Set([...previous, next]));
    }} classNames={{ base: 'w-full', tabList: 'w-full gap-0 border-b border-default-200 p-0',
      tab: 'min-h-12 flex-1 px-2', panel: 'px-0 py-2', cursor: 'w-full' }}>
    <Tab key="overview" title={<TabTitle icon={<LayoutDashboard size={17} aria-hidden="true" />}>
      总览
    </TabTitle>}>{overview}</Tab>
    <Tab key="traffic" title={<TabTitle icon={<Activity size={17} aria-hidden="true" />}>
      流量趋势
    </TabTitle>}>
      {visited.has('traffic') ? <Suspense fallback={<LoadingHistory />}>
        <TrafficHistory {...props} active={selected === 'traffic'} />
      </Suspense> : null}
    </Tab>
    <Tab key="audit" title={<TabTitle icon={<List size={17} aria-hidden="true" />}>
      操作记录
    </TabTitle>}>
      {visited.has('audit') ? <Suspense fallback={<LoadingHistory />}>
        <AuditHistory {...props} active={selected === 'audit'} sessionEvents={events} />
      </Suspense> : null}
    </Tab>
  </Tabs>;
}
