# NMLify

Static web app that converts a Spotify playlist into a Traktor crate (`.nml`)
entirely in the browser — no Python install, no `.env` file, no server. Built
with Vite + TypeScript + Vitest. An optional serverless token endpoint adds
login-free access to **public** playlists (see below). Originally shipped as the
desktop [CrateHacker](../desktop/) app, now ported to the web.

## Status

| Phase                                                       | Status      |
| ----------------------------------------------------------- | ----------- |
| PKCE auth from a static page                                | ✅ shipped   |
| Paginated playlist read                                     | ✅ shipped   |
| In-browser `.nml` load + fuzzy match + crate download       | ✅ shipped   |
| Match-review UI (pick alternates, "select top N")           | ✅ shipped   |
| Disk search for tracks not in your collection               | ✅ shipped   |
| GitHub Pages deploy                                         | ✅ shipped   |
| Login-free public playlists (serverless token endpoint)     | ✅ shipped   |

## Prerequisites

- Node.js 20 or newer (CI runs the build on Node 22).
- A Spotify account. **No** Spotify developer app required for most users —
  NMLify ships with a built-in Client ID. See below for when you need your
  own.

## Public playlists without login (optional serverless token)

Spotify's Web API needs a token for **every** request, even public playlists.
To let visitors fetch **public** playlists without logging in, NMLify ships a
tiny serverless function — [`api/spotify-token.ts`](api/spotify-token.ts) — that
mints an app-level "Client Credentials" token server-side and returns it to the
page. The Spotify **client secret stays on the server** and is never sent to the
browser; the minted token can only ever read already-public data.

The front-end tries this token first; if a playlist turns out to be private or
collaborative (Spotify replies 401/403/404), it falls back to the normal PKCE
login automatically. If the function isn't deployed, the page simply falls back
to login as before — so this is purely additive.

### Deploy the token endpoint on Vercel

1. Sign in to [vercel.com](https://vercel.com) with your GitHub account and
   **Import** the `NMLify` repo.
2. Set the project's **Root Directory** to `web` (Vercel then auto-detects Vite
   and the `api/` function).
3. Add **Environment Variables** (Project → Settings → Environment Variables):
   - `SPOTIFY_CLIENT_ID` — your Spotify app's Client ID
   - `SPOTIFY_CLIENT_SECRET` — your Spotify app's Client Secret
   - `ALLOWED_ORIGINS` *(optional)* — comma-separated origins allowed to call
     the endpoint, e.g. `https://your-app.vercel.app`. Leave unset to allow any
     origin (the token only grants access to public data either way).
4. Deploy. Every push to `main` redeploys automatically.

By default the page calls the same-origin `/api/spotify-token`, which is correct
when the whole site is hosted on Vercel. If you keep the static site on GitHub
Pages and only host the function on Vercel, set
`VITE_SPOTIFY_TOKEN_ENDPOINT` (a build-time `VITE_*` var) to the absolute Vercel
URL — see [`.env.example`](.env.example).

> **Security note:** the origin allow-list stops casual cross-site use but a
> non-browser client can spoof the `Origin` header. That's an acceptable risk
> here because the token only reaches public data and the response is edge-cached
> (`s-maxage`), so repeat calls reuse one token instead of hitting Spotify.

## Do I need my own Spotify app?

**Probably not.** NMLify ships with a built-in Spotify app and the page
uses PKCE auth, so the Client ID is safe to bundle in a static page. Just
click **Log in with Spotify** on the page.

**You will** need your own app if Spotify rejects the login. Spotify keeps
third-party apps in a restricted developer-mode whitelist (max ~25 users)
unless the developer is an organization with thousands of monthly users —
so the built-in app can only ever support a small, hand-picked group.

If you hit that wall, expand the **Use my own Spotify developer app** disclosure on
the page and:

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   and create a new app. Any name / description is fine.
2. In the app's **Settings → Basic Information → Redirect URIs**, add the
   exact URL the page shows (the **Copy** button next to it makes this
   painless). Spotify requires `127.0.0.1` (not `localhost`) for non-HTTPS
   redirects, which is what Vite serves on locally.
3. Copy the **Client ID** from your app's dashboard and paste it into the
   disclosure on the page, then click **Save**. **Do not copy the Client
   Secret** — PKCE doesn't need one.

Click **Reset to default** in the same disclosure to revert to the built-in
Client ID.

## Develop

From this `web/` folder:

```powershell
npm install
npm run dev      # http://127.0.0.1:5173/
```

Run the test suite (Vitest):

```powershell
npm test         # one-shot, used in CI
npm run test:watch
```

Build a production bundle into `dist/`:

```powershell
npm run build
npm run preview  # serves the built bundle
```

## Try it

1. Paste a Spotify playlist URL (yours or any public one) and click
   **Fetch tracks**. **Public** playlists load without any login when the
   serverless token endpoint is deployed (see above). For a **private** or
   **collaborative** playlist — or if the endpoint isn't deployed — the app
   redirects you to Spotify to approve access, then auto-fetches when you
   return. (If Spotify rejects the login, follow the **Use my own Spotify
   app** steps above first.)
2. Pick your `collection.nml` (typically in
   `Documents\Native Instruments\Traktor Pro <version>\`). The file is read
   locally in your browser — nothing is uploaded.
3. Optionally connect Traktor's generated stems folder (typically
   `Music\Traktor\Stems`). NMLify scans filenames locally and identifies
   generated stem sidecars associated with collection entries. Matches backed
   by packaged or generated stems are shown before ordinary matches.
4. Click **Match playlist against collection**. The top match per track is
   auto-picked.
5. Click **Download playlist** to save the crate, then drop it into Traktor's
   Playlists section.

## Project layout

```
web/
├── index.html          # entry HTML; Vite picks it up automatically
├── styles.css          # dark-theme styles, imported by main.ts
├── api/
│   └── spotify-token.ts  # Vercel Edge fn: app-level token for public playlists
├── src/
│   ├── main.ts         # DOM glue + init
│   ├── auth.ts         # Spotify PKCE flow + token storage
│   ├── publicToken.ts  # fetch/cache app-level token from api/spotify-token.ts
│   ├── spotify.ts      # playlist fetch (paginated)
│   ├── tokenize.ts     # ported from desktop/text_utils.py
│   ├── collectionSearch.ts  # ported from desktop/collection_search.py
│   ├── review.ts       # selection state (ported from desktop/crate.py)
│   ├── diskSearch.ts   # ported from desktop/disk_search.py
│   ├── generatedStems.ts  # AUDIO_ID sidecar paths + folder scanning
│   ├── nml.ts          # load + build .nml (browser-safe)
│   ├── nmlWriter.ts    # Node-only writer used by tests
│   └── *.test.ts       # Vitest suites mirroring the pytest suites
├── package.json
├── tsconfig.json
├── vercel.json
└── vite.config.ts
```

## Troubleshooting

- **"INVALID_CLIENT: Invalid redirect URI"** — the URL in your Spotify
  dashboard must match the one the page shows under step 1 *exactly*,
  including the trailing slash and the port.
- **CORS / network errors during token exchange** — make sure you're
  serving over `http://127.0.0.1:5173/` (Vite dev server) and not opening
  `index.html` from the file system.
- **Stuck signed-in state after changing Client IDs** — click **Log out**,
  then **Reset to default** under the **Use my own Spotify developer app** disclosure,
  then start over.
- **"Match" button stays disabled** — both a Spotify playlist and a
  `collection.nml` must be loaded before matching can run.
