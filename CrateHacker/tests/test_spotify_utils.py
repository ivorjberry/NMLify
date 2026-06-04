import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
import spotify_utils as su
from spotify_utils import verify_spotify_link


class TestVerifySpotifyLink:
    def test_valid_link(self):
        assert verify_spotify_link('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M') is True

    def test_valid_link_with_query(self):
        assert verify_spotify_link('https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123') is True

    def test_empty_string(self):
        assert verify_spotify_link('') is False

    def test_none(self):
        assert verify_spotify_link(None) is False

    def test_random_url(self):
        assert verify_spotify_link('https://google.com') is False

    def test_non_playlist_spotify_url(self):
        assert verify_spotify_link('https://open.spotify.com/track/abc123') is False

    def test_substring_injection(self):
        # Old code would pass this — just checking substrings "spotify" and "playlist"
        assert verify_spotify_link('https://evil.com?spotify=true&playlist=yes') is False

    def test_whitespace(self):
        assert verify_spotify_link('  https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M  ') is True


class _FakeSpotify:
    """Minimal stub for spotipy.Spotify covering the calls get_playlist_info makes."""

    def __init__(self, pages):
        # pages: list of dicts mimicking the Web API response shape
        self._pages = pages
        self.playlist_tracks_calls = 0
        self.next_calls = 0

    def playlist_tracks(self, playlist, fields=None):
        self.playlist_tracks_calls += 1
        self._last_fields = fields
        return self._pages[0]

    def next(self, response):
        self.next_calls += 1
        # Index of current page = number of times next() has been called
        return self._pages[self.next_calls]


class TestGetPlaylistInfo:
    def test_includes_next_in_fields_filter(self, monkeypatch):
        fake = _FakeSpotify([{'items': [], 'next': None}])
        monkeypatch.setattr(su, 'sp', fake)
        su.get_playlist_info('https://open.spotify.com/playlist/abc')
        assert 'next' in fake._last_fields

    def test_walks_all_pages(self, monkeypatch):
        page1 = {
            'items': [{'track': {'name': 'A', 'artists': [{'name': 'X'}]}}],
            'next': 'https://api.spotify.com/v1/playlists/abc/tracks?offset=100',
        }
        page2 = {
            'items': [{'track': {'name': 'B', 'artists': [{'name': 'Y'}]}}],
            'next': None,
        }
        fake = _FakeSpotify([page1, page2])
        monkeypatch.setattr(su, 'sp', fake)
        result = su.get_playlist_info('https://open.spotify.com/playlist/abc')
        assert [it['track']['name'] for it in result['items']] == ['A', 'B']
        assert fake.next_calls == 1

    def test_drops_none_tracks(self, monkeypatch):
        page = {
            'items': [
                {'track': {'name': 'A', 'artists': [{'name': 'X'}]}},
                {'track': None},  # locally-saved / removed / unavailable
                None,             # malformed
                {'track': {'name': 'B', 'artists': [{'name': 'Y'}]}},
            ],
            'next': None,
        }
        monkeypatch.setattr(su, 'sp', _FakeSpotify([page]))
        result = su.get_playlist_info('https://open.spotify.com/playlist/abc')
        assert [it['track']['name'] for it in result['items']] == ['A', 'B']
