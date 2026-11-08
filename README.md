# Running AURA locally

Start these in separate terminals from the project folder:

```powershell
cd backend
npm run db:local
```

```powershell
cd backend
npm start
```

```powershell
cd frontend
npm run dev
```

Open http://localhost:5173. Keep the database terminal running while using the app. Local PostgreSQL data persists in `backend/.local-postgres`; restarting it preserves accounts. The local runner is for development and only accepts a localhost database URL. It bootstraps empty databases and applies the included migrations.

The local database starts with the interests catalog, without demo accounts. Use Sign up or Continue with Google to create an account.

Google sign-in needs matching `GOOGLE_CLIENT_ID` in `backend/.env` and `VITE_GOOGLE_CLIENT_ID` in `frontend/.env`. The Google OAuth client's authorized JavaScript origins must include `http://localhost:5173`. Use that address consistently. Production hosting must also serve `Cross-Origin-Opener-Policy: same-origin-allow-popups` for popup sign-in.

Backend checks: `cd backend`, then `node --test test/*.test.js`.

## First-time setup

Install dependencies with `npm install` in both `backend` and `frontend`.
Copy each `.env.example` to `.env`, set your local PostgreSQL credentials and a
unique `JWT_SECRET`, then follow the startup commands above. Keep `.env` private.

Run the backend integration checks with:
`cd backend; node --test test/integration/*.test.js`.
Run the frontend checks with:
`cd frontend; node --test test/*.test.mjs; npm run build`.

Image moderation runs locally; see `backend/IMAGE_MODERATION.md` for its scope
and limitations. The app currently targets localhost development; configure
API/socket URLs and production secrets before deploying to a public host.

## Reports

Users can report a user from Discover, a revealed profile, a chat header, or
conversation options; report another person's post from Journal/profile posts;
and report a bug from Settings. Reports are stored in `safety_reports` with a
pending status, reporter, reason, optional details, and an optional route path.
The reporter receives a report ID. `GET /api/reports/mine` returns only their
own report summaries. Reports never automatically penalize the target.

Only eligible visible posts/profiles or the authenticated user's conversation
partner can be reported. Active reports for the same target are deduplicated;
new submissions are limited to five per ten minutes per reporter. The management dashboard at `/admin` supports report triage, evidence review,
notes, assignment, status changes, and reversible hiding of reported posts. The legacy `/api/profile/report`
route uses the same validation and report storage.


## Management dashboard

Open /admin after signing in to a management account. This is a full-width,
responsive workspace, separate from the dating app's phone layout.

- Staff: analytics, basic user details, warnings, report triage and evidence.
- Admin: staff permissions plus restrictions, bans, and post hide/restore.
- Superadmin: management accounts, role changes, and append-only audit history.

Apply new migrations with `cd backend; npm run db:migrate`. This does not reset
existing data. The local database runner also applies migrations on startup.
For the first superadmin only, run `npm run admin:bootstrap -- email@example.com`.
The CLI prompts for a hidden password and stops once a superadmin exists.
Never commit credentials or add a default management password to seed data.
Superadmin can create admin/staff accounts with temporary passwords; these must
be rotated before management tools can be used. Existing account roles can also
be changed by user ID. Role changes and password rotation revoke old sessions.

Bans revoke sessions and disconnect live sockets. Warnings require user
acknowledgement; temporary restrictions block sending/posting. Restrictions can
be 1 hour, 1 day, 3 days, or 7 days. Management actions require reasons and are
recorded atomically with their audit entries. Audit records cannot be edited or
deleted through the app and a database trigger rejects normal UPDATE/DELETE.

Activity metrics start with migration 017. Visible-tab heartbeats estimate
foreground use, avoid counting multiple tabs twice, and skip gaps over 45
seconds. They do not reconstruct past usage or measure attentive screen time.
The activity chart uses UTC day buckets. Management accounts are excluded from
community activity totals. Report evidence is limited to the reported post or
up to 30 recent text/attachment metadata messages from the reported pair;
conversation media is not loaded in the review drawer. Evidence views and user
detail views are also audited. Old reports without conversation context may not
have message evidence.

## Retained conversation report evidence

Migration 018 adds report-time snapshots for newly submitted conversation
reports only. Up to 30 messages visible to the reporter are copied atomically
with the report, with a 10 MB total media cap per report. Hidden, already-unsent,
and conversation-deleted messages are excluded. Messages sent after submission
are not added. Duplicate reports do not extend or replace the snapshot.

Unsend still erases the regular message and media. Any earlier report snapshot
survives only until 30 days after that report's creation. Existing unsent content
cannot be reconstructed, and older reports are not backfilled. Retention is not
extended by report status changes, repeated views, or reviewer assignment.

Only Superadmin or the explicitly designated evidence reviewer can read the
snapshot. Only Superadmin can assign or revoke this reviewer. Triage assignment
(including Assign to me) does not grant retained-evidence access. Each text or
media access requires a reason, re-checks authorization and expiry, and writes an
audit event without copying message content into the permanent audit log.
Responses are private/no-store, and media loads only after an explicit action.

Expired snapshots are immediately refused by access endpoints. A startup and
one-minute periodic cleanup physically deletes expired rows and media while the
backend is running; after downtime cleanup resumes on startup. Database backups
must follow the operator's own retention policy as well—live-table deletion does
not rewrite older backups. Do not promise removal from screenshots or copies
already saved by an authorized reviewer.
