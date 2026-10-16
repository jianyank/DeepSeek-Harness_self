@echo off
setlocal
for %%I in ("%~dp0..") do set "ROOT=%%~fI"
"%ROOT%\app\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" "%~dp0manage.mjs" uninstall "%ROOT%"
exit /b %ERRORLEVEL%
