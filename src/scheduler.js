// Runs once a minute: weekend reminders, shift start/end hand-offs, and incident escalation.
// Each scheduled message is guarded by a sent_keys row so restarts never double-send.
import { config } from './config.js';
import { claimOnce } from './db.js';
import { formatLocal } from './time.js';
import { mention } from './notify/slack.js';

const HOUR = 3_600_000;

export function makeScheduler({ db, shifts, rotation, notify, incidents }) {
  const fmt = (d) => formatLocal(d, config.timezone);
  // Weekends whose reminder / start / end this process has already handled. Without these, each
  // job would re-read the database every minute and a serverless database would never sleep.
  const done = { reminder: new Map(), start: new Set(), end: new Set() };

  const names = (people) => people.map((p) => p.name).join(' and ');

  async function shiftReminder(now) {
    const next = shifts.next(now);
    const remindAt = next.start.getTime() - config.reminderHoursBefore * HOUR;
    if (now.getTime() < remindAt || now >= next.start || now - (done.reminder.get(next.key) ?? 0) < 30 * 60_000) return;
    const entry = await rotation.forShift(next);
    const when = `${fmt(next.start)} → ${fmt(next.end)}`;
    for (const person of entry.people) {
      if (!(await claimOnce(db, `reminder:${next.key}:${person.id}`))) continue;
      const others = entry.people.filter((p) => p.id !== person.id);
      await notify.user(person, {
        text: `:pager: Heads up — you're on call this weekend, ${when}.` +
          (others.length ? ` With ${names(others)}.` : '') + ` Can't make it? Remove yourself at ${config.publicUrl}/`,
      });
    }
    if (await claimOnce(db, `reminder-channel:${next.key}`)) {
      await notify.channel({
        text: entry.people.length
          ? `:calendar: This weekend's on-call: ${entry.people.map(mention).join(' and ')}, ${when}.` +
            (entry.needsCover ? ` :warning: Needs ${entry.shift.count - entry.people.length} more — add yourself at ${config.publicUrl}/` : '')
          : `:warning: Nobody is on call this weekend (${when}). Add yourself at ${config.publicUrl}/`,
      });
    }
    done.reminder.set(next.key, now.getTime());
  }

  async function shiftStart(now) {
    const current = shifts.current(now);
    if (!current || done.start.has(current.key)) return;
    const entry = await rotation.lock(current);
    if (await claimOnce(db, `start:${current.key}`)) await announceWeekendStart(current, entry);
    done.start.add(current.key);
  }

  /** "You're on call now" to each person, plus the channel post. */
  async function announceWeekendStart(current, entry) {
    for (const person of entry.people) {
      await notify.user(person, {
        text: `:pager: You're on call now until ${fmt(current.end)}. Keep Slack notifications on. Thank you!`,
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
    if (now < prev.end || now - prev.end > 6 * HOUR || done.end.has(prev.key)) return;
    const ended = await rotation.forShift(prev);
    if (!ended.locked || !(await claimOnce(db, `end:${prev.key}`))) { done.end.add(prev.key); return; }
    const nextEntry = await rotation.forShift(shifts.next(now));
    const count = (await db.get('SELECT COUNT(*) AS n FROM incidents WHERE created_at >= ? AND created_at < ?',
      [prev.start.toISOString(), prev.end.toISOString()])).n;
    await notify.channel({
      text: `:white_check_mark: Weekend on-call finished — thanks ${ended.people.map(mention).join(' and ') || 'team'}! ` +
        `${count} incident${count === 1 ? '' : 's'} this weekend. Next up: ${nextEntry.people.map(mention).join(' and ') || 'nobody yet'}.`,
    });
    done.end.add(prev.key);
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

  /**
   * Send this weekend's "you're on call now" messages again (admin action, e.g. after
   * Slack was connected mid-weekend). Returns the people messaged, or null
   * when no weekend is in progress.
   */
  async function resendWeekendStart(now = new Date()) {
    const current = shifts.current(now);
    if (!current) return null;
    const entry = await rotation.lock(current);
    await announceWeekendStart(current, entry);
    return entry.people;
  }

  return { runOnce, start, stop, addStep, resendWeekendStart };
}
