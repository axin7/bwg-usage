import { useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import { logoutSession, toApiError, type ApiError } from '@/lib/api';
import { IconButton } from './controls';

export function LogoutButton({ onDisconnected, onError, navigate }: {
  onDisconnected: () => void;
  onError: (error: ApiError | null) => void;
  navigate?: () => void;
}) {
  const busy = useRef(false);
  const [loading, setLoading] = useState(false);
  const logout = async () => {
    if (busy.current) return;
    busy.current = true;
    setLoading(true);
    onError(null);
    try {
      await logoutSession();
      onDisconnected();
      if (navigate) navigate();
      else window.location.assign('/login');
    } catch (error) {
      onError(toApiError(error));
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };
  return <IconButton label="退出登录" loading={loading} onPress={() => { void logout(); }}>
    <LogOut size={18} aria-hidden="true" />
  </IconButton>;
}
