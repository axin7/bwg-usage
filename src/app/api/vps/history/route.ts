import { getTrafficHistory, parseTrafficRange } from '@/lib/server/provider-history';
import { runRoute } from '@/lib/server/route-handler';
import { resolveVPSCredentials } from '@/lib/server/vps-credentials';

export function POST(request: Request): Promise<Response> {
  return runRoute(request, false, async (body, context) => {
    const range = parseTrafficRange(body);
    return getTrafficHistory(resolveVPSCredentials(body), range, { signal: context.signal });
  });
}
