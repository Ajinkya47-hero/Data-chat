"""
GET /models — returns the full model registry and provider connectivity status.

This is the single source of truth for all LLM models supported by DataChat.
The frontend fetches this on mount to know what models are available and
whether each provider's API key is configured.
"""

import os
from fastapi import APIRouter

router = APIRouter()

# ── Model registry ─────────────────────────────────────────────────────────────
# Ordered by quality within each provider group.
# All IDs must match the routing logic in services/query_engine.py.

MODEL_REGISTRY = [
    {
        "provider": "Gemini",
        "color": "blue",
        "env_key": "GEMINI_API_KEY",
        "models": [
            {
                "id": "gemini-3.8-flash",
                "label": "Gemini 3.8 Flash",
                "note": "Latest & flagship",
                "tier": "best",
            },
            {
                "id": "gemini-3.1-flash-lite",
                "label": "Gemini 3.1 Flash Lite",
                "note": "Ultra fast & free",
                "tier": "recommended",
            },
            {
                "id": "gemini-3-flash-preview",
                "label": "Gemini 3 Flash",
                "note": "Preview",
                "tier": "standard",
            },
        ],
    },
    {
        "provider": "Groq",
        "color": "orange",
        "env_key": "GROQ_API_KEY",
        "models": [
            {
                "id": "openai/gpt-oss-120b",
                "label": "GPT-OSS 120B",
                "note": "Most powerful",
                "tier": "best",
            },
            {
                "id": "openai/gpt-oss-20b",
                "label": "GPT-OSS 20B",
                "note": "Ultra fast",
                "tier": "recommended",
            },
            {
                "id": "qwen/qwen3.8-27b",
                "label": "Qwen 3.8 27B",
                "note": "Alibaba",
                "tier": "standard",
            },
            {
                "id": "allam-2-7b",
                "label": "ALLaM 2 7B",
                "note": "Fast",
                "tier": "fast",
            },
        ],
    },
    {
        "provider": "OpenRouter",
        "color": "violet",
        "env_key": "OPENROUTER_API_KEY",
        "models": [
            {
                "id": "nvidia/nemotron-3.5-lightning:free",
                "label": "Nemotron 3.5 Lightning",
                "note": "NVIDIA · Free",
                "tier": "recommended",
            },
            {
                "id": "liquid/lfm-2.5-2.6b:free",
                "label": "Liquid LFM 2.5",
                "note": "Liquid AI · Free",
                "tier": "standard",
            },
        ],
    },
]


@router.get("")
async def get_models():
    """
    Return all supported models grouped by provider, along with a
    real-time connectivity flag for each provider (API key is set).
    """
    result = []
    for group in MODEL_REGISTRY:
        api_key = os.environ.get(group["env_key"], "")
        connected = bool(api_key and api_key.strip())
        result.append(
            {
                "provider": group["provider"],
                "color": group["color"],
                "connected": connected,
                "models": group["models"],
            }
        )
    return {"providers": result}
