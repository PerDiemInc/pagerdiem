// Server data for each screen (TanStack Query), and one hook for every action.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert } from 'react-native';

import { toast } from '@/components/toast';
import { useApi } from '@/hooks/use-session';
import type { ActivityItem, Done, Home, IncidentDetail, Incidents, IncidentStatus, IncidentSummary, Me, Schedule, TeamList } from '@/lib/api';

export function useMe() {
  const api = useApi();
  return useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/api/app/me') });
}

export function useHome() {
  const api = useApi();
  return useQuery({ queryKey: ['home'], queryFn: () => api.get<Home>('/api/app/home') });
}

export function useIncidents(status?: IncidentStatus) {
  const api = useApi();
  return useQuery({ queryKey: ['incidents', status ?? 'all'], queryFn: () => api.get<Incidents>(`/api/app/incidents${status ? `?status=${status}` : ''}`) });
}

/** An incident, refreshed every 5 s while it's open so who's ringing and the timer stay current. */
export function useIncident(id: number) {
  const api = useApi();
  return useQuery({
    queryKey: ['incident', id],
    queryFn: () => api.get<IncidentDetail>(`/api/app/incidents/${id}`),
    refetchInterval: (q) => (q.state.data?.incident.status === 'open' ? 5000 : false),
  });
}

export function useSchedule() {
  const api = useApi();
  return useQuery({ queryKey: ['schedule'], queryFn: () => api.get<Schedule>('/api/app/schedule') });
}

export function useTeam() {
  const api = useApi();
  return useQuery({ queryKey: ['team'], queryFn: () => api.get<TeamList>('/api/app/team') });
}

export function useActivity() {
  const api = useApi();
  return useQuery({ queryKey: ['activity'], queryFn: () => api.get<{ items: ActivityItem[] }>('/api/app/activity') });
}

/**
 * Any change: POST, then refresh what's on screen. Failures show their message as a toast and
 * resolve to null, so a screen can just `await act(...)` and check the result.
 */
export function useAction() {
  const api = useApi();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: unknown }) => api.post<unknown>(path, body),
    onSuccess: () => queryClient.invalidateQueries(),
  });
  return {
    pending: mutation.isPending,
    act: async <T = Done>(path: string, body?: unknown): Promise<T | null> => {
      try {
        return (await mutation.mutateAsync({ path, body })) as T;
      } catch (err) {
        toast.show({ text: (err as Error).message });
        return null;
      }
    },
  };
}

/**
 * A change whose reply is a Done: shows the server's message, with Undo while the server allows it
 * (swaps and trades, for 10 s).
 */
export function useChange() {
  const { act, pending } = useAction();
  async function change(path: string, body?: unknown): Promise<Done | null> {
    const done = await act<Done>(path, body);
    const undo = done?.undo;
    if (undo) {
      toast.show({ text: done.message, until: Date.parse(undo.until), action: { label: 'Undo', onPress: () => { change('/api/app/swaps/undo', { ids: undo.ids }); } } });
    } else if (done) {
      toast.show({ text: done.message });
    }
    return done;
  }
  return { change, pending };
}

/** Acknowledge, resolve (after asking) and the call actions, each saying how it went in a toast. */
export function useIncidentActions() {
  const { act, pending } = useAction();
  const { change } = useChange();
  const me = useMe();
  const channel = `#${me.data?.team.slackChannelName ?? 'on-call'}`;

  /** True once the incident is acknowledged (by you or someone else). */
  async function acknowledge(id: number) {
    const result = await act<{ changed: boolean; incident: IncidentSummary }>(`/api/app/incidents/${id}/ack`, { via: 'app' });
    // Someone else got there first: not an error, the incident is handled.
    if (result) toast.show({ text: result.changed ? 'Acknowledged. Paging stopped.' : `Already acknowledged by ${result.incident.ackedBy?.name ?? 'someone else'}` });
    return Boolean(result);
  }

  function resolve({ id, title }: { id: number; title: string }) {
    Alert.alert(`Resolve incident #${id}?`, `“${title}” is marked fixed, paging stops and ${channel} is told.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Resolve', onPress: async () => { if (await act(`/api/app/incidents/${id}/resolve`)) toast.show({ text: 'Resolved.' }); } },
    ]);
  }

  return { pending, acknowledge, resolve, run: (path: string) => change(path) };
}
