@echo off
setlocal

echo ============================================================
echo   Frame Manifest Generator + R2 Uploader
echo   (implementation_plan_v19.md)
echo ============================================================
echo.

set /p FOLDER="Deliverable folder (drag ^& drop it here, then Enter): "
if "%FOLDER%"=="" goto err
set "FOLDER=%FOLDER:"=%"
if not exist "%FOLDER%" goto errFolder

echo.
echo [1/2] Generating manifest.json ...
node "%~dp0generate_manifest.mjs" "%FOLDER%"
if errorlevel 1 goto err
echo.

set /p REMOTE="R2 rclone remote ^& bucket (e.g. r2:geosphere-panorama): "
if "%REMOTE%"=="" goto err
set "REMOTE=%REMOTE:"=%"

echo.
echo [2/2] Uploading to %REMOTE%/manifest.json ...
rclone copyto "%FOLDER%\manifest.json" "%REMOTE%/manifest.json"
if errorlevel 1 goto err

echo.
echo Done! Verify in the dashboard: Admin -^> Settings -^> Verify Manifest
echo ============================================================
pause
exit /b 0

:errFolder
echo ERROR: folder not found: %FOLDER%
goto err

:err
echo.
echo FAILED - see error above.
pause
exit /b 1