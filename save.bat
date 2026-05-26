@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ============================================
echo   HAZZYS DASHBOARD - SAVE (push to GitHub)
echo ============================================
echo.

git status --short
echo.

set /p MSG=Commit message (Enter de dung mac dinh):
if "%MSG%"=="" set MSG=Update %date% %time%

echo.
echo [1/3] Staging changes...
git add .

echo [2/3] Committing...
git commit -m "%MSG%"

echo [3/3] Pushing to GitHub...
git push origin main

echo.
echo ============================================
echo   DONE - Da push len GitHub
echo   Live: https://lyan1508.github.io/hazzys_dashboard/
echo ============================================
pause
