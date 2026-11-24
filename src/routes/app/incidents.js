// Incidents: the list, one incident, paging on-call, and acting on a page.
import { config } from '../../config.js';
import { escalationPlan, incidentSummary, joinNames, toIncidents, toPerson } from '../../app-api.js';
import { incident, responder } from '../pre.js';
import { required } from '../route.js';

const STATUSES = ['open', 'acknowledged', 'resolved'];

export default [
  {
    method: 'get', path: '/api/app/incidents',
    handler: async (ctx, { db, incidents }) => {
      const status = STATUSES.includes(ctx.query.get('status')) ? ctx.query.get('status') : null;
      ctx.r.json({
        incidents: await toIncidents(db, await incidents.list({ limit: 200, status })),
        stats: await incidents.stats(), recentTitles: await incidents.recentTitles(),
      });
    },
  },
  {
    method: 'get', path: '/api/app/incidents/:id',
    pre: [incident],
    handler: async (ctx, { db, rotation, incidents }) => {
      const inc = ctx.pre.incident;
      const who = await incidents.responsibleFor(inc);
      const feed = [
        ...(await incidents.events(inc.id)).map((e) => ({ at: e.at, kind: 'event', text: e.message, author: null })),
        ...(await incidents.notes(inc.id)).map((n) => ({ at: n.at, kind: 'note', text: n.text, author: toPerson({ id: n.user_id, name: n.user_name, role: n.user_role }) })),
      ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      const reached = (await db.all('SELECT at, channel, recipient, status FROM notifications WHERE incident_id = ? ORDER BY id', [inc.id]))
        .map((n) => ({ at: n.at, channel: n.channel, recipient: n.recipient, status: n.status }));
      ctx.r.json({
        incident: { ...(await incidentSummary(db, inc)), details: inc.details ?? '', backup: toPerson(await rotation.userById(inc.backup_user_id)), escalationLevel: Number(inc.escalation_level) },
        feed, reached, escalation: escalationPlan(inc, new Date(), who), onCall: (who?.onCallPeople ?? []).map(toPerson),
      });
    },
  },
  {
    method: 'post', path: '/api/app/incidents',
    validate: { body: { title: required("Say what's broken.") } },
    handler: async (ctx, { db, incidents }) => {
      const inc = await incidents.create({
        title: String(ctx.body.title).trim(), details: ctx.body.details, source: 'app', createdBy: ctx.user.id, quiet: ctx.body.mode === 'post',
      });
      ctx.r.json({ incident: await incidentSummary(db, inc), paged: inc.paged.map(toPerson) }, 201);
    },
  },
  {
    method: 'post', path: '/api/app/incidents/:id/ack',
    pre: [responder, incident],
    handler: async (ctx, { db, incidents }) => {
      const { changed, incident: updated } = await incidents.acknowledge(ctx.pre.incident.id, ctx.user, ctx.body.via === 'call' ? 'phone call' : 'app');
      ctx.r.json({ changed, incident: await incidentSummary(db, updated) });
    },
  },
  {
    method: 'post', path: '/api/app/incidents/:id/resolve',
    pre: [responder, incident],
    handler: async (ctx, { db, incidents }) => {
      const { changed, incident: updated } = await incidents.resolve(ctx.pre.incident.id, ctx.user, 'app');
      ctx.r.json({ changed, incident: await incidentSummary(db, updated) });
    },
  },
  {
    method: 'post', path: '/api/app/incidents/:id/notes',
    pre: [incident],
    handler: async (ctx, { incidents }) => {
      const note = await incidents.addNote(ctx.pre.incident.id, ctx.user, ctx.body.text, 'app');
      ctx.r.json({ at: note.at, kind: 'note', text: note.text, author: toPerson(ctx.user) }, 201);
    },
  },
  {
    method: 'post', path: '/api/app/incidents/:id/call-again',
    pre: [responder, incident],
    handler: async (ctx, { incidents }) => {
      const { paged } = await incidents.callAgain(ctx.pre.incident.id, ctx.user);
      ctx.r.json({ ok: true, message: `Calling ${joinNames(paged)} again` });
    },
  },
  {
    method: 'post', path: '/api/app/incidents/:id/call-backup',
    pre: [responder, incident],
    handler: async (ctx, { incidents }) => {
      const { paged } = await incidents.callBackupNow(ctx.pre.incident.id, ctx.user);
      ctx.r.json({ ok: true, message: paged.length ? `Calling ${paged[0].name}` : `No backup, so @channel in #${config.slack.channelName}` });
    },
  },
];
