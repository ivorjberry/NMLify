/**
 * Spotify Web API helpers — playlist id extraction + paginated fetch.
 * Pure (no DOM); the caller wires status / progress UI.
 */

const API_URL = 'https://api.spotify.com/v1';
const PLAYLIST_ID_RE = /open\.spotify\.com\/playlist\/([a-zA-Z0-9]+)/;

export interface SpotifyArtistRef {
  name: string;
}

export interface SpotifyTrackRef {
  name: string;
  artists: SpotifyArtistRef[];
}

export interface PlaylistMeta {
  name: string;
  owner: { display_name: string };
  tracks: { total: number };
}

export interface FetchedPlaylist {
  meta: PlaylistMeta;
  tracks: SpotifyTrackRef[];
}

export type FetchProgress = (loaded: number, total: number) => void;

/** Extract a Spotify playlist id from a full open.spotify.com URL. */
export function extractPlaylistId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(PLAYLIST_ID_RE);
  return match ? match[1]! : null;
}

async function spotifyGet<T>(url: string, token: string): Promise<T> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new Error(`Spotify ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

/**
 * Fetch a playlist's metadata + every track across all pages.
 * `onProgress(loaded, total)` is invoked after each page; errors thrown from
 * it are swallowed so a flaky listener can't abort the fetch.
 */
export async function fetchPlaylist(
  playlistId: string,
  token: string,
  onProgress?: FetchProgress,
): Promise<FetchedPlaylist> {
  const meta = await spotifyGet<PlaylistMeta>(
    `${API_URL}/playlists/${playlistId}?fields=name,owner(display_name),tracks(total)`,
    token,
  );

  interface TracksPage {
    items: { track: SpotifyTrackRef | null }[];
    next: string | null;
  }

  const tracks: SpotifyTrackRef[] = [];
  let url: string | null =
    `${API_URL}/playlists/${playlistId}/tracks?fields=items(track(name,artists(name))),next&limit=100`;
  while (url) {
    const page: TracksPage = await spotifyGet<TracksPage>(url, token);
    for (const item of page.items ?? []) {
      if (item?.track) tracks.push(item.track);
    }
    url = page.next;
    if (onProgress) {
      try {
        onProgress(tracks.length, meta.tracks.total);
      } catch {
        // Listener errors must not abort the fetch.
      }
    }
  }

  return { meta, tracks };
}
