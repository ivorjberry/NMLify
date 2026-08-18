import {
  indexGeneratedStemHandles,
  type StemDirectoryHandle,
  type StemFileHandle,
} from './generatedStems';
import {
  indexAudioFileHandles,
  type IndexedAudioFileHandle,
  type WalkableDirectoryHandle,
} from './diskSearch';
import { buildNmlPlaylist, loadCollection, sanitizePlaylistFilename, type NmlEntry } from './nml';
import {
  buildStemShareExportPlan,
  buildStemSharePlan,
  createRecipientEntries,
  createStemShareManifest,
  parseStemShareManifest,
  type StemShareManifest,
  type StemShareExportItem,
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

function asWalkableDirectory(handle: FileSystemDirectoryHandle): WalkableDirectoryHandle {
  return handle as unknown as WalkableDirectoryHandle;
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
    '3. Enter the absolute path where Traktor will find the copied originals.',
    "4. Choose that originals folder, then choose Traktor's Generated Stems folder.",
    '5. Import stem-share-ready.nml from the originals folder into Traktor.',
    '',
    'This package includes the original music files. Share only audio you may distribute.',
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
  const originalsFolderBtn = el<HTMLButtonElement>('share-originals-folder-btn');
  const originalsStatus = el<HTMLElement>('share-originals-status');
  const selectAllBtn = el<HTMLButtonElement>('share-select-all-btn');
  const selectNoneBtn = el<HTMLButtonElement>('share-select-none-btn');
  const matchSummary = el<HTMLElement>('share-match-summary');
  const matchList = el<HTMLOListElement>('share-match-list');
  const packageNameInput = el<HTMLInputElement>('share-package-name');
  const exportBtn = el<HTMLButtonElement>('share-export-btn');
  const exportStatus = el<HTMLElement>('share-export-status');

  const packageFolderBtn = el<HTMLButtonElement>('share-package-folder-btn');
  const packageStatus = el<HTMLElement>('share-package-status');
  const recipientRootInput = el<HTMLInputElement>('share-recipient-root-path');
  const installBtn = el<HTMLButtonElement>('share-install-btn');
  const installStatus = el<HTMLElement>('share-install-status');

  let collection: NmlEntry[] | null = null;
  let sourceFiles = new Map<string, StemFileHandle>();
  let originalFiles: IndexedAudioFileHandle[] = [];
  let stemCount = 0;
  let plan: StemShareExportItem[] = [];
  let selectedPaths = new Set<string>();
  let packageDirectory: ShareDirectoryHandle | null = null;
  let receivedManifest: StemShareManifest | null = null;
  let receivedCollection: NmlEntry[] | null = null;

  packageNameInput.value = defaultPackageName();

  if (!supported) {
    unsupported.classList.remove('hidden');
    sourceFolderBtn.disabled = true;
    originalsFolderBtn.disabled = true;
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
    const stemPlan = collection
      ? buildStemSharePlan(collection, new Set(sourceFiles.keys()))
      : [];
    stemCount = stemPlan.length;
    plan = buildStemShareExportPlan(stemPlan, originalFiles);
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
      matchSummary.textContent =
        'Load a collection, choose its generated stems folder, and add the original music.';
      return;
    }
    if (originalFiles.length === 0) {
      matchSummary.textContent =
        `Matched ${stemCount.toLocaleString()} generated stem${stemCount === 1 ? '' : 's'}. ` +
        'Add folders containing their original music files.';
      return;
    }
    matchSummary.textContent =
      `Matched originals for ${plan.length.toLocaleString()} of ${stemCount.toLocaleString()} ` +
      `generated stem${stemCount === 1 ? '' : 's'}; ` +
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

  originalsFolderBtn.addEventListener('click', async () => {
    if (!supported) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        mode: 'read',
      });
    } catch (err) {
      if (isAbortError(err)) return;
      originalsStatus.textContent =
        err instanceof Error ? `Could not open folder: ${err.message}` : 'Could not open folder.';
      originalsStatus.className = 'status err';
      return;
    }
    originalsStatus.textContent = `Scanning ${handle.name}…`;
    originalsStatus.className = 'status';
    try {
      const indexed = await indexAudioFileHandles(asWalkableDirectory(handle), (seen) => {
        originalsStatus.textContent =
          `Scanning ${handle.name}… ${seen.toLocaleString()} files seen`;
      });
      originalFiles.push(...indexed);
      originalsStatus.textContent =
        `Indexed ${originalFiles.length.toLocaleString()} original audio file` +
        `${originalFiles.length === 1 ? '' : 's'} across selected folders.`;
      originalsStatus.className = originalFiles.length > 0 ? 'status ok' : 'status warn';
      renderPlan(true);
    } catch (err) {
      originalsStatus.textContent =
        err instanceof Error ? `Could not scan folder: ${err.message}` : 'Could not scan folder.';
      originalsStatus.className = 'status err';
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
        await copyFileToPath(item.originalFile.handle, packageRoot, item.originalPath);
        const source = sourceFiles.get(item.sidecarPath.toLowerCase());
        if (!source) throw new Error(`Source sidecar disappeared: ${item.sidecarPath}`);
        await copyFileToPath(source, packageRoot, `GeneratedStems/${item.sidecarPath}`);
        copied += 1;
        exportStatus.textContent =
          `Copying originals and generated stems… ${copied.toLocaleString()} of ` +
          selected.length.toLocaleString();
      }
      exportStatus.textContent =
        `Exported ${copied.toLocaleString()} original and generated stem pair` +
        `${copied === 1 ? '' : 's'} to ` +
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
      const importedCollection = loadCollection(
        await readTextAtPath(directory, 'stem-share.nml'),
      );
      for (const item of manifest.entries) {
        await getFileAtPath(directory, `GeneratedStems/${item.sidecarPath}`);
        if (item.originalPath) await getFileAtPath(directory, item.originalPath);
      }
      const includesOriginals = manifest.entries.every((item) => item.originalPath);
      packageDirectory = directory;
      receivedManifest = manifest;
      receivedCollection = importedCollection;
      packageStatus.textContent = includesOriginals
        ? `Loaded "${handle.name}" with ${manifest.entries.length.toLocaleString()} original and ` +
          `generated stem pair${manifest.entries.length === 1 ? '' : 's'}.`
        : `Loaded legacy package "${handle.name}" without original music files.`;
      packageStatus.className = includesOriginals ? 'status ok' : 'status warn';
      installBtn.disabled = false;
    } catch (err) {
      packageDirectory = null;
      receivedManifest = null;
      receivedCollection = null;
      installBtn.disabled = true;
      packageStatus.textContent =
        err instanceof Error ? `Invalid package: ${err.message}` : 'Invalid package.';
      packageStatus.className = 'status err';
    }
  });

  installBtn.addEventListener('click', async () => {
    if (!packageDirectory || !receivedManifest || !receivedCollection) return;
    const includesOriginals = receivedManifest.entries.every((item) => item.originalPath);
    const recipientRoot = recipientRootInput.value.trim();
    if (includesOriginals && !recipientRoot) {
      installStatus.textContent = 'Enter the absolute Traktor path for the originals folder.';
      installStatus.className = 'status err';
      recipientRootInput.focus();
      return;
    }
    let originalsDestination: FileSystemDirectoryHandle | null = null;
    let stemsDestination: FileSystemDirectoryHandle;
    try {
      if (includesOriginals) {
        originalsDestination =
          await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
            mode: 'readwrite',
          });
      }
      stemsDestination = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        mode: 'readwrite',
      });
    } catch (err) {
      if (isAbortError(err)) return;
      installStatus.textContent = err instanceof Error
        ? `Could not open destination folder: ${err.message}`
        : 'Could not open destination folder.';
      installStatus.className = 'status err';
      return;
    }

    installBtn.disabled = true;
    installStatus.className = 'status';
    try {
      const rewrittenEntries = includesOriginals
        ? createRecipientEntries(receivedCollection, receivedManifest, recipientRoot)
        : null;
      let copied = 0;
      for (const item of receivedManifest.entries) {
        if (item.originalPath && originalsDestination) {
          const originalSource = await getFileAtPath(packageDirectory, item.originalPath);
          await copyFileToPath(
            originalSource,
            asShareDirectory(originalsDestination),
            item.originalPath.slice('Originals/'.length),
          );
        }
        const stemSource = await getFileAtPath(
          packageDirectory,
          `GeneratedStems/${item.sidecarPath}`,
        );
        await copyFileToPath(
          stemSource,
          asShareDirectory(stemsDestination),
          item.sidecarPath,
        );
        copied += 1;
        installStatus.textContent =
          `Installing ${includesOriginals ? 'originals and ' : ''}generated stems… ` +
          `${copied.toLocaleString()} of ` +
          receivedManifest.entries.length.toLocaleString();
      }
      if (originalsDestination && rewrittenEntries) {
        await writeFileAtPath(
          asShareDirectory(originalsDestination),
          'stem-share-ready.nml',
          buildNmlPlaylist('Shared Stems', rewrittenEntries),
        );
        installStatus.textContent =
          `Installed ${copied.toLocaleString()} original and generated stem pair` +
          `${copied === 1 ? '' : 's'}. Import stem-share-ready.nml from ` +
          `"${originalsDestination.name}" into Traktor.`;
      } else {
        installStatus.textContent =
          `Installed ${copied.toLocaleString()} generated stem${copied === 1 ? '' : 's'}. ` +
          'This legacy package has no originals; import stem-share.nml from the package.';
      }
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
