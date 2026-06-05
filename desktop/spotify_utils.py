import spotipy
import os
import re
from dotenv import load_dotenv
from spotipy.oauth2 import SpotifyClientCredentials

load_dotenv()

# Initialise the Spotify client only when credentials are present. This lets
# the module import cleanly in environments without a .env (e.g. CI running
# pytest, where the tests monkeypatch `sp` anyway). Real callers either set
# the env vars in a .env file or supply their own client via monkeypatch.
_client_id = os.getenv("SPOTIFY_CLIENT_ID")
_client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
if _client_id and _client_secret:
    sp = spotipy.Spotify(
        auth_manager=SpotifyClientCredentials(
            client_id=_client_id,
            client_secret=_client_secret,
        )
    )
else:
    sp = None

def get_playlist_id(playlist_link):
    # Extract the playlist ID from the provided link
    if "playlist/" in playlist_link:
        return playlist_link.split("playlist/")[1].split("?")[0]
    else:
        raise ValueError("Invalid Spotify playlist link.")
    
def get_playlist_name(playlist):
    # Get playlist name from provided playlist id or playlist link
    return sp.playlist(playlist)['name']

def get_playlist_info(playlist):
    """Return a dict of the form {'items': [...]} for every track in the playlist.

    Walks all pages of the playlist (Spotify caps each page at 100 tracks) and
    filters out items whose track payload is None — these come back for
    locally-uploaded files, region-restricted tracks, or tracks the owner has
    since removed, and would otherwise crash downstream consumers.
    """
    # 'next' must be included in fields so we can detect more pages
    fields = "items(track(name,artists(name))),next"
    page = sp.playlist_tracks(playlist, fields=fields)
    items = list(page.get('items', []) or [])

    while page.get('next'):
        page = sp.next(page)
        items.extend(page.get('items', []) or [])

    # Drop entries with no track payload (deleted/local/unavailable)
    items = [item for item in items if item and item.get('track')]
    return {'items': items}

def verify_spotify_link(spotify_link):
    # Validate that the link is a proper Spotify playlist URL
    if not spotify_link or not spotify_link.strip():
        return False
    # Match open.spotify.com/playlist/<id> or spotify:playlist:<id>
    return bool(re.match(
        r'^https?://open\.spotify\.com/playlist/[a-zA-Z0-9]+',
        spotify_link.strip()
    ))