import axios from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

const api = axios.create({ baseURL: API_URL });

// ── Workspace ─────────────────────────────────────────────────────────────────

export const createWorkspace = async () => api.post("/workspace");

export const getWorkspace = async (workspaceId: string) =>
  api.get(`/workspace/${workspaceId}`);

// ── Analysis CRUD ─────────────────────────────────────────────────────────────

export const createAnalysis = async (workspaceId: string, name: string = "New Analysis") =>
  api.post(`/workspace/${workspaceId}/analyses`, { name });

export const getAnalysis = async (analysisId: string) =>
  api.get(`/analysis/${analysisId}`);

export const renameAnalysis = async (analysisId: string, name: string) =>
  api.patch(`/analysis/${analysisId}`, { name });

export const deleteAnalysis = async (analysisId: string) =>
  api.delete(`/analysis/${analysisId}`);

// ── Upload ────────────────────────────────────────────────────────────────────

export const uploadCsv = async (file: File, workspaceId?: string, analysisId?: string) => {
  const formData = new FormData();
  formData.append("file", file);
  if (workspaceId) formData.append("workspace_id", workspaceId);
  if (analysisId) formData.append("analysis_id", analysisId);
  return api.post("/upload/csv", formData, {
    headers: { "Content-Type": "multipart/form-data" },
  });
};

export const uploadGsheet = async (url: string, workspaceId?: string, analysisId?: string) => {
  const params = new URLSearchParams();
  if (workspaceId) params.set("workspace_id", workspaceId);
  if (analysisId) params.set("analysis_id", analysisId);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return api.post(`/upload/gsheet${qs}`, { url });
};

// ── Dataset preview & rows ────────────────────────────────────────────────────

export const getPreview = async (workspaceId: string, analysisId: string, dataset?: string) => {
  const params = new URLSearchParams({ workspace_id: workspaceId, analysis_id: analysisId });
  if (dataset) params.set("dataset", dataset);
  return api.get(`/dataset/preview?${params}`);
};

export const listDatasets = async (workspaceId: string, analysisId: string) =>
  api.get(`/dataset/list?workspace_id=${workspaceId}&analysis_id=${analysisId}`);

export const deleteDataset = async (workspaceId: string, analysisId: string, dataset: string) =>
  api.delete(`/dataset/dataset?workspace_id=${workspaceId}&analysis_id=${analysisId}&dataset=${encodeURIComponent(dataset)}`);

export const getRows = async (
  workspaceId: string,
  analysisId: string,
  dataset: string,
  page: number = 0,
  pageSize: number = 50,
  search: string = ""
) => {
  const params = new URLSearchParams({
    workspace_id: workspaceId,
    analysis_id: analysisId,
    dataset,
    page: String(page),
    page_size: String(pageSize),
    search,
  });
  return api.get(`/dataset/rows?${params}`);
};

// ── Relationships ─────────────────────────────────────────────────────────────

export const getRelationships = async (workspaceId: string, analysisId: string) =>
  api.get(`/dataset/relationships?workspace_id=${workspaceId}&analysis_id=${analysisId}`);

export const addRelationship = async (
  workspaceId: string,
  analysisId: string,
  rel: { left_table: string; left_column: string; right_table: string; right_column: string }
) => api.post(`/dataset/relationships?workspace_id=${workspaceId}&analysis_id=${analysisId}`, rel);

export const updateRelationship = async (
  workspaceId: string,
  analysisId: string,
  relId: string,
  rel: { left_table?: string; left_column?: string; right_table?: string; right_column?: string }
) => api.put(`/dataset/relationships/${relId}?workspace_id=${workspaceId}&analysis_id=${analysisId}`, rel);

export const deleteRelationship = async (workspaceId: string, analysisId: string, relId: string) =>
  api.delete(`/dataset/relationships/${relId}?workspace_id=${workspaceId}&analysis_id=${analysisId}`);

// ── Insights ──────────────────────────────────────────────────────────────────

export const analyzeData = async (
  workspaceId: string,
  analysisId: string,
  dataset: string,
  model: string = "gemini-2.0-flash",
  extraDatasets: string[] = []
) =>
  api.post("/insights/analyze", {
    workspace_id: workspaceId,
    analysis_id: analysisId,
    dataset,
    extra_datasets: extraDatasets.filter((d) => d !== dataset),
    model,
  });

// ── Chat ──────────────────────────────────────────────────────────────────────

export const sendChatQuery = async (
  workspaceId: string,
  analysisId: string,
  dataset: string,
  question: string,
  history: Array<{ role: string; content: string }>,
  model: string = "gemini-2.0-flash",
  extraDatasets: string[] = []
) =>
  api.post("/chat/query", {
    workspace_id: workspaceId,
    analysis_id: analysisId,
    dataset,
    extra_datasets: extraDatasets.filter((d) => d !== dataset),
    question,
    history,
    model,
  });

// ── Models ────────────────────────────────────────────────────────────────────

export interface ModelDef {
  id: string;
  label: string;
  note: string;
  tier: "best" | "recommended" | "standard" | "fast";
}

export interface ProviderGroup {
  provider: string;
  color: string;
  connected: boolean;
  models: ModelDef[];
}

export const fetchModels = async (): Promise<ProviderGroup[]> => {
  const res = await api.get("/models");
  return res.data.providers as ProviderGroup[];
};
