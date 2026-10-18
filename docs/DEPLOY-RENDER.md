# Deploying DebtNav on Render with Google sign-in

DebtNav runs on Render as **one Docker web service** (the API, which also serves the built app) plus a **private Postgres database**. The repo's [`render.yaml`](../render.yaml) Blueprint creates both. Expect about $13/month: Starter web service ($7) plus the smallest paid Postgres. Free plans work for a trial, but a free web service sleeps when idle and a free database is deleted after 30 days.

You do three things: create the Google OAuth client, create the Render services, and connect the two.

## 1. Choose the service name (it becomes your URL)

Render gives the service the address `https://<service-name>.onrender.com`. The Blueprint uses `debtnav`. If that name is taken, Render adds a suffix (for example `debtnav-a1b2`). Once the service exists, copy its exact URL from the top of its Render page; Google needs it in step 2.

The server uses this address automatically (Render passes it in as `RENDER_EXTERNAL_URL`), so you don't have to set `APP_ORIGIN`. Set `APP_ORIGIN` only when you add a custom domain, and then use that domain everywhere below.

## 2. Create the Google OAuth client

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project (for example "DebtNav").
2. Go to **APIs & Services → OAuth consent screen** (shown as "Google Auth Platform → Branding/Audience" in newer consoles):
   - User type **External**; app name "DebtNav"; your support email and developer contact email.
   - Scopes: DebtNav asks only for `openid` and `email`, which need no Google review.
   - While the app is in **Testing**, add your own Google account (and any testers) under **Test users**. Only those accounts can sign in.
   - To let anyone sign in, choose **Publish app**. Google then wants a home page and privacy policy link for the app.
3. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**, name "DebtNav on Render".
   - **Authorized JavaScript origins:** `https://<service-name>.onrender.com`
   - **Authorized redirect URIs:** `https://<service-name>.onrender.com/api/auth/callback`
   - Both must match exactly: `https`, no trailing slash on the origin, and the path `/api/auth/callback`.
4. Copy the **Client ID** and **Client secret**. Keep the secret private; never commit it.

For local development with real Google sign-in, also add `http://localhost:5173` and `http://localhost:5173/api/auth/callback` to the same client. Usually `npm run dev:local` (test sign-in, no Google) is simpler.

## 3. Create the Render services

### Option A: Blueprint (recommended)

1. In Render: **New → Blueprint**, connect the `BradleyE99/DebtNav` repo, branch `main`.
2. Render reads `render.yaml` and shows the web service `debtnav` and the database `debtnav-db`. It asks for `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET`; paste them from step 2. If you don't have them yet, leave them blank and add them later under the service's **Environment** tab.
3. Click **Apply**. The database is created first, then the web service builds from the `Dockerfile` (a few minutes the first time).

If you already created a web service by hand (the one whose deploy failed), delete it, or follow Option B to fix it, so you don't pay for two.

### Option B: fix the existing web service by hand

1. **New → Postgres**: name `debtnav-db`, the same region as the web service, and a paid plan for real use. When it's ready, copy its **Internal Database URL**.
2. Open the web service → **Settings**: Runtime **Docker**, Dockerfile path `./Dockerfile`, Health check path `/api/health`.
3. In **Environment**, add:
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = the Internal Database URL
   - `OIDC_CLIENT_ID` and `OIDC_CLIENT_SECRET` = from step 2
4. **Manual Deploy → Deploy latest commit.**

Without `DATABASE_URL`, the server falls back to an embedded database inside the container, and Render erases it on every deploy or restart. Always connect Postgres on Render.

## 4. Check that it works

1. In the service's **Logs**, look for:
   - `[db] applied migrations: 001_init.sql` (first deploy only) and `[db] PostgreSQL (DATABASE_URL)`
   - `[api] listening on http://localhost:10000 (serving dist)`
   - No `[auth] … not set` warning. That warning means the Google variables are missing.
2. Open `https://<service-name>.onrender.com/api/health`. It should show `{"ok":true,"db":"ok"}`.
3. Open `https://<service-name>.onrender.com`, click **Sign in with Google**, and pick your test-user account. You land in the planner.
4. Make an edit, wait for "All changes saved", reload, and sign in on another device. The plan is still there.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Deploy fails with `Cannot find module '/app/node_modules/tsx/dist/cli.mjs'` | An older Dockerfile installed without devDependencies. Fixed: `tsx` is now a production dependency. Deploy the latest `main`. |
| Google shows **Error 400: redirect_uri_mismatch** | The redirect URI in Google doesn't exactly match `https://<service-name>.onrender.com/api/auth/callback`. Copy the URL from Render, then fix it in Google Credentials (changes can take a few minutes to apply). |
| Google shows **Access blocked / app not verified** for a friend | The app is in Testing mode. Add them as a test user, or publish the app. |
| The app shows "Sign-in is not set up" | `OIDC_CLIENT_ID` or `OIDC_CLIENT_SECRET` is empty on the service. Add both and redeploy. |
| Signed in, but "Sign-in didn't work" right away | The secret is wrong or the client ID belongs to another project. Re-copy both from the same OAuth client. |
| `/api/health` shows `db: unavailable` | `DATABASE_URL` is wrong, or the database is in a different region. Use the Internal Database URL from a database in the same region. |
| First request after a while takes ~50 s | The free web plan sleeps when idle. Use Starter (`0.5c-512mb`) for an always-on app. |

## Custom domain (optional)

1. In Render: service → **Settings → Custom Domains**; add the domain and follow the DNS steps. Render issues the HTTPS certificate.
2. Set `APP_ORIGIN=https://your-domain` on the service.
3. In Google Credentials, add the new origin and `https://your-domain/api/auth/callback`.

## Backups and data deletion

The app tells users that deleted data may remain in backups for up to 7 days. Paid Render Postgres plans include automatic backups. Check the database's backup and point-in-time-recovery retention in Render, and keep it at 7 days or less, or update the wording in `src/ui/sections/DataSection.tsx`. See [BACKEND.md](BACKEND.md#backups-restore-and-retention).
