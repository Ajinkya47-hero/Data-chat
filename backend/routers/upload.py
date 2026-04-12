from fastapi import APIRouter, UploadFile, File, HTTPException, Form
import pandas as pd
import posthog
import io
import re
from pathlib import Path
from typing import Annotated, Optional

from services.data_store import (
    save_dataset, list_datasets, workspace_exists, get_analysis_meta,
    create_workspace, create_analysis, analysis_exists,
)
from models.schemas import UploadResponse, DatasetInfo, GSheetRequest

router = APIRouter()

MAX_UPLOAD_MB = 50


# ── Name helpers ──────────────────────────────────────────────────────────────

# Ordered: first match wins. Each entry = (keywords, label)
_DOMAIN_MAP: list[tuple[list[str], str]] = [
    (["sales", "revenue", "invoice", "deal", "crm", "order", "purchase", "selling"], "Sales Analysis"),
    (["marketing", "campaign", "ad", "ads", "leads", "funnel", "conversion", "promo"], "Marketing Analysis"),
    (["hr", "employee", "staff", "payroll", "attendance", "leave", "hiring", "recruit"], "HR Analysis"),
    (["finance", "financial", "budget", "expense", "cost", "profit", "loss", "p&l", "pl", "accounting"], "Finance Analysis"),
    (["inventory", "stock", "product", "sku", "warehouse", "catalog"], "Inventory Analysis"),
    (["customer", "client", "churn", "retention", "nps", "satisfaction", "user"], "Customer Analysis"),
    (["traffic", "analytics", "website", "web", "seo", "pageview", "session", "click"], "Web Analytics"),
    (["support", "ticket", "helpdesk", "issue", "complaint", "feedback"], "Support Analysis"),
    (["logistics", "supply", "shipment", "delivery", "transport", "freight"], "Logistics Analysis"),
    (["project", "task", "sprint", "milestone", "roadmap"], "Project Analysis"),
    (["survey", "response", "questionnaire", "poll", "vote"], "Survey Analysis"),
]


def _infer_analysis_name(filename: str) -> str:
    """Infer a human-readable analysis name from a filename."""
    lower = filename.lower()
    for keywords, label in _DOMAIN_MAP:
        if any(kw in lower for kw in keywords):
            return label
    # Fallback: clean filename stem → title case + "Analysis"
    stem = re.sub(r"[_\-\s]+", " ", Path(filename).stem).strip().title()
    return f"{stem} Analysis" if stem and stem.lower() not in ("dataset", "data", "file") else "Data Analysis"


def _clean_name(filename: str) -> str:
    """Turn a file name into a safe dataset name (no extension, alphanumeric + underscore)."""
    stem = Path(filename).stem
    name = re.sub(r"[^a-zA-Z0-9_]", "_", stem).strip("_")
    return name or "dataset"


def _fix_currency(df: pd.DataFrame) -> pd.DataFrame:
    """Fix broken ₹ encoding and auto-convert currency columns to numeric."""
    def fix_val(val):
        if not isinstance(val, str):
            return val
        val = val.replace("â¹", "").replace("₹", "").replace(",", "").replace("%", "").strip()
        try:
            return float(val) if "." in val else int(val)
        except ValueError:
            return val

    for col in df.columns:
        if df[col].dtype == object:
            sample = df[col].dropna().astype(str)
            if sample.str.contains(r"â¹|₹|\d", regex=True).mean() > 0.5:
                converted = df[col].apply(fix_val)
                if pd.to_numeric(converted, errors="coerce").notna().mean() > 0.5:
                    df[col] = pd.to_numeric(converted, errors="coerce")
    return df


def _parse_csv(contents: bytes) -> pd.DataFrame:
    buf = io.BytesIO(contents)
    try:
        return pd.read_csv(buf, low_memory=True, encoding="utf-8")
    except UnicodeDecodeError:
        buf.seek(0)
        return pd.read_csv(buf, low_memory=True, encoding="latin-1")


def _resolve_workspace_and_analysis(
    workspace_id: Optional[str],
    analysis_id: Optional[str],
    inferred_name: str,
) -> tuple[str, str, str]:
    """
    Return (wid, aid, analysis_name).

    - If analysis_id is provided and valid → use that existing analysis (add dataset to it).
    - Otherwise → always create a brand-new analysis with the inferred name.
    """
    # Resolve / bootstrap workspace
    if workspace_id and workspace_exists(workspace_id):
        wid = workspace_id
    else:
        wid = create_workspace()

    # Reuse existing analysis only when explicitly requested (e.g. "Add Dataset" in dashboard)
    if analysis_id and analysis_exists(wid, analysis_id):
        name = get_analysis_meta(wid, analysis_id).get("name", inferred_name)
        return wid, analysis_id, name

    # New upload → always a fresh analysis
    aid = create_analysis(wid, inferred_name)
    return wid, aid, inferred_name


def _build_response(
    workspace_id: str, analysis_id: str, analysis_name: str, uploaded_name: str
) -> UploadResponse:
    all_datasets = list_datasets(workspace_id, analysis_id)
    return UploadResponse(
        workspace_id=workspace_id,
        analysis_id=analysis_id,
        analysis_name=analysis_name,
        uploaded=uploaded_name,
        datasets=[DatasetInfo(**d) for d in all_datasets],
    )


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/csv", response_model=UploadResponse)
async def upload_csv(
    file: UploadFile = File(...),
    workspace_id: Annotated[Optional[str], Form()] = None,
    analysis_id: Annotated[Optional[str], Form()] = None,
):
    contents = await file.read(MAX_UPLOAD_MB * 1024 * 1024 + 1)
    if len(contents) > MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {MAX_UPLOAD_MB} MB limit")

    try:
        df = _parse_csv(contents)
    except Exception as e:
        raise HTTPException(400, f"Error parsing CSV: {e}")

    df = _fix_currency(df)

    dataset_name = _clean_name(file.filename or "dataset")
    inferred = _infer_analysis_name(file.filename or "dataset")
    wid, aid, aname = _resolve_workspace_and_analysis(workspace_id, analysis_id, inferred)

    try:
        save_dataset(wid, aid, dataset_name, df)
    except ValueError as e:
        raise HTTPException(409, str(e))

    posthog.capture(wid, "upload_dataset", {
        "dataset_name": dataset_name,
        "number_of_rows": len(df),
        "number_of_columns": len(df.columns),
        "source": "csv",
    })

    return _build_response(wid, aid, aname, dataset_name)


def _extract_gsheet_id(url: str) -> str:
    match = re.search(r"/d/([a-zA-Z0-9-_]+)", url)
    return match.group(1) if match else ""


@router.post("/gsheet", response_model=UploadResponse)
async def upload_gsheet(
    request: GSheetRequest,
    workspace_id: Optional[str] = None,
    analysis_id: Optional[str] = None,
):
    sheet_id = _extract_gsheet_id(request.url)
    if not sheet_id:
        raise HTTPException(400, "Invalid Google Sheets URL")

    csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"
    try:
        df = pd.read_csv(csv_url)
    except Exception as e:
        raise HTTPException(400, f"Could not read Google Sheet. Make sure it is public. Error: {e}")

    size_mb = df.memory_usage(deep=True).sum() / 1e6
    if size_mb > MAX_UPLOAD_MB:
        raise HTTPException(413, f"Sheet exceeds {MAX_UPLOAD_MB} MB limit")

    df = _fix_currency(df)

    dataset_name = f"sheet_{sheet_id[:8]}"
    inferred = "Spreadsheet Analysis"
    wid, aid, aname = _resolve_workspace_and_analysis(workspace_id, analysis_id, inferred)

    try:
        save_dataset(wid, aid, dataset_name, df)
    except ValueError as e:
        raise HTTPException(409, str(e))

    posthog.capture(wid, "upload_dataset", {
        "dataset_name": dataset_name,
        "number_of_rows": len(df),
        "number_of_columns": len(df.columns),
        "source": "gsheet",
    })

    return _build_response(wid, aid, aname, dataset_name)
