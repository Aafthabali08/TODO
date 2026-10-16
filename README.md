# Dayform

The complete Dayform planner, retaining the original sage-glass UI. This version runs on Vercel and uses Firebase Email/Password Authentication and Cloud Firestore. No ChatGPT sign-in or Sites hosting is required. These changes have not been published.

## Run locally

1. Install Node.js 20.19+ or 22.12+ (Node 22 recommended).
2. Run `npm install`.
3. Copy `.env.example` to `.env.local`.
4. Fill in the Firebase web app configuration values.
5. Run `npm run dev`.

The login screen renders even before Firebase is configured, and displays setup guidance. It does not bypass authentication or silently fall back to shared local data.

## Firebase setup

1. Create a Firebase project at https://console.firebase.google.com and register a **Web app**.
2. Copy its config into the matching `VITE_FIREBASE_*` variables in `.env.local`. These are public web configuration values, not Admin SDK credentials. Never place a service-account private key in these variables.
3. In Authentication → Sign-in method, enable **Email/Password**.
4. Create a **Cloud Firestore** database in production mode and choose your region.
5. In Firestore → Rules, paste and publish `firestore.rules`. Alternatively, install Firebase CLI, log in, then run `firebase deploy --only firestore:rules --project YOUR_PROJECT_ID` yourself.
6. In Authentication → Settings → Authorized domains, add `localhost` for development and your Vercel production/custom domain.
7. Customize the password-reset email in Authentication → Templates if desired.

The included rules deny access unless the authenticated UID matches `/users/{uid}/planner/state`. Frontend route hiding alone is not authorization. No Cloud Storage bucket is needed for the current planner: all records are structured Firestore data, with JSON and calendar downloads generated client-side.

## Deploy on Vercel yourself

1. Upload this folder to your own Git repository, excluding `.env.local` and `node_modules`.
2. Import that repository in Vercel. If the repository contains the parent TODOEVERYTHING folder, set **Root Directory** to `dayform`.
3. Framework: **Vite**. Build: `npm run build`. Output directory: `dist`.
4. Add the same six `VITE_FIREBASE_*` variables under Vercel → Settings → Environment Variables, selecting the intended environments.
5. Deploy, then add the assigned domain to Firebase Authentication's authorized domains. Rebuild after changing environment variables: Vite embeds them at build time.

`vercel.json` includes the build settings. No deployment was performed as part of this migration. The earlier Sites deployment is unchanged; this codebase does not depend on it.

## Included

- Original dashboard, charts (bundled Chart.js), calendar, 24-hour timetable, insights, and notification log.
- Matching login, sign-up, password-reset and sign-out flows.
- Account-isolated Firestore persistence with serialized writes and explicit save-error status.
- Daily/weekly/monthly/yearly recurring activities, overnight accounting, meeting links, rescheduling, deletion, and time-locked completion.
- JSON backup and `.ics` export.
- Responsive layout, keyboard-accessible forms, reduced-motion support.
- All activities page: search, category filters, per-week hours, check-in counts, edit, duplicate and delete.
- Insights: current/best check-in streaks, 30-day completion and on-time rates, completion trend line, and planned hours by category.
- Happening-now card with live progress, real 7-day completion mini-bars, and start-of-activity reminders 10 minutes ahead (while the planner is open).
- Backup restore (validated JSON import), email verification, show/hide password, browser back/forward between pages.
- Keyboard shortcuts: N new activity, / search, T today, ←/→ change day, 1–7 switch pages.

## Data and behavior limits

- The planner is saved as one document per user. Firestore's document size limit is 1 MiB. The UI retains the latest 300 audit events; export regularly. Very large histories should be migrated to separate collections.
- Reload to fetch changes made on another device. Concurrent edits from multiple tabs/devices use last-write-wins; this is not collaborative real-time editing.
- Existing browser-local data from the earlier Sites origin is not automatically migrated. That site's data belongs to its browser origin; export a backup there before switching.
- Rescheduling a repeating activity edits its entire series. Existing completion timestamps are preserved; occurrences removed by a changed repeat/date rule no longer appear in the schedule.
- Completion timing is enforced in the browser for personal planning, not as a tamper-proof attendance system. Audit entries are personal activity history, not immutable security audit records.
- Browser notifications require permission and the app to remain open. Closed-browser 8 PM delivery requires a separate scheduling/push backend and is not provided by this static Vercel app. Browser acceptance is logged without claiming verified device delivery.
- Monthly/yearly repeats clamp to the last day of shorter months in the planner; external calendar applications may interpret exported RRULE month-end dates differently.
- Fonts load from Google Fonts, with local sans-serif fallbacks. Chart.js is bundled locally.

## Project layout

- `index.html`: original planner shell and matching authentication screens
- `src/style.css`: preserved planner styling and authentication styles
- `src/app.js`: schedule logic, views, charts, export, reminders
- `src/auth.js`: Firebase authentication, private loading and persistence
- `public/chart.js`: bundled Chart.js
- `firestore.rules`: owner-only authorization rules
- `firebase.json`, `vercel.json`, `.env.example`: deployment configuration
- `check.cjs`: scheduling boundary checks (`npm test`)

Run `npm test` and `npm run build` before deployment. Firebase end-to-end sign-up, sign-in, reset, and rules checks require an actual configured project; they are not claimed as verified without one.

## Timetable and completion update

The timetable uses a seven-day grid with 24 hourly rows, wrapping activity names, keyboard/hover previews, and clickable detail dialogs. Empty cells prefill their date and hour. Overnight activities appear on the next morning’s dashboard. Completion offers Just now, On time, or another actual/estimated past time, rejects future/pre-start times, and records the chosen timestamp for analytics. A gentle check-in appears for activities ended within the last two hours. Profile preferences expose Firebase name/email, name editing, password reset, and sign-out on desktop and mobile.

## 8 PM email reminders and day locks

**Day locks.** A day locks at local midnight: activities that finished before today began can no longer be checked in, undone or edited, and new activities can't be planned on past dates. An overnight activity (for example sleep from 10 PM to 7 AM) stays editable until the end of the day it finishes. The header shows a live local clock.

**Emails.** `api/daily-reminders.js` is a Vercel serverless function. Between 8 PM and midnight in each user's own timezone it emails their **registration email** a list of activities that started before 8 PM and are still unchecked, warning that the day locks at midnight. Users get at most one email per day, and none on days where everything is checked in. Emails go only to **verified** addresses; sign-up sends a verification email, and Preferences has a "Verify email" button. Users can turn emails off or send themselves a test in Preferences. Sent emails appear under Notification log.

Setup (once):
1. Firebase console → Project settings → Service accounts → **Generate new private key**. In Vercel → Settings → Environment Variables, add the whole JSON file as `FIREBASE_SERVICE_ACCOUNT`. Never commit this file or prefix it with `VITE_`.
2. Add SMTP settings: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM`. For Gmail, use `smtp.gmail.com`, port `587` and a Google **App password** (Google Account → Security → 2-Step Verification → App passwords).
3. Add `APP_URL` (your site, e.g. `https://dayform.vercel.app`) and `CRON_SECRET` (any long random string).
4. Publish the updated `firestore.rules`, then redeploy.

Scheduling: `vercel.json` runs the job daily at 15:00 UTC, which is 8:30 PM India time. This works on Vercel's free plan; free-plan cron jobs can fire any time within that hour. For users in other timezones, either change the schedule to `0 * * * *` on Vercel Pro, or use the included `.github/workflows/reminders.yml`. It triggers the job hourly and needs repository secrets `APP_URL` and `CRON_SECRET`. Running the job extra times is safe: each user is emailed at most once per day.

**Browser notifications and email are separate**, each with its own on/off switch on the Notifications page:
- Browser notifications arrive exactly 10 minutes before each activity starts. They need notification permission, and Dayform must be open in that browser. A timer is set for the exact moment; browsers may delay timers in tabs hidden for a long time by up to about a minute.
- Email goes out once a day at 8 PM (see above).

The audit log records permission allowed, denied or dismissed; notifications blocked; switching either channel on or off; permission revoked in browser settings (notifications switch off automatically); every notification sent; and every email sent or failed. A failed email is retried at the next hourly run.

`npm test` includes `scripts/reminder-sim.mjs`. It simulates 30 days in 5-minute steps with all 24 hours planned. It checks that notifications fire exactly 10 minutes before each start, permission handling and on/off logging, midnight locks, nightly emails for users in India and New York, catch-up after missed scheduler runs, and skipping opted-out, unverified and empty accounts. Emails are rendered with a test transport and never sent.

### Testing emails from your Mac before deploying

Keep the service-account key file **outside** this project (for example `~/keys/dayform-admin.json`), then add to `.env.local`:

```
FIREBASE_SERVICE_ACCOUNT_FILE=/Users/you/keys/dayform-admin.json
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=you@gmail.com
SMTP_PASS=your 16-character app password
MAIL_FROM=Dayform <you@gmail.com>
APP_URL=http://127.0.0.1:4173
```

`npm run reminders:local -- --at=20:05` shows who would be emailed at 8:05 PM and why others are skipped, and sends nothing. Add `--send` to send for real. A real send is recorded, so that night's scheduled run won't send it again.

## Admin console, help tickets and account restrictions

- **Admin access** is granted only by `npm run admin:set -- aafthabali08@gmail.com`. It sets a Firebase custom claim with the service account. The website can't grant it, and the rules also require the admin's email to be verified. The **Admin console** link appears only for admins, and other users who open `/admin` see "Admins only".
- **Insights:** total, new and active users; blocked and suspended users; verified emails; how many users have notifications and 8 PM emails on or off; emails sent today, in 7 days and in 30 days, plus failures; open tickets; charts of emails per day, sign-ups per day and channel settings; most-emailed users.
- **Users:** search, filter by status, and see each user's join date, last activity, activities, notification and email settings, and emails received. View a full profile (planner summary, recent activity, email history, tickets, messages). Send an in-app message, suspend for 1/3/7/30 days, block, or restore. Every action is recorded in the Admin log.
- **Tickets:** users raise tickets under Help & support. Blocked or suspended users see an "access paused" screen where they can request access. Admins reply, set status (open, in progress, resolved, closed), and restore access straight from an access request.
- **Emails:** per-day sent, failed and test counts; per-user totals; every reminder and failure.
- Blocked users can't read or write their planner, and their reminder emails stop. Firestore rules enforce this, not just the website. A suspension lifts automatically at its end time.
- `npm run test:rules` checks `firestore.rules` with Google's Rules test API. It needs a credential with the "Firebase Rules Viewer" role.

## Production deploy checklist (Vercel)

1. `npm test` and `npm run check:prod`. The second builds the site and fails if any secret is in the build or in files git would commit.
2. Push this folder to a **private** GitHub repository. `.gitignore` and `.vercelignore` keep `.env*`, keys and `dist/` out.
3. Vercel → Add New → Project → import the repo. Framework **Vite**. If the repo root is the parent folder, set Root Directory to `dayform`. Node 22 is pinned in `package.json`.
4. Environment Variables (Production): the six `VITE_FIREBASE_*` values, plus `FIREBASE_SERVICE_ACCOUNT`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `CRON_SECRET` and `APP_URL` (your `https://…vercel.app` address). Copy the values from `.env.local`; `APP_URL` is the only one that differs.
5. Deploy. Then in Firebase → Authentication → Settings → Authorized domains, add the Vercel domain. In the Google Cloud browser key's website restrictions, add `https://<your-domain>/*`.
6. Publish `firestore.rules`, run `npm run admin:set -- aafthabali08@gmail.com` once your account exists, and press "Send test email" on the live site.
7. Vercel → Settings → Cron Jobs should list `/api/daily-reminders` (daily at 15:00 UTC, which is 8:30 PM IST).
