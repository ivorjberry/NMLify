from collections import defaultdict
from thefuzz import fuzz

from app_logging import get_logger
from text_utils import tokenize as _tokenize

log = get_logger(__name__)


def build_collection_index(collection):
    """
    Build an inverted index mapping tokens to collection entry indices.
    Returns (title_index, artist_index) where each maps token -> set of indices.
    """
    title_index = defaultdict(set)
    artist_index = defaultdict(set)

    for i, entry in enumerate(collection):
        for token in _tokenize(entry.get('@TITLE', '')):
            title_index[token].add(i)
        for token in _tokenize(entry.get('@ARTIST', '')):
            artist_index[token].add(i)

    return title_index, artist_index


def _get_candidates(text, index, collection_size):
    """Get candidate entry indices that share at least one token with text."""
    tokens = _tokenize(text)
    if not tokens:
        # No usable tokens — fall back to full scan
        return set(range(collection_size))

    candidates = set()
    for token in tokens:
        candidates.update(index.get(token, set()))
    return candidates


def fuzzy_search(playlist, collection, fuzzy_ratio, title_index=None, artist_index=None,
                 progress_callback=None):
    """
    Search for playlist tracks in the collection using fuzzy matching.

    If title_index/artist_index are provided (from build_collection_index),
    uses token-based pre-filtering to avoid O(n*m) comparisons.

    If progress_callback is provided, it is invoked as
    ``progress_callback(done, total)`` once per processed track. Safe to call
    from a worker thread — keep the callback fast and non-blocking.
    """
    grouped_results = {}
    not_found_tracks = []

    use_index = title_index is not None and artist_index is not None
    collection_size = len(collection)

    total_tracks = len(playlist['items'])
    total_matches = 0
    for i, track in enumerate(playlist['items']):
        spotify_track = track['track']
        artists = ", ".join(item['name'] for item in spotify_track['artists'])

        spotify_key = f"{spotify_track['name']}||{artists}"
        track_title = spotify_track['name'].lower()
        track_artists = artists.lower()

        # Pre-filter candidates using token index, or scan all entries
        if use_index:
            title_candidates = _get_candidates(track_title, title_index, collection_size)
            artist_candidates = _get_candidates(track_artists, artist_index, collection_size)
            # Entries that share tokens with EITHER title or artist
            candidate_indices = title_candidates | artist_candidates
        else:
            candidate_indices = range(collection_size)

        track_matches = []

        for idx in candidate_indices:
            entry = collection[idx]
            entry_title = entry.get('@TITLE', '').lower()
            title_score = fuzz.ratio(track_title, entry_title)
            if (title_score > fuzzy_ratio or
            track_title in entry_title or
            entry_title in track_title):
                try:
                    entry_artists = entry['@ARTIST'].lower()
                except (KeyError, AttributeError):
                    entry_artists = "Unknown"

                artist_score = fuzz.ratio(track_artists, entry_artists)
                if (artist_score > fuzzy_ratio or
                track_artists in entry_artists or
                entry_artists in track_artists):
                    combined_score = (title_score + artist_score) // 2
                    track_matches.append({'entry': entry, 'score': combined_score})

        if track_matches:
            track_matches.sort(key=lambda m: m['score'], reverse=True)
            grouped_results[spotify_key] = {
                'spotify_track': spotify_track,
                'spotify_artists': artists,
                'collection_matches': track_matches
            }
            total_matches += len(track_matches)
        else:
            # Use a clean "Artist - Title" form so downstream disk-search
            # fuzzy matching and Traktor ENTRY generation can parse it
            # without stripping a "Track not found:" prefix.
            not_found_tracks.append(f"{artists} - {spotify_track['name']}")

        if progress_callback is not None:
            try:
                progress_callback(i + 1, total_tracks)
            except Exception as cb_err:
                # Never let a UI callback take down the search
                log.warning("progress_callback raised (ignored): %s", cb_err)

    log.info("Fuzzy search complete: %d matches across %d/%d playlist tracks",
             total_matches, len(grouped_results), total_tracks)

    return grouped_results, not_found_tracks

