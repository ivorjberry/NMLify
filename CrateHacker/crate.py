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
import disk_search
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
            
            # Call our new .nml writing function from collection_utils
            file_path = col.write_nml_playlist(playlist_name, selected_tracks, output_dir)
            
            if file_path:
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
        
        result_dialog.close()
    
    def select_first_matches():
        """Select the first match for each Spotify track."""
        selected_tracks.clear()
        for group in grouped_matches.values():
            if group['collection_matches']:
                selected_tracks.append(group['collection_matches'][0]['entry'])
        for checkboxes in all_checkboxes:
            for i, checkbox in enumerate(checkboxes):
                checkbox.set_value(i == 0)
    
    def select_all():
        """Select all collection matches."""
        selected_tracks.clear()
        for group in grouped_matches.values():
            for match in group['collection_matches']:
                selected_tracks.append(match['entry'])
        for checkboxes in all_checkboxes:
            for checkbox in checkboxes:
                checkbox.set_value(True)
    
    def deselect_all():
        """Deselect all tracks."""
        selected_tracks.clear()
        for checkboxes in all_checkboxes:
            for checkbox in checkboxes:
                checkbox.set_value(False)
    
    def on_track_selection(collection_entry, spotify_key, checked):
        """Handle individual track selection."""
        if checked:
            if collection_entry not in selected_tracks:
                selected_tracks.append(collection_entry)
        else:
            if collection_entry in selected_tracks:
                selected_tracks.remove(collection_entry)

    def _score_color(score):
        """Return tailwind bg class based on match score."""
        if score >= 85:
            return 'bg-green-1'
        elif score >= 70:
            return 'bg-yellow-1'
        return 'bg-red-1'

    def _score_badge_color(score):
        """Return badge color based on match score."""
        if score >= 85:
            return 'green'
        elif score >= 70:
            return 'orange'
        return 'red'
    
    # Create dialog
    with ui.dialog() as result_dialog:
        with ui.card().style('min-width: 900px; max-width: 1200px; max-height: 85vh;'):
            total_tracks = len(grouped_matches)
            total_matches = sum(len(group['collection_matches']) for group in grouped_matches.values())
            ui.label(f'Search Results - {total_tracks} Spotify tracks, {total_matches} matches').classes('text-xl font-bold')
            ui.separator()
            
            # Control buttons
            with ui.row().classes('w-full justify-between'):
                with ui.row():
                    ui.button('Select First Matches', on_click=select_first_matches).props('color=green size=sm')
                    ui.button('Select All Matches', on_click=select_all).props('color=blue size=sm')
                ui.button('Deselect All', on_click=deselect_all).props('color=gray size=sm')
            
            # Scrollable area for tracks
            with ui.scroll_area().style('height: 650px; width: 100%;'):
                all_checkboxes = []
                
                for spotify_key, group in grouped_matches.items():
                    spotify_track = group['spotify_track']
                    spotify_artists = group['spotify_artists']
                    spotify_title = spotify_track['name']
                    collection_matches = group['collection_matches']
                    
                    # Spotify track header
                    with ui.column().classes('w-full border border-gray-400 rounded-lg p-3 mb-3 bg-gray-50'):
                        with ui.row().classes('w-full items-center mb-2'):
                            ui.icon('music_note').classes('text-lg text-blue-700')
                            ui.label(f"{spotify_artists} - {spotify_title}").classes('text-lg font-semibold text-blue-700')
                            ui.label(f"({len(collection_matches)} matches)").classes('text-sm text-gray-600')
                        
                        # Collection matches for this Spotify track
                        track_checkboxes = []
                        for i, match in enumerate(collection_matches):
                            collection_entry = match['entry']
                            score = match['score']
                            try:
                                collection_title = collection_entry.get('@TITLE', 'Unknown Title')
                                collection_artist = collection_entry.get('@ARTIST', 'Unknown Artist')
                                
                                # Build filepath string
                                location = collection_entry.get('LOCATION', {})
                                if isinstance(location, dict):
                                    volume = location.get('@VOLUME', '')
                                    directory = location.get('@DIR', '')
                                    filename = location.get('@FILE', '')
                                    filepath = f"{volume}{directory}{filename}"
                                else:
                                    filepath = "Unknown location"
                                
                                row_bg = _score_color(score)
                                with ui.row().classes(f'w-full items-center pl-4 py-1 rounded {row_bg}'):
                                    checkbox = ui.checkbox(
                                        value=False,
                                        on_change=lambda e, entry=collection_entry, key=spotify_key: on_track_selection(entry, key, e.value)
                                    )
                                    track_checkboxes.append(checkbox)
                                    ui.badge(f'{score}%', color=_score_badge_color(score)).classes('mr-2')
                                    ui.icon('album').classes('text-md text-purple-600')
                                    label_text = f"{collection_artist} - {collection_title}"
                                    ui.label(label_text).classes('text-md font-medium flex-grow')
                                    # Filepath in expandable area
                                    with ui.expansion('', icon='folder').classes('text-sm text-gray-500').style('min-width: 0; max-width: 200px;'):
                                        ui.label(filepath).classes('text-xs text-gray-600 font-mono break-all')
                                    
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


def show_disk_results_dialog(disk_matches, playlist_name):
    """Display disk search results with checkboxes for selection."""
    selected_disk_tracks = []

    async def create_playlist_from_disk():
        """Create .nml playlist from selected disk tracks."""
        if not selected_disk_tracks:
            ui.notify('No tracks selected!', color='negative')
            return
        try:
            output_dir = "playlists"
            os.makedirs(output_dir, exist_ok=True)

            # Convert disk matches to minimal Traktor ENTRY dicts
            entries = []
            for filepath, track_name in selected_disk_tracks:
                entries.append(disk_search.disk_match_to_entry(filepath, track_name))

            safe_name = f"{playlist_name} (disk)"
            file_path = col.write_nml_playlist(safe_name, entries, output_dir)
            if file_path:
                ui.notify(f'.nml "{os.path.basename(file_path)}" created in {output_dir}', color='positive')
            else:
                ui.notify('Error creating .nml file.', color='negative')
        except Exception as e:
            ui.notify(f'Error: {e}', color='negative')
            import traceback
            traceback.print_exc()
        disk_dialog.close()

    def on_disk_track_toggle(filepath, track_name, checked):
        pair = (filepath, track_name)
        if checked:
            if pair not in selected_disk_tracks:
                selected_disk_tracks.append(pair)
        else:
            if pair in selected_disk_tracks:
                selected_disk_tracks.remove(pair)

    def _score_color(score):
        if score >= 85:
            return 'bg-green-1'
        elif score >= 70:
            return 'bg-yellow-1'
        return 'bg-red-1'

    def _score_badge_color(score):
        if score >= 85:
            return 'green'
        elif score >= 70:
            return 'orange'
        return 'red'

    with ui.dialog() as disk_dialog:
        with ui.card().style('min-width: 900px; max-width: 1200px; max-height: 85vh;'):
            total_matches = sum(len(m) for m in disk_matches.values())
            ui.label(f'Disk Search Results - {len(disk_matches)} tracks, {total_matches} file matches').classes('text-xl font-bold')
            ui.separator()

            with ui.scroll_area().style('height: 600px; width: 100%;'):
                for track_name, matches in disk_matches.items():
                    with ui.column().classes('w-full border border-gray-400 rounded-lg p-3 mb-3 bg-gray-50'):
                        with ui.row().classes('w-full items-center mb-2'):
                            ui.icon('music_note').classes('text-lg text-orange-700')
                            ui.label(track_name).classes('text-lg font-semibold text-orange-700')
                            ui.label(f'({len(matches)} matches)').classes('text-sm text-gray-600')

                        for match in matches:
                            row_bg = _score_color(match['score'])
                            with ui.row().classes(f'w-full items-center pl-4 py-1 rounded {row_bg}'):
                                ui.checkbox(
                                    value=False,
                                    on_change=lambda e, fp=match['filepath'], tn=track_name: on_disk_track_toggle(fp, tn, e.value)
                                )
                                ui.badge(f"{match['score']}%", color=_score_badge_color(match['score'])).classes('mr-2')
                                ui.icon('audio_file').classes('text-md text-purple-600')
                                ui.label(match['parsed_name']).classes('text-md font-medium')
                                with ui.expansion('', icon='folder').classes('text-sm text-gray-500').style('min-width: 0; max-width: 300px;'):
                                    ui.label(match['filepath']).classes('text-xs text-gray-600 font-mono break-all')

            ui.separator()
            with ui.row().classes('w-full justify-end'):
                ui.button('Cancel', on_click=disk_dialog.close).props('color=gray')
                ui.button('Create Playlist from Disk Tracks', on_click=create_playlist_from_disk).props('color=orange')

    disk_dialog.open()


async def search_hard_drive():
    """Scan selected folders for files matching not-found tracks."""
    dirs = col.get_search_dirs()
    if not dirs:
        ui.notify('No search folders configured. Add folders in the Search Folders section.', color='warning')
        return

    if not hasattr(search_hard_drive, '_not_found') or not search_hard_drive._not_found:
        ui.notify('No not-found tracks to search for.', color='warning')
        return

    disk_spinner.visible = True
    disk_spinner.update()
    disk_status_label.set_text('Scanning folders...')
    disk_status_label.visible = True
    disk_status_label.update()
    await asyncio.sleep(0.1)

    # Run the scan in a thread to avoid blocking the UI
    loop = asyncio.get_event_loop()
    file_list = await loop.run_in_executor(None, lambda: list(disk_search.scan_directories(dirs)))

    disk_status_label.set_text(f'Found {len(file_list)} audio files. Matching...')
    disk_status_label.update()
    await asyncio.sleep(0.1)

    # Build index and match
    file_index = disk_search.build_file_index(file_list)
    disk_matches = await loop.run_in_executor(
        None,
        lambda: disk_search.fuzzy_match_files(
            search_hard_drive._not_found, file_list, fuzzy_slider.value, file_index
        )
    )

    disk_spinner.visible = False
    disk_spinner.update()

    if disk_matches:
        total = sum(len(m) for m in disk_matches.values())
        disk_status_label.set_text(f'Found {total} file matches for {len(disk_matches)} tracks.')
        disk_status_label.update()
        playlist_name = search_hard_drive._playlist_name if hasattr(search_hard_drive, '_playlist_name') else 'Disk Search'
        show_disk_results_dialog(disk_matches, playlist_name)
    else:
        disk_status_label.set_text('No matching files found on disk.')
        disk_status_label.update()
        ui.notify('No matching files found in the selected folders.', color='warning')

# Initialize state for disk search
search_hard_drive._not_found = []
search_hard_drive._playlist_name = ''

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
    
    # Show spinner
    search_spinner.visible = True
    search_spinner.update()
    not_found_card.visible = False
    not_found_card.update()
    
    # Archive a snapshot of the collection — we read from this copy
    # so the original is never held open and we get a consistent view
    working_file = collection_file
    try:
        archive_dir = os.path.join(os.getcwd(), "archive")
        os.makedirs(archive_dir, exist_ok=True)
        
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        archive_filename = f"collection_{timestamp}.nml"
        archive_path = os.path.join(archive_dir, archive_filename)
        
        shutil.copy(collection_file, archive_path)
        working_file = archive_path
        print(f"Archived collection to {archive_path}")
        
        # Clean up old archives - keep only 5 most recent
        archive_files = [f for f in os.listdir(archive_dir) if f.startswith("collection_") and f.endswith(".nml")]
        archive_files.sort(reverse=True)
        for old_file in archive_files[5:]:
            old_path = os.path.join(archive_dir, old_file)
            os.remove(old_path)
            print(f"Removed old archive: {old_file}")
    except Exception as e:  
        # Archive failure is non-fatal — fall back to reading original
        print(f"Warning: could not archive collection, reading original: {e}")
    
    # Save the collection path for next time
    col.write_collection_file_location(collection_file)
    
    await update_label(status_label, "\nLoading collection...", add_text=True)
    
    # Read from the archived snapshot (or original if archive failed)
    collection = col.load_collection(working_file)
    print(f"Loaded {len(collection)} tracks from collection.")
    await update_label(status_label, f"\nLoaded {len(collection)} tracks from collection.", add_text=True)

    # Build token index for fast pre-filtering
    title_index, artist_index = search.build_collection_index(collection)

    await update_label(status_label, "\nFetching Spotify playlist...", add_text=True)
    
    # Spotify link already validated. Extract the playlist ID from the URL
    playlist_name = utils.get_playlist_name(spotify_link)
    spotify_results = utils.get_playlist_info(spotify_link)
    
    await update_label(status_label, "\nSearching for tracks in collection...", add_text=True)
       
    search_results, not_found_tracks = search.fuzzy_search(spotify_results, collection, fuzzy_slider.value, title_index, artist_index)

    # Hide spinner
    search_spinner.visible = False
    search_spinner.update()

    if search_results:
        # Count total matches across all Spotify tracks
        total_matches = sum(len(group['collection_matches']) for group in search_results.values())
        unique_spotify_tracks = len(search_results)
        
        await update_label(status_label, f"\nFound {total_matches} total matches for {unique_spotify_tracks} of {len(spotify_results['items'])} Spotify tracks (fuzzy ratio {fuzzy_slider.value}).", add_text=True) 
        
        # Show search results dialog with checkboxes
        show_search_results_dialog(search_results, playlist_name)
        
        # Populate the not found tracks list
        if not_found_tracks:
            # Store for disk search
            search_hard_drive._not_found = not_found_tracks
            search_hard_drive._playlist_name = playlist_name
            not_found_card.visible = True
            not_found_card.update()
            not_found_label.set_text('\n'.join(not_found_tracks))
            not_found_label.update()
        else:
            search_hard_drive._not_found = []
    else:
        search_hard_drive._not_found = not_found_tracks if not_found_tracks else []
        search_hard_drive._playlist_name = playlist_name if 'playlist_name' in dir() else ''
        if not_found_tracks:
            not_found_card.visible = True
            not_found_card.update()
            not_found_label.set_text('\n'.join(not_found_tracks))
            not_found_label.update()
        await update_label(status_label, "\nNo tracks found from playlist in collection.", classes='text-red-12', add_text=True) 

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

# Main UI layout
with ui.header().classes('bg-indigo-700 text-white items-center justify-between'):
    ui.label('CrateHacker').classes('text-2xl font-bold')
    ui.button('Quit', on_click=app.shutdown).props('flat color=white icon=power_settings_new')

with ui.column().classes('w-full max-w-3xl mx-auto p-6 gap-4'):

    # --- Collection section ---
    with ui.card().classes('w-full'):
        ui.label('Traktor Collection File').classes('text-lg font-semibold')
        collection_found = col.get_collection_file()
        print(f"Collection file found: {collection_found}")
        with ui.row().classes('w-full no-wrap items-center'):
            collection_entry = ui.input(value=collection_found, placeholder='Select collection file...').classes('flex-grow')
            with collection_entry:
                ui.button(color='orange-8', on_click=lambda: collection_entry.set_value(None), icon='delete') \
                    .props('flat dense').bind_visibility_from(collection_entry, 'value')
            ui.button('Browse', on_click=browse_file, icon='folder_open').props('outline')

    # --- Spotify section ---
    with ui.card().classes('w-full'):
        ui.label('Spotify Playlist Link').classes('text-lg font-semibold')
        with ui.row().classes('w-full no-wrap items-center'):
            spotify_entry = ui.input(placeholder='Enter Spotify playlist link...').classes('flex-grow')
            with spotify_entry:
                ui.button(color='orange-8', on_click=lambda: spotify_entry.set_value(None), icon='delete') \
                    .props('flat dense').bind_visibility_from(spotify_entry, 'value')
            ui.button('Validate', on_click=preview_playlist, icon='check_circle').props('outline')
        preview_label = ui.label('').classes('text-md text-gray-600')
        preview_label.visible = False

    # --- Search settings ---
    with ui.card().classes('w-full'):
        ui.label('Search Settings').classes('text-lg font-semibold')
        with ui.row(align_items='center').classes('w-full'):
            ui.label('Fuzzy Match Threshold').classes('text-md')
            fuzzy_slider = ui.slider(min=0, max=100, value=70).classes('flex-grow')
            ui.label().classes('text-sm text-gray-600 w-12 text-right').bind_text_from(fuzzy_slider, 'value', backward=lambda v: f'{v}%')
        with ui.row().classes('w-full justify-end'):
            search_spinner = ui.spinner('dots', size='lg', color='indigo')
            search_spinner.visible = False
            ui.button('Create Playlist', on_click=search_collection, icon='search').props('color=indigo')

    # --- Search Folders (for disk search) ---
    with ui.card().classes('w-full'):
        ui.label('Search Folders (Hard Drive Scan)').classes('text-lg font-semibold')
        ui.label('Add folders to scan for audio files not found in your collection.').classes('text-sm text-gray-500')

        # Container for the folder list — rebuilt dynamically
        folder_list_container = ui.column().classes('w-full gap-1')
        saved_dirs = col.get_search_dirs()

        def _rebuild_folder_list():
            """Rebuild the folder list UI from saved_dirs."""
            folder_list_container.clear()
            with folder_list_container:
                if not saved_dirs:
                    ui.label('No folders added yet.').classes('text-sm text-gray-400 italic')
                else:
                    for i, d in enumerate(list(saved_dirs)):
                        with ui.row().classes('w-full items-center no-wrap'):
                            ui.icon('folder').classes('text-indigo-600')
                            ui.label(d).classes('text-sm font-mono flex-grow truncate')
                            def _remove(idx=i):
                                saved_dirs.pop(idx)
                                col.save_search_dirs(saved_dirs)
                                _rebuild_folder_list()
                            ui.button(icon='close', on_click=_remove).props('flat dense color=red size=sm')

        _rebuild_folder_list()

        async def _add_folder():
            """Open a folder picker and add the selected folder."""
            result = await app.native.main_window.create_file_dialog(
                allow_multiple=False,
                file_types=('',),  # empty = folder picker mode
                dialog_type=2  # OPEN_DIALOG for folder
            )
            if result:
                folder = result[0] if isinstance(result, (list, tuple)) else result
                folder = os.path.abspath(folder)
                if folder not in saved_dirs:
                    saved_dirs.append(folder)
                    col.save_search_dirs(saved_dirs)
                    _rebuild_folder_list()
                    ui.notify(f'Added: {folder}', color='positive')
                else:
                    ui.notify('Folder already in list.', color='info')

        with ui.row().classes('w-full justify-end'):
            ui.button('Add Folder', on_click=_add_folder, icon='create_new_folder').props('outline')

    # --- Status area ---
    status_label = ui.label('Status: Waiting for input...').classes('text-md text-gray-600')
    status_label.style('white-space: pre-wrap')

    # --- Not-found tracks (hidden until search runs) ---
    not_found_card = ui.card().classes('w-full')
    not_found_card.visible = False
    with not_found_card:
        with ui.row().classes('w-full items-center justify-between'):
            ui.label('Tracks Not Found in Collection').classes('text-lg font-semibold text-red-700')
            with ui.row().classes('items-center gap-2'):
                disk_spinner = ui.spinner('dots', size='md', color='orange')
                disk_spinner.visible = False
                ui.button('Search Hard Drive', on_click=search_hard_drive, icon='saved_search').props('color=orange')
        disk_status_label = ui.label('').classes('text-sm text-gray-600')
        disk_status_label.visible = False
        not_found_label = ui.label('').classes('text-md text-gray-600')
        not_found_label.style('white-space: pre-wrap')

ui.run(native=True, window_size=(1024, 768), reload=False, title='CrateHacker')