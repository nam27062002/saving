@echo off
rem Run auto-start.ps1 in hidden mode
powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0auto-start.ps1"
