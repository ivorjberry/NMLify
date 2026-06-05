import xmltodict
import os
import re
from dotenv import load_dotenv, set_key

from app_logging import get_logger

load_dotenv()
log = get_logger(__name__)

# Enable dev mode by setting CRATEHACKER_DEV_TEST=1 in your environment or .env.
# When enabled, get_collection_file() returns the bundled test collection so
# developers don't accidentally write over their real Traktor library.
DEV_TEST = os.getenv("CRATEHACKER_DEV_TEST", "").strip().lower() in ("1", "true", "yes", "on")

#############################
# GUI utils                 #
#############################

def get_latest_version_folder(ni_directory):  
    """Get the latest version folder with the name 'Traktor Pro <number>.<number>'. 
    If not found, check the .env for a saved collection location.
    If not found, return the fallback directory."""  
    try:  
        # List all directories in the base directory  
        folders = [d for d in os.listdir(ni_directory) if os.path.isdir(os.path.join(ni_directory, d))]  
          
        # Match folders that start with 'Traktor ' and have a version number suffix  
        version_folders = []  
        for folder in folders:  
            match = re.match(r"Traktor (\d+(\.\d+)*)", folder)  
            if match:  
                version_folders.append((folder, match.group(1)))  # (folder_name, version_string) 
        log.debug("Found Traktor version folders under %s: %s", ni_directory, version_folders)
        # Find the folder with the highest version (using natural sort for version strings)  
        if version_folders:  
            # Sort by version using a custom key to parse the version string into a tuple of integers  
            version_folders.sort(key=lambda x: tuple(map(int, x[1].split('.'))), reverse=True)  
            latest_folder = version_folders[0][0]  # Get the folder name with the highest version  
            return os.path.join(ni_directory, latest_folder)  
        else:
            log.debug("No Traktor version folder under %s; falling back", ni_directory)
            return None  # No version folder found, return None  
    except Exception as e:  
        log.warning("Error finding latest version folder under %s: %s", ni_directory, e)
        return None


def get_collection_file():
    if DEV_TEST:
        log.info("DEV_TEST enabled: using bundled test collection file.")
        return "testfiles/collection.nml"
    # Get the latest version folder, or set to Documents if not found
    fallback_directory = os.path.expanduser("~\\Documents")  # Fallback to Documents if no version folder found
    ni_base_directory = os.path.expanduser("~\\Documents\\Native Instruments")  # NI base directory
    
    latest_version_folder = get_latest_version_folder(ni_base_directory)  

    # First retry in OneDrive folder if no version folder found
    if latest_version_folder == None:
        ni_base_directory = os.path.expanduser("~\\OneDrive\\Documents\\Native Instruments")
        latest_version_folder = get_latest_version_folder(ni_base_directory)

    if latest_version_folder is not None:
        collection_path = os.path.join(latest_version_folder, "collection.nml")
        if os.path.exists(collection_path):
            return collection_path

    # Auto-detection failed — try saved location from .env
    env_collection_file = os.getenv("COLLECTION_FILE")
    if env_collection_file:
        env_path = os.path.abspath(env_collection_file)
        if os.path.exists(env_path):
            log.info("Using saved collection location from .env: %s", env_path)
            return env_path

    # Last resort fallback
    log.warning("No Traktor collection auto-detected; using fallback path %s", fallback_directory)
    return os.path.join(fallback_directory, "collection.nml")

def write_collection_file_location(collection_file):
    # Write last used collection file to .env
    set_key(".env", "COLLECTION_FILE", os.path.abspath(collection_file))

def get_search_dirs():
    """Load saved search directories from .env (pipe-separated)."""
    raw = os.getenv("SEARCH_DIRS", "")
    if not raw:
        return []
    dirs = [d.strip() for d in raw.split("|") if d.strip()]
    # Only return dirs that still exist
    return [d for d in dirs if os.path.isdir(d)]

def save_search_dirs(dirs):
    """Save search directories to .env as pipe-separated string."""
    value = "|".join(os.path.abspath(d) for d in dirs if d.strip())
    set_key(".env", "SEARCH_DIRS", value)

def verify_collection_file(collection_file) -> str:
    # Check if a collection file was provided  
    if collection_file:  
        # Verify provided file is of .nml type
        if not collection_file.endswith(".nml"):
            # Show a error warning the user
            return "Error: Please select a valid .nml file."
    else:  
        # Update the status label if no file was provided  
        return "Error: Please select a valid collection file."
    
    return "Success: Valid collection file provided."

#############################
# Collection utils          #
#############################

def load_collection(file):
    """Parse a Traktor collection.nml file and return the list of <ENTRY> dicts.

    Streams the file straight into xmltodict (no double-buffering) and
    normalizes the result so callers always get a list, even when the
    collection contains a single entry (xmltodict returns a dict in that case)
    or no entries at all.
    """
    with open(file, "rb") as f:
        collection_dict = xmltodict.parse(f)

    entries = collection_dict.get('NML', {}).get('COLLECTION', {}).get('ENTRY')
    if entries is None:
        return []
    if isinstance(entries, dict):
        return [entries]
    return entries

def clean_location(location):
    # Remove any leading or trailing whitespace
    location = location.strip()
    # Replace any forward slashes with backslashes
    location = location.replace("/", "\\")
    # Remove any colons put in by traktor
    location = location.replace(":", "")
    return location

def write_nml_playlist(playlist_name, tracks, output_dir="."):
    """
    Creates a Traktor .nml playlist file from a list of matched track entries,
    including both the COLLECTION and PLAYLISTS sections.

    Args:
        playlist_name (str): The desired name for the playlist.
        tracks (list): A list of track dictionaries, where each dict is a
                       matched ENTRY from the parsed collection.nml.
        output_dir (str, optional): The directory to save the .nml file. Defaults to ".".
    """
    
    # 1. Build the list of PRIMARYKEY entries for the <PLAYLISTS> section
    playlist_key_entries = []
    for track_entry in tracks:
        try:
            # Reconstruct the full file path from the LOCATION attributes
            location = track_entry['LOCATION']
            key_path = f"{location['@VOLUME']}{location['@DIR']}{location['@FILE']}"
            
            # Check if the track is a STEM file by looking for the 'STEMS' key
            key_type = "STEM" if 'STEMS' in track_entry else "TRACK"
            
            # Create the dictionary structure for the PRIMARYKEY entry
            playlist_key_entries.append({
                'PRIMARYKEY': {
                    '@TYPE': key_type,
                    '@KEY': key_path
                }
            })
            
        except KeyError as e:
            log.warning("Skipping track due to missing key %s: %s", e, track_entry)
        except Exception as e:
            log.warning("Error processing track key %s: %s", e, track_entry)

    # 2. Build the final NML dictionary in the correct structure
    # The 'tracks' list (which is selected_tracks) is used directly for the <COLLECTION>
    final_nml_dict = {
        'NML': {
            '@VERSION': '20',
            'HEAD': {
                '@COMPANY': 'www.native-instruments.com',
                '@PROGRAM': 'Traktor Pro 4'
            },
            # This is the missing piece: a <COLLECTION> block with all track metadata
            'COLLECTION': {
                '@ENTRIES': str(len(tracks)),
                'ENTRY': tracks  # 'tracks' is already a list of track entry dicts
            },
            # We also include an empty <SETS> block, just like Traktor's export
            'SETS': {
                '@ENTRIES': '0'
            },
            # This is the <PLAYLISTS> block that references the collection above
            'PLAYLISTS': {
                'NODE': {
                    '@TYPE': 'PLAYLIST',
                    '@NAME': playlist_name,
                    'PLAYLIST': {
                        '@ENTRIES': str(len(playlist_key_entries)),
                        '@TYPE': 'LIST',
                        'ENTRY': playlist_key_entries # The list of PRIMARYKEYs
                    }
                }
            }
        }
    }

    # 3. Convert the entire dictionary back into an XML string
    try:
        # Use xmltodict.unparse to create the full XML document
        # 'pretty=True' makes it human-readable
        # REMOVED encoding="UTF-8" to ensure it returns a standard string (str)
        xml_output = xmltodict.unparse(final_nml_dict, pretty=True, indent="  ")
    except Exception as e:
        log.error("Error unparsing XML for playlist %r: %s", playlist_name, e)
        return None

    # 4. Define and write the final output file
    safe_playlist_name = re.sub(r'[\\/*?:"<>|]', "", playlist_name).strip() or "playlist"
    file_path = os.path.join(output_dir, f"{safe_playlist_name}.nml")

    # Avoid silently clobbering an existing playlist with the same name
    if os.path.exists(file_path):
        counter = 1
        while True:
            candidate = os.path.join(output_dir, f"{safe_playlist_name} ({counter}).nml")
            if not os.path.exists(candidate):
                file_path = candidate
                break
            counter += 1

    try:
        # Write the XML string to the file in TEXT mode ("w")
        # and specify the encoding at the file level.
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(xml_output)
        return file_path
    except Exception as e:
        log.error("Error writing .nml file %s: %s", file_path, e)
        return None