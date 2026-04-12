import uuid as uuid_mod
from fastapi import APIRouter, HTTPException
from typing import Optional
from services.data_store import (
    get_dataset, get_first_dataset, list_datasets, delete_dataset,
    make_rel_id, load_rel_overrides, save_rel_overrides,
)
from services.health_check import analyze_dataset_health
from services.relationship_detector import detect_relationships
from models.schemas import PreviewResponse, RelationshipCreate, RelationshipUpdate

router = APIRouter()


@router.delete("/dataset")
async def remove_dataset(workspace_id: str, analysis_id: str, dataset: str):
    try:
        delete_dataset(workspace_id, analysis_id, dataset)
    except KeyError as e:
        raise HTTPException(404, str(e))
    return {"deleted": dataset, "datasets": list_datasets(workspace_id, analysis_id)}


@router.get("/preview", response_model=PreviewResponse)
async def preview_dataset(workspace_id: str, analysis_id: str, dataset: Optional[str] = None):
    try:
        if dataset:
            df = get_dataset(workspace_id, analysis_id, dataset)
        else:
            _, df = get_first_dataset(workspace_id, analysis_id)
    except KeyError as e:
        raise HTTPException(404, str(e))

    health_data = analyze_dataset_health(df)

    clean = df.replace({float("nan"): None, float("inf"): None, float("-inf"): None})
    for col in clean.columns:
        if hasattr(clean[col], "dt"):
            try:
                clean[col] = clean[col].dt.strftime("%Y-%m-%d")
            except Exception:
                pass

    preview_rows = clean.head(10).to_dict(orient="records")

    return PreviewResponse(
        columns=health_data["columns"],
        health=health_data["health"],
        rows=preview_rows,
        summary=health_data.get("summary"),
    )


@router.get("/rows")
async def get_rows(
    workspace_id: str,
    analysis_id: str,
    dataset: Optional[str] = None,
    page: int = 0,
    page_size: int = 50,
    search: str = "",
):
    """Return paginated, server-side-searched rows for the data viewer."""
    try:
        df = (
            get_dataset(workspace_id, analysis_id, dataset)
            if dataset
            else get_first_dataset(workspace_id, analysis_id)[1]
        )
    except KeyError as e:
        raise HTTPException(404, str(e))

    clean = df.replace({float("nan"): None, float("inf"): None, float("-inf"): None})
    for col in clean.columns:
        if hasattr(clean[col], "dt"):
            try:
                clean[col] = clean[col].dt.strftime("%Y-%m-%d")
            except Exception:
                pass

    if search:
        mask = clean.apply(
            lambda col: col.astype(str).str.contains(search, case=False, na=False)
        ).any(axis=1)
        filtered = clean[mask]
    else:
        filtered = clean

    total = len(filtered)
    total_pages = max(1, -(-total // page_size))  # ceiling division
    start = page * page_size
    rows = filtered.iloc[start: start + page_size].to_dict(orient="records")

    return {
        "rows": rows,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    }


@router.get("/list")
async def list_session_datasets(workspace_id: str, analysis_id: str):
    """Return all datasets in an analysis."""
    datasets = list_datasets(workspace_id, analysis_id)
    if not datasets:
        raise HTTPException(404, "Analysis not found or has no datasets")
    return {"workspace_id": workspace_id, "analysis_id": analysis_id, "datasets": datasets}


# ── Relationship helpers ───────────────────────────────────────────────────────

def _build_relationships(workspace_id: str, analysis_id: str) -> list[dict]:
    """Return merged list: auto-detected (with overrides/deletions applied) + manual additions."""
    dataset_list = list_datasets(workspace_id, analysis_id)
    overrides_data = load_rel_overrides(workspace_id, analysis_id)
    overrides: dict = overrides_data.get("overrides", {})
    additions: list = overrides_data.get("additions", [])
    deletions: set = set(overrides_data.get("deletions", []))

    auto_rels = []
    if len(dataset_list) >= 2:
        datasets = {}
        for meta in dataset_list:
            try:
                datasets[meta["name"]] = get_dataset(workspace_id, analysis_id, meta["name"])
            except KeyError:
                pass
        for r in detect_relationships(datasets):
            rid = make_rel_id(r["left_table"], r["left_column"], r["right_table"], r["right_column"])
            if rid in deletions:
                continue
            rel = {**r, "id": rid, "source": "auto"}
            if rid in overrides:
                rel = {**rel, **overrides[rid]}
            auto_rels.append(rel)

    return auto_rels + additions


# ── Relationships endpoints ────────────────────────────────────────────────────

@router.get("/relationships")
async def get_relationships(workspace_id: str, analysis_id: str):
    dataset_list = list_datasets(workspace_id, analysis_id)
    if not dataset_list:
        raise HTTPException(404, "Analysis not found or has no datasets")
    if len(dataset_list) < 2:
        return {"workspace_id": workspace_id, "analysis_id": analysis_id, "relationships": []}
    return {
        "workspace_id": workspace_id,
        "analysis_id": analysis_id,
        "relationships": _build_relationships(workspace_id, analysis_id),
    }


@router.post("/relationships", status_code=201)
async def add_relationship(workspace_id: str, analysis_id: str, body: RelationshipCreate):
    if not list_datasets(workspace_id, analysis_id):
        raise HTTPException(404, "Analysis not found")

    overrides_data = load_rel_overrides(workspace_id, analysis_id)
    new_rel = {
        "id": str(uuid_mod.uuid4())[:12],
        "left_table": body.left_table,
        "left_column": body.left_column,
        "right_table": body.right_table,
        "right_column": body.right_column,
        "confidence": 1.0,
        "match_type": "manual",
        "value_overlap": 0.0,
        "source": "manual",
    }
    overrides_data["additions"].append(new_rel)
    save_rel_overrides(workspace_id, analysis_id, overrides_data)
    return new_rel


@router.put("/relationships/{rel_id}")
async def update_relationship(workspace_id: str, analysis_id: str, rel_id: str, body: RelationshipUpdate):
    if not list_datasets(workspace_id, analysis_id):
        raise HTTPException(404, "Analysis not found")

    overrides_data = load_rel_overrides(workspace_id, analysis_id)
    updates = {k: v for k, v in body.model_dump().items() if v is not None}

    for i, rel in enumerate(overrides_data["additions"]):
        if rel["id"] == rel_id:
            overrides_data["additions"][i] = {**rel, **updates}
            save_rel_overrides(workspace_id, analysis_id, overrides_data)
            return overrides_data["additions"][i]

    existing = overrides_data["overrides"].get(rel_id, {})
    overrides_data["overrides"][rel_id] = {**existing, **updates, "match_type": "manual_edit"}
    save_rel_overrides(workspace_id, analysis_id, overrides_data)
    return {"id": rel_id, **overrides_data["overrides"][rel_id]}


@router.delete("/relationships/{rel_id}", status_code=204)
async def delete_relationship(workspace_id: str, analysis_id: str, rel_id: str):
    if not list_datasets(workspace_id, analysis_id):
        raise HTTPException(404, "Analysis not found")

    overrides_data = load_rel_overrides(workspace_id, analysis_id)

    orig_len = len(overrides_data["additions"])
    overrides_data["additions"] = [r for r in overrides_data["additions"] if r["id"] != rel_id]
    if len(overrides_data["additions"]) < orig_len:
        save_rel_overrides(workspace_id, analysis_id, overrides_data)
        return

    if rel_id not in overrides_data["deletions"]:
        overrides_data["deletions"].append(rel_id)
    overrides_data["overrides"].pop(rel_id, None)
    save_rel_overrides(workspace_id, analysis_id, overrides_data)
