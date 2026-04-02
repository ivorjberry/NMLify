# CrateHacker

A desktop app that converts Spotify playlists into Traktor-compatible `.nml` playlist files by fuzzy-matching tracks against your Traktor collection.

## Features

- Fuzzy search with configurable threshold to match Spotify tracks to your Traktor collection
- Token-based pre-indexing for fast searching against large collections
- Auto-detects your Traktor `collection.nml` file
- Archives your collection before each search
- Exports `.nml` playlists importable directly into Traktor

## Setup

### Prerequisites

- Python 3.11+
- A Spotify developer account ([create one here](https://developer.spotify.com/dashboard))

### Install

```bash
cd CrateHacker
python -m venv crateenv
crateenv\Scripts\activate      # Windows
pip install -r requirements.txt
```

### Configure

Copy `.env.example` to `.env` and add your Spotify API credentials:

```
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
```

### Run

```bash
python crate.py
```

The app opens in your browser at `http://localhost:8080`.

## Testing

```bash
pip install pytest
python -m pytest tests/ -v
```

Tests cover:
- **`tests/test_collection_search.py`** — tokenizer, index building, fuzzy search matching
- **`tests/test_collection_utils.py`** — collection file detection, path verification
- **`tests/test_spotify_utils.py`** — Spotify URL validation

## Building the Executable

### Quick build

```bash
build.bat
```

Or manually:

```bash
pip install pyinstaller
python build_exe.py
```

The executable appears in `dist/CrateHacker.exe` (~200-300 MB, includes Python runtime and all dependencies).

### Distribution package

Create a zip with:

```
CrateHacker-v1.0/
├── CrateHacker.exe      # from dist/
├── .env.example          # credentials template
└── INSTALL.md            # end-user instructions
```

## Project Structure

```
CrateHacker/
├── crate.py                 # Main app (NiceGUI UI)
├── collection_search.py     # Fuzzy matching + token indexing
├── collection_utils.py      # Collection file I/O + NML export
├── spotify_utils.py         # Spotify API integration
├── requirements.txt         # Python dependencies
├── .env.example             # Credentials template
├── build_exe.py             # PyInstaller build script
├── build.bat                # Windows build shortcut
├── INSTALL.md               # End-user installation guide
├── tests/                   # Test suite
├── playlists/               # Generated .nml playlists
└── archive/                 # Collection backups
```
