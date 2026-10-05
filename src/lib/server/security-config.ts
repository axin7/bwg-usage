import type { SecurityEnvironment } from './security-env';
import { SecurityError } from './security-error';
import { readPanelConfig, type PanelConfig } from './security-session';

export interface AccessConfig {
  panel: PanelConfig | null;
  origin: string | null;
}

function optionalOrigin(origin: string | undefined): string | null {
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' && url.origin === origin) return origin;
  } catch {
    // Invalid explicit configuration must not silently enable another origin.
  }
  throw new SecurityError(503, 'SECURITY_NOT_CONFIGURED', '服务的访问地址配置无效。');
}

export function readAccessConfig(env: SecurityEnvironment): AccessConfig {
  if (env.PANEL_PASSWORD || env.SESSION_SECRET || env.BWG_VEID || env.BWG_API_KEY) {
    const panel = readPanelConfig(env);
    return { panel, origin: panel.origin };
  }
  return { panel: null, origin: optionalOrigin(env.APP_ORIGIN) };
}
