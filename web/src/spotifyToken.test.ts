import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import handler from '../api/spotify-token';

function req(method: string, headers: Record<string, string> = {}): Request {
  return new Request('https://nmlify.test/api/spotify-token', { method, headers });
}

describe('spotify-token edge handler', () => {
  beforeEach(() => {
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'id-abc');
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'secret-xyz');
    vi.stubEnv('ALLOWED_ORIGINS', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('answers CORS preflight (OPTIONS) with 204 and allowed methods', async () => {
    const res = await handler(req('OPTIONS'));
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });

  it('rejects non-GET methods with 405', async () => {
    const res = await handler(req('POST'));
    expect(res.status).toBe(405);
  });

  it('rejects a disallowed origin with 403', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'https://allowed.example');
    const res = await handler(req('GET', { origin: 'https://evil.example' }));
    expect(res.status).toBe(403);
  });

  it('allows an origin that is on the allow-list', async () => {
    vi.stubEnv('ALLOWED_ORIGINS', 'https://allowed.example');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 }),
      ),
    );
    const res = await handler(req('GET', { origin: 'https://allowed.example' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example');
  });

  it('returns 500 when server credentials are not configured', async () => {
    vi.stubEnv('SPOTIFY_CLIENT_ID', '');
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', '');
    const res = await handler(req('GET'));
    expect(res.status).toBe(500);
  });

  it('mints a token and sets an edge-cache header on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ access_token: 'tok-live', expires_in: 3600 }), { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const res = await handler(req('GET'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { access_token: string; expires_in: number };
    expect(body.access_token).toBe('tok-live');
    expect(body.expires_in).toBe(3600);
    expect(res.headers.get('Cache-Control')).toContain('s-maxage');

    // The secret must be POSTed to Spotify, never returned to the caller.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain('secret-xyz');
  });

  it('returns 502 when Spotify rejects the token request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('bad', { status: 400 })));
    const res = await handler(req('GET'));
    expect(res.status).toBe(502);
  });
});
