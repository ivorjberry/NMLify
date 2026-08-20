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
import { triggerDownload } from './download';
import { buildNmlPlaylist, loadCollection, sanitizePlaylistFilename, type NmlEntry } from './nml';
import { buildAllStemEntries } from './stemLibrary';
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
    '3. Choose the originals destination and enter that same folder’s absolute Traktor path.',
    '4. Install the originals. NMLify creates a new stem-share-ready.nml for this computer.',
    "5. Install stems into Traktor's Generated Stems folder.",
    '6. Import the new stem-share-ready.nml, not the package’s original stem-share.nml.',
    '',
    'This package includes the original music files. Share only audio you may distribute.',
  ].join('\n');
}

export function initStemSharing(): void {
  const playlistTabBtn = el<HTMLButtonElement>('playlist-tab-btn');
  const stemSharingTabBtn = el<HTMLButtonElement>('stem-sharing-tab-btn');
  const playlistPanel = el<HTMLElement>('playlist-builder-tab');
  const sharingPanel = el<HTMLElement>('stem-sharing-tab');
  const stemLibraryTabBtn = el<HTMLButtonElement>('stem-library-tab-btn');
  const stemShareUtilityTabBtn = el<HTMLButtonElement>('stem-share-utility-tab-btn');
  const stemLibraryPanel = el<HTMLElement>('stem-library-utility');
  const stemSharingUtilityPanel = el<HTMLElement>('stem-sharing-utility');
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

  function showUtility(tab: 'library' | 'sharing'): void {
    const sharing = tab === 'sharing';
    stemLibraryPanel.classList.toggle('hidden', sharing);
    stemSharingUtilityPanel.classList.toggle('hidden', !sharing);
    stemLibraryTabBtn.classList.toggle('active', !sharing);
    stemShareUtilityTabBtn.classList.toggle('active', sharing);
    stemLibraryTabBtn.setAttribute('aria-selected', String(!sharing));
    stemShareUtilityTabBtn.setAttribute('aria-selected', String(sharing));
  }
  stemLibraryTabBtn.addEventListener('click', () => showUtility('library'));
  stemShareUtilityTabBtn.addEventListener('click', () => showUtility('sharing'));

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
  const libraryCollectionInput =
    el<HTMLInputElement>('stem-library-collection-input');
  const libraryCollectionStatus =
    el<HTMLElement>('stem-library-collection-status');
  const libraryFolderBtn = el<HTMLButtonElement>('stem-library-folder-btn');
  const libraryFolderStatus = el<HTMLElement>('stem-library-folder-status');
  const libraryMarkerInput = el<HTMLInputElement>('stem-library-marker-input');
  const libraryDownloadBtn = el<HTMLButtonElement>('stem-library-download-btn');
  const libraryStatus = el<HTMLElement>('stem-library-status');
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
  const originalsDestinationBtn =
    el<HTMLButtonElement>('share-originals-destination-btn');
  const originalsDestinationStatus =
    el<HTMLElement>('share-originals-destination-status');
  const recipientRootInput = el<HTMLInputElement>('share-recipient-root-path');
  const installOriginalsBtn = el<HTMLButtonElement>('share-install-originals-btn');
  const originalsInstallStatus = el<HTMLElement>('share-originals-install-status');
  const installStemsBtn = el<HTMLButtonElement>('share-install-stems-btn');
  const stemsInstallStatus = el<HTMLElement>('share-stems-install-status');

  let collection: NmlEntry[] | null = null;
  let libraryCollection: NmlEntry[] | null = null;
  let libraryStemPaths = new Set<string>();
  let sourceFiles = new Map<string, StemFileHandle>();
  let originalFiles: IndexedAudioFileHandle[] = [];
  let stemCount = 0;
  let plan: StemShareExportItem[] = [];
  let selectedPaths = new Set<string>();
  let packageDirectory: ShareDirectoryHandle | null = null;
  let receivedManifest: StemShareManifest | null = null;
  let receivedCollection: NmlEntry[] | null = null;
  let originalsDestination: FileSystemDirectoryHandle | null = null;

  packageNameInput.value = defaultPackageName();

  if (!supported) {
    libraryFolderBtn.disabled = true;
    libraryFolderStatus.textContent =
      'Generated-stem folder scanning requires Chromium; packaged stems remain available.';
    libraryFolderStatus.className = 'status warn';
    unsupported.classList.remove('hidden');
    sourceFolderBtn.disabled = true;
    originalsFolderBtn.disabled = true;
    exportBtn.disabled = true;
    packageFolderBtn.disabled = true;
    originalsDestinationBtn.disabled = true;
    installOriginalsBtn.disabled = true;
    installStemsBtn.disabled = true;
  }

  function updateLibraryState(): void {
    const entries = libraryCollection
      ? buildAllStemEntries(libraryCollection, libraryStemPaths, false)
      : [];
    libraryDownloadBtn.disabled = entries.length === 0;
    if (!libraryCollection) {
      libraryStatus.textContent = 'Load a collection to find stem-backed tracks.';
      libraryStatus.className = 'status';
      return;
    }
    libraryStatus.textContent =
      `Found ${entries.length.toLocaleString()} stem-backed collection ` +
      `entr${entries.length === 1 ? 'y' : 'ies'} for the playlist.`;
    libraryStatus.className = entries.length > 0 ? 'status ok' : 'status warn';
  }

  libraryCollectionInput.addEventListener('change', async () => {
    const file = libraryCollectionInput.files?.[0];
    if (!file) return;
    libraryCollectionStatus.textContent = `Reading ${file.name}…`;
    libraryCollectionStatus.className = 'status';
    try {
      libraryCollection = loadCollection(await file.text());
      libraryCollectionStatus.textContent =
        `Loaded ${libraryCollection.length.toLocaleString()} collection entries from ${file.name}.`;
      libraryCollectionStatus.className = 'status ok';
    } catch (err) {
      libraryCollection = null;
      libraryCollectionStatus.textContent = err instanceof Error
        ? `Could not load collection: ${err.message}`
        : 'Could not load collection.';
      libraryCollectionStatus.className = 'status err';
    }
    updateLibraryState();
  });

  libraryFolderBtn.addEventListener('click', async () => {
    if (!supported) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        mode: 'read',
      });
    } catch (err) {
      if (isAbortError(err)) return;
      libraryFolderStatus.textContent = err instanceof Error
        ? `Could not open folder: ${err.message}`
        : 'Could not open folder.';
      libraryFolderStatus.className = 'status err';
      return;
    }
    libraryFolderStatus.textContent = `Scanning ${handle.name}…`;
    libraryFolderStatus.className = 'status';
    try {
      const files = await indexGeneratedStemHandles(asStemDirectory(handle), (seen) => {
        libraryFolderStatus.textContent =
          `Scanning ${handle.name}… ${seen.toLocaleString()} files seen`;
      });
      libraryStemPaths = new Set(files.keys());
      libraryFolderStatus.textContent =
        `Found ${libraryStemPaths.size.toLocaleString()} generated stem sidecar` +
        `${libraryStemPaths.size === 1 ? '' : 's'}.`;
      libraryFolderStatus.className = libraryStemPaths.size > 0 ? 'status ok' : 'status warn';
      updateLibraryState();
    } catch (err) {
      libraryStemPaths = new Set();
      libraryFolderStatus.textContent = err instanceof Error
        ? `Could not scan folder: ${err.message}`
        : 'Could not scan folder.';
      libraryFolderStatus.className = 'status err';
      updateLibraryState();
    }
  });

  libraryDownloadBtn.addEventListener('click', () => {
    if (!libraryCollection) return;
    const entries = buildAllStemEntries(
      libraryCollection,
      libraryStemPaths,
      libraryMarkerInput.checked,
    );
    if (entries.length === 0) return;
    triggerDownload('All Stems.nml', buildNmlPlaylist('All Stems', entries));
    libraryStatus.textContent =
      `Downloaded All Stems.nml with ${entries.length.toLocaleString()} ` +
      `entr${entries.length === 1 ? 'y' : 'ies'}` +
      `${libraryMarkerInput.checked ? ' tagged in Comment 2.' : '.'}`;
    libraryStatus.className = 'status ok';
  });

  function updateExportButton(): void {
    exportBtn.disabled = !supported || selectedPaths.size === 0;
    selectAllBtn.disabled = plan.length === 0;
    selectNoneBtn.disabled = plan.length === 0;
  }

  function updateImportButtons(): void {
    const hasPackage = packageDirectory !== null && receivedManifest !== null;
    const includesOriginals =
      hasPackage && receivedManifest!.entries.every((item) => item.originalPath);
    originalsDestinationBtn.disabled = !supported || !includesOriginals;
    installOriginalsBtn.disabled =
      !supported ||
      !includesOriginals ||
      originalsDestination === null ||
      recipientRootInput.value.trim() === '';
    installStemsBtn.disabled = !supported || !hasPackage;
  }
  recipientRootInput.addEventListener('input', updateImportButtons);

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
      updateLibraryState();
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
      originalsDestination = null;
      originalsDestinationStatus.textContent = '';
      originalsInstallStatus.textContent = '';
      stemsInstallStatus.textContent = '';
      packageStatus.textContent = includesOriginals
        ? `Loaded "${handle.name}" with ${manifest.entries.length.toLocaleString()} original and ` +
          `generated stem pair${manifest.entries.length === 1 ? '' : 's'}.`
        : `Loaded legacy package "${handle.name}" without original music files.`;
      packageStatus.className = includesOriginals ? 'status ok' : 'status warn';
      updateImportButtons();
    } catch (err) {
      packageDirectory = null;
      receivedManifest = null;
      receivedCollection = null;
      originalsDestination = null;
      updateImportButtons();
      packageStatus.textContent =
        err instanceof Error ? `Invalid package: ${err.message}` : 'Invalid package.';
      packageStatus.className = 'status err';
    }
  });

  originalsDestinationBtn.addEventListener('click', async () => {
    try {
      originalsDestination =
        await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
          mode: 'readwrite',
        });
      originalsDestinationStatus.textContent =
        `Originals will be copied to "${originalsDestination.name}".`;
      originalsDestinationStatus.className = 'status ok';
      updateImportButtons();
    } catch (err) {
      if (isAbortError(err)) return;
      originalsDestinationStatus.textContent = err instanceof Error
        ? `Could not open originals folder: ${err.message}`
        : 'Could not open originals folder.';
      originalsDestinationStatus.className = 'status err';
    }
  });

  installOriginalsBtn.addEventListener('click', async () => {
    if (
      !packageDirectory ||
      !receivedManifest ||
      !receivedCollection ||
      !originalsDestination
    ) return;
    const packageRoot = packageDirectory;
    const manifest = receivedManifest;
    const destination = originalsDestination;
    installOriginalsBtn.disabled = true;
    originalsInstallStatus.className = 'status';
    try {
      const rewrittenEntries = createRecipientEntries(
        receivedCollection,
        manifest,
        recipientRootInput.value,
      );
      let copied = 0;
      for (const item of manifest.entries) {
        if (!item.originalPath) continue;
        const source = await getFileAtPath(packageRoot, item.originalPath);
        await copyFileToPath(
          source,
          asShareDirectory(destination),
          item.originalPath.slice('Originals/'.length),
        );
        copied += 1;
        originalsInstallStatus.textContent =
          `Installing originals… ${copied.toLocaleString()} of ` +
          manifest.entries.length.toLocaleString();
      }
      await writeFileAtPath(
        asShareDirectory(destination),
        'stem-share-ready.nml',
        buildNmlPlaylist('Shared Stems', rewrittenEntries),
      );
      originalsInstallStatus.textContent =
        `Installed ${copied.toLocaleString()} original track${copied === 1 ? '' : 's'} and ` +
        `created stem-share-ready.nml in "${destination.name}".`;
      originalsInstallStatus.className = 'status ok';
    } catch (err) {
      originalsInstallStatus.textContent =
        err instanceof Error ? `Original installation failed: ${err.message}` : 'Original installation failed.';
      originalsInstallStatus.className = 'status err';
    } finally {
      updateImportButtons();
    }
  });

  installStemsBtn.addEventListener('click', async () => {
    if (!packageDirectory || !receivedManifest) return;
    const packageRoot = packageDirectory;
    const manifest = receivedManifest;
    let destination: FileSystemDirectoryHandle;
    try {
      destination = await (window as unknown as DirectoryPickerWindow).showDirectoryPicker({
        mode: 'readwrite',
      });
    } catch (err) {
      if (isAbortError(err)) return;
      stemsInstallStatus.textContent = err instanceof Error
        ? `Could not open generated stems folder: ${err.message}`
        : 'Could not open generated stems folder.';
      stemsInstallStatus.className = 'status err';
      return;
    }

    installStemsBtn.disabled = true;
    stemsInstallStatus.className = 'status';
    try {
      let copied = 0;
      for (const item of manifest.entries) {
        const source = await getFileAtPath(
          packageRoot,
          `GeneratedStems/${item.sidecarPath}`,
        );
        await copyFileToPath(
          source,
          asShareDirectory(destination),
          item.sidecarPath,
        );
        copied += 1;
        stemsInstallStatus.textContent =
          `Installing generated stems… ${copied.toLocaleString()} of ` +
          manifest.entries.length.toLocaleString();
      }
      stemsInstallStatus.textContent =
        `Installed ${copied.toLocaleString()} generated stem${copied === 1 ? '' : 's'} into ` +
        `"${destination.name}".`;
      stemsInstallStatus.className = 'status ok';
    } catch (err) {
      stemsInstallStatus.textContent =
        err instanceof Error ? `Stem installation failed: ${err.message}` : 'Stem installation failed.';
      stemsInstallStatus.className = 'status err';
    } finally {
      updateImportButtons();
    }
  });

  renderPlan(true);
}
