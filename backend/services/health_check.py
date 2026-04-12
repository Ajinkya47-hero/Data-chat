import pandas as pd
import numpy as np
from models.schemas import HealthStats, ColumnInfo, ColumnStat, KPI, DataSummary


def _fmt(val: float) -> str:
    if val >= 10_000_000:
        return f"₹{val/1_00_00_000:.1f}Cr"
    if val >= 1_00_000:
        return f"₹{val/1_00_000:.1f}L"
    if val >= 1_000:
        return f"₹{val/1_000:.1f}K"
    return f"₹{val:,.0f}"


def _build_column_stat(series: pd.Series, dtype: str) -> ColumnStat:
    clean = series.dropna()
    unique = int(clean.nunique())

    if dtype in ("int64", "float64") and len(clean) > 0:
        return ColumnStat(
            min=float(clean.min()),
            max=float(clean.max()),
            mean=float(clean.mean()),
            unique=unique,
            top_values=[],
        )
    else:
        counts = clean.astype(str).value_counts().head(3)
        top = [f"{v} ({c})" for v, c in counts.items()]
        return ColumnStat(unique=unique, top_values=top)


def _build_summary(df: pd.DataFrame) -> DataSummary:
    rows = len(df)
    kpis: list[KPI] = []
    sentence_parts = [f"{rows} records"]

    # Detect area/category column
    for col in df.columns:
        if df[col].dtype == object and df[col].nunique() < 20:
            n = df[col].nunique()
            label = col.lower()
            if any(w in label for w in ["area", "region", "city", "location"]):
                sentence_parts.append(f"{n} areas")
            elif any(w in label for w in ["turf", "venue", "place", "field"]):
                sentence_parts.append(f"{n} turfs")
            break

    # Detect date range
    for col in df.columns:
        if "date" in col.lower():
            try:
                dates = pd.to_datetime(df[col], errors="coerce").dropna()
                if len(dates) > 0:
                    d_min = dates.min().strftime("%b %Y")
                    d_max = dates.max().strftime("%b %Y")
                    if d_min == d_max:
                        sentence_parts.append(f"in {d_min}")
                    else:
                        sentence_parts.append(f"from {d_min} to {d_max}")
            except Exception:
                pass
            break

    sentence = "Your dataset has " + ", ".join(sentence_parts) + "."

    # Auto-detect KPI columns
    numeric_cols = df.select_dtypes(include=[np.number]).columns.tolist()

    for col in numeric_cols:
        lower = col.lower().replace(" ", "").replace("_", "")
        series = df[col].dropna()
        if len(series) == 0:
            continue
        total = float(series.sum())
        avg = float(series.mean())

        if any(w in lower for w in ["revenue", "sales", "income", "earning"]) and "net" not in lower:
            kpis.append(KPI(label="Total Revenue", value=_fmt(total),
                            sub=f"Avg {_fmt(avg)} / session", color="blue"))
        elif any(w in lower for w in ["net", "profit"]) and "%" not in col:
            color = "green" if total >= 0 else "red"
            kpis.append(KPI(label="Total Profit", value=_fmt(total),
                            sub=f"Avg {_fmt(avg)} / session", color=color))
        elif "net%" in lower or ("net" in lower and "%" in col):
            kpis.append(KPI(label="Avg Margin", value=f"{avg:.1f}%",
                            sub=f"Min {series.min():.0f}% · Max {series.max():.0f}%", color="amber"))
        elif any(w in lower for w in ["nop", "players", "occupancy", "count"]):
            kpis.append(KPI(label="Avg Players / Session", value=f"{avg:.1f}",
                            sub=f"Max {series.max():.0f} players", color="blue"))
        elif any(w in lower for w in ["rent", "cost", "expense"]):
            kpis.append(KPI(label="Total Rent Paid", value=_fmt(total),
                            sub=f"Avg {_fmt(avg)} / session", color="amber"))

    # Fallback: sessions count
    if not any(k.label == "Total Revenue" for k in kpis):
        kpis.append(KPI(label="Total Sessions", value=str(rows), color="blue"))

    return DataSummary(sentence=sentence, kpis=kpis[:5])


def analyze_dataset_health(df: pd.DataFrame) -> dict:
    total_rows = len(df)
    total_columns = len(df.columns)

    if total_rows == 0:
        return {
            "columns": [],
            "health": HealthStats(
                total_rows=0, total_columns=total_columns,
                duplicate_rows=0, missing_cells=0, missing_pct=0.0
            ),
            "summary": None,
        }

    duplicate_rows = int(df.duplicated().sum())
    missing_cells = int(df.isnull().sum().sum())
    missing_pct = missing_cells / (total_rows * total_columns) * 100 if total_rows * total_columns > 0 else 0

    dtypes_dict = df.dtypes.apply(lambda x: x.name).to_dict()
    nulls_dict = df.isnull().mean().to_dict()

    col_info = []
    for col in df.columns:
        dtype = str(dtypes_dict.get(col, "unknown"))
        stat = _build_column_stat(df[col], dtype)
        col_info.append(ColumnInfo(
            name=str(col),
            dtype=dtype,
            missing_pct=float(nulls_dict.get(col, 0.0) * 100),
            stat=stat,
        ))

    summary = _build_summary(df)

    return {
        "columns": col_info,
        "health": HealthStats(
            total_rows=total_rows,
            total_columns=total_columns,
            duplicate_rows=duplicate_rows,
            missing_cells=missing_cells,
            missing_pct=missing_pct,
        ),
        "summary": summary,
    }