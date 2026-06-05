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
  buildFileIndex,
  type DiskFile,
  type DiskFileIndex,
  diskMatchToEntry,
  fuzzyMatchFiles,
  scanFileList,
} from './diskSearch';
import {
  buildNmlPlaylist,
  loadCollection,
  type NmlEntry,
  sanitizePlaylistFilename,
} from './nml';
import {
  buildReviewGroups,
  collectSelectedEntries,
  deselectAll,
  type ReviewGroup,
  selectAll,
  selectTopN,
  setCandidateSelected,
  summarize,
} from './review';
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

// Step-3 review card
const collectionFileInput = el<HTMLInputElement>('collection-file-input');
const collectionStatus = el<HTMLElement>('collection-status');
const fuzzyRatioInput = el<HTMLInputElement>('fuzzy-ratio-input');
const matchBtn = el<HTMLButtonElement>('match-btn');
const matchStatus = el<HTMLElement>('match-status');
const reviewToolbar = el<HTMLElement>('review-toolbar');
const reviewSummary = el<HTMLElement>('review-summary');
const reviewGroupsContainer = el<HTMLElement>('review-groups');
const selectFirstBtn = el<HTMLButtonElement>('select-first-btn');
const selectAllBtn = el<HTMLButtonElement>('select-all-btn');
const deselectAllBtn = el<HTMLButtonElement>('deselect-all-btn');
const selectTopNBtn = el<HTMLButtonElement>('select-top-n-btn');
const topNInput = el<HTMLInputElement>('top-n-input');
const notFoundSection = el<HTMLElement>('not-found-section');
const notFoundList = el<HTMLUListElement>('not-found-list');
const downloadBtn = el<HTMLButtonElement>('download-btn');
const playlistNameInput = el<HTMLInputElement>('playlist-name-input');

// Step-5 disk search card
const diskSection = el<HTMLElement>('disk-section');
const diskRootInput = el<HTMLInputElement>('disk-root-input');
const diskDirInput = el<HTMLInputElement>('disk-dir-input');
const diskScanStatus = el<HTMLElement>('disk-scan-status');
const diskRatioInput = el<HTMLInputElement>('disk-ratio-input');
const diskMatchBtn = el<HTMLButtonElement>('disk-match-btn');
const diskMatchStatus = el<HTMLElement>('disk-match-status');
const diskToolbar = el<HTMLElement>('disk-toolbar');
const diskSummaryEl = el<HTMLElement>('disk-summary');
const diskGroupsContainer = el<HTMLElement>('disk-groups');
const diskSelectFirstBtn = el<HTMLButtonElement>('disk-select-first-btn');
const diskSelectAllBtn = el<HTMLButtonElement>('disk-select-all-btn');
const diskDeselectAllBtn = el<HTMLButtonElement>('disk-deselect-all-btn');
const diskSelectTopNBtn = el<HTMLButtonElement>('disk-select-top-n-btn');
const diskTopNInput = el<HTMLInputElement>('disk-top-n-input');

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
let notFoundFromMatch: string[] = [];
let diskFileIndex: DiskFileIndex | null = null;

interface ReviewView {
  groups: ReviewGroup[];
  container: HTMLElement;
  toolbar: HTMLElement;
  summary: HTMLElement;
  /** Short unique id used in checkbox data attributes (`data-scope`). */
  scope: string;
  /** Optional label fragment for the per-track summary. */
  summaryNoun: string;
}

const collectionView: ReviewView = {
  groups: [],
  container: reviewGroupsContainer,
  toolbar: reviewToolbar,
  summary: reviewSummary,
  scope: 'col',
  summaryNoun: 'collection match',
};

const diskView: ReviewView = {
  groups: [],
  container: diskGroupsContainer,
  toolbar: diskToolbar,
  summary: diskSummaryEl,
  scope: 'disk',
  summaryNoun: 'disk match',
};

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
  downloadBtn.disabled = totalSelected() === 0;
}

function totalSelected(): number {
  return summarize(collectionView.groups).selected + summarize(diskView.groups).selected;
}

function resetCollectionReview(): void {
  collectionView.groups = [];
  collectionView.container.innerHTML = '';
  collectionView.toolbar.classList.add('hidden');
  collectionView.summary.textContent = '';
  notFoundList.innerHTML = '';
  notFoundSection.classList.add('hidden');
  notFoundFromMatch = [];
}

function resetDiskReview(): void {
  diskView.groups = [];
  diskView.container.innerHTML = '';
  diskView.toolbar.classList.add('hidden');
  diskView.summary.textContent = '';
  diskMatchStatus.textContent = '';
  diskMatchStatus.className = 'status';
}

matchBtn.addEventListener('click', () => {
  resetCollectionReview();
  resetDiskReview();
  diskSection.classList.add('hidden');
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

    collectionView.groups = buildReviewGroups(groupedResults);
    selectTopN(collectionView.groups, 1);
    renderReview(collectionView);

    notFoundFromMatch = notFoundTracks.slice();
    if (notFoundFromMatch.length > 0) {
      const frag = document.createDocumentFragment();
      for (const line of notFoundFromMatch) {
        const li = document.createElement('li');
        li.textContent = line;
        frag.appendChild(li);
      }
      notFoundList.appendChild(frag);
      notFoundSection.classList.remove('hidden');
      diskSection.classList.remove('hidden');
      refreshDiskMatchButton();
    }

    const total = collectionView.groups.length + notFoundFromMatch.length;
    matchStatus.textContent =
      `Matched ${collectionView.groups.length} of ${total} tracks. Review and download below.`;
    matchStatus.className = collectionView.groups.length > 0 ? 'status ok' : 'status warn';
    refreshMatchButton();
  }, 0);
});

// ---------- Review rendering (shared between collection + disk views) ----

function renderReview(view: ReviewView): void {
  view.container.innerHTML = '';
  if (view.groups.length === 0) {
    view.toolbar.classList.add('hidden');
    view.summary.textContent = '';
    return;
  }
  view.toolbar.classList.remove('hidden');

  const frag = document.createDocumentFragment();
  for (let gi = 0; gi < view.groups.length; gi += 1) {
    frag.appendChild(renderGroup(view, gi));
  }
  view.container.appendChild(frag);
  updateSummary(view);
}

function renderGroup(view: ReviewView, groupIndex: number): HTMLElement {
  const group = view.groups[groupIndex]!;
  const wrap = document.createElement('div');
  wrap.className = 'review-group';

  const header = document.createElement('div');
  header.className = 'review-group-header';
  header.textContent =
    `${group.spotifyArtists} — ${group.spotifyTitle}  ` +
    `(${group.candidates.length} match${group.candidates.length === 1 ? '' : 'es'})`;
  wrap.appendChild(header);

  const list = document.createElement('ul');
  list.className = 'review-candidates';
  for (let ci = 0; ci < group.candidates.length; ci += 1) {
    list.appendChild(renderCandidate(view, groupIndex, ci));
  }
  wrap.appendChild(list);
  return wrap;
}

function renderCandidate(view: ReviewView, groupIndex: number, candidateIndex: number): HTMLLIElement {
  const group = view.groups[groupIndex]!;
  const match = group.candidates[candidateIndex]!;
  const entry = match.entry;
  const title = (entry['@TITLE'] as string | undefined) ?? '(no title)';
  const artist = (entry['@ARTIST'] as string | undefined) ?? '(unknown)';
  const loc = entry.LOCATION;
  const path = `${loc['@VOLUME'] ?? ''}${loc['@DIR'] ?? ''}${loc['@FILE'] ?? ''}`;

  const li = document.createElement('li');
  li.className = 'review-candidate';

  const label = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = group.selected[candidateIndex] === true;
  cb.dataset.scope = view.scope;
  cb.dataset.group = String(groupIndex);
  cb.dataset.candidate = String(candidateIndex);
  cb.addEventListener('change', () => {
    setCandidateSelected(group, candidateIndex, cb.checked);
    updateSummary(view);
    refreshMatchButton();
  });
  label.appendChild(cb);

  const text = document.createElement('span');
  text.className = 'review-candidate-text';
  text.innerHTML =
    `<strong>${escapeHtml(artist)} — ${escapeHtml(title)}</strong> ` +
    `<span class="score">score ${match.score}</span>` +
    `<br><span class="path">${escapeHtml(path)}</span>`;
  label.appendChild(text);

  li.appendChild(label);
  return li;
}

function updateSummary(view: ReviewView): void {
  const s = summarize(view.groups);
  const trackNoun = `Spotify track${s.groups === 1 ? '' : 's'}`;
  view.summary.textContent =
    `Selected ${s.selected} of ${s.candidates} ${view.summaryNoun}${s.candidates === 1 ? '' : 'es'} ` +
    `across ${s.groups} ${trackNoun}.`;
}

function syncCheckboxes(view: ReviewView): void {
  const boxes = view.container.querySelectorAll<HTMLInputElement>(
    `input[type="checkbox"][data-scope="${view.scope}"]`,
  );
  boxes.forEach((cb) => {
    const gi = Number(cb.dataset.group);
    const ci = Number(cb.dataset.candidate);
    const group = view.groups[gi];
    if (!group) return;
    cb.checked = group.selected[ci] === true;
  });
  updateSummary(view);
  refreshMatchButton();
}

// ---------- Collection-review toolbar -----------------------------------

selectFirstBtn.addEventListener('click', () => {
  selectTopN(collectionView.groups, 1);
  syncCheckboxes(collectionView);
});

selectAllBtn.addEventListener('click', () => {
  selectAll(collectionView.groups);
  syncCheckboxes(collectionView);
});

deselectAllBtn.addEventListener('click', () => {
  deselectAll(collectionView.groups);
  syncCheckboxes(collectionView);
});

selectTopNBtn.addEventListener('click', () => {
  const n = clampTopN(parseInt(topNInput.value, 10));
  topNInput.value = String(n);
  selectTopN(collectionView.groups, n);
  syncCheckboxes(collectionView);
});

// ---------- Disk search --------------------------------------------------

function refreshDiskMatchButton(): void {
  diskMatchBtn.disabled =
    !diskFileIndex ||
    diskFileIndex.files.length === 0 ||
    notFoundFromMatch.length === 0 ||
    diskRootInput.value.trim().length === 0;
}

diskRootInput.addEventListener('input', refreshDiskMatchButton);

diskDirInput.addEventListener('change', () => {
  const files = diskDirInput.files;
  if (!files || files.length === 0) {
    diskFileIndex = null;
    diskScanStatus.textContent = '';
    diskScanStatus.className = 'status';
    refreshDiskMatchButton();
    return;
  }
  diskScanStatus.textContent = 'Indexing files…';
  diskScanStatus.className = 'status';
  // Browsers expose webkitRelativePath on each File; iterate the FileList.
  const scannable: DiskFile[] = scanFileList(
    Array.from(files).map((f) => ({
      name: f.name,
      webkitRelativePath: f.webkitRelativePath,
    })),
  );
  diskFileIndex = buildFileIndex(scannable);
  diskScanStatus.textContent =
    `Indexed ${scannable.length} audio file${scannable.length === 1 ? '' : 's'} ` +
    `(of ${files.length} total in folder).`;
  diskScanStatus.className = scannable.length > 0 ? 'status ok' : 'status warn';
  refreshDiskMatchButton();
});

diskMatchBtn.addEventListener('click', () => {
  diskView.groups = [];
  diskView.container.innerHTML = '';
  diskView.toolbar.classList.add('hidden');
  if (!diskFileIndex || notFoundFromMatch.length === 0) {
    diskMatchStatus.textContent = 'Scan a folder and run the main match first.';
    diskMatchStatus.className = 'status warn';
    return;
  }

  const ratio = clampRatio(parseInt(diskRatioInput.value, 10));
  diskRatioInput.value = String(ratio);
  const rootPrefix = diskRootInput.value.trim();

  diskMatchStatus.textContent = 'Searching disk…';
  diskMatchStatus.className = 'status';

  setTimeout(() => {
    const hits = fuzzyMatchFiles(notFoundFromMatch, diskFileIndex!, ratio);
    const groups: ReviewGroup[] = [];
    for (const [trackStr, matches] of hits) {
      const sep = trackStr.indexOf(' - ');
      const artists = sep > 0 ? trackStr.slice(0, sep).trim() : '';
      const title = sep > 0 ? trackStr.slice(sep + 3).trim() : trackStr;
      groups.push({
        spotifyKey: trackStr,
        spotifyArtists: artists,
        spotifyTitle: title,
        candidates: matches.map((m) => ({
          entry: diskMatchToEntry(rootPrefix, m.file, trackStr),
          score: m.score,
        })),
        selected: matches.map((_, i) => i === 0),
      });
    }
    diskView.groups = groups;
    renderReview(diskView);

    diskMatchStatus.textContent =
      `Found disk matches for ${groups.length} of ${notFoundFromMatch.length} not-found tracks.`;
    diskMatchStatus.className = groups.length > 0 ? 'status ok' : 'status warn';
    refreshMatchButton();
  }, 0);
});

diskSelectFirstBtn.addEventListener('click', () => {
  selectTopN(diskView.groups, 1);
  syncCheckboxes(diskView);
});

diskSelectAllBtn.addEventListener('click', () => {
  selectAll(diskView.groups);
  syncCheckboxes(diskView);
});

diskDeselectAllBtn.addEventListener('click', () => {
  deselectAll(diskView.groups);
  syncCheckboxes(diskView);
});

diskSelectTopNBtn.addEventListener('click', () => {
  const n = clampTopN(parseInt(diskTopNInput.value, 10));
  diskTopNInput.value = String(n);
  selectTopN(diskView.groups, n);
  syncCheckboxes(diskView);
});

// ---------- Download -----------------------------------------------------

downloadBtn.addEventListener('click', () => {
  const entries = [
    ...collectSelectedEntries(collectionView.groups),
    ...collectSelectedEntries(diskView.groups),
  ];
  if (entries.length === 0) return;
  const name = playlistNameInput.value.trim() || 'CrateHacker Playlist';
  const xml = buildNmlPlaylist(name, entries);
  const safeName = sanitizePlaylistFilename(name);
  triggerDownload(`${safeName}.nml`, xml);
});

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 70;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function clampTopN(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(20, Math.max(1, Math.round(value)));
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
