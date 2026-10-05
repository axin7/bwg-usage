import { beforeEach, expect, test, vi } from 'vitest';
import { POST } from '@/app/api/vps/history/route';
import { assertRequestAccess, checkRateLimit } from '@/lib/server/security';
import { RouteError } from '@/lib/server/route-error';

vi.mock('@/lib/server/security', () => ({
  assertRequestAccess: vi.fn().mockResolvedValue({ sub: 'test' }),
  checkRateLimit: vi.fn().mockResolvedValue(undefined),
}));
const fetcher = vi.fn<typeof fetch>();
function request(body: object) {
  return new Request('http://localhost:3000/api/vps/history', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('BWG_VEID', '123');
  vi.stubEnv('BWG_API_KEY', 'synthetic-server-key');
  vi.stubGlobal('fetch', fetcher);
  fetcher.mockReset().mockResolvedValue(Response.json({ error: 0, data: [] }));
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

test('guards history before querying and returns no-store sanitized DTOs', async () => {
  const response = await POST(request({ veid: '123', range: '7d', apiKey: 'ignored' }));
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(checkRateLimit).toHaveBeenCalledWith(expect.any(Request), false);
  const body = new URLSearchParams(String(fetcher.mock.calls[0][1]?.body));
  expect(body.get('api_key')).toBe('synthetic-server-key');
  expect(await response.text()).not.toContain('synthetic-server-key');
});

test.each([{ veid: '123', range: 'year' }, { veid: '456', range: '7d' }])(
  'rejects invalid ranges or mismatched targets without upstream dispatch', async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  },
);

test('access denial precedes the limiter and provider', async () => {
  vi.mocked(assertRequestAccess).mockRejectedValueOnce(
    new RouteError(403, 'INVALID_ORIGIN', 'Denied'));
  expect((await POST(request({ veid: '123', range: '7d' }))).status).toBe(403);
  expect(checkRateLimit).not.toHaveBeenCalled();
  expect(fetcher).not.toHaveBeenCalled();
});
