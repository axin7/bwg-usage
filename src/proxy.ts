import { assertRequestAccess, SecurityError } from '@/lib/server/security';
import { securityHeaders } from '@/lib/security-headers';

export async function proxy(request: Request) {
  try {
    await assertRequestAccess(request);
  } catch (error) {
    if (error instanceof SecurityError && error.status === 401
      && new URL(request.url).pathname === '/') {
      return new Response(null, {
        status: 303,
        headers: { ...securityHeaders, Location: '/login', 'Cache-Control': 'private, no-store' },
      });
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

export const config = { matcher: ['/', '/api/vps/:path*'] };
