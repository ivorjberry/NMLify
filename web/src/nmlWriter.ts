/**
 * Node-only helper that writes a playlist .nml to disk with the same
 * collision-suffix behavior as desktop/collection_utils.write_nml_playlist.
 *
 * Kept in its own file so the browser bundle (which uses {@link buildNmlPlaylist}
 * + a download anchor instead) never pulls in `node:fs`.
 */
import { access, mkdir, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

import { buildNmlPlaylist, type NmlEntry, sanitizePlaylistFilename } from './nml';

async function pathExists(p: string): Promise<boolean> {
  try {
    await access(p, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function writeNmlPlaylist(
  playlistName: string,
  tracks: NmlEntry[],
  outputDir = '.',
): Promise<string | null> {
  const safeName = sanitizePlaylistFilename(playlistName);
  let filePath = join(outputDir, `${safeName}.nml`);
  if (await pathExists(filePath)) {
    let counter = 1;
    // Cap the loop defensively so a misconfigured fs can't spin forever.
    while (counter < 10_000) {
      const candidate = join(outputDir, `${safeName} (${counter}).nml`);
      if (!(await pathExists(candidate))) {
        filePath = candidate;
        break;
      }
      counter += 1;
    }
  }

  try {
    const xml = buildNmlPlaylist(playlistName, tracks);
    await mkdir(outputDir, { recursive: true });
    await writeFile(filePath, xml, 'utf-8');
    return filePath;
  } catch {
    return null;
  }
}
