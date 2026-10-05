import { Unplug } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import { IconButton } from './controls';
import { LogoutButton } from './LogoutButton';

interface ExitProps {
  authEnabled: boolean;
  onDisconnected: () => void;
  onError: (error: ApiError | null) => void;
}

export function ConnectionExitButton({ authEnabled, onDisconnected, onError }: ExitProps) {
  if (authEnabled) {
    return <LogoutButton onDisconnected={onDisconnected} onError={onError} />;
  }
  return <IconButton label="断开连接" onPress={onDisconnected}>
    <Unplug size={18} aria-hidden="true" />
  </IconButton>;
}
