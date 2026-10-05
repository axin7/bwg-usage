import { useEffect, useRef, useState } from 'react';
import { performVPSAction, toApiError } from '@/lib/api';
import type { VPSAction } from '@/types';
import {
  ACTION_LABELS, actionVerified, type ActionResult, type ActionSelection, type ActionTarget,
} from './actionState';
import type { VPSSession } from './useVPSSession';
import type { VPSReadController } from './useVPSRead';

interface ActionContext {
  selection: ActionSelection;
  session: VPSSession;
  reads: VPSReadController;
  alive: React.RefObject<boolean>;
  finish: () => void;
  result: (result: ActionResult) => void;
}

async function executeAction(context: ActionContext): Promise<void> {
  const { selection, session, reads } = context;
  const { target, credentials, revision } = selection;
  reads.pause();
  try {
    const receipt = await performVPSAction(target.action, credentials);
    if (!context.alive.current) return;
    context.result({ target, outcome: 'accepted', requestId: receipt.requestId,
      historyWarning: receipt.historyWarning,
      message: `服务商已接收${ACTION_LABELS[target.action]}请求，运行状态尚未确认。` });
    if (session.current.current.revision !== revision || session.current.current.editing) return;
    const data = await reads.refresh(true);
    if (context.alive.current && actionVerified(target.action, data)) {
      context.result({ target, outcome: 'verified', requestId: receipt.requestId,
        historyWarning: receipt.historyWarning,
        message: `服务商已接收${ACTION_LABELS[target.action]}请求，已检测到目标运行状态。` });
    }
  } catch (error) {
    if (!context.alive.current) return;
    const failure = toApiError(error);
    const unknown = failure.outcome !== 'rejected';
    context.result({ target, outcome: unknown ? 'unknown' : 'rejected',
      requestId: failure.requestId, message: unknown
        ? '操作结果未知，请先确认服务器状态后再决定是否重新操作。' : failure.message });
  } finally {
    if (session.current.current.revision === revision && !session.current.current.editing) {
      reads.resume();
    }
    context.finish();
  }
}

export function useVPSActions(session: VPSSession, reads: VPSReadController) {
  const [dialog, setDialog] = useState<ActionTarget | null>(null);
  const [pending, setPending] = useState<ActionTarget | null>(null);
  const [result, setResult] = useState<ActionResult | null>(null);
  const selected = useRef<ActionSelection | null>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { selected.current = null; setDialog(null); },
    [session.state.revision, session.state.editing]);
  const close = () => { selected.current = null; setDialog(null); };
  const open = (action: VPSAction) => {
    const current = session.current.current;
    if (!current.credentials || current.editing || busy.current || !navigator.onLine) return;
    const target = { action, veid: current.credentials.veid,
      hostname: reads.data?.basic.hostname || '未知主机' };
    selected.current = { target, credentials: { ...current.credentials },
      revision: current.revision };
    setDialog(target);
  };
  const confirm = () => {
    const selection = selected.current;
    const current = session.current.current;
    if (!selection || busy.current || current.editing || !navigator.onLine
      || selection.revision !== current.revision) return;
    busy.current = true;
    close();
    setPending(selection.target);
    setResult(null);
    void executeAction({ selection, session, reads, alive, result: setResult,
      finish: () => { busy.current = false; if (alive.current) setPending(null); } });
  };
  return { dialog, pending, result, open, close, confirm, isPending: () => busy.current };
}
