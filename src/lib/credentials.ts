import type { VPSCredentials } from '@/types';

const STORAGE_KEY = 'vps_credentials_v2';
const LEGACY_KEY = 'vps_credentials';

export interface SavedCredentials {
  credentials: VPSCredentials | null;
  exists: boolean;
  legacy: boolean;
  error: string | null;
}

export function validateCredentials(value: unknown): value is VPSCredentials {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.veid === 'string' && /^[1-9]\d{0,19}$/.test(candidate.veid)
    && typeof candidate.apiKey === 'string' && candidate.apiKey.length >= 1
    && candidate.apiKey.length <= 512 && !/[\s\u0000-\u001f]/.test(candidate.apiKey);
}

export function loadSavedCredentials(): SavedCredentials {
  try {
    const current = localStorage.getItem(STORAGE_KEY);
    const legacy = current === null ? localStorage.getItem(LEGACY_KEY) : null;
    const value = current ?? legacy;
    if (value === null) return { credentials: null, exists: false, legacy: false, error: null };
    const parsed: unknown = JSON.parse(value);
    if (!validateCredentials(parsed)) throw new Error('Invalid credentials');
    return { credentials: parsed, exists: true, legacy: !current, error: null };
  } catch {
    return {
      credentials: null, exists: true, legacy: false,
      error: '无法读取已保存的配置，可删除后重新填写。',
    };
  }
}

export function persistCredentials(credentials: VPSCredentials, remember: boolean): string | null {
  try {
    if (remember) localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials));
    else localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
    return null;
  } catch {
    return remember ? '浏览器未能完整保存或清理配置，请检查本站存储。当前会话仍可连接。'
      : '浏览器未能清除已保存的密钥，请在浏览器设置中清除本站数据。';
  }
}

export function clearSavedCredentials(): string | null {
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(LEGACY_KEY);
    return null;
  } catch {
    return '浏览器未能清除已保存的密钥，请在浏览器设置中清除本站数据。';
  }
}
