import { VPSCredentials } from '@/types';

export async function fetchVPSData(credentials: VPSCredentials) {
  const response = await fetch('/api/vps/info', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(credentials),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '请求失败');
  }

  return response.json();
}

export async function performVPSAction(
  action: 'start' | 'stop' | 'restart',
  credentials: VPSCredentials
) {
  const response = await fetch('/api/vps/action', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action,
      ...credentials,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || '请求失败');
  }

  return response.json();
} 