"""
Runtime settings service — persistent mutable configuration store.

Allows the Settings UI to change models, toggle auto-run pipeline,
pick the active LLM provider (ollama / openai / gemini), and store
per-provider credentials without restarting the server.

Values are persisted to a JSON file on disk so API keys survive
restart. Env vars act as defaults only on first boot.
"""

from __future__ import annotations

import json
import logging
import threading
from pathlib import Path
from typing import Any

from app.config import (
    OLLAMA_MODEL,
    OLLAMA_EMBEDDING_MODEL,
    OLLAMA_BASE_URL,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    GEMINI_API_KEY,
    GEMINI_MODEL,
    LLM_PROVIDER,
    AGENT_TEMPERATURE,
    BASE_DIR,
)

logger = logging.getLogger("itops.settings_service")

SETTINGS_FILE = Path(BASE_DIR) / "runtime_settings.json"

SUPPORTED_LLM_PROVIDERS = ("ollama", "openai", "gemini")

# Keys that must never be echoed back to any caller in cleartext.
_SECRET_FIELDS = ("openai_api_key", "gemini_api_key")


class _Settings:
    """Thread-safe singleton holding mutable runtime settings."""

    def __init__(self):
        self._lock = threading.RLock()

        # ── LLM provider selection ──────────────────────────
        # Exactly one of: "ollama", "openai", "gemini".
        self.llm_provider: str = (
            LLM_PROVIDER if LLM_PROVIDER in SUPPORTED_LLM_PROVIDERS else "ollama"
        )

        # ── Ollama settings (local) ─────────────────────────
        self.ollama_model: str = OLLAMA_MODEL
        self.ollama_embedding_model: str = OLLAMA_EMBEDDING_MODEL
        self.ollama_base_url: str = OLLAMA_BASE_URL

        # ── OpenAI settings ─────────────────────────────────
        self.openai_api_key: str = OPENAI_API_KEY
        self.openai_model: str = OPENAI_MODEL

        # ── Gemini settings ─────────────────────────────────
        self.gemini_api_key: str = GEMINI_API_KEY
        self.gemini_model: str = GEMINI_MODEL

        # ── Shared agent settings ───────────────────────────
        self.agent_temperature: float = AGENT_TEMPERATURE

        # User-defined custom models that should appear in dropdowns,
        # keyed by provider (e.g. "ollama", "openai", "gemini").
        self.custom_llm_models: list[str] = []
        self.custom_embedding_models: list[str] = []
        self.custom_openai_models: list[str] = []
        self.custom_gemini_models: list[str] = []

        # ── Auto-run pipeline settings ──────────────────────
        self.auto_run_pipeline: bool = False
        self.auto_run_interval_seconds: int = 60

        # Monotonically increasing version counter so consumers
        # (e.g. cached LLM singletons) can detect config changes.
        self._version: int = 0

        self._load_from_disk()

    # ── Persistence ─────────────────────────────────────────

    _PERSISTED_FIELDS = (
        "llm_provider",
        "ollama_model",
        "ollama_embedding_model",
        "ollama_base_url",
        "openai_api_key",
        "openai_model",
        "gemini_api_key",
        "gemini_model",
        "agent_temperature",
        "custom_llm_models",
        "custom_embedding_models",
        "custom_openai_models",
        "custom_gemini_models",
        "auto_run_pipeline",
        "auto_run_interval_seconds",
    )

    def _load_from_disk(self) -> None:
        if not SETTINGS_FILE.exists():
            return
        try:
            with open(SETTINGS_FILE, "r") as f:
                saved = json.load(f)
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Failed to read %s: %s — using defaults", SETTINGS_FILE, exc)
            return

        for key in self._PERSISTED_FIELDS:
            if key in saved and hasattr(self, key):
                setattr(self, key, saved[key])

    def _save_to_disk(self) -> None:
        data = {key: getattr(self, key) for key in self._PERSISTED_FIELDS}
        try:
            tmp = SETTINGS_FILE.with_suffix(".json.tmp")
            with open(tmp, "w") as f:
                json.dump(data, f, indent=2)
            tmp.replace(SETTINGS_FILE)
        except OSError as exc:
            logger.error("Failed to persist settings to %s: %s", SETTINGS_FILE, exc)

    # ── Getters ─────────────────────────────────────────────

    @property
    def version(self) -> int:
        return self._version

    def snapshot(self, *, include_secrets: bool = False) -> dict[str, Any]:
        """Return a JSON-serialisable snapshot of current settings.

        With include_secrets=False (default), secret fields are replaced
        with a redacted placeholder string — safe to return over HTTP.
        """
        with self._lock:
            raw: dict[str, Any] = {
                "llm_provider": self.llm_provider,
                "ollama_model": self.ollama_model,
                "ollama_embedding_model": self.ollama_embedding_model,
                "ollama_base_url": self.ollama_base_url,
                "openai_api_key": self.openai_api_key,
                "openai_model": self.openai_model,
                "gemini_api_key": self.gemini_api_key,
                "gemini_model": self.gemini_model,
                "agent_temperature": self.agent_temperature,
                "custom_llm_models": list(self.custom_llm_models),
                "custom_embedding_models": list(self.custom_embedding_models),
                "custom_openai_models": list(self.custom_openai_models),
                "custom_gemini_models": list(self.custom_gemini_models),
                "auto_run_pipeline": self.auto_run_pipeline,
                "auto_run_interval_seconds": self.auto_run_interval_seconds,
            }
            if include_secrets:
                return raw

            for field in _SECRET_FIELDS:
                val = raw.get(field)
                raw[field + "_set"] = bool(val)
                raw[field] = "***" if val else ""
            return raw

    # ── Setters ─────────────────────────────────────────────

    def update(self, **kwargs) -> dict[str, Any]:
        """Update one or more settings. Returns the redacted snapshot."""
        with self._lock:
            changed = False
            for key, value in kwargs.items():
                if not hasattr(self, key) or key.startswith("_"):
                    continue
                if key == "llm_provider":
                    value = (value or "").lower()
                    if value not in SUPPORTED_LLM_PROVIDERS:
                        continue
                # Ignore redaction placeholder so the UI can submit the
                # snapshot unchanged without overwriting stored keys.
                if key in _SECRET_FIELDS and value == "***":
                    continue
                old = getattr(self, key)
                if old != value:
                    setattr(self, key, value)
                    changed = True
            if changed:
                self._version += 1
                self._save_to_disk()
            return self.snapshot()


# ── Module-level singleton ──────────────────────────────────

settings = _Settings()
