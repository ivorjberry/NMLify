import re
from collections import defaultdict
from thefuzz import fuzz

# Minimum token length to index (skip "a", "of", "the", etc.)
_MIN_TOKEN_LEN = 2
# Common words that appear in too many titles to be useful filters
_STOP_WORDS = frozenset({
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and',
    'or', 'is', 'it', 'my', 'me', 'no', 'so', 'do', 'up', 'be',
    'feat', 'ft', 'vs', 'remix', 'mix', 'edit', 'version', 'radio',
    'original', 'extended',
})

def _tokenize(text):
    """Split text into lowercase alphanumeric tokens, filtering noise."""
    tokens = re.findall(r'[a-z0-9]+', text.lower())
    return {t for t in tokens if len(t) >= _MIN_TOKEN_LEN and t not in _STOP_WORDS}


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


def fuzzy_search(playlist, collection, fuzzy_ratio, title_index=None, artist_index=None):
    """
    Search for playlist tracks in the collection using fuzzy matching.
    
    If title_index/artist_index are provided (from build_collection_index),
    uses token-based pre-filtering to avoid O(n*m) comparisons.
    """
    grouped_results = {}
    not_found_tracks = []

    use_index = title_index is not None and artist_index is not None
    collection_size = len(collection)

    total_matches = 0
    for track in playlist['items']:
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
            not_found_tracks.append(f"Track not found: {spotify_track['name']} by {artists}")

    print("Found " + str(total_matches) + " matches for " + str(len(grouped_results)) + " Spotify tracks in collection.")
    print("FUZZY: Done checking playlist tracks in collection.")

    return grouped_results, not_found_tracks

