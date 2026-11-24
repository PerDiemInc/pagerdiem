// Pages on iPhone. PushKit wakes the app and AppDelegate shows the CallKit call before any
// JavaScript runs (iOS requires it), for every VoIP push. This file does the rest, for the app's
// whole life: ends calls it can't take (signed out, not a valid page, another server), watches the
// incident while it rings, acknowledges on answer, and keeps the server's copy of the VoIP token current.
import * as Notifications from 'expo-notifications';
import RNCallKeep, { CONSTANTS } from 'react-native-callkeep';
import VoipPushNotification from 'react-native-voip-push-notification';

import type { Tone } from '@/hooks/use-phone-settings';

import { onAnswer, type Notice } from './answer';
import { parsePagePayload, type RingingPayload } from './payload';
import { missedPageText, watchRinging } from './ringing';

/** The ringtone file in the app bundle for each choice on You. */
export const RINGTONE_FILES: Record<Tone, string> = { siren: 'rising.caf', classic: 'classic.caf', pulse: 'beeps.caf' };

/** Where a tapped notice may take you: only an incident's page. */
export function noticePath(data: unknown): string | null {
  const path = (data as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' && /^\/page\/\d+$/.test(path) ? path : null;
}

function notify({ title, body, path }: Notice) {
  Notifications.scheduleNotificationAsync({ content: { title, body, data: { path } }, trigger: null }).catch(() => null);
}

export function setRingtone(tone: Tone) {
  RNCallKeep.setup({
    ios: {
      appName: 'PagerDiem', supportsVideo: false, maximumCallGroups: '1', maximumCallsPerCallGroup: '1',
      includesCallsInRecents: false, ringtoneSound: RINGTONE_FILES[tone],
    },
    android: { alertTitle: '', alertDescription: '', cancelButton: '', okButton: '', additionalPermissions: [] },
  });
}

/** What a call needs from the signed-in session; null when signed out. */
export type CallContext = {
  post: (path: string, body?: unknown) => Promise<unknown>;
  get: <T>(path: string) => Promise<T>;
  server: string;
  publicUrl?: string;
  timezone: string;
};

const host = (url: string) => {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
};

/**
 * A page from the server this phone is signed in to (its public address, or the one typed in).
 * When the public address isn't known yet (signed in before it was saved), ring: a pager that
 * drops a real page is worse than one that rings for the wrong server.
 */
function fromThisServer(payload: RingingPayload, ctx: CallContext) {
  const from = host(payload.server);
  if (from === null) return false;
  return ctx.publicUrl === undefined || from === host(ctx.publicUrl) || from === host(ctx.server);
}

export function startIosCalls({ context, navigate, ringtone }: { context: () => CallContext | null; navigate: (path: string) => void; ringtone: Tone }) {
  const reasons = CONSTANTS.END_CALL_REASONS;
  const ringing = new Map<string, { payload: RingingPayload; stop: () => void }>();
  // Each call is handled once: the libraries re-send what happened before JS loaded.
  const handled = new Set<string>();
  const answered = new Set<string>();
  // Taps on a call that arrive before the call itself (all queued while the app was closed).
  const early = new Map<string, 'answer' | 'end'>();
  let lastToken: string | null = null;

  function register(token: unknown) {
    const ctx = context();
    if (!ctx || typeof token !== 'string' || !token || token === lastToken) return;
    lastToken = token;
    ctx.post('/api/app/device', { pushToken: token }).catch(() => { lastToken = null; });
  }

  function shown({ callUUID, payload: raw }: { callUUID: string; payload?: unknown }) {
    const id = callUUID.toLowerCase();
    if (handled.has(id)) return;
    handled.add(id);
    VoipPushNotification.onVoipNotificationCompleted(callUUID); // tell iOS this push is dealt with
    const payload = parsePagePayload(raw);
    const ctx = context();
    if (!ctx || !payload || payload.type === 'cancel' || payload.callId !== id || !fromThisServer(payload, ctx)) {
      RNCallKeep.reportEndCallWithUUID(callUUID, reasons.FAILED);
      early.delete(id);
      return;
    }
    const stop = watchRinging({
      payload, timezone: ctx.timezone,
      notifyMissed: (text) => notify({ title: text, body: '', path: `/page/${payload.incidentId}` }),
      // Signed out while it rings: treat it as handled, which ends the call.
      fetchIncident: (incident) => context()?.get<{ incident: { status: string } }>(`/api/app/incidents/${incident}`).then((d) => d.incident)
        ?? Promise.resolve({ status: 'signedOut' }),
      endCall: (callId, reason) => {
        ringing.delete(callId);
        RNCallKeep.reportEndCallWithUUID(callId, reason === 'answeredElsewhere' ? reasons.ANSWERED_ELSEWHERE : reasons.UNANSWERED);
      },
    });
    ringing.set(id, { payload, stop });
    const tapped = early.get(id);
    early.delete(id);
    if (tapped === 'answer') answer({ callUUID: id });
    if (tapped === 'end') end({ callUUID: id });
  }

  function answer({ callUUID }: { callUUID: string }) {
    const id = callUUID.toLowerCase();
    const call = ringing.get(id);
    const ctx = context();
    if (!call || !ctx) return void (handled.has(id) || early.set(id, 'answer'));
    call.stop();
    ringing.delete(id);
    answered.add(id);
    onAnswer(call.payload, { post: ctx.post, navigate, notify, endCall: (callId) => RNCallKeep.endCall(callId) });
  }

  function end({ callUUID }: { callUUID: string }) {
    const id = callUUID.toLowerCase();
    // Our own hang-up after answering also arrives here; only a decline is a missed page (D2).
    if (answered.delete(id)) return;
    const call = ringing.get(id);
    if (!call) return void (handled.has(id) || early.set(id, 'end'));
    call.stop();
    ringing.delete(id);
    const ctx = context();
    if (ctx && call.payload.type === 'page' && call.payload.nextCallAt) {
      notify({ title: missedPageText(call.payload, ctx.timezone), body: '', path: `/page/${call.payload.incidentId}` });
    }
  }

  setRingtone(ringtone);
  // Notices show even with the app open. (Wake-up checks asks for the permission.)
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  });
  VoipPushNotification.addEventListener('register', register);
  VoipPushNotification.addEventListener('didLoadWithEvents', (events: { name: string; data: unknown }[]) => {
    for (const e of events ?? []) if (e.name === VoipPushNotification.RNVoipPushRemoteNotificationsRegisteredEvent) register(e.data);
  });
  RNCallKeep.addEventListener('didDisplayIncomingCall', shown);
  RNCallKeep.addEventListener('answerCall', answer);
  RNCallKeep.addEventListener('endCall', end);
  RNCallKeep.addEventListener('didLoadWithEvents', (events) => {
    for (const e of events ?? []) {
      if (e.name === 'RNCallKeepDidDisplayIncomingCall') shown(e.data);
      if (e.name === 'RNCallKeepPerformAnswerCallAction') answer(e.data);
      if (e.name === 'RNCallKeepPerformEndCallAction') end(e.data);
    }
    RNCallKeep.clearInitialEvents();
  });
  // iOS hands over the token on every start, so the server's copy is refreshed each cold start.
  VoipPushNotification.registerVoipToken();

  return {
    /** After signing in: send this phone's token to the (new) server. */
    refreshToken() {
      lastToken = null;
      VoipPushNotification.registerVoipToken();
    },
    stop() {
      for (const { stop } of ringing.values()) stop();
      ringing.clear();
      VoipPushNotification.removeEventListener('register');
      VoipPushNotification.removeEventListener('didLoadWithEvents');
      RNCallKeep.removeEventListener('didDisplayIncomingCall');
      RNCallKeep.removeEventListener('answerCall');
      RNCallKeep.removeEventListener('endCall');
      RNCallKeep.removeEventListener('didLoadWithEvents');
    },
  };
}
