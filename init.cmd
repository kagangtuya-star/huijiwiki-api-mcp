@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Always run from the directory that contains this script.
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%" >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Cannot enter the project directory: "%PROJECT_DIR%" 1>&2
    exit /b 1
)

rem Reuse the Agent's existing Node environment when one is provided.
rem WORKBUDDY_NODE_HOME must point to the directory containing node.exe.
if defined WORKBUDDY_NODE_HOME set "PATH=%WORKBUDDY_NODE_HOME%;%PATH%"

rem Use the Tsinghua npm mirror for npm, Corepack and Yarn.
set "NPM_REGISTRY=https://registry.npmmirror.com"
set "npm_config_registry=%NPM_REGISTRY%"
set "COREPACK_NPM_REGISTRY=%NPM_REGISTRY%"
set "YARN_NPM_REGISTRY_SERVER=%NPM_REGISTRY%"

node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is required. Install Node.js 18 or newer and run this script again. 1>&2
    exit /b 1
)

npm --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is required but was not found. Reinstall Node.js and run this script again. 1>&2
    exit /b 1
)

set "HAS_NPX=0"
npx --version >nul 2>&1
if not errorlevel 1 set "HAS_NPX=1"

set "YARN_RUNNER="
corepack --version >nul 2>&1
if not errorlevel 1 set "YARN_RUNNER=COREPACK"
if not defined YARN_RUNNER if "%HAS_NPX%"=="1" set "YARN_RUNNER=NPX"
if not defined YARN_RUNNER (
    echo [ERROR] Corepack or npx is required to run Yarn 4.12.0. 1>&2
    exit /b 1
)

echo [INFO] Installing dependencies from the Tsinghua npm mirror... 1>&2
if /I "%YARN_RUNNER%"=="COREPACK" (
    call corepack yarn install --immutable
    if not errorlevel 1 goto BUILD
    if "%HAS_NPX%"=="1" (
        echo [WARN] Corepack failed; retrying with npx... 1>&2
        set "YARN_RUNNER=NPX"
        call npx -y yarn@4.12.0 install --immutable
        if not errorlevel 1 goto BUILD
    )
    echo [ERROR] Dependency installation failed. 1>&2
    exit /b 1
)

call npx -y yarn@4.12.0 install --immutable
if errorlevel 1 (
    echo [ERROR] Dependency installation failed. 1>&2
    exit /b 1
)

:BUILD
echo [INFO] Building the project... 1>&2
if /I "%YARN_RUNNER%"=="COREPACK" (
    call corepack yarn build
    if not errorlevel 1 goto DONE
    if "%HAS_NPX%"=="1" (
        echo [WARN] Corepack build failed; retrying with npx... 1>&2
        set "YARN_RUNNER=NPX"
        call npx -y yarn@4.12.0 build
        if not errorlevel 1 goto DONE
    )
    echo [ERROR] Build failed. 1>&2
    exit /b 1
)

call npx -y yarn@4.12.0 build
if errorlevel 1 (
    echo [ERROR] Build failed. 1>&2
    exit /b 1
)

:DONE
echo [INFO] Dependencies installed and project built successfully. 1>&2
exit /b 0
