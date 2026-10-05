import { useVPSSession } from './useVPSSession';
import { useVPSRead } from './useVPSRead';
import { useVPSConfiguration } from './useVPSConfiguration';
import { useVPSActions } from './useVPSActions';

export function useVPSController(serverVEID: string | null = null) {
  const session = useVPSSession(serverVEID);
  const reads = useVPSRead(
    session.state.credentials, session.state.initialData, session.state.revision,
  );
  const actions = useVPSActions(session, reads);
  const configuration = useVPSConfiguration(session, reads, actions.isPending);
  return { session: session.state, reads, configuration, actions };
}

export type VPSController = ReturnType<typeof useVPSController>;
