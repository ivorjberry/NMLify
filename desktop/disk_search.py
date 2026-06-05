import os
import re
import ntpath
from collections import defaultdict
from thefuzz import fuzz

from app_logging import get_logger
from text_utils import tokenize as _tokenize

log = get_logger(__name__)

AUDIO_EXTENSIONS = frozenset({
    '.mp3', '.m4a', '.flac', '.wav', '.aiff', '.aif',
    '.ogg', '.wma', '.alac', '.opus',
})

# Regex to strip leading track numbers like "01 ", "01. ", "01 - ", "1-"
_TRACK_NUM_RE = re.compile(r'^\d{1,3}[\s.\-]+')


def parse_filename(filepath):
    """Extract a cleaned track name from a filename.
    
    Strips extension, leading track numbers, and common separators.
    """
    name = os.path.splitext(os.path.basename(filepath))[0]
    # Strip leading track numbers
    name = _TRACK_NUM_RE.sub('', name)
    # Replace underscores and multiple spaces
    name = name.replace('_', ' ')
    name = re.sub(r'\s+', ' ', name).strip()
    return name


def scan_directories(directories, extensions=None):
    """Walk directories recursively and yield (filepath, parsed_name) for audio files.
    
    Args:
        directories: List of directory paths to scan.
        extensions: Set of extensions to match (default: AUDIO_EXTENSIONS).
    
    Yields:
        (filepath, parsed_name) tuples.
    """
    if extensions is None:
        extensions = AUDIO_EXTENSIONS

    for directory in directories:
        if not os.path.isdir(directory):
            log.warning("Skipping non-existent search directory: %s", directory)
            continue
        for root, _dirs, files in os.walk(directory):
            for filename in files:
                ext = os.path.splitext(filename)[1].lower()
                if ext in extensions:
                    filepath = os.path.join(root, filename)
                    parsed_name = parse_filename(filepath)
                    yield filepath, parsed_name


def _tokenize_local(text):
    """Backward-compat shim — call text_utils.tokenize directly in new code."""
    return _tokenize(text)


def build_file_index(file_list):
    """Build an inverted index from parsed filenames.
    
    Args:
        file_list: List of (filepath, parsed_name) tuples.
    
    Returns:
        Token-to-index-set mapping.
    """
    index = defaultdict(set)
    for i, (_filepath, parsed_name) in enumerate(file_list):
        for token in _tokenize(parsed_name):
            index[token].add(i)
    return index


def _get_candidates(text, index, total_files):
    """Get candidate file indices that share at least one token with text."""
    tokens = _tokenize(text)
    if not tokens:
        return set(range(total_files))
    candidates = set()
    for token in tokens:
        candidates.update(index.get(token, set()))
    return candidates


def fuzzy_match_files(not_found_tracks, file_list, fuzzy_ratio, file_index=None,
                      progress_callback=None):
    """Match not-found Spotify tracks against disk files using fuzzy matching.

    Args:
        not_found_tracks: List of "Artist - Title" strings from collection search.
        file_list: List of (filepath, parsed_name) tuples from scan_directories.
        fuzzy_ratio: Minimum fuzzy match score (0-100).
        file_index: Optional token index from build_file_index().
        progress_callback: Optional callable ``progress_callback(done, total)``
            invoked once per track. Safe to call from worker threads.

    Returns:
        Dict mapping track_name -> list of {'filepath': str, 'parsed_name': str, 'score': int}
    """
    results = {}
    total_files = len(file_list)
    total_tracks = len(not_found_tracks)

    for i, track_str in enumerate(not_found_tracks):
        # track_str is "Artist - Title" format from the not-found list
        track_lower = track_str.lower()

        # Pre-filter with index if available
        if file_index is not None:
            candidate_indices = _get_candidates(track_lower, file_index, total_files)
        else:
            candidate_indices = range(total_files)

        matches = []
        for idx in candidate_indices:
            filepath, parsed_name = file_list[idx]
            parsed_lower = parsed_name.lower()
            score = fuzz.ratio(track_lower, parsed_lower)
            # Also check partial containment
            if (score > fuzzy_ratio or
                    track_lower in parsed_lower or
                    parsed_lower in track_lower):
                matches.append({
                    'filepath': filepath,
                    'parsed_name': parsed_name,
                    'score': score,
                })

        if matches:
            matches.sort(key=lambda m: m['score'], reverse=True)
            results[track_str] = matches

        if progress_callback is not None:
            try:
                progress_callback(i + 1, total_tracks)
            except Exception as cb_err:
                log.warning("progress_callback raised (ignored): %s", cb_err)

    return results


def filepath_to_traktor_location(filepath):
    """Convert a Windows filepath to Traktor NML LOCATION attributes.
    
    Traktor stores locations as:
        @VOLUME = "D:" (drive letter with colon)
        @DIR = "/:Music/:subfolder/:"  (forward-slash + colon delimited)
        @FILE = "filename.mp3"
    
    Uses the pure-Python `ntpath` module rather than `os.path` so the splitter
    is always Windows-flavoured. That keeps the function deterministic on
    Linux/macOS CI runners (where `os.path` would fall back to POSIX and
    treat the drive letter as part of the filename), and on Windows the
    behaviour is identical to before.
    
    Args:
        filepath: Absolute Windows file path.
    
    Returns:
        Dict with @VOLUME, @DIR, @FILE keys.
    """
    drive, tail = ntpath.splitdrive(filepath)
    # drive = "D:", tail = "\\Music\\subfolder\\filename.mp3"
    
    directory = ntpath.dirname(tail)
    filename = ntpath.basename(tail)
    
    # Convert "\\Music\\subfolder" to "/:Music/:subfolder/:"
    parts = directory.replace('\\', '/').strip('/').split('/')
    if parts and parts[0]:
        traktor_dir = '/:' + '/:'.join(parts) + '/:'
    else:
        traktor_dir = '/:'
    
    return {
        '@VOLUME': drive,
        '@DIR': traktor_dir,
        '@FILE': filename,
    }


def disk_match_to_entry(filepath, track_name):
    """Create a minimal Traktor ENTRY dict from a disk file match.
    
    This entry has enough structure for write_nml_playlist() to work.
    
    Args:
        filepath: Absolute path to the audio file.
        track_name: Display name for the track (e.g. "Artist - Title").
    
    Returns:
        Dict mimicking a Traktor collection ENTRY.
    """
    location = filepath_to_traktor_location(filepath)
    
    # Try to split "Artist - Title" into separate fields
    if ' - ' in track_name:
        artist, title = track_name.split(' - ', 1)
    else:
        artist = ''
        title = track_name

    return {
        '@TITLE': title.strip(),
        '@ARTIST': artist.strip(),
        'LOCATION': location,
    }
