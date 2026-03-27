# Run the App (Command Set)

This project has a FastAPI backend and a Vite React frontend.

## Prerequisites

- Python 3.10+ installed
- Node.js 18+ and npm installed
- OpenAI API key

---

## macOS

From the project root:

```bash
chmod +x run-macos.sh
./run-macos.sh
```

This script:
- Checks for Python 3, `venv`, npm, and curl
- Creates `backend/.env` from `.env.example` if needed
- Creates `backend/venv` if needed
- Installs backend and frontend dependencies
- Starts the backend first, then the frontend

## Linux

From the project root:

```bash
chmod +x run-linux.sh
./run-linux.sh
```

This script:
- Checks for Python 3, `venv`, npm, and curl
- Creates `backend/.env` from `.env.example` if needed
- Creates `backend/venv` if needed
- Installs backend and frontend dependencies
- Starts the backend first, then the frontend

---

## Windows

From the project root:

```bat
run.bat
```

This script:
- Checks for Python 3 and npm
- Creates `backend/.env` from `.env.example` if needed
- Creates `backend/venv` if needed
- Installs backend and frontend dependencies
- Starts backend and frontend in separate terminals

---

## Stop the App

- macOS/Linux: press `Ctrl + C` in the launcher terminal
- Windows: close the backend and frontend terminal windows or press `Ctrl + C` in each
