from pydantic import BaseModel
from typing import Optional


class ColumnStat(BaseModel):
    min: Optional[float] = None
    max: Optional[float] = None
    mean: Optional[float] = None
    unique: int = 0
    top_values: list[str] = []  # top 3 values with counts e.g. ["Game On (22)", "Playfit (14)"]


class ColumnInfo(BaseModel):
    name: str
    dtype: str
    missing_pct: float
    stat: Optional[ColumnStat] = None


class KPI(BaseModel):
    label: str
    value: str
    sub: Optional[str] = None
    color: str = "blue"  # blue | green | amber | red


class DataSummary(BaseModel):
    sentence: str  # plain English e.g. "78 bookings across 4 areas..."
    kpis: list[KPI] = []


class HealthStats(BaseModel):
    total_rows: int
    total_columns: int
    duplicate_rows: int
    missing_cells: int
    missing_pct: float


class DatasetInfo(BaseModel):
    name: str
    row_count: int
    column_count: int
    columns: list[str]
    size_mb: float


class AnalysisInfo(BaseModel):
    id: str
    name: str
    created_at: Optional[float] = None
    dataset_count: int = 0
    datasets: list[DatasetInfo] = []


class UploadResponse(BaseModel):
    workspace_id: str
    analysis_id: str
    analysis_name: str
    uploaded: str           # name of the newly added dataset
    datasets: list[DatasetInfo]  # all datasets in this analysis after upload


class PreviewResponse(BaseModel):
    columns: list[ColumnInfo]
    rows: list[dict]
    health: HealthStats
    summary: Optional[DataSummary] = None
    all_rows: list[dict] = []  # full dataset for the data viewer


class ChatRequest(BaseModel):
    workspace_id: str
    analysis_id: str
    dataset: str                    # primary dataset
    extra_datasets: list[str] = []  # additional datasets available
    question: str
    history: list[dict] = []
    model: str = "gemini-2.0-flash"


class ChartSpec(BaseModel):
    type: str           # "bar" | "line" | "pie" | "table"
    title: str
    data: list[dict]
    xKey: str
    yKey: str
    xLabel: str
    yLabel: str


class ChatResponse(BaseModel):
    answer: str
    insight: str
    chart: Optional[ChartSpec] = None
    code_used: Optional[str] = None
    clarification: Optional[str] = None
    follow_up: list[str] = []
    throttled: bool = False


class RelationshipCreate(BaseModel):
    left_table: str
    left_column: str
    right_table: str
    right_column: str


class RelationshipUpdate(BaseModel):
    left_table: Optional[str] = None
    left_column: Optional[str] = None
    right_table: Optional[str] = None
    right_column: Optional[str] = None


class GSheetRequest(BaseModel):
    url: str


class InsightItem(BaseModel):
    title: str
    body: str
    type: str   # "trend" | "top_performer" | "anomaly" | "summary" | "opportunity"
    icon: str   # emoji


class InsightRequest(BaseModel):
    workspace_id: str
    analysis_id: str
    dataset: str
    extra_datasets: list[str] = []
    model: str = "gemini-2.0-flash"


class InsightResponse(BaseModel):
    insights: list[InsightItem]
    throttled: bool = False


class AnalysisCreate(BaseModel):
    name: str = "New Analysis"


class AnalysisUpdate(BaseModel):
    name: str


class ErrorResponse(BaseModel):
    detail: str
