@echo off
setlocal
pushd "%~dp0.."
node tools\build-exe.js %*
set "RC=%ERRORLEVEL%"
popd
exit /b %RC%
