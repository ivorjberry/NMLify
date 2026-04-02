import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
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
