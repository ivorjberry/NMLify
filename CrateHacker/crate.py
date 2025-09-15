###
# CrateHacker - Convert spotify playlists to m3u playlists
###
import os
from nicegui import app, ui
from nicegui.events import ValueChangeEventArguments
import spotify_utils as utils
import collection_search as search
import collection_utils as col
import shutil

#############################
# GUI callbacks             #
#############################

async def browse_file():  
    # Browse for a collection file
    collection_file = await app.native.main_window.create_file_dialog()
    print(f"Collection file selected: {collection_file}")
    collection_entry.set_value(collection_file) 


def preview_playlist():
    """Display playlist title from Spotify playlist entry."""  
    playlist = spotify_entry.value
    print("Playlist provided: " + playlist)

    # Check if the link is provided and contains the words "spotify" and "playlist"
    if utils.verify_spotify_link(playlist):
        playlist_name = utils.get_playlist_name(playlist)
        preview_label.set_text(f"Preview of playlist title: {playlist_name}")
        preview_label.classes('text-green-8')  
    else:  
        preview_label.set_text(f"Not a valid playlist link")
        preview_label.classes('text-red-12')
    preview_label.visible = True  # Make the preview label visible


def search_collection():  
    """Callback function for the 'Create Playlist' button."""  
    collection_file = collection_entry.value
    spotify_link = spotify_entry.value

    # Check if a collection file was provided  
    status_text = col.verify_collection_file(collection_file)
    update_label(status_label, status_text)
    if "Success" not in status_text:
        status_label.classes('text-red-12')
        return
    
    if not utils.verify_spotify_link(spotify_link):
        update_label(status_label, "Error: Please enter a valid Spotify playlist link.", classes='text-red-12', add_text=False)
        return
    
    try:
        # Copy the file to the directory where the script is running  
        destination = os.path.join(os.getcwd(), os.path.basename(collection_file))
        # If the file already exists at the destination, overwrite it
        if os.path.exists(destination):
            os.remove(destination)
        shutil.copy(collection_file, destination)  
    except Exception as e:  
        # Handle any errors during the file copy  
        update_label(status_label, "Error copying collection file to working directory.", classes='text-red-12', add_text=False)   
        return f"Error copying file: {e}"
    
    
    # Collection now lives at destination
    collection = col.load_collection(destination)
    print(f"Loaded {len(collection)} tracks from collection.")
    update_label(status_label, f"Loaded {len(collection)} tracks from collection.", add_text=True)

    
    # Spotify link already validated. Extract the playlist ID from the URL
    playlist_name = utils.get_playlist_name(spotify_link)
    spotify_results = utils.get_playlist_info(spotify_link)
       
    search_results, not_found_tracks = search.fuzzy_search(spotify_results, collection, fuzzy_slider.value)

    if search_results:
        update_label(status_label, f"\nFound {len(search_results)} of {len(spotify_results['items'])} tracks from playlist in collection with fuzzy ratio {fuzzy_slider.value}.", add_text=True) 
        col.write_m3u(search_results, playlist_name)
        update_label(status_label, f"\nPlaylist '{playlist_name}.m3u' created.", add_text=True)
        # Populate the not found tracks list
        not_found_label.clear()
        update_label(not_found_label, "Tracks not found from playlist in collection:\n", add_text=False)
        for track in not_found_tracks:
            update_label(not_found_label, track + "\n", add_text=True)
    else:
        update_label(status_label, "<br>No tracks found from playlist in collection.", classes='text-red-12') 
        not_found_label.visible = False  # Hide the found tracks list if no tracks found

#############################
# GUI build in main         #
#############################
def update_label(label, value: str, add_text=False, classes=""):
    """Update a label with new text."""
    if add_text:
        label.set_text(label.text + value)
    else:
        label.set_text(value)
    
    if classes:
        print(f"Updating label classes to: {classes}")
        label.classes(classes)
    label.update()

# Main UI controls
ui.label('CrateHacker').classes('text-3xl font-bold')

# Collection file input
ui.label('Traktor Collection File').classes('text-lg')
collection_found = col.get_collection_file()
print(f"Collection file found: {collection_found}")
with ui.row().classes('w-full no-wrap'):
    collection_entry = ui.input(value=collection_found, placeholder='Select collection file...').classes('w-5/6')
    with collection_entry:
        ui.button(color='orange-8', on_click=lambda: collection_entry.set_value(None), icon='delete') \
            .props('flat dense').bind_visibility_from(collection_entry, 'value')
    ui.button('Browse', on_click=browse_file)

# Spotify playlist input
ui.label('Spotify Playlist Link').classes('text-lg')
with ui.row().classes('w-full no-wrap'):
    spotify_entry = ui.input(placeholder='Enter Spotify playlist link...').classes('w-5/6')
    with spotify_entry:
        ui.button(color='orange-8', on_click=lambda: spotify_entry.set_value(None), icon='delete') \
            .props('flat dense').bind_visibility_from(spotify_entry, 'value')
    ui.button('Validate', on_click=preview_playlist)
# Preview label for playlist
preview_label = ui.label("Preview of playlist title: None").classes('text-md text-gray-600')
preview_label.visible = False  # Initially hidden

with ui.row(align_items='center').classes('w-full justify-end'):
    ui.label('Fuzzy search level').classes('text-md')
    fuzzy_slider = ui.slider(min=0, max=100, value=70).classes('w-3/6')
    ui.label().classes('text-sm text-gray-600').bind_text_from(fuzzy_slider, 'value')
    ui.space()
    ui.button("Create playlist", on_click=search_collection)
    ui.button('Quit', on_click=app.shutdown).props('color=red')

status_label = ui.label("Status: Waiting for input...").classes('text-md text-gray-600')
status_label.style('white-space: pre-wrap')
ui.separator()

# Create hidden list for the found tracks
not_found_label = ui.label("Not found tracks will be listed here after search.").classes('text-md text-gray-600')
not_found_label.style('white-space: pre-wrap')

# When clicking Create Playlist button, populate below divider with spotify artist and title, then all possible matches 
# with check boxes next to them
'''
with ui.row():
    ui.checkbox('Checkbox', on_change=show)
    ui.switch('Switch', on_change=show)
ui.radio(['A', 'B', 'C'], value='A', on_change=show).props('inline')
with ui.row():
    ui.input('Text input', on_change=show)
    ui.select(['One', 'Two'], value='One', on_change=show)
ui.button('Quit', on_click=app.shutdown).props('color=red')
'''
ui.run(native=True, window_size= (1024,768), reload=False, title='2Bays Crate Hacker')