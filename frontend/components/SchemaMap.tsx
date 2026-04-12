"use client";

import { useState, useEffect } from "react";
import { getRelationships } from "@/lib/api";
import SchemaCanvas, { schemaCanvasSize } from "./SchemaCanvas";
import SchemaExpandedModal from "./SchemaExpandedModal";
import type { DatasetMeta } from "./DatasetManager";
import type { GraphRelationship } from "./RelationshipGraph";
import { GitFork, RefreshCw, AlertCircle, Table2, Maximize2, Link2 } from "lucide-react";

interface SchemaMapProps {
  workspaceId: string;
  analysisId: string;
  datasets: DatasetMeta[];
}

// ── Single-table full-panel view ───────────────────────────────────────────────

function SingleTableView({ ds }: { ds: DatasetMeta }) {
  const visible = ds.columns.filter((c) => !c.startsWith("Unnamed"));
  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-6">
      <div className="w-full">
        <div className="rounded-2xl border border-violet-200 overflow-hidden shadow-md shadow-violet-100/50">
          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-3.5 bg-violet-600">
            <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <Table2 className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-black text-white">{ds.name}</p>
              <p className="text-[10px] text-violet-200 font-medium">
                {ds.row_count.toLocaleString()} rows · {ds.column_count} columns
              </p>
            </div>
          </div>

          {/* Column list */}
          <div className="bg-white divide-y divide-neutral-50 max-h-[380px] overflow-auto">
            {visible.map((col, i) => (
              <div key={col} className="flex items-center px-5 py-2.5 gap-3 hover:bg-violet-50/40 transition-colors">
                <span className="text-[10px] text-neutral-300 font-mono w-5 text-right shrink-0">{i + 1}</span>
                <div className="w-1.5 h-1.5 rounded-full bg-violet-300 shrink-0" />
                <span className="text-[13px] font-mono text-neutral-700">{col}</span>
              </div>
            ))}
          </div>
        </div>
        <p className="text-center text-[11px] text-neutral-400 mt-4 leading-relaxed">
          Upload a second dataset to see how tables connect
        </p>
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function SchemaMap({ workspaceId, analysisId, datasets }: SchemaMapProps) {
  const [relationships, setRelationships] = useState<GraphRelationship[]>([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [expanded, setExpanded]           = useState(false);

  const load = () => {
    if (datasets.length < 2) { setRelationships([]); return; }
    setLoading(true);
    setError(null);
    getRelationships(workspaceId, analysisId)
      .then((res) => setRelationships(res.data.relationships ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [workspaceId, analysisId, datasets.length]);

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (datasets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-neutral-400 px-8">
        <div className="w-16 h-16 rounded-2xl bg-neutral-100 flex items-center justify-center">
          <GitFork className="w-8 h-8 opacity-30" />
        </div>
        <div className="text-center">
          <p className="text-sm font-bold text-neutral-500">No datasets yet</p>
          <p className="text-[11px] text-neutral-400 mt-1">Upload data to see a schema map</p>
        </div>
      </div>
    );
  }

  // ── Single dataset ─────────────────────────────────────────────────────────
  if (datasets.length === 1) {
    return (
      <div className="flex flex-col h-full">
        <Toolbar
          loading={loading}
          onRefresh={load}
          onExpand={() => setExpanded(true)}
          relCount={0}
          tableCount={1}
          canExpand={false}
        />
        <div className="flex-1 min-h-0 overflow-auto">
          <SingleTableView ds={datasets[0]} />
        </div>
      </div>
    );
  }

  // ── Multi-dataset ──────────────────────────────────────────────────────────
  const { width: canvasW, height: canvasH } = schemaCanvasSize(datasets.length, "compact");

  return (
    <>
      <div className="flex flex-col h-full">
        <Toolbar
          loading={loading}
          onRefresh={load}
          onExpand={() => setExpanded(true)}
          relCount={relationships.length}
          tableCount={datasets.length}
          canExpand
        />

        {/* Error banner */}
        {error && (
          <div className="shrink-0 flex items-center gap-2 text-red-500 text-[11px] px-4 py-2 bg-red-50 border-b border-red-100 mx-3 rounded-xl mt-1">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex-1 flex items-center justify-center gap-2 text-neutral-400">
            <RefreshCw className="w-4 h-4 animate-spin" />
            <span className="text-[12px] font-medium">Detecting relationships…</span>
          </div>
        )}

        {/* Horizontal scroll canvas */}
        {!loading && (
          <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden" style={{ overscrollBehaviorX: "contain" }}>
            <div
              style={{ width: canvasW, height: canvasH, minHeight: "100%", display: "flex", alignItems: "center" }}
              className="px-3 py-3"
            >
              <SchemaCanvas
                datasets={datasets}
                relationships={relationships}
                mode="compact"
                idPrefix="sc"
              />
            </div>

            {/* No-relationship hint below canvas */}
            {!relationships.length && !error && (
              <div className="flex flex-col items-center justify-center gap-2 pb-4 px-6 text-center">
                <p className="text-[11px] font-bold text-neutral-500">No links detected</p>
                <p className="text-[10px] text-neutral-400">
                  Go to the <span className="font-semibold text-neutral-600">Datasets</span> tab to add relationships manually.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Legend strip */}
        {!loading && (
          <div className="shrink-0 flex items-center gap-3 px-4 py-2 border-t border-neutral-50 text-[9px] text-neutral-400">
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block bg-emerald-400" /> High confidence
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block bg-amber-400" /> Medium
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full inline-block bg-slate-300" /> Low
            </span>
            <span className="ml-auto text-[9px] text-neutral-300 italic">← scroll →</span>
          </div>
        )}
      </div>

      {/* Expanded modal */}
      {expanded && (
        <SchemaExpandedModal
          datasets={datasets}
          relationships={relationships}
          workspaceId={workspaceId}
          analysisId={analysisId}
          onClose={() => { setExpanded(false); load(); }}
        />
      )}
    </>
  );
}

// ── Toolbar ────────────────────────────────────────────────────────────────────

function Toolbar({
  loading,
  onRefresh,
  onExpand,
  relCount,
  tableCount,
  canExpand,
}: {
  loading: boolean;
  onRefresh: () => void;
  onExpand: () => void;
  relCount: number;
  tableCount: number;
  canExpand: boolean;
}) {
  return (
    <div className="shrink-0 flex items-center justify-between px-3 pt-3 pb-1.5">
      {/* Stats pill */}
      <div className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-50 border border-neutral-100 rounded-full">
        <span className="text-[10px] text-neutral-400 font-semibold">{tableCount} table{tableCount !== 1 ? "s" : ""}</span>
        {relCount > 0 && (
          <>
            <span className="text-neutral-200">·</span>
            <Link2 className="w-2.5 h-2.5 text-violet-400" />
            <span className="text-[10px] text-violet-600 font-bold">{relCount}</span>
          </>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        {/* Expand button */}
        {canExpand && (
          <button
            onClick={onExpand}
            title="Open schema explorer"
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-50 border border-violet-100 hover:bg-violet-100 hover:border-violet-200 text-violet-600 transition-colors text-[10px] font-bold"
          >
            <Maximize2 className="w-3 h-3" />
            Expand
          </button>
        )}
        {/* Refresh button */}
        <button
          onClick={onRefresh}
          disabled={loading}
          title="Re-detect relationships"
          className="w-7 h-7 flex items-center justify-center rounded-full bg-white border border-neutral-100 shadow-sm text-neutral-400 hover:text-violet-600 hover:border-violet-200 transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
    </div>
  );
}
