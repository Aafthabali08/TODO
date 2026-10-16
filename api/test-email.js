import { buildEmail, dueFor, isRestricted, localParts } from './_lib/reminders.js';
import { firebaseDeps, mailer } from './_lib/services.js';

// Sends the signed-in user a sample of tonight's reminder, to their own account email only.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return res.status(401).json({ error: 'Please log in again.' });
  try {
    const deps = firebaseDeps(), { uid } = await deps.auth.verifyIdToken(token);
    const [user, payload, log] = await Promise.all([deps.getUser(uid), deps.getPlanner(uid), deps.readLog(uid)]);
    if (!user?.email) return res.status(400).json({ error: 'Your account has no email address.' });
    if (!user.emailVerified) return res.status(400).json({ error: 'Verify your email first, then try again.' });
    if (isRestricted(await deps.getProfile(uid))) return res.status(403).json({ error: 'Your account is restricted.' });
    if (log?.lastTest && Date.now() - Date.parse(log.lastTest) < 60000) return res.status(429).json({ error: 'Please wait a minute before sending another test.' });
    const { date, timeZone } = localParts(new Date(), payload?.timezone || 'UTC');
    const { due: today, pending } = dueFor(payload, date);
    const message = buildEmail({ user, date, timeZone, total: today.length, pending, appUrl: process.env.APP_URL });
    await mailer()({ ...message, subject: '[Test] ' + message.subject });
    const at = new Date().toISOString();
    await deps.writeLog(uid, { lastTest: at, entries: [{ at, date, to: user.email, pending: pending.length, total: today.length, type: 'test' }, ...(log?.entries || [])].slice(0, 60) });
    await deps.recordEmail(uid, date, 'test');
    res.status(200).json({ ok: true, to: user.email });
  } catch (e) {
    console.error('Test email failed:', e.message);
    res.status(e.code?.startsWith?.('auth/') ? 401 : 500).json({ error: e.code?.startsWith?.('auth/') ? 'Please log in again.' : 'Email could not be sent. Check the server email settings.' });
  }
}
