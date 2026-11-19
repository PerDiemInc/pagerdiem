// Runs once a minute: weekend reminders, shift start/end hand-offs, and incident escalation.
// Each scheduled message is guarded by a sent_keys row so restarts never double-send.
import { config } from './config.js';
import { claimOnce } from './db.js';
import { formatLocal } from './time.js';
import { mention } from './notify/slack.js';

const HOUR = 3_600_000;

export function makeScheduler({ db, shifts, rotation, notify, incidents }) {
  const fmt = (d) => formatLocal(d, config.timezone);

  async function shiftReminder(now) {
    const next = shifts.next(now);
    const remindAt = next.start.getTime() - config.reminderHoursBefore * HOUR;
    if (now.getTime() < remindAt || now >= next.start) return;
    const entry = await rotation.forShift(next);
    if (!entry?.user || !(await claimOnce(db, `reminder:${next.key}:${entry.user.id}`))) return;
    const backup = await rotation.backupFor(next);
    const text = `:pager: Heads up — you're on call this weekend, ${fmt(next.start)} → ${fmt(next.end)}.` +
      (backup ? ` Your backup is ${backup.name}.` : '') +
      ` Need to swap? ${config.publicUrl}/`;
    await notify.user(entry.user, {
      text,
      whatsappText: `📟 PagerDiem: you're on call this weekend, ${fmt(next.start)} → ${fmt(next.end)}.` +
        (backup ? ` Backup: ${backup.name}.` : '') + ` Need to swap? ${config.publicUrl}/`,
      whatsappTemplate: config.whatsapp.shiftTemplateSid
        ? { sid: config.whatsapp.shiftTemplateSid, variables: { 1: fmt(next.start), 2: fmt(next.end) } }
        : undefined,
    });
    await notify.channel({
      text: `:calendar: This weekend's on-call: ${mention(entry.user)}` + (backup ? ` (backup ${mention(backup)})` : '') +
        `, ${fmt(next.start)} → ${fmt(next.end)}.`,
    });
  }

  async function shiftStart(now) {
    const current = shifts.current(now);
    if (!current) return;
    const entry = await rotation.lock(current);
    if (!entry?.user || !(await claimOnce(db, `start:${current.key}`))) return;
    const backup = await rotation.backupFor(current);
    await notify.user(entry.user, {
      text: `:pager: You're on call now until ${fmt(current.end)}. Keep Slack and WhatsApp notifications on. Thank you!`,
      whatsappText: `📟 PagerDiem: you're on call now until ${fmt(current.end)}. Keep notifications on. Thank you!`,
      whatsappTemplate: config.whatsapp.shiftTemplateSid
        ? { sid: config.whatsapp.shiftTemplateSid, variables: { 1: fmt(current.start), 2: fmt(current.end) } }
        : undefined,
    });
    await notify.channel({
      text: `:pager: ${mention(entry.user)} is now on call until ${fmt(current.end)}` +
        (backup ? `, backup ${mention(backup)}` : '') + '. Use `/page <what broke>` to page them.',
    });
  }

  async function shiftEnd(now) {
    // The most recent shift that has finished, if it finished within the last few hours.
    const current = shifts.current(now);
    const prev = shifts.previous(current || shifts.next(now));
    if (now < prev.end || now - prev.end > 6 * HOUR) return;
    const locked = (await db.get('SELECT * FROM shifts WHERE weekend_key = ?', [prev.key]));
    if (!locked || !(await claimOnce(db, `end:${prev.key}`))) return;
    const user = await rotation.userById(locked.user_id);
    const nextEntry = await rotation.forShift(shifts.next(now));
    const count = (await db.get('SELECT COUNT(*) AS n FROM incidents WHERE created_at >= ? AND created_at < ?', [prev.start.toISOString(), prev.end.toISOString()])).n;
    await notify.channel({
      text: `:white_check_mark: Weekend on-call finished — thanks ${mention(user)}! ` +
        `${count} incident${count === 1 ? '' : 's'} this weekend. Next up: ${mention(nextEntry?.user)}.`,
    });
  }

  async function runOnce(now = new Date()) {
    for (const step of [shiftReminder, shiftStart, shiftEnd, incidents.tick]) {
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

  return { runOnce, start, stop };
}
