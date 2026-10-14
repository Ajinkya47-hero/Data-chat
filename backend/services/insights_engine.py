"""
Automatic insights engine.

Runs multiple targeted SQL queries against the user's dataset(s), then asks
the LLM to synthesize 5-7 plain-English insights covering:
  - Trends (time-series movements)
  - Top / bottom performers
  - Anomalies (statistical outliers, missing data spikes)
  - Distribution summaries
"""

from __future__ import annotations

import re
import pandas as pd

from services.duckdb_exec import duckdb_exec
from services.query_engine import call_llm
from services.schema_builder import build_schema_context, filter_tables_for_query

# ── LLM prompt ────────────────────────────────────────────────────────────────

INSIGHTS_SYSTEM_PROMPT = """You are a senior business data analyst with deep expertise in spotting meaningful patterns.

Multiple diagnostic SQL queries have been run on a dataset. Based on ALL the results, generate exactly 5-7 key insights in plain English.

Rules:
1. Each insight MUST cite specific numbers from the actual query results
2. Cover a MIX of: trends over time, top/bottom performers, anomalies, distribution patterns
3. Be specific and actionable — avoid generic statements
4. If a "high-value anomalies" query returned rows, always include an anomaly insight
5. If a trend query returned data, always include a trend insight
6. Tone: sharp, warm, like a trusted advisor — not a generic report

icon must be exactly ONE of these: "📈" (upward trend), "📉" (downward trend / risk), "🏆" (best performer), "⚠️" (anomaly / warning), "📊" (distribution / summary), "💡" (opportunity), "🔍" (interesting finding)

Return ONLY valid JSON (no markdown, no extra text):
{
  "insights": [
    {
      "title": "5-word max title",
      "body": "2-3 sentences. Cite real numbers. Explain what it means and what to do.",
      "type": "trend|top_performer|anomaly|summary|opportunity",
      "icon": "📈|📉|🏆|⚠️|📊|💡|🔍"
    }
  ]
}
"""


# ── Column type detection ─────────────────────────────────────────────────────

def _q(col: str) -> str:
    """Quote a column name if needed."""
    if re.search(r"[^a-zA-Z0-9_]", col):
        return f'"{col}"'
    return col


def _detect_column_types(df: pd.DataFrame) -> tuple[list[str], list[str], list[str]]:
    """
    Return (date_cols, numeric_cols, categorical_cols) after scanning df.

    String columns that look like dates are included in date_cols.
    Categorical = string columns with ≤ 50 unique values.
    """
    date_cols: list[str] = []
    numeric_cols: list[str] = []
    categorical_cols: list[str] = []

    for col in df.columns:
        if str(col).startswith("Unnamed"):
            continue
        dtype = df[col].dtype

        if pd.api.types.is_datetime64_any_dtype(dtype):
            date_cols.append(col)
        elif pd.api.types.is_numeric_dtype(dtype):
            numeric_cols.append(col)
        else:
            # Probe string columns for parseable dates
            try:
                sample = df[col].dropna().head(10)
                parsed = pd.to_datetime(sample, errors="coerce")
                if len(sample) > 0 and parsed.notna().sum() / len(sample) >= 0.7:
                    date_cols.append(col)
                    continue
            except Exception:
                pass
            n_unique = df[col].nunique()
            if n_unique <= 50:
                categorical_cols.append(col)

    return date_cols, numeric_cols, categorical_cols


# ── Query builder ─────────────────────────────────────────────────────────────

def _build_queries(df: pd.DataFrame, table_name: str) -> list[dict]:
    """
    Return a list of {"label": str, "sql": str} dicts tailored to the dataset.
    Queries are deterministic (no LLM) to guarantee safety and speed.
    """
    tname = _q(table_name) if re.search(r"[^a-zA-Z0-9_]", table_name) else table_name
    date_cols, numeric_cols, cat_cols = _detect_column_types(df)

    queries: list[dict] = []

    # ── 0. Row count (always) ─────────────────────────────────────────────────
    queries.append({
        "label": "Total rows",
        "sql": f"SELECT COUNT(*) AS total_rows FROM {tname}",
    })

    # ── Nothing numeric: just value counts ───────────────────────────────────
    if not numeric_cols:
        for cat in cat_cols[:3]:
            queries.append({
                "label": f"Distribution of {cat}",
                "sql": (
                    f"SELECT {_q(cat)} AS category, COUNT(*) AS count "
                    f"FROM {tname} GROUP BY {_q(cat)} ORDER BY count DESC LIMIT 10"
                ),
            })
        return queries

    pnum = numeric_cols[0]           # primary numeric column
    pnum_q = _q(pnum)

    # ── 1. Overall numeric statistics ─────────────────────────────────────────
    agg_exprs = ", ".join(
        f"ROUND(SUM({_q(c)}), 2) AS sum_{i}, "
        f"ROUND(AVG({_q(c)}), 2) AS avg_{i}, "
        f"MIN({_q(c)}) AS min_{i}, "
        f"MAX({_q(c)}) AS max_{i}"
        for i, c in enumerate(numeric_cols[:3])
    )
    queries.append({
        "label": "Overall numeric statistics",
        "sql": f"SELECT COUNT(*) AS total_rows, {agg_exprs} FROM {tname}",
    })

    # ── 2. Top & bottom performers by primary categorical column ──────────────
    if cat_cols:
        cat = cat_cols[0]
        cat_q = _q(cat)
        queries.append({
            "label": f"Top 10 by {cat}",
            "sql": (
                f"SELECT {cat_q} AS category, "
                f"ROUND(SUM({pnum_q}), 2) AS total, "
                f"ROUND(AVG({pnum_q}), 2) AS average, "
                f"COUNT(*) AS count "
                f"FROM {tname} GROUP BY {cat_q} ORDER BY total DESC LIMIT 10"
            ),
        })
        queries.append({
            "label": f"Bottom 5 by {cat}",
            "sql": (
                f"SELECT {cat_q} AS category, "
                f"ROUND(SUM({pnum_q}), 2) AS total, "
                f"ROUND(AVG({pnum_q}), 2) AS average, "
                f"COUNT(*) AS count "
                f"FROM {tname} GROUP BY {cat_q} ORDER BY total ASC LIMIT 5"
            ),
        })

        # ── 2b. Second categorical dimension ─────────────────────────────────
        if len(cat_cols) > 1:
            cat2 = cat_cols[1]
            queries.append({
                "label": f"Performance breakdown by {cat2}",
                "sql": (
                    f"SELECT {_q(cat2)} AS category, "
                    f"ROUND(SUM({pnum_q}), 2) AS total, "
                    f"COUNT(*) AS count "
                    f"FROM {tname} GROUP BY {_q(cat2)} ORDER BY total DESC LIMIT 10"
                ),
            })

    # ── 3. Time-series trend ──────────────────────────────────────────────────
    if date_cols:
        dcol = date_cols[0]
        dcol_q = _q(dcol)
        queries.append({
            "label": "Monthly trend",
            "sql": (
                f"SELECT DATE_TRUNC('month', TRY_CAST({dcol_q} AS TIMESTAMP)) AS month, "
                f"ROUND(SUM({pnum_q}), 2) AS total, "
                f"COUNT(*) AS count "
                f"FROM {tname} "
                f"WHERE {dcol_q} IS NOT NULL "
                f"GROUP BY month ORDER BY month"
            ),
        })

        # Period-over-period comparison (last 30 days vs previous 30 days)
        queries.append({
            "label": "Last 30 days vs previous 30 days",
            "sql": (
                f"WITH max_date AS (SELECT MAX(TRY_CAST({dcol_q} AS TIMESTAMP)) AS d FROM {tname}), "
                f"periods AS ("
                f"  SELECT "
                f"    CASE "
                f"      WHEN TRY_CAST({dcol_q} AS TIMESTAMP) >= (SELECT d - INTERVAL 30 DAYS FROM max_date) THEN 'Last 30 days' "
                f"      WHEN TRY_CAST({dcol_q} AS TIMESTAMP) >= (SELECT d - INTERVAL 60 DAYS FROM max_date) THEN 'Previous 30 days' "
                f"      ELSE 'Older' "
                f"    END AS period, "
                f"    {pnum_q} "
                f"  FROM {tname} WHERE {dcol_q} IS NOT NULL"
                f") "
                f"SELECT period, ROUND(SUM({pnum_q}), 2) AS total, COUNT(*) AS count "
                f"FROM periods GROUP BY period ORDER BY period"
            ),
        })

    # ── 4. Anomaly detection — statistical outliers ───────────────────────────
    queries.append({
        "label": "High-value anomalies (top outliers)",
        "sql": (
            f"WITH stats AS ("
            f"  SELECT AVG({pnum_q}) AS mean_val, STDDEV({pnum_q}) AS std_val FROM {tname}"
            f") "
            f"SELECT t.*, "
            f"  ROUND((t.{pnum_q} - s.mean_val) / NULLIF(s.std_val, 0), 2) AS z_score "
            f"FROM {tname} t CROSS JOIN stats s "
            f"WHERE t.{pnum_q} > s.mean_val + 2 * s.std_val "
            f"ORDER BY z_score DESC LIMIT 5"
        ),
    })

    # ── 5. Missing data summary ───────────────────────────────────────────────
    visible_cols = [c for c in df.columns if not str(c).startswith("Unnamed")][:12]
    if visible_cols:
        null_expr = " + ".join(
            f"CASE WHEN {_q(c)} IS NULL THEN 1 ELSE 0 END"
            for c in visible_cols
        )
        queries.append({
            "label": "Missing data summary",
            "sql": (
                f"SELECT COUNT(*) AS total_rows, "
                f"SUM({null_expr}) AS missing_cells, "
                f"ROUND(100.0 * SUM({null_expr}) / (COUNT(*) * {len(visible_cols)}), 2) AS missing_pct "
                f"FROM {tname}"
            ),
        })

    return queries


# ── Query runner ──────────────────────────────────────────────────────────────

def _run_queries(tables: dict, queries: list[dict]) -> list[dict]:
    """Execute each query and collect results. Errors are captured, not raised."""
    results: list[dict] = []
    for q in queries:
        try:
            raw = duckdb_exec(sql=q["sql"], tables=tables)
            # Flatten scalar results
            if "scalar" in raw:
                data = [{"value": raw["scalar"]}]
            else:
                data = (raw.get("dataframe") or [])[:20]
            results.append({"label": q["label"], "sql": q["sql"], "data": data})
        except Exception as exc:
            results.append({"label": q["label"], "sql": q["sql"], "error": str(exc)})
    return results


def _format_results_for_llm(results: list[dict], schema_ctx: str) -> str:
    """Serialize query results into a compact text block for the LLM."""
    lines: list[str] = [f"Dataset schema:\n{schema_ctx}\n\nDiagnostic query results:"]
    for r in results:
        lines.append(f"\n--- {r['label']} ---")
        if "error" in r:
            lines.append(f"  (query failed: {r['error']})")
            continue
        data = r["data"]
        if not data:
            lines.append("  (no rows returned)")
            continue
        headers = list(data[0].keys())
        lines.append("  " + " | ".join(headers))
        for row in data[:10]:
            lines.append("  " + " | ".join(str(row.get(h, "")) for h in headers))
        if len(data) > 10:
            lines.append(f"  ... ({len(data)} rows total)")
    return "\n".join(lines)


# ── Public API ────────────────────────────────────────────────────────────────

async def generate_insights(
    tables: dict,               # {name: pd.DataFrame}
    primary_name: str,
    relationships: list[dict] | None,
    model: str,
) -> list[dict]:
    """
    Run insight queries and return 5-7 insight dicts from the LLM.

    Each dict: {"title": str, "body": str, "type": str, "icon": str}
    """
    primary_df = tables[primary_name]

    # Build and run queries
    queries = _build_queries(primary_df, primary_name)
    results = _run_queries(tables, queries)

    # Schema context (compact — no samples, filtered to numeric/date/join columns)
    # Synthetic aggregation phrase triggers has_agg=True so numeric+date cols are kept
    col_filter = filter_tables_for_query(
        tables,
        "total sum average trend distribution top bottom analysis",
        relationships,
    )
    filtered_tables = {
        name: tables[name][cols]
        for name, cols in col_filter.items()
        if name in tables and cols
    } or tables
    schema_ctx = build_schema_context(filtered_tables, relationships, include_samples=False)

    # Format results for the LLM
    results_text = _format_results_for_llm(results, schema_ctx)

    messages = [
        {"role": "system", "content": INSIGHTS_SYSTEM_PROMPT},
        {"role": "user", "content": results_text},
    ]

    try:
        response = await call_llm(messages, model=model)
    except Exception as exc:
        raise RuntimeError(f"LLM call failed: {exc}") from exc

    insights = response.get("insights", [])

    # Validate and sanitise
    valid: list[dict] = []
    for item in insights:
        if isinstance(item, dict) and item.get("title") and item.get("body"):
            valid.append({
                "title": str(item.get("title", ""))[:80],
                "body": str(item.get("body", ""))[:600],
                "type": str(item.get("type", "summary")),
                "icon": str(item.get("icon", "📊")),
            })

    return valid
