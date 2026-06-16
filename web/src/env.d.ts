/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute URL of the serverless Spotify token endpoint. Only needed when
   * the static site is hosted on a different origin than the function (e.g.
   * GitHub Pages calling a Vercel function). Defaults to "/api/spotify-token".
   */
  readonly VITE_SPOTIFY_TOKEN_ENDPOINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
