@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo.
echo   Couple Menu  ->  GitHub
echo   default: new branch "couple-menu" on HunYiSage/dsh-purge
echo   new repo:  push.cmd -Mode newrepo -RepoName couple-menu
echo   token:     https://github.com/settings/tokens/new  (check "repo")
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0push.ps1" %*
echo.
pause
endlocal
