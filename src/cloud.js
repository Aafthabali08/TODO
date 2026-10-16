// Firestore access for profiles, tickets, the admin inbox and the admin console.
// Every rule here is enforced server-side by firestore.rules; the UI only mirrors it.
import { doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit, serverTimestamp, Timestamp, arrayUnion } from 'firebase/firestore';

export function createCloud(db, auth) {
  const me = () => auth.currentUser;
  const iso = v => v?.toDate ? v.toDate().toISOString() : v || null;
  const plain = snap => { const d = snap.data(); return { id: snap.id, ...Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v?.toDate ? iso(v) : v])) }; };
  const profileRef = uid => doc(db, 'users', uid);

  // Restricted when blocked, or suspended until a future time.
  const restriction = p => !p ? null : p.status === 'blocked' ? { status: 'blocked', reason: p.statusReason || '' }
    : p.status === 'suspended' && p.suspendedUntil && Date.parse(p.suspendedUntil) > Date.now() ? { status: 'suspended', until: p.suspendedUntil, reason: p.statusReason || '' } : null;

  // Reads the profile once; creating or refreshing it happens in the background so sign-in never waits on a write.
  async function ensureProfile(user) {
    const ref = profileRef(user.uid), snap = await getDoc(ref);
    const base = { email: user.email || '', displayName: user.displayName || '', emailVerified: !!user.emailVerified, lastActiveAt: serverTimestamp() };
    if (!snap.exists()) {
      const fresh = { ...base, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, notificationsOn: false, emailOn: true, activityCount: 0, status: 'active', createdAt: serverTimestamp() };
      setDoc(ref, fresh).catch(e => console.warn('Profile not created:', e.code));
      return { id: user.uid, status: 'active' };
    }
    updateDoc(ref, base).catch(e => console.warn('Profile not refreshed:', e.code));
    return plain(snap);
  }
  let pendingSummary = null, summaryTimer = null;
  // Keeps the admin-visible summary current, at most once every 30 seconds.
  function syncSummary(state) {
    pendingSummary = { timezone: state.timezone || 'UTC', notificationsOn: !!state.reminders, emailOn: state.emailReminders !== false, activityCount: state.activities.length };
    if (summaryTimer) return;
    summaryTimer = setTimeout(async () => { summaryTimer = null; if (!me()) return; try { await updateDoc(profileRef(me().uid), { ...pendingSummary, lastActiveAt: serverTimestamp() }); } catch (e) { console.warn('Profile summary not saved:', e.code); } }, 30000);
  }

  // ---- Tickets ----
  async function createTicket({ category, subject, message }) {
    const u = me();
    return addDoc(collection(db, 'tickets'), { uid: u.uid, email: u.email || '', name: u.displayName || '', category, subject: subject.trim().slice(0, 120), message: message.trim().slice(0, 4000), status: 'open', replies: [], createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  }
  const myTickets = async () => (await getDocs(query(collection(db, 'tickets'), where('uid', '==', me().uid)))).docs.map(plain).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  async function replyTicket(id, text, { asAdmin = false, status } = {}) {
    const reply = { by: asAdmin ? 'admin' : 'user', name: asAdmin ? 'Dayform support' : (me().displayName || me().email), text: text.trim().slice(0, 4000), at: new Date().toISOString() };
    const change = { replies: arrayUnion(reply), updatedAt: serverTimestamp() };
    if (status) change.status = status; else if (!asAdmin) change.status = 'open';
    await updateDoc(doc(db, 'tickets', id), change);
  }

  // ---- Inbox (admin → user messages) ----
  const inbox = async () => (await getDocs(query(collection(db, 'users', me().uid, 'inbox'), orderBy('createdAt', 'desc'), limit(50)))).docs.map(plain);
  const markRead = id => updateDoc(doc(db, 'users', me().uid, 'inbox', id), { read: true });

  // ---- Admin ----
  // Forces a fresh token so a newly granted admin role shows up without signing out.
  async function isAdmin() { const u = me(); if (!u) return false; const t = await u.getIdTokenResult(true); return t.claims.admin === true && t.claims.email_verified === true; }
  async function audit(action, target, details = '') { try { await addDoc(collection(db, 'adminAudit'), { by: me().email, at: serverTimestamp(), action, target, details }); } catch (e) { console.warn('Audit not saved:', e.code); } }
  const listUsers = async () => (await getDocs(collection(db, 'users'))).docs.map(plain);
  const listTickets = async () => (await getDocs(collection(db, 'tickets'))).docs.map(plain).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const emailStats = async () => (await getDocs(collection(db, 'emailStats'))).docs.map(plain);
  const auditLog = async () => (await getDocs(query(collection(db, 'adminAudit'), orderBy('at', 'desc'), limit(200)))).docs.map(plain);
  async function userDetail(uid) {
    const [planner, emailLog, msgs] = await Promise.all([getDoc(doc(db, 'users', uid, 'planner', 'state')), getDoc(doc(db, 'users', uid, 'planner', 'emailLog')), getDocs(query(collection(db, 'users', uid, 'inbox'), orderBy('createdAt', 'desc'), limit(20)))]);
    return { planner: planner.exists() ? planner.data().payload : null, emailLog: emailLog.exists() ? emailLog.data() : null, inbox: msgs.docs.map(plain) };
  }
  async function emailLogs(uids) { const out = {}; await Promise.all(uids.map(async uid => { const s = await getDoc(doc(db, 'users', uid, 'planner', 'emailLog')); if (s.exists()) out[uid] = s.data(); })); return out; }
  async function setStatus(uid, email, status, { days, reason = '' } = {}) {
    const until = status === 'suspended' ? Timestamp.fromMillis(Date.now() + days * 86400000) : null;
    await updateDoc(profileRef(uid), { status, suspendedUntil: until, statusReason: reason.slice(0, 300), statusUpdatedAt: serverTimestamp(), statusUpdatedBy: me().email });
    await audit(status === 'active' ? 'Restored access' : status === 'blocked' ? 'Blocked user' : `Suspended user for ${days} day${days === 1 ? '' : 's'}`, email, reason);
  }
  async function sendMessage(uid, email, title, body) {
    await addDoc(collection(db, 'users', uid, 'inbox'), { title: title.slice(0, 120), body: body.slice(0, 2000), from: 'Dayform support', read: false, createdAt: serverTimestamp() });
    await audit('Sent message', email, title);
  }
  async function setTicketStatus(id, status, email) { await updateDoc(doc(db, 'tickets', id), { status, updatedAt: serverTimestamp() }); await audit(`Ticket marked ${status.replace('_', ' ')}`, email, id); }

  return { restriction, ensureProfile, syncSummary, createTicket, myTickets, replyTicket, inbox, markRead, isAdmin, audit, listUsers, listTickets, emailStats, auditLog, userDetail, emailLogs, setStatus, sendMessage, setTicketStatus };
}
