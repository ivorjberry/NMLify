###
# CrateHacker - Convert spotify playlists to m3u playlists
###
import os
from nicegui import app, ui
from nicegui.events import ValueChangeEventArguments
import crate_utils as utils
import spotify_utils as spotify
import collection_search as search
import collection_import as imp

collection_entry = "HI"  # Placeholder for collection file entry

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
    spotify_link = spotify_entry.get()
    preview_label.config(text="Checking playlist...", fg="blue")
    preview_label.update_idletasks()
    
    # Check if the link is provided and contains the words "spotify" and "playlist"
    if utils.verify_spotify_link(spotify_link):
        # Extract the playlist ID from the URL
        playlist_id = utils.get_playlist_id(spotify_link)
        playlist_name = utils.get_playlist_name(playlist_id)
        preview_label.config(text=f"Playlist to search: {playlist_name}", fg="blue")  
    else:  
        preview_label.config(text="Please enter a Spotify playlist link.", fg="red")  


def create_playlist():  
    """Callback function for the 'Create Playlist' button."""  
    # Get the text from the two entry fields  
    collection_file = collection_entry.get()  
    spotify_link = spotify_entry.get()  
  
    # Check if a collection file was provided  
    status_text = utils.verify_collection_file(collection_file)
    if "Success" not in status_text:
        status_label.config(text=status_text, fg="red")
        return
    
    if not utils.verify_spotify_link(spotify_link):
        status_label.config(text="Error: Please enter a valid Spotify playlist link.", fg="red")
        return
    
    try:
        # Copy the file to the directory where the script is running  
        destination = os.path.join(os.getcwd(), os.path.basename(collection_file))  
        shutil.copy(collection_file, destination)  
    except Exception as e:  
        # Handle any errors during the file copy  
        return f"Error copying file: {e}"
    
    
    # Collection now lives at destination
    status_label.config(text="Valid collection copied to working directory.\nLoading collection...", fg="blue")
    status_label.update_idletasks()
    collection = imp.load_collection(destination)
    status_text += f"\nLoaded {len(collection)} tracks from collection."
    status_label.config(text=status_text, fg="blue")
    status_label.update_idletasks()
    
    
    # Spotify link already validated. Extract the playlist ID from the URL
    playlist_id = utils.get_playlist_id(spotify_link)
    playlist_name = utils.sp.playlist(playlist_id)['name']
    results = utils.get_playlist_info(playlist_id)
        
    fuzzy_ratio = fuzzy_slider.get()  
    playlist = search.fuzzy_search(results, collection, fuzzy_ratio)

    # Playlist contains entire entries of found files as dict
    write_sucess = utils.write_traktor_playlist(playlist_name, playlist)

    if write_sucess:
        status_text = status_label.cget("text") + f"\nFound {len(playlist)} tracks from playlist in collection with fuzzy ratio {fuzzy_ratio}.\nDone checking playlist tracks in collection."
        status_label.config(text=status_text, fg="blue")

#############################
# GUI build in main         #
#############################
def update_input_value():
    """Updates the input's value to 'New Text!'."""
    text_input.set_value("New Text!")
def show(event: ValueChangeEventArguments):
    name = type(event.sender).__name__
    ui.notify(f'{name}: {event.value}')

# Main UI controls
ui.label('CrateHacker').classes('text-3xl font-bold')

# Collection file input
ui.label('Traktor Collection File').classes('text-lg')
collection_found = imp.get_collection_file()
print(f"Collection file found: {collection_found}")
with ui.row().classes('w-full no-wrap'):
    collection_entry = ui.input(value=collection_found, placeholder='Select collection file...').classes('w-5/6')
    with collection_entry:
        ui.button(color='orange-8', on_click=lambda: collection_entry.set_value(None), icon='delete') \
            .props('flat dense').bind_visibility_from(collection_entry, 'value')
    ui.button('Browse', on_click=browse_file)

# Spotify playlist input
spotify_entry = "JI"  # Placeholder for Spotify entry]
ui.label('Spotify Playlist Link').classes('text-lg')
with ui.row().classes('w-full no-wrap'):
    with ui.input(placeholder='Enter Spotify playlist link...').classes('w-5/6') as i:
        ui.button(color='orange-8', on_click=lambda: i.set_value(None), icon='delete') \
            .props('flat dense').bind_visibility_from(i, 'value')
ui.button('Preview Playlist', on_click=preview_playlist).props('fullwidth')
ui.label('Preview').classes('text-lg')

text_input = ui.input("Enter something", placeholder="start typing")
ui.button("Set Input Text", on_click=update_input_value)

with ui.row():
    ui.checkbox('Checkbox', on_change=show)
    ui.switch('Switch', on_change=show)
ui.radio(['A', 'B', 'C'], value='A', on_change=show).props('inline')
with ui.row():
    ui.input('Text input', on_change=show)
    ui.select(['One', 'Two'], value='One', on_change=show)
ui.button('Quit', on_click=app.shutdown).props('color=red')

ui.run(native=True, window_size= (1024,768), reload=False)