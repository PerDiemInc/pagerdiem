// The weekend schedule: taking, leaving, covering, swapping and trading weekends, with undo.
import { done, toWeekend } from '../../app-api.js';
import { nonEmptyArray } from '../route.js';

/** join, leave and ask-cover take only the weekend in the path. */
const weekendAction = (name) => async (ctx, { actions }) => ctx.r.json(done(await actions[name](ctx.user, ctx.params.key, 'app')));

export default [
  {
    method: 'get', path: '/api/app/schedule',
    handler: async (ctx, { rotation, shifts }) => {
      const weekends = await rotation.schedule(shifts.currentOrNext(new Date()), 12);
      ctx.r.json({ coverage: shifts.coverage(), weekends: weekends.map((e) => toWeekend(e, ctx.user)) });
    },
  },
  { method: 'post', path: '/api/app/weekends/:key/join', handler: weekendAction('joinWeekend') },
  { method: 'post', path: '/api/app/weekends/:key/leave', handler: weekendAction('leaveWeekend') },
  { method: 'post', path: '/api/app/weekends/:key/ask-cover', handler: weekendAction('askCover') },
  {
    method: 'post', path: '/api/app/weekends/:key/swap',
    handler: async (ctx, { actions }) => ctx.r.json(done(await actions.swapWeekend(ctx.user, ctx.params.key, ctx.body.userId, 'app'))),
  },
  {
    method: 'post', path: '/api/app/weekends/:key/trade',
    handler: async (ctx, { actions }) => ctx.r.json(done(await actions.tradeWeekends(ctx.user, ctx.params.key, ctx.body.theirKey, ctx.body.userId, 'app'))),
  },
  {
    method: 'post', path: '/api/app/swaps/undo',
    validate: { body: { ids: nonEmptyArray('Nothing to undo.') } },
    handler: async (ctx, { actions }) => ctx.r.json(done(await actions.undoSwap(ctx.user, ctx.body.ids, 'app'))),
  },
];
