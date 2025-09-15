import xmltodict
import os
import json
import re
from dotenv import set_key

write_filename = "crate_collection"
DEV_TEST = False  # Set to True to use test collection file

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
        print(f"Found version folders: {version_folders}")
        # Find the folder with the highest version (using natural sort for version strings)  
        if version_folders:  
            # Sort by version using a custom key to parse the version string into a tuple of integers  
            version_folders.sort(key=lambda x: tuple(map(int, x[1].split('.'))), reverse=True)  
            latest_folder = version_folders[0][0]  # Get the folder name with the highest version  
            return os.path.join(ni_directory, latest_folder)  
        else:
            print("No saved collection location found. Use fallback directory.")
            return None  # No version folder found, return None  
    except Exception as e:  
        print(f"Error finding latest version folder: {e}")  
        return None


def get_collection_file():
    if DEV_TEST:
        print("DEV TEST: Using test collection file.")
        return "testfiles/collection.nml"
    # Get the latest version folder, or set to Documents if not found
    fallback_directory = os.path.expanduser("~\\Documents")  # Fallback to Documents if no version folder found
    ni_base_directory = os.path.expanduser("~\\Documents\\Native Instruments")  # NI base directory
    
    latest_version_folder = get_latest_version_folder(ni_base_directory)  

    # First retry in OneDrive folder if no version folder found
    if latest_version_folder == None:
        ni_base_directory = os.path.expanduser("~\\OneDrive\\Documents\\Native Instruments")
        latest_version_folder = get_latest_version_folder(ni_base_directory)

    if latest_version_folder is None:
        print("No version folder found. Using fallback directory.")
        latest_version_folder = fallback_directory
    """env_collection_directory = os.getenv("COLLECTION_FILE")  # Check if collection file is saved in .env
    # If env file has a higher version, use that
    if env_collection_directory:
        env_collection_directory = os.path.abspath(env_collection_directory)
        if os.path.exists(env_collection_directory):
            latest_version_folder = env_collection_directory
    # If latest version folder is None or does not exist, use fallback directory
    # This is to ensure that if the latest version folder is not found, we still have a valid path to return.
    # If the latest version folder is None or does not exist, we will use the fallback  
    if latest_version_folder is None or not os.path.exists(latest_version_folder):

    if env_collection_directory:
            # Set to filepath from .env
            default_collection_filepath = os.path.abspath(env_collection_directory)
        else:
            default_collection_filepath = fallback_directory  # Fallback to Documents 
    else:
        default_collection_filepath = os.path.join(latest_version_folder, "collection.nml") 
"""
    return os.path.join(latest_version_folder, "collection.nml") 

def write_collection_file_location(collection_file):
    # Write last used collection file to .env
    set_key(".env", "COLLECTION_FILE", os.path.abspath(collection_file))

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

def load_collection(file, write_json=False, write_xml=False):
    # Load collection xml into a dictionary
    with open(file, "r", encoding='utf-8') as f:
        data = f.read()
    
    collection_dict = xmltodict.parse(data)
    entries = collection_dict['NML']['COLLECTION']['ENTRY']
    
    return entries
"""
    # Create a dictionary for each track in the collection
    collection = []
    total_errors = 0
    for entry in entries:
        try:
            track = {}
            track['title'] = entry['@TITLE']
            # Artist might not exist for some tracks
            if '@ARTIST' in entry:           
                track['artist'] = entry['@ARTIST']
            # Clean up location string to standardize
            location = entry['LOCATION']['@DIR'] + entry['LOCATION']['@FILE']
            track['location'] = entry['LOCATION']['@VOLUME'] + clean_location(location)
            collection.append(track)
        except:
            if total_errors == 0:
                print("Error loading tracks from collection.") 
                # Delete old error file
                if os.path.exists("error.txt"):
                    os.remove("error.txt")
            
            total_errors += 1
            # Write to error file
            with open("error.txt", "a") as ef:
                ef.write(f"Error writing track to file: " + entry['@TITLE'] + "\n")
        
    print(f"Loaded {len(collection)} out of {len(entries)} tracks from collection.\n")
    if total_errors > 0:
            print(f"Total errors: {total_errors}")

    print("Done loading collection.\n")

    # Write track title, artist, and location
    if write_json:
        write_json(collection)
    
    if write_xml:
        write_xml(collection)    
 
    return collection, total_errors
"""
def clean_location(location):
    # Remove any leading or trailing whitespace
    location = location.strip()
    # Replace any forward slashes with backslashes
    location = location.replace("/", "\\")
    # Remove any colons put in by traktor
    location = location.replace(":", "")
    return location

def write_json(collection):
    filename = write_filename + ".json"

    # Delete the json file if it exists
    if os.path.exists(filename):
        os.remove(filename)
        
    # Write track title, artist, and location from entries to json file
    with open("collection.json", "w") as f:
        json.dump(collection, f, indent=2)
    print("Wrote collection to json file.\n")

def write_xml(collection):
    filename = write_filename + ".xml"

    # Delete the xml file if it exists
    if os.path.exists(filename):
        os.remove(filename)
    
    # Write track title, artist, and location from entries to xml file
    with open("collection.xml", "w", encoding='utf-8') as f:
        f.write("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n")
        f.write("<COLLECTION>")
        for track in collection:
            f.write(f"<TRACK TITLE=\"{track['title']}\" ARTIST=\"{track['artist']}\" LOCATION=\"{track['location']}\">")
            f.write(f"</TRACK>\n")
        f.write("</COLLECTION>\n")
    print("Wrote collection to xml file.\n")

def write_m3u(playlist, playlist_name):
    filename = playlist_name + ".m3u"

    # Delete the m3u file if it exists
    if os.path.exists(filename):
        os.remove(filename)
    
    # Write only location from entries to m3u file
    with open(filename, "w", encoding='utf-8') as f:
        for track in playlist:
            f.write(f"{track['LOCATION']['@VOLUME']}{clean_location(track['LOCATION']['@DIR'] + track['LOCATION']['@FILE'])}\n")
            
    
    print(f"Wrote playlist to m3u file: {filename}\n")