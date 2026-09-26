@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem This command is safe for MCP stdio: setup output is sent to stderr.
set "PROJECT_DIR=%~dp0"
set "NEEDS_SETUP=0"

rem Reuse the Agent's existing Node environment when one is provided.
if defined WORKBUDDY_NODE_HOME set "PATH=%WORKBUDDY_NODE_HOME%;%PATH%"

rem Load credentials from "%PROJECT_DIR%.env" if present (KEY=VALUE, '#' comments).
rem Values defined there override the ones inherited from the host environment.
if exist "%PROJECT_DIR%.env" (
    for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%PROJECT_DIR%.env") do (
        if not "%%~A"=="" set "%%~A=%%B"
    )
)

if /I "%WORKBUDDY_FORCE_INSTALL%"=="1" set "NEEDS_SETUP=1"
if not exist "%PROJECT_DIR%node_modules\typescript\lib\tsc.js" set "NEEDS_SETUP=1"
if not exist "%PROJECT_DIR%dist\mcp\server.js" set "NEEDS_SETUP=1"

if "%NEEDS_SETUP%"=="1" (
    call "%PROJECT_DIR%init.cmd" 1>&2
    if errorlevel 1 exit /b 1
)

node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is required to start the MCP server. 1>&2
    exit /b 1
)

rem Keep stdout exclusively for the MCP protocol.
node "%PROJECT_DIR%dist\mcp\server.js"
exit /b %errorlevel%
