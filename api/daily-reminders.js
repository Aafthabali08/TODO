import { timingSafeEqual } from 'node:crypto';
import { runReminders } from './_lib/reminders.js';
import { firebaseDeps, mailer } from './_lib/services.js';

// Called hourly by a scheduler. Each user is emailed once, between 8 PM and midnight in their own timezone.
export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const given = Buffer.from(req.headers.authorization || ''), expected = Buffer.from(`Bearer ${secret}`);
  if (!secret || given.length !== expected.length || !timingSafeEqual(given, expected)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const deps = { ...firebaseDeps(), send: mailer() };
    const results = await runReminders({ appUrl: process.env.APP_URL, deps });
    const sent = results.filter(r => r.sent).length, failed = results.filter(r => r.reason === 'error');
    if (failed.length) console.error('Reminder failures:', failed);
    res.status(200).json({ checked: results.length, sent, failed: failed.length });
  } catch (e) {
    console.error('Reminder run failed:', e.message);
    res.status(500).json({ error: e.message });
  }
}
