from fastapi import APIRouter, HTTPException

from models.schemas import InsightRequest, InsightResponse, InsightItem
from services.data_store import (
    get_dataset, get_first_dataset, load_rel_overrides, make_rel_id,
    save_insights, touch_workspace,
)
from services.relationship_detector import detect_relationships
from services.insights_engine import generate_insights
from services.rate_limiter import session_throttler

router = APIRouter()


def _get_relationships(workspace_id: str, analysis_id: str, datasets: dict) -> list[dict]:
    if len(datasets) < 2:
        return []
    overrides_data = load_rel_overrides(workspace_id, analysis_id)
    overrides: dict = overrides_data.get("overrides", {})
    additions: list = overrides_data.get("additions", [])
    deletions: set = set(overrides_data.get("deletions", []))

    auto_rels = []
    for r in detect_relationships(datasets):
        rid = make_rel_id(r["left_table"], r["left_column"], r["right_table"], r["right_column"])
        if rid in deletions:
            continue
        rel = {**r, "id": rid, "source": "auto"}
        if rid in overrides:
            rel = {**rel, **overrides[rid]}
        auto_rels.append(rel)

    return auto_rels + additions


@router.post("/analyze", response_model=InsightResponse)
async def analyze(req: InsightRequest):
    # ── Per-session throttle ─────────────────────────────────────────────────
    is_throttled = await session_throttler.tick(req.workspace_id)

    # ── Load datasets ────────────────────────────────────────────────────────
    try:
        if req.dataset:
            primary_df = get_dataset(req.workspace_id, req.analysis_id, req.dataset)
        else:
            req.dataset, primary_df = get_first_dataset(req.workspace_id, req.analysis_id)
    except KeyError as e:
        raise HTTPException(404, str(e))

    extra_dfs: dict = {}
    for name in (req.extra_datasets or []):
        try:
            extra_dfs[name] = get_dataset(req.workspace_id, req.analysis_id, name)
        except KeyError:
            pass

    all_tables = {req.dataset: primary_df, **extra_dfs}
    relationships = _get_relationships(req.workspace_id, req.analysis_id, all_tables)

    # ── Generate insights ────────────────────────────────────────────────────
    try:
        raw_insights = await generate_insights(
            tables=all_tables,
            primary_name=req.dataset,
            relationships=relationships or None,
            model=req.model,
        )
    except RuntimeError as e:
        error_str = str(e)
        if "RATE_LIMITED" in error_str:
            raise HTTPException(503, error_str.replace("RATE_LIMITED: ", ""))
        if any(k in error_str.lower() for k in ("quota_exceeded", "quota exceeded", "resource_exhausted")):
            raise HTTPException(429, f"Quota exceeded for model '{req.model}'. Please switch to another model.")
        raise HTTPException(500, f"Insights generation failed: {error_str}")

    if not raw_insights:
        raise HTTPException(500, "The model did not return any insights. Please try again.")

    # Persist insights — best-effort
    try:
        touch_workspace(req.workspace_id)
        save_insights(req.workspace_id, req.analysis_id, req.dataset, raw_insights)
    except Exception:
        pass

    return InsightResponse(
        insights=[InsightItem(**item) for item in raw_insights],
        throttled=is_throttled,
    )
