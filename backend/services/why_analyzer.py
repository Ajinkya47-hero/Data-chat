"""
Root-cause analysis for "why" questions.

When a user asks "why did X happen?" this module:
1. Detects the causal intent
2. Asks the LLM to generate 2-4 diagnostic SQL queries (time, category, region, etc.)
3. Executes each query via DuckDB
4. Synthesises all results into a structured root-cause explanation

The main entry points are:
  - ``is_why_question(text)``  — fast regex gate
  - ``build_why_prompt(...)``  — builds the SQL-generation messages
  - ``build_synthesis_prompt(...)``  — builds the answer-synthesis messages
"""

from __future__ import annotations

import re
import pandas as pd

# ── Detection ─────────────────────────────────────────────────────────────────

_WHY_RE = re.compile(
    r"\b(why|what\s+caused|what\s+drove|what\s+led\s+to|reason\s+for|"
    r"explain\s+(the\s+)?(drop|rise|increase|decrease|change|spike|dip|decline|growth)|"
    r"how\s+did\s+.{0,30}\s+(change|drop|rise|fall|increase|decrease))\b",
    re.IGNORECASE,
)


def is_why_question(text: str) -> bool:
    """Return True if *text* looks like a root-cause / causal question."""
    return bool(_WHY_RE.search(text))


# ── SQL generation prompt ─────────────────────────────────────────────────────

WHY_SQL_PROMPT = """You are a DuckDB SQL expert performing root-cause analysis.
The user is asking WHY something happened (a drop, rise, or change in a metric).
Your job is to generate 2-4 diagnostic SQL queries that together explain the root cause.

You must respond ONLY with valid JSON. Never include markdown, code fences, or text outside the JSON.

━━━ DIAGNOSTIC STRATEGY ━━━
Generate queries that cover different investigative angles:
1. TIME BREAKDOWN — How did the metric trend over recent periods (monthly/weekly)?
   Use DATE_TRUNC('month', date_col) or DATE_TRUNC('week', date_col).
2. CATEGORY/SEGMENT BREAKDOWN — Which category, product, region, or type drove the change?
   GROUP BY the most relevant categorical column.
3. PERIOD COMPARISON — Compare the affected period vs the prior period side-by-side.
   Use CASE WHEN or CTEs to compare two date ranges.
4. CONTRIBUTOR RANKING — Which individual items (top customers, products, locations) changed most?
   ORDER BY absolute or relative change DESC.

Only generate queries that make sense for the schema provided. Skip a dimension if no relevant column exists.

━━━ SQL RULES ━━━
- Write SELECT queries only — no DDL or DML
- Table and column names must match exactly what is shown under "Tables:"
- Always alias aggregated columns: SUM(amount) AS total_revenue
- Use ORDER BY for rankings
- Limit time-series queries to last 12 periods unless the question specifies otherwise
- Quote column names with spaces: "column name"

━━━ JOIN RULES ━━━
When a "Required JOIN conditions" block is present, use those exact JOIN clauses.
When a "Relationships:" section is present (but no Required block), use those columns for JOINs.

━━━ RESPONSE SCHEMA ━━━
{
  "queries": [
    {
      "dimension": "time|category|period_comparison|contributor",
      "label":     "Human-readable label, e.g. 'Monthly Revenue Trend'",
      "sql":       "SELECT ..."
    }
  ],
  "fallback_answer": "One sentence fallback if all queries fail."
}

Generate between 2 and 4 queries. Do not add any key not listed above.
"""


# ── Synthesis prompt ──────────────────────────────────────────────────────────

WHY_ANSWER_PROMPT = """You are an elite business data analyst performing root-cause analysis.
The user asked a WHY question. Multiple diagnostic SQL queries have been executed and their ACTUAL results are provided.
Write a clear, structured root-cause explanation using only these real numbers.

Rules:
1. Lead with the single biggest driver — name the exact number or segment right away
2. Work through each dimension (time, category, contributor) with specific figures
3. Distinguish correlation from likely causation where the data supports it
4. Identify any surprising or counter-intuitive findings
5. Close with ONE concrete recommendation with actual numbers (e.g. "focus on X which accounts for 60% of the drop")
6. Write in flowing prose, 5-8 sentences. No bullet points, no headers.
7. Use ₹ for Indian rupee amounts
8. DO NOT say "the chart above", "as shown", "the table below" — state findings directly
9. If a query returned 0 rows or an error, acknowledge the gap briefly and continue

━━━ INSIGHT RULE ━━━
One sharp, specific recommendation. Must reference real values from the results.
Good: "Weekend sessions account for 43% of the revenue decline — consider running targeted promotions on Friday evenings."
Bad: "Consider reviewing your business strategy."

━━━ FOLLOW-UP RULE ━━━
Suggest exactly 3 smart follow-up questions that naturally extend this root-cause analysis.
Make them specific to the actual findings and values.

Return ONLY valid JSON:
{
  "answer":    string,
  "insight":   string,
  "follow_up": [string, string, string]
}
"""


# ── Prompt builders ───────────────────────────────────────────────────────────

def build_why_prompt(
    schema_ctx: str,
    question: str,
    history: list[dict] | None = None,
    join_hints: list[str] | None = None,
) -> list[dict]:
    """Build the SQL-generation messages for a why-question."""
    join_block = ""
    if join_hints:
        join_block = (
            "\nRequired JOIN conditions (use these exactly — do not guess):\n"
            + "\n".join(f"  {j}" for j in join_hints)
        )

    user_content = f"{schema_ctx}{join_block}\n\nQuestion: '{question}'"

    messages: list[dict] = [{"role": "system", "content": WHY_SQL_PROMPT}]
    if history:
        messages.extend(history)
    messages.append({"role": "user", "content": user_content})
    return messages


def build_synthesis_prompt(
    query_results: list[dict],
    question: str,
    schema_ctx: str,
    history: list[dict] | None = None,
) -> list[dict]:
    """Build the answer-synthesis messages from executed diagnostic results."""

    history_ctx = ""
    if history:
        relevant = [m for m in history if m.get("role") in ("user", "assistant")][-4:]
        if relevant:
            lines = []
            for m in relevant:
                role = "User" if m["role"] == "user" else "Analyst"
                lines.append(f"{role}: {str(m['content'])[:400]}")
            history_ctx = "\nPrevious conversation:\n" + "\n".join(lines) + "\n"

    # Format each diagnostic result as a labelled block
    result_blocks: list[str] = []
    for i, qr in enumerate(query_results, 1):
        label = qr.get("label", f"Query {i}")
        dimension = qr.get("dimension", "")
        error = qr.get("error")
        rows = qr.get("rows")
        scalar = qr.get("scalar")

        block_lines = [f"--- {label} ({dimension}) ---"]
        if error:
            block_lines.append(f"Error: {error}")
        elif scalar is not None:
            block_lines.append(f"Result: {scalar}")
        elif rows:
            shown = rows[:12]
            headers = list(shown[0].keys()) if shown else []
            if headers:
                block_lines.append(" | ".join(headers))
                block_lines.append(" | ".join(["---"] * len(headers)))
                for row in shown:
                    block_lines.append(" | ".join(str(row.get(h, "")) for h in headers))
                if len(rows) > 12:
                    block_lines.append(f"(showing 12 of {len(rows)} rows)")
        else:
            block_lines.append("(no data returned)")

        result_blocks.append("\n".join(block_lines))

    combined_results = "\n\n".join(result_blocks)

    user_content = (
        f"User question: \"{question}\"\n"
        f"{history_ctx}\n"
        f"Dataset context:\n{schema_ctx}\n\n"
        f"Diagnostic query results:\n{combined_results}\n\n"
        "Write the root-cause analysis."
    )

    return [
        {"role": "system", "content": WHY_ANSWER_PROMPT},
        {"role": "user", "content": user_content},
    ]


# ── Result formatter ──────────────────────────────────────────────────────────

def format_why_results(
    queries_meta: list[dict],
    exec_results: list[dict],
) -> list[dict]:
    """
    Merge query metadata (label, dimension, sql) with execution results.

    Parameters
    ----------
    queries_meta
        List of dicts from the LLM response: ``[{"dimension", "label", "sql"}, ...]``
    exec_results
        Parallel list of dicts from ``duckdb_exec``: ``[{"scalar"|"dataframe", "warnings"?}, ...]``
        or ``{"error": str}`` if execution failed.

    Returns
    -------
    List of merged dicts ready to pass to ``build_synthesis_prompt``.
    """
    merged: list[dict] = []
    for meta, result in zip(queries_meta, exec_results):
        entry: dict = {
            "dimension": meta.get("dimension", ""),
            "label": meta.get("label", ""),
            "sql": meta.get("sql", ""),
        }
        if "error" in result:
            entry["error"] = result["error"]
        elif "scalar" in result:
            entry["scalar"] = result["scalar"]
        elif "dataframe" in result:
            entry["rows"] = result["dataframe"]
        else:
            entry["rows"] = []
        merged.append(entry)
    return merged
