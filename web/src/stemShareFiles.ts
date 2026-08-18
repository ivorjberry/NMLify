import type { StemFileHandle } from './generatedStems';

export interface ShareFileHandle extends StemFileHandle {
  getFile(): Promise<File>;
  createWritable?: () => Promise<FileSystemWritableFileStream>;
}

export interface ShareDirectoryHandle {
  name: string;
  getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<ShareDirectoryHandle>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<ShareFileHandle>;
}

function pathParts(path: string): string[] {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (
    parts.length === 0 ||
    parts.some((part) => part === '.' || part === '..' || part.includes('\\'))
  ) {
    throw new Error(`Invalid package path: ${path}`);
  }
  return parts;
}

export async function getFileAtPath(
  root: ShareDirectoryHandle,
  path: string,
): Promise<ShareFileHandle> {
  const parts = pathParts(path);
  const filename = parts.pop()!;
  let directory = root;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part);
  }
  return directory.getFileHandle(filename);
}

export async function readTextAtPath(
  root: ShareDirectoryHandle,
  path: string,
): Promise<string> {
  return (await (await getFileAtPath(root, path)).getFile()).text();
}

export async function writeFileAtPath(
  root: ShareDirectoryHandle,
  path: string,
  data: Blob | string,
): Promise<void> {
  const parts = pathParts(path);
  const filename = parts.pop()!;
  let directory = root;
  for (const part of parts) {
    directory = await directory.getDirectoryHandle(part, { create: true });
  }
  const handle = await directory.getFileHandle(filename, { create: true });
  if (typeof handle.createWritable !== 'function') {
    throw new Error('The selected browser or folder does not support writing files');
  }
  const writable = await handle.createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (err) {
    await writable.abort(err).catch(() => undefined);
    throw err;
  }
}

export async function copyFileToPath(
  source: StemFileHandle,
  destination: ShareDirectoryHandle,
  path: string,
): Promise<void> {
  if (typeof source.getFile !== 'function') {
    throw new Error(`Cannot read source stem file for ${path}`);
  }
  await writeFileAtPath(destination, path, await source.getFile());
}
