// One-month simulation of reminders, day locks and 8 PM emails, with every hour of the day planned.
// Runs the real src/app.js against a fake clock and the real server reminder logic against an
// in-memory database. Emails are rendered by nodemailer's JSON transport, never sent.
// Usage: npm run test:reminders [-- --sample=path/to/email.html]
process.env.TZ = 'Asia/Kolkata';
import { readFileSync, writeFileSync } from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import nodemailer from 'nodemailer';
import { runReminders, occurs as serverOccurs, localParts } from '../api/_lib/reminders.js';

const failures = [], check = (ok, msg) => { if (!ok) failures.push(msg); };
const RealDate = Date, START = new RealDate('2026-11-01T00:00:00+05:30').getTime(), DAYS = 30, STEP = 5 * 60000;
let NOW = START;
class FakeDate extends RealDate { constructor(...a) { a.length ? super(...a) : super(NOW); } static now() { return NOW; } }

// ---- Load the browser app with a stub DOM and fake clock ----
const stub = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : k === Symbol.iterator ? function* () {} : stub, apply: () => stub, set: () => true, construct: () => stub });
const intervals = [], notifications = [];
let prompts = 0, promptAnswer = 'denied';
class FakeNotification { static permission = 'default'; constructor(title, opts) { notifications.push({ at: NOW, title, ...opts }); } static requestPermission() { prompts++; FakeNotification.permission = promptAnswer; return Promise.resolve(promptAnswer); } }
const all24 = [['Sleep', 'Sleep', '22:00', '07:00'], ['Morning routine', 'Wellness', '07:00', '09:00'], ['Deep work', 'Work', '09:00', '13:00'], ['Lunch', 'Personal', '13:00', '14:00'], ['Study', 'Study', '14:00', '18:00'], ['Evening', 'Personal', '18:00', '22:00']];
const activities = all24.map(([title, category, start, end], i) => ({ id: 'a' + i, title, category, date: '2026-10-25', start, end, repeat: 'daily', link: '', notes: '' }))
  .concat([{ id: 'w', title: 'Weekly review', category: 'Meeting', date: '2026-11-02', start: '10:00', end: '10:30', repeat: 'weekly', link: '', notes: '' },
    { id: 'm', title: 'Monthly budget', category: 'Office', date: '2026-10-31', start: '16:00', end: '16:30', repeat: 'monthly', link: '', notes: '' },
    { id: 'o', title: 'Dentist', category: 'Custom', date: '2026-11-11', start: '11:00', end: '11:45', repeat: 'none', link: '', notes: '' }]);
const ctx = vm.createContext({ Date: FakeDate, Intl, Math, JSON, Promise, console, crypto: webcrypto, Notification: FakeNotification, location: { pathname: '/dashboard' }, history: stub, matchMedia: () => ({ matches: true }), setTimeout: () => 0, clearTimeout: () => {}, setInterval: f => intervals.push(f), URL: stub, Blob: stub, confirm: () => true, alert: () => {}, document: { querySelector: () => stub, querySelectorAll: () => [], addEventListener: () => {}, body: stub, createElement: () => stub } });
ctx.window = ctx; ctx.addEventListener = () => {}; ctx.scrollTo = () => {}; ctx.window.dayformSave = () => {}; ctx.window.dayformUser = { displayName: 'Month Tester', email: 'tester@example.com', emailVerified: true };
ctx.window.dayformInitial = { activities, done: {}, logs: [], reminders: false, emailReminders: true };
vm.runInContext(readFileSync(new URL('../src/app.js', import.meta.url), 'utf8'), ctx);
const app = code => vm.runInContext(code, ctx);

// ---- Server side: in-memory Firestore/Auth and rendered emails ----
const transport = nodemailer.createTransport({ jsonTransport: true }), emails = [], logs = {}, stats = {}, perUser = {};
const others = {
  ny: { user: { email: 'ny@example.com', emailVerified: true, displayName: 'NY' }, payload: { timezone: 'America/New_York', activities, done: {}, emailReminders: true } },
  unverified: { user: { email: 'new@example.com', emailVerified: false }, payload: { timezone: 'Asia/Kolkata', activities, done: {}, emailReminders: true } },
  optedOut: { user: { email: 'quiet@example.com', emailVerified: true }, payload: { timezone: 'Asia/Kolkata', activities, done: {}, emailReminders: false } },
  empty: { user: { email: 'empty@example.com', emailVerified: true }, payload: { timezone: 'Europe/London', activities: [], done: {}, emailReminders: true } },
  blocked: { user: { email: 'blocked@example.com', emailVerified: true }, profile: { status: 'blocked' }, payload: { timezone: 'Asia/Kolkata', activities, done: {}, emailReminders: true } },
  suspended: { user: { email: 'paused@example.com', emailVerified: true }, profile: { status: 'suspended', suspendedUntil: new Date('2026-11-15T00:00:00+05:30') }, payload: { timezone: 'Asia/Kolkata', activities, done: {}, emailReminders: true } },
};
const deps = {
  listPlanners: async () => [{ uid: 'ist', payload: JSON.parse(JSON.stringify(app('state'))) }, ...Object.entries(others).map(([uid, o]) => ({ uid, payload: o.payload }))],
  getUser: async uid => uid === 'ist' ? ctx.window.dayformUser : others[uid].user,
  readLog: async uid => logs[uid] || null,
  getProfile: async uid => uid === 'ist' ? { status: 'active' } : others[uid].profile || { status: 'active' },
  recordEmail: async (uid, date, type) => { (stats[date] ||= {})[type] = (stats[date][type] || 0) + 1; if (type === 'sent') perUser[uid] = (perUser[uid] || 0) + 1; },
  writeLog: async (uid, log) => { logs[uid] = { ...logs[uid], ...log }; },
  send: async message => { if (message.to === 'ny@example.com' && failNext) { failNext = false; throw Error('SMTP timeout'); } const info = await transport.sendMail({ from: 'Dayform <reminders@example.com>', ...message }); emails.push({ at: NOW, ...message, mime: JSON.parse(info.message) }); },
};

// ---- Run the month ----
let lockChecks = 0, completions = 0, failNext = false;
const H = 3600000, at = (d, h = 0, m = 0) => START + d * 86400000 + h * H + m * 60000, END = at(DAYS);
const closedDays = new Set(['2026-11-10', '2026-11-11', '2026-11-12']); // app closed: no browser notifications
const skippedCronHours = new Set([20 + 24 * 5, 20 + 24 * 6, 21 + 24 * 6]); // scheduler outages
const lastLog = () => app('state.logs[0]?.type');
const toggle = async expectType => { await app('toggleNotifications()'); check(lastLog() === expectType, `Expected log “${expectType}”, got “${lastLog()}” at ${new RealDate(NOW).toISOString()}`); };
// Notification on/off timeline (user actions and browser permission changes).
const script = {
  [at(0)]: async () => { await toggle('Permission denied'); check(!app('state.reminders') && prompts === 1, 'Denying permission keeps notifications off'); },
  [at(0, 0, 5)]: async () => { await toggle('Notifications blocked'); check(prompts === 1, 'No second prompt once blocked'); },
  [at(0, 0, 10)]: async () => { FakeNotification.permission = 'granted'; await toggle('Notifications turned on'); },
  [at(14)]: async () => { await toggle('Notifications turned off'); check(!app('state.reminders'), 'Turning off disables notifications'); },
  [at(16)]: async () => { await toggle('Notifications turned on'); },
  [at(19)]: async () => { FakeNotification.permission = 'denied'; app('watchPermission()'); check(lastLog() === 'Notifications turned off' && !app('state.reminders'), 'Revoked permission switches notifications off and is logged'); },
  [at(20)]: async () => { FakeNotification.permission = 'granted'; await toggle('Notifications turned on'); },
  [at(8, 19)]: async () => { failNext = true; },
};
const enabledAt = t => (t >= at(0, 0, 10) && t < at(14)) || (t >= at(16) && t < at(19)) || t >= at(20);
for (let t = START; t < END; t += STEP) {
  NOW = t;
  const now = new RealDate(t), day = app('today()'), hour = now.getHours(), minute = now.getMinutes();
  if (script[t]) await script[t]();
  if (!closedDays.has(day)) {
    intervals.forEach(f => f());
    // Behaviour: at 19:30 check in everything that has started; on odd days leave Study unchecked for the 8 PM email.
    if (minute === 30 && hour === 19) for (const key of app(`visibleEvents(today()).filter(a=>!state.done[a.key]&&a.begin<=Date.now()).map(a=>a.key)`)) {
      const even = Number(day.slice(-2)) % 2 === 0;
      if (even || !key.startsWith('a4')) { check(app(`completionError(occurrence(${JSON.stringify(key)}),new Date(),Date.now())`) === '', 'Finished activity today should be checkable: ' + key); app(`state.done[${JSON.stringify(key)}]=new Date().toISOString()`); completions++; }
    }
    // Locks: everything that ended before today's midnight is locked; today's finished items are open.
    if (minute === 0) {
      const res = app(`[...events(addDays(today(),-1)),...events(today())].filter(a=>a.finish<=Date.now()).map(a=>({key:a.key,locked:dayLocked(a),err:completionError(a,new Date(),Date.now()),endedBeforeToday:a.finish<=parseDate(today())}))`);
      for (const r of res) { lockChecks++; check(r.locked === r.endedBeforeToday, `Lock mismatch ${r.key} at ${now.toISOString()}`); check(!!r.err === r.endedBeforeToday, `Completion rule mismatch ${r.key} at ${now.toISOString()}: ${r.err}`); }
      check(app(`Object.values(dayAllocation(today())).reduce((a,b)=>a+b,0)`) === 1440, 'Day allocation must total 24h on ' + day);
      check(app(`(dayAllocation(today()).Unplanned||0)`) === 0, 'All 24 hours should be planned on ' + day);
    }
  }
  if (minute === 0 && !skippedCronHours.has(Math.round((t - START) / H))) await runReminders({ now, appUrl: 'https://dayform.example', deps });
}

// ---- Assertions: browser notifications ----
const starts = notifications.filter(n => n.tag?.startsWith('dayform-start-'));
const expected = [];
for (let d = -1; d <= DAYS; d++) for (const a of app(`events(addDays('2026-11-01',${d})).map(a=>({key:a.key,begin:a.begin.getTime()}))`)) {
  const fire = a.begin - 600000;
  if (fire >= START && fire < END && enabledAt(fire) && !closedDays.has(new RealDate(fire).toLocaleDateString('en-CA'))) expected.push(a.key);
}
const got = starts.map(n => n.tag.slice(14));
check(new Set(got).size === got.length, 'Notifications are never duplicated');
check(expected.every(k => got.includes(k)), `Every activity gets a notification while on (missing ${expected.filter(k => !got.includes(k)).slice(0, 3)})`);
check(got.every(k => expected.includes(k)), `No notifications while off, blocked or closed (unexpected ${got.filter(k => !expected.includes(k)).slice(0, 3)})`);
check(starts.every(n => app(`occurrence(${JSON.stringify(n.tag.slice(14))})`).begin - n.at === 600000), 'Every notification arrives exactly 10 minutes before the start');
check(starts.every(n => n.title.startsWith('In 10 min: ')), 'Notification title says “In 10 min”');
check(!notifications.some(n => !n.tag?.startsWith('dayform-start-')), 'No 8 PM browser notifications (8 PM is email only)');

// ---- Assertions: emails ----
const sentTo = who => emails.filter(e => e.to === who);
const istEmails = sentTo('tester@example.com'), istDates = istEmails.map(e => localParts(new RealDate(e.at), 'Asia/Kolkata').date);
check(new Set(istDates).size === istEmails.length, 'At most one daily email per user per day');
check(istEmails.every(e => localParts(new RealDate(e.at), 'Asia/Kolkata').hour >= 20), 'Emails only go out from 8 PM local time');
const openDays = Array.from({ length: DAYS }, (_, i) => new RealDate(START + i * 86400000).toLocaleDateString('en-CA')).filter(d => !closedDays.has(d));
const oddDays = openDays.concat([...closedDays]).filter(d => Number(d.slice(-2)) % 2 === 1 || closedDays.has(d));
check(oddDays.every(d => istDates.includes(d)), 'Email sent on every day with unchecked activities, including scheduler outage days');
check(istDates.every(d => Number(d.slice(-2)) % 2 === 1 || closedDays.has(d)), 'No email on days where everything was checked in');
check(istEmails.every(e => e.text.includes('before midnight') && e.html.includes('Open Dayform') && e.mime.subject === e.subject), 'Email explains the midnight lock and links to the app');
check(istEmails.some(e => e.text.includes('Study')), 'Email lists the unchecked activities');
const nyDates = sentTo('ny@example.com').map(e => localParts(new RealDate(e.at), 'America/New_York'));
check(nyDates.every(p => p.hour >= 20), 'New York user is emailed after 8 PM New York time');
check(nyDates.length >= DAYS - 2, 'New York user gets a nightly email');
check(logs.ny.entries.some(e => e.type === 'failed' && e.error === 'SMTP timeout'), 'A failed send is recorded in the email log');
const failed = logs.ny.entries.find(e => e.type === 'failed');
check(failed && sentTo('ny@example.com').some(e => localParts(new RealDate(e.at), 'America/New_York').date === failed.date && e.at > Date.parse(failed.at)), 'A failed send is retried the next hour');
for (const who of ['new@example.com', 'quiet@example.com', 'empty@example.com', 'blocked@example.com']) check(!sentTo(who).length, 'No email for ' + who);
const paused = sentTo('paused@example.com').map(e => localParts(new RealDate(e.at), 'Asia/Kolkata').date);
check(paused.length && paused.every(d => d >= '2026-11-15'), 'Suspended user gets no email until the suspension ends, then resumes');
const sentTotal = Object.values(stats).reduce((a, s) => a + (s.sent || 0), 0), failedTotal = Object.values(stats).reduce((a, s) => a + (s.failed || 0), 0);
check(sentTotal === emails.length, `Daily email counters match emails sent (${sentTotal} vs ${emails.length})`);
check(failedTotal === 1, 'Failed sends are counted');
check(perUser.ist === istEmails.length && perUser.ny === sentTo('ny@example.com').length, 'Per-user email counters match');
const outage = istEmails.find(e => localParts(new RealDate(e.at), 'Asia/Kolkata').date === '2026-11-07');
check(outage && localParts(new RealDate(outage.at), 'Asia/Kolkata').hour === 22, 'A missed 8 PM and 9 PM run is caught up at 10 PM');

// ---- Server and browser schedule rules agree ----
const probes = [...activities, { id: 'x', date: '2024-01-31', repeat: 'monthly' }, { id: 'y', date: '2024-02-29', repeat: 'yearly' }, { id: 'z', date: '2026-03-31', repeat: 'monthly' }];
for (let i = 0; i < 800; i++) { const d = new RealDate(Date.UTC(2024, 0, 1 + i)).toISOString().slice(0, 10); for (const a of probes) check(serverOccurs(a, d) === app(`occurs(${JSON.stringify(a)},${JSON.stringify(d)})`), `occurs mismatch ${a.id} ${d}`); }

const sample = process.argv.find(a => a.startsWith('--sample='));
if (sample && istEmails[0]) writeFileSync(sample.slice(9), istEmails[0].html);
const unique = [...new Set(failures)];
console.log(`Simulated ${DAYS} days × 24h in ${STEP / 60000}-minute steps · ${completions} check-ins · ${lockChecks} lock checks · ${starts.length} notifications (10 min before start) · ${emails.length} emails (${istEmails.length} IST, ${nyDates.length} New York)`);
if (unique.length) { console.error('FAIL:\n- ' + unique.slice(0, 15).join('\n- ')); process.exit(1); }
console.log('PASS: notifications exactly 10 min before each start, permission allow/deny/block/revoke and on/off logging, no notifications while off or closed, midnight day locks, 24-hour allocation, 8 PM emails per timezone, failed-send logging and retry, catch-up after scheduler outages, opt-out/unverified/empty/blocked/suspended skips, exact daily and per-user email counts, server/browser schedule parity.');
