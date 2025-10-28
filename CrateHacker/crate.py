###
# CrateHacker - Convert spotify playlists to m3u playlists
###
import os
import asyncio
from nicegui import app, ui
from nicegui.events import ValueChangeEventArguments
import spotify_utils as utils
import collection_search as search
import collection_utils as col
import shutil

#############################
# GUI callbacks             #
#############################

def show_search_results_dialog(grouped_matches, playlist_name):
    """Display search results in a dialog with checkboxes for each track."""
    selected_tracks = []
    
    async def create_playlist_from_selected():
        """Create .nml playlist from selected tracks."""
        if not selected_tracks:
            ui.notify('No tracks selected!', color='negative')
            return

        try:
            # Save playlists to the playlists folder
            output_dir = "playlists"
            os.makedirs(output_dir, exist_ok=True)
            
            # The write_nml_playlist function in collection_utils.py 
            # already handles sanitizing the playlist name.
            
            # Call our new .nml writing function from collection_utils
            # The 'col' alias was imported at the top of crate.py
            file_path = col.write_nml_playlist(playlist_name, selected_tracks, output_dir)
            
            if file_path:
                # Get the actual filename from the returned path for the message
                safe_playlist_name = os.path.basename(file_path)
                ui.notify(f'.nml playlist "{safe_playlist_name}" created successfully in {output_dir}', color='positive')
                print(f"Playlist created at {file_path}")
            else:
                ui.notify('Error creating .nml file. Check console.', color='negative')

        except Exception as e:
            ui.notify(f'An error occurred: {e}', color='negative')
            print(f"Error in create_playlist_from_selected: {e}")
            import traceback
            traceback.print_exc()
        
        # --- FIX 2: Use correct dialog variable name ---
        result_dialog.close()
    
    def select_first_matches():
        """Select the first match for each Spotify track."""
        selected_tracks.clear()
        # Select first collection entry for each Spotify track
        for group in grouped_matches.values():
            if group['collection_matches']:
                selected_tracks.append(group['collection_matches'][0])
        
        # Update all checkboxes - check first option for each track
        for checkboxes in all_checkboxes:
            for i, checkbox in enumerate(checkboxes):
                checkbox.set_value(i == 0)  # Check only the first option
    
    def select_all():
        """Select all collection matches."""
        selected_tracks.clear()
        # Select all collection entries
        for group in grouped_matches.values():
            for collection_entry in group['collection_matches']:
                selected_tracks.append(collection_entry)
        
        # Update all checkboxes to checked
        for checkboxes in all_checkboxes:
            for checkbox in checkboxes:
                checkbox.set_value(True)
    
    def deselect_all():
        """Deselect all tracks."""
        selected_tracks.clear()
        # Update all checkboxes to unchecked
        for checkboxes in all_checkboxes:
            for checkbox in checkboxes:
                checkbox.set_value(False)
    
    def on_track_selection(collection_entry, spotify_key, checked):
        """Handle individual track selection."""
        if checked:
            # Add this selection
            if collection_entry not in selected_tracks:
                selected_tracks.append(collection_entry)
        else:
            if collection_entry in selected_tracks:
                selected_tracks.remove(collection_entry)
    
    # Create dialog
    with ui.dialog() as result_dialog:
        with ui.card().style('min-width: 900px; max-width: 1200px; max-height: 85vh;'):
            total_tracks = len(grouped_matches)
            total_matches = sum(len(group['collection_matches']) for group in grouped_matches.values())
            ui.label(f'Search Results - {total_tracks} Spotify tracks with {total_matches} total matches').classes('text-xl font-bold')
            ui.separator()
            
            # Control buttons
            with ui.row().classes('w-full justify-between'):
                with ui.row():
                    ui.button('Select First Matches', on_click=select_first_matches).props('color=green size=sm')
                    ui.button('Select All Matches', on_click=select_all).props('color=blue size=sm')
                ui.button('Deselect All', on_click=deselect_all).props('color=gray size=sm')
            
            # Scrollable area for tracks
            with ui.scroll_area().style('height: 650px; width: 100%;'):
                all_checkboxes = []  # Store checkbox references for each Spotify track
                
                for spotify_key, group in grouped_matches.items():
                    spotify_track = group['spotify_track']
                    spotify_artists = group['spotify_artists']
                    spotify_title = spotify_track['name']
                    collection_matches = group['collection_matches']
                    
                    # Spotify track header
                    with ui.column().classes('w-full border border-gray-400 rounded-lg p-3 mb-3 bg-gray-50'):
                        with ui.row().classes('w-full items-center mb-2'):
                            ui.label('🎵').classes('text-lg')
                            ui.label(f"Spotify: {spotify_artists} - {spotify_title}").classes('text-lg font-semibold text-blue-700')
                            ui.label(f"({len(collection_matches)} matches)").classes('text-sm text-gray-600')
                        
                        # Collection matches for this Spotify track
                        track_checkboxes = []
                        for i, collection_entry in enumerate(collection_matches):
                            try:
                                collection_title = collection_entry.get('@TITLE', 'Unknown Title')
                                collection_artist = collection_entry.get('@ARTIST', 'Unknown Artist')
                                
                                # Get the full filepath
                                location = collection_entry.get('LOCATION', {})
                                if isinstance(location, dict):
                                    volume = location.get('@VOLUME', '')
                                    directory = location.get('@DIR', '')
                                    filename = location.get('@FILE', '')
                                    filepath = f"{volume}{directory}{filename}"
                                else:
                                    filepath = "Unknown location"
                                
                                with ui.column().classes('w-full items-start pl-4 py-1'):
                                    with ui.row().classes('w-full items-center'):
                                        checkbox = ui.checkbox(
                                            value=False,  # No default selection
                                            on_change=lambda e, entry=collection_entry, key=spotify_key: on_track_selection(entry, key, e.value)
                                        )
                                        track_checkboxes.append(checkbox)
                                        ui.label('💽').classes('text-md text-purple-600 w-8')
                                        ui.label(f"{collection_artist} - {collection_title}").classes('text-md font-medium flex-grow')
                                    
                                    # Show filepath on a second line
                                    with ui.row().classes('w-full pl-10'):
                                        ui.label('📁').classes('text-sm text-gray-500 w-8')
                                        ui.label(filepath).classes('text-sm text-gray-600 font-mono break-all')
                                    
                            except Exception as e:
                                print(f"Error displaying collection entry: {e}")
                                continue
                        
                        all_checkboxes.append(track_checkboxes)
            
            ui.separator()
            
            # Bottom buttons
            with ui.row().classes('w-full justify-end'):
                ui.button('Cancel', on_click=result_dialog.close).props('color=gray')
                ui.button('Create Playlist', on_click=create_playlist_from_selected).props('color=green')
    
    result_dialog.open()

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
    preview_label.update()
    # Force UI update
    ui.run_javascript('void(0)')


async def search_collection():  
    """Callback function for the 'Create Playlist' button."""  
    collection_file = collection_entry.value
    spotify_link = spotify_entry.value
    #Fix START: Extract file path string from tuple
    if isinstance(collection_file, tuple):
        collection_file = collection_file[0]
    #Fix END
    # Check if a collection file was provided  
    status_text = col.verify_collection_file(collection_file)
    await update_label(status_label, status_text)
    if "Success" not in status_text:
        status_label.classes('text-red-12')
        return
    
    if not utils.verify_spotify_link(spotify_link):
        await update_label(status_label, "Error: Please enter a valid Spotify playlist link.", classes='text-red-12', add_text=False)
        return
    
    try:
        # Copy the file to the directory where the script is running  
        destination = os.path.join(os.getcwd(), os.path.basename(collection_file))
        archive_dir = os.path.join(os.getcwd(), "archive")
        os.makedirs(archive_dir, exist_ok=True)
        
        # Create timestamped filename for the new collection being copied in
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        archive_filename = f"collection_{timestamp}.nml"
        archive_path = os.path.join(archive_dir, archive_filename)
        
        # Copy the new collection file to archive with timestamp
        shutil.copy(collection_file, archive_path)
        print(f"Archived new collection to {archive_path}")
        
        # Also copy to working directory as collection.nml
        shutil.copy(collection_file, destination)
        
        # Clean up old archives - keep only 5 most recent
        archive_files = [f for f in os.listdir(archive_dir) if f.startswith("collection_") and f.endswith(".nml")]
        archive_files.sort(reverse=True)  # Most recent first
        
        # Remove files beyond the 5 most recent
        for old_file in archive_files[5:]:
            old_path = os.path.join(archive_dir, old_file)
            os.remove(old_path)
            print(f"Removed old archive: {old_file}")
    except Exception as e:  
        # Handle any errors during the file copy  
        await update_label(status_label, "Error copying collection file to working directory.", classes='text-red-12', add_text=False)   
        return f"Error copying file: {e}"
    
    await update_label(status_label, "\nLoading collection...", add_text=True)
    
    # Collection now lives at destination
    collection = col.load_collection(destination)
    print(f"Loaded {len(collection)} tracks from collection.")
    await update_label(status_label, f"\nLoaded {len(collection)} tracks from collection.", add_text=True)

    await update_label(status_label, "\nFetching Spotify playlist...", add_text=True)
    
    # Spotify link already validated. Extract the playlist ID from the URL
    playlist_name = utils.get_playlist_name(spotify_link)
    spotify_results = utils.get_playlist_info(spotify_link)
    
    await update_label(status_label, "\nSearching for tracks in collection...", add_text=True)
       
    search_results, not_found_tracks = search.fuzzy_search(spotify_results, collection, fuzzy_slider.value)

    if search_results:
        # Count total matches across all Spotify tracks
        total_matches = sum(len(group['collection_matches']) for group in search_results.values())
        unique_spotify_tracks = len(search_results)
        
        await update_label(status_label, f"\nFound {total_matches} total matches for {unique_spotify_tracks} of {len(spotify_results['items'])} Spotify tracks (fuzzy ratio {fuzzy_slider.value}).", add_text=True) 
        
        # Show search results dialog with checkboxes
        show_search_results_dialog(search_results, playlist_name)
        
        # Populate the not found tracks list
        not_found_label.clear()
        await update_label(not_found_label, "Tracks not found from playlist in collection:\n", add_text=False)
        for track in not_found_tracks:
            await update_label(not_found_label, track + "\n", add_text=True)
    else:
        await update_label(status_label, "<br>No tracks found from playlist in collection.", classes='text-red-12') 
        not_found_label.visible = False  # Hide the found tracks list if no tracks found

#############################
# GUI build in main         #
#############################
async def update_label(label, value: str, add_text=False, classes=""):
    """Update a label with new text."""
    if add_text:
        label.set_text(label.text + value)
    else:
        label.set_text(value)
    
    if classes:
        print(f"Updating label classes to: {classes}")
        label.classes(classes)
    label.update()
    # Force UI update
    ui.run_javascript('void(0)')
    # Allow UI to refresh
    await asyncio.sleep(0.1)

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