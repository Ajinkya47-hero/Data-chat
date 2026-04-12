from fastapi import APIRouter, HTTPException
from services.data_store import (
    create_workspace,
    workspace_exists,
    get_workspace_meta,
    touch_workspace,
    list_analyses,
    create_analysis,
    get_dataset,
    load_rel_overrides,
    make_rel_id,
    list_datasets,
)
from services.relationship_detector import detect_relationships
from models.schemas import AnalysisCreate

router = APIRouter()


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


# ── POST /workspace — create new workspace ────────────────────────────────────

@router.post("", status_code=201)
async def create_new_workspace():
    workspace_id = create_workspace()
    meta = get_workspace_meta(workspace_id)
    return {
        "workspace_id": workspace_id,
        "created_at": meta.get("created_at"),
        "last_active": meta.get("last_active"),
    }


# ── GET /workspace/{workspace_id} — list all analyses ────────────────────────

@router.get("/{workspace_id}")
async def get_workspace(workspace_id: str):
    if not workspace_exists(workspace_id):
        raise HTTPException(404, "Workspace not found or expired.")
    touch_workspace(workspace_id)
    meta = get_workspace_meta(workspace_id)
    analyses = list_analyses(workspace_id)
    return {
        "workspace_id": workspace_id,
        "created_at": meta.get("created_at"),
        "last_active": meta.get("last_active"),
        "analyses": analyses,
    }


# ── POST /workspace/{workspace_id}/analyses — create analysis ─────────────────

@router.post("/{workspace_id}/analyses", status_code=201)
async def create_new_analysis(workspace_id: str, body: AnalysisCreate):
    if not workspace_exists(workspace_id):
        raise HTTPException(404, "Workspace not found or expired.")
    analysis_id = create_analysis(workspace_id, body.name)
    datasets = list_datasets(workspace_id, analysis_id)
    return {
        "id": analysis_id,
        "name": body.name,
        "datasets": datasets,
        "relationships": [],
        "chat_history": [],
        "insights": {},
    }
