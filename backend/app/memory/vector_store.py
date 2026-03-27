"""
Institutional Memory System — lightweight vector store.

Uses OpenAI embeddings + numpy cosine similarity for RAG.
Persists to a JSON file on disk. No C++ build tools required.
"""

import json
import logging
import os
from pathlib import Path

import numpy as np
from openai import OpenAI

from app.config import OPENAI_API_KEY, CHROMA_PERSIST_DIR

logger = logging.getLogger("itops.memory")

EMBEDDING_MODEL = "text-embedding-3-small"


class InstitutionalMemory:
    """Vector store for incident knowledge and runbooks using OpenAI embeddings."""

    def __init__(self):
        self._persist_dir = Path(CHROMA_PERSIST_DIR)
        self._persist_dir.mkdir(parents=True, exist_ok=True)
        self._incidents_path = self._persist_dir / "incidents.json"
        self._runbooks_path = self._persist_dir / "runbooks.json"

        self._incidents: list[dict] = self._load(self._incidents_path)
        self._runbooks: list[dict] = self._load(self._runbooks_path)

        self._client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

    @staticmethod
    def _load(path: Path) -> list[dict]:
        if path.exists():
            try:
                with open(path, "r") as f:
                    return json.load(f)
            except (json.JSONDecodeError, IOError):
                return []
        return []

    def _save(self, path: Path, data: list[dict]) -> None:
        try:
            with open(path, "w") as f:
                json.dump(data, f, indent=2, default=str)
        except IOError as e:
            logger.error(f"Failed to persist memory: {e}")

    def _get_embedding(self, text: str) -> list[float] | None:
        if not self._client:
            return None
        try:
            response = self._client.embeddings.create(
                model=EMBEDDING_MODEL,
                input=text[:8000],  # Truncate to model limit
            )
            return response.data[0].embedding
        except Exception as e:
            logger.warning(f"Embedding failed: {e}")
            return None

    @staticmethod
    def _cosine_similarity(a: list[float], b: list[float]) -> float:
        a_arr = np.array(a)
        b_arr = np.array(b)
        dot = np.dot(a_arr, b_arr)
        norm = np.linalg.norm(a_arr) * np.linalg.norm(b_arr)
        if norm == 0:
            return 0.0
        return float(dot / norm)

    def store_incident(
        self,
        incident_id: int,
        title: str,
        description: str,
        root_cause: str,
        resolution: str,
        severity: str,
        node_type: str,
    ) -> None:
        doc = (
            f"Incident: {title}\n"
            f"Description: {description}\n"
            f"Root Cause: {root_cause}\n"
            f"Resolution: {resolution}\n"
            f"Severity: {severity}\n"
            f"Node Type: {node_type}"
        )
        embedding = self._get_embedding(doc)

        # Upsert: replace if same incident_id exists
        self._incidents = [
            e for e in self._incidents if e.get("id") != f"incident-{incident_id}"
        ]
        self._incidents.append({
            "id": f"incident-{incident_id}",
            "document": doc,
            "embedding": embedding,
            "metadata": {
                "incident_id": incident_id,
                "severity": severity,
                "node_type": node_type,
            },
        })
        self._save(self._incidents_path, self._incidents)

    def store_runbook(
        self,
        runbook_id: int,
        title: str,
        problem_pattern: str,
        solution_steps: str,
    ) -> None:
        doc = f"Runbook: {title}\nProblem: {problem_pattern}\nSolution:\n{solution_steps}"
        embedding = self._get_embedding(doc)

        self._runbooks = [
            e for e in self._runbooks if e.get("id") != f"runbook-{runbook_id}"
        ]
        self._runbooks.append({
            "id": f"runbook-{runbook_id}",
            "document": doc,
            "embedding": embedding,
            "metadata": {"runbook_id": runbook_id, "title": title},
        })
        self._save(self._runbooks_path, self._runbooks)

    def _search(self, collection: list[dict], query: str, n_results: int) -> list[dict]:
        if not collection:
            return []

        query_embedding = self._get_embedding(query)

        # If embeddings are available, use cosine similarity
        if query_embedding:
            scored = []
            for entry in collection:
                emb = entry.get("embedding")
                if emb:
                    sim = self._cosine_similarity(query_embedding, emb)
                    scored.append((sim, entry))
                else:
                    # Fallback: keyword match
                    keyword_score = self._keyword_score(query, entry.get("document", ""))
                    scored.append((keyword_score, entry))
            scored.sort(key=lambda x: x[0], reverse=True)
        else:
            # Pure keyword fallback when OpenAI is unavailable
            scored = []
            for entry in collection:
                score = self._keyword_score(query, entry.get("document", ""))
                scored.append((score, entry))
            scored.sort(key=lambda x: x[0], reverse=True)

        results = []
        for score, entry in scored[:n_results]:
            results.append({
                "document": entry.get("document", ""),
                "metadata": entry.get("metadata", {}),
                "distance": round(1.0 - score, 4),  # Convert similarity to distance
            })
        return results

    @staticmethod
    def _keyword_score(query: str, document: str) -> float:
        """Simple keyword overlap score as fallback."""
        query_words = set(query.lower().split())
        doc_words = set(document.lower().split())
        if not query_words:
            return 0.0
        overlap = query_words & doc_words
        return len(overlap) / len(query_words)

    def search_similar_incidents(self, query: str, n_results: int = 5) -> list[dict]:
        return self._search(self._incidents, query, n_results)

    def search_runbooks(self, query: str, n_results: int = 5) -> list[dict]:
        return self._search(self._runbooks, query, n_results)

    def persist(self) -> None:
        self._save(self._incidents_path, self._incidents)
        self._save(self._runbooks_path, self._runbooks)

    @property
    def incident_count(self) -> int:
        return len(self._incidents)

    @property
    def runbook_count(self) -> int:
        return len(self._runbooks)


# Singleton
_memory_instance: InstitutionalMemory | None = None


def get_memory() -> InstitutionalMemory:
    global _memory_instance
    if _memory_instance is None:
        _memory_instance = InstitutionalMemory()
    return _memory_instance
