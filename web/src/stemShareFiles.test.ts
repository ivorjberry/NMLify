import { describe, expect, it } from 'vitest';

import {
  copyFileToPath,
  readTextAtPath,
  type ShareDirectoryHandle,
  type ShareFileHandle,
  writeFileAtPath,
} from './stemShareFiles';

class FakeFileHandle implements ShareFileHandle {
  readonly kind = 'file' as const;
  content = '';

  constructor(readonly name: string) {}

  async getFile(): Promise<File> {
    return new File([this.content], this.name);
  }

  async createWritable(): Promise<FileSystemWritableFileStream> {
    const target = this;
    return {
      async write(data: FileSystemWriteChunkType) {
        if (typeof data === 'string') target.content = data;
        else if (data instanceof Blob) target.content = await data.text();
        else throw new Error('Unsupported fake write');
      },
      async close() {},
      async abort() {},
    } as unknown as FileSystemWritableFileStream;
  }
}

class FakeDirectoryHandle implements ShareDirectoryHandle {
  readonly directories = new Map<string, FakeDirectoryHandle>();
  readonly files = new Map<string, FakeFileHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(
    name: string,
    options?: { create?: boolean },
  ): Promise<FakeDirectoryHandle> {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing directory ${name}`);
    const created = new FakeDirectoryHandle(name);
    this.directories.set(name, created);
    return created;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FakeFileHandle> {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options?.create) throw new Error(`Missing file ${name}`);
    const created = new FakeFileHandle(name);
    this.files.set(name, created);
    return created;
  }
}

describe('stem share filesystem helpers', () => {
  it('writes and reads nested package paths', async () => {
    const root = new FakeDirectoryHandle('package');
    await writeFileAtPath(root, 'GeneratedStems/079/stem.stem.mp4', 'stem bytes');
    expect(await readTextAtPath(root, 'GeneratedStems/079/stem.stem.mp4')).toBe('stem bytes');
  });

  it('copies a source file to a package path', async () => {
    const source = new FakeFileHandle('source.stem.mp4');
    source.content = 'audio';
    const destination = new FakeDirectoryHandle('destination');
    await copyFileToPath(source, destination, '079/output.stem.mp4');
    expect(await readTextAtPath(destination, '079/output.stem.mp4')).toBe('audio');
  });

  it('rejects path traversal', async () => {
    const root = new FakeDirectoryHandle('package');
    await expect(writeFileAtPath(root, '../outside.txt', 'bad')).rejects.toThrow(
      'Invalid package path',
    );
  });
});
