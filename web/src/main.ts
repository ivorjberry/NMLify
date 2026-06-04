/**
 * CrateHacker Web — DOM glue.
 * Wires PKCE auth, playlist fetch, and the new collection-matching pipeline
 * (load .nml → fuzzy match → download crate) onto the static page.
 */
import '../styles.css';

import {
  clearAuth,
  exchangeCodeForToken,
  getExpiresAtMs,
  getStoredToken,
  getValidAccessToken,
  LS_AUTH_STATE,
  LS_CLIENT_ID,
  REDIRECT_URI,
  startLogin,
} from './auth';
import {
  buildCollectionIndex,
  fuzzySearch,
  type TokenIndex,
} from './collectionSearch';
import {
  buildNmlPlaylist,
  loadCollection,
  type NmlEntry,
  sanitizePlaylistFilename,
} from './nml';
import {
  extractPlaylistId,
  fetchPlaylist,
  type FetchedPlaylist,
  type SpotifyTrackRef,
} from './spotify';

// ---------- DOM hooks -----------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

const redirectUriDisplay = el<HTMLElement>('redirect-uri-display');
const copyRedirectUriBtn = el<HTMLButtonElement>('copy-redirect-uri-btn');
const clientIdInput = el<HTMLInputElement>('client-id-input');
const saveClientIdBtn = el<HTMLButtonElement>('save-client-id-btn');
const clearClientIdBtn = el<HTMLButtonElement>('clear-client-id-btn');
const clientIdStatus = el<HTMLElement>('client-id-status');
const loginBtn = el<HTMLButtonElement>('login-btn');
const logoutBtn = el<HTMLButtonElement>('logout-btn');
const authStatus = el<HTMLElement>('auth-status');
const playlistUrlInput = el<HTMLInputElement>('playlist-url-input');
const fetchBtn = el<HTMLButtonElement>('fetch-btn');
const playlistStatus = el<HTMLElement>('playlist-status');
const playlistInfo = el<HTMLElement>('playlist-info');
const tracksList = el<HTMLUListElement>('tracks-list');

// New Step-2 card
const collectionFileInput = el<HTMLInputElement>('collection-file-input');
const collectionStatus = el<HTMLElement>('collection-status');
const fuzzyRatioInput = el<HTMLInputElement>('fuzzy-ratio-input');
const matchBtn = el<HTMLButtonElement>('match-btn');
const matchStatus = el<HTMLElement>('match-status');
const matchedList = el<HTMLUListElement>('matched-list');
const notFoundList = el<HTMLUListElement>('not-found-list');
const downloadBtn = el<HTMLButtonElement>('download-btn');
const playlistNameInput = el<HTMLInputElement>('playlist-name-input');

redirectUriDisplay.textContent = REDIRECT_URI;

copyRedirectUriBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(REDIRECT_URI);
    copyRedirectUriBtn.textContent = 'Copied!';
    setTimeout(() => (copyRedirectUriBtn.textContent = 'Copy'), 1500);
  } catch {
    // Clipboard API can fail on insecure origins or older browsers; fall back
    // to selecting the text so the user can copy it manually.
    const range = document.createRange();
    range.selectNodeContents(redirectUriDisplay);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    copyRedirectUriBtn.textContent = 'Select & Ctrl+C';
    setTimeout(() => (copyRedirectUriBtn.textContent = 'Copy'), 2000);
  }
});

// ---------- Client ID UI --------------------------------------------------

function refreshClientIdUI(): void {
  const id = localStorage.getItem(LS_CLIENT_ID);
  if (id) {
    clientIdInput.value = id;
    clientIdStatus.textContent = `Saved (${id.slice(0, 6)}…).`;
    clientIdStatus.className = 'status ok';
  } else {
    clientIdInput.value = '';
    clientIdStatus.textContent = 'No Client ID saved yet.';
    clientIdStatus.className = 'status warn';
  }
}

saveClientIdBtn.addEventListener('click', () => {
  const value = clientIdInput.value.trim();
  if (!value) return;
  localStorage.setItem(LS_CLIENT_ID, value);
  refreshClientIdUI();
});

clearClientIdBtn.addEventListener('click', () => {
  localStorage.removeItem(LS_CLIENT_ID);
  refreshClientIdUI();
});

// ---------- Auth UI -------------------------------------------------------

function refreshAuthUI(): void {
  const token = getStoredToken();
  if (token) {
    const minutes = Math.max(0, Math.round((getExpiresAtMs() - Date.now()) / 60000));
    authStatus.textContent = `Signed in. Token valid for ~${minutes} min.`;
    authStatus.className = 'status ok';
  } else {
    authStatus.textContent = 'Not signed in.';
    authStatus.className = 'status warn';
  }
}

loginBtn.addEventListener('click', () => {
  startLogin().catch(showError);
});

logoutBtn.addEventListener('click', () => {
  clearAuth();
  refreshAuthUI();
});

// ---------- Playlist fetch ------------------------------------------------

let lastPlaylist: FetchedPlaylist | null = null;

fetchBtn.addEventListener('click', async () => {
  tracksList.innerHTML = '';
  playlistInfo.innerHTML = '';
  playlistStatus.textContent = '';
  playlistStatus.className = 'status';

  try {
    const token = await getValidAccessToken();
    if (!token) {
      playlistStatus.textContent = 'Sign in first.';
      playlistStatus.className = 'status warn';
      return;
    }
    const id = extractPlaylistId(playlistUrlInput.value.trim());
    if (!id) {
      playlistStatus.textContent = "That doesn't look like a Spotify playlist URL.";
      playlistStatus.className = 'status warn';
      return;
    }

    playlistStatus.textContent = 'Loading playlist…';

    const fetched = await fetchPlaylist(id, token, (loaded, total) => {
      playlistStatus.textContent = `Loading playlist… ${loaded}/${total}`;
    });
    lastPlaylist = fetched;

    playlistInfo.innerHTML =
      `<strong>${escapeHtml(fetched.meta.name)}</strong> by ` +
      `${escapeHtml(fetched.meta.owner.display_name)}` +
      ` — ${fetched.meta.tracks.total} tracks`;

    const frag = document.createDocumentFragment();
    for (const track of fetched.tracks) {
      const artists = track.artists.map((a) => a.name).join(', ');
      const li = document.createElement('li');
      li.textContent = `${artists} — ${track.name}`;
      frag.appendChild(li);
    }
    tracksList.appendChild(frag);

    playlistStatus.textContent = `Loaded ${fetched.tracks.length} tracks.`;
    playlistStatus.className = 'status ok';

    // Default the output crate name to the Spotify playlist name.
    if (!playlistNameInput.value.trim()) {
      playlistNameInput.value = fetched.meta.name;
    }
    refreshMatchButton();
  } catch (err) {
    showError(err);
    playlistStatus.textContent = err instanceof Error ? err.message : String(err);
    playlistStatus.className = 'status err';
  }
});

// ---------- Collection load + match --------------------------------------

let loadedCollection: NmlEntry[] | null = null;
let collectionIndex: { titleIndex: TokenIndex; artistIndex: TokenIndex } | null = null;
let matchedEntries: NmlEntry[] = [];

collectionFileInput.addEventListener('change', async () => {
  const file = collectionFileInput.files?.[0];
  if (!file) return;
  collectionStatus.textContent = `Reading ${file.name}…`;
  collectionStatus.className = 'status';
  try {
    const xml = await file.text();
    const entries = loadCollection(xml);
    loadedCollection = entries;
    collectionIndex = buildCollectionIndex(entries);
    collectionStatus.textContent = `Loaded ${entries.length} entries from ${file.name}.`;
    collectionStatus.className = 'status ok';
    refreshMatchButton();
  } catch (err) {
    loadedCollection = null;
    collectionIndex = null;
    collectionStatus.textContent =
      err instanceof Error ? `Failed to load: ${err.message}` : 'Failed to load collection.';
    collectionStatus.className = 'status err';
    refreshMatchButton();
  }
});

function refreshMatchButton(): void {
  matchBtn.disabled = !(loadedCollection && lastPlaylist);
  downloadBtn.disabled = matchedEntries.length === 0;
}

matchBtn.addEventListener('click', () => {
  matchedList.innerHTML = '';
  notFoundList.innerHTML = '';
  matchedEntries = [];
  refreshMatchButton();

  if (!loadedCollection || !collectionIndex || !lastPlaylist) {
    matchStatus.textContent = 'Load a collection and fetch a playlist first.';
    matchStatus.className = 'status warn';
    return;
  }

  const ratio = clampRatio(parseInt(fuzzyRatioInput.value, 10));
  fuzzyRatioInput.value = String(ratio);

  const playlistForSearch = {
    items: lastPlaylist.tracks.map((t: SpotifyTrackRef) => ({ track: t })),
  };

  matchStatus.textContent = 'Matching…';
  matchStatus.className = 'status';

  // Run in a microtask break so the status text repaints before the (sync)
  // search loop starts. For real-collection sizes this finishes well under
  // a second so a worker isn't worth the complexity yet.
  setTimeout(() => {
    const { groupedResults, notFoundTracks } = fuzzySearch(
      playlistForSearch,
      loadedCollection!,
      ratio,
      { titleIndex: collectionIndex!.titleIndex, artistIndex: collectionIndex!.artistIndex },
    );

    // For Step 2 we auto-pick the top match per track. Step 3 will swap this
    // for a review dialog so the user can pick alternates.
    const matchedFrag = document.createDocumentFragment();
    for (const group of groupedResults.values()) {
      const top = group.collection_matches[0];
      if (!top) continue;
      matchedEntries.push(top.entry);
      const li = document.createElement('li');
      const title = (top.entry['@TITLE'] as string | undefined) ?? '(no title)';
      const artist = (top.entry['@ARTIST'] as string | undefined) ?? '(unknown)';
      li.textContent =
        `${group.spotify_artists} — ${group.spotify_track.name}  →  ` +
        `${artist} — ${title}  (score ${top.score})`;
      matchedFrag.appendChild(li);
    }
    matchedList.appendChild(matchedFrag);

    const nfFrag = document.createDocumentFragment();
    for (const line of notFoundTracks) {
      const li = document.createElement('li');
      li.textContent = line;
      nfFrag.appendChild(li);
    }
    notFoundList.appendChild(nfFrag);

    matchStatus.textContent =
      `Matched ${matchedEntries.length} of ${matchedEntries.length + notFoundTracks.length} tracks.`;
    matchStatus.className = matchedEntries.length > 0 ? 'status ok' : 'status warn';
    refreshMatchButton();
  }, 0);
});

downloadBtn.addEventListener('click', () => {
  if (matchedEntries.length === 0) return;
  const name = playlistNameInput.value.trim() || 'CrateHacker Playlist';
  const xml = buildNmlPlaylist(name, matchedEntries);
  const safeName = sanitizePlaylistFilename(name);
  triggerDownload(`${safeName}.nml`, xml);
});

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 70;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function triggerDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// ---------- Misc ----------------------------------------------------------

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&#39;';
      default: return c;
    }
  });
}

function showError(err: unknown): void {
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  alert(message);
}

// ---------- Startup: handle redirect back from Spotify --------------------

(async function init(): Promise<void> {
  refreshClientIdUI();

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const returnedState = params.get('state');
  const error = params.get('error');

  if (error) {
    authStatus.textContent = `Spotify returned error: ${error}`;
    authStatus.className = 'status err';
    history.replaceState({}, '', REDIRECT_URI);
  } else if (code) {
    const expectedState = localStorage.getItem(LS_AUTH_STATE);
    localStorage.removeItem(LS_AUTH_STATE);
    if (!expectedState || returnedState !== expectedState) {
      showError(new Error('OAuth state mismatch — possible CSRF. Aborting.'));
    } else {
      try {
        await exchangeCodeForToken(code);
      } catch (e) {
        showError(e);
      }
    }
    history.replaceState({}, '', REDIRECT_URI);
  }

  refreshAuthUI();
  refreshMatchButton();
})();
