# NMLify

Turn a Spotify playlist into a Traktor crate (`.nml`) by fuzzy-matching every
track against your local Traktor collection — and, optionally, against the
audio files sitting on your disk.

There are two flavours:

| | Hosted web app (**recommended**) | Desktop / Python version (legacy) |
|---|---|---|
| Install | Nothing — open the page in your browser | Python 3.11+, pip, a virtualenv |
| Spotify auth | PKCE in the browser (no client secret) | Client ID + secret in a `.env` |
| Privacy | Your `collection.nml` and audio files stay on your machine | Same — runs entirely locally |
| Source | [`web/`](web/) | [`desktop/`](desktop/) |

## Quick start (web)

1. Open the hosted app (link will appear here once the first GitHub Pages
   deploy lands — until then, follow the local-dev steps in
   [web/README.md](web/README.md)).
2. Click **Log in with Spotify** and approve the app. NMLify ships with a
   built-in Client ID, so most users won't need to register anything.
3. Paste a playlist URL, pick your `collection.nml`, match, and download
   the `.nml`. Drop the file into Traktor's Playlists section.

If Spotify rejects your login, the built-in app's developer-mode whitelist
doesn't include you — expand **Use my own Spotify app** on the page and
follow the short setup in [web/README.md](web/README.md#do-i-need-my-own-spotify-app).

## Self-host or hack on the web app

```powershell
cd web
npm install
npm run dev      # http://127.0.0.1:5173/
npm test
npm run build
```

CI (typecheck + Vitest + Vite build) runs on every push and PR via
[.github/workflows/web.yml](.github/workflows/web.yml). Pushes to `main` also
publish the built bundle to GitHub Pages.

## Desktop / Python version

NMLify started life as a NiceGUI desktop app called **CrateHacker**. That
original build still lives in [`desktop/`](desktop/) with its own install
guide ([desktop/INSTALL.md](desktop/INSTALL.md)) and pytest suite. It's no
longer the primary distribution, but it's there if you want a fully offline
build or prefer the native UI.

## License

[MIT](LICENSE).
