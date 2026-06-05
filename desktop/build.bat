@echo off
echo ========================================
echo Building CrateHacker Executable
echo ========================================
echo.

REM Activate virtual environment if it exists
if exist crateenv\Scripts\activate.bat (
    echo Activating virtual environment...
    call crateenv\Scripts\activate.bat
)

echo Running build script...
python build_exe.py

echo.
echo ========================================
echo Build Complete!
echo ========================================
echo.
echo The executable is in the dist\ folder
echo.
pause
