// Checks firestore.rules with Google's Rules test API. Nothing is deployed and no data is touched.
// Usage: npm run test:rules   (needs FIREBASE_SERVICE_ACCOUNT in .env.local)
import { readFileSync } from 'node:fs';
import { cert } from 'firebase-admin/app';

const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!raw) { console.error('Set FIREBASE_SERVICE_ACCOUNT in .env.local'); process.exit(1); }
const key = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
const { access_token } = await cert(key).getAccessToken();
const D = '/databases/(default)/documents';
const user = (uid, extra = {}) => ({ uid, token: { email: uid + '@example.com', email_verified: true, ...extra } });
const ADMIN = user('boss', { email: 'aafthabali08@gmail.com', admin: true });
const FAKE_ADMIN = user('faker', { admin: false });
const UNVERIFIED_ADMIN = user('boss2', { admin: true, email_verified: false });
// Mocks for the get()/exists() lookups of a user's profile.
const profile = status => [
  { function: 'exists', args: [{ anyValue: {} }], result: { value: true } },
  { function: 'get', args: [{ anyValue: {} }], result: { value: { data: { status } } } },
];
const T = (name, expectation, auth, method, path, { data, existing, mocks = profile('active') } = {}) => ({ name, expectation, functionMocks: mocks, request: { auth, method, path: D + path, ...(data ? { resource: { data } } : {}) }, ...(existing ? { resource: { data: existing } } : {}) });
const planner = { payload: { activities: [], done: {}, logs: [], reminders: false }, updatedAt: 'x' };
const prof = { email: 'u1@example.com', displayName: 'U', status: 'active', notificationsOn: false };
const ticket = { uid: 'u1', email: 'u1@example.com', status: 'open', replies: [], subject: 'Help', message: 'Hi', category: 'help' };

const cases = [
  T('Owner reads own planner', 'ALLOW', user('u1'), 'get', '/users/u1/planner/state'),
  T('Other user cannot read planner', 'DENY', user('u2'), 'get', '/users/u1/planner/state'),
  T('Signed-out cannot read planner', 'DENY', null, 'get', '/users/u1/planner/state'),
  T('Blocked owner cannot read planner', 'DENY', user('u1'), 'get', '/users/u1/planner/state', { mocks: profile('blocked') }),
  T('Blocked owner can still read email log', 'ALLOW', user('u1'), 'get', '/users/u1/planner/emailLog', { mocks: profile('blocked') }),
  T('Admin reads any planner', 'ALLOW', ADMIN, 'get', '/users/u1/planner/state'),
  T('Non-admin with admin=false denied', 'DENY', FAKE_ADMIN, 'get', '/users/u1/planner/state'),
  T('Admin with unverified email denied', 'DENY', UNVERIFIED_ADMIN, 'get', '/users/u1/planner/state'),
  T('Admin cannot write a user planner', 'DENY', ADMIN, 'update', '/users/u1/planner/state', { data: planner, existing: planner }),
  T('Nobody can write the email log from the app', 'DENY', user('u1'), 'update', '/users/u1/planner/emailLog', { data: { lastSent: 'x' }, existing: {} }),
  T('Owner reads own profile', 'ALLOW', user('u1'), 'get', '/users/u1'),
  T('Other user cannot read profile', 'DENY', user('u2'), 'get', '/users/u1'),
  T('Admin lists all profiles', 'ALLOW', ADMIN, 'list', '/users/u1'),
  T('Non-admin cannot list profiles', 'DENY', user('u2'), 'list', '/users/u1'),
  T('Owner updates own summary', 'ALLOW', user('u1'), 'update', '/users/u1', { existing: prof, data: { ...prof, notificationsOn: true } }),
  T('Owner cannot unblock themselves', 'DENY', user('u1'), 'update', '/users/u1', { existing: { ...prof, status: 'blocked' }, data: { ...prof, status: 'active' } }),
  T('Owner cannot grant fields like role', 'DENY', user('u1'), 'update', '/users/u1', { existing: prof, data: { ...prof, role: 'admin' } }),
  T('Owner cannot change their email counter', 'DENY', user('u1'), 'update', '/users/u1', { existing: prof, data: { ...prof, emailsSent: 0 } }),
  T('Admin blocks a user', 'ALLOW', ADMIN, 'update', '/users/u1', { existing: prof, data: { ...prof, status: 'blocked', statusReason: 'spam' } }),
  T('Admin cannot set an unknown status', 'DENY', ADMIN, 'update', '/users/u1', { existing: prof, data: { ...prof, status: 'deleted' } }),
  T('Admin cannot edit a user’s name', 'DENY', ADMIN, 'update', '/users/u1', { existing: prof, data: { ...prof, displayName: 'X' } }),
  T('Owner reads own ticket', 'ALLOW', user('u1'), 'get', '/tickets/t1', { existing: ticket }),
  T('Other user cannot read ticket', 'DENY', user('u2'), 'get', '/tickets/t1', { existing: ticket }),
  T('Admin reads any ticket', 'ALLOW', ADMIN, 'get', '/tickets/t1', { existing: ticket }),
  T('Owner adds one reply', 'ALLOW', user('u1'), 'update', '/tickets/t1', { existing: ticket, data: { ...ticket, replies: [{ by: 'user', text: 'more' }] } }),
  T('Owner cannot resolve own ticket', 'DENY', user('u1'), 'update', '/tickets/t1', { existing: ticket, data: { ...ticket, status: 'resolved', replies: [{ by: 'user', text: 'x' }] } }),
  T('Owner cannot rewrite the message', 'DENY', user('u1'), 'update', '/tickets/t1', { existing: ticket, data: { ...ticket, message: 'edited', replies: [{}] } }),
  T('Admin resolves a ticket', 'ALLOW', ADMIN, 'update', '/tickets/t1', { existing: ticket, data: { ...ticket, status: 'resolved' } }),
  T('Admin cannot change ticket owner', 'DENY', ADMIN, 'update', '/tickets/t1', { existing: ticket, data: { ...ticket, uid: 'u9' } }),
  T('User cannot create a ticket for someone else', 'DENY', user('u2'), 'create', '/tickets/t2', { data: { ...ticket } }),
  T('Admin reads email stats', 'ALLOW', ADMIN, 'get', '/emailStats/2026-11-01'),
  T('User cannot read email stats', 'DENY', user('u1'), 'get', '/emailStats/2026-11-01'),
  T('Nobody writes email stats from the app', 'DENY', ADMIN, 'update', '/emailStats/2026-11-01', { data: { sent: 999 }, existing: { sent: 1 } }),
  T('User cannot read admin log', 'DENY', user('u1'), 'list', '/adminAudit/a1'),
  T('Admin reads admin log', 'ALLOW', ADMIN, 'list', '/adminAudit/a1'),
  T('Owner reads own inbox', 'ALLOW', user('u1'), 'list', '/users/u1/inbox/m1'),
  T('User cannot message others', 'DENY', user('u2'), 'create', '/users/u1/inbox/m1', { data: { title: 'x', body: 'y', read: false, from: 'me', createdAt: 'x' } }),
  T('Owner marks message read', 'ALLOW', user('u1'), 'update', '/users/u1/inbox/m1', { existing: { title: 'x', read: false }, data: { title: 'x', read: true } }),
  T('Owner cannot edit message text', 'DENY', user('u1'), 'update', '/users/u1/inbox/m1', { existing: { title: 'x', read: false }, data: { title: 'changed', read: false } }),
  T('Unknown collections are closed', 'DENY', ADMIN, 'get', '/secrets/x'),
];

const body = { source: { files: [{ name: 'firestore.rules', content: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') }] }, testSuite: { testCases: cases.map(({ name, ...c }) => c) } };
const res = await fetch(`https://firebaserules.googleapis.com/v1/projects/${key.project_id}:test`, { method: 'POST', headers: { Authorization: 'Bearer ' + access_token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const out = await res.json();
if (out.error) { console.error('Rules API error:', out.error.message); process.exit(1); }
if (out.issues?.length) { console.error('Rules issues:\n' + out.issues.map(i => `- ${i.severity} line ${i.sourcePosition?.line}: ${i.description}`).join('\n')); if (out.issues.some(i => i.severity === 'ERROR')) process.exit(1); }
const failed = out.testResults.map((r, i) => ({ r, c: cases[i] })).filter(({ r }) => r.state !== 'SUCCESS');
failed.forEach(({ r, c }) => console.error(`FAIL: ${c.name} (expected ${c.expectation}) ${r.debugMessages?.join(' ') || ''}`));
console.log(`${cases.length - failed.length}/${cases.length} rules checks passed.`);
process.exit(failed.length ? 1 : 0);
