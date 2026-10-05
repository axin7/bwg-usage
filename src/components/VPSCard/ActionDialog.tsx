import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import { Power, RotateCw, Square, Trash2, X } from 'lucide-react';
import type { ComponentProps } from 'react';
import { ACTION_LABELS, type ActionTarget } from './actionState';

function CloseButton(props: ComponentProps<'button'>) {
  return <button {...props} type="button" aria-label="关闭" title="关闭">
    <X size={18} aria-hidden="true" />
  </button>;
}

export function ActionDialog({ target, onClose, onConfirm }: {
  target: ActionTarget | null; onClose: () => void; onConfirm: () => void;
}) {
  const action = target?.action ?? 'start';
  const Icon = action === 'start' ? Power : action === 'stop' ? Square : RotateCw;
  return (
    <Modal isOpen={target !== null} onClose={onClose} radius="sm" placement="center"
      closeButton={<CloseButton />}>
      <ModalContent>
        <ModalHeader>{ACTION_LABELS[action]} VPS</ModalHeader>
        <ModalBody>
          <p className="break-words font-medium">{target?.hostname}</p>
          <p className="text-sm text-default-600">VEID：{target?.veid}</p>
          <p className="text-sm">{action === 'stop' ? '此操作将中断正在运行的服务。'
            : action === 'restart' ? '此操作将暂时中断所有服务。' : '确认启动此服务器？'}</p>
        </ModalBody>
        <ModalFooter>
          <Button variant="light" radius="sm" onPress={onClose}>取消</Button>
          <Button color={action === 'stop' ? 'danger'
            : action === 'restart' ? 'warning' : 'success'}
            aria-label={`确认${ACTION_LABELS[action]}`}
            radius="sm" onPress={onConfirm} startContent={<Icon size={17} aria-hidden="true" />}>
            确认{ACTION_LABELS[action]}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}

export function ResetDialog({ open, onClose, onConfirm }: {
  open: boolean; onClose: () => void; onConfirm: () => void;
}) {
  return (
    <Modal isOpen={open} onClose={onClose} radius="sm" placement="center"
      closeButton={<CloseButton />}>
      <ModalContent>
        <ModalHeader>清除配置</ModalHeader>
        <ModalBody><p className="text-sm">清除本次连接和此浏览器中保存的密钥？</p></ModalBody>
        <ModalFooter>
          <Button variant="light" radius="sm" onPress={onClose}>取消</Button>
          <Button color="danger" radius="sm" onPress={onConfirm}
            startContent={<Trash2 size={17} aria-hidden="true" />}>确认清除</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
}
