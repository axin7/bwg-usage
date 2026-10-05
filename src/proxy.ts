import {
  assertRequestAccess, assertRequestBoundary, SecurityError,
} from '@/lib/server/security';
import { readAccessConfig } from '@/lib/server/security-config';
import { readSecurityEnvironment } from '@/lib/server/security-env';
import { securityHeaders } from '@/lib/security-headers';

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { ...securityHeaders, Location: location, 'Cache-Control': 'private, no-store' },
  });
}

export async function proxy(request: Request) {
  try {
    if (new URL(request.url).pathname === '/login') {
      const env = await readSecurityEnvironment();
      assertRequestBoundary(request, env);
      if (!readAccessConfig(env).panel) return redirectResponse('/');
      return;
    }
    await assertRequestAccess(request);
  } catch (error) {
    if (error instanceof SecurityError && error.status === 401
      && new URL(request.url).pathname === '/') {
      return redirectResponse('/login');
    }
    const requestId = crypto.randomUUID();
    const status = error instanceof SecurityError ? error.status : 503;
    const code = error instanceof SecurityError ? error.code : 'SECURITY_UNAVAILABLE';
    const message = error instanceof SecurityError ? error.message : '访问保护暂不可用';
    return Response.json(
      { error: { code, message, requestId } },
      { status, headers: { ...securityHeaders,
        'Cache-Control': 'private, no-store', 'X-Request-ID': requestId } },
    );
  }
}

export const config = { matcher: ['/', '/login', '/api/vps/:path*'] };
