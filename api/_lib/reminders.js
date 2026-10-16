// Server-side copy of the planner's schedule rules (src/app.js). scripts/reminder-sim.mjs
// checks both implementations agree, so change them together.
export const REMINDER_HOUR = 20;

const minutes = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const parseDay = s => new Date(s + 'T00:00:00Z');
export const addDays = (s, n) => { const d = parseDay(s); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export function duration(a) { const n = minutes(a.end) - minutes(a.start); return n <= 0 ? n + 1440 : n; }
export function occurs(a, date) {
  if (date < a.date) return false;
  const s = parseDay(a.date), d = parseDay(date);
  if (a.repeat === 'none') return date === a.date;
  if (a.repeat === 'daily') return true;
  if (a.repeat === 'weekly') return s.getUTCDay() === d.getUTCDay();
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  if (a.repeat === 'monthly') return d.getUTCDate() === Math.min(s.getUTCDate(), last);
  return d.getUTCMonth() === s.getUTCMonth() && d.getUTCDate() === Math.min(s.getUTCDate(), last);
}
export const occurrences = (activities, date) => activities.filter(a => occurs(a, date)).map(a => ({ ...a, key: a.id + '@' + date })).sort((a, b) => a.start.localeCompare(b.start));

// Local calendar date and hour for an instant in an IANA timezone.
export function localParts(instant, timeZone) {
  let tz = timeZone;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); } catch { tz = 'UTC'; }
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(instant).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), timeZone: tz };
}

const fmt = t => `${Number(t.slice(0, 2)) % 12 || 12}:${t.slice(3, 5)} ${Number(t.slice(0, 2)) < 12 ? 'AM' : 'PM'}`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// What can be checked in at 8 PM: today's activities that started before 8 PM, plus last
// night's overnight activity (it stays editable until midnight because it ended today).
export function dueFor(payload, date) {
  const done = payload?.done || {}, acts = payload?.activities || [], cutoff = REMINDER_HOUR * 60;
  const carry = occurrences(acts, addDays(date, -1)).filter(a => minutes(a.start) + duration(a) > 1440);
  const due = [...carry, ...occurrences(acts, date).filter(a => minutes(a.start) < cutoff)];
  return { due, pending: due.filter(a => !done[a.key]) };
}

// Decides whether one user gets tonight's email. The cron runs hourly; any run from 8 PM to
// midnight local time sends once, so a missed or late run still delivers before the day locks.
export const isRestricted = (profile, now = new Date()) => profile?.status === 'blocked' || (profile?.status === 'suspended' && (!profile.suspendedUntil || new Date(profile.suspendedUntil) > now));
export function planUserReminder({ payload, user, log, now, profile }) {
  if (!payload || !Array.isArray(payload.activities)) return { send: false, reason: 'no-planner' };
  if (isRestricted(profile, now)) return { send: false, reason: 'account-restricted' };
  if (payload.emailReminders === false) return { send: false, reason: 'opted-out' };
  if (!user?.email) return { send: false, reason: 'no-email' };
  if (!user.emailVerified) return { send: false, reason: 'email-not-verified' };
  const { date, hour, timeZone } = localParts(now, payload.timezone || 'UTC');
  if (hour < REMINDER_HOUR) return { send: false, reason: 'before-8pm', date };
  if (log?.lastSent === date) return { send: false, reason: 'already-sent', date };
  const { due: today, pending } = dueFor(payload, date);
  if (!today.length) return { send: false, reason: 'nothing-planned', date };
  if (!pending.length) return { send: false, reason: 'all-done', date };
  return { send: true, date, timeZone, total: today.length, pending };
}

export function buildEmail({ user, date, timeZone, total, pending, appUrl }) {
  const name = user.displayName || 'there', when = new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  const link = (appUrl || '').replace(/\/$/, '') + '/dashboard';
  const lines = pending.map(a => `• ${fmt(a.start)} – ${fmt(a.end)}  ${a.title}`);
  const subject = `Dayform · ${pending.length} of ${total} activities still to check in today`;
  const text = `Hi ${name},\n\nIt's 8 PM. You still have ${pending.length} of ${total} activities to check in for ${when}:\n\n${lines.join('\n')}\n\nCheck them in before midnight (${timeZone}). When the day ends, it locks and these can no longer be edited.\n\n${appUrl ? 'Open Dayform: ' + link + '\n\n' : ''}You can turn these emails off in Dayform → Preferences.`;
  const html = `<div style="font-family:Arial,sans-serif;color:#253a30;max-width:520px;margin:auto;padding:24px;background:#f5f6f2;border-radius:16px"><p style="font-size:11px;letter-spacing:1.5px;color:#8c9784;margin:0 0 8px">YOUR 8 PM CHECK-IN</p><h1 style="font-size:22px;margin:0 0 12px">Hi ${esc(name)}, a little reflection.</h1><p style="line-height:1.6">You still have <b>${pending.length} of ${total}</b> activities to check in for ${esc(when)}:</p><ul style="padding-left:18px;line-height:1.8">${pending.map(a => `<li><b>${esc(fmt(a.start))} – ${esc(fmt(a.end))}</b> &nbsp;${esc(a.title)}</li>`).join('')}</ul><p style="line-height:1.6;background:#eaf0e2;border-radius:10px;padding:12px">Check them in <b>before midnight</b> (${esc(timeZone)}). When the day ends it locks, and these can no longer be edited.</p>${appUrl ? `<p><a href="${esc(link)}" style="display:inline-block;background:#38533f;color:#fff;text-decoration:none;padding:12px 18px;border-radius:9px">Open Dayform ↗</a></p>` : ''}<p style="font-size:11px;color:#8a938b">You can turn these emails off in Dayform → Preferences.</p></div>`;
  return { to: user.email, subject, text, html };
}

// deps: listPlanners() → [{uid, payload}], getUser(uid), getProfile(uid), readLog(uid), writeLog(uid, log), send(message), recordEmail(uid, date, type)
export async function runReminders({ now = new Date(), appUrl, deps }) {
  const results = [];
  for (const { uid, payload } of await deps.listPlanners()) {
    let user, log, plan;
    try {
      let profile;
      [user, log, profile] = await Promise.all([deps.getUser(uid), deps.readLog(uid), deps.getProfile?.(uid)]);
      plan = planUserReminder({ payload, user, log, now, profile });
      if (!plan.send) { results.push({ uid, sent: false, reason: plan.reason }); continue; }
      const message = buildEmail({ user, appUrl, ...plan });
      await deps.send(message);
      const entry = { at: now.toISOString(), date: plan.date, to: user.email, pending: plan.pending.length, total: plan.total, type: 'daily' };
      await deps.writeLog(uid, { lastSent: plan.date, entries: [entry, ...(log?.entries || [])].slice(0, 60) });
      await deps.recordEmail?.(uid, plan.date, 'sent');
      results.push({ uid, sent: true, date: plan.date, pending: plan.pending.length });
    } catch (e) {
      results.push({ uid, sent: false, reason: 'error', error: e.message });
      // Record the failure for the user's audit log; lastSent is untouched, so the next hourly run retries.
      if (plan?.send) try { await deps.writeLog(uid, { entries: [{ at: now.toISOString(), date: plan.date, to: user.email, type: 'failed', error: e.message.slice(0, 200) }, ...(log?.entries || [])].slice(0, 60) }); await deps.recordEmail?.(uid, plan.date, 'failed'); } catch {}
    }
  }
  return results;
}
