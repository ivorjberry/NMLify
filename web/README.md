# CrateHacker Web

Static web port of [CrateHacker](../CrateHacker/). Converts a Spotify playlist
into a Traktor crate (`.nml`) entirely in the browser — no Python install, no
`.env` file, no server. Built with Vite + TypeScript + Vitest.

## Status

| Phase                                                       | Status      |
| ----------------------------------------------------------- | ----------- |
| PKCE auth from a static page                                | ✅ shipped   |
| Paginated playlist read                                     | ✅ shipped   |
| In-browser `.nml` load + fuzzy match + crate download       | ✅ shipped   |
| Match-review dialog (pick alternates, "select top N")       | ⏳ next      |
| Disk search via the File System Access API                  | ⏳ later     |
| GitHub Pages deploy                                         | ⏳ later     |

## Prerequisites

- Node.js 20 or newer (CI tests on 20 and 22).
- A Spotify developer app (free, see below).

## One-time Spotify dashboard setup

1. Go to the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   and create a new app. Any name / description is fine.
2. In the app's **Settings → Basic Information → Redirect URIs**, add this
   exact URL:

   ```
   http://127.0.0.1:5173/
   ```

   (Use `127.0.0.1`, not `localhost` — Spotify only allows the literal
   loopback IP for non-HTTPS redirects.) When we deploy to GitHub Pages
   you'll add that URL here too.
3. Copy the **Client ID** from the dashboard. **Do not copy the Client
   Secret** — PKCE doesn't need it and shipping one in a static page
   would be a leak.

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

1. Paste your **Client ID** into step 1 of the page and click **Save**.
2. Click **Log in with Spotify**. Spotify will ask you to approve the app,
   then redirect you back. The auth status should switch to "Signed in".
3. Paste a Spotify playlist URL (yours or any public one) and click
   **Fetch tracks**.
4. Pick your `collection.nml` (typically in
   `Documents\Native Instruments\Traktor Pro <version>\`). The file is read
   locally in your browser — nothing is uploaded.
5. Click **Match playlist against collection**. The top match per track is
   auto-picked.
6. Click **Download .nml** to save the crate, then drop it into Traktor's
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
│   ├── tokenize.ts     # ported from CrateHacker/text_utils.py
│   ├── collectionSearch.ts  # ported from CrateHacker/collection_search.py
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
  then **Clear** under the Client ID box, then start over.
- **"Match" button stays disabled** — both a Spotify playlist and a
  `collection.nml` must be loaded before matching can run.
