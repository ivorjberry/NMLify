# NMLify

Static web app that converts a Spotify playlist into a Traktor crate (`.nml`)
entirely in the browser — no Python install, no `.env` file, no server. Built
with Vite + TypeScript + Vitest. Originally shipped as the desktop
[CrateHacker](../desktop/) app, now ported to the web.

## Status

| Phase                                                       | Status      |
| ----------------------------------------------------------- | ----------- |
| PKCE auth from a static page                                | ✅ shipped   |
| Paginated playlist read                                     | ✅ shipped   |
| In-browser `.nml` load + fuzzy match + crate download       | ✅ shipped   |
| Match-review UI (pick alternates, "select top N")           | ✅ shipped   |
| Disk search for tracks not in your collection               | ✅ shipped   |
| GitHub Pages deploy                                         | ✅ shipped   |

## Prerequisites

- Node.js 20 or newer (CI runs the build on Node 22).
- A Spotify account. **No** Spotify developer app required for most users —
  NMLify ships with a built-in Client ID. See below for when you need your
  own.

## Do I need my own Spotify app?

**Probably not.** NMLify ships with a built-in Spotify app and the page
uses PKCE auth, so the Client ID is safe to bundle in a static page. Just
click **Log in with Spotify** on the page.

**You will** need your own app if Spotify rejects the login. Spotify keeps
third-party apps in a restricted developer-mode whitelist (max ~25 users)
unless the developer is an organization with thousands of monthly users —
so the built-in app can only ever support a small, hand-picked group.

If you hit that wall, expand the **Use my own Spotify app** disclosure on
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

1. Click **Log in with Spotify**. Spotify will ask you to approve the app,
   then redirect you back. The auth status should switch to "Signed in".
   (If Spotify rejects the login, follow the **Use my own Spotify app**
   steps above first.)
2. Paste a Spotify playlist URL (yours or any public one) and click
   **Fetch tracks**.
3. Pick your `collection.nml` (typically in
   `Documents\Native Instruments\Traktor Pro <version>\`). The file is read
   locally in your browser — nothing is uploaded.
4. Click **Match playlist against collection**. The top match per track is
   auto-picked.
5. Click **Download .nml** to save the crate, then drop it into Traktor's
   Playlists section.

## Project layout

```
web/
├── index.html          # entry HTML; Vite picks it up automatically
├── styles.css          # dark-theme styles, imported by main.ts
├── src/
│   ├── main.ts         # DOM glue + init
│   ├── auth.ts         # Spotify PKCE flow + token storage
│   ├── spotify.ts      # playlist fetch (paginated)
│   ├── tokenize.ts     # ported from desktop/text_utils.py
│   ├── collectionSearch.ts  # ported from desktop/collection_search.py
│   ├── review.ts       # selection state (ported from desktop/crate.py)
│   ├── diskSearch.ts   # ported from desktop/disk_search.py
│   ├── nml.ts          # load + build .nml (browser-safe)
│   ├── nmlWriter.ts    # Node-only writer used by tests
│   └── *.test.ts       # Vitest suites mirroring the pytest suites
├── package.json
├── tsconfig.json
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
  then **Reset to default** under the **Use my own Spotify app** disclosure,
  then start over.
- **"Match" button stays disabled** — both a Spotify playlist and a
  `collection.nml` must be loaded before matching can run.
