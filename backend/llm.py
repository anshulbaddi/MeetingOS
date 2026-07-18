from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any, List

from openai import OpenAI

log = logging.getLogger(__name__)

# ── Models ──────────────────────────────────────────────────────────────────────
LLM_MODEL = "gpt-4o-mini"                                 # OpenAI primary
FALLBACK_MODEL = "meta-llama/Llama-3.1-8B-Instruct"       # HuggingFace fallback
EMBEDDING_MODEL = "text-embedding-3-small"                  # OpenAI (embeddings only)
EMBED_BATCH = 100

# ── Cache config ─────────────────────────────────────────────────────────────────
_CACHE_TTL = 3600        # 1 hour for LLM responses
_EMBED_CACHE_TTL = 604800  # 7 days for embeddings (deterministic)

# ── Module state ─────────────────────────────────────────────────────────────────
_oai_client: OpenAI | None = None
_hf_client: OpenAI | None = None
_redis_client = None


# ── Clients ───────────────────────────────────────────────────────────────────────

def _oai() -> OpenAI:
    global _oai_client
    if _oai_client is None:
        _oai_client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _oai_client


def _hf() -> OpenAI:
    """HuggingFace serverless inference — OpenAI-compatible endpoint."""
    global _hf_client
    if _hf_client is None:
        _hf_client = OpenAI(
            api_key=os.environ["HF_TOKEN"],
            base_url="https://api-inference.huggingface.co/v1/",
        )
    return _hf_client


def get_llm_client() -> OpenAI:
    """Kept for callers that need a raw client. Use chat_complete() / embed_text() instead."""
    return _oai()


def get_embed_client() -> OpenAI:
    return _oai()


# ── Redis cache ───────────────────────────────────────────────────────────────────

def _redis():
    global _redis_client
    if _redis_client is None:
        import redis
        _redis_client = redis.from_url(
            os.environ.get("REDIS_URL", "redis://localhost:6379/0"),
            socket_connect_timeout=1,
        )
    return _redis_client


def _cache_get(key: str) -> str | None:
    try:
        val = _redis().get(key)
        return val.decode() if val else None
    except Exception:
        return None


def _cache_set(key: str, value: str) -> None:
    _cache_set_ttl(key, value, _CACHE_TTL)


def _cache_set_ttl(key: str, value: str, ttl: int) -> None:
    try:
        _redis().setex(key, ttl, value)
    except Exception:
        pass


# ── Fake completion for cache hits ────────────────────────────────────────────────

class _Msg:
    def __init__(self, content: str) -> None:
        self.content = content
        self.tool_calls = None

class _Choice:
    def __init__(self, content: str) -> None:
        self.message = _Msg(content)

class _CachedCompletion:
    def __init__(self, content: str) -> None:
        self.choices = [_Choice(content)]


# ── Embedding helpers ─────────────────────────────────────────────────────────────

def _embed_cache_key(text: str) -> str:
    return "emb:" + hashlib.sha256(text.encode()).hexdigest()


def embed_text(text: str) -> List[float]:
    """Embed a single string, served from Redis cache when available."""
    key = _embed_cache_key(text)
    cached = _cache_get(key)
    if cached:
        return json.loads(cached)

    vector = _oai().embeddings.create(model=EMBEDDING_MODEL, input=[text]).data[0].embedding
    _cache_set_ttl(key, json.dumps(vector), _EMBED_CACHE_TTL)
    return vector


def embed_texts(texts: List[str]) -> List[List[float]]:
    """Batch embed with per-text Redis caching; only uncached texts hit OpenAI."""
    results: List[List[float] | None] = [None] * len(texts)
    uncached_indices: List[int] = []
    uncached_texts: List[str] = []

    for i, text in enumerate(texts):
        cached = _cache_get(_embed_cache_key(text))
        if cached:
            results[i] = json.loads(cached)
        else:
            uncached_indices.append(i)
            uncached_texts.append(text)

    if uncached_texts:
        vectors: List[List[float]] = []
        for i in range(0, len(uncached_texts), EMBED_BATCH):
            batch = uncached_texts[i : i + EMBED_BATCH]
            resp = _oai().embeddings.create(model=EMBEDDING_MODEL, input=batch)
            vectors.extend(item.embedding for item in resp.data)

        for idx, vector in zip(uncached_indices, vectors):
            results[idx] = vector
            _cache_set_ttl(_embed_cache_key(texts[idx]), json.dumps(vector), _EMBED_CACHE_TTL)

    return results  # type: ignore[return-value]


# ── Public API ────────────────────────────────────────────────────────────────────

def chat_complete(
    messages: list,
    *,
    response_format: dict | None = None,
    tools: list | None = None,
    use_cache: bool = False,
    **kwargs: Any,
):
    """
    Call OpenAI (gpt-4o-mini) with HuggingFace as fallback.
    use_cache=True enables Redis caching for text-only calls.
    """
    cache_key = None
    if use_cache and tools is None:
        payload = json.dumps({"msgs": messages, "rf": response_format, **kwargs}, sort_keys=True)
        cache_key = "llm:" + hashlib.sha256(payload.encode()).hexdigest()
        cached = _cache_get(cache_key)
        if cached:
            log.debug("[LLM] Cache hit %s…", cache_key[:16])
            return _CachedCompletion(cached)

    call_kwargs: dict[str, Any] = {"messages": messages, **kwargs}
    if response_format:
        call_kwargs["response_format"] = response_format
    if tools:
        call_kwargs["tools"] = tools

    try:
        result = _oai().chat.completions.create(model=LLM_MODEL, **call_kwargs)
        if cache_key:
            _cache_set(cache_key, result.choices[0].message.content or "")
        return result
    except Exception as exc:
        log.warning("[LLM] OpenAI failed (%s), falling back to HuggingFace %s", exc, FALLBACK_MODEL)

    result = _hf().chat.completions.create(model=FALLBACK_MODEL, **call_kwargs)
    if cache_key:
        _cache_set(cache_key, result.choices[0].message.content or "")
    return result
