// Routes are declared, not wired by hand: { method, path, auth, validate, pre, handler }.
// registerRoutes runs them the way Hapi does (auth, then validation, then each pre-handler, then the
// handler), without a dependency: the server stays zero-dependency (only pg).
import { HttpError } from '../http.js';

/** A validator returns null when the value is fine, or the message to send back (400, with the field). */
export const required = (message) => (v) => (String(v ?? '').trim() ? null : message);
export const oneOf = (values, message) => (v) => (values.includes(v) ? null : message);
export const nonEmptyArray = (message) => (v) => (Array.isArray(v) && v.length ? null : message);

export function registerRoutes(router, routes, deps) {
  for (const { method, path, auth = true, validate = {}, pre = [], handler } of routes) {
    router[method](path, async (ctx) => {
      // Phones sign in with a bearer token; app.js has already turned it into ctx.user and ctx.device.
      if (auth && (!ctx.user || !ctx.device)) throw new HttpError(401, 'Sign in again');
      for (const [field, check] of Object.entries(validate.body ?? {})) {
        const problem = check(ctx.body?.[field]);
        if (problem) throw new HttpError(400, problem, field);
      }
      ctx.pre = {};
      for (const step of pre) await step(ctx, deps);
      await handler(ctx, deps);
    });
  }
}
