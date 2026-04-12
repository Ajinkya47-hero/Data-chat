"use client";

import { useState, useEffect, useRef } from "react";
import {
  Database, AlertTriangle, CheckCircle,
  ChevronUp, ChevronDown, Search, ChevronLeft, ChevronRight,
  Table2, ChevronDown as ChevronDownIcon, Loader2
} from "lucide-react";
import { getRows } from "@/lib/api";

// ── helpers ────────────────────────────────────────────────────────────────

function friendlyType(dtype: string) {
  if (dtype.includes("int") || dtype.includes("float")) return { label: "Number", color: "bg-blue-50 text-blue-600" };
  if (dtype.includes("datetime") || dtype.includes("date")) return { label: "Date", color: "bg-violet-50 text-violet-600" };
  if (dtype.includes("bool")) return { label: "Yes/No", color: "bg-amber-50 text-amber-600" };
  return { label: "Text", color: "bg-emerald-50 text-emerald-600" };
}

function friendlyColName(name: string) {
  return name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmt(v: number | null | undefined, prefix = "") {
  if (v === null || v === undefined) return "—";
  if (Math.abs(v) >= 1_00_000) return `${prefix}${(v / 1_00_000).toFixed(1)}L`;
  if (Math.abs(v) >= 1_000) return `${prefix}${(v / 1_000).toFixed(1)}K`;
  return `${prefix}${v % 1 === 0 ? v.toFixed(0) : v.toFixed(2)}`;
}

const KPI_COLORS: Record<string, string> = {
  blue: "bg-blue-50 text-blue-700 border-blue-100",
  green: "bg-emerald-50 text-emerald-700 border-emerald-100",
  amber: "bg-amber-50 text-amber-700 border-amber-100",
  red: "bg-red-50 text-red-700 border-red-100",
};

const PAGE_SIZE = 50;

// ── main component ─────────────────────────────────────────────────────────

interface DatasetMeta { name: string; row_count: number; column_count: number }

interface DataPreviewProps {
  data: any;
  workspaceId: string;
  analysisId: string;
  datasets?: DatasetMeta[];
  activeDataset?: string;
  onSelectDataset?: (name: string) => void;
}

export default function DataPreview({ data, workspaceId, analysisId, datasets = [], activeDataset, onSelectDataset }: DataPreviewProps) {
  const { health, columns, summary } = data;
  const [tab, setTab] = useState<"overview" | "data">("overview");
  const [dsOpen, setDsOpen] = useState(false);

  // ── Server-side data viewer state ──────────────────────────────────────
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [pageRows, setPageRows] = useState<any[]>([]);
  const [totalRows, setTotalRows] = useState(health.total_rows as number);
  const [totalPages, setTotalPages] = useState(1);
  const [rowsLoading, setRowsLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const visibleCols = columns.filter((c: any) => !c.name.startsWith("Unnamed"));
  const isHealthy = health.missing_pct < 5 && health.duplicate_rows === 0;

  // Debounce search input — wait 300ms before firing request
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  // Fetch rows from server whenever page, debouncedSearch, or dataset changes
  useEffect(() => {
    if (!activeDataset || !workspaceId || tab !== "data") return;
    setRowsLoading(true);
    getRows(workspaceId, analysisId, activeDataset, page, PAGE_SIZE, debouncedSearch)
      .then((res) => {
        setPageRows(res.data.rows);
        setTotalRows(res.data.total);
        setTotalPages(res.data.total_pages);
      })
      .catch(() => setPageRows([]))
      .finally(() => setRowsLoading(false));
  }, [workspaceId, analysisId, activeDataset, page, debouncedSearch, tab]);

  // Reset page + reload when switching datasets
  useEffect(() => {
    setPage(0);
    setSearch("");
    setDebouncedSearch("");
    setSortCol(null);
  }, [activeDataset]);

  const handleSort = (col: string) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("asc"); }
    setPage(0);
  };

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── Dataset selector (only shown when multiple datasets) ── */}
      {datasets.length > 1 && (
        <div className="relative shrink-0 px-4 pt-3 pb-0">
          <button
            onClick={() => setDsOpen((o) => !o)}
            className="flex items-center gap-2 w-full px-3 py-2 bg-neutral-50 border border-neutral-200 rounded-xl text-[13px] font-semibold text-neutral-700 hover:border-primary/30 hover:bg-primary/5 transition-colors"
          >
            <Table2 className="w-4 h-4 text-primary shrink-0" />
            <span className="flex-1 text-left truncate">{activeDataset}</span>
            <ChevronDownIcon className={`w-3.5 h-3.5 text-neutral-400 transition-transform ${dsOpen ? "rotate-180" : ""}`} />
          </button>
          {dsOpen && (
            <div className="absolute left-4 right-4 top-full mt-1 bg-white border border-neutral-200 rounded-xl shadow-lg z-20 overflow-hidden">
              {datasets.map((ds) => (
                <button
                  key={ds.name}
                  onClick={() => { onSelectDataset?.(ds.name); setDsOpen(false); }}
                  className={`flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors ${
                    ds.name === activeDataset ? "bg-primary/5 text-primary" : "hover:bg-neutral-50 text-neutral-700"
                  }`}
                >
                  <Table2 className="w-3.5 h-3.5 shrink-0" />
                  <div>
                    <p className="text-[13px] font-bold">{ds.name}</p>
                    <p className="text-[11px] text-neutral-400">{ds.row_count.toLocaleString()} rows · {ds.column_count} cols</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tab bar ── */}
      <div className="flex shrink-0 border-b border-neutral-100 px-4 pt-3 gap-1">
        {(["overview", "data"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-[12px] font-bold rounded-t-xl transition-colors capitalize ${
              tab === t
                ? "bg-primary/5 text-primary border-b-2 border-primary"
                : "text-neutral-400 hover:text-neutral-600"
            }`}
          >
            {t === "overview" ? "Overview" : `All Data (${health.total_rows.toLocaleString()})`}
          </button>
        ))}
      </div>

      {/* ── Overview tab ── */}
      {tab === "overview" && (
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">

          {/* Smart summary sentence */}
          {summary?.sentence && (
            <div className="flex items-start gap-3 bg-gradient-to-r from-primary/5 to-blue-50 border border-primary/10 rounded-2xl p-4">
              <Database className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              <p className="text-[13.5px] font-semibold text-neutral-800 leading-relaxed">
                {summary.sentence}
              </p>
            </div>
          )}

          {/* KPI cards */}
          {summary?.kpis?.length > 0 && (
            <div className="grid grid-cols-2 gap-2">
              {summary.kpis.map((kpi: any, i: number) => (
                <div key={i} className={`rounded-2xl border p-4 flex flex-col gap-1 ${KPI_COLORS[kpi.color] ?? KPI_COLORS.blue}`}>
                  <p className="text-[10px] font-bold uppercase tracking-widest opacity-70">{kpi.label}</p>
                  <p className="text-xl font-black tracking-tight">{kpi.value}</p>
                  {kpi.sub && <p className="text-[11px] opacity-60 font-medium">{kpi.sub}</p>}
                </div>
              ))}
            </div>
          )}

          {/* Health banner */}
          <div className={`flex items-center gap-3 rounded-2xl p-4 border ${
            isHealthy ? "bg-emerald-50 border-emerald-100" : "bg-amber-50 border-amber-100"
          }`}>
            {isHealthy
              ? <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />
              : <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />}
            <div>
              <p className={`text-[13px] font-bold ${isHealthy ? "text-emerald-800" : "text-amber-800"}`}>
                {isHealthy ? "Your data looks clean and complete" : "Data needs a little attention"}
              </p>
              <p className={`text-[11px] mt-0.5 ${isHealthy ? "text-emerald-600" : "text-amber-600"}`}>
                {health.missing_pct > 0
                  ? `${health.missing_pct.toFixed(1)}% of cells are empty`
                  : "No missing values found"}
                {health.duplicate_rows > 0 ? ` · ${health.duplicate_rows} duplicate rows` : ""}
              </p>
            </div>
          </div>

          {/* Column cards */}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400 mb-2 px-1">
              Columns ({visibleCols.length})
            </p>
            <div className="flex flex-col gap-2">
              {visibleCols.map((col: any) => {
                const type = friendlyType(col.dtype);
                const completeness = 100 - col.missing_pct;
                const stat = col.stat;
                const isNum = col.dtype.includes("int") || col.dtype.includes("float");
                return (
                  <div key={col.name} className="bg-neutral-50 hover:bg-white border border-neutral-100 hover:border-neutral-200 rounded-2xl p-4 transition-all">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-[13px] font-bold text-neutral-800">{friendlyColName(col.name)}</p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${type.color}`}>{type.label}</span>
                    </div>

                    {/* Completeness bar */}
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${completeness === 100 ? "bg-emerald-400" : "bg-amber-400"}`}
                          style={{ width: `${completeness}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-neutral-400 font-medium w-10 text-right">
                        {completeness === 100 ? "Full" : `${completeness.toFixed(0)}%`}
                      </span>
                    </div>

                    {/* Stats */}
                    {stat && isNum && (
                      <div className="flex gap-3 text-[11px] text-neutral-500">
                        <span><span className="font-semibold text-neutral-700">Min</span> {fmt(stat.min)}</span>
                        <span><span className="font-semibold text-neutral-700">Avg</span> {fmt(stat.mean)}</span>
                        <span><span className="font-semibold text-neutral-700">Max</span> {fmt(stat.max)}</span>
                        <span className="ml-auto">{stat.unique} unique</span>
                      </div>
                    )}
                    {stat && !isNum && stat.top_values.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1">
                        {stat.top_values.map((v: string, i: number) => (
                          <span key={i} className="text-[10px] bg-white border border-neutral-200 text-neutral-600 px-2 py-0.5 rounded-full font-medium">
                            {v}
                          </span>
                        ))}
                        {stat.unique > 3 && (
                          <span className="text-[10px] text-neutral-400 px-1 py-0.5">+{stat.unique - 3} more</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── All Data tab ── */}
      {tab === "data" && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Search */}
          <div className="shrink-0 px-4 py-3 border-b border-neutral-100">
            <div className="flex items-center gap-2 bg-neutral-50 border border-neutral-200 rounded-xl px-3 py-2">
              <Search className="w-4 h-4 text-neutral-400 shrink-0" />
              <input
                type="text"
                placeholder="Search anything..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                className="flex-1 bg-transparent text-[13px] outline-none text-neutral-700 placeholder:text-neutral-400"
              />
              {search && (
                <button onClick={() => setSearch("")} className="text-neutral-400 hover:text-neutral-600 text-xs">✕</button>
              )}
            </div>
            <p className="text-[11px] text-neutral-400 mt-1.5 px-1">
              {debouncedSearch ? `${totalRows.toLocaleString()} matches` : `${totalRows.toLocaleString()} rows`}
              {" "}of {health.total_rows.toLocaleString()} total
              {rowsLoading && " · loading..."}
            </p>
          </div>

          {/* Table */}
          <div className="flex-1 overflow-auto relative">
            {rowsLoading && (
              <div className="absolute inset-0 bg-white/70 z-20 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-primary animate-spin" />
              </div>
            )}
            <table className="w-full text-[12px] border-collapse">
              <thead className="sticky top-0 z-10 bg-white border-b border-neutral-200">
                <tr>
                  {visibleCols.map((c: any) => (
                    <th
                      key={c.name}
                      onClick={() => handleSort(c.name)}
                      className="px-3 py-2.5 text-left font-bold text-neutral-500 whitespace-nowrap cursor-pointer hover:text-primary hover:bg-neutral-50 transition-colors select-none"
                    >
                      <div className="flex items-center gap-1">
                        {friendlyColName(c.name)}
                        {sortCol === c.name
                          ? sortDir === "asc"
                            ? <ChevronUp className="w-3 h-3 text-primary" />
                            : <ChevronDown className="w-3 h-3 text-primary" />
                          : <ChevronUp className="w-3 h-3 opacity-0 group-hover:opacity-30" />}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row: any, i: number) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-white" : "bg-neutral-50/50"}>
                    {visibleCols.map((c: any) => {
                      const val = row[c.name];
                      const isNum = c.dtype.includes("int") || c.dtype.includes("float");
                      return (
                        <td key={c.name} className={`px-3 py-2 border-b border-neutral-50 max-w-[140px] truncate ${isNum ? "text-right font-medium text-neutral-700" : "text-neutral-600"}`} title={String(val ?? "")}>
                          {val === null || val === undefined
                            ? <span className="text-neutral-300 italic">—</span>
                            : isNum && typeof val === "number"
                              ? val.toLocaleString()
                              : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {!rowsLoading && pageRows.length === 0 && (
                  <tr>
                    <td colSpan={visibleCols.length} className="px-4 py-8 text-center text-neutral-400 text-[13px]">
                      {debouncedSearch ? `No results for "${debouncedSearch}"` : "No data"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-t border-neutral-100 bg-white">
              <span className="text-[11px] text-neutral-400">
                Page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-1">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="p-1.5 rounded-lg border border-neutral-200 disabled:opacity-30 hover:bg-neutral-50 transition-colors"
                >
                  <ChevronLeft className="w-3.5 h-3.5 text-neutral-600" />
                </button>
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  const p = Math.min(Math.max(page - 2, 0) + i, totalPages - 1);
                  return (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      className={`w-7 h-7 rounded-lg text-[11px] font-bold transition-colors ${
                        p === page ? "bg-primary text-white" : "border border-neutral-200 text-neutral-600 hover:bg-neutral-50"
                      }`}
                    >
                      {p + 1}
                    </button>
                  );
                })}
                <button
                  onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  disabled={page === totalPages - 1}
                  className="p-1.5 rounded-lg border border-neutral-200 disabled:opacity-30 hover:bg-neutral-50 transition-colors"
                >
                  <ChevronRight className="w-3.5 h-3.5 text-neutral-600" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
