@echo off
REM GeoSphere 360 Station Agent launcher (Windows autostart via Task Scheduler)
REM Create a venv once, then schedule this script at user logon:
REM   py -3.10 -m venv .venv && .venv\Scripts\python -m pip install -r requirements.txt
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" app.py
) else (
  python app.py
)
