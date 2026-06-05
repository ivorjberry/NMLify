"""
Build script for creating CrateHacker executable using PyInstaller.
Run this script to create a standalone executable.
"""
import os
import sys
import subprocess
import shutil

def build_executable():
    """Build the executable using PyInstaller."""
    
    print("=" * 60)
    print("Building CrateHacker Executable")
    print("=" * 60)
    
    # Check if PyInstaller is installed
    try:
        import PyInstaller
        print("✓ PyInstaller is installed")
    except ImportError:
        print("Installing PyInstaller...")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "pyinstaller"])
        print("✓ PyInstaller installed successfully")
    
    # Clean previous builds
    print("\nCleaning previous builds...")
    for dir_name in ['build', 'dist']:
        if os.path.exists(dir_name):
            shutil.rmtree(dir_name)
            print(f"  Removed {dir_name}/")
    
    # Build command
    # NOTE: We deliberately do NOT bundle the .env file. Doing so would ship
    # the developer's Spotify client_id/client_secret to every end user.
    # Users supply their own .env next to the executable at runtime.
    build_cmd = [
        "pyinstaller",
        "--name=CrateHacker",
        "--onefile",
        "--windowed",
        "--icon=NONE",  # Add an icon file path here if you have one
        "--hidden-import=nicegui",
        "--hidden-import=spotipy",
        "--hidden-import=thefuzz",
        "--hidden-import=xmltodict",
        "--hidden-import=dotenv",
        "--hidden-import=collection_search",
        "--hidden-import=collection_utils",
        "--hidden-import=spotify_utils",
        "--hidden-import=disk_search",
        "--collect-all=nicegui",
        "--noconfirm",
        "crate.py"
    ]
    
    print("\nBuilding executable...")
    print(f"Command: {' '.join(build_cmd)}")
    print()
    
    try:
        result = subprocess.run(build_cmd, check=True)
        print("\n" + "=" * 60)
        print("✓ Build successful!")
        print("=" * 60)
        print(f"\nExecutable location: {os.path.abspath('dist/CrateHacker.exe')}")
        print("\nYou can now distribute the 'dist/CrateHacker.exe' file.")
        print("\nNote: Users will still need to:")
        print("  1. Have their Traktor collection file")
        print("  2. Set up Spotify API credentials in .env file")
        print("  3. Have the .env file in the same directory as the executable")
        
    except subprocess.CalledProcessError as e:
        print("\n" + "=" * 60)
        print("✗ Build failed!")
        print("=" * 60)
        print(f"Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    build_executable()
