"""Shared text-normalization helpers used by collection and disk search.

Both [collection_search.py](collection_search.py) and [disk_search.py](disk_search.py)
need the same notion of "useful tokens" so their inverted indexes line up. Keep
this module dependency-free so it stays cheap to import.
"""
import re

# Minimum token length to index (skip "a", "of", "the", etc.)
MIN_TOKEN_LEN = 2

# Common words that appear in too many titles to be useful filters.
STOP_WORDS = frozenset({
    'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'and',
    'or', 'is', 'it', 'my', 'me', 'no', 'so', 'do', 'up', 'be',
    'feat', 'ft', 'vs', 'remix', 'mix', 'edit', 'version', 'radio',
    'original', 'extended',
})

_TOKEN_RE = re.compile(r'[a-z0-9]+')


def tokenize(text):
    """Split text into lowercase alphanumeric tokens, dropping stop words and very short ones."""
    if not text:
        return set()
    tokens = _TOKEN_RE.findall(text.lower())
    return {t for t in tokens if len(t) >= MIN_TOKEN_LEN and t not in STOP_WORDS}
