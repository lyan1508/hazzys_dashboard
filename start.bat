@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   HAZZYS DASHBOARD - START (pull from GitHub)
echo ============================================
echo.

echo [1/2] Pulling bản mới nhất từ GitHub...
git pull origin main

echo.
echo [2/2] Mo dashboard trong trinh duyet...
start "" "index.html"

echo.
echo ============================================
echo   DONE - Dashboard da mo, du lieu se tu sync
echo ============================================
timeout /t 3 >nul
