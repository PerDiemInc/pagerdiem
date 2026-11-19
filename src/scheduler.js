// Runs once a minute: weekend reminders, shift start/end hand-offs, and incident escalation.
// Each scheduled message is guarded by a sent_keys row so restarts never double-send.
import { config } from './config.js';
import { claimOnce } from './db.js';
import { formatLocal } from './time.js';
import { mention } from './notify/slack.js';

const HOUR = 3_600_000;

export function makeScheduler({ db, shifts, rotation, notify, incidents }) {
  const fmt = (d) => formatLocal(d, config.timezone);

  const names = (people) => people.map((p) => p.name).join(' and ');

  async function shiftReminder(now) {
    const next = shifts.next(now);
    const remindAt = next.start.getTime() - config.reminderHoursBefore * HOUR;
    if (now.getTime() < remindAt || now >= next.start) return;
    const entry = await rotation.forShift(next);
    const when = `${fmt(next.start)} → ${fmt(next.end)}`;
    for (const person of entry.people) {
      if (!(await claimOnce(db, `reminder:${next.key}:${person.id}`))) continue;
      const others = entry.people.filter((p) => p.id !== person.id);
      await notify.user(person, {
        text: `:pager: Heads up — you're on call this weekend, ${when}.` +
          (others.length ? ` With ${names(others)}.` : '') + ` Can't make it? Remove yourself at ${config.publicUrl}/`,
        whatsappText: `📟 PagerDiem: you're on call this weekend, ${when}.` +
          (others.length ? ` With ${names(others)}.` : '') + ` Can't make it? ${config.publicUrl}/`,
        whatsappTemplate: config.whatsapp.shiftTemplateSid
          ? { sid: config.whatsapp.shiftTemplateSid, variables: { 1: fmt(next.start), 2: fmt(next.end) } }
          : undefined,
      });
    }
    if (await claimOnce(db, `reminder-channel:${next.key}`)) {
      await notify.channel({
        text: entry.people.length
          ? `:calendar: This weekend's on-call: ${entry.people.map(mention).join(' and ')}, ${when}.` +
            (entry.needsCover ? ` :warning: Needs ${rotation.perWeekend - entry.people.length} more — add yourself at ${config.publicUrl}/` : '')
          : `:warning: Nobody is on call this weekend (${when}). Add yourself at ${config.publicUrl}/`,
      });
    }
  }

  async function shiftStart(now) {
    const current = shifts.current(now);
    if (!current) return;
    const entry = await rotation.lock(current);
    if (!(await claimOnce(db, `start:${current.key}`))) return;
    for (const person of entry.people) {
      await notify.user(person, {
        text: `:pager: You're on call now until ${fmt(current.end)}. Keep Slack and WhatsApp notifications on. Thank you!`,
        whatsappText: `📟 PagerDiem: you're on call now until ${fmt(current.end)}. Keep notifications on. Thank you!`,
        whatsappTemplate: config.whatsapp.shiftTemplateSid
          ? { sid: config.whatsapp.shiftTemplateSid, variables: { 1: fmt(current.start), 2: fmt(current.end) } }
          : undefined,
      });
    }
    await notify.channel({
      text: entry.people.length
        ? `:pager: ${entry.people.map(mention).join(' and ')} ${entry.people.length > 1 ? 'are' : 'is'} on call now until ${fmt(current.end)}. Use \`/page <what broke>\` to page them.`
        : `:warning: The weekend has started and nobody is on call. Pages will go to this channel.`,
    });
  }

  async function shiftEnd(now) {
    // The most recent weekend that has finished, if it finished within the last few hours.
    const current = shifts.current(now);
    const prev = shifts.previous(current || shifts.next(now));
    if (now < prev.end || now - prev.end > 6 * HOUR) return;
    const ended = await rotation.forShift(prev);
    if (!ended.locked || !(await claimOnce(db, `end:${prev.key}`))) return;
    const nextEntry = await rotation.forShift(shifts.next(now));
    const count = (await db.get('SELECT COUNT(*) AS n FROM incidents WHERE created_at >= ? AND created_at < ?',
      [prev.start.toISOString(), prev.end.toISOString()])).n;
    await notify.channel({
      text: `:white_check_mark: Weekend on-call finished — thanks ${ended.people.map(mention).join(' and ') || 'team'}! ` +
        `${count} incident${count === 1 ? '' : 's'} this weekend. Next up: ${nextEntry.people.map(mention).join(' and ') || 'nobody yet'}.`,
    });
  }

  const extraSteps = [];
  /** Extra once-a-minute jobs registered by the app (e.g. announcing swaps). */
  const addStep = (fn) => extraSteps.push(fn);

  async function runOnce(now = new Date()) {
    for (const step of [shiftReminder, shiftStart, shiftEnd, incidents.tick, ...extraSteps]) {
      try {
        await step(now);
      } catch (err) {
        console.error(`scheduler ${step.name} failed:`, err);
      }
    }
  }

  let timer = null;
  let running = false;
  function start(intervalMs = 60_000) {
    const tick = async () => {
      if (running) return; // never overlap runs
      running = true;
      try { await runOnce(); } finally { running = false; }
    };
    tick();
    timer = setInterval(tick, intervalMs);
    timer.unref?.();
  }
  const stop = () => clearInterval(timer);

  return { runOnce, start, stop, addStep };
}
