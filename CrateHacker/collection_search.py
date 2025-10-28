from thefuzz import fuzz

def fuzzy_search(playlist, collection, fuzzy_ratio):
    # XML entries as dict in collection, tracks to find as dict in playlist
    grouped_results = {}  # Will store grouped results by Spotify track key
    not_found_tracks = []

    total_matches = 0
    for track in playlist['items']:
        spotify_track = track['track']
        artists = ", ".join(item['name'] for item in spotify_track['artists'])
        
        # Create a unique key using track name and artists (more reliable than ID)
        spotify_key = f"{spotify_track['name']}||{artists}"
        
        track_matches = []  # Store all collection matches for this Spotify track
        
        for entry in collection:
            track_title = spotify_track['name'].lower()
            entry_title = entry['@TITLE'].lower()
            if (fuzz.ratio(track_title, entry_title) > fuzzy_ratio or 
            track_title in entry_title or
            entry_title in track_title):
                track_artists = artists.lower()
                try:
                    entry_artists = entry['@ARTIST'].lower()
                except:
                    entry_artists = "Unknown"

                if (fuzz.ratio(track_artists, entry_artists) > fuzzy_ratio or
                track_artists in entry_artists or
                entry_artists in track_artists):
                    # Store this collection match
                    track_matches.append(entry)
        
        if track_matches:
            # Store the grouped result for this Spotify track
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

    # Return grouped results instead of flat list
    return grouped_results, not_found_tracks

def strict_search(results, collection, playlist_name):
    # Create strict file to write to
    strict_file = open("strict_" + playlist_name + ".txt", "w")
    track_count = 0
    for track in results['items']:
        artists = ", ".join(item['name'] for item in track['track']['artists'])
        # Debug print
        #print("Checking track: " + track['track']['name'] + "; Artists: " + artists)
        
        # Check if track is in collection
        print("Checking track: " + track['track']['name'] + "; Artists: " + artists)
        
        for entry in collection:
            if track['track']['name'] == entry['title']:
                # Debug print
                #print(f"Track: {track['track']['name']}; Artists: {artists} is in collection.")
                #print(f"Location: {entry['location']}")
                
                strict_file.write(f"Location: {entry['location']}\n")
                track_count += 1
                break

    print("Found " + str(track_count) + " tracks from playlist in collection.")
    print("STRICT: Done checking playlist tracks in collection.")
