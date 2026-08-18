import {
  indexGeneratedStemHandles,
  type StemDirectoryHandle,
  type StemFileHandle,
} from './generatedStems';
import { buildNmlPlaylist, loadCollection, sanitizePlaylistFilename, type NmlEntry } from './nml';
import {
  buildStemSharePlan,
  createStemShareManifest,
  parseStemShareManifest,
  type StemShareManifest,
  type StemSharePlanItem,
} from './stemSharing';
import {
  copyFileToPath,
  getFileAtPath,
  readTextAtPath,
  type ShareDirectoryHandle,
  writeFileAtPath,
} from './stemShareFiles';

type DirectoryPickerWindow = Window & {
  showDirectoryPicker: (options?: {
    mode?: 'read' | 'readwrite';
  }) => Promise<FileSystemDirectoryHandle>;
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node as T;
}

function isAbortError(err: unknown): boolean {
  return (err as { name?: string })?.name === 'AbortError';
}

function asStemDirectory(handle: FileSystemDirectoryHandle): StemDirectoryHandle {
  return handle as unknown as StemDirectoryHandle;
}

function asShareDirectory(handle: FileSystemDirectoryHandle): ShareDirectoryHandle {
  return handle as unknown as ShareDirectoryHandle;
}

function defaultPackageName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `NMLify Stems ${timestamp}`;
}

function packageInstructions(packageName: string, count: number): string {
  return [
    `${packageName}`,
    '',
    `This package contains ${count} Traktor-generated stem sidecar file${count === 1 ? '' : 's'}.`,
    '',
    'To install with NMLify:',
    '1. Open the Stem Sharing tab.',
    '2. Choose this package folder under Install a received package.',
    "3. Choose Traktor's configured Generated Stems folder.",
    '4. Install the sidecars.',
    '5. Import stem-share.nml into Traktor and relocate original tracks if needed.',
    '',
    'The original music files are not included.',
  ].join('\n');
}

export function initStemSharing(): void {
  const playlistTabBtn = el<HTMLButtonElement>('playlist-tab-btn');
  const stemSharingTabBtn = el<HTMLButtonElement>('stem-sharing-tab-btn');
  const playlistPanel = el<HTMLElement>('playlist-builder-tab');
  const sharingPanel = el<HTMLElement>('stem-sharing-tab');
  const exportTabBtn = el<HTMLButtonElement>('share-export-tab-btn');
  const importTabBtn = el<HTMLButtonElement>('share-import-tab-btn');
  const exportPanel = el<HTMLElement>('share-export-panel');
  const importPanel = el<HTMLElement>('share-import-panel');

  function showTab(tab: 'playlist' | 'sharing'): void {
    const sharing = tab === 'sharing';
    playlistPanel.classList.toggle('hidden', sharing);
    sharingPanel.classList.toggle('hidden', !sharing);
    playlistTabBtn.classList.toggle('active', !sharing);
    stemSharingTabBtn.classList.toggle('active', sharing);
    playlistTabBtn.setAttribute('aria-selected', String(!sharing));
    stemSharingTabBtn.setAttribute('aria-selected', String(sharing));
  }
  playlistTabBtn.addEventListener('click', () => showTab('playlist'));
  stemSharingTabBtn.addEventListener('click', () => showTab('sharing'));

  function showSharingTab(tab: 'export' | 'import'): void {
    const importing = tab === 'import';
    exportPanel.classList.toggle('hidden', importing);
    importPanel.classList.toggle('hidden', !importing);
    exportTabBtn.classList.toggle('active', !importing);
    importTabBtn.classList.toggle('active', importing);
    exportTabBtn.setAttribute('aria-selected', String(!importing));
    importTabBtn.setAttribute('aria-selected', String(importing));
  }
  exportTabBtn.addEventListener('click', () => showSharingTab('export'));
  importTabBtn.addEventListener('click', () => showSharingTab('import'));

  const supported = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
  const unsupported = el<HTMLElement>('stem-sharing-unsupported');
  const exportCollectionInput = el<HTMLInputElement>('share-collection-input');
  const exportCollectionStatus = el<HTMLElement>('share-collection-status');
  const sourceFolderBtn = el<HTMLButtonElement>('share-source-folder-btn');
  const sourceStatus = el<HTMLElement>('share-source-status');
  const selectAllBtn = el<HTMLButtonElement>('share-select-all-btn');
  const selectNoneBtn = el<HTMLButtonElement>('share-select-none-btn');
  const matchSummary = el<HTMLElement>('share-match-summary');
  const matchList = el<HTMLOListElement>('share-match-list');
  const packageNameInput = el<HTMLInputElement>('share-package-name');
  const exportBtn = el<HTMLButtonElement>('share-export-btn');
  const exportStatus = el<HTMLElement>('share-export-status');

  const packageFolderBtn = el<HTMLButtonElement>('share-package-folder-btn');
  const packageStatus = el<HTMLElement>('share-package-status');
  const installBtn = el<HTMLButtonElement>('share-install-btn');
  const installStatus = el<HTMLElement>('share-install-status');

  let collection: NmlEntry[] | null = null;
  let sourceFiles = new Map<string, StemFileHandle>();
  let plan: StemSharePlanItem[] = [];
  let selectedPaths = new Set<string>();
  let packageDirectory: ShareDirectoryHandle | null = null;
  let receivedManifest: StemShareManifest | null = null;

  packageNameInput.value = defaultPackageName();

  if (!supported) {
    unsupported.classList.remove('hidden');
    sourceFolderBtn.disabled = true;
    exportBtn.disabled = true;
    packageFolderBtn.disabled = true;
    installBtn.disabled = true;
  }

  function updateExportButton(): void {
    exportBtn.disabled = !supported || selectedPaths.size === 0;
    selectAllBtn.disabled = plan.length === 0;
    selectNoneBtn.disabled = plan.length === 0;
  }

  function renderPlan(resetSelection: boolean): void {
    plan = collection ? buildStemSharePlan(collection, new Set(sourceFiles.keys())) : [];
    if (resetSelection) {
      selectedPaths = new Set(plan.map((item) => item.sidecarPath));
    } else {
      const available = new Set(plan.map((item) => item.sidecarPath));
      selectedPaths = new Set([...selectedPaths].filter((path) => available.has(path)));
    }

    matchList.innerHTML = '';
    for (const item of plan) {
      const row = document.createElement('li');
      const label = document.createElement('label');
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selectedPaths.has(item.sidecarPath);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedPaths.add(item.sidecarPath);
        else selectedPaths.delete(item.sidecarPath);
        updateExportButton();
        renderSummary();
      });
      const text = document.createElement('span');
      const primary = document.createElement('strong');
      primary.textContent = `${item.artist} — ${item.title}`;
      const path = document.createElement('code');
      path.textContent = item.sidecarPath;
      text.append(primary, document.createElement('br'), path);
      label.append(checkbox, text);
      row.appendChild(label);
      matchList.appendChild(row);
    }
    renderSummary();
    updateExportButton();
  }

  function renderSummary(): void {
    if (!collection || sourceFiles.size === 0) {
      matchSummary.textContent = 'Load a collection and choose its generated stems folder.';
      return;
    }
    matchSummary.textContent =
      `Matched ${plan.length.toLocaleString()} generated stem${plan.length === 1 ? '' : 's'}; ` +
      `${selectedPaths.size.toLocaleString()} selected for export.`;
  }

  exportCollectionInput.addEventListener('change', async () => {
    const file = exportCollectionInput.files?.[0];
    if (!file) return;
    exportCollectionStatus.textContent = `Reading ${file.name}…`;
    exportCollectionStatus.className = 'status';
    try {
      collection = loadCollection(await file.text());
      exportCollectionStatus.textContent =
        `Loaded ${collection.length.toLocaleString()} collection entries from ${file.name}.`;
      exportCollectionStatus.className = 'status ok';
      renderPlan(true);
    } catch (err) {
      collection = null;
      exportCollectionStatus.textContent =
        err instanceof Error ? `Could not load collection: ${err.message}` : 'Could not load collection.';
      exportCollectionStatus.className = 'status err';
      renderPlan(true);
    }
  });

  sourceFolderBtn.addEventListener('click', async () => {
    if (!supported) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        mode: 'read',
      });
    } catch (err) {
      if (isAbortError(err)) return;
      sourceStatus.textContent =
        err instanceof Error ? `Could not open folder: ${err.message}` : 'Could not open folder.';
      sourceStatus.className = 'status err';
      return;
    }
    sourceStatus.textContent = `Scanning ${handle.name}…`;
    sourceStatus.className = 'status';
    try {
      sourceFiles = await indexGeneratedStemHandles(asStemDirectory(handle), (seen) => {
        sourceStatus.textContent = `Scanning ${handle.name}… ${seen.toLocaleString()} files seen`;
      });
      sourceStatus.textContent =
        `Found ${sourceFiles.size.toLocaleString()} generated stem file${sourceFiles.size === 1 ? '' : 's'}.`;
      sourceStatus.className = sourceFiles.size > 0 ? 'status ok' : 'status warn';
      renderPlan(true);
    } catch (err) {
      sourceFiles = new Map();
      sourceStatus.textContent =
        err instanceof Error ? `Could not scan folder: ${err.message}` : 'Could not scan folder.';
      sourceStatus.className = 'status err';
      renderPlan(true);
    }
  });

  selectAllBtn.addEventListener('click', () => {
    selectedPaths = new Set(plan.map((item) => item.sidecarPath));
    renderPlan(false);
  });
  selectNoneBtn.addEventListener('click', () => {
    selectedPaths.clear();
    renderPlan(false);
  });

  exportBtn.addEventListener('click', async () => {
    const selected = plan.filter((item) => selectedPaths.has(item.sidecarPath));
    if (selected.length === 0) return;
    const rawName = packageNameInput.value.trim() || defaultPackageName();
    const packageName =
      sanitizePlaylistFilename(rawName).replace(/[. ]+$/g, '') || 'NMLify Stems';
    packageNameInput.value = packageName;
    let destination: FileSystemDirectoryHandle;
    try {
      destination = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        mode: 'readwrite',
      });
    } catch (err) {
      if (isAbortError(err)) return;
      exportStatus.textContent =
        err instanceof Error ? `Could not open export folder: ${err.message}` : 'Could not open export folder.';
      exportStatus.className = 'status err';
      return;
    }

    exportBtn.disabled = true;
    exportStatus.className = 'status';
    try {
      const packageRoot = await asShareDirectory(destination).getDirectoryHandle(packageName, {
        create: true,
      });
      const manifest = createStemShareManifest(selected);
      await writeFileAtPath(
        packageRoot,
        'manifest.json',
        `${JSON.stringify(manifest, null, 2)}\n`,
      );
      await writeFileAtPath(
        packageRoot,
        'stem-share.nml',
        buildNmlPlaylist(packageName, selected.map((item) => item.entry)),
      );
      await writeFileAtPath(
        packageRoot,
        'README.txt',
        `${packageInstructions(packageName, selected.length)}\n`,
      );
      let copied = 0;
      for (const item of selected) {
        const source = sourceFiles.get(item.sidecarPath.toLowerCase());
        if (!source) throw new Error(`Source sidecar disappeared: ${item.sidecarPath}`);
        await copyFileToPath(source, packageRoot, `GeneratedStems/${item.sidecarPath}`);
        copied += 1;
        exportStatus.textContent =
          `Copying generated stems… ${copied.toLocaleString()} of ${selected.length.toLocaleString()}`;
      }
      exportStatus.textContent =
        `Exported ${copied.toLocaleString()} generated stem${copied === 1 ? '' : 's'} to ` +
        `"${destination.name}\\${packageName}".`;
      exportStatus.className = 'status ok';
    } catch (err) {
      exportStatus.textContent =
        err instanceof Error ? `Export failed: ${err.message}` : 'Export failed.';
      exportStatus.className = 'status err';
    } finally {
      updateExportButton();
    }
  });

  packageFolderBtn.addEventListener('click', async () => {
    if (!supported) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        mode: 'read',
      });
    } catch (err) {
      if (isAbortError(err)) return;
      packageStatus.textContent =
        err instanceof Error ? `Could not open package: ${err.message}` : 'Could not open package.';
      packageStatus.className = 'status err';
      return;
    }
    try {
      const directory = asShareDirectory(handle);
      const manifest = parseStemShareManifest(await readTextAtPath(directory, 'manifest.json'));
      await getFileAtPath(directory, 'stem-share.nml');
      for (const item of manifest.entries) {
        await getFileAtPath(directory, `GeneratedStems/${item.sidecarPath}`);
      }
      packageDirectory = directory;
      receivedManifest = manifest;
      packageStatus.textContent =
        `Loaded "${handle.name}" with ${manifest.entries.length.toLocaleString()} generated ` +
        `stem${manifest.entries.length === 1 ? '' : 's'}.`;
      packageStatus.className = 'status ok';
      installBtn.disabled = false;
    } catch (err) {
      packageDirectory = null;
      receivedManifest = null;
      installBtn.disabled = true;
      packageStatus.textContent =
        err instanceof Error ? `Invalid package: ${err.message}` : 'Invalid package.';
      packageStatus.className = 'status err';
    }
  });

  installBtn.addEventListener('click', async () => {
    if (!packageDirectory || !receivedManifest) return;
    let destination: FileSystemDirectoryHandle;
    try {
      destination = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        mode: 'readwrite',
      });
    } catch (err) {
      if (isAbortError(err)) return;
      installStatus.textContent =
        err instanceof Error ? `Could not open stems folder: ${err.message}` : 'Could not open stems folder.';
      installStatus.className = 'status err';
      return;
    }

    installBtn.disabled = true;
    installStatus.className = 'status';
    try {
      let copied = 0;
      for (const item of receivedManifest.entries) {
        const source = await getFileAtPath(
          packageDirectory,
          `GeneratedStems/${item.sidecarPath}`,
        );
        await copyFileToPath(source, asShareDirectory(destination), item.sidecarPath);
        copied += 1;
        installStatus.textContent =
          `Installing generated stems… ${copied.toLocaleString()} of ` +
          receivedManifest.entries.length.toLocaleString();
      }
      installStatus.textContent =
        `Installed ${copied.toLocaleString()} generated stem${copied === 1 ? '' : 's'} into ` +
        `"${destination.name}". Import stem-share.nml from the package into Traktor, then ` +
        'relocate any missing original tracks.';
      installStatus.className = 'status ok';
    } catch (err) {
      installStatus.textContent =
        err instanceof Error ? `Install failed: ${err.message}` : 'Install failed.';
      installStatus.className = 'status err';
    } finally {
      installBtn.disabled = false;
    }
  });

  renderPlan(true);
}
