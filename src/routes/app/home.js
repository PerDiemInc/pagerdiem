// The On call screen and the activity log.
import { activityFeed, buildHome } from '../../app-api.js';

export default [
  {
    method: 'get', path: '/api/app/home',
    handler: async (ctx, { db, shifts, rotation, incidents }) => ctx.r.json(await buildHome({ db, shifts, rotation, incidents, user: ctx.user })),
  },
  {
    method: 'get', path: '/api/app/activity',
    handler: async (ctx, { db, rotation, shifts }) => ctx.r.json({ items: await activityFeed({ db, rotation, shifts }) }),
  },
];
