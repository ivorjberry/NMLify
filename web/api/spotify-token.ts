/**
 * Vercel Edge Function: mint a short-lived Spotify "Client Credentials" token.
 *
 * This lets the static front-end read PUBLIC playlists without making the user
 * log in. The Spotify client secret lives ONLY in this server-side function
 * (as the SPOTIFY_CLIENT_SECRET env var) and is never sent to the browser —
 * the response contains just the app-level access token, which can only reach
 * already-public Spotify data.
 *
 * Hardening:
 *  - Origin allow-list (ALLOWED_ORIGINS) rejects casual cross-site/drive-by
 *    calls. It is not bulletproof — a non-browser client can spoof the Origin
 *    header — but the blast radius is limited to public data + your free-tier
 *    quota.
 *  - Edge caching (Cache-Control: s-maxage) means repeat calls reuse one token
 *    instead of hitting Spotify each time, so even abuse barely touches your
 *    real Spotify rate limits.
 *
 * Required env vars (set in the Vercel dashboard):
 *  - SPOTIFY_CLIENT_ID
 *  - SPOTIFY_CLIENT_SECRET
 * Optional env var:
 *  - ALLOWED_ORIGINS: comma-separated list of allowed origins, e.g.
 *    "https://nmlify.vercel.app,https://ivorjberry.github.io". If unset, all
 *    origins are allowed (fine for a same-origin Vercel deploy).
 */

export const config = { runtime: 'edge' };

const TOKEN_URL = 'https://accounts.spotify.com/api/token';

function allowedOrigins(): string[] {
  return (process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(origin: string): Record<string, string> {
  const allow = allowedOrigins();
  const headers: Record<string, string> = { Vary: 'Origin' };
  // Reflect the caller's origin only when it's permitted; an empty allow-list
  // means "same-origin or anyone", so reflect whatever we were given.
  if (allow.length === 0 || allow.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin || '*';
  }
  return headers;
}

function json(
  payload: unknown,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const origin = req.headers.get('origin') ?? '';
  const cors = corsHeaders(origin);

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: { ...cors, 'Access-Control-Allow-Methods': 'GET, OPTIONS' },
    });
  }

  if (req.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405, cors);
  }

  // Origin allow-list: stop casual cross-site use. Same-origin browser
  // requests omit the Origin header, so a missing origin is allowed through.
  const allow = allowedOrigins();
  if (allow.length > 0 && origin && !allow.includes(origin)) {
    return json({ error: 'Origin not allowed' }, 403, cors);
  }

  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return json({ error: 'Server not configured' }, 500, cors);
  }

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!resp.ok) {
    return json({ error: 'Token request failed' }, 502, cors);
  }

  const data = (await resp.json()) as { access_token: string; expires_in: number };

  return json({ access_token: data.access_token, expires_in: data.expires_in }, 200, {
    ...cors,
    // Cache at the edge so repeated visits reuse one app token instead of
    // re-hitting Spotify. Slightly less than the ~3600s token lifetime, with
    // a short stale window to smooth over refreshes.
    'Cache-Control': 's-maxage=3300, stale-while-revalidate=300',
  });
}
