/**
 * Spotify Authorization Code + PKCE flow for a static page (no client secret).
 * All state lives in localStorage so the redirect round-trip survives reloads.
 */

export const SCOPES = 'playlist-read-private playlist-read-collaborative';
export const AUTH_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';

// Redirect URI is computed at runtime so the same code works on 127.0.0.1
// during development and on GitHub Pages in production. The user must
// register every host they use in their Spotify app settings.
export const REDIRECT_URI = window.location.origin + window.location.pathname;

export const LS_CLIENT_ID = 'nmlifyClientId';
export const LS_ACCESS_TOKEN = 'nmlifyAccessToken';
export const LS_REFRESH_TOKEN = 'nmlifyRefreshToken';
export const LS_EXPIRES_AT = 'nmlifyExpiresAt';
export const LS_CODE_VERIFIER = 'nmlifyCodeVerifier';
export const LS_AUTH_STATE = 'nmlifyAuthState';

// ---------- PKCE helpers --------------------------------------------------

export function generateRandomString(length: number): string {
  // RFC 7636 allows [A-Z][a-z][0-9]-._~ in the verifier. We use the subset
  // [A-Za-z0-9] which is the safe lowest common denominator.
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const random = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(random, (x) => charset[x % charset.length]).join('');
}

async function sha256(plain: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

function base64urlencode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export async function makeCodeChallenge(verifier: string): Promise<string> {
  return base64urlencode(await sha256(verifier));
}

// ---------- Token storage -------------------------------------------------

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

function storeTokenResponse(json: TokenResponse): void {
  localStorage.setItem(LS_ACCESS_TOKEN, json.access_token);
  if (json.refresh_token) localStorage.setItem(LS_REFRESH_TOKEN, json.refresh_token);
  localStorage.setItem(LS_EXPIRES_AT, String(Date.now() + json.expires_in * 1000));
}

export function getStoredToken(): string | null {
  const token = localStorage.getItem(LS_ACCESS_TOKEN);
  const expiresAt = parseInt(localStorage.getItem(LS_EXPIRES_AT) || '0', 10);
  if (!token || Date.now() >= expiresAt) return null;
  return token;
}

export function getExpiresAtMs(): number {
  return parseInt(localStorage.getItem(LS_EXPIRES_AT) || '0', 10);
}

export function clearAuth(): void {
  for (const key of [LS_ACCESS_TOKEN, LS_REFRESH_TOKEN, LS_EXPIRES_AT, LS_CODE_VERIFIER, LS_AUTH_STATE]) {
    localStorage.removeItem(key);
  }
}

// ---------- OAuth steps ---------------------------------------------------

export async function startLogin(): Promise<void> {
  const clientId = localStorage.getItem(LS_CLIENT_ID);
  if (!clientId) {
    throw new Error('Save your Spotify Client ID first.');
  }
  const verifier = generateRandomString(64);
  const challenge = await makeCodeChallenge(verifier);
  const state = generateRandomString(16);
  localStorage.setItem(LS_CODE_VERIFIER, verifier);
  localStorage.setItem(LS_AUTH_STATE, state);

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
  });
  window.location.assign(`${AUTH_URL}?${params.toString()}`);
}

export async function exchangeCodeForToken(code: string): Promise<void> {
  const clientId = localStorage.getItem(LS_CLIENT_ID);
  const verifier = localStorage.getItem(LS_CODE_VERIFIER);
  if (!clientId || !verifier) throw new Error('Missing Client ID or PKCE verifier.');

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as TokenResponse;
  storeTokenResponse(json);
  localStorage.removeItem(LS_CODE_VERIFIER);
}

export async function refreshAccessToken(): Promise<string | null> {
  const clientId = localStorage.getItem(LS_CLIENT_ID);
  const refreshToken = localStorage.getItem(LS_REFRESH_TOKEN);
  if (!clientId || !refreshToken) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) return null;
  const json = (await res.json()) as TokenResponse;
  storeTokenResponse(json);
  return json.access_token;
}

export async function getValidAccessToken(): Promise<string | null> {
  return getStoredToken() ?? (await refreshAccessToken());
}
