import { getVPSInfo } from '@/lib/server/provider';
import { runRoute } from '@/lib/server/route-handler';
import { parseLive } from '@/lib/server/route-input';
import { resolveVPSCredentials } from '@/lib/server/vps-credentials';

export function POST(request: Request): Promise<Response> {
  return runRoute(request, false, async (body, context) => {
    return getVPSInfo(resolveVPSCredentials(body), parseLive(body), { signal: context.signal });
  });
}
