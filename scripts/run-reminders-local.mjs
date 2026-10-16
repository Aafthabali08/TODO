// Runs the real 8 PM email job from this Mac against your Firebase project.
// Dry run by default: it lists who would be emailed and why, and sends nothing.
//   npm run reminders:local                         # dry run, current time
//   npm run reminders:local -- --at=20:05           # dry run as if it were 8:05 PM in each user's timezone
//   npm run reminders:local -- --at=20:05 --send    # really send (records the send, so tonight's run skips it)
//   npm run reminders:local -- --check-email        # log in to the SMTP server only; sends nothing, no Firebase needed
//   npm run reminders:local -- --send-sample        # send one sample reminder to SMTP_USER (your own inbox)
// Needs in .env.local: FIREBASE_SERVICE_ACCOUNT_FILE=/path/outside/project/key.json, and SMTP_* only for --send.
import { runReminders, localParts, buildEmail } from '../api/_lib/reminders.js';
import { firebaseDeps, mailer, smtpTransport } from '../api/_lib/services.js';

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const send = args.send === true;
if (args['check-email']) {
  try { await smtpTransport().verify(); console.log(`OK: ${process.env.SMTP_HOST} accepted the login for ${process.env.SMTP_USER}. No email was sent.`); }
  catch (e) { console.error(`FAILED: ${e.message}\nCheck SMTP_USER matches the Google account that created the app password, and that 2-Step Verification is on.`); process.exitCode = 1; }
  process.exit();
}
if (args['send-sample']) {
  const to = process.env.SMTP_USER, date = localParts(new Date(), 'Asia/Kolkata').date;
  const pending = [{ start: '09:00', end: '11:00', title: 'Deep work (sample)' }, { start: '14:00', end: '15:30', title: 'Study (sample)' }];
  const message = buildEmail({ user: { email: to, displayName: 'there' }, date, timeZone: 'Asia/Kolkata', total: 5, pending, appUrl: process.env.APP_URL });
  const info = await mailer()({ ...message, subject: '[Sample] ' + message.subject });
  console.log(`Sent a sample reminder to ${to} (${info.response}).`);
  process.exit();
}
const base = firebaseDeps();
const planners = await base.listPlanners();
console.log(`Found ${planners.length} planner(s). ${send ? 'SENDING real emails.' : 'Dry run: nothing will be sent.'}`);

for (const { uid, payload } of planners) {
  // --at=HH:MM evaluates each user at that local time today, in their own timezone.
  let now = new Date();
  if (args.at) {
    const tz = payload?.timezone || 'UTC', { date } = localParts(now, tz);
    const guess = new Date(`${date}T${args.at}:00Z`);
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(guess).map(x => [x.type, x.value]));
    now = new Date(guess.getTime() - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - guess.getTime()));
  }
  const deps = { ...base, listPlanners: async () => [{ uid, payload }], send: send ? mailer() : async m => console.log(`  would email ${m.to}: “${m.subject}”`), writeLog: send ? base.writeLog : async () => {} };
  const [result] = await runReminders({ now, appUrl: process.env.APP_URL, deps });
  const user = await base.getUser(uid);
  console.log(`- ${user?.email || uid} (${payload?.timezone || 'no timezone yet'}, checked as ${now.toLocaleString('en-GB', { timeZone: payload?.timezone || 'UTC' })}): ${result.sent ? (send ? 'SENT' : 'would send') + ` · ${result.pending} unchecked` : 'skipped · ' + result.reason}${result.error ? ' · ' + result.error : ''}`);
}
process.exit(0);
