"""Settings API — read/update runtime configuration from the UI."""

from __future__ import annotations

import logging
from typing import Any

import ollama
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.settings_service import settings, SUPPORTED_LLM_PROVIDERS
from app.llm.provider import test_provider as _test_provider

logger = logging.getLogger("itops.settings")

router = APIRouter(prefix="/settings", tags=["Settings"])


# ── Pydantic models ─────────────────────────────────────────


class SettingsUpdate(BaseModel):
    # Provider selection — exactly one of: ollama | openai | gemini.
    llm_provider: str | None = None

    # Ollama (local)
    ollama_model: str | None = None
    ollama_embedding_model: str | None = None
    ollama_base_url: str | None = None

    # OpenAI
    openai_api_key: str | None = None
    openai_model: str | None = None

    # Gemini
    gemini_api_key: str | None = None
    gemini_model: str | None = None

    # Shared
    agent_temperature: float | None = None
    custom_llm_models: list[str] | None = None
    custom_embedding_models: list[str] | None = None
    custom_openai_models: list[str] | None = None
    custom_gemini_models: list[str] | None = None
    auto_run_pipeline: bool | None = None
    auto_run_interval_seconds: int | None = None


class TestProviderRequest(BaseModel):
    provider: str = Field(..., description="ollama | openai | gemini")
    model: str | None = None
    # For openai / gemini, if api_key is omitted the stored value is used.
    api_key: str | None = None
    # For ollama, if base_url is omitted the stored value is used.
    base_url: str | None = None


# ── Endpoints ────────────────────────────────────────────────


@router.get("/")
def get_settings() -> dict[str, Any]:
    """Return the current runtime settings, with API keys redacted."""
    return settings.snapshot()


@router.put("/")
def update_settings(body: SettingsUpdate) -> dict[str, Any]:
    """Update one or more runtime settings.

    Secret fields submitted as the redaction placeholder ("***") are
    ignored so the UI can round-trip the snapshot without overwriting
    stored keys.
    """
    payload = {k: v for k, v in body.model_dump().items() if v is not None}
    if not payload:
        raise HTTPException(status_code=400, detail="No settings provided")

    if "llm_provider" in payload and payload["llm_provider"] not in SUPPORTED_LLM_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"llm_provider must be one of {SUPPORTED_LLM_PROVIDERS}",
        )

    new_snapshot = settings.update(**payload)
    safe_keys = [k for k in payload.keys() if "api_key" not in k]
    logger.info(f"Settings updated: {safe_keys}")

    # Any model / provider / temperature change invalidates any cached
    # embedding / client state.
    if {"ollama_embedding_model", "ollama_base_url"} & payload.keys():
        _invalidate_embedding_cache()

    return new_snapshot


@router.get("/ollama-models")
def list_ollama_models() -> dict[str, Any]:
    """Query the local Ollama server for installed models."""
    try:
        client = ollama.Client(host=settings.ollama_base_url)
        models_response = client.list()
        models = []
        for m in getattr(models_response, "models", []):
            models.append({
                "name": getattr(m, "model", "") or "",
                "size": getattr(m, "size", 0) or 0,
                "modified_at": str(getattr(m, "modified_at", "")),
            })
        return {"models": models}
    except Exception as e:
        logger.warning(f"Failed to list Ollama models: {e}")
        return {"models": [], "error": str(e)}


@router.post("/test-provider")
def test_llm_provider(body: TestProviderRequest) -> dict[str, Any]:
    """Ping the given provider to validate credentials / reachability.

    Uses the request body's api_key / base_url when provided, otherwise
    falls back to the currently stored settings — so the UI can test
    without forcing the user to retype a saved key.
    """
    provider = (body.provider or "").lower()
    if provider not in SUPPORTED_LLM_PROVIDERS:
        raise HTTPException(
            status_code=400,
            detail=f"provider must be one of {SUPPORTED_LLM_PROVIDERS}",
        )

    snapshot = settings.snapshot(include_secrets=True)
    if provider == "openai":
        api_key = body.api_key or snapshot["openai_api_key"]
        model = body.model or snapshot["openai_model"]
        return _test_provider("openai", model=model, api_key=api_key)
    if provider == "gemini":
        api_key = body.api_key or snapshot["gemini_api_key"]
        model = body.model or snapshot["gemini_model"]
        return _test_provider("gemini", model=model, api_key=api_key)

    # ollama
    base_url = body.base_url or snapshot["ollama_base_url"]
    model = body.model or snapshot["ollama_model"]
    return _test_provider("ollama", model=model, base_url=base_url)


# ── Cache invalidation helpers ───────────────────────────────


def _invalidate_embedding_cache():
    """Reset the cached vector store so it picks up the new embedding model."""
    from app.memory import vector_store
    vector_store._memory_instance = None
    logger.info("Embedding cache invalidated — vector store will use the new model")
