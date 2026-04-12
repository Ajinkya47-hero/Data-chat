import subprocess
import json
import textwrap
import tempfile
import os
import ast

# ── Safety constants ──────────────────────────────────────────────────────────

# Calls that must never appear in LLM-generated code
BLOCKED_CALLS = frozenset({"eval", "exec", "compile", "__import__", "breakpoint"})

# Dunder attributes used in common Python sandbox-escape chains
BLOCKED_ATTRS = frozenset({
    "__subclasses__", "__globals__", "__builtins__",
    "__reduce__", "__reduce_ex__", "__code__",
})

MAX_RESULT_ROWS = 2000

# ── Sandbox script template ───────────────────────────────────────────────────
# Placeholders: {user_code} and {max_rows}
# All other literal Python braces are doubled: {{ }}

SANDBOX_TEMPLATE = '''# -*- coding: utf-8 -*-
import pandas as pd
import numpy as np
import json
import sys


def _parse_dates(df):
    """Re-parse date/time columns after JSON round-trip (arrive as ISO strings)."""
    for col in df.columns:
        if df[col].dtype != object:
            continue
        lower = col.lower()
        if not any(k in lower for k in ('date', 'time', '_at', '_on')):
            continue
        # ISO8601 first (matches to_json output), then flexible fallback
        parsed = pd.to_datetime(df[col], format='ISO8601', errors='coerce')
        if parsed.notna().sum() < len(df) * 0.5:
            parsed = pd.to_datetime(df[col], errors='coerce')
        if parsed.notna().sum() > len(df) * 0.5:
            df[col] = parsed
    return df


def _clean_df(d):
    """Replace non-JSON-safe floats with None."""
    return d.replace({{float('nan'): None, float('inf'): None, float('-inf'): None}})


# ── Load datasets from stdin payload ─────────────────────────────────────────
try:
    payload = json.loads(sys.stdin.read())

    df = _parse_dates(pd.DataFrame(payload["primary"]))

    _extra: dict = {{}}
    for _name, _rows in payload.get("extra", {{}}).items():
        _edf = _parse_dates(pd.DataFrame(_rows))
        globals()[f"df_{{_name}}"] = _edf
        _extra[_name] = _edf

    _relationships: list = payload.get("relationships", [])

except Exception as e:
    print(json.dumps({{"error": f"Failed to load data: {{str(e)}}"}}))
    sys.exit(1)

# Map every variable name → DataFrame (used in error messages)
_all_dfs: dict = {{"df": df, **{{f"df_{{k}}": v for k, v in _extra.items()}}}}

# ── Execute LLM-generated code ────────────────────────────────────────────────
try:
{user_code}
except KeyError as e:
    # Most common merge mistake: referencing a column that doesn't exist
    _col_hints = "; ".join(
        f"{{var}}({', '.join(list(d.columns)[:10])})"
        for var, d in _all_dfs.items()
    )
    print(json.dumps({{
        "error": (
            f"KeyError: column {{str(e)}} not found. "
            f"Available columns — {{_col_hints}}"
        )
    }}))
    sys.exit(1)
except pd.errors.MergeError as e:
    print(json.dumps({{"error": f"Merge error: {{str(e)}}"}}))
    sys.exit(1)
except Exception as e:
    print(json.dumps({{"error": f"{{type(e).__name__}}: {{str(e)}}"}}))
    sys.exit(1)

# ── Validate result variable ──────────────────────────────────────────────────
if 'result' not in locals():
    print(json.dumps({{"error": "Variable 'result' was not defined by the code."}}))
    sys.exit(1)

_warnings: list = []

# Detect likely bad-join: inputs have rows but merge produced nothing
if (
    isinstance(result, pd.DataFrame)
    and len(result) == 0
    and _relationships
    and (len(df) > 0 or any(len(d) > 0 for d in _extra.values()))
):
    _rel_summary = ", ".join(
        f"{{r.get('left_table')}}.{{r.get('left_column')}} = "
        f"{{r.get('right_table')}}.{{r.get('right_column')}}"
        for r in _relationships
    )
    _warnings.append(
        f"Merge produced 0 rows — join key values may not overlap. "
        f"Configured relationships: {{_rel_summary}}"
    )

# ── Serialize result ──────────────────────────────────────────────────────────
if isinstance(result, pd.DataFrame):
    _out = {{
        "dataframe": _clean_df(result).head({max_rows}).to_dict(orient="records")
    }}
elif isinstance(result, pd.Series):
    _s = result.head({max_rows})
    _out = {{
        "series": {{
            k: (None if (isinstance(v, float) and (v != v or v == float('inf') or v == float('-inf'))) else v)
            for k, v in _s.items()
        }}
    }}
elif result is None:
    _out = {{"scalar": None}}
elif hasattr(result, 'item'):
    _out = {{"scalar": result.item()}}
elif isinstance(result, (int, float, str, bool)):
    _out = {{"scalar": result}}
else:
    _out = {{"error": f"Unsupported result type: {{type(result).__name__}}"}}

if _warnings:
    _out["warnings"] = _warnings

print(json.dumps(_out, default=str))
'''


# ── AST safety check ──────────────────────────────────────────────────────────

def _ast_check(code: str) -> None:
    """
    Static analysis pass before any execution.

    Blocks:
    - All import / import-from statements
    - Calls to dangerous builtins (eval, exec, compile, __import__, breakpoint)
    - Access to sandbox-escape dunder attributes (__subclasses__, __globals__, etc.)
    """
    try:
        tree = ast.parse(code)
    except SyntaxError as e:
        raise ValueError(f"Syntax error in generated code: {e}")

    for node in ast.walk(tree):
        # Block imports
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            names = [alias.name for alias in node.names]
            raise ValueError(f"Import not allowed in generated code: {', '.join(names)}")

        # Block dangerous calls
        if isinstance(node, ast.Call):
            func = node.func
            name = func.id if isinstance(func, ast.Name) else None
            if name and name in BLOCKED_CALLS:
                raise ValueError(
                    f"Call to '{name}()' is not allowed in generated code"
                )

        # Block sandbox-escape attribute access
        if isinstance(node, ast.Attribute) and node.attr in BLOCKED_ATTRS:
            raise ValueError(
                f"Access to '.{node.attr}' is not allowed in generated code"
            )


# ── Public API ────────────────────────────────────────────────────────────────

def safe_exec(
    code: str,
    df,
    extra_dfs: dict | None = None,
    relationships: list | None = None,
) -> dict:
    """
    Execute LLM-generated Pandas code in an isolated subprocess.

    Parameters
    ----------
    code          : LLM-generated Python string
    df            : Primary DataFrame — available as ``df`` in code
    extra_dfs     : Extra DataFrames — available as ``df_{name}`` in code
    relationships : Detected/stored join relationships, forwarded to the
                    sandbox for empty-merge detection and error hints

    Returns
    -------
    dict with exactly one data key:
        ``{"dataframe": [...]}``  — list of row dicts (up to MAX_RESULT_ROWS)
        ``{"series": {...}}``     — key→value mapping
        ``{"scalar": value}``     — single numeric / string value
    May also contain ``{"warnings": [...]}`` alongside the data key.

    Raises
    ------
    ValueError      : AST check failed (bad code structure)
    RuntimeError    : Execution error, timeout, or subprocess failure
    """

    # ── 1. Static safety check ────────────────────────────────────────────────
    _ast_check(code)

    # ── 2. Build sandbox script ───────────────────────────────────────────────
    script = SANDBOX_TEMPLATE.format(
        user_code=textwrap.indent(code, "    "),
        max_rows=MAX_RESULT_ROWS,
    )
    fd, script_path = tempfile.mkstemp(suffix=".py", text=True)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(script)

    try:
        # ── 3. Serialise all datasets as JSON ─────────────────────────────────
        def _df_to_records(d):
            return json.loads(
                d.to_json(orient="records", date_format="iso", force_ascii=False)
            )

        payload = {
            "primary": _df_to_records(df),
            "extra": {
                name: _df_to_records(edf)
                for name, edf in (extra_dfs or {}).items()
            },
            # Slim relationship dicts — only what the sandbox needs
            "relationships": [
                {
                    "left_table":  r.get("left_table", ""),
                    "left_column": r.get("left_column", ""),
                    "right_table": r.get("right_table", ""),
                    "right_column": r.get("right_column", ""),
                }
                for r in (relationships or [])
            ],
        }
        input_json = json.dumps(payload, ensure_ascii=False)

        # ── 4. Run in isolated subprocess ─────────────────────────────────────
        proc = subprocess.run(
            ["python", script_path],
            input=input_json,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=30,  # generous for large multi-table merges
        )

        stdout = proc.stdout.strip()
        stderr = proc.stderr.strip()

        if not stdout:
            detail = stderr[:500] if stderr else "subprocess produced no output"
            raise RuntimeError(f"Execution failed: {detail}")

        # ── 5. Parse output ───────────────────────────────────────────────────
        try:
            result = json.loads(stdout)
        except json.JSONDecodeError:
            detail = stderr[:500] if stderr else stdout[:300]
            raise RuntimeError(f"Subprocess returned non-JSON output: {detail}")

        if "error" in result:
            raise RuntimeError(result["error"])

        return result

    except subprocess.TimeoutExpired:
        raise RuntimeError(
            f"Code execution timed out after 30 seconds — "
            "query may be too complex or datasets too large"
        )
    finally:
        try:
            os.unlink(script_path)
        except OSError:
            pass
