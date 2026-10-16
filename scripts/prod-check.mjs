// Pre-deploy check: builds, then fails if any secret could ship in the website or be committed.
// Usage: npm run check:prod
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const problems = [], notes = [];
const env = existsSync('.env.local') ? Object.fromEntries(readFileSync('.env.local', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const SERVER = ['FIREBASE_SERVICE_ACCOUNT', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'APP_URL', 'CRON_SECRET'];
const PUBLIC = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_STORAGE_BUCKET', 'VITE_FIREBASE_MESSAGING_SENDER_ID', 'VITE_FIREBASE_APP_ID'];

// 1. Secrets must never be in the browser bundle.
execSync('npm run build', { stdio: 'ignore' });
const secretValues = ['SMTP_PASS', 'CRON_SECRET', 'FIREBASE_SERVICE_ACCOUNT'].map(k => env[k]).filter(v => v && v.length > 8);
const patterns = [/BEGIN PRIVATE KEY/, /"type":\s*"service_account"/, /private_key_id/];
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
for (const file of walk('dist')) {
  const text = readFileSync(file, 'utf8');
  if (patterns.some(r => r.test(text)) || secretValues.some(v => text.includes(v) || text.includes(v.replace(/\s/g, '')))) problems.push(`Secret found in build output: ${file}`);
}
if (Object.keys(env).some(k => k.startsWith('VITE_') && /SERVICE|SMTP|SECRET|PASS|PRIVATE/.test(k))) problems.push('A server secret has a VITE_ prefix, which would publish it in the website.');

// 2. Nothing secret may be committed.
const files = execSync('git ls-files --cached --others --exclude-standard', { encoding: 'utf8' }).split('\n').filter(Boolean);
for (const f of files) {
  if (/(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example')) problems.push(`Would be committed: ${f}`);
  if (/service-account|firebase-adminsdk/.test(f)) problems.push(`Would be committed: ${f}`);
  if (f.startsWith('dist/')) problems.push(`Build output is tracked by git: ${f} (run: git rm -r --cached dist)`);
  if (f === 'scripts/prod-check.mjs') continue;
  try { const t = readFileSync(f, 'utf8'); if (patterns.some(r => r.test(t)) || secretValues.some(v => t.includes(v))) problems.push(`Secret inside a committable file: ${f}`); } catch {}
}

// 3. Settings Vercel will need.
for (const k of [...PUBLIC, ...SERVER]) if (!env[k]) notes.push(`${k} is not set in .env.local (set it in Vercel → Environment Variables).`);
if (env.APP_URL && !env.APP_URL.startsWith('https://')) notes.push(`APP_URL is ${env.APP_URL}. In Vercel set it to your https:// site address.`);

console.log(problems.length ? 'FAIL:\n- ' + [...new Set(problems)].join('\n- ') : 'PASS: no secrets in the build or in files git would commit.');
if (notes.length) console.log('Notes:\n- ' + notes.join('\n- '));
process.exit(problems.length ? 1 : 0);
