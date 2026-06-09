/**
 * NMLify — DOM glue.
 * Wires PKCE auth, playlist fetch, and the new collection-matching pipeline
 * (load .nml → fuzzy match → download crate) onto the static page.
 */
import '../styles.css';

import {
  clearAuth,
  DEFAULT_CLIENT_ID,
  exchangeCodeForToken,
  getExpiresAtMs,
  getStoredToken,
  getValidAccessToken,
  isUsingDefaultClientId,
  LS_AUTH_STATE,
  LS_CLIENT_ID,
  REDIRECT_URI,
  startLogin,
} from './auth';
import {
  backupDownloadFilename,
  type BackupMeta,
  deleteBackup,
  formatBytes,
  formatRelativeTime,
  isBackupsSupported,
  listBackups,
  requestPersistentStorage,
  restoreBackup,
  saveBackup,
} from './backups';
import {
  buildCollectionIndex,
  fuzzySearch,
  type TokenIndex,
} from './collectionSearch';
import {
  buildFileIndex,
  collectAudioFilesFromHandle,
  type DiskFile,
  type DiskFileIndex,
  diskMatchToEntry,
  fuzzyMatchFiles,
  scanFileList,
  type WalkableDirectoryHandle,
} from './diskSearch';
import {
  addSource as addSourceRecord,
  type DiskSourceKind,
  type DiskSourceRecord,
  isSourcesSupported,
  listSources,
  removeSource as removeSourceRecord,
  updateSource as updateSourceRecord,
} from './diskSources';
import {
  type CrateMeta,
  type CrateSource,
  deleteCrate,
  isCratesSupported,
  listCrates,
  restoreCrate,
  saveCrate,
} from './crates';
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
const diskSourcesList = el<HTMLOListElement>('disk-sources-list');
const diskSourcesEmpty = el<HTMLElement>('disk-sources-empty');
const diskAddSourceBtn = el<HTMLButtonElement>('disk-add-source-btn');
const diskAddSourceHint = el<HTMLElement>('disk-add-source-hint');
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

// Step-6 backups card
const backupsStatus = el<HTMLElement>('backups-status');
const backupsList = el<HTMLOListElement>('backups-list');

// Step-7 crate history card
const cratesStatus = el<HTMLElement>('crates-status');
const cratesList = el<HTMLOListElement>('crates-list');

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
    clientIdStatus.textContent = `Using your own Client ID (${id.slice(0, 6)}…).`;
    clientIdStatus.className = 'status ok';
  } else {
    clientIdInput.value = '';
    clientIdStatus.textContent = `Using the built-in default (${DEFAULT_CLIENT_ID.slice(0, 6)}…).`;
    clientIdStatus.className = 'status';
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
let lastPlaylistUrl: string | null = null;

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
    lastPlaylistUrl = playlistUrlInput.value.trim() || null;

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
    // Fire-and-forget snapshot; never block the matching flow on it.
    void snapshotCollection(xml, file.name, entries.length);
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
  // Step 5 stays visible at all times now -- gating happens at the button
  // level via refreshDiskMatchButton(). Hiding the section here was a
  // leftover from the earlier 'reveal-on-miss' design and made the disk
  // search disappear after every Match click.
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
    }
    refreshDiskMatchButton();

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
//
// State model:
//
//   sources: ordered list of InMemorySource — one per folder the user has
//   added. Each carries its own DiskFile[] (scanned filenames) plus the
//   metadata persisted in IDB. The combined fuzzy index is rebuilt from
//   `sources.flatMap(s => s.files)` whenever a source is added, removed,
//   rescanned, or has its rootPrefix edited. Storing rootPrefix on each
//   DiskFile means the combined index can span multiple drives without
//   any per-source bookkeeping at match time.
//
//   Persistence: every UI-visible change goes through diskSources.ts so
//   reloads come back to the same list. FSA handles are stored as
//   structured clones inside IDB; on reload we call queryPermission and
//   either auto-rescan ('granted') or show a "Grant access" button.
//   Fallback (Firefox/Safari) sources can't persist a handle, so the
//   user re-picks once per session and we remember the displayName +
//   rootPrefix as a hint.

interface InMemorySource {
  recordId: number;
  kind: DiskSourceKind;
  displayName: string;
  rootPrefix: string;
  handle: FileSystemDirectoryHandle | null;
  files: DiskFile[];
  /** Last-known FSA permission state — used to show "Grant access" UI. */
  permission: 'granted' | 'denied' | 'prompt' | 'unknown';
  /** True while a scan / permission request is in flight. */
  busy: boolean;
  /** Human-readable status for this row (empty if nothing to say). */
  rowStatus: string;
  rowStatusKind: '' | 'ok' | 'warn' | 'err';
}

const sources: InMemorySource[] = [];
let combinedIndex: DiskFileIndex | null = null;

// Feature-detect the File System Access API. Chromium-family browsers
// get a proper "grant read access" prompt (no scary "upload N files"
// dialog) and we can persist the handle. Firefox/Safari fall back to a
// per-row `<input type="file" webkitdirectory>` that has to be re-picked
// each session.
const supportsFsAccess = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
if (!supportsFsAccess) {
  diskAddSourceHint.textContent =
    'Firefox/Safari will show a one-time "upload N files" confirmation when you pick a large folder — nothing is uploaded.';
}

type FsAccessWindow = Window & {
  showDirectoryPicker: (opts?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>;
};

/** Bridge from the lib.dom FileSystemDirectoryHandle to our structural
 *  WalkableDirectoryHandle. They're the same thing at runtime; the cast
 *  just isolates us from minor lib.dom version drift. */
function asWalkable(h: FileSystemDirectoryHandle): WalkableDirectoryHandle {
  return h as unknown as WalkableDirectoryHandle;
}

interface PermissionHandle extends FileSystemDirectoryHandle {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
}

async function checkPermission(handle: FileSystemDirectoryHandle): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  const ph = handle as PermissionHandle;
  if (typeof ph.queryPermission !== 'function') return 'unknown';
  try {
    return await ph.queryPermission({ mode: 'read' });
  } catch {
    return 'unknown';
  }
}

async function requestPermission(handle: FileSystemDirectoryHandle): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  const ph = handle as PermissionHandle;
  if (typeof ph.requestPermission !== 'function') return 'unknown';
  try {
    return await ph.requestPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
}

function rebuildCombinedIndex(): void {
  const all: DiskFile[] = sources.flatMap((s) => s.files);
  combinedIndex = all.length > 0 ? buildFileIndex(all) : null;
}

function totalSourceFiles(): number {
  return sources.reduce((sum, s) => sum + s.files.length, 0);
}

function refreshDiskMatchButton(): void {
  // Require: at least one source has scanned files, no source with files
  // has an empty rootPrefix (otherwise we can't build a Traktor LOCATION),
  // and there are not-found tracks from the collection match to search for.
  const haveFiles = totalSourceFiles() > 0;
  const allPrefixed = sources.every((s) => s.files.length === 0 || s.rootPrefix.trim().length > 0);
  diskMatchBtn.disabled = !haveFiles || !allPrefixed || notFoundFromMatch.length === 0;
}

function setSourceStatus(source: InMemorySource, msg: string, kind: InMemorySource['rowStatusKind']): void {
  source.rowStatus = msg;
  source.rowStatusKind = kind;
}

/** Replace each file's rootPrefix in place so a prefix edit doesn't
 *  require a rescan. Safe because files were originally pushed with the
 *  source's then-current prefix. */
function restampSourcePrefix(source: InMemorySource, newPrefix: string): void {
  source.rootPrefix = newPrefix;
  for (const f of source.files) f.rootPrefix = newPrefix;
}

async function scanSource(source: InMemorySource): Promise<void> {
  if (!source.handle) {
    setSourceStatus(source, 'No folder handle — re-pick the folder.', 'warn');
    renderSources();
    return;
  }
  source.busy = true;
  setSourceStatus(source, 'Scanning…', '');
  renderSources();
  try {
    const scanned = await collectAudioFilesFromHandle(
      asWalkable(source.handle),
      source.rootPrefix,
      (count) => {
        setSourceStatus(source, `Scanning… ${count.toLocaleString()} files seen`, '');
        renderSources();
      },
    );
    source.files = scanned;
    setSourceStatus(
      source,
      `Indexed ${scanned.length.toLocaleString()} audio file${scanned.length === 1 ? '' : 's'}.`,
      scanned.length > 0 ? 'ok' : 'warn',
    );
  } catch (err) {
    source.files = [];
    setSourceStatus(
      source,
      err instanceof Error ? `Scan failed: ${err.message}` : 'Scan failed.',
      'err',
    );
  } finally {
    source.busy = false;
    rebuildCombinedIndex();
    refreshDiskMatchButton();
    renderSources();
  }
}

async function grantAccessAndScan(source: InMemorySource): Promise<void> {
  if (!source.handle) return;
  source.busy = true;
  renderSources();
  const result = await requestPermission(source.handle);
  source.permission = result;
  source.busy = false;
  if (result === 'granted') {
    await scanSource(source);
  } else {
    setSourceStatus(source, 'Access not granted.', 'warn');
    renderSources();
  }
}

async function repickFallback(source: InMemorySource): Promise<void> {
  // Firefox/Safari path: open a one-shot webkitdirectory picker just for
  // this row. We don't get a persistent handle so we just stamp the
  // scanned files with the source's rootPrefix and move on.
  const input = document.createElement('input');
  input.type = 'file';
  (input as HTMLInputElement & { webkitdirectory: boolean }).webkitdirectory = true;
  input.multiple = true;
  input.style.display = 'none';
  document.body.appendChild(input);
  const filesPromise = new Promise<FileList | null>((resolve) => {
    input.addEventListener('change', () => resolve(input.files), { once: true });
    // No reliable cancel signal across browsers — if the user closes the
    // dialog we just never resolve. The button stays in 'busy' state
    // briefly until the next user interaction, which is acceptable.
  });
  input.click();
  const files = await filesPromise;
  input.remove();
  if (!files || files.length === 0) return;

  source.busy = true;
  setSourceStatus(source, 'Indexing files…', '');
  renderSources();
  const scannable = scanFileList(
    Array.from(files).map((f) => ({ name: f.name, webkitRelativePath: f.webkitRelativePath })),
    source.rootPrefix,
  );
  source.files = scannable;
  source.busy = false;
  setSourceStatus(
    source,
    `Indexed ${scannable.length.toLocaleString()} audio file${scannable.length === 1 ? '' : 's'} (of ${files.length.toLocaleString()} total in folder).`,
    scannable.length > 0 ? 'ok' : 'warn',
  );
  rebuildCombinedIndex();
  refreshDiskMatchButton();
  renderSources();
}

async function addFsaSource(): Promise<void> {
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await (window as unknown as FsAccessWindow).showDirectoryPicker({ mode: 'read' });
  } catch (err) {
    if ((err as { name?: string })?.name === 'AbortError') return;
    diskScanStatus.textContent =
      err instanceof Error ? `Could not open folder: ${err.message}` : 'Could not open folder.';
    diskScanStatus.className = 'status err';
    return;
  }
  diskScanStatus.textContent = '';
  diskScanStatus.className = 'status';

  const displayName = handle.name;
  let recordId: number;
  if (isSourcesSupported()) {
    const rec = await addSourceRecord({
      kind: 'fsa',
      displayName,
      rootPrefix: '',
      handle,
    });
    recordId = rec.id;
  } else {
    // No IDB (e.g. private window with storage denied) — fall back to an
    // ephemeral negative id so the row still works for the session.
    recordId = -(sources.length + 1);
  }
  const source: InMemorySource = {
    recordId,
    kind: 'fsa',
    displayName,
    rootPrefix: '',
    handle,
    files: [],
    permission: 'granted', // just picked
    busy: false,
    rowStatus: 'Folder added. Enter the absolute root path below, then click "Scan" to index its filenames.',
    rowStatusKind: '',
  };
  sources.push(source);
  renderSources();
  refreshDiskMatchButton();
}

async function addFallbackSource(): Promise<void> {
  // No picker yet — just create the row. The user enters the prefix and
  // clicks "Pick folder" which fires repickFallback().
  const displayName = `Folder ${sources.length + 1}`;
  let recordId: number;
  if (isSourcesSupported()) {
    const rec = await addSourceRecord({
      kind: 'fallback',
      displayName,
      rootPrefix: '',
      handle: null,
    });
    recordId = rec.id;
  } else {
    recordId = -(sources.length + 1);
  }
  const source: InMemorySource = {
    recordId,
    kind: 'fallback',
    displayName,
    rootPrefix: '',
    handle: null,
    files: [],
    permission: 'unknown',
    busy: false,
    rowStatus: 'Enter the root path below, then click "Pick folder…" to index its filenames.',
    rowStatusKind: '',
  };
  sources.push(source);
  renderSources();
  refreshDiskMatchButton();
}

async function removeSource(source: InMemorySource): Promise<void> {
  const idx = sources.indexOf(source);
  if (idx >= 0) sources.splice(idx, 1);
  if (source.recordId > 0 && isSourcesSupported()) {
    try {
      await removeSourceRecord(source.recordId);
    } catch {
      // Best-effort — UI already updated.
    }
  }
  rebuildCombinedIndex();
  refreshDiskMatchButton();
  renderSources();
}

async function persistPrefix(source: InMemorySource): Promise<void> {
  if (source.recordId <= 0 || !isSourcesSupported()) return;
  try {
    await updateSourceRecord(source.recordId, { rootPrefix: source.rootPrefix });
  } catch {
    // Non-fatal; the in-memory state is correct.
  }
}

function renderSources(): void {
  diskSourcesList.innerHTML = '';
  if (sources.length === 0) {
    diskSourcesEmpty.classList.remove('hidden');
    return;
  }
  diskSourcesEmpty.classList.add('hidden');

  const frag = document.createDocumentFragment();
  for (const source of sources) {
    frag.appendChild(renderSourceRow(source));
  }
  diskSourcesList.appendChild(frag);
}

function renderSourceRow(source: InMemorySource): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'disk-source-row';

  const head = document.createElement('div');
  head.className = 'disk-source-head';
  const name = document.createElement('strong');
  name.textContent = source.displayName;
  head.appendChild(name);
  const kindBadge = document.createElement('span');
  kindBadge.className = 'disk-source-kind';
  kindBadge.textContent = source.kind === 'fsa' ? 'File System Access' : 'Legacy picker';
  head.appendChild(kindBadge);
  if (source.files.length > 0) {
    const count = document.createElement('span');
    count.className = 'disk-source-count';
    count.textContent = `${source.files.length.toLocaleString()} file${source.files.length === 1 ? '' : 's'}`;
    head.appendChild(count);
  }
  li.appendChild(head);

  const prefixRow = document.createElement('div');
  prefixRow.className = 'disk-source-prefix-row';
  const prefixLabel = document.createElement('label');
  prefixLabel.textContent = 'Root path';
  const prefixInput = document.createElement('input');
  prefixInput.type = 'text';
  prefixInput.placeholder = 'D:\\Music\\Library';
  prefixInput.value = source.rootPrefix;
  prefixInput.addEventListener('input', () => {
    restampSourcePrefix(source, prefixInput.value);
    rebuildCombinedIndex();
    refreshDiskMatchButton();
  });
  prefixInput.addEventListener('change', () => {
    void persistPrefix(source);
  });
  prefixLabel.appendChild(prefixInput);
  prefixRow.appendChild(prefixLabel);
  li.appendChild(prefixRow);

  const actions = document.createElement('div');
  actions.className = 'disk-source-actions';

  if (source.kind === 'fsa') {
    if (source.permission === 'granted') {
      const rescanBtn = document.createElement('button');
      rescanBtn.type = 'button';
      rescanBtn.textContent = source.files.length > 0 ? 'Rescan' : 'Scan';
      rescanBtn.disabled = source.busy;
      rescanBtn.addEventListener('click', () => void scanSource(source));
      actions.appendChild(rescanBtn);
    } else {
      const grantBtn = document.createElement('button');
      grantBtn.type = 'button';
      grantBtn.textContent = 'Grant access';
      grantBtn.disabled = source.busy;
      grantBtn.addEventListener('click', () => void grantAccessAndScan(source));
      actions.appendChild(grantBtn);
    }
  } else {
    const pickBtn = document.createElement('button');
    pickBtn.type = 'button';
    pickBtn.textContent = source.files.length > 0 ? 'Re-pick folder' : 'Pick folder…';
    pickBtn.disabled = source.busy;
    pickBtn.addEventListener('click', () => void repickFallback(source));
    actions.appendChild(pickBtn);
  }

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'secondary';
  removeBtn.textContent = 'Remove';
  removeBtn.disabled = source.busy;
  removeBtn.addEventListener('click', () => void removeSource(source));
  actions.appendChild(removeBtn);

  li.appendChild(actions);

  if (source.rowStatus) {
    const status = document.createElement('p');
    status.className = `status${source.rowStatusKind ? ' ' + source.rowStatusKind : ''}`;
    status.textContent = source.rowStatus;
    li.appendChild(status);
  }

  return li;
}

diskAddSourceBtn.addEventListener('click', () => {
  if (supportsFsAccess) {
    void addFsaSource();
  } else {
    void addFallbackSource();
  }
});

/** Restore persisted sources on startup. FSA rows whose permission is
 *  still 'granted' auto-rescan; everything else waits for a user click. */
async function restoreSources(): Promise<void> {
  if (!isSourcesSupported()) return;
  let records: DiskSourceRecord[];
  try {
    records = await listSources();
  } catch {
    return;
  }
  for (const rec of records) {
    if (rec.kind === 'fsa' && rec.handle) {
      const permission = await checkPermission(rec.handle);
      const source: InMemorySource = {
        recordId: rec.id,
        kind: 'fsa',
        displayName: rec.displayName,
        rootPrefix: rec.rootPrefix,
        handle: rec.handle,
        files: [],
        permission,
        busy: false,
        rowStatus:
          permission === 'granted'
            ? 'Rescanning…'
            : 'Click "Grant access" to re-authorize this folder.',
        rowStatusKind: '',
      };
      sources.push(source);
      if (permission === 'granted') {
        void scanSource(source);
      }
    } else {
      // Fallback row — no handle survives reload, user re-picks once.
      sources.push({
        recordId: rec.id,
        kind: 'fallback',
        displayName: rec.displayName,
        rootPrefix: rec.rootPrefix,
        handle: null,
        files: [],
        permission: 'unknown',
        busy: false,
        rowStatus: 'Re-pick the folder to use it this session.',
        rowStatusKind: '',
      });
    }
  }
  renderSources();
  refreshDiskMatchButton();
}

void restoreSources();

diskMatchBtn.addEventListener('click', () => {
  diskView.groups = [];
  diskView.container.innerHTML = '';
  diskView.toolbar.classList.add('hidden');
  if (!combinedIndex || notFoundFromMatch.length === 0) {
    diskMatchStatus.textContent = 'Add a music folder and run the collection match first.';
    diskMatchStatus.className = 'status warn';
    return;
  }

  const ratio = clampRatio(parseInt(diskRatioInput.value, 10));
  diskRatioInput.value = String(ratio);

  diskMatchStatus.textContent = 'Searching disk…';
  diskMatchStatus.className = 'status';

  setTimeout(() => {
    const hits = fuzzyMatchFiles(notFoundFromMatch, combinedIndex!, ratio);
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
          entry: diskMatchToEntry(m.file, trackStr),
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
  const name = playlistNameInput.value.trim() || 'NMLify Playlist';
  const xml = buildNmlPlaylist(name, entries);
  const safeName = sanitizePlaylistFilename(name);
  triggerDownload(`${safeName}.nml`, xml);
  // Fire-and-forget — never block the download UX on history persistence.
  void recordCrate(name, xml, entries.length);
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

// ---------- Backups ------------------------------------------------------

/**
 * Persist the just-loaded collection to the IndexedDB ring buffer and
 * refresh the Backups card. Failures (quota, private mode, unsupported
 * browser) are surfaced inline but never block the matching flow.
 */
async function snapshotCollection(
  xml: string,
  filename: string,
  entryCount: number,
): Promise<void> {
  if (!isBackupsSupported()) {
    backupsStatus.textContent =
      'This browser cannot store snapshots (IndexedDB or CompressionStream unavailable).';
    backupsStatus.className = 'status warn';
    return;
  }
  try {
    const result = await saveBackup(xml, filename, entryCount);
    backupsStatus.textContent = result.created
      ? `Snapshot saved (${entryCount} entries, ${formatBytes(xml.length)} uncompressed).`
      : 'Identical snapshot already on file — nothing new to save.';
    backupsStatus.className = 'status ok';
    await renderBackups();
  } catch (err) {
    backupsStatus.textContent =
      err instanceof Error ? `Snapshot failed: ${err.message}` : 'Snapshot failed.';
    backupsStatus.className = 'status err';
  }
}

async function renderBackups(): Promise<void> {
  if (!isBackupsSupported()) {
    backupsList.innerHTML = '';
    return;
  }
  let items: BackupMeta[];
  try {
    items = await listBackups();
  } catch (err) {
    backupsList.innerHTML = '';
    backupsStatus.textContent =
      err instanceof Error ? `Could not load snapshots: ${err.message}` : 'Could not load snapshots.';
    backupsStatus.className = 'status err';
    return;
  }
  backupsList.innerHTML = '';
  const now = Date.now();
  const frag = document.createDocumentFragment();
  for (const item of items) {
    frag.appendChild(renderBackupRow(item, now));
  }
  backupsList.appendChild(frag);
}

function renderBackupRow(item: BackupMeta, now: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'backup-row';

  const meta = document.createElement('div');
  meta.className = 'backup-meta';

  const main = document.createElement('span');
  main.className = 'backup-meta-line';
  const absolute = new Date(item.timestamp).toLocaleString();
  main.textContent = `${formatRelativeTime(item.timestamp, now)} — ${item.filename}`;
  main.title = absolute;
  meta.appendChild(main);

  const sub = document.createElement('span');
  sub.className = 'backup-meta-sub';
  sub.textContent = `${item.entryCount.toLocaleString()} entries · ${formatBytes(item.byteSize)} · ${absolute}`;
  meta.appendChild(sub);

  li.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'backup-actions';

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.textContent = 'Download .nml';
  downloadButton.title =
    'Download this snapshot. To restore in Traktor, quit Traktor and replace collection.nml in your Traktor folder with this file.';
  downloadButton.addEventListener('click', () => {
    void handleBackupDownload(item, downloadButton);
  });
  actions.appendChild(downloadButton);

  const delButton = document.createElement('button');
  delButton.type = 'button';
  delButton.className = 'secondary';
  delButton.textContent = 'Delete';
  delButton.addEventListener('click', () => {
    void handleBackupDelete(item);
  });
  actions.appendChild(delButton);

  li.appendChild(actions);
  return li;
}

async function handleBackupDownload(item: BackupMeta, button: HTMLButtonElement): Promise<void> {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparing…';
  try {
    const { xml, filename, timestamp } = await restoreBackup(item.id);
    triggerDownload(backupDownloadFilename(timestamp, filename), xml);
  } catch (err) {
    showError(err);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function handleBackupDelete(item: BackupMeta): Promise<void> {
  const when = new Date(item.timestamp).toLocaleString();
  if (!window.confirm(`Delete snapshot from ${when}? This can't be undone.`)) return;
  try {
    await deleteBackup(item.id);
    await renderBackups();
  } catch (err) {
    showError(err);
  }
}

// ---------- Crate history -----------------------------------------------

/**
 * Persist a freshly downloaded crate to the IndexedDB history and refresh
 * the Crate history card. Same fire-and-forget contract as snapshots —
 * never block the download UX on persistence.
 */
async function recordCrate(name: string, xml: string, entryCount: number): Promise<void> {
  if (!isCratesSupported()) {
    cratesStatus.textContent = 'This browser cannot store crate history (IndexedDB unavailable).';
    cratesStatus.className = 'status warn';
    return;
  }
  const source: CrateSource | null = lastPlaylist
    ? {
        type: 'spotify',
        playlistName: lastPlaylist.meta.name,
        playlistUrl: lastPlaylistUrl,
        totalTracks: lastPlaylist.meta.tracks.total,
      }
    : null;
  try {
    await saveCrate({ name, xml, entryCount, source });
    cratesStatus.textContent =
      `Saved "${name}" to crate history (${entryCount} tracks, ${formatBytes(xml.length)}).`;
    cratesStatus.className = 'status ok';
    await renderCrates();
  } catch (err) {
    cratesStatus.textContent =
      err instanceof Error ? `Crate history save failed: ${err.message}` : 'Crate history save failed.';
    cratesStatus.className = 'status err';
  }
}

async function renderCrates(): Promise<void> {
  if (!isCratesSupported()) {
    cratesList.innerHTML = '';
    return;
  }
  let items: CrateMeta[];
  try {
    items = await listCrates();
  } catch (err) {
    cratesList.innerHTML = '';
    cratesStatus.textContent =
      err instanceof Error ? `Could not load crate history: ${err.message}` : 'Could not load crate history.';
    cratesStatus.className = 'status err';
    return;
  }
  cratesList.innerHTML = '';
  const now = Date.now();
  const frag = document.createDocumentFragment();
  for (const item of items) {
    frag.appendChild(renderCrateRow(item, now));
  }
  cratesList.appendChild(frag);
}

function renderCrateRow(item: CrateMeta, now: number): HTMLLIElement {
  // Reuses .backup-row markup so we get the same styling for free.
  const li = document.createElement('li');
  li.className = 'backup-row';

  const meta = document.createElement('div');
  meta.className = 'backup-meta';

  const main = document.createElement('span');
  main.className = 'backup-meta-line';
  const absolute = new Date(item.timestamp).toLocaleString();
  main.textContent = `${formatRelativeTime(item.timestamp, now)} — ${item.name}`;
  main.title = absolute;
  meta.appendChild(main);

  const sub = document.createElement('span');
  sub.className = 'backup-meta-sub';
  const sourceFragment = item.source
    ? ` · from "${item.source.playlistName}" (${item.source.totalTracks} tracks)`
    : '';
  sub.textContent =
    `${item.entryCount.toLocaleString()} tracks · ${formatBytes(item.byteSize)} · ${absolute}${sourceFragment}`;
  meta.appendChild(sub);

  li.appendChild(meta);

  const actions = document.createElement('div');
  actions.className = 'backup-actions';

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.textContent = 'Download .nml';
  downloadButton.title = 'Re-download this crate exactly as it was generated.';
  downloadButton.addEventListener('click', () => {
    void handleCrateDownload(item, downloadButton);
  });
  actions.appendChild(downloadButton);

  const delButton = document.createElement('button');
  delButton.type = 'button';
  delButton.className = 'secondary';
  delButton.textContent = 'Delete';
  delButton.addEventListener('click', () => {
    void handleCrateDelete(item);
  });
  actions.appendChild(delButton);

  li.appendChild(actions);
  return li;
}

async function handleCrateDownload(item: CrateMeta, button: HTMLButtonElement): Promise<void> {
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = 'Preparing…';
  try {
    const record = await restoreCrate(item.id);
    const safeName = sanitizePlaylistFilename(record.name);
    triggerDownload(`${safeName}.nml`, record.xml);
  } catch (err) {
    showError(err);
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function handleCrateDelete(item: CrateMeta): Promise<void> {
  if (!window.confirm(`Delete crate "${item.name}"? This can't be undone.`)) return;
  try {
    await deleteCrate(item.id);
    await renderCrates();
  } catch (err) {
    showError(err);
  }
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
    let msg = `Spotify returned error: ${error}`;
    if (isUsingDefaultClientId()) {
      msg +=
        '. The built-in app is in Spotify developer mode — only whitelisted users can log in. ' +
        'Register your own Spotify app below and paste its Client ID to use NMLify.';
      const byoDetails = document.getElementById('byo-client-details') as HTMLDetailsElement | null;
      if (byoDetails) byoDetails.open = true;
    }
    authStatus.textContent = msg;
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
  void renderBackups();
  void renderCrates();
  // Best-effort: ask the browser to mark our origin as "persistent" so
  // snapshots and crate history aren't silently evicted under quota
  // pressure. Result is intentionally ignored — there is no fallback.
  void requestPersistentStorage();
})();
