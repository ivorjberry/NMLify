import spotipy
import os
import re
from dotenv import load_dotenv
from spotipy.oauth2 import SpotifyClientCredentials

load_dotenv()

# Initialize Spotify API globally
sp = spotipy.Spotify(
    auth_manager=SpotifyClientCredentials(client_id=os.getenv("SPOTIFY_CLIENT_ID"),
                                            client_secret=os.getenv("SPOTIFY_CLIENT_SECRET")))

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
    # Get playlist tracks from provided playlist id or playlist link
    results = sp.playlist_tracks(playlist, fields="items(track(name,artists(name)))")
    tracks = results

    # Paginate through all tracks
    while results['next']:
        results = sp.next(results)
        tracks['items'].extend(results['items'])

    return tracks

def verify_spotify_link(spotify_link):
    # Validate that the link is a proper Spotify playlist URL
    if not spotify_link or not spotify_link.strip():
        return False
    # Match open.spotify.com/playlist/<id> or spotify:playlist:<id>
    return bool(re.match(
        r'^https?://open\.spotify\.com/playlist/[a-zA-Z0-9]+',
        spotify_link.strip()
    ))