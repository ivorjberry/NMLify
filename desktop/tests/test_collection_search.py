import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from collection_search import build_collection_index, fuzzy_search, _tokenize


# --- Fixtures ---

@pytest.fixture
def sample_collection():
    """A small collection mimicking parsed NML entries."""
    return [
        {'@TITLE': 'Mixed Bizness', '@ARTIST': 'Beck',
         'LOCATION': {'@DIR': '/:Music/:', '@FILE': '03 Mixed Bizness.mp3', '@VOLUME': 'D:'}},
        {'@TITLE': 'Crazy In Love', '@ARTIST': 'Beyoncé',
         'LOCATION': {'@DIR': '/:Music/:', '@FILE': '01 Crazy In Love.m4a', '@VOLUME': 'D:'}},
        {'@TITLE': 'Gut Feeling', '@ARTIST': 'Devo',
         'LOCATION': {'@DIR': '/:Music/:', '@FILE': '13 Gut Feeling.mp3', '@VOLUME': 'D:'}},
        {'@TITLE': 'Crazy', '@ARTIST': 'Gnarls Barkley',
         'LOCATION': {'@DIR': '/:Music/:', '@FILE': '01 Crazy.mp3', '@VOLUME': 'D:'}},
    ]


def _make_playlist(tracks):
    """Build a minimal Spotify-style playlist dict from (title, artist) tuples."""
    items = []
    for title, artist in tracks:
        items.append({
            'track': {
                'name': title,
                'artists': [{'name': artist}],
            }
        })
    return {'items': items}


# --- Tokenizer tests ---

class TestTokenize:
    def test_basic(self):
        tokens = _tokenize('Crazy In Love')
        assert 'crazy' in tokens
        assert 'love' in tokens
        # 'in' is a stop word
        assert 'in' not in tokens

    def test_strips_punctuation(self):
        tokens = _tokenize("Rock'n'Roll!! (Remix)")
        assert 'rock' in tokens
        assert 'roll' in tokens
        # 'remix' is a stop word
        assert 'remix' not in tokens

    def test_empty(self):
        assert _tokenize('') == set()


# --- Index tests ---

class TestBuildIndex:
    def test_returns_indices(self, sample_collection):
        title_idx, artist_idx = build_collection_index(sample_collection)
        # 'crazy' should map to entries 1 and 3
        assert 1 in title_idx['crazy']
        assert 3 in title_idx['crazy']
        # 'beck' should map to entry 0
        assert 0 in artist_idx['beck']

    def test_empty_collection(self):
        title_idx, artist_idx = build_collection_index([])
        assert len(title_idx) == 0
        assert len(artist_idx) == 0


# --- Fuzzy search tests ---

class TestFuzzySearch:
    def test_exact_match(self, sample_collection):
        playlist = _make_playlist([('Crazy In Love', 'Beyoncé')])
        title_idx, artist_idx = build_collection_index(sample_collection)

        results, not_found = fuzzy_search(playlist, sample_collection, 70, title_idx, artist_idx)

        assert len(not_found) == 0
        assert len(results) == 1
        match = list(results.values())[0]
        assert match['collection_matches'][0]['entry']['@TITLE'] == 'Crazy In Love'
        assert match['collection_matches'][0]['score'] >= 70

    def test_no_match(self, sample_collection):
        playlist = _make_playlist([('Nonexistent Song', 'Nobody')])
        title_idx, artist_idx = build_collection_index(sample_collection)

        results, not_found = fuzzy_search(playlist, sample_collection, 70, title_idx, artist_idx)

        assert len(results) == 0
        assert len(not_found) == 1

    def test_fuzzy_match_lower_threshold(self, sample_collection):
        # 'Crazy in Luv' should fuzzy-match 'Crazy In Love' at a lower threshold
        playlist = _make_playlist([('Crazy in Luv', 'Beyoncé')])
        title_idx, artist_idx = build_collection_index(sample_collection)

        results, not_found = fuzzy_search(playlist, sample_collection, 50, title_idx, artist_idx)

        assert len(results) >= 1

    def test_works_without_index(self, sample_collection):
        """Falls back to full scan when no index provided."""
        playlist = _make_playlist([('Mixed Bizness', 'Beck')])

        results, not_found = fuzzy_search(playlist, sample_collection, 70)

        assert len(results) == 1
        assert len(not_found) == 0

    def test_missing_artist_field(self):
        """Entries without @ARTIST should not crash."""
        collection = [
            {'@TITLE': 'Mystery Track',
             'LOCATION': {'@DIR': '/:Music/:', '@FILE': 'mystery.mp3', '@VOLUME': 'D:'}},
        ]
        playlist = _make_playlist([('Mystery Track', 'Someone')])

        results, not_found = fuzzy_search(playlist, collection, 70)
        # Should still return or not-found, but not crash
        assert isinstance(results, dict)
        assert isinstance(not_found, list)

    def test_not_found_uses_artist_dash_title_format(self, sample_collection):
        """Not-found entries are clean 'Artist - Title' so the disk search and
        disk_match_to_entry can parse them without stripping a prefix."""
        playlist = _make_playlist([('Imaginary Track', 'Imaginary Artist')])
        results, not_found = fuzzy_search(playlist, sample_collection, 70)
        assert len(not_found) == 1
        assert not_found[0] == 'Imaginary Artist - Imaginary Track'
        assert not not_found[0].lower().startswith('track not found')

    def test_progress_callback_invoked_per_track(self, sample_collection):
        playlist = _make_playlist([
            ('Crazy In Love', 'Beyoncé'),
            ('Nope', 'Nobody'),
            ('Mixed Bizness', 'Beck'),
        ])
        calls = []
        fuzzy_search(playlist, sample_collection, 70,
                     progress_callback=lambda done, total: calls.append((done, total)))
        assert calls == [(1, 3), (2, 3), (3, 3)]

    def test_progress_callback_errors_are_swallowed(self, sample_collection):
        playlist = _make_playlist([('Crazy In Love', 'Beyoncé')])

        def boom(done, total):
            raise RuntimeError("UI thread is grumpy")

        # Should not raise — callback errors must not abort the search
        results, _ = fuzzy_search(playlist, sample_collection, 70, progress_callback=boom)
        assert len(results) == 1
