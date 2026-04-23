from __future__ import annotations
"""
LLM provider abstraction.

Unifies Ollama, OpenAI, and Gemini behind a single `chat_json` call so
the agent pipeline can switch providers at runtime without any other
code change. Only one provider is active at a time, selected via
`settings.llm_provider`.

All calls are synchronous here; callers in async code wrap them in
`asyncio.to_thread` so the event loop is not blocked.
"""

import json
import logging
import re
from typing import Any

logger = logging.getLogger("itops.llm.provider")

PROVIDERS = ("ollama", "openai", "gemini")

# Matches the JSON object inside a ```json ... ``` or ``` ... ``` fence.
_FENCED_JSON = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)


def parse_json_tolerant(text: str) -> dict | None:
    """Parse LLM output that is supposed to be JSON, tolerant of small-model quirks.

    Strategy: raw text → fenced code block → first balanced {...} substring.
    """
    if not text:
        return None

    text = text.strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    fence_match = _FENCED_JSON.search(text)
    if fence_match:
        try:
            return json.loads(fence_match.group(1))
        except json.JSONDecodeError:
            pass

    first = text.find("{")
    last = text.rfind("}")
    if first != -1 and last != -1 and last > first:
        try:
            return json.loads(text[first : last + 1])
        except json.JSONDecodeError:
            pass

    return None


# ── Per-provider callers ────────────────────────────────────────────


def _call_ollama(prompt: str, model: str, temperature: float, *, base_url: str | None) -> dict | None:
    import ollama
    client = ollama.Client(host=base_url) if base_url else ollama
    response = client.chat(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        format="json",
        options={"temperature": temperature},
    )
    # ollama.Client.chat returns the same dict shape as module-level chat.
    text = response.get("message", {}).get("content", "") if isinstance(response, dict) else getattr(response, "message", {}).get("content", "")
    return parse_json_tolerant(text)


def _call_openai(prompt: str, model: str, temperature: float, *, api_key: str) -> dict | None:
    from openai import OpenAI
    client = OpenAI(api_key=api_key)
    response = client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=temperature,
    )
    text = response.choices[0].message.content if response.choices else ""
    return parse_json_tolerant(text or "")


def _call_gemini(prompt: str, model: str, temperature: float, *, api_key: str) -> dict | None:
    from google import genai
    from google.genai import types as genai_types

    client = genai.Client(api_key=api_key)
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=genai_types.GenerateContentConfig(
            response_mime_type="application/json",
            temperature=temperature,
        ),
    )
    text = getattr(response, "text", "") or ""
    return parse_json_tolerant(text)


# ── Public API ──────────────────────────────────────────────────────


class ProviderConfigError(RuntimeError):
    """Raised when the selected provider is not configured (missing API key, etc.)."""


def _active_provider_config() -> dict[str, Any]:
    """Snapshot the active provider's effective runtime config from settings."""
    from app.services.settings_service import settings as _settings
    provider = (_settings.llm_provider or "ollama").lower()
    if provider not in PROVIDERS:
        provider = "ollama"

    if provider == "ollama":
        return {
            "provider": "ollama",
            "model": _settings.ollama_model or "llama3.2:3b",
            "base_url": _settings.ollama_base_url,
        }
    if provider == "openai":
        return {
            "provider": "openai",
            "model": _settings.openai_model or "gpt-4o-mini",
            "api_key": _settings.openai_api_key or "",
        }
    if provider == "gemini":
        return {
            "provider": "gemini",
            "model": _settings.gemini_model or "gemini-2.0-flash",
            "api_key": _settings.gemini_api_key or "",
        }
    return {"provider": "ollama", "model": "llama3.2:3b", "base_url": _settings.ollama_base_url}


def chat_json(prompt: str, *, temperature: float = 0.1) -> dict | None:
    """Send a prompt to the active LLM provider and return parsed JSON.

    Returns None on any failure (missing config, network error, non-JSON
    response). The pipeline degrades to its deterministic fallback.
    """
    cfg = _active_provider_config()
    provider = cfg["provider"]
    model = cfg["model"]

    try:
        if provider == "ollama":
            return _call_ollama(
                prompt, model, temperature, base_url=cfg.get("base_url") or None
            )
        if provider == "openai":
            if not cfg.get("api_key"):
                logger.warning("OpenAI selected but no API key configured")
                return None
            return _call_openai(prompt, model, temperature, api_key=cfg["api_key"])
        if provider == "gemini":
            if not cfg.get("api_key"):
                logger.warning("Gemini selected but no API key configured")
                return None
            return _call_gemini(prompt, model, temperature, api_key=cfg["api_key"])
    except Exception as exc:
        logger.warning("%s call failed: %s", provider, exc)
        return None

    return None


def test_provider(provider: str, *, model: str | None = None, api_key: str | None = None, base_url: str | None = None) -> dict:
    """Ping the given provider with a trivial JSON prompt. Used by the UI's
    Test-connection button. Returns {ok, message, model}.
    """
    provider = (provider or "").lower()
    if provider not in PROVIDERS:
        return {"ok": False, "message": f"Unknown provider '{provider}'"}

    prompt = 'Return a JSON object of the form {"ok": true}. Nothing else.'

    try:
        if provider == "ollama":
            mdl = model or "llama3.2:3b"
            result = _call_ollama(prompt, mdl, 0.0, base_url=base_url)
            return {"ok": bool(result), "message": "Reachable" if result else "No JSON response", "model": mdl}
        if provider == "openai":
            if not api_key:
                return {"ok": False, "message": "API key required"}
            mdl = model or "gpt-4o-mini"
            result = _call_openai(prompt, mdl, 0.0, api_key=api_key)
            return {"ok": bool(result), "message": "Reachable" if result else "No JSON response", "model": mdl}
        if provider == "gemini":
            if not api_key:
                return {"ok": False, "message": "API key required"}
            mdl = model or "gemini-2.0-flash"
            result = _call_gemini(prompt, mdl, 0.0, api_key=api_key)
            return {"ok": bool(result), "message": "Reachable" if result else "No JSON response", "model": mdl}
    except Exception as exc:
        return {"ok": False, "message": str(exc)[:300]}

    return {"ok": False, "message": "unreachable"}
