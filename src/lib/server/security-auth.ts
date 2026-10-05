import { readJsonBody } from './route-input';
import { RouteError } from './route-error';
import { assertRequestBoundary, type SecurityDependencies } from './security';
import { checkDistributedLimit } from './security-limit';
import { readSecurityEnvironment } from './security-env';
import { SecurityError } from './security-error';
import {
  createSession,
  expiredSessionCookie,
  matchesPassword,
  readPanelConfig,
  sessionCookie,
} from './security-session';

async function authResponse(
  operation: string,
  handler: () => Promise<Response>,
): Promise<Response> {
  const requestId = crypto.randomUUID();
  const started = Date.now();
  let code = 'OK';
  let response: Response;
  try {
    response = await handler();
  } catch (error) {
    const known = error instanceof SecurityError || error instanceof RouteError;
    code = known ? error.code : 'INTERNAL_ERROR';
    response = Response.json({ error: {
      code: known ? error.code : 'INTERNAL_ERROR',
      message: known ? error.message : '服务暂时无法处理请求。',
      requestId,
    } }, { status: known ? error.status : 500 });
    if (known && error.retryAfter !== undefined) {
      response.headers.set('Retry-After', String(error.retryAfter));
    }
  }
  response.headers.set('Cache-Control', 'private, no-store');
  response.headers.set('X-Request-ID', requestId);
  console.info(JSON.stringify({
    requestId, operation, code, status: response.status,
    outcome: response.ok ? 'success' : 'rejected', durationMs: Date.now() - started,
  }));
  return response;
}

function createLoginHandler(deps: SecurityDependencies) {
  return (request: Request): Promise<Response> => authResponse('login', async () => {
    const env = await deps.readEnvironment();
    assertRequestBoundary(request, env);
    const config = readPanelConfig(env);
    await (deps.checkLimit ?? checkDistributedLimit)('login', env);
    const body = await readJsonBody(request);
    if (typeof body.password !== 'string' || body.password.length > 1_024) {
      throw new SecurityError(400, 'INVALID_INPUT', '请输入有效的密码。');
    }
    if (!matchesPassword(body.password, config.password)) {
      throw new SecurityError(401, 'ACCESS_DENIED', '密码不正确。');
    }
    const cookie = sessionCookie(await createSession(config));
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie } });
  });
}

function createLogoutHandler(deps: SecurityDependencies) {
  return (request: Request): Promise<Response> => authResponse('logout', async () => {
    const env = await deps.readEnvironment();
    assertRequestBoundary(request, env);
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': expiredSessionCookie() } });
  });
}

export function createAuthHandlers(deps: SecurityDependencies) {
  return { login: createLoginHandler(deps), logout: createLogoutHandler(deps) };
}

const handlers = createAuthHandlers({ readEnvironment: readSecurityEnvironment });
export const handleLoginRequest = handlers.login;
export const handleLogoutRequest = handlers.logout;
