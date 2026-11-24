// Pre-handlers shared by the phone API's routes: each checks or loads something into ctx.pre.
import { HttpError } from '../http.js';
import { isResponder } from '../roles.js';

/** Engineers and admins only: acknowledging, resolving, calling people, and the team's phone numbers. */
export function responder(ctx) {
  if (!isResponder(ctx.user)) throw new HttpError(403, 'Only engineers and admins can do that');
}

/** ctx.pre.incident from the :id in the path, or 404. */
export async function incident(ctx, { incidents }) {
  const id = Number(ctx.params.id);
  ctx.pre.incident = Number.isSafeInteger(id) ? await incidents.get(id) : null;
  if (!ctx.pre.incident) throw new HttpError(404, 'Incident not found');
}
