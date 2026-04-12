"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import {
  X, ZoomIn, ZoomOut, Maximize2, RotateCcw,
  Plus, Link2, Loader2, Move,
} from "lucide-react";
import SchemaCanvas, { schemaCanvasSize } from "./SchemaCanvas";
import type { DatasetMeta } from "./DatasetManager";
import type { GraphRelationship } from "./RelationshipGraph";
import { addRelationship } from "@/lib/api";

interface SchemaExpandedModalProps {
  datasets: DatasetMeta[];
  relationships: GraphRelationship[];
  workspaceId: string;
  analysisId: string;
  onClose: () => void;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

const MIN_SCALE = 0.15;
const MAX_SCALE = 3.0;
const ZOOM_STEP = 0.15;

// ── Add Relationship form ──────────────────────────────────────────────────────

function AddRelForm({
  datasets,
  workspaceId,
  analysisId,
  onAdd,
  onCancel,
}: {
  datasets: DatasetMeta[];
  workspaceId: string;
  analysisId: string;
  onAdd: (rel: GraphRelationship) => void;
  onCancel: () => void;
}) {
  const [leftTable,  setLeftTable]  = useState(datasets[0]?.name ?? "");
  const [leftCol,    setLeftCol]    = useState("");
  const [rightTable, setRightTable] = useState(datasets[1]?.name ?? datasets[0]?.name ?? "");
  const [rightCol,   setRightCol]   = useState("");
  const [saving,     setSaving]     = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const leftCols  = datasets.find((d) => d.name === leftTable)?.columns.filter((c) => !c.startsWith("Unnamed")) ?? [];
  const rightCols = datasets.find((d) => d.name === rightTable)?.columns.filter((c) => !c.startsWith("Unnamed")) ?? [];

  const canSave = leftTable && leftCol && rightTable && rightCol;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const res = await addRelationship(workspaceId, analysisId, {
        left_table: leftTable,
        left_column: leftCol,
        right_table: rightTable,
        right_column: rightCol,
      });
      onAdd(res.data);
    } catch (e: any) {
      setError(e.response?.data?.detail ?? e.message ?? "Failed to add relationship");
    } finally {
      setSaving(false);
    }
  };

  const sel = "text-xs font-medium text-neutral-700 bg-white border border-neutral-200 rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-violet-300 focus:border-violet-300 cursor-pointer appearance-none pr-7";

  return (
    <div className="shrink-0 bg-violet-50/80 border-b border-violet-100 px-5 py-3 backdrop-blur-sm">
      <div className="flex items-end gap-3 flex-wrap">

        {/* From table + column */}
        <div className="flex gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-violet-500">From table</label>
            <div className="relative">
              <select
                value={leftTable}
                onChange={(e) => { setLeftTable(e.target.value); setLeftCol(""); }}
                className={sel}
              >
                {datasets.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 text-[10px]">▾</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-violet-500">Column</label>
            <div className="relative">
              <select
                value={leftCol}
                onChange={(e) => setLeftCol(e.target.value)}
                className={sel}
              >
                <option value="">Select…</option>
                {leftCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 text-[10px]">▾</span>
            </div>
          </div>
        </div>

        {/* Arrow */}
        <div className="text-violet-400 text-lg font-bold pb-1.5 select-none">→</div>

        {/* To table + column */}
        <div className="flex gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-violet-500">To table</label>
            <div className="relative">
              <select
                value={rightTable}
                onChange={(e) => { setRightTable(e.target.value); setRightCol(""); }}
                className={sel}
              >
                {datasets.map((d) => <option key={d.name} value={d.name}>{d.name}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 text-[10px]">▾</span>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-black uppercase tracking-widest text-violet-500">Column</label>
            <div className="relative">
              <select
                value={rightCol}
                onChange={(e) => setRightCol(e.target.value)}
                className={sel}
              >
                <option value="">Select…</option>
                {rightCols.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 text-[10px]">▾</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pb-[1px] ml-auto">
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-sm shadow-violet-200"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {saving ? "Saving…" : "Add Link"}
          </button>
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-neutral-200 text-neutral-600 hover:bg-neutral-50 text-xs font-bold transition-all"
          >
            Cancel
          </button>
        </div>
      </div>
      {error && <p className="text-red-500 text-xs mt-2 font-medium">{error}</p>}
    </div>
  );
}

// ── Main modal ─────────────────────────────────────────────────────────────────

export default function SchemaExpandedModal({
  datasets,
  relationships,
  workspaceId,
  analysisId,
  onClose,
}: SchemaExpandedModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef   = useRef<HTMLDivElement>(null);
  const panStart     = useRef<{ mx: number; my: number; tx: number; ty: number } | null>(null);
  const tRef         = useRef<Transform>({ x: 0, y: 0, scale: 1 });

  const [t, setT]           = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [isPanning, setIsPanning] = useState(false);

  // Local relationships — updated when user adds manually
  const [localRels, setLocalRels] = useState<GraphRelationship[]>(relationships);

  // Per-node drag offsets (canvas-space)
  const [nodeOffsets, setNodeOffsets] = useState<Map<string, { dx: number; dy: number }>>(new Map());

  // Active node drag tracker (ref so onMove always reads latest)
  const dragNodeRef = useRef<{
    name: string;
    startMx: number; startMy: number;
    startDx: number; startDy: number;
    scale: number;
  } | null>(null);

  // Add relationship form
  const [addRelOpen, setAddRelOpen] = useState(false);

  const setTransform = useCallback((next: Transform | ((prev: Transform) => Transform)) => {
    setT((prev) => {
      const val = typeof next === "function" ? next(prev) : next;
      tRef.current = val;
      return val;
    });
  }, []);

  const n = datasets.length;
  const { width: canvasW, height: canvasH } = schemaCanvasSize(n, "expanded");

  // ── Fit-to-screen ────────────────────────────────────────────────────────────
  const fitScreen = useCallback(() => {
    const ct = containerRef.current;
    if (!ct || !n) return;
    const { width: vw, height: vh } = ct.getBoundingClientRect();
    const pad = 48;
    const scale = Math.min((vw - pad * 2) / canvasW, (vh - pad * 2) / canvasH, 1);
    const x = (vw - canvasW * scale) / 2;
    const y = (vh - canvasH * scale) / 2;
    setTransform({ x, y, scale });
  }, [canvasW, canvasH, n, setTransform]);

  useEffect(() => {
    const id = setTimeout(fitScreen, 40);
    return () => clearTimeout(id);
  }, [fitScreen]);

  // ── Escape key ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Zoom (wheel) ─────────────────────────────────────────────────────────────
  const onWheel = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = containerRef.current!.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;
    const delta = e.deltaY < 0 ? 1 : -1;
    setTransform((prev) => {
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale + delta * ZOOM_STEP * prev.scale));
      const ratio    = newScale / prev.scale;
      return { x: mx - (mx - prev.x) * ratio, y: my - (my - prev.y) * ratio, scale: newScale };
    });
  }, [setTransform]);

  // ── Pan (mouse on container) ─────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    // Don't start pan if a node drag is beginning (handled via stopPropagation in SchemaCanvas)
    e.preventDefault();
    panStart.current = { mx: e.clientX, my: e.clientY, tx: tRef.current.x, ty: tRef.current.y };
    setIsPanning(true);
  }, []);

  // ── Shared mousemove/up — handles BOTH node drag and pan ─────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      // Node drag takes priority
      if (dragNodeRef.current) {
        const { name, startMx, startMy, startDx, startDy, scale } = dragNodeRef.current;
        const dx = (e.clientX - startMx) / scale;
        const dy = (e.clientY - startMy) / scale;
        setNodeOffsets((prev) => {
          const next = new Map(prev);
          next.set(name, { dx: startDx + dx, dy: startDy + dy });
          return next;
        });
        return;
      }
      // Pan
      if (!panStart.current) return;
      const { tx, ty, mx, my } = panStart.current;
      setTransform((prev) => ({ ...prev, x: tx + (e.clientX - mx), y: ty + (e.clientY - my) }));
    };
    const onUp = () => {
      dragNodeRef.current = null;
      panStart.current    = null;
      setIsPanning(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup",   onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup",   onUp);
    };
  }, [setTransform]);

  // ── Node drag start (called by SchemaCanvas) ─────────────────────────────────
  const handleNodeMouseDown = useCallback((name: string, e: React.MouseEvent<SVGGElement>) => {
    const current = nodeOffsets.get(name) ?? { dx: 0, dy: 0 };
    dragNodeRef.current = {
      name,
      startMx: e.clientX,
      startMy: e.clientY,
      startDx: current.dx,
      startDy: current.dy,
      scale:   tRef.current.scale,
    };
  }, [nodeOffsets]);

  // ── Toolbar zoom helpers ──────────────────────────────────────────────────────
  const zoomBy = (delta: number) => {
    setTransform((prev) => {
      const ct = containerRef.current;
      const cx = ct ? ct.getBoundingClientRect().width  / 2 : 0;
      const cy = ct ? ct.getBoundingClientRect().height / 2 : 0;
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale + delta * prev.scale));
      const ratio    = newScale / prev.scale;
      return { x: cx - (cx - prev.x) * ratio, y: cy - (cy - prev.y) * ratio, scale: newScale };
    });
  };

  const resetView = () => {
    setNodeOffsets(new Map());
    setTransform({ x: 0, y: 0, scale: 1 });
  };

  const pct = Math.round(t.scale * 100);

  const modal = (
    <div
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ backgroundColor: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}
    >
      {/* ── Toolbar ── */}
      <div className="shrink-0 flex items-center justify-between px-5 py-3 bg-white/95 border-b border-neutral-200 shadow-sm z-10">
        {/* Left: title */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-violet-600 flex items-center justify-center shadow">
            <Maximize2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-sm font-black text-neutral-800 leading-none">Schema Explorer</p>
            <p className="text-[10px] text-neutral-400 mt-0.5">
              {n} table{n !== 1 ? "s" : ""} · {localRels.length} relationship{localRels.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>

        {/* Center: zoom + add relationship */}
        <div className="flex items-center gap-2">
          {/* Add Relationship button */}
          <button
            onClick={() => setAddRelOpen((v) => !v)}
            disabled={n < 2}
            title={n < 2 ? "Upload a second dataset to link tables" : "Manually define a table relationship"}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border transition-all disabled:opacity-30 disabled:cursor-not-allowed ${
              addRelOpen
                ? "bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-200"
                : "bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100"
            }`}
          >
            <Link2 className="w-3.5 h-3.5" />
            Add Relationship
          </button>

          {/* Drag hint */}
          <div className="hidden md:flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-neutral-50 border border-neutral-100 text-[10px] text-neutral-400 font-medium">
            <Move className="w-3 h-3" />
            Drag tables to arrange
          </div>

          {/* Zoom controls */}
          <div className="flex items-center gap-1 bg-neutral-50 border border-neutral-200 rounded-2xl px-2 py-1.5">
            <button
              onClick={() => zoomBy(-ZOOM_STEP)}
              disabled={t.scale <= MIN_SCALE}
              className="w-7 h-7 flex items-center justify-center rounded-xl hover:bg-white hover:shadow-sm text-neutral-500 hover:text-violet-600 transition-all disabled:opacity-30"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <span className="text-[11px] font-black text-neutral-500 tabular-nums w-10 text-center">{pct}%</span>
            <button
              onClick={() => zoomBy(ZOOM_STEP)}
              disabled={t.scale >= MAX_SCALE}
              className="w-7 h-7 flex items-center justify-center rounded-xl hover:bg-white hover:shadow-sm text-neutral-500 hover:text-violet-600 transition-all disabled:opacity-30"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <div className="w-px h-4 bg-neutral-200 mx-0.5" />
            <button
              onClick={fitScreen}
              className="flex items-center gap-1 px-2 h-7 rounded-xl hover:bg-white hover:shadow-sm text-neutral-500 hover:text-violet-600 transition-all text-[10px] font-bold"
              title="Fit to screen"
            >
              <Maximize2 className="w-3 h-3" />
              Fit
            </button>
            <button
              onClick={resetView}
              className="flex items-center gap-1 px-2 h-7 rounded-xl hover:bg-white hover:shadow-sm text-neutral-500 hover:text-violet-600 transition-all text-[10px] font-bold"
              title="Reset view and positions"
            >
              <RotateCcw className="w-3 h-3" />
              Reset
            </button>
          </div>
        </div>

        {/* Right: legend + close */}
        <div className="flex items-center gap-4">
          <div className="hidden md:flex items-center gap-3 text-[10px] text-neutral-400">
            <span className="flex items-center gap-1">
              <span className="inline-block w-3 h-3 rounded-full bg-violet-600" />
              FK relationship
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              High confidence
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-amber-400" />
              Medium
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-full bg-slate-400" />
              Low
            </span>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-xl bg-neutral-100 hover:bg-red-50 text-neutral-500 hover:text-red-500 transition-all"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* ── Add Relationship form (collapsible) ── */}
      {addRelOpen && (
        <AddRelForm
          datasets={datasets}
          workspaceId={workspaceId}
          analysisId={analysisId}
          onAdd={(rel) => {
            setLocalRels((prev) => [...prev, rel]);
            setAddRelOpen(false);
          }}
          onCancel={() => setAddRelOpen(false)}
        />
      )}

      {/* ── Canvas ── */}
      <div
        ref={containerRef}
        className="flex-1 overflow-hidden relative select-none"
        style={{
          cursor: isPanning ? "grabbing" : "grab",
          backgroundImage: "radial-gradient(circle, #d1d5db 1px, transparent 1px)",
          backgroundSize: "24px 24px",
          backgroundColor: "#f9fafb",
        }}
        onMouseDown={onMouseDown}
        onWheel={onWheel}
      >
        <div
          ref={contentRef}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            transformOrigin: "0 0",
            transform: `translate(${t.x}px, ${t.y}px) scale(${t.scale})`,
            willChange: "transform",
          }}
        >
          <SchemaCanvas
            datasets={datasets}
            relationships={localRels}
            mode="expanded"
            idPrefix="exp"
            showLabels={true}
            nodeOffsets={nodeOffsets}
            onNodeMouseDown={handleNodeMouseDown}
          />
        </div>

        {n === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-sm pointer-events-none">
            No tables to display
          </div>
        )}

        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-2 px-3 py-1.5 bg-white/80 rounded-full text-[10px] text-neutral-400 shadow-sm pointer-events-none">
          <span>Scroll to zoom · Drag canvas to pan · Drag tables to arrange · Esc to close</span>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}
