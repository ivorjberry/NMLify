# CrateHacker - Installation Guide

## For End Users (Using the Executable)

### System Requirements
- Windows 10 or later
- Internet connection (for Spotify API)
- Traktor Pro (for the collection file)

### Installation Steps

1. **Download CrateHacker.exe**
   - Download the `CrateHacker.exe` file
   - Place it in a folder of your choice (e.g., `C:\CrateHacker\`)

2. **Set Up Spotify API Credentials**
   - Create a `.env` file in the same folder as `CrateHacker.exe`
   - Add the following lines to the `.env` file:
   ```
   SPOTIPY_CLIENT_ID=your_client_id_here
   SPOTIPY_CLIENT_SECRET=your_client_secret_here
   SPOTIPY_REDIRECT_URI=http://localhost:8888/callback
   ```
   
   To get your Spotify API credentials:
   - Go to https://developer.spotify.com/dashboard
   - Log in with your Spotify account
   - Click "Create an App"
   - Copy the Client ID and Client Secret to your `.env` file

3. **Locate Your Traktor Collection**
   - Find your `collection.nml` file
   - Typical location: `C:\Users\[YourName]\Documents\Native Instruments\Traktor [Version]\`

4. **Run CrateHacker**
   - Double-click `CrateHacker.exe`
   - The app will create the following folders automatically:
     - `archive/` - Backups of your collection files
     - `playlists/` - Your generated playlists

### Usage

1. **Select Collection File**
   - Click "Browse" to select your Traktor `collection.nml` file
   - The app will automatically archive the previous version
   - Most often, the app will find your most recent collection version. Verify this before creating your playlist

2. **Enter Spotify Playlist**
   - Paste a Spotify playlist URL
   - Click "Validate" to check the playlist to make sure it's valid

3. **Search for Matches**
   - Adjust the "Fuzzy search level" slider (higher = stricter matching)
   - Click "Create playlist"
   - Review the matches found in your collection

4. **Select Tracks**
   - Use checkboxes to select which tracks to include
   - Use "Select First Matches" for quick selection
   - Click "Create Playlist" to generate the `.nml` file

5. **Import to Traktor**
   - Open Traktor Pro
   - Import [Your Playlist Name].nml
   - If prompted, select "Use collection tags"
   - The playlist will appear in your Traktor collection

### Troubleshooting

**App won't start:**
- Make sure `.env` file is in the same folder as the executable
- Check that your Spotify credentials are correct

**No matches found:**
- Lower the fuzzy search level slider
- Verify your Traktor collection file is up to date

**Playlist import fails in Traktor:**
- Make sure the file paths in your collection are valid
- Check that the tracks still exist at their original locations

### Support
For issues or questions, please visit: [Your GitHub repo or contact info]

---

## For Developers (Building from Source)

### Prerequisites
- Python 3.11 or later
- Virtual environment recommended

### Setup

1. **Clone the repository**
   ```bash
   git clone [your-repo-url]
   cd CrateHacker
   ```

2. **Create and activate virtual environment**
   ```bash
   python -m venv crateenv
   # On Windows:
   crateenv\Scripts\activate
   ```

3. **Install dependencies**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment**
   - Copy `.env.example` to `.env` (if provided)
   - Add your Spotify API credentials

5. **Run from source**
   ```bash
   python crate.py
   ```

### Building the Executable

To create a distributable executable:

```bash
python build_exe.py
```

The executable will be created in the `dist/` folder.

### Build Options

You can modify `build_exe.py` to customize:
- Icon file (add `--icon=path/to/icon.ico`)
- Console window (remove `--windowed` to show console)
- Additional data files (use `--add-data`)

### Dependencies

Key libraries:
- **nicegui** - UI framework
- **spotipy** - Spotify API client
- **thefuzz** - Fuzzy string matching
- **xmltodict** - XML parsing for Traktor files
- **pythonnet** - .NET integration (if needed)

### Project Structure

```
CrateHacker/
├── crate.py              # Main application
├── collection_utils.py   # Traktor collection utilities
├── collection_search.py  # Search and matching logic
├── spotify_utils.py      # Spotify API utilities
├── requirements.txt      # Python dependencies
├── build_exe.py          # Executable build script
├── .env                  # Environment variables (not in repo)
├── archive/              # Collection file backups
└── playlists/            # Generated playlist files
```

### Contributing

[Add your contribution guidelines here]

### License

[Add your license information here]
