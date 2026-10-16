@echo off
setlocal EnableExtensions
set "SOURCE_ROOT=%~1"
if not defined SOURCE_ROOT set "SOURCE_ROOT=%~dp0.."
"%SOURCE_ROOT%\app\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" "%SOURCE_ROOT%\installer\install.mjs" "%SOURCE_ROOT%"
exit /b %ERRORLEVEL%
