import os
import uuid
import json
import time
import hashlib
import shutil
import pandas as pd
from pathlib import Path
from typing import Any

WORKSPACE_DIR = Path("./workspaces")
WORKSPACE_DIR.mkdir(exist_ok=True)

# Global index: analysis_id → workspace_id (enables GET /analysis/{id})
_ANALYSIS_INDEX_PATH = WORKSPACE_DIR / ".analysis_index.json"

MAX_WORKSPACE_AGE_SECONDS = int(os.environ.get("SESSION_TTL_HOURS", 24)) * 60 * 60
MAX_FILE_SIZE_MB = int(os.environ.get("MAX_UPLOAD_MB", 50))


# ── Workspace paths ────────────────────────────────────────────────────────────

def _workspace_dir(workspace_id: str) -> Path:
    return WORKSPACE_DIR / workspace_id

def _workspace_meta_path(workspace_id: str) -> Path:
    return _workspace_dir(workspace_id) / ".workspace.json"

def _analyses_dir(workspace_id: str) -> Path:
    return _workspace_dir(workspace_id) / "analyses"


# ── Analysis paths ─────────────────────────────────────────────────────────────

def _analysis_dir(workspace_id: str, analysis_id: str) -> Path:
    return _analyses_dir(workspace_id) / analysis_id

def _analysis_meta_path(workspace_id: str, analysis_id: str) -> Path:
    return _analysis_dir(workspace_id, analysis_id) / ".analysis.json"

def _datasets_dir(workspace_id: str, analysis_id: str) -> Path:
    return _analysis_dir(workspace_id, analysis_id) / "datasets"

def _dataset_path(workspace_id: str, analysis_id: str, name: str) -> Path:
    return _datasets_dir(workspace_id, analysis_id) / f"{name}.parquet"

def _relationships_path(workspace_id: str, analysis_id: str) -> Path:
    return _analysis_dir(workspace_id, analysis_id) / ".relationships.json"

def _chat_history_path(workspace_id: str, analysis_id: str) -> Path:
    return _analysis_dir(workspace_id, analysis_id) / ".chat_history.json"

def _insights_path(workspace_id: str, analysis_id: str) -> Path:
    return _analysis_dir(workspace_id, analysis_id) / ".insights.json"


def make_rel_id(left_table: str, left_col: str, right_table: str, right_col: str) -> str:
    """Stable hash ID for an auto-detected relationship pair."""
    parts = sorted([f"{left_table}.{left_col}", f"{right_table}.{right_col}"])
    return hashlib.sha256("|".join(parts).encode()).hexdigest()[:12]


# ── Global analysis index ──────────────────────────────────────────────────────

def _load_analysis_index() -> dict[str, str]:
    """Return {analysis_id: workspace_id}."""
    if not _ANALYSIS_INDEX_PATH.exists():
        return {}
    try:
        with open(_ANALYSIS_INDEX_PATH) as f:
            return json.load(f)
    except Exception:
        return {}


def _save_analysis_index(index: dict[str, str]) -> None:
    try:
        with open(_ANALYSIS_INDEX_PATH, "w") as f:
            json.dump(index, f)
    except Exception:
        pass


def register_analysis(workspace_id: str, analysis_id: str) -> None:
    """Add analysis_id → workspace_id to the global index."""
    index = _load_analysis_index()
    index[analysis_id] = workspace_id
    _save_analysis_index(index)


def unregister_analysis(analysis_id: str) -> None:
    """Remove an analysis from the global index."""
    index = _load_analysis_index()
    index.pop(analysis_id, None)
    _save_analysis_index(index)


def lookup_analysis_workspace(analysis_id: str) -> str | None:
    """Return the workspace_id that owns this analysis, or None."""
    return _load_analysis_index().get(analysis_id)


# ── Workspace lifecycle ────────────────────────────────────────────────────────

def workspace_exists(workspace_id: str) -> bool:
    d = _workspace_dir(workspace_id)
    return d.exists() and _workspace_meta_path(workspace_id).exists()


def touch_workspace(workspace_id: str) -> None:
    """Update last_active timestamp and bump the .meta file mtime for TTL."""
    d = _workspace_dir(workspace_id)
    d.mkdir(parents=True, exist_ok=True)
    (d / ".meta").touch()
    meta_path = _workspace_meta_path(workspace_id)
    try:
        data = {}
        if meta_path.exists():
            with open(meta_path) as f:
                data = json.load(f)
        data["last_active"] = time.time()
        with open(meta_path, "w") as f:
            json.dump(data, f)
    except Exception:
        pass


def _is_expired(workspace_id: str) -> bool:
    d = _workspace_dir(workspace_id)
    if not d.exists():
        return True
    candidates = list(d.glob(".meta"))
    if not candidates:
        meta = _workspace_meta_path(workspace_id)
        if meta.exists():
            return time.time() - meta.stat().st_mtime > MAX_WORKSPACE_AGE_SECONDS
        return True
    newest = max(f.stat().st_mtime for f in candidates)
    return time.time() - newest > MAX_WORKSPACE_AGE_SECONDS


def create_workspace() -> str:
    """Create a new empty workspace and return the workspace_id."""
    workspace_id = str(uuid.uuid4())
    d = _workspace_dir(workspace_id)
    d.mkdir(parents=True, exist_ok=True)
    _analyses_dir(workspace_id).mkdir(parents=True, exist_ok=True)
    now = time.time()
    with open(_workspace_meta_path(workspace_id), "w") as f:
        json.dump({"workspace_id": workspace_id, "created_at": now, "last_active": now}, f)
    (d / ".meta").touch()
    return workspace_id


def get_workspace_meta(workspace_id: str) -> dict:
    path = _workspace_meta_path(workspace_id)
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {"workspace_id": workspace_id, "created_at": None, "last_active": None}


# ── Analysis lifecycle ─────────────────────────────────────────────────────────

def create_analysis(workspace_id: str, name: str = "Analysis 1") -> str:
    """Create a new analysis within a workspace and return its analysis_id."""
    if not workspace_exists(workspace_id):
        d = _workspace_dir(workspace_id)
        d.mkdir(parents=True, exist_ok=True)
        _analyses_dir(workspace_id).mkdir(parents=True, exist_ok=True)
        now = time.time()
        with open(_workspace_meta_path(workspace_id), "w") as f:
            json.dump({"workspace_id": workspace_id, "created_at": now, "last_active": now}, f)
        (d / ".meta").touch()

    analysis_id = str(uuid.uuid4())
    adir = _analysis_dir(workspace_id, analysis_id)
    adir.mkdir(parents=True, exist_ok=True)
    _datasets_dir(workspace_id, analysis_id).mkdir(parents=True, exist_ok=True)

    now = time.time()
    with open(_analysis_meta_path(workspace_id, analysis_id), "w") as f:
        json.dump({"id": analysis_id, "workspace_id": workspace_id, "name": name, "created_at": now}, f)

    register_analysis(workspace_id, analysis_id)
    touch_workspace(workspace_id)
    return analysis_id


def get_analysis_meta(workspace_id: str, analysis_id: str) -> dict:
    path = _analysis_meta_path(workspace_id, analysis_id)
    if path.exists():
        try:
            with open(path) as f:
                return json.load(f)
        except Exception:
            pass
    return {"id": analysis_id, "workspace_id": workspace_id, "name": "Analysis", "created_at": None}


def rename_analysis(workspace_id: str, analysis_id: str, name: str) -> None:
    path = _analysis_meta_path(workspace_id, analysis_id)
    data = get_analysis_meta(workspace_id, analysis_id)
    data["name"] = name
    with open(path, "w") as f:
        json.dump(data, f)
    touch_workspace(workspace_id)


def delete_analysis(workspace_id: str, analysis_id: str) -> None:
    adir = _analysis_dir(workspace_id, analysis_id)
    if adir.exists():
        shutil.rmtree(adir)
    unregister_analysis(analysis_id)
    touch_workspace(workspace_id)


def analysis_exists(workspace_id: str, analysis_id: str) -> bool:
    return _analysis_meta_path(workspace_id, analysis_id).exists()


def list_analyses(workspace_id: str) -> list[dict]:
    """Return all analyses within a workspace, sorted by creation time."""
    if not workspace_exists(workspace_id):
        return []
    analyses_dir = _analyses_dir(workspace_id)
    if not analyses_dir.exists():
        return []

    result = []
    dirs = sorted(
        [p for p in analyses_dir.iterdir() if p.is_dir()],
        key=lambda p: p.stat().st_ctime,
    )
    for adir in dirs:
        analysis_id = adir.name
        meta = get_analysis_meta(workspace_id, analysis_id)
        datasets = list_datasets(workspace_id, analysis_id)
        result.append({
            **meta,
            "dataset_count": len(datasets),
            "datasets": datasets,
        })
    return result


# ── Relationship helpers ───────────────────────────────────────────────────────

def load_rel_overrides(workspace_id: str, analysis_id: str) -> dict:
    path = _relationships_path(workspace_id, analysis_id)
    if not path.exists():
        return {"overrides": {}, "additions": [], "deletions": []}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {"overrides": {}, "additions": [], "deletions": []}


def save_rel_overrides(workspace_id: str, analysis_id: str, data: dict) -> None:
    _analysis_dir(workspace_id, analysis_id).mkdir(parents=True, exist_ok=True)
    with open(_relationships_path(workspace_id, analysis_id), "w") as f:
        json.dump(data, f, indent=2)


# ── Chat history ───────────────────────────────────────────────────────────────

def save_chat_message(workspace_id: str, analysis_id: str, user_msg: dict, assistant_msg: dict) -> None:
    path = _chat_history_path(workspace_id, analysis_id)
    history: list = []
    if path.exists():
        try:
            with open(path) as f:
                history = json.load(f)
        except Exception:
            history = []
    history.append(user_msg)
    history.append(assistant_msg)
    try:
        with open(path, "w") as f:
            json.dump(history, f)
    except Exception:
        pass


def load_chat_history(workspace_id: str, analysis_id: str) -> list[dict]:
    path = _chat_history_path(workspace_id, analysis_id)
    if not path.exists():
        return []
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return []


# ── Insights ───────────────────────────────────────────────────────────────────

def save_insights(workspace_id: str, analysis_id: str, dataset: str, insights: list[dict]) -> None:
    path = _insights_path(workspace_id, analysis_id)
    data: dict = {}
    if path.exists():
        try:
            with open(path) as f:
                data = json.load(f)
        except Exception:
            data = {}
    data[dataset] = {"insights": insights, "generated_at": time.time()}
    try:
        with open(path, "w") as f:
            json.dump(data, f)
    except Exception:
        pass


def load_insights(workspace_id: str, analysis_id: str) -> dict:
    path = _insights_path(workspace_id, analysis_id)
    if not path.exists():
        return {}
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


# ── Write ──────────────────────────────────────────────────────────────────────

def save_dataset(workspace_id: str, analysis_id: str, name: str, df: pd.DataFrame) -> None:
    size_mb = df.memory_usage(deep=True).sum() / 1e6
    if size_mb > MAX_FILE_SIZE_MB:
        raise ValueError(f"Dataset too large: {size_mb:.1f} MB (max {MAX_FILE_SIZE_MB} MB)")

    d = _datasets_dir(workspace_id, analysis_id)
    d.mkdir(parents=True, exist_ok=True)

    path = _dataset_path(workspace_id, analysis_id, name)
    if path.exists():
        raise ValueError(f"A dataset named '{name}' already exists in this analysis.")

    df.to_parquet(path, index=False)


# ── Read ───────────────────────────────────────────────────────────────────────

def get_dataset(workspace_id: str, analysis_id: str, name: str) -> pd.DataFrame:
    if _is_expired(workspace_id):
        _delete_workspace(workspace_id)
        raise KeyError(f"Workspace {workspace_id} has expired")
    path = _dataset_path(workspace_id, analysis_id, name)
    if not path.exists():
        raise KeyError(f"Dataset '{name}' not found in analysis {analysis_id}")
    return pd.read_parquet(path)


def list_datasets(workspace_id: str, analysis_id: str) -> list[dict[str, Any]]:
    if not workspace_exists(workspace_id):
        return []
    if _is_expired(workspace_id):
        _delete_workspace(workspace_id)
        return []
    d = _datasets_dir(workspace_id, analysis_id)
    if not d.exists():
        return []
    result = []
    for f in sorted(d.glob("*.parquet"), key=lambda p: p.stat().st_mtime):
        df = pd.read_parquet(f)
        result.append({
            "name": f.stem,
            "row_count": len(df),
            "column_count": len(df.columns),
            "columns": list(df.columns),
            "size_mb": round(f.stat().st_size / 1e6, 2),
        })
    return result


def get_first_dataset(workspace_id: str, analysis_id: str) -> tuple[str, pd.DataFrame]:
    datasets = list_datasets(workspace_id, analysis_id)
    if not datasets:
        raise KeyError(f"No datasets found in analysis {analysis_id}")
    name = datasets[0]["name"]
    return name, get_dataset(workspace_id, analysis_id, name)


def delete_dataset(workspace_id: str, analysis_id: str, name: str) -> None:
    """Remove a single dataset file from an analysis."""
    path = _dataset_path(workspace_id, analysis_id, name)
    if not path.exists():
        raise KeyError(f"Dataset '{name}' not found in analysis {analysis_id}")
    path.unlink()


# ── Delete / Purge ─────────────────────────────────────────────────────────────

def _delete_workspace(workspace_id: str) -> None:
    d = _workspace_dir(workspace_id)
    if d.exists():
        # Unregister all analyses before deleting
        for adir in (_analyses_dir(workspace_id)).glob("*"):
            if adir.is_dir():
                unregister_analysis(adir.name)
        shutil.rmtree(d, ignore_errors=True)


def purge_expired() -> None:
    """Remove stale workspaces. Call on startup and periodically."""
    now = time.time()
    for wdir in WORKSPACE_DIR.iterdir():
        if not wdir.is_dir():
            continue
        candidates = list(wdir.glob(".meta"))
        if not candidates:
            meta = wdir / ".workspace.json"
            if meta.exists():
                if now - meta.stat().st_mtime > MAX_WORKSPACE_AGE_SECONDS:
                    _delete_workspace(wdir.name)
            else:
                shutil.rmtree(wdir, ignore_errors=True)
            continue
        newest = max(f.stat().st_mtime for f in candidates)
        if now - newest > MAX_WORKSPACE_AGE_SECONDS:
            _delete_workspace(wdir.name)
