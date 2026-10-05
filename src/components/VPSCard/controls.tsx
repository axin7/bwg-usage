import { Button, Tooltip } from '@heroui/react';
import type { ReactNode } from 'react';
import type { ApiError } from '@/lib/api';

export function IconButton({ label, children, onPress, disabled = false, loading = false }: {
  label: string; children: ReactNode; onPress: () => void; disabled?: boolean; loading?: boolean;
}) {
  return (
    <Tooltip content={label}>
      <Button isIconOnly aria-label={label} variant="light" radius="sm"
        isDisabled={disabled} isLoading={loading} onPress={onPress}>
        {children}
      </Button>
    </Tooltip>
  );
}

export function ErrorMessage({ error, id }: { error: ApiError | null; id?: string }) {
  if (!error) return null;
  return (
    <div id={id} role="alert" className="break-words border-l-2 border-danger p-3 text-sm">
      <p>{error.message}</p>
      {error.requestId ? <p className="mt-1 text-default-600">请求编号：{error.requestId}</p> : null}
    </div>
  );
}
