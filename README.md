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

### Signup policies
New email and Google accounts must explicitly accept the current Terms/Community Guidelines, acknowledge the Privacy Notice and confirm age 18+. GET `/api/auth/policies` supplies the canonical version and documents. Acceptance version and server timestamps are saved atomically with account creation (migration 019); existing accounts can still sign in. `/policies` is publicly readable. This is a development draft: complete the operator identity, public privacy contact and final storage/backup retention before public launch. Age confirmation is self-declared, not verification.

### Aura Farming
Migration 020 adds separate random chat/audio-call queues, reciprocal age/gender/religion filters, 24-hour usage windows, server-controlled `premium_until`, and temporary WebRTC signaling. Free: 10 matched random chats, 10 matched random calls and 3 religion-filter uses per shared fixed 24-hour window beginning with the first match. Pending/cancelled searches are free; each matched participant is charged once. Premium: unlimited random pairing and religion filters. Age/gender filters are free. Existing connection-specific talks do not use random allowances. Superadmin can grant/revoke dated Premium access in User management, with a required audit reason; no payments or subscription checkout are implemented.

Calls use browser WebRTC audio and require microphone permission plus HTTPS (localhost is also supported). Configure `WEBRTC_ICE_SERVERS` with a TURN relay for reliable calls across carrier NAT/firewalls; the default STUN-only setup cannot guarantee all networks will connect. ICE configuration is returned to authenticated clients, so use dedicated limited-lifetime TURN credentials rather than unrelated secrets. Calls stay anonymous for five minutes and retain mutual reveal after one minute; revealing transfers to the regular conversation and ends audio. Leaving the call page stops the microphone and ends the call. Switching browser tabs does not cancel searches. AURA does not record calls; expired/ended call setup signals are purged at startup and every minute.

### Messaging motion and typing
Connection chats and active anonymous Aura Farming chats use authenticated Socket.IO typing indicators. Membership, blocks, current token version, bans and session eligibility are checked before forwarding typing; no draft text is sent or stored. Typing updates are throttled, stop on send/blur/disconnect, expire after 3.5 seconds, and rejoin rooms after reconnect. New-message entry uses short transform/opacity animations, skips initial history and receipt/reaction refreshes, and honors reduced-motion preferences. UI motion includes button feedback, dialogs, reaction pickers, navigation indicators and page/content fades. Chat headers and navigation remain fixed in place. Poll responses that overlap a local or socket update are discarded to avoid temporary message flicker. Full-stack socket integration tests use the frontend Socket.IO client, so install both frontend and backend dependencies before running the suite.

### Testing on a phone over the local network
Run the backend, then `npm run dev -- --host 0.0.0.0 --port 5173 --strictPort` in frontend. Open the computer’s LAN address on a phone connected to the same router/Wi-Fi. The frontend defaults to `/api`; Vite proxies API and Socket.IO traffic to port 5000, so phones never call their own localhost. An optional `VITE_API_URL` overrides the API base. Production hosting using the default must reverse-proxy `/api` and `/socket.io` to the backend (including WebSocket upgrades). LAN HTTP is for local testing; microphone/camera features require HTTPS on a phone, and Google sign-in requires an approved origin.

### Android test APK

The Capacitor Android project is in `frontend/android` (Android 7/API 24 minimum). Install frontend dependencies and JDK 21, accept the Android SDK license and install SDK platform 36 plus build-tools 36.0.0. Set `JAVA_HOME` and `ANDROID_HOME`, or place portable tools under `.android-tools/java/<jdk-folder>` and `.android-tools/sdk` at repository root.

From frontend, build a same-Wi-Fi test APK with `npm run android:apk -- --local-test --api=http://YOUR-PC-IP:5000/api`. For an HTTPS backend, omit `--local-test` and pass `--api=https://YOUR-SERVER/api`. The script builds web assets with that API URL, syncs Capacitor, compiles a debug-signed APK, and copies it to `artifacts/AURA-test.apk`. It writes generated SDK paths and debug network policy locally; these, SDK downloads, Gradle caches and signing keys are ignored by Git. Gradle distribution downloads are checksum-pinned.

With Vite running on the LAN, the APK is downloadable at `http://YOUR-PC-IP:5173/downloads/AURA-test.apk`. Open that link on the Android phone and allow installation from that browser if prompted. The test package ID is `com.aura.dating.test`, separate from a future production app. Keep the PC backend running on the same router. The UI is bundled inside the APK, while account data and messaging still use the configured backend. Local HTTP access and mixed content are enabled only for debug; the generated network policy limits HTTP to the selected private hostname. Release builds retain HTTPS defaults.

Camera and microphone permissions are requested by Android when used. Live calls still need real-device testing and appropriate STUN/TURN infrastructure. This test APK uses email/password; native Google sign-in needs separate Android OAuth configuration and is not enabled. The debug APK is for direct device testing, not a Play Store release. Future changes to bundled UI require rebuilding/reinstalling this APK unless an update system is separately implemented.

Migration 021 adds the religion-filter trial counter. Its 3 uses are shared across random chat and random call and consume only the selected-filter owner’s allowance, alongside the normal chat/call use. All three counters share the original fixed 24-hour window and reset together. Existing usage is preserved when upgrading the chat/call limits to 10.
