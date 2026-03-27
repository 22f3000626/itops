import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# Database
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'itops.db'}")

# OpenAI
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# ChromaDB
CHROMA_PERSIST_DIR = str(BASE_DIR / "chroma_db")

# Simulator
SIMULATOR_INTERVAL_SECONDS = int(os.getenv("SIMULATOR_INTERVAL_SECONDS", "5"))
NUM_SIMULATED_SERVERS = int(os.getenv("NUM_SIMULATED_SERVERS", "6"))
ANOMALY_PROBABILITY = float(os.getenv("ANOMALY_PROBABILITY", "0.15"))

# Remediation
REMEDIATION_AUTO_APPROVE_SEVERITY = os.getenv(
    "REMEDIATION_AUTO_APPROVE_SEVERITY", "low,medium"
).split(",")

# Agent config
AGENT_TEMPERATURE = float(os.getenv("AGENT_TEMPERATURE", "0.1"))
