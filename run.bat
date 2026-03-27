@echo off
setlocal EnableExtensions EnableDelayedExpansion
title ITOps Orchestrator

set "ROOT_DIR=%~dp0"
cd /d "%ROOT_DIR%"

set "BACKEND_DIR=%ROOT_DIR%backend"
set "FRONTEND_DIR=%ROOT_DIR%frontend"
set "VENV_PYTHON=%BACKEND_DIR%\venv\Scripts\python.exe"

echo ============================================
echo   IT Operations Orchestrator - Quick Start
echo ============================================
echo.

where py >nul 2>&1
if not errorlevel 1 (
    set "PYTHON_CMD=py -3"
) else (
    where python >nul 2>&1
    if errorlevel 1 (
        echo [ERROR] Python 3 is not installed or not on PATH.
        echo         Install Python 3.10+ from https://www.python.org/downloads/windows/
        pause
        exit /b 1
    )
    set "PYTHON_CMD=python"
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed or not on PATH.
    echo         Install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\.env" (
    if exist "%BACKEND_DIR%\.env.example" (
        copy /Y "%BACKEND_DIR%\.env.example" "%BACKEND_DIR%\.env" >nul
        echo [INFO] Created backend\.env from backend\.env.example
    ) else (
        type nul > "%BACKEND_DIR%\.env"
        echo [INFO] Created empty backend\.env
    )
)

findstr /R /C:"^OPENAI_API_KEY=." "%BACKEND_DIR%\.env" >nul 2>&1
if errorlevel 1 (
    echo [WARN] OPENAI_API_KEY is not set in backend\.env
    echo        Agent features may fail until you add it.
    echo.
)

if not exist "%VENV_PYTHON%" (
    echo [1/5] Creating backend virtual environment...
    call %PYTHON_CMD% -m venv "%BACKEND_DIR%\venv"
    if errorlevel 1 (
        echo [ERROR] Failed to create the Python virtual environment.
        pause
        exit /b 1
    )
)

echo [2/5] Installing backend dependencies...
call "%VENV_PYTHON%" -m pip install --upgrade pip
if errorlevel 1 (
    echo [ERROR] Failed to upgrade pip.
    pause
    exit /b 1
)

call "%VENV_PYTHON%" -m pip install -r "%BACKEND_DIR%\requirements.txt"
if errorlevel 1 (
    echo [ERROR] Failed to install backend dependencies.
    pause
    exit /b 1
)

echo [3/5] Installing frontend dependencies...
call npm --prefix "%FRONTEND_DIR%" install
if errorlevel 1 (
    echo [ERROR] Failed to install frontend dependencies.
    pause
    exit /b 1
)

echo [4/5] Starting backend on http://localhost:8000 ...
start "ITOps Backend" cmd /k "cd /d \"%BACKEND_DIR%\" && \"%VENV_PYTHON%\" -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"

echo Waiting for the backend to start...
powershell -NoProfile -Command ^
  "$deadline = (Get-Date).AddSeconds(30);" ^
  "do {" ^
  "  try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:8000/health | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 }" ^
  "} while ((Get-Date) -lt $deadline);" ^
  "exit 1"
if errorlevel 1 (
    echo [ERROR] Backend did not become ready on http://127.0.0.1:8000/health
    echo         Check the 'ITOps Backend' window for errors.
    pause
    exit /b 1
)

echo [5/5] Starting frontend on http://localhost:3000 ...
start "ITOps Frontend" cmd /k "cd /d \"%FRONTEND_DIR%\" && npm run dev"

echo.
echo ============================================
echo   Backend  : http://localhost:8000/docs
echo   Frontend : http://localhost:3000
echo ============================================
echo.
echo The backend and frontend are running in separate windows.
pause
