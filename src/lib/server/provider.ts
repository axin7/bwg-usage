import type { VPSAction, VPSCredentials, VPSData } from '@/types';
import { parseProviderService } from './provider-data';
import { requestProvider, type ProviderOptions } from './provider-request';
import { transformVPSData } from './vps-data';

export async function getVPSInfo(
  credentials: VPSCredentials,
  live: boolean,
  options: ProviderOptions = {},
  now: () => Date = () => new Date(),
): Promise<VPSData> {
  const endpoint = live ? 'getLiveServiceInfo' : 'getServiceInfo';
  const raw = await requestProvider(endpoint, credentials, false, options);
  return transformVPSData(parseProviderService(raw, live), now());
}

export async function submitVPSAction(
  action: VPSAction,
  credentials: VPSCredentials,
  options: ProviderOptions = {},
): Promise<void> {
  await requestProvider(action, credentials, true, options);
}
