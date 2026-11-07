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
