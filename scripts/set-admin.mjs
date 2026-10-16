// Grants (or removes) admin access by setting a custom claim with the Admin SDK.
// Only someone holding the service-account key can run this; the website itself can never grant admin.
//   npm run admin:set -- aafthabali08@gmail.com
//   npm run admin:set -- aafthabali08@gmail.com --remove
import { firebaseDeps } from '../api/_lib/services.js';
const email = process.argv.find(a => a.includes('@')), remove = process.argv.includes('--remove');
if (!email) { console.error('Usage: npm run admin:set -- you@example.com [--remove]'); process.exit(1); }
const { auth } = firebaseDeps();
try {
  const user = await auth.getUserByEmail(email);
  if (!remove && !user.emailVerified) console.warn('Note: this email is not verified yet. Admin access only works after verifying it.');
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims || {}), admin: !remove });
  console.log(`${remove ? 'Removed admin access from' : 'Granted admin access to'} ${email}. Sign out and back in to Dayform for it to take effect.`);
} catch (e) {
  console.error(e.code === 'auth/user-not-found' ? `No Dayform account for ${email} yet. Sign up in the app first, then run this again.` : e.message);
  process.exitCode = 1;
}
process.exit();
