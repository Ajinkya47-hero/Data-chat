"""
Schema context generator for AI SQL prompts.

``build_schema_context`` is the single public entry point.  It assembles a
structured, concise description of all queryable tables, their columns (with
SQL types), optional sample rows, and any detected join relationships.

The returned string is embedded verbatim in the LLM user message so the model
knows exactly what it can query and how the tables relate to each other.

Example output
──────────────
Tables:
customers(id BIGINT, name VARCHAR, email VARCHAR)
orders(order_id BIGINT, customer_id BIGINT, amount DOUBLE, order_date TIMESTAMP)

Relationships:
customers.id = orders.customer_id

Sample rows (customers):
[{"id": 1, "name": "Alice", "email": "alice@example.com"},
 {"id": 2, "name": "Bob",   "email": "bob@example.com"}]

Sample rows (orders):
[{"order_id": 1, "customer_id": 1, "amount": 250.0, "order_date": "2024-01-15"},
 {"order_id": 2, "customer_id": 1, "amount": 180.0, "order_date": "2024-01-20"}]
"""

from __future__ import annotations

import json
import re
import pandas as pd

# ── dtype → SQL type ──────────────────────────────────────────────────────────

_DTYPE_SQL: dict[str, str] = {
    "int8":    "TINYINT",  "int16":  "SMALLINT", "int32":  "INTEGER",  "int64":  "BIGINT",
    "uint8":   "SMALLINT", "uint16": "INTEGER",  "uint32": "BIGINT",   "uint64": "BIGINT",
    "float16": "FLOAT",    "float32": "FLOAT",   "float64": "DOUBLE",
    "bool":    "BOOLEAN",
    "object":  "VARCHAR",  "string": "VARCHAR",
}


def sql_type(dtype) -> str:
    """Map a pandas dtype to its closest SQL type label."""
    s = str(dtype).lower()
    if s in _DTYPE_SQL:
        return _DTYPE_SQL[s]
    if "datetime" in s:
        return "TIMESTAMP"
    if "date" in s:
        return "DATE"
    if "int" in s:
        return "INTEGER"
    if "float" in s:
        return "DOUBLE"
    return "VARCHAR"


# ── Section builders ──────────────────────────────────────────────────────────

def _tables_section(tables: dict[str, pd.DataFrame]) -> str:
    """
    Tables:
    customers(id BIGINT, name VARCHAR)
    orders(order_id BIGINT, customer_id BIGINT, amount DOUBLE)
    """
    lines = [
        "{name}({cols})".format(
            name=table,
            cols=", ".join(
                f"{col} {sql_type(dtype)}"
                for col, dtype in df.dtypes.items()
                if not str(col).startswith("Unnamed")
            ),
        )
        for table, df in tables.items()
    ]
    return "Tables:\n" + "\n".join(lines)


def _relationships_section(relationships: list[dict]) -> str | None:
    """
    Relationships:
    customers.id = orders.customer_id
    """
    required = ("left_table", "left_column", "right_table", "right_column")
    lines = [
        f"{r['left_table']}.{r['left_column']} = {r['right_table']}.{r['right_column']}"
        for r in relationships
        if all(k in r for k in required)
    ]
    return ("Relationships:\n" + "\n".join(lines)) if lines else None


def _sample_section(table: str, df: pd.DataFrame, n: int) -> str:
    """
    Sample rows (customers):
    [{"id": 1, "name": "Alice"}, ...]
    """
    visible = [c for c in df.columns if not str(c).startswith("Unnamed")]
    sample = df[visible].head(n).to_dict(orient="records")

    # Truncate long string values so they don't bloat the prompt
    for row in sample:
        for k, v in row.items():
            if isinstance(v, str) and len(v) > 60:
                row[k] = v[:60] + "…"

    return f"Sample rows ({table}):\n{json.dumps(sample, default=str)}"


# ── Public API ────────────────────────────────────────────────────────────────

def build_schema_context(
    tables: dict[str, pd.DataFrame],
    relationships: list[dict] | None = None,
    *,
    include_samples: bool = True,
    max_sample_rows: int = 3,
) -> str:
    """
    Build a structured schema context string ready to embed in an AI prompt.

    Parameters
    ----------
    tables
        Ordered mapping of ``{table_name: DataFrame}``.  Every table is
        described in the output and registered in DuckDB before the query runs.
    relationships
        List of relationship dicts.  Each must contain at least
        ``left_table``, ``left_column``, ``right_table``, ``right_column``.
        Relationships with missing keys are silently skipped.
    include_samples
        When ``True`` (default), append sample rows for every table.
        Set to ``False`` for the answer-pass LLM call where rows add noise.
    max_sample_rows
        Number of sample rows per table.  Defaults to 3.

    Returns
    -------
    str
        A multi-section string separated by blank lines, e.g.::

            Tables:
            customers(id BIGINT, name VARCHAR)
            orders(order_id BIGINT, customer_id BIGINT, amount DOUBLE)

            Relationships:
            customers.id = orders.customer_id

            Sample rows (customers):
            [{"id": 1, "name": "Alice"}]

            Sample rows (orders):
            [{"order_id": 1, "customer_id": 1, "amount": 250.0}]
    """
    if not tables:
        return ""

    parts: list[str] = []

    # 1 — Tables (always present)
    parts.append(_tables_section(tables))

    # 2 — Relationships (omitted when none are configured)
    if relationships:
        rel_block = _relationships_section(relationships)
        if rel_block:
            parts.append(rel_block)

    # 3 — Sample rows (optional)
    if include_samples:
        for table, df in tables.items():
            if len(df) > 0:
                parts.append(_sample_section(table, df, max_sample_rows))

    return "\n\n".join(parts)


# ── Query-aware schema filtering ──────────────────────────────────────────────

# Keywords that signal aggregation — when present, keep all numeric/date cols
_AGG_TOKENS: frozenset[str] = frozenset({
    "total", "sum", "revenue", "sales", "income", "profit", "loss",
    "average", "avg", "mean", "count", "trend", "monthly", "weekly",
    "daily", "yearly", "annual", "breakdown", "max", "min", "highest",
    "lowest", "top", "bottom", "best", "worst", "how", "many", "much",
    "most", "least", "compare", "versus", "vs", "between", "per", "by",
    "group", "rank", "growth", "change", "increase", "decrease",
})

# Tables with ≤ this many visible columns get all columns included as-is
_SMALL_TABLE_THRESHOLD = 20

# Never return fewer than this many columns for any table (safety floor)
_MIN_COLS = 5


def _text_tokens(text: str) -> set[str]:
    """Lowercase alphanumeric tokens from arbitrary text."""
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def _col_name_tokens(col: str) -> set[str]:
    """
    Split a column name into searchable tokens.

    Handles snake_case, space-separated, and camelCase names so that
    e.g. ``CustomerName`` → ``{"customer", "name", "customername"}``
    and  ``total_revenue`` → ``{"total", "revenue", "total_revenue"}``.
    """
    # Normalise CamelCase → snake_case first
    snake = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", col)
    parts = re.split(r"[_\s]+", snake.lower())
    tokens: set[str] = set()
    for p in parts:
        if p:
            tokens.add(p)
    tokens.add(col.lower())
    return tokens


def filter_tables_for_query(
    tables: dict[str, pd.DataFrame],
    question: str,
    relationships: list[dict] | None = None,
    history: list[dict] | None = None,
) -> dict[str, list[str]]:
    """
    Return ``{table_name: [relevant_columns]}`` — a pruned view of *tables*
    containing only the tables and columns useful for answering *question*.

    Filtering strategy
    ------------------
    **Tables** (when > 2 tables are loaded):
      A table is kept when its name or any of its column names share tokens
      with the question.  Tables that are join endpoints are always kept.
      If nothing matches, all tables are kept (safe fallback).

    **Columns** (only for tables with > ``_SMALL_TABLE_THRESHOLD`` columns):
      A column is kept when:
      - its name tokens overlap with question/history tokens, OR
      - it is a join key in a relationship, OR
      - the question implies aggregation and the column is numeric or date, OR
      - it is one of the first ``_MIN_COLS`` columns (floor guarantee).

    The returned dicts are meant to be used like::

        filtered = {
            name: df[cols]
            for name, df in tables.items()
            if name in col_filter and (cols := col_filter[name])
        }
        schema = build_schema_context(filtered, ...)
    """
    # Build a single token set from the question + recent history
    context_text = question
    if history:
        for m in history[-4:]:
            context_text += " " + str(m.get("content", ""))[:300]
    q_tokens = _text_tokens(context_text)
    has_agg = bool(q_tokens & _AGG_TOKENS)

    # Collect join-key columns per table (always preserved)
    join_cols: dict[str, set[str]] = {}
    if relationships:
        for rel in relationships:
            for t_key, c_key in (("left_table", "left_column"), ("right_table", "right_column")):
                tname = rel.get(t_key, "")
                cname = rel.get(c_key, "")
                if tname and cname:
                    join_cols.setdefault(tname, set()).add(cname)

    # ── 1. Table selection ────────────────────────────────────────────────────
    if len(tables) <= 2:
        # Always include every table in simple single/dual-table setups
        relevant_tables = list(tables.keys())
    else:
        relevant_tables = []
        for tname, df in tables.items():
            # Table name itself mentioned?
            if _col_name_tokens(tname) & q_tokens:
                relevant_tables.append(tname)
                continue
            # Any column name mentioned?
            visible = [c for c in df.columns if not str(c).startswith("Unnamed")]
            if any(_col_name_tokens(c) & q_tokens for c in visible):
                relevant_tables.append(tname)
                continue
            # Is it a join endpoint? (provides context for a relevant table)
            if tname in join_cols:
                relevant_tables.append(tname)

        if not relevant_tables:
            relevant_tables = list(tables.keys())  # safe fallback

    # ── 2. Column selection ───────────────────────────────────────────────────
    result: dict[str, list[str]] = {}
    for tname in relevant_tables:
        df = tables[tname]
        visible = [c for c in df.columns if not str(c).startswith("Unnamed")]

        if len(visible) <= _SMALL_TABLE_THRESHOLD:
            result[tname] = visible
            continue

        forced = join_cols.get(tname, set())
        selected: list[str] = []

        for col in visible:
            col_toks = _col_name_tokens(col)
            if col_toks & q_tokens:
                selected.append(col)
            elif col in forced:
                selected.append(col)
            elif has_agg:
                dtype = df[col].dtype
                if pd.api.types.is_numeric_dtype(dtype) or pd.api.types.is_datetime64_any_dtype(dtype):
                    selected.append(col)
                else:
                    # String column that looks like a date?
                    try:
                        sample = df[col].dropna().head(5)
                        if len(sample) > 0:
                            n_parsed = pd.to_datetime(sample, errors="coerce").notna().sum()
                            if n_parsed / len(sample) >= 0.6:
                                selected.append(col)
                    except Exception:
                        pass

        # Floor: always expose at least the first _MIN_COLS columns so the
        # model sees enough context to write valid SQL even for vague questions.
        if len(selected) < _MIN_COLS:
            extra = [c for c in visible if c not in selected]
            selected += extra[: _MIN_COLS - len(selected)]

        result[tname] = selected

    return result
