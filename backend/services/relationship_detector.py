"""
Automatic relationship detection between datasets.

Detection pipeline (for each pair of columns across all table pairs):
  1. Name match  — exact or FK-pattern match on normalized column names
  2. Type compat — only compare compatible dtype categories
  3. Value overlap — what % of unique values in A appear in B
  4. Cardinality   — typical FK has fewer unique values in the FK table
  5. Table-name FK — orders.customer_id → customers.id heuristic

Returns a list of Relationship dicts, sorted by confidence desc.
"""

import re
import pandas as pd
from itertools import combinations
from typing import Any

# ── Constants ──────────────────────────────────────────────────────────────────

# Suffixes that signal an FK column
FK_SUFFIXES = ("_id", "_key", "_code", "_ref", "_no", "_num", "_number", "id")

# Column names that look like FKs by pattern but rarely are
# (e.g., "period", "year" might end in nothing, but "name_id" would be caught)
SKIP_COLUMNS = {
    "index", "unnamed", "row", "rownum", "row_number",
    "created_at", "updated_at", "timestamp", "date", "time",
    "description", "notes", "address", "email", "phone",
    "latitude", "longitude", "lat", "lng", "url", "image",
}

# Minimum overlap ratio to consider a value-based match
MIN_OVERLAP = 0.30
# Minimum confidence to include in results
MIN_CONFIDENCE = 0.45


# ── Helpers ────────────────────────────────────────────────────────────────────

def _normalize(name: str) -> str:
    return re.sub(r"[\s\-\.]", "_", name.lower()).strip("_")


def _is_fk_candidate(col: str) -> bool:
    """True if the column name looks like it could be a foreign key."""
    n = _normalize(col)
    if any(skip in n for skip in SKIP_COLUMNS):
        return False
    # Column is "id" alone → PK, handled separately
    if n == "id":
        return True
    return any(n.endswith(s) for s in FK_SUFFIXES)


def _dtype_category(series: pd.Series) -> str:
    """Broad type bucket: 'int', 'float', 'str', 'other'."""
    if pd.api.types.is_integer_dtype(series):
        return "int"
    if pd.api.types.is_float_dtype(series):
        return "float"
    if pd.api.types.is_object_dtype(series) or pd.api.types.is_string_dtype(series):
        return "str"
    return "other"


def _types_compatible(s1: pd.Series, s2: pd.Series) -> bool:
    c1, c2 = _dtype_category(s1), _dtype_category(s2)
    # int ↔ float OK (IDs sometimes stored as float)
    if {c1, c2} <= {"int", "float"}:
        return True
    return c1 == c2


def _value_overlap(s1: pd.Series, s2: pd.Series) -> float:
    """Fraction of s1's unique values that appear in s2's unique values."""
    v1 = set(s1.dropna().astype(str).unique())
    v2 = set(s2.dropna().astype(str).unique())
    if not v1 or not v2:
        return 0.0
    intersection = v1 & v2
    # Use the smaller set as denominator → measures "subset" relationship
    return len(intersection) / min(len(v1), len(v2))


def _table_name_fk_match(left_table: str, left_col: str,
                          right_table: str, right_col: str) -> bool:
    """
    Detects the pattern:
      orders.customer_id  ↔  customers.id
      payments.order_id   ↔  orders.id
    """
    def check(_, fk_col, pk_table, pk_col):
        pk_col_n = _normalize(pk_col)
        if pk_col_n != "id":
            return False
        fk_col_n = _normalize(fk_col)
        # fk_col should be "{pk_table_singular}_id"
        pk_table_n = _normalize(pk_table).rstrip("s")  # crude singularize
        return fk_col_n in (f"{pk_table_n}_id", f"{pk_table_n}id")

    return check(left_table, left_col, right_table, right_col) or \
           check(right_table, right_col, left_table, left_col)


# ── Core scoring ───────────────────────────────────────────────────────────────

def _score_pair(
    left_table: str, left_col: str, left_series: pd.Series,
    right_table: str, right_col: str, right_series: pd.Series,
) -> tuple[float, str]:
    """Return (confidence 0-1, match_type label)."""

    left_n = _normalize(left_col)
    right_n = _normalize(right_col)

    # Type must be compatible, otherwise skip entirely
    if not _types_compatible(left_series, right_series):
        return 0.0, "type_mismatch"

    score = 0.0
    match_type = "none"

    # ── 1. Exact name match ────────────────────────────────────────────────
    if left_n == right_n:
        if _is_fk_candidate(left_col):
            score += 0.55           # strong: same name + FK pattern
            match_type = "exact_key"
        elif any(skip in left_n for skip in SKIP_COLUMNS):
            # Common descriptive column (date, name, etc.) — skip entirely
            return 0.0, "skip_common"
        else:
            score += 0.25           # weaker: same name, not an FK pattern
            match_type = "exact_name"

    # ── 2. Table-name FK heuristic ─────────────────────────────────────────
    elif _table_name_fk_match(left_table, left_col, right_table, right_col):
        score += 0.50
        match_type = "table_name_fk"

    # ── 3. Fuzzy FK root match  (customer_id ↔ cust_id) ───────────────────
    else:
        # Strip FK suffix from both and compare roots
        def strip_fk(n: str) -> str:
            for s in sorted(FK_SUFFIXES, key=len, reverse=True):
                if n.endswith(s) and len(n) > len(s):
                    return n[: -len(s)].rstrip("_")
            return n

        l_root = strip_fk(left_n)
        r_root = strip_fk(right_n)

        if l_root and r_root and l_root == r_root and l_root != left_n:
            score += 0.40           # same root, both look like FK columns
            match_type = "fuzzy_key"

    if score == 0.0:
        return 0.0, "none"

    # ── 4. Value overlap boost ─────────────────────────────────────────────
    overlap = _value_overlap(left_series, right_series)
    if overlap >= MIN_OVERLAP:
        score += overlap * 0.35     # up to +0.35 bonus
        match_type += "_overlap"
    elif overlap < 0.05 and score < 0.55:
        # Columns share a name but have almost no common values → probably coincidence
        score *= 0.4

    # ── 5. Cardinality sanity ──────────────────────────────────────────────
    # FK column usually has fewer unique values than the referenced PK column
    left_uniq = left_series.nunique()
    right_uniq = right_series.nunique()
    if left_uniq > 0 and right_uniq > 0:
        ratio = min(left_uniq, right_uniq) / max(left_uniq, right_uniq)
        if ratio < 0.95:            # one side has notably fewer unique values
            score = min(score + 0.05, 1.0)

    return round(min(score, 1.0), 3), match_type


# ── Public API ─────────────────────────────────────────────────────────────────

def detect_relationships(datasets: dict[str, pd.DataFrame]) -> list[dict[str, Any]]:
    """
    Compare all pairs of datasets and return detected relationships.

    Parameters
    ----------
    datasets : {name: DataFrame}

    Returns
    -------
    List of relationship dicts sorted by confidence descending:
    {
        left_table, left_column,
        right_table, right_column,
        confidence,      # 0.0 – 1.0
        match_type,      # 'exact_key', 'table_name_fk', 'fuzzy_key', ...
        value_overlap,   # 0.0 – 1.0
    }
    """
    if len(datasets) < 2:
        return []

    relationships: list[dict] = []
    table_names = list(datasets.keys())

    for left_name, right_name in combinations(table_names, 2):
        left_df = datasets[left_name]
        right_df = datasets[right_name]

        for left_col in left_df.columns:
            if _normalize(left_col).startswith("unnamed"):
                continue
            for right_col in right_df.columns:
                if _normalize(right_col).startswith("unnamed"):
                    continue

                confidence, match_type = _score_pair(
                    left_name, left_col, left_df[left_col],
                    right_name, right_col, right_df[right_col],
                )

                if confidence < MIN_CONFIDENCE:
                    continue

                overlap = _value_overlap(left_df[left_col], right_df[right_col])

                relationships.append({
                    "left_table": left_name,
                    "left_column": left_col,
                    "right_table": right_name,
                    "right_column": right_col,
                    "confidence": confidence,
                    "match_type": match_type.replace("_overlap", ""),
                    "value_overlap": round(overlap, 3),
                })

    # Deduplicate: if the same column pair appears from both directions, keep higher conf
    seen: dict[frozenset, dict] = {}
    for rel in relationships:
        key = frozenset([
            (rel["left_table"], rel["left_column"]),
            (rel["right_table"], rel["right_column"]),
        ])
        if key not in seen or rel["confidence"] > seen[key]["confidence"]:
            seen[key] = rel

    return sorted(seen.values(), key=lambda r: r["confidence"], reverse=True)
