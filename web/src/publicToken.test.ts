import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// publicToken.ts keeps a module-level token cache, so each test re-imports the
// module fresh (via vi.resetModules) to start from a clean cache.
async function freshModule() {
  vi.resetModules();
  return import('./publicToken');
}

function okTokenResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('getPublicToken', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('returns the access token from a successful response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okTokenResponse({ access_token: 'tok-123', expires_in: 3600 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getPublicToken } = await freshModule();
    expect(await getPublicToken()).toBe('tok-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('caches the token and does not re-fetch within its lifetime', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okTokenResponse({ access_token: 'tok-cache', expires_in: 3600 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { getPublicToken } = await freshModule();
    await getPublicToken();
    // A short while later the cache should still be valid.
    vi.advanceTimersByTime(60_000);
    expect(await getPublicToken()).toBe('tok-cache');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('re-fetches once the cached token is near expiry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(okTokenResponse({ access_token: 'tok-old', expires_in: 3600 }))
      .mockResolvedValueOnce(okTokenResponse({ access_token: 'tok-new', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getPublicToken } = await freshModule();
    expect(await getPublicToken()).toBe('tok-old');
    // Past the (lifetime - 60s) refresh threshold.
    vi.advanceTimersByTime(3600_000);
    expect(await getPublicToken()).toBe('tok-new');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when the endpoint responds with a non-OK status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    const { getPublicToken } = await freshModule();
    expect(await getPublicToken()).toBeNull();
  });

  it('returns null when the response lacks an access token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okTokenResponse({ expires_in: 3600 })));
    const { getPublicToken } = await freshModule();
    expect(await getPublicToken()).toBeNull();
  });

  it('returns null when the fetch rejects (network error / no endpoint)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
    const { getPublicToken } = await freshModule();
    expect(await getPublicToken()).toBeNull();
  });
});
