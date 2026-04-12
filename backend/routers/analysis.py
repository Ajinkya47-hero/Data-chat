from fastapi import APIRouter, HTTPException
from services.data_store import (
    lookup_analysis_workspace,
    workspace_exists,
    analysis_exists,
    touch_workspace,
    get_analysis_meta,
    list_datasets,
    load_chat_history,
    load_insights,
    load_rel_overrides,
    make_rel_id,
    get_dataset,
    rename_analysis,
    delete_analysis,
    list_analyses,
)
from services.relationship_detector import detect_relationships
from models.schemas import AnalysisUpdate

router = APIRouter()


def _resolve(analysis_id: str):
    """Return (workspace_id) or raise 404."""
    workspace_id = lookup_analysis_workspace(analysis_id)
    if not workspace_id or not workspace_exists(workspace_id):
        raise HTTPException(404, "Analysis not found.")
    if not analysis_exists(workspace_id, analysis_id):
        raise HTTPException(404, "Analysis not found.")
    return workspace_id


def _build_relationships(workspace_id: str, analysis_id: str, dataset_list: list[dict]) -> list[dict]:
    if len(dataset_list) < 2:
        return []
    ds_map: dict = {}
    for meta in dataset_list:
        try:
            ds_map[meta["name"]] = get_dataset(workspace_id, analysis_id, meta["name"])
        except KeyError:
            pass
    overrides_data = load_rel_overrides(workspace_id, analysis_id)
    overrides: dict = overrides_data.get("overrides", {})
    additions: list = overrides_data.get("additions", [])
    deletions: set = set(overrides_data.get("deletions", []))
    result: list[dict] = []
    for r in detect_relationships(ds_map):
        rid = make_rel_id(r["left_table"], r["left_column"], r["right_table"], r["right_column"])
        if rid in deletions:
            continue
        rel = {**r, "id": rid, "source": "auto"}
        if rid in overrides:
            rel = {**rel, **overrides[rid]}
        result.append(rel)
    return result + additions


# ── GET /analysis/{analysis_id} ───────────────────────────────────────────────

@router.get("/{analysis_id}")
async def get_analysis(analysis_id: str):
    workspace_id = _resolve(analysis_id)
    touch_workspace(workspace_id)
    meta = get_analysis_meta(workspace_id, analysis_id)
    datasets = list_datasets(workspace_id, analysis_id)
    relationships = _build_relationships(workspace_id, analysis_id, datasets)
    chat_history = load_chat_history(workspace_id, analysis_id)
    insights = load_insights(workspace_id, analysis_id)
    return {
        "id": analysis_id,
        "workspace_id": workspace_id,
        "name": meta.get("name", "Analysis"),
        "created_at": meta.get("created_at"),
        "datasets": datasets,
        "relationships": relationships,
        "chat_history": chat_history,
        "insights": insights,
    }


# ── PATCH /analysis/{analysis_id} — rename ────────────────────────────────────

@router.patch("/{analysis_id}")
async def update_analysis(analysis_id: str, body: AnalysisUpdate):
    workspace_id = _resolve(analysis_id)
    rename_analysis(workspace_id, analysis_id, body.name)
    return {"id": analysis_id, "name": body.name}


# ── DELETE /analysis/{analysis_id} ───────────────────────────────────────────

@router.delete("/{analysis_id}", status_code=204)
async def remove_analysis(analysis_id: str):
    workspace_id = _resolve(analysis_id)
    remaining = list_analyses(workspace_id)
    if len(remaining) <= 1:
        raise HTTPException(400, "Cannot delete the only analysis in a workspace.")
    delete_analysis(workspace_id, analysis_id)
