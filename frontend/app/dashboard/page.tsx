"use client";

import { useEffect, useState, useRef } from "react";
import { getPreview, getWorkspace, getAnalysis, createAnalysis, renameAnalysis, deleteAnalysis, deleteDataset } from "@/lib/api";
import { useRouter } from "next/navigation";
import DataPreview from "@/components/DataPreview";
import ChatPanel from "@/components/ChatPanel";
import DatasetManager, { DatasetMeta } from "@/components/DatasetManager";
import {
  Home, BarChart2, Layers, Sparkles, GitFork, Plus, Share2,
  Copy, Check, X, Link2, Pencil, Trash2, Database,
  ChevronRight, ChevronLeft, Loader2, MoreHorizontal,
} from "lucide-react";
import AutoInsightsPanel from "@/components/AutoInsightsPanel";
import SchemaMap from "@/components/SchemaMap";
import AddDatasetModal from "@/components/AddDatasetModal";
import { trackSwitchAnalysis, trackShareAnalysis, trackSessionRestored } from "@/lib/analytics";

type PanelView = "preview" | "datasets" | "schema";

interface AnalysisMeta {
  id: string;
  name: string;
  created_at: number;
  dataset_count: number;
  datasets: DatasetMeta[];
}

export default function Dashboard() {
  const [analyses, setAnalyses] = useState<AnalysisMeta[]>([]);
  const [activeAnalysisId, setActiveAnalysisId] = useState<string>("");
  const [switchingId, setSwitchingId] = useState<string | null>(null); // loading indicator

  // Per-active-analysis state
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [primaryDataset, setPrimaryDataset] = useState<string>("");
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [restoredMessages, setRestoredMessages] = useState<any[]>([]);
  const [cachedInsights, setCachedInsights] = useState<Record<string, any>>({});
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewLoading, setPreviewLoading] = useState(true);

  const [panelView, setPanelView] = useState<PanelView>("preview");
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [addDatasetOpen, setAddDatasetOpen] = useState(false);
  const [chatModel, setChatModel] = useState("llama-3.3-70b-versatile");
  const [externalQuestion, setExternalQuestion] = useState<string | null>(null);
  // Per-analysis share modal — stores the analysis id being shared (null = closed)
  const [shareAnalysisId, setShareAnalysisId] = useState<string | null>(null);

  // Inline rename state
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Options menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Sidebar collapse
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Prevent the activeAnalysisId useEffect from re-fetching after creating a fresh analysis
  const skipNextFetchRef = useRef(false);

  // Remember dataset selection per analysis so switching back restores it
  const analysisSelectionsRef = useRef<Map<string, { primary: string; selected: string[] }>>(new Map());

  const router = useRouter();
  const workspaceId = typeof window !== "undefined" ? (localStorage.getItem("workspace_id") ?? "") : "";

  // ── Load session on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (!workspaceId) { router.push("/upload"); return; }

    getWorkspace(workspaceId)
      .then((res) => {
        const list: AnalysisMeta[] = res.data.analyses ?? [];
        if (list.length === 0) { router.push("/upload"); return; }
        setAnalyses(list);
        trackSessionRestored();
        // Respect active_analysis_id set by a share-link restore
        const targetId = localStorage.getItem("active_analysis_id");
        localStorage.removeItem("active_analysis_id");
        const initial = list.find((a) => a.id === targetId) ?? list[0];
        setActiveAnalysisId(initial.id);
      })
      .catch(() => {
        localStorage.removeItem("workspace_id");
        router.push("/upload");
      });
  }, [router]);

  // ── Load full analysis state when active analysis changes ─────────────────
  useEffect(() => {
    if (!activeAnalysisId || !workspaceId) return;
    // Skip fetch when we just created a new empty analysis — state is already set
    if (skipNextFetchRef.current) { skipNextFetchRef.current = false; return; }

    setPreviewData(null);
    setPreviewLoading(true);
    setRestoredMessages([]);
    setCachedInsights({});

    getAnalysis(activeAnalysisId)
      .then((res) => {
        const { datasets: list, chat_history, insights } = res.data;
        const typedList: DatasetMeta[] = list ?? [];

        if (typedList.length === 0) {
          setDatasets([]);
          setPrimaryDataset("");
          setSelectedDatasets([]);
          setPreviewLoading(false);
          return;
        }

        setDatasets(typedList);

        // Restore saved selection if available and still valid, otherwise default to first
        const saved = analysisSelectionsRef.current.get(activeAnalysisId);
        const validNames = new Set(typedList.map((d) => d.name));
        if (saved && validNames.has(saved.primary)) {
          setPrimaryDataset(saved.primary);
          setSelectedDatasets(saved.selected.filter((n) => validNames.has(n)));
        } else {
          setPrimaryDataset(typedList[0].name);
          setSelectedDatasets([typedList[0].name]);
        }

        if (chat_history?.length > 0) setRestoredMessages(chat_history);
        if (insights && Object.keys(insights).length > 0) setCachedInsights(insights);
      })
      .catch(() => setPreviewLoading(false))
      .finally(() => setSwitchingId(null));
  }, [activeAnalysisId, workspaceId]);

  // ── Reload preview when primary dataset changes ───────────────────────────
  useEffect(() => {
    if (!primaryDataset || !workspaceId || !activeAnalysisId) return;
    setPreviewLoading(true);
    getPreview(workspaceId, activeAnalysisId, primaryDataset)
      .then((res) => { setPreviewData(res.data); setPreviewLoading(false); })
      .catch(() => setPreviewLoading(false));
  }, [primaryDataset, workspaceId, activeAnalysisId]);

  // ── Focus rename input ────────────────────────────────────────────────────
  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  // ── Close options menu on outside click ───────────────────────────────────
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleSwitchAnalysis = (id: string) => {
    if (id === activeAnalysisId || switchingId) return;
    // Save current selection before leaving this analysis
    if (activeAnalysisId && primaryDataset) {
      analysisSelectionsRef.current.set(activeAnalysisId, {
        primary: primaryDataset,
        selected: selectedDatasets,
      });
    }
    // Clear all per-analysis state synchronously so components remount clean
    setDatasets([]);
    setPrimaryDataset("");
    setSelectedDatasets([]);
    setRestoredMessages([]);
    setCachedInsights({});
    setPreviewData(null);
    setSwitchingId(id);
    setActiveAnalysisId(id);
    setOpenMenuId(null);
    trackSwitchAnalysis({ analysis_id: id });
  };

  const handleSetPrimary = (name: string) => {
    setPrimaryDataset(name);
    if (!selectedDatasets.includes(name)) setSelectedDatasets((prev) => [...prev, name]);
    setPanelView("preview");
  };

  const handleSelectionChange = (next: string[]) => {
    setSelectedDatasets(next);
    if (!next.includes(primaryDataset) && next.length > 0) setPrimaryDataset(next[0]);
  };

  const handleGoHome = () => router.push("/");

  const handleShareAnalysis = (analysisId: string) => {
    setShareAnalysisId(analysisId);
    trackShareAnalysis({ analysis_id: analysisId });
  };

  const handleAddDatasetSuccess = (newList: DatasetMeta[]) => {
    setDatasets(newList);
    setAnalyses((prev) =>
      prev.map((a) => a.id === activeAnalysisId ? { ...a, datasets: newList, dataset_count: newList.length } : a)
    );
    if (!primaryDataset && newList.length > 0) {
      setPrimaryDataset(newList[0].name);
      setSelectedDatasets([newList[0].name]);
    }
  };

  const handleDeleteDataset = async (name: string) => {
    try {
      const res = await deleteDataset(workspaceId, activeAnalysisId, name);
      const newList: DatasetMeta[] = res.data.datasets ?? [];
      setDatasets(newList);
      setAnalyses((prev) =>
        prev.map((a) => a.id === activeAnalysisId ? { ...a, datasets: newList, dataset_count: newList.length } : a)
      );
      // Fix selection if deleted dataset was selected/primary
      const remaining = newList.map((d) => d.name);
      if (name === primaryDataset) {
        setPrimaryDataset(remaining[0] ?? "");
      }
      setSelectedDatasets((prev) => {
        const next = prev.filter((n) => remaining.includes(n));
        return next.length > 0 ? next : remaining.slice(0, 1);
      });
    } catch {
      // silently fail — dataset may already be gone
    }
  };

  // ── Analysis sidebar actions ──────────────────────────────────────────────

  const handleCreateAnalysis = () => router.push("/upload");

  const handleStartRename = (a: AnalysisMeta, e: React.MouseEvent) => {
    e.stopPropagation();
    setRenamingId(a.id);
    setRenameValue(a.name);
  };

  const handleCommitRename = async () => {
    if (!renamingId || !renameValue.trim()) { setRenamingId(null); return; }
    const trimmed = renameValue.trim();
    setAnalyses((prev) => prev.map((a) => a.id === renamingId ? { ...a, name: trimmed } : a));
    setRenamingId(null);
    await renameAnalysis(renamingId, trimmed).catch(() => {});
  };

  const handleDeleteAnalysis = async (analysisId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (analyses.length <= 1) return;
    if (!confirm("Delete this analysis and all its data?")) return;
    await deleteAnalysis(analysisId).catch(() => {});
    const next = analyses.filter((a) => a.id !== analysisId);
    setAnalyses(next);
    if (activeAnalysisId === analysisId) handleSwitchAnalysis(next[0].id);
  };

  // ── Render guards ─────────────────────────────────────────────────────────

  if (analyses.length === 0) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-neutral-50 gap-4">
        <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
        <p className="text-sm font-bold text-neutral-400 uppercase tracking-widest animate-pulse">Loading…</p>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-neutral-50 overflow-hidden">

      {/* ════════════════════════════════════════════════════════════════════
          LEFT SIDEBAR — Analysis navigation (collapsible)
      ════════════════════════════════════════════════════════════════════ */}
      <aside className={`shrink-0 flex flex-col bg-white border-r border-neutral-100 h-full transition-all duration-200 ${sidebarCollapsed ? "w-14" : "w-56"}`}>

        {/* Logo + collapse toggle */}
        {sidebarCollapsed ? (
          <div className="shrink-0 flex flex-col items-center gap-1.5 py-3 border-b border-neutral-100">
            <div className="w-8 h-8 bg-gradient-to-br from-primary to-blue-600 rounded-xl flex items-center justify-center shadow shadow-primary/20">
              <span className="text-white font-black text-base">D</span>
            </div>
            <button
              onClick={() => setSidebarCollapsed(false)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors"
              title="Expand sidebar"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="shrink-0 flex items-center justify-between gap-2 h-[60px] px-3 border-b border-neutral-100">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 bg-gradient-to-br from-primary to-blue-600 rounded-xl flex items-center justify-center shadow shadow-primary/20 shrink-0">
                <span className="text-white font-black text-base">D</span>
              </div>
              <span className="text-lg font-black tracking-tighter text-neutral-900 whitespace-nowrap">
                Data<span className="text-primary italic">Chat</span>
              </span>
            </div>
            <button
              onClick={() => setSidebarCollapsed(true)}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors shrink-0"
              title="Collapse sidebar"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Section label */}
        {!sidebarCollapsed && (
          <div className="shrink-0 px-4 pt-4 pb-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-neutral-400">Analyses</p>
          </div>
        )}

        {/* Analysis list — scrollable */}
        <div className="flex-1 overflow-y-auto py-2 flex flex-col gap-0.5 px-2">
          {analyses.map((a) => {
            const isActive = a.id === activeAnalysisId;
            const isSwitching = switchingId === a.id;
            const isRenaming = renamingId === a.id;
            const menuOpen = openMenuId === a.id;

            return (
              <div
                key={a.id}
                onClick={() => !isRenaming && !menuOpen && handleSwitchAnalysis(a.id)}
                title={sidebarCollapsed ? a.name : undefined}
                className={`group relative flex items-center rounded-xl cursor-pointer transition-all ${
                  sidebarCollapsed ? "justify-center p-2" : "gap-2 px-3 py-2.5"
                } ${
                  isActive
                    ? "bg-primary/8 text-primary"
                    : "text-neutral-600 hover:bg-neutral-50 hover:text-neutral-800"
                }`}
              >
                {/* Icon */}
                <div className={`shrink-0 w-6 h-6 rounded-lg flex items-center justify-center transition-colors ${
                  isActive ? "bg-primary/15" : "bg-neutral-100 group-hover:bg-neutral-200"
                }`}>
                  {isSwitching
                    ? <Loader2 className="w-3 h-3 animate-spin text-primary" />
                    : <Database className={`w-3 h-3 ${isActive ? "text-primary" : "text-neutral-500"}`} />
                  }
                </div>

                {/* Name + dataset count + options — hidden when collapsed */}
                {!sidebarCollapsed && (
                  <>
                    <div className="flex-1 min-w-0">
                      {isRenaming ? (
                        <input
                          ref={renameInputRef}
                          value={renameValue}
                          onChange={(e) => setRenameValue(e.target.value)}
                          onBlur={handleCommitRename}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") handleCommitRename();
                            if (e.key === "Escape") setRenamingId(null);
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-white border border-primary/30 rounded px-1.5 py-0.5 text-xs font-semibold text-neutral-800 outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      ) : (
                        <p className={`text-[13px] font-semibold truncate leading-tight ${isActive ? "text-primary" : ""}`}>
                          {a.name}
                        </p>
                      )}
                      {!isRenaming && (
                        <p className="text-[10px] text-neutral-400 mt-0.5">
                          {a.dataset_count} dataset{a.dataset_count !== 1 ? "s" : ""}
                        </p>
                      )}
                    </div>

                    {/* ⋯ options button */}
                    {!isRenaming && !isSwitching && (
                      <div className="relative" ref={menuOpen ? menuRef : undefined}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(menuOpen ? null : a.id);
                          }}
                          className={`w-6 h-6 flex items-center justify-center rounded-lg transition-colors ${
                            menuOpen
                              ? "bg-neutral-100 text-neutral-700"
                              : "opacity-0 group-hover:opacity-100 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600"
                          }`}
                          title="More options"
                        >
                          <MoreHorizontal className="w-3.5 h-3.5" />
                        </button>

                        {menuOpen && (
                          <div className="absolute right-0 top-7 z-50 w-36 bg-white rounded-xl shadow-lg border border-neutral-100 py-1 overflow-hidden">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(null);
                                handleStartRename(a, e);
                              }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5 text-neutral-400" />
                              Rename
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setOpenMenuId(null);
                                handleShareAnalysis(a.id);
                              }}
                              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 transition-colors"
                            >
                              <Share2 className="w-3.5 h-3.5 text-neutral-400" />
                              Share
                            </button>
                            {analyses.length > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuId(null);
                                  handleDeleteAnalysis(a.id, e);
                                }}
                                className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                Delete
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>

        {/* New analysis button */}
        <div className={`shrink-0 py-3 border-t border-neutral-100 ${sidebarCollapsed ? "flex justify-center px-2" : "px-2"}`}>
          <button
            onClick={handleCreateAnalysis}
            title="New Analysis"
            className={`flex items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-200 text-neutral-400 hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all font-bold text-xs ${
              sidebarCollapsed ? "w-10 h-10" : "w-full px-3 py-2.5"
            }`}
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            {!sidebarCollapsed && "New Analysis"}
          </button>
        </div>

        {/* Bottom actions */}
        <div className={`shrink-0 pb-4 flex flex-col gap-1 ${sidebarCollapsed ? "px-1 items-center" : "px-2"}`}>
          <button
            onClick={handleGoHome}
            title="Home"
            className={`flex items-center gap-2 rounded-xl text-neutral-500 hover:text-neutral-700 hover:bg-neutral-100 transition-all font-semibold text-xs ${
              sidebarCollapsed ? "w-10 h-10 justify-center" : "w-full px-3 py-2"
            }`}
          >
            <Home className="w-3.5 h-3.5 shrink-0" />
            {!sidebarCollapsed && "Home"}
          </button>
        </div>
      </aside>

      {/* ════════════════════════════════════════════════════════════════════
          MAIN CONTENT AREA
      ════════════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col flex-1 min-w-0 h-full p-4 lg:p-5 gap-4 overflow-hidden">

        {/* ── Top header bar ── */}
        <header className="shrink-0 flex items-center justify-between px-1">
          <div className="flex items-center gap-3">
            {/* Active analysis name */}
            <div>
              <h1 className="text-xl font-black tracking-tight text-neutral-900 leading-none">
                {analyses.find((a) => a.id === activeAnalysisId)?.name ?? ""}
              </h1>
              {datasets.length > 0 && (
                <p className="text-[11px] text-neutral-400 mt-0.5 font-medium">
                  {datasets.length} dataset{datasets.length !== 1 ? "s" : ""}
                  {previewData && ` · ${previewData.health.total_rows.toLocaleString()} rows`}
                  {selectedDatasets.length > 1 && ` · ${selectedDatasets.length} in chat`}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setInsightsOpen(true)}
              disabled={!primaryDataset}
              className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-500 to-blue-500 hover:from-violet-600 hover:to-blue-600 text-white font-bold text-xs uppercase tracking-widest rounded-2xl shadow-lg shadow-violet-200 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-4 h-4" />
              Analyze
            </button>
            <button
              onClick={() => handleShareAnalysis(activeAnalysisId)}
              disabled={!activeAnalysisId}
              className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-emerald-50 text-emerald-600 font-bold text-xs uppercase tracking-widest rounded-2xl border border-emerald-200 shadow-sm transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Share2 className="w-4 h-4" />
              Share
            </button>
            <button
              onClick={() => setAddDatasetOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-primary/5 text-primary font-bold text-xs uppercase tracking-widest rounded-2xl border border-primary/20 shadow-sm transition-all active:scale-95"
            >
              <Plus className="w-4 h-4" />
              Add Dataset
            </button>
          </div>
        </header>

        {/* ── Main layout: left panel + chat ── */}
        <div className="flex flex-1 gap-5 min-h-0">

          {/* ── Left panel ── */}
          <aside className="w-[340px] shrink-0 bg-white rounded-[2rem] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.08)] border border-neutral-100 flex flex-col overflow-hidden">

            {/* Panel tab switcher */}
            <div className="shrink-0 flex border-b border-neutral-100 px-3 pt-2 gap-0.5">
              {(["preview", "datasets", "schema"] as PanelView[]).map((v) => (
                <button
                  key={v}
                  onClick={() => setPanelView(v)}
                  className={`flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold rounded-t-xl transition-colors capitalize ${
                    panelView === v
                      ? v === "schema"
                        ? "bg-violet-50 text-violet-600 border-b-2 border-violet-500"
                        : "bg-primary/5 text-primary border-b-2 border-primary"
                      : "text-neutral-400 hover:text-neutral-600"
                  }`}
                >
                  {v === "preview" && <BarChart2 className="w-3.5 h-3.5" />}
                  {v === "datasets" && <Layers className="w-3.5 h-3.5" />}
                  {v === "schema" && <GitFork className="w-3.5 h-3.5" />}
                  {v === "preview" ? "Preview" : v === "datasets" ? "Datasets" : "Schema"}
                  {v === "datasets" && (
                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ml-0.5 ${
                      panelView === "datasets" ? "bg-primary text-white" : "bg-neutral-100 text-neutral-500"
                    }`}>
                      {datasets.length}
                    </span>
                  )}
                </button>
              ))}
            </div>

            {/* Panel content */}
            {datasets.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center gap-4 text-neutral-400 px-8">
                <div className="w-12 h-12 rounded-2xl bg-neutral-50 border border-neutral-100 flex items-center justify-center">
                  <Database className="w-5 h-5 opacity-40" />
                </div>
                <p className="text-sm font-semibold text-center text-neutral-500">
                  No datasets yet.
                </p>
                <button
                  onClick={() => setAddDatasetOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-white text-xs font-bold rounded-xl hover:bg-primary/90 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Dataset
                </button>
              </div>
            ) : (
              <>
                {panelView === "preview" && (
                  previewData ? (
                    <DataPreview
                      data={previewData}
                      workspaceId={workspaceId}
                      analysisId={activeAnalysisId}
                      datasets={datasets}
                      activeDataset={primaryDataset}
                      onSelectDataset={handleSetPrimary}
                    />
                  ) : (
                    <div className="flex-1 flex items-center justify-center text-neutral-400 text-sm gap-2">
                      {previewLoading && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
                      {previewLoading ? "Loading preview…" : "No data"}
                    </div>
                  )
                )}
                {panelView === "datasets" && (
                  <DatasetManager
                    workspaceId={workspaceId}
                    analysisId={activeAnalysisId}
                    datasets={datasets}
                    selectedDatasets={selectedDatasets}
                    primaryDataset={primaryDataset}
                    onSelectionChange={handleSelectionChange}
                    onSetPrimary={handleSetPrimary}
                    onUploadMore={() => setAddDatasetOpen(true)}
                    onDeleteDataset={handleDeleteDataset}
                  />
                )}
                {panelView === "schema" && (
                  <div className="flex-1 min-h-0 overflow-hidden">
                    <SchemaMap
                      workspaceId={workspaceId}
                      analysisId={activeAnalysisId}
                      datasets={datasets}
                    />
                  </div>
                )}
              </>
            )}
          </aside>

          {/* ── Chat panel ── */}
          <main className="flex-1 bg-white rounded-[2rem] shadow-[0_8px_30px_-8px_rgba(0,0,0,0.08)] border border-neutral-100 flex flex-col overflow-hidden relative">
            {/* Switching overlay */}
            {switchingId && (
              <div className="absolute inset-0 z-20 bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                <Loader2 className="w-8 h-8 text-primary animate-spin" />
                <p className="text-sm font-semibold text-neutral-500">
                  Loading {analyses.find((a) => a.id === switchingId)?.name ?? "analysis"}…
                </p>
              </div>
            )}
            <ChatPanel
              key={activeAnalysisId}
              workspaceId={workspaceId}
              analysisId={activeAnalysisId}
              primaryDataset={primaryDataset}
              selectedDatasets={selectedDatasets}
              model={chatModel}
              onModelChange={setChatModel}
              externalQuestion={externalQuestion}
              onExternalQuestionHandled={() => setExternalQuestion(null)}
              initialMessages={restoredMessages}
            />
          </main>
        </div>
      </div>

      {/* ── Modals ── */}
      {addDatasetOpen && (
        <AddDatasetModal
          workspaceId={workspaceId}
          analysisId={activeAnalysisId}
          onClose={() => setAddDatasetOpen(false)}
          onSuccess={handleAddDatasetSuccess}
        />
      )}

      {insightsOpen && (
        <AutoInsightsPanel
          workspaceId={workspaceId}
          analysisId={activeAnalysisId}
          dataset={primaryDataset}
          selectedDatasets={selectedDatasets}
          model={chatModel}
          cachedInsights={cachedInsights[primaryDataset]?.insights}
          onClose={() => setInsightsOpen(false)}
          onInsightsLoaded={(items) => {
            setCachedInsights((prev) => ({
              ...prev,
              [primaryDataset]: { insights: items },
            }));
          }}
          onAskInChat={(question) => {
            setInsightsOpen(false);
            setExternalQuestion(question);
          }}
        />
      )}

      {shareAnalysisId && (
        <ShareModal
          analysisId={shareAnalysisId}
          analysisName={analyses.find((a) => a.id === shareAnalysisId)?.name ?? "Analysis"}
          onClose={() => setShareAnalysisId(null)}
        />
      )}
    </div>
  );
}

// ── Share Modal ───────────────────────────────────────────────────────────────

function ShareModal({
  analysisId,
  analysisName,
  onClose,
}: {
  analysisId: string;
  analysisName: string;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shareUrl = typeof window !== "undefined"
    ? `${window.location.origin}/analysis/${analysisId}`
    : "";

  const handleCopy = () => {
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md bg-white rounded-3xl shadow-2xl border border-neutral-100 p-8">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 w-8 h-8 flex items-center justify-center rounded-xl hover:bg-neutral-100 text-neutral-400 hover:text-neutral-700 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-4 mb-6">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center">
            <Share2 className="w-6 h-6 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-lg font-black text-neutral-900">Share analysis</h2>
            <p className="text-xs text-neutral-500 mt-0.5 truncate max-w-[220px]">{analysisName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 p-3 bg-neutral-50 border border-neutral-200 rounded-2xl mb-4">
          <Link2 className="w-4 h-4 text-neutral-400 shrink-0" />
          <span className="flex-1 text-xs font-mono text-neutral-600 truncate">{shareUrl}</span>
          <button
            onClick={handleCopy}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all shrink-0 ${
              copied
                ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                : "bg-white text-neutral-700 border border-neutral-200 hover:border-primary/40 hover:text-primary"
            }`}
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-2xl">
          <span className="text-base mt-0.5">⏱</span>
          <p className="text-xs text-amber-700 leading-relaxed">
            Analyses are kept alive for <strong>24 hours</strong> from last activity.
            Opening this link resets the timer.
          </p>
        </div>
      </div>
    </div>
  );
}
