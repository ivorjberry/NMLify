###
# CrateHacker - Convert spotify playlists to m3u playlists
###
import os
import asyncio
import shutil
from datetime import datetime

from nicegui import app, ui
from nicegui.events import ValueChangeEventArguments

import spotify_utils as utils
import collection_search as search
import collection_utils as col
import disk_search
from app_logging import configure_logging, get_logger

log = get_logger(__name__)


#############################
# Shared UI helpers         #
#############################

def _score_color(score):
    """Return a tailwind background class for a fuzzy match score."""
    if score >= 85:
        return 'bg-green-1'
    if score >= 70:
        return 'bg-yellow-1'
    return 'bg-red-1'


def _score_badge_color(score):
    """Return a Quasar badge color name for a fuzzy match score."""
    if score >= 85:
        return 'green'
    if score >= 70:
        return 'orange'
    return 'red'


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
                log.info("Playlist created at %s", file_path)
            else:
                ui.notify('Error creating .nml file. Check console.', color='negative')

        except Exception as e:
            ui.notify(f'An error occurred: {e}', color='negative')
            log.exception("Error in create_playlist_from_selected: %s", e)
        
        result_dialog.close()

    def select_top_n(n):
        """Select the top ``n`` collection matches for each Spotify track.

        Matches are already sorted by score (highest first) in
        ``collection_search.fuzzy_search``, so slicing ``[:n]`` picks the
        best ``n``. ``n=1`` is equivalent to the legacy 'Select First Matches'.
        """
        try:
            n_int = max(1, int(n))
        except (TypeError, ValueError):
            n_int = 1
        selected_tracks.clear()
        for group in grouped_matches.values():
            for match in group['collection_matches'][:n_int]:
                selected_tracks.append(match['entry'])
        for checkboxes in all_checkboxes:
            for i, checkbox in enumerate(checkboxes):
                checkbox.set_value(i < n_int)

    def select_first_matches():
        """Backwards-compatible shortcut for selecting only the best match."""
        select_top_n(1)
    
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

    # Create dialog
    with ui.dialog() as result_dialog:
        with ui.card().style('min-width: 900px; max-width: 1200px; max-height: 85vh;'):
            total_tracks = len(grouped_matches)
            total_matches = sum(len(group['collection_matches']) for group in grouped_matches.values())
            ui.label(f'Search Results - {total_tracks} Spotify tracks, {total_matches} matches').classes('text-xl font-bold')
            ui.separator()
            
            # Control buttons
            with ui.row().classes('w-full justify-between'):
                with ui.row().classes('items-center gap-2'):
                    ui.button('Select First Matches', on_click=select_first_matches).props('color=green size=sm')
                    ui.button('Select All Matches', on_click=select_all).props('color=blue size=sm')
                    ui.separator().props('vertical')
                    top_n_input = ui.number(label='Top N', value=1, min=1, max=20, format='%d') \
                        .props('dense outlined size=xs').style('width: 90px;')
                    ui.button(
                        'Select Top N',
                        on_click=lambda: select_top_n(top_n_input.value or 1),
                    ).props('color=teal size=sm')
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
                                log.warning("Error displaying collection entry: %s", e)
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

    # Only scan tracks the user actually wants to look for on disk
    selected = _selected_not_found_tracks()
    if not selected:
        ui.notify('Select at least one track from the not-found list first.', color='warning')
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
    disk_threshold = disk_fuzzy_slider.value

    def _on_disk_progress(done, total):
        text = f'Matching disk files... {done}/{total} tracks'
        loop.call_soon_threadsafe(disk_status_label.set_text, text)
        loop.call_soon_threadsafe(disk_status_label.update)

    disk_matches = await loop.run_in_executor(
        None,
        lambda: disk_search.fuzzy_match_files(
            selected, file_list, disk_threshold, file_index,
            progress_callback=_on_disk_progress,
        )
    )

    disk_spinner.visible = False
    disk_spinner.update()

    if disk_matches:
        total = sum(len(m) for m in disk_matches.values())
        disk_status_label.set_text(f'Found {total} file matches for {len(disk_matches)} tracks.')
        disk_status_label.update()
        playlist_name = getattr(search_hard_drive, '_playlist_name', '') or 'Disk Search'
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
    log.debug("Collection file selected: %s", collection_file)
    collection_entry.set_value(collection_file)


def preview_playlist():
    """Display playlist title from Spotify playlist entry."""
    playlist = spotify_entry.value
    log.debug("Playlist provided: %s", playlist)

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
    playlist_name = ''  # always defined so downstream branches can rely on it
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

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        archive_filename = f"collection_{timestamp}.nml"
        archive_path = os.path.join(archive_dir, archive_filename)

        shutil.copy(collection_file, archive_path)
        working_file = archive_path
        log.info("Archived collection to %s", archive_path)

        # Clean up old archives - keep only 5 most recent
        archive_files = [f for f in os.listdir(archive_dir) if f.startswith("collection_") and f.endswith(".nml")]
        archive_files.sort(reverse=True)
        for old_file in archive_files[5:]:
            old_path = os.path.join(archive_dir, old_file)
            os.remove(old_path)
            log.debug("Removed old archive: %s", old_file)
    except Exception as e:
        # Archive failure is non-fatal — fall back to reading original
        log.warning("Could not archive collection, reading original: %s", e)

    # Save the collection path for next time
    col.write_collection_file_location(collection_file)

    await update_label(status_label, "\nLoading collection...", add_text=True)

    # Read from the archived snapshot (or original if archive failed)
    collection = col.load_collection(working_file)
    log.info("Loaded %d tracks from collection.", len(collection))
    await update_label(status_label, f"\nLoaded {len(collection)} tracks from collection.", add_text=True)

    # Build token index for fast pre-filtering
    title_index, artist_index = search.build_collection_index(collection)

    await update_label(status_label, "\nFetching Spotify playlist...", add_text=True)

    # Spotify link already validated. Extract the playlist ID from the URL
    playlist_name = utils.get_playlist_name(spotify_link)
    spotify_results = utils.get_playlist_info(spotify_link)

    await update_label(status_label, "\nSearching for tracks in collection...", add_text=True)

    # Push the (potentially long) fuzzy match into a worker thread so the UI
    # stays responsive, and wire a thread-safe progress callback that updates
    # the status label every 10 tracks.
    loop = asyncio.get_event_loop()
    threshold = fuzzy_slider.value

    def _on_progress(done, total):
        text = f"Searching collection... {done}/{total} tracks"
        loop.call_soon_threadsafe(status_label.set_text, text)
        loop.call_soon_threadsafe(status_label.update)

    search_results, not_found_tracks = await loop.run_in_executor(
        None,
        lambda: search.fuzzy_search(
            spotify_results, collection, threshold,
            title_index, artist_index, progress_callback=_on_progress,
        ),
    )

    # Hide spinner
    search_spinner.visible = False
    search_spinner.update()

    if search_results:
        # Count total matches across all Spotify tracks
        total_matches = sum(len(group['collection_matches']) for group in search_results.values())
        unique_spotify_tracks = len(search_results)

        await update_label(status_label, f"\nFound {total_matches} total matches for {unique_spotify_tracks} of {len(spotify_results['items'])} Spotify tracks (fuzzy ratio {threshold}).", add_text=True)

        # Show search results dialog with checkboxes
        show_search_results_dialog(search_results, playlist_name)

        # Populate the not-found tracks list (always stash for disk search)
        search_hard_drive._not_found = not_found_tracks or []
        search_hard_drive._playlist_name = playlist_name
        if not_found_tracks:
            _render_not_found(not_found_tracks)
    else:
        search_hard_drive._not_found = not_found_tracks or []
        search_hard_drive._playlist_name = playlist_name
        if not_found_tracks:
            _render_not_found(not_found_tracks)
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
        log.debug("Updating label classes to: %s", classes)
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
        log.debug("Auto-detected collection file: %s", collection_found)
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
            ui.label('Collection fuzzy threshold').classes('text-md')
            fuzzy_slider = ui.slider(min=0, max=100, value=70).classes('flex-grow')
            ui.label().classes('text-sm text-gray-600 w-12 text-right').bind_text_from(fuzzy_slider, 'value', backward=lambda v: f'{v}%')
        with ui.row(align_items='center').classes('w-full'):
            ui.label('Disk fuzzy threshold').classes('text-md')
            disk_fuzzy_slider = ui.slider(min=0, max=100, value=60).classes('flex-grow')
            ui.label().classes('text-sm text-gray-600 w-12 text-right').bind_text_from(disk_fuzzy_slider, 'value', backward=lambda v: f'{v}%')
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
    # Map of "Artist - Title" -> ui.checkbox so we can read selection state on demand
    _not_found_checkboxes = {}
    with not_found_card:
        with ui.row().classes('w-full items-center justify-between'):
            ui.label('Tracks Not Found in Collection').classes('text-lg font-semibold text-red-700')
            with ui.row().classes('items-center gap-2'):
                disk_spinner = ui.spinner('dots', size='md', color='orange')
                disk_spinner.visible = False
                ui.button('Search Hard Drive', on_click=search_hard_drive, icon='saved_search').props('color=orange')
        disk_status_label = ui.label('').classes('text-sm text-gray-600')
        disk_status_label.visible = False
        # Quick select / deselect controls
        with ui.row().classes('gap-2'):
            ui.button('Select all', on_click=lambda: _set_all_not_found(True)).props('flat dense color=red size=sm')
            ui.button('Clear', on_click=lambda: _set_all_not_found(False)).props('flat dense color=gray size=sm')
        not_found_list_container = ui.column().classes('w-full gap-0')


def _render_not_found(tracks):
    """Rebuild the not-found checkbox list and make the card visible."""
    not_found_list_container.clear()
    _not_found_checkboxes.clear()
    with not_found_list_container:
        for track in tracks:
            cb = ui.checkbox(text=f'Track not found: {track}', value=True).classes('text-md text-red-900')
            _not_found_checkboxes[track] = cb
    not_found_card.visible = True
    not_found_card.update()


def _set_all_not_found(value):
    """Toggle every checkbox in the not-found list."""
    for cb in _not_found_checkboxes.values():
        cb.set_value(value)


def _selected_not_found_tracks():
    """Return the subset of not-found tracks currently ticked by the user."""
    return [track for track, cb in _not_found_checkboxes.items() if cb.value]


def main():
    """Launch the native CrateHacker window. Kept behind a guard so importing
    this module (e.g. from tests) doesn't spawn a UI process."""
    configure_logging()
    ui.run(native=True, window_size=(1024, 768), reload=False, title='CrateHacker')


if __name__ in {'__main__', '__mp_main__'}:
    main()