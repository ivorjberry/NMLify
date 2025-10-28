# Quick Start - Building CrateHacker Executable

## For First-Time Build

### 1. Install PyInstaller
```bash
pip install pyinstaller
```

### 2. Build the Executable

**Option A: Using the batch file (Windows)**
```bash
build.bat
```

**Option B: Using Python directly**
```bash
python build_exe.py
```

**Option C: Manual PyInstaller command**
```bash
pyinstaller --name=CrateHacker --onefile --windowed --collect-all=nicegui --hidden-import=spotipy --hidden-import=thefuzz --hidden-import=xmltodict --noconfirm crate.py
```

### 3. Find Your Executable
After building, the executable will be in:
```
dist/CrateHacker.exe
```

## Distribution Package

To distribute your app, create a folder with:
```
CrateHacker/
├── CrateHacker.exe      (from dist/)
├── .env.example         (rename to .env and add credentials)
└── INSTALL.md           (user instructions)
```

Users should:
1. Copy `.env.example` to `.env`
2. Add their Spotify API credentials to `.env`
3. Run `CrateHacker.exe`

## Troubleshooting Build Issues

### "Module not found" errors
Add missing modules to the build command:
```bash
--hidden-import=module_name
```

### Large executable size
The executable is large (~200-300MB) because it includes:
- Python runtime
- NiceGUI web framework
- All dependencies

This is normal for PyInstaller apps.

### App doesn't start after building
- Check that `.env` file is in the same directory as the executable
- Try running without `--windowed` to see console errors
- Verify all dependencies are installed before building

## Build Settings Explained

- `--name=CrateHacker` - Name of the executable
- `--onefile` - Create a single .exe file (slower startup but easier distribution)
- `--windowed` - No console window (GUI only)
- `--collect-all=nicegui` - Include all NiceGUI files
- `--hidden-import=X` - Explicitly include modules PyInstaller might miss
- `--noconfirm` - Overwrite previous builds without asking

## Advanced: Creating an Installer

For a professional installer, you can use:
- **Inno Setup** (free) - https://jrsoftware.org/isinfo.php
- **NSIS** (free) - https://nsis.sourceforge.io/
- **WiX Toolset** (free) - https://wixtoolset.org/

These create `.msi` or `.exe` installers with:
- Start menu shortcuts
- Desktop icons
- Uninstaller
- File associations
