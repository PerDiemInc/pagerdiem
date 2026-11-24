// The team: members with how the app can reach them, and the admin actions (role, rotation, coverage).
import { config } from '../../config.js';
import { done, toPerson } from '../../app-api.js';
import { responder } from '../pre.js';

export default [
  {
    method: 'get', path: '/api/app/team',
    pre: [responder], // phone numbers and emails, like the web Team page
    handler: async (ctx, { db, rotation, shifts }) => {
      const schedule = await rotation.schedule(shifts.currentOrNext(new Date()), 12);
      const phones = await db.all('SELECT user_id, push_token, tested_at FROM devices WHERE revoked_at IS NULL');
      const appStatus = (userId) => {
        const ready = phones.filter((d) => Number(d.user_id) === Number(userId) && d.push_token);
        if (ready.some((d) => d.tested_at)) return 'woken';
        return ready.length ? 'focus-risk' : 'none';
      };
      const member = (u) => ({
        ...toPerson(u), email: u.email, phone: u.whatsapp, slack: u.slack_user_id ?? null, order: Number(u.rotation_order),
        nextWeekend: schedule.find((e) => e.people.some((p) => p.id === u.id))?.shift.start.toISOString() ?? null,
        app: appStatus(u.id),
      });
      const inactive = ctx.user.role === 'admin' ? await db.all('SELECT * FROM users WHERE active = 0 ORDER BY name') : [];
      ctx.r.json({ members: (await rotation.activeMembers()).map(member), inactive: inactive.map(member), signupUrl: `${config.publicUrl}/login` });
    },
  },
  // The actions below check the admin role themselves, as the web's do.
  {
    method: 'post', path: '/api/app/team/:id/role',
    handler: async (ctx, { actions }) => ctx.r.json(done(await actions.setRole(ctx.user, ctx.params.id, ctx.body.role, 'app'))),
  },
  {
    method: 'post', path: '/api/app/team/:id/active',
    handler: async (ctx, { actions }) => ctx.r.json(done(await actions.setActive(ctx.user, ctx.params.id, Boolean(ctx.body.active), 'app'))),
  },
  {
    method: 'post', path: '/api/app/team/:id/move',
    handler: async (ctx, { actions }) => ctx.r.json(done(await actions.moveMember(ctx.user, ctx.params.id, ctx.body.dir, 'app'))),
  },
  {
    method: 'post', path: '/api/app/coverage',
    handler: async (ctx, { actions }) => {
      const { days, start, end, weekendCount, weekdayCount } = ctx.body;
      ctx.r.json(done(await actions.saveCoverage(ctx.user, { days, start, end, weekendCount, weekdayCount }, 'app')));
    },
  },
  {
    method: 'post', path: '/api/app/resend-weekend-start',
    handler: async (ctx, { actions }) => ctx.r.json(done(await actions.resendWeekendStart(ctx.user, 'app'))),
  },
];
