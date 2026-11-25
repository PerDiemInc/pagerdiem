// While a page rings: stop as soon as someone else has it (checked every 3 s, so a late push for an
// acknowledged incident stops within 3 s and is never acknowledged), or give up after 45 s.
import { formatClock } from '@/lib/time';

import type { RingingPayload } from './payload';

export type EndReason = 'answeredElsewhere' | 'unanswered';

/** "Missed page · Checkout failing. We’ll call you again at 11:02 AM." */
export const missedPageText = (payload: RingingPayload, timezone: string) =>
  `Missed page · ${payload.title}. We’ll call you again at ${formatClock(payload.nextCallAt, timezone)}.`;

export function watchRinging({ payload, fetchIncident, endCall, notifyMissed, timezone, timeoutMs = 45_000, intervalMs = 3_000 }: {
  payload: RingingPayload;
  fetchIncident: (id: number) => Promise<{ status: string }>;
  endCall: (callId: string, reason: EndReason) => void;
  notifyMissed: (text: string) => void;
  timezone: string;
  timeoutMs?: number;
  intervalMs?: number;
}) {
  let done = false;
  const finish = (reason: EndReason) => {
    if (done) return;
    stop();
    endCall(payload.callId, reason);
    if (reason === 'unanswered' && payload.type === 'page' && payload.nextCallAt) {
      notifyMissed(missedPageText(payload, timezone));
    }
  };
  const check = async () => {
    try {
      const incident = await fetchIncident(payload.incidentId);
      if (!done && incident.status !== 'open') finish('answeredElsewhere');
    } catch {
      // Offline: keep ringing; the timeout still ends it.
    }
  };
  const poll = payload.type === 'page' ? setInterval(check, intervalMs) : null;
  const timeout = setTimeout(() => finish('unanswered'), timeoutMs);
  if (payload.type === 'page') check(); // a late push may already be handled
  function stop() {
    done = true;
    if (poll) clearInterval(poll);
    clearTimeout(timeout);
  }
  return stop;
}
