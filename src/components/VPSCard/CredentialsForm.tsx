import { useState, type FormEvent } from 'react';
import { Button } from '@heroui/react';
import { Eye, EyeOff, KeyRound, RotateCcw, Trash2 } from 'lucide-react';
import type { ApiError } from '@/lib/api';
import type { SavedCredentials } from '@/lib/credentials';
import type { VPSCredentials } from '@/types';
import { ErrorMessage, IconButton } from './controls';

const INPUT_CLASS = 'h-11 w-full rounded-md border border-default-300 bg-white px-3 '
  + 'text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary';

interface FormProps {
  initial: VPSCredentials | null;
  stored: SavedCredentials | null;
  saving: boolean;
  error: ApiError | null;
  canCancel: boolean;
  onSubmit: (credentials: VPSCredentials, remember: boolean) => Promise<void>;
  onCancel: () => void;
  onReuse: () => void;
  onRemoveSaved: () => void;
}

function PasswordField({ value, disabled }: { value?: string; disabled: boolean }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="space-y-2">
      <label htmlFor="apiKey" className="text-sm font-medium">API Key</label>
      <div className="flex items-center gap-2">
        <input id="apiKey" name="apiKey" type={visible ? 'text' : 'password'} required
          defaultValue={value} disabled={disabled} maxLength={512} autoComplete="off"
          spellCheck={false} aria-describedby="configuration-error" className={INPUT_CLASS} />
        <IconButton label={visible ? '隐藏 API Key' : '显示 API Key'} disabled={disabled}
          onPress={() => setVisible(!visible)}>
          {visible ? <EyeOff size={18} aria-hidden="true" />
            : <Eye size={18} aria-hidden="true" />}
        </IconButton>
      </div>
    </div>
  );
}

function CredentialFields({ initial, saving }: Pick<FormProps, 'initial' | 'saving'>) {
  return (
    <fieldset disabled={saving} className="grid min-w-0 gap-5 sm:grid-cols-2">
      <div className="space-y-2">
        <label htmlFor="veid" className="text-sm font-medium">VEID</label>
        <input id="veid" name="veid" type="text" inputMode="numeric" required
          defaultValue={initial?.veid} pattern="[1-9][0-9]{0,19}" maxLength={20}
          autoComplete="off" spellCheck={false} aria-describedby="configuration-error"
          className={INPUT_CLASS} />
      </div>
      <PasswordField value={initial?.apiKey} disabled={saving} />
    </fieldset>
  );
}

function SavedConfiguration({ stored, saving, onReuse, onRemoveSaved }: Pick<FormProps,
  'stored' | 'saving' | 'onReuse' | 'onRemoveSaved'>) {
  if (!stored?.exists) return null;
  return (
    <div className="mb-6 border-l-2 border-warning bg-warning-50 p-4 text-sm">
      <p>{stored.legacy ? '发现旧版保存的配置。使用前请确认是否继续保留密钥。'
        : saving ? '正在验证连接配置。' : '此浏览器中存在保存的配置。'}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {stored.credentials ? <Button size="sm" radius="sm" variant="flat"
          isDisabled={saving} onPress={onReuse}
          startContent={<RotateCcw size={15} aria-hidden="true" />}>使用保存的配置</Button> : null}
        <Button size="sm" radius="sm" variant="light" color="danger"
          isDisabled={saving} onPress={onRemoveSaved}
          startContent={<Trash2 size={15} aria-hidden="true" />}>删除保存的配置</Button>
      </div>
    </div>
  );
}

export function CredentialsForm(props: FormProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const value = (name: string) => {
      const entry = form.get(name);
      return typeof entry === 'string' ? entry.trim() : '';
    };
    void props.onSubmit({ veid: value('veid'), apiKey: value('apiKey') }, form.has('remember'));
  };
  return (
    <section aria-labelledby="configuration-heading" aria-busy={props.saving}
      className="border-y border-default-200 py-6">
      <h2 id="configuration-heading" className="mb-5 text-lg font-semibold">连接配置</h2>
      <SavedConfiguration {...props} />
      <form onSubmit={submit} className="space-y-5">
        <CredentialFields initial={props.initial} saving={props.saving} />
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" name="remember" defaultChecked disabled={props.saving}
            className="mt-1 h-4 w-4 accent-primary" />
          <span>在此设备保存 API Key
            <span className="mt-1 block text-default-600">
              密钥会明文保存在此浏览器，勿在共享设备上勾选。
            </span>
          </span>
        </label>
        <ErrorMessage error={props.error} id="configuration-error" />
        <div className="flex flex-wrap gap-3">
          <Button type="submit" color="primary" radius="sm" isLoading={props.saving}
            startContent={<KeyRound size={17} aria-hidden="true" />}>验证并连接</Button>
          {props.canCancel ? <Button variant="light" radius="sm"
            onPress={props.onCancel}>取消</Button> : null}
        </div>
      </form>
    </section>
  );
}
