import { readFileSync } from 'node:fs';
import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import nodemailer from 'nodemailer';

// FIREBASE_SERVICE_ACCOUNT holds the service-account JSON, raw or base64-encoded. It is a
// server-only secret: never prefix it with VITE_, or it would be bundled into the website.
function adminApp() {
  if (getApps().length) return getApps()[0];
  // Locally, FIREBASE_SERVICE_ACCOUNT_FILE can point at the downloaded key file (kept outside the project).
  const file = process.env.FIREBASE_SERVICE_ACCOUNT_FILE;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || (file && readFileSync(file, 'utf8'));
  if (!raw) throw Error('Set FIREBASE_SERVICE_ACCOUNT (Vercel) or FIREBASE_SERVICE_ACCOUNT_FILE (local).');
  const json = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  return initializeApp({ credential: cert(json) });
}

export function firebaseDeps() {
  const app = adminApp(), db = getFirestore(app), auth = getAuth(app);
  const logRef = uid => db.doc(`users/${uid}/planner/emailLog`);
  return {
    auth,
    async listPlanners() {
      const snap = await db.collectionGroup('planner').get();
      return snap.docs.filter(d => d.id === 'state' && d.ref.parent.parent).map(d => ({ uid: d.ref.parent.parent.id, payload: d.get('payload') }));
    },
    async getPlanner(uid) { const d = await db.doc(`users/${uid}/planner/state`).get(); return d.exists ? d.get('payload') : null; },
    async getUser(uid) { try { return await auth.getUser(uid); } catch (e) { if (e.code === 'auth/user-not-found') return null; throw e; } },
    async readLog(uid) { const d = await logRef(uid).get(); return d.exists ? d.data() : null; },
    async writeLog(uid, log) { await logRef(uid).set(log, { merge: true }); },
    async getProfile(uid) { const d = await db.doc(`users/${uid}`).get(); if (!d.exists) return null; const p = d.data(); return { ...p, suspendedUntil: p.suspendedUntil?.toDate?.() || p.suspendedUntil || null }; },
    // Exact counters for the admin console: per day (emailStats/{date}) and per user.
    async recordEmail(uid, date, type) {
      await db.doc(`emailStats/${date}`).set({ [type]: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      if (type !== 'failed') try { await db.doc(`users/${uid}`).update({ emailsSent: FieldValue.increment(1), lastEmailAt: FieldValue.serverTimestamp() }); } catch (e) { if (e.code !== 5) throw e; }
    },
  };
}

// SMTP works with Gmail (app password), Brevo, SendGrid, Resend and most providers.
export function smtpTransport() {
  const { SMTP_HOST, SMTP_PORT = '587', SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_HOST || !SMTP_USER || !SMTP_PASS) throw Error('SMTP_HOST, SMTP_USER and SMTP_PASS must be set.');
  return nodemailer.createTransport({ host: SMTP_HOST, port: Number(SMTP_PORT), secure: Number(SMTP_PORT) === 465, auth: { user: SMTP_USER, pass: SMTP_PASS.replace(/\s/g, '') } });
}
export function mailer() {
  const transport = smtpTransport(), { SMTP_USER, MAIL_FROM } = process.env;
  return message => transport.sendMail({ from: MAIL_FROM || `Dayform <${SMTP_USER}>`, ...message });
}
