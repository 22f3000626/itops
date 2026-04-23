import datetime as _dt
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()


def utc_now() -> _dt.datetime:
    """Naive UTC datetime, without the 3.12+ deprecation warning on utcnow()."""
    return _dt.datetime.now(_dt.timezone.utc).replace(tzinfo=None)

BASE_DIR = Path(__file__).resolve().parent.parent

# Database
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'itops.db'}")

# LLM provider selection (ollama | openai | gemini). Used as the default
# on first boot; the runtime value lives in runtime_settings.json and is
# edited from the Settings UI.
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "ollama")

# Ollama configuration (local provider)
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3.2:3b")
OLLAMA_EMBEDDING_MODEL = os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")

# OpenAI provider (optional — only used when llm_provider=="openai")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# Gemini provider (optional — only used when llm_provider=="gemini")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")

# ChromaDB
CHROMA_PERSIST_DIR = str(BASE_DIR / "chroma_db")

# Simulator
SIMULATOR_INTERVAL_SECONDS = int(os.getenv("SIMULATOR_INTERVAL_SECONDS", "5"))
NUM_SIMULATED_SERVERS = int(os.getenv("NUM_SIMULATED_SERVERS", "6"))
ANOMALY_PROBABILITY = float(os.getenv("ANOMALY_PROBABILITY", "0.15"))

# Agent config
AGENT_TEMPERATURE = float(os.getenv("AGENT_TEMPERATURE", "0.1"))
