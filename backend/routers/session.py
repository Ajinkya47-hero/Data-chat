from fastapi import APIRouter, HTTPException
from services.data_store import (
    create_session,
    session_exists,
    get_session_meta,
    touch_session,
    list_datasets,
    get_dataset,
    load_chat_history,
    load_insights,
    load_rel_overrides,
    make_rel_id,
    list_analyses,
    create_analysis,
    get_analysis_meta,
    rename_analysis,
    delete_analysis,
    analysis_exists,
)
from services.relationship_detector import detect_relationships
from models.schemas import AnalysisCreate, AnalysisUpdate

router = APIRouter()


def _build_relationships(session_id: str, analysis_id: str, dataset_list: list[dict]) -> list[dict]:
    """Return merged relationships (auto-detected + user overrides/additions)."""
    if len(dataset_list) < 2:
        return []

    ds_map: dict = {}
    for meta in dataset_list:
        try:
            ds_map[meta["name"]] = get_dataset(session_id, analysis_id, meta["name"])
        except KeyError:
            pass

    overrides_data = load_rel_overrides(session_id, analysis_id)
    overrides: dict = overrides_data.get("overrides", {})
    additions: list = overrides_data.get("additions", [])
    deletions: set = set(overrides_data.get("deletions", []))

    result: list[dict] = []
    for r in detect_relationships(ds_map):
        rid = make_rel_id(
            r["left_table"], r["left_column"],
            r["right_table"], r["right_column"],
        )
        if rid in deletions:
            continue
        rel = {**r, "id": rid, "source": "auto"}
        if rid in overrides:
            rel = {**rel, **overrides[rid]}
        result.append(rel)

    return result + additions


# ── POST /session — create a new empty session ────────────────────────────────

@router.post("", status_code=201)
async def create_new_session():
    """Create a new empty session and return its ID."""
    session_id = create_session()
    meta = get_session_meta(session_id)
    return {
        "session_id": session_id,
        "created_at": meta.get("created_at"),
        "last_active": meta.get("last_active"),
    }


# ── GET /session/{session_id} — list all analyses in session ──────────────────

@router.get("/{session_id}")
async def get_session(session_id: str):
    """
    Retrieve session state: list of analyses (with dataset metadata).
    Each analysis contains its full state on demand via the analysis sub-routes.
    """
    if not session_exists(session_id):
        raise HTTPException(status_code=404, detail="Session not found or expired.")

    touch_session(session_id)

    meta = get_session_meta(session_id)
    analyses = list_analyses(session_id)

    return {
        "session_id": session_id,
        "created_at": meta.get("created_at"),
        "last_active": meta.get("last_active"),
        "analyses": analyses,
    }


# ── POST /session/{session_id}/analyses — create a new analysis ───────────────

@router.post("/{session_id}/analyses", status_code=201)
async def create_new_analysis(session_id: str, body: AnalysisCreate):
    """Create a new empty analysis within an existing session."""
    if not session_exists(session_id):
        raise HTTPException(404, "Session not found or expired.")

    analysis_id = create_analysis(session_id, body.name)
    return await get_analysis(session_id, analysis_id)


# ── GET /session/{session_id}/analyses/{analysis_id} — full analysis state ────

@router.get("/{session_id}/analyses/{analysis_id}")
async def get_analysis(session_id: str, analysis_id: str):
    """
    Retrieve complete analysis state:
    - datasets metadata
    - relationships
    - chat history
    - insights
    """
    if not session_exists(session_id):
        raise HTTPException(404, "Session not found or expired.")
    if not analysis_exists(session_id, analysis_id):
        raise HTTPException(404, "Analysis not found.")

    touch_session(session_id)

    meta = get_analysis_meta(session_id, analysis_id)
    datasets = list_datasets(session_id, analysis_id)
    relationships = _build_relationships(session_id, analysis_id, datasets)
    chat_history = load_chat_history(session_id, analysis_id)
    insights = load_insights(session_id, analysis_id)

    return {
        "id": analysis_id,
        "name": meta.get("name", "Analysis"),
        "created_at": meta.get("created_at"),
        "datasets": datasets,
        "relationships": relationships,
        "chat_history": chat_history,
        "insights": insights,
    }


# ── PATCH /session/{session_id}/analyses/{analysis_id} — rename ───────────────

@router.patch("/{session_id}/analyses/{analysis_id}")
async def update_analysis(session_id: str, analysis_id: str, body: AnalysisUpdate):
    """Rename an analysis."""
    if not session_exists(session_id):
        raise HTTPException(404, "Session not found or expired.")
    if not analysis_exists(session_id, analysis_id):
        raise HTTPException(404, "Analysis not found.")

    rename_analysis(session_id, analysis_id, body.name)
    return {"id": analysis_id, "name": body.name}


# ── DELETE /session/{session_id}/analyses/{analysis_id} — delete ──────────────

@router.delete("/{session_id}/analyses/{analysis_id}", status_code=204)
async def remove_analysis(session_id: str, analysis_id: str):
    """Delete an analysis and all its data."""
    if not session_exists(session_id):
        raise HTTPException(404, "Session not found or expired.")
    if not analysis_exists(session_id, analysis_id):
        raise HTTPException(404, "Analysis not found.")

    # Prevent deleting the last analysis
    remaining = list_analyses(session_id)
    if len(remaining) <= 1:
        raise HTTPException(400, "Cannot delete the only analysis in a session.")

    delete_analysis(session_id, analysis_id)
