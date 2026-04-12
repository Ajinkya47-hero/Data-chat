import asyncio
import json
import re
import os
import httpx
import google.generativeai as genai
import pandas as pd

from services.schema_builder import build_schema_context, filter_tables_for_query
from services.rate_limiter import llm_rate_limiter

SYSTEM_PROMPT = """You are a DuckDB SQL expert. Write a single SELECT query to answer the user's data question.
You must respond ONLY with valid JSON. Never include markdown, code fences, or any text outside the JSON object.

━━━ SQL RULES ━━━
- Write ONE SELECT statement — no DDL or DML (CREATE / DROP / INSERT / UPDATE / DELETE / COPY)
- Table names exactly match the names shown under "Tables:" in the prompt
- Always alias aggregated columns: SUM(amount) AS total_revenue
- Use ORDER BY for any ranking or comparison
- DuckDB supports window functions, CTEs (WITH … AS), DATE_TRUNC, STRFTIME, and full ANSI SQL
- For monthly grouping use: DATE_TRUNC('month', date_col) AS month
- Column names with spaces or special characters must be quoted: "column name"

━━━ JOIN RULES ━━━
When the prompt includes a "Relationships:" section, use those exact columns as JOIN keys:

  Example — customers.id = orders.customer_id, question: top customers by revenue
  SELECT c.name, SUM(o.amount) AS total_revenue
  FROM   customers c
  JOIN   orders o ON c.id = o.customer_id
  GROUP  BY c.name
  ORDER  BY total_revenue DESC

Chain additional JOINs for 3+ table queries.
When no Relationships are listed, infer joins from columns with matching names.

━━━ WHEN TO USE query = null ━━━
ONLY for:
- Purely social messages with zero business intent: "hi", "thanks", "cool", "ok", "bye"
- Questions that are impossible to answer from any table (e.g. "what will happen tomorrow?")

For EVERYTHING else — vague, short, or follow-up questions — write a SELECT query.
Examples that need a query, not null:
- "is Sunday good?" → SELECT day_of_week, SUM(revenue) … GROUP BY … ORDER BY …
- "which is better?" → compare metrics using GROUP BY and ORDER BY
- "can I earn more?" → aggregate and compare relevant columns

━━━ CHART RULES ━━━
- "bar"  → category comparisons (names, areas, days)
- "line" → time-series trends (month, quarter)
- "pie"  → share / proportion (max 8 slices)
- "none" → single scalar value or non-data question
- x_col and y_col must exactly match column names or aliases in the SELECT output

Response schema (strict JSON, no extra keys):
{
  "query":          string | null,
  "chart_type":     "bar"|"line"|"pie"|"none",
  "chart_title":    string,
  "x_col":          string|null,
  "y_col":          string|null,
  "fallback_answer": string
}

fallback_answer: 1-sentence safety net used only if the query fails.
For casual messages write the reply here.
"""

ANSWER_PROMPT = """You are an elite business data analyst — sharp, warm, and genuinely helpful.
A user asked a question about their business data. A SQL query has already been executed and the ACTUAL computed result is provided below.
Write the best possible analyst response using these real numbers.

Rules:
1. Start immediately with the most important finding — name the exact number, category, or period right away
2. Explain what it means for the business in plain English (why does this happen? what drives it?)
3. Point out anything surprising, concerning, or opportunity-worthy in the numbers
4. Close with ONE concrete, specific action they can take — reference actual values from the result
5. Write in natural flowing prose, 4-6 sentences. No bullet points, no headers
6. Sound like a trusted advisor who knows this business, not a generic report generator
7. For casual messages (no data result): be warm and brief — 1-2 sentences
8. For vague questions — use the conversation history to interpret what the user really means and answer based on the data provided
9. DO NOT say "the chart above", "as shown", "the result below" — just state the findings directly
10. ONLY reference entity names, values, and columns that actually appear in the query result or schema. NEVER invent or guess names that are not in the data.

━━━ INSIGHT RULE ━━━
One sharp, specific, actionable recommendation. Not generic. Must reference actual numbers from the result.
NEVER use names, values, or entities that do not appear in the data. Only cite what the query returned.

━━━ FOLLOW-UP RULE ━━━
Suggest exactly 3 actionable follow-up questions the user can ask next.
Each question should:
- Be specific to the actual findings, using real column names and values from the result
- Help the user dig deeper or take action (e.g. compare, filter, trend, drill down)
- Be phrased as a direct question the user can copy and ask

Return ONLY valid JSON:
{
  "answer":    string,
  "insight":   string,
  "follow_up": [string, string, string]
}
"""

# Models served by Groq (OpenAI-compatible, JSON mode supported)
GROQ_MODELS = {
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "moonshotai/kimi-k2-instruct",
    "qwen/qwen3-32b",
    "groq/compound",
    "groq/compound-mini",
    "allam-2-7b",
    "openai/gpt-oss-120b",
    "openai/gpt-oss-20b",
}


def extract_json(text: str) -> str:
    cleaned = re.sub(r"```json|```", "", text).strip()
    # Find outermost JSON object
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start != -1 and end != -1:
        cleaned = cleaned[start : end + 1]
    return cleaned


# ── Gemini ────────────────────────────────────────────────────────────────────

async def call_gemini(messages: list[dict], model: str = "gemini-2.0-flash", max_retries: int = 3) -> dict:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise ValueError("GEMINI_API_KEY not set")

    genai.configure(api_key=api_key)

    system_instruction = None
    conversation: list[dict] = []
    for msg in messages:
        if msg["role"] == "system":
            system_instruction = msg["content"]
        else:
            conversation.append(msg)

    gemini_model = genai.GenerativeModel(
        model_name=model,
        system_instruction=system_instruction,
        generation_config=genai.GenerationConfig(
            response_mime_type="application/json",
            temperature=0.0,
        ),
    )

    def to_gemini_history(msgs):
        return [
            {"role": "model" if m["role"] == "assistant" else "user", "parts": [m["content"]]}
            for m in msgs
        ]

    history_msgs = to_gemini_history(conversation[:-1]) if len(conversation) > 1 else []
    last_user_msg = conversation[-1]["content"] if conversation else ""
    chat = gemini_model.start_chat(history=history_msgs)

    for attempt in range(max_retries):
        prompt = last_user_msg if attempt == 0 else "You returned invalid JSON. Please fix it and return strictly valid JSON."
        response = await chat.send_message_async(prompt)
        raw_content = response.text
        try:
            return json.loads(extract_json(raw_content))
        except json.JSONDecodeError:
            if attempt < max_retries - 1:
                continue
            raise RuntimeError("Gemini failed to return valid JSON after retries")


# ── OpenRouter ────────────────────────────────────────────────────────────────

def _merge_system_into_user(messages: list[dict]) -> list[dict]:
    """Merge system message into first user message for models that don't support system role."""
    result = []
    system_content = None
    for msg in messages:
        if msg["role"] == "system":
            system_content = msg["content"]
        else:
            result.append(msg)
    if system_content and result:
        result[0] = {
            "role": result[0]["role"],
            "content": f"{system_content}\n\n{result[0]['content']}",
        }
    return result


async def call_openrouter(messages: list[dict], model: str, max_retries: int = 3) -> dict:
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        raise ValueError("OPENROUTER_API_KEY not set")

    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "DataChat",
    }

    # Use system-merged messages (works universally, including Gemma via Google AI Studio)
    current_messages = _merge_system_into_user(list(messages))

    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(max_retries):
            payload = {"model": model, "messages": current_messages}
            response = await client.post(url, headers=headers, json=payload)

            if response.status_code == 429:
                text = response.text
                lower = text.lower()
                # Temporary upstream rate limit — retry with backoff
                if "temporarily rate-limited" in lower or "rate limit" in lower:
                    if attempt < max_retries - 1:
                        await asyncio.sleep(4 * (attempt + 1))
                        continue
                    raise RuntimeError(f"RATE_LIMITED: Model is busy, please try again in a moment.")
                # Actual quota / billing exhausted
                raise RuntimeError(f"QUOTA_EXCEEDED: {text}")

            if response.status_code != 200:
                raise RuntimeError(f"OpenRouter error {response.status_code}: {response.text[:300]}")

            data = response.json()
            # OpenRouter may return HTTP 200 but with an error body (no choices)
            if "choices" not in data:
                err = data.get("error", {})
                raw_err = err.get("metadata", {}).get("raw", err.get("message", str(data)))[:200]
                raise RuntimeError(f"OpenRouter provider error: {raw_err}")

            raw_content = data["choices"][0]["message"]["content"]
            try:
                return json.loads(extract_json(raw_content))
            except json.JSONDecodeError:
                if attempt < max_retries - 1:
                    current_messages.append({"role": "assistant", "content": raw_content})
                    current_messages.append({"role": "user", "content": "You returned invalid JSON. Return strictly valid JSON only."})
                    continue
                raise RuntimeError("OpenRouter model failed to return valid JSON after retries")


# ── Groq ──────────────────────────────────────────────────────────────────────

async def call_groq(messages: list[dict], model: str, max_retries: int = 3) -> dict:
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not set")

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    current_messages = list(messages)

    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(max_retries):
            payload = {
                "model": model,
                "messages": current_messages,
                "response_format": {"type": "json_object"},
                "temperature": 0,
            }
            response = await client.post(url, headers=headers, json=payload)

            if response.status_code == 429:
                raise RuntimeError(f"QUOTA_EXCEEDED: {response.text}")
            if response.status_code != 200:
                raise RuntimeError(f"Groq error {response.status_code}: {response.text[:300]}")

            raw_content = response.json()["choices"][0]["message"]["content"]
            try:
                return json.loads(extract_json(raw_content))
            except json.JSONDecodeError:
                if attempt < max_retries - 1:
                    current_messages.append({"role": "assistant", "content": raw_content})
                    current_messages.append({"role": "user", "content": "You returned invalid JSON. Return strictly valid JSON only."})
                    continue
                raise RuntimeError("Groq model failed to return valid JSON after retries")


# ── Dispatcher ────────────────────────────────────────────────────────────────

async def generate_final_answer(
    question: str,
    schema_ctx: str,
    result_text: str,
    model: str,
    history: list[dict] | None = None,
) -> dict:
    """Second-pass LLM call: given actual computed result, write a high-quality analyst response."""

    history_ctx = ""
    if history:
        # Include last 4 messages (2 Q&A pairs) for context — truncated to avoid token bloat
        relevant = [m for m in history if m.get("role") in ("user", "assistant")][-4:]
        if relevant:
            lines = []
            for m in relevant:
                role = "User" if m["role"] == "user" else "Analyst"
                lines.append(f"{role}: {str(m['content'])[:400]}")
            history_ctx = "\nPrevious conversation:\n" + "\n".join(lines) + "\n"

    user_content = (
        f"User question: \"{question}\"\n"
        f"{history_ctx}\n"
        f"Dataset context:\n{schema_ctx}\n\n"
        f"Actual computed result:\n{result_text if result_text else '(no data computed — question was conversational or non-data)'}\n\n"
        "Write the analyst response."
    )
    messages = [
        {"role": "system", "content": ANSWER_PROMPT},
        {"role": "user", "content": user_content},
    ]
    return await call_llm(messages, model=model)


# ── Fallback config ────────────────────────────────────────────────────────────

# Ordered fallback models tried when the primary model fails.
# Gemini is free and the most reliable; OpenRouter free tier is a last resort.
_FALLBACK_CHAIN = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "google/gemma-3-12b-it:free",
]


def _strip_history(messages: list[dict]) -> list[dict]:
    """Return system + last user message only — drops conversation history.

    Used for the simplified-prompt retry: reduces token count and removes
    any history that might confuse the fallback model.
    """
    system = [m for m in messages if m["role"] == "system"]
    user   = [m for m in messages if m["role"] == "user"]
    return system + ([user[-1]] if user else [])


async def _dispatch(messages: list[dict], model: str) -> dict:
    """Route to the right provider.  Does NOT acquire the rate-limiter slot
    (caller must have already done that)."""
    if model.startswith("gemini"):
        return await call_gemini(messages, model=model)
    elif model in GROQ_MODELS:
        return await call_groq(messages, model=model)
    else:
        return await call_openrouter(messages, model=model)


async def call_llm(messages: list[dict], model: str = "gemini-2.0-flash") -> dict:
    """Call an LLM with a multi-model fallback chain.

    1. Try the requested model with the full prompt.
    2. Walk through ``_FALLBACK_CHAIN`` (skipping the primary) with the full prompt.
    3. Try the last fallback again with a simplified (history-stripped) prompt.

    The rate-limiter slot is acquired once at the top; all passes share it.
    If every pass fails the last exception is re-raised so callers/routers can
    return an appropriate HTTP error.
    """
    # Global rate limiter: max 10 requests/min across the whole system.
    await llm_rate_limiter.acquire()

    # Build the ordered list: primary first, then fallbacks (skip duplicates)
    chain = [model] + [m for m in _FALLBACK_CHAIN if m != model]
    errors: list[tuple[str, Exception]] = []

    # ── Try each model with the full prompt ───────────────────────────────────
    for mdl in chain:
        try:
            return await _dispatch(messages, mdl)
        except Exception as e:
            errors.append((mdl, e))

    # ── Last resort: simplified prompt on the last fallback ───────────────────
    last_fallback = chain[-1]
    simplified = _strip_history(messages)
    try:
        return await _dispatch(simplified, last_fallback)
    except Exception as e:
        errors.append((f"{last_fallback} (simplified)", e))

    # All passes failed
    parts = [f"{m}: {e}" for m, e in errors]
    raise RuntimeError("All model fallbacks exhausted. " + " | ".join(parts)) from errors[-1][1]


# ── Prompt builder ────────────────────────────────────────────────────────────

def build_prompt(
    df: pd.DataFrame,
    question: str,
    history: list[dict] = None,
    extra_dfs: dict[str, pd.DataFrame] | None = None,
    primary_name: str = "dataset",
    relationships: list[dict] | None = None,
    join_hints: list[str] | None = None,
) -> tuple[list[dict], str]:
    """Build LLM prompt messages and a schema context string for SQL generation.

    Every table is referenced by its dataset name — no ``df_`` prefix.
    Schema generation is delegated to :mod:`services.schema_builder`.

    Parameters
    ----------
    join_hints
        Explicit ``A JOIN B ON A.x = B.y`` strings produced by
        :func:`services.join_validator.required_joins`.  When provided they
        are embedded in the user message as a prescriptive "Required JOINs"
        block so the model cannot guess or omit join columns.
    """
    all_tables: dict[str, pd.DataFrame] = {primary_name: df}
    if extra_dfs:
        all_tables.update(extra_dfs)

    rels = relationships or None

    # Filter to only the tables/columns relevant to this question so the prompt
    # stays compact.  Join keys are always preserved; small tables are kept whole.
    col_filter = filter_tables_for_query(all_tables, question, rels, history)
    filtered_tables = {
        name: all_tables[name][cols]
        for name, cols in col_filter.items()
        if name in all_tables and cols
    } or all_tables  # safety fallback — never send an empty schema

    # Full context for the SQL-generation pass (Tables + Relationships + samples)
    full_schema = build_schema_context(filtered_tables, rels, include_samples=True)

    # Compact context for the answer-pass LLM (no sample rows — reduces noise)
    schema_ctx = build_schema_context(filtered_tables, rels, include_samples=False)

    # Prescriptive join block — prevents the model from guessing join columns
    join_block = ""
    if join_hints:
        join_block = (
            "\nRequired JOIN conditions (use these exactly — do not guess):\n"
            + "\n".join(f"  {j}" for j in join_hints)
        )

    user_content = f"{full_schema}{join_block}\n\nQuestion: '{question}'"

    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_content})
    return messages, schema_ctx