"""
DuckDB-based SQL execution engine.

Each DataFrame is registered as an in-memory DuckDB table whose name matches
the dataset name (e.g. "customers", "orders").  The LLM-generated SELECT query
runs against those tables and the result is returned as a plain dict.

Safety model
────────────
• Only SELECT / WITH (CTE) queries are accepted — DDL and DML are rejected at
  parse time before DuckDB ever sees the SQL.
• Filesystem and network access functions are explicitly blocked.
• The DuckDB connection is in-memory only and discarded after each call.
"""

import re
import duckdb
import pandas as pd

MAX_RESULT_ROWS = 2000

# ── SQL safety ────────────────────────────────────────────────────────────────

# Functions / keywords that could reach the filesystem or network even inside a
# SELECT statement.
_BLOCKED_FUNCS = re.compile(
    r"\b(read_csv|read_csv_auto|read_parquet|read_json|read_json_auto|"
    r"read_excel|read_text|glob|httpfs|http_get|http_post|"
    r"copy|export|import|attach|detach|install|load)\b",
    re.IGNORECASE,
)


def _sql_check(sql: str) -> None:
    """
    Validate that *sql* is a safe, read-only SELECT query.

    Raises
    ------
    ValueError  if the query fails any safety rule.
    """
    # Strip single-line and block comments before checking
    stripped = re.sub(r"--[^\n]*", " ", sql)
    stripped = re.sub(r"/\*.*?\*/", " ", stripped, flags=re.DOTALL).strip()

    if not stripped:
        raise ValueError("Empty query.")

    # Must begin with SELECT or WITH (CTEs like "WITH cte AS (...) SELECT ...")
    if not re.match(r"^\s*(SELECT|WITH)\b", stripped, re.IGNORECASE):
        raise ValueError(
            "Only SELECT queries are allowed. "
            "DDL (CREATE / DROP) and DML (INSERT / UPDATE / DELETE) are not permitted."
        )

    # Block any dangerous function / keyword even inside a SELECT
    match = _BLOCKED_FUNCS.search(stripped)
    if match:
        raise ValueError(
            f"Keyword or function '{match.group()}' is not allowed in queries."
        )


# ── Execution ─────────────────────────────────────────────────────────────────

def duckdb_exec(
    sql: str,
    tables: dict[str, pd.DataFrame],
    relationships: list[dict] | None = None,
) -> dict:
    """
    Execute *sql* against the DataFrames in *tables*.

    Parameters
    ----------
    sql           : A SELECT (or WITH … SELECT) SQL string
    tables        : Mapping of table_name → DataFrame; every entry is registered
                    as a DuckDB view before the query runs
    relationships : Relationship list forwarded for empty-join detection only

    Returns
    -------
    dict with one data key:
        ``{"dataframe": [row_dict, …]}``   — up to MAX_RESULT_ROWS rows
        ``{"scalar": value}``              — when result is exactly 1 row × 1 col
    May also contain ``{"warnings": [str, …]}``.

    Raises
    ------
    ValueError      : SQL safety check failed
    RuntimeError    : DuckDB execution error (message includes DuckDB's own text)
    """
    # ── 1. Safety check ───────────────────────────────────────────────────────
    _sql_check(sql)

    # ── 2. Build in-memory connection and register tables ─────────────────────
    con = duckdb.connect(":memory:")
    try:
        # Disable external file / network access where supported
        try:
            con.execute("SET enable_external_access = false;")
        except duckdb.Error:
            pass  # older DuckDB versions may not have this setting

        for name, df in tables.items():
            # Register a zero-copy view of the DataFrame
            con.register(name, df)

        # ── 3. Execute ────────────────────────────────────────────────────────
        try:
            result_df: pd.DataFrame = con.execute(sql).df()
        except duckdb.CatalogException as e:
            available = ", ".join(tables.keys())
            raise RuntimeError(
                f"Table or column not found: {e}. "
                f"Available tables: {available}"
            ) from e
        except duckdb.ParserException as e:
            raise RuntimeError(f"SQL syntax error: {e}") from e
        except duckdb.BinderException as e:
            # Column resolution failure — include column hints
            col_hints = "; ".join(
                f"{t}({', '.join(df.columns[:8])}{'…' if len(df.columns) > 8 else ''})"
                for t, df in tables.items()
            )
            raise RuntimeError(
                f"Column not found: {e}. "
                f"Available columns — {col_hints}"
            ) from e
        except duckdb.Error as e:
            raise RuntimeError(f"Query execution error: {e}") from e

        # ── 4. Detect bad-join empty result ───────────────────────────────────
        warnings: list[str] = []
        if (
            len(result_df) == 0
            and relationships
            and any(len(df) > 0 for df in tables.values())
        ):
            rel_summary = ", ".join(
                f"{r.get('left_table')}.{r.get('left_column')} = "
                f"{r.get('right_table')}.{r.get('right_column')}"
                for r in relationships
            )
            warnings.append(
                "Query returned 0 rows — join conditions may not match any data. "
                f"Configured relationships: {rel_summary}"
            )

        # ── 5. Detect scalar result (1 row × 1 col) ──────────────────────────
        if result_df.shape == (1, 1):
            val = result_df.iloc[0, 0]
            if hasattr(val, "item"):   # numpy scalar → Python native
                val = val.item()
            out: dict = {"scalar": val}
        else:
            # Replace NaN / ±Inf so the dict is JSON-safe
            clean = result_df.replace(
                {float("nan"): None, float("inf"): None, float("-inf"): None}
            )
            out = {"dataframe": clean.head(MAX_RESULT_ROWS).to_dict(orient="records")}

        if warnings:
            out["warnings"] = warnings

        return out

    finally:
        con.close()
