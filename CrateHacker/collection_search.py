from thefuzz import fuzz

def fuzzy_search(playlist, collection, fuzzy_ratio):
    # XML entries as dict in collection, tracks to find as dict in playlist
    traktor_playlist = []
    not_found_tracks = []

    fuzzy_track_count = 0
    for track in playlist['items']:
        artists = ", ".join(item['name'] for item in track['track']['artists'])
        match_found = False
        for entry in collection:
            track_title = track['track']['name'].lower()
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
                    # Copy entire entry to new dict
                    traktor_playlist.append(entry)
                    match_found = True
                    fuzzy_track_count += 1
        
        if not match_found:
            not_found_tracks.append(f"Track not found: {track['track']['name']} by {artists}")

    print("Found " + str(fuzzy_track_count) + " tracks from playlist in collection.")
    print("FUZZY: Done checking playlist tracks in collection.")

    # Playlist holds entire entries of found files
    return traktor_playlist, not_found_tracks

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
