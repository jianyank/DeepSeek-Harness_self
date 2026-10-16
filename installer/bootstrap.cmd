@echo off
setlocal EnableExtensions
set "STAGE=%TEMP%\dsh-self-install-%RANDOM%-%RANDOM%"
mkdir "%STAGE%" >nul 2>nul
if not exist "%STAGE%" (
  echo Could not create extraction directory.
  exit /b 1
)
"%SystemRoot%\System32\tar.exe" -xf "%~dp0payload.zip" -C "%STAGE%"
if errorlevel 1 (
  echo Could not extract DSH Self.
  exit /b 1
)
call "%STAGE%\installer\install.cmd" "%STAGE%"
set "RC=%ERRORLEVEL%"
if "%RC%"=="0" rmdir /s /q "%STAGE%" >nul 2>nul
if not "%RC%"=="0" echo Installation failed. Diagnostic files remain at "%STAGE%".
exit /b %RC%
