// The pagerdiem server's phone API (/api/app/*): the contract from the spec, and a small client.

export type Role = 'admin' | 'engineer' | 'non_technical';
export type Person = { id: number; name: string; initials: string; role: Role };
export type Coverage = { days: number[]; start: string; end: string; weekendCount: number; weekdayCount: number };
export type DeviceChecks = { notifications: boolean; focus: boolean; ringer: boolean; fullScreen: boolean; dndAccess: boolean };
export type Device = { id: number; platform: 'ios' | 'android'; pushReady: boolean; testedAt: string | null; checks: DeviceChecks };
export type Team = { appName: string; teamName: string; timezone: string; publicUrl: string; slackChannelName: string };
export type Me = {
  user: Person & { email: string; slack: string | null; phone: string };
  team: Team; coverage: Coverage; calendarFeedUrl: string; device: Device;
};
export type Weekend = { key: string; start: string; end: string; people: Person[]; count: number; needsCover: boolean; mine: boolean };
export type OnCall = { people: Person[]; start: string; until: string; backup: Person | null };
export type IncidentStatus = 'open' | 'acknowledged' | 'resolved';
export type IncidentSummary = {
  id: number; title: string; status: IncidentStatus; source: string; quiet: boolean;
  createdAt: string; createdBy: Person | null; assigned: Person | null; ackedBy: Person | null;
  ackedAt: string | null; resolvedAt: string | null; repeats: number;
};
export type FeedItem = { at: string; kind: 'event' | 'note'; text: string; author: Person | null };
export type Reach = { at: string; channel: 'slack' | 'push'; recipient: string; status: 'sent' | 'failed' | 'dry-run' };
export type EscalationStep = { at: string; label: string; state: 'done' | 'next' | 'later' | 'skipped' };
export type TeamMember = Person & {
  email: string; phone: string; slack: string | null; order: number; nextWeekend: string | null; app: 'woken' | 'focus-risk' | 'none';
};
export type ActivityItem = {
  at: string; text: string; via: 'web' | 'slack' | 'app' | 'api' | null;
  icon: 'ack' | 'resolve' | 'join' | 'leave' | 'swap' | 'cover' | 'team' | 'settings' | 'test';
};
export type Done = { ok: true; message: string; undo?: { ids: number[]; until: string } };

export type Home = { now: string; onCall: OnCall | null; next: Weekend | null; needsYou: IncidentSummary[]; comingUp: Weekend[] };
export type Incidents = {
  incidents: IncidentSummary[]; recentTitles: string[];
  stats: { open: number; acknowledged: number; resolved: number; last30Days: number; medianAckMinutes: number | null };
};
export type IncidentDetail = {
  incident: IncidentSummary & { details: string; backup: Person | null; escalationLevel: number };
  feed: FeedItem[]; reached: Reach[]; escalation: EscalationStep[]; onCall: Person[];
};
export type Schedule = { coverage: Coverage; weekends: Weekend[] };
export type TeamList = { members: TeamMember[]; inactive: TeamMember[]; signupUrl: string };

export class ApiError extends Error {
  constructor(public status: number, message: string, public field?: string) {
    super(message);
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export function createClient({ server, token, fetchImpl = fetch, timeoutMs = 10_000, onUnauthorized }: {
  server: string; token?: string; fetchImpl?: Fetch; timeoutMs?: number; onUnauthorized?: () => void;
}) {
  const host = server.replace(/^https?:\/\//, '');

  async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetchImpl(server + path, {
        method,
        signal: controller.signal,
        headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError(0, `Can't reach ${host}`);
    } finally {
      clearTimeout(timer);
    }
    const json = res.status === 204 ? null : await res.json().catch(() => null);
    if (res.ok) return json as T;
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, json?.error ?? `Something went wrong (${res.status})`, json?.field);
  }

  return {
    get: <T>(path: string) => request<T>('GET', path),
    post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  };
}

export type Api = ReturnType<typeof createClient>;
