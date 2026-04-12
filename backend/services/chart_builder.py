import pandas as pd
import numpy as np
from typing import Optional

CHART_RULES = {
    "bar":   {"min_cols": 2, "x_type": "any",    "y_type": "numeric"},
    "line":  {"min_cols": 2, "x_type": "time",   "y_type": "numeric"},
    "pie":   {"min_cols": 2, "x_type": "string", "y_type": "numeric"},
    "table": {"min_cols": 1, "x_type": "any",    "y_type": "any"},
}

def build_chart_spec(result_data, chart_type: str, title: str, x_col=None, y_col=None) -> Optional[dict]:
    if result_data is None or chart_type == "none":
        return None

    # Handle if result is just a list of dicts or scalar
    if isinstance(result_data, list):
        if len(result_data) == 0:
            return None
        df = pd.DataFrame(result_data)
    elif isinstance(result_data, dict):
        # Series dict: {label: value, label: value, ...} → 2-column DataFrame
        df = pd.DataFrame(list(result_data.items()), columns=["label", "value"])
        # Override x/y to match the new column names if not already set
        if not x_col or x_col not in df.columns:
            x_col = "label"
        if not y_col or y_col not in df.columns:
            y_col = "value"
    else:
        # Scalar
        return None
        
    df = df.copy()

    # 1. Clean: drop all-NaN columns, fill remaining NaN with 0 for numeric
    df.dropna(axis=1, how="all", inplace=True)
    for col in df.select_dtypes(include=[np.number]).columns:
        df[col] = df[col].fillna(0)
        
    if df.empty:
        return None

    # 2. Auto-detect x/y columns if not provided by LLM
    if not x_col or x_col not in df.columns:
        x_col = df.columns[0]
    if not y_col or y_col not in df.columns:
        numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()
        y_col = numeric_cols[0] if numeric_cols else df.columns[-1]

    # 3. Validate chart type against data shape — auto-downgrade if needed
    if chart_type == "pie" and len(df) > 20:
        chart_type = "bar"  # pie with >20 slices → unreadable
    if chart_type == "line":
        try:
            parsed = pd.to_datetime(df[x_col], errors="coerce")
            # Filter out epoch/NaT — only keep if year is reasonable
            if parsed.notna().sum() > 0 and parsed.dt.year.between(2000, 2100).all():
                df[x_col] = parsed.dt.strftime("%b %Y")
                df = df.sort_values(parsed)
            else:
                df[x_col] = df[x_col].astype(str)
        except Exception:
            chart_type = "bar"

    # 4. Limit rows for rendering performance
    if len(df) > 100:
        df = df.head(100)
        
    # Serialize data
    try:
        final_data = df[[x_col, y_col]].to_dict(orient="records")
    except KeyError:
        # Fallback if x_col/y_col missing somehow
        final_data = df.to_dict(orient="records")
        x_col = df.columns[0]
        y_col = df.columns[1] if len(df.columns) > 1 else x_col

    return {
        "type": chart_type,
        "title": title,
        "data": final_data,
        "xKey": str(x_col),
        "yKey": str(y_col),
        "xLabel": str(x_col).replace("_", " ").title(),
        "yLabel": str(y_col).replace("_", " ").title(),
    }
