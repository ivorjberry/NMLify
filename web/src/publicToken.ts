/**
 * Client-side helper for the "public playlist, no login" path.
 *
 * Calls our serverless token endpoint (see api/spotify-token.ts) to obtain an
 * app-level Spotify "Client Credentials" token, which can read PUBLIC playlists
 * without a user logging in. The token is cached in memory for its lifetime so
 * we don't hit the endpoint on every fetch.
 *
 * The endpoint URL defaults to the same-origin "/api/spotify-token" (correct
 * when the site is hosted on Vercel). If the static site is hosted somewhere
 * without the function (e.g. GitHub Pages), set VITE_SPOTIFY_TOKEN_ENDPOINT to
 * the absolute Vercel URL at build time. If the endpoint is missing or fails,
 * getPublicToken() resolves to null and the caller falls back to user login.
 */

const TOKEN_ENDPOINT =
  import.meta.env.VITE_SPOTIFY_TOKEN_ENDPOINT || '/api/spotify-token';

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cached: CachedToken | null = null;

interface TokenEndpointResponse {
  access_token?: string;
  expires_in?: number;
}

/**
 * Return a cached or freshly-minted public app token, or null if the endpoint
 * is unavailable (so the caller can fall back to interactive login).
 */
export async function getPublicToken(): Promise<string | null> {
  // Reuse the in-memory token until ~1 min before it expires.
  if (cached && Date.now() < cached.expiresAt - 60_000) {
    return cached.token;
  }

  try {
    const res = await fetch(TOKEN_ENDPOINT, { method: 'GET' });
    if (!res.ok) return null;
    const json = (await res.json()) as TokenEndpointResponse;
    if (!json.access_token) return null;

    cached = {
      token: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return cached.token;
  } catch {
    // Network error, no endpoint deployed, CORS rejection, etc. — the caller
    // will fall back to PKCE login.
    return null;
  }
}
