// What a call push carries. APNs sends JSON numbers and FCM only strings, so both are accepted.
// Anything unexpected is dropped: a push is outside input, and a bad one must never ring.

export type RingingPayload = {
  type: 'page' | 'test'; callId: string; incidentId: number; title: string; reason: string; pagedBy: string;
  attempt: number; nextCallAt: string; server: string; sentAt: string;
};
export type PagePayload = RingingPayload | { type: 'cancel'; incidentId: number };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '');

export function parsePagePayload(raw: unknown): PagePayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  const incident = text(p.incidentId);
  if (!/^\d+$/.test(incident)) return null;
  const incidentId = Number(incident);
  if (p.type === 'cancel') return { type: 'cancel', incidentId };
  if (p.type !== 'page' && p.type !== 'test') return null;
  const callId = text(p.callId);
  const title = text(p.title).trim();
  if (!UUID.test(callId) || !title) return null;
  return {
    type: p.type, callId, incidentId, title, reason: text(p.reason), pagedBy: text(p.pagedBy),
    attempt: Number(text(p.attempt)) || 1, nextCallAt: text(p.nextCallAt), server: text(p.server), sentAt: text(p.sentAt),
  };
}
