// Answering the call acknowledges the page (D1). There's no audio, so the call ends right away and
// the app goes to the page. iOS never brings an app forward from a call, so a notice confirms the
// acknowledgement and opens the page when tapped. A dropped connection is retried after 1, 4 and 15 s.
import { ApiError } from '@/lib/api';

import type { RingingPayload } from './payload';

const BACKOFF_MS = [1_000, 4_000, 15_000];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export type Notice = { title: string; body: string; path: string };

export async function onAnswer(payload: RingingPayload, { post, endCall, navigate, notify }: {
  post: (path: string, body: unknown) => Promise<unknown>;
  endCall: (callId: string) => void;
  navigate: (path: string) => void;
  notify: (notice: Notice) => void;
}) {
  // The call stays up until the acknowledgement settles: iOS keeps a live call's app running, and
  // may suspend it as soon as the call ends, before a retry or the notice.
  try {
    if (payload.type === 'test') {
      navigate('/setup?tested=1');
      await post('/api/app/device/test-call/answered', { callId: payload.callId }).catch(() => null);
      return;
    }
    const path = `/page/${payload.incidentId}`;
    navigate(path);
    notify(await acknowledge(payload, post, path));
  } finally {
    endCall(payload.callId);
  }
}

async function acknowledge(payload: RingingPayload, post: (path: string, body: unknown) => Promise<unknown>, path: string): Promise<Notice> {
  for (let attempt = 0; ; attempt++) {
    try {
      const result = (await post(`/api/app/incidents/${payload.incidentId}/ack`, { via: 'call' })) as {
        changed: boolean; incident: { ackedBy: { name: string } | null };
      };
      return result.changed
        ? { title: `Acknowledged · ${payload.title}`, body: 'Paging stopped. Tap to open.', path }
        : { title: `Already acknowledged · ${payload.title}`, body: `${result.incident.ackedBy?.name ?? 'Someone else'} has it. Tap to open.`, path };
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 0;
      // A dropped connection or a server error is worth another try; any other refusal won't change.
      if ((status === 0 || status >= 500) && attempt < BACKOFF_MS.length) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      if (status === 409) return { title: `Already resolved · ${payload.title}`, body: 'Nothing to do. Tap to open.', path };
      return { title: `Couldn’t acknowledge · ${payload.title}`, body: status === 0 || status >= 500 ? 'Open the incident to try again.' : (err as Error).message, path };
    }
  }
}
