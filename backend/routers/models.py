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
                "id": "gemini-2.0-flash",
                "label": "Gemini 2.0 Flash",
                "note": "Fast & free",
                "tier": "recommended",
            },
            {
                "id": "gemini-1.5-flash",
                "label": "Gemini 1.5 Flash",
                "note": "Free tier",
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
                "id": "llama-3.3-70b-versatile",
                "label": "Llama 3.3 70B",
                "note": "Recommended",
                "tier": "recommended",
            },
            {
                "id": "deepseek-r1-distill-llama-70b",
                "label": "DeepSeek R1 70B",
                "note": "Reasoning",
                "tier": "recommended",
            },
            {
                "id": "meta-llama/llama-4-scout-17b-16e-instruct",
                "label": "Llama 4 Scout 17B",
                "note": "Latest",
                "tier": "standard",
            },
            {
                "id": "openai/gpt-oss-20b",
                "label": "GPT-OSS 20B",
                "note": "Fast",
                "tier": "standard",
            },
            {
                "id": "deepseek-r1-distill-qwen-32b",
                "label": "DeepSeek R1 Qwen 32B",
                "note": "Reasoning",
                "tier": "standard",
            },
            {
                "id": "llama-3.1-8b-instant",
                "label": "Llama 3.1 8B",
                "note": "Ultra fast",
                "tier": "fast",
            },
            {
                "id": "moonshotai/kimi-k2-instruct",
                "label": "Kimi K2",
                "note": "Moonshot AI",
                "tier": "standard",
            },
            {
                "id": "qwen/qwen3-32b",
                "label": "Qwen3 32B",
                "note": "Alibaba",
                "tier": "standard",
            },
        ],
    },
    {
        "provider": "OpenRouter",
        "color": "violet",
        "env_key": "OPENROUTER_API_KEY",
        "models": [
            {
                "id": "google/gemma-3-27b-it:free",
                "label": "Gemma 3 27B",
                "note": "Google · Free",
                "tier": "recommended",
            },
            {
                "id": "meta-llama/llama-3.3-70b-instruct:free",
                "label": "Llama 3.3 70B",
                "note": "Meta · Free",
                "tier": "recommended",
            },
            {
                "id": "deepseek/deepseek-r1:free",
                "label": "DeepSeek R1",
                "note": "Reasoning · Free",
                "tier": "recommended",
            },
            {
                "id": "google/gemma-3-12b-it:free",
                "label": "Gemma 3 12B",
                "note": "Google · Free",
                "tier": "standard",
            },
            {
                "id": "nvidia/nemotron-3-nano-30b-a3b:free",
                "label": "Nemotron 30B",
                "note": "NVIDIA · Free",
                "tier": "standard",
            },
            {
                "id": "qwen/qwen3-14b:free",
                "label": "Qwen3 14B",
                "note": "Alibaba · Free",
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
