"use client";

import { useMemo, useState } from "react";
import { DatasetMeta } from "./DatasetManager";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface GraphRelationship {
  id: string;
  left_table: string;
  left_column: string;
  right_table: string;
  right_column: string;
  confidence: number;
  match_type: string;
  source: "auto" | "manual";
}

interface Props {
  datasets: DatasetMeta[];
  relationships: GraphRelationship[];
  /** "horizontal" = classic left→right (used in DatasetManager).
   *  "vertical"   = top→bottom, scales to fill the container (used in SchemaMap). */
  layout?: "horizontal" | "vertical";
}

// ── Shared constants ───────────────────────────────────────────────────────────

const VIOLET      = "#7c3aed";
const VIOLET_PALE = "#ede9fe";
const VIOLET_MID  = "#c4b5fd";

function confColor(c: number) {
  return c >= 0.85 ? "#10b981" : c >= 0.65 ? "#f59e0b" : "#94a3b8";
}
function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Shared: edge direction helpers ─────────────────────────────────────────────

type DirEdge = {
  id: string; parent: string; child: string;
  parentCol: string; childCol: string;
  confidence: number; source: "auto" | "manual";
};

function buildDirEdges(names: string[], rels: GraphRelationship[]): DirEdge[] {
  const pairMap = new Map<string, GraphRelationship>();
  rels.forEach((r) => {
    if (!names.includes(r.left_table) || !names.includes(r.right_table)) return;
    const key = [r.left_table, r.right_table].sort().join("\0");
    const prev = pairMap.get(key);
    if (!prev || r.confidence > prev.confidence) pairMap.set(key, r);
  });
  return Array.from(pairMap.values()).map((r) => {
    const isFk = r.match_type === "table_name_fk" || r.match_type.startsWith("exact_key");
    return isFk
      ? { id: r.id, parent: r.right_table, child: r.left_table, parentCol: r.right_column, childCol: r.left_column, confidence: r.confidence, source: r.source }
      : { id: r.id, parent: r.left_table,  child: r.right_table, parentCol: r.left_column,  childCol: r.right_column, confidence: r.confidence, source: r.source };
  });
}

function topoSort(names: string[], dirEdges: DirEdge[]): Map<string, number> {
  const inDeg = new Map<string, number>(names.map((n) => [n, 0]));
  const adj   = new Map<string, Set<string>>(names.map((n) => [n, new Set()]));
  dirEdges.forEach(({ parent, child }) => {
    if (!adj.get(parent)!.has(child)) {
      adj.get(parent)!.add(child);
      inDeg.set(child, (inDeg.get(child) ?? 0) + 1);
    }
  });
  const levels = new Map<string, number>();
  let queue = names.filter((n) => (inDeg.get(n) ?? 0) === 0);
  let lv = 0;
  while (queue.length > 0) {
    const next: string[] = [];
    for (const n of queue) {
      levels.set(n, Math.max(levels.get(n) ?? 0, lv));
      for (const child of adj.get(n) ?? []) {
        inDeg.set(child, (inDeg.get(child) ?? 1) - 1);
        if ((inDeg.get(child) ?? 0) === 0) next.push(child);
      }
    }
    queue = [...new Set(next)];
    lv++;
  }
  names.filter((n) => !levels.has(n)).forEach((n) => levels.set(n, lv++));
  return levels;
}

// ── HORIZONTAL layout (original, used in DatasetManager) ──────────────────────

const H_NW = 176; const H_NH = 96;
const H_CG = 116; const H_RG = 30; const H_PD = 26; const H_TH = 28;

function buildHorizontalLayout(datasets: DatasetMeta[], rels: GraphRelationship[]) {
  const names = datasets.map((d) => d.name);
  if (names.length === 0) return null;

  const dirEdges = buildDirEdges(names, rels);
  const levels   = topoSort(names, dirEdges);

  const byLevel = new Map<number, string[]>();
  names.forEach((n) => {
    const l = levels.get(n)!;
    if (!byLevel.has(l)) byLevel.set(l, []);
    byLevel.get(l)!.push(n);
  });
  const maxLevel = Math.max(0, ...byLevel.keys());
  const maxInCol = Math.max(1, ...Array.from(byLevel.values()).map((v) => v.length));
  const totalH   = maxInCol * (H_NH + H_RG) - H_RG;

  const positions = new Map<string, { x: number; y: number }>();
  byLevel.forEach((colNames, l) => {
    const colH   = colNames.length * (H_NH + H_RG) - H_RG;
    const startY = (totalH - colH) / 2;
    colNames.forEach((name, i) => {
      positions.set(name, { x: H_PD + l * (H_NW + H_CG), y: H_PD + startY + i * (H_NH + H_RG) });
    });
  });

  const svgW = H_PD * 2 + (maxLevel + 1) * H_NW + maxLevel * H_CG;
  const svgH = H_PD * 2 + totalH;

  const edges = dirEdges.map((e) => {
    const pLvl = levels.get(e.parent) ?? 0;
    const cLvl = levels.get(e.child)  ?? 0;
    return pLvl <= cLvl
      ? { id: e.id, fromTable: e.parent, toTable: e.child, fromCol: e.parentCol, toCol: e.childCol, confidence: e.confidence, source: e.source }
      : { id: e.id, fromTable: e.child,  toTable: e.parent, fromCol: e.childCol,  toCol: e.parentCol, confidence: e.confidence, source: e.source };
  });

  return { positions, edges, svgW, svgH };
}

// ── VERTICAL layout (full-panel, used in SchemaMap) ───────────────────────────

// Design width: fits a ~360-420px panel. SVG uses width="100%" so it scales.
const V_NW = 300; const V_NH = 112;
const V_VG = 68;  const V_PD = 20; const V_TH = 30;

function buildVerticalLayout(datasets: DatasetMeta[], rels: GraphRelationship[]) {
  const names = datasets.map((d) => d.name);
  if (names.length === 0) return null;

  const dirEdges = buildDirEdges(names, rels);
  const levels   = topoSort(names, dirEdges);

  // Sort by level, then alphabetically within same level
  const ordered = [...names].sort((a, b) => {
    const diff = (levels.get(a) ?? 0) - (levels.get(b) ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });

  const svgW = V_PD * 2 + V_NW;
  const svgH = V_PD * 2 + ordered.length * V_NH + Math.max(0, ordered.length - 1) * V_VG;

  const positions = new Map<string, { x: number; y: number }>();
  ordered.forEach((name, i) => {
    positions.set(name, { x: V_PD, y: V_PD + i * (V_NH + V_VG) });
  });

  // Edges: from bottom-center of parent to top-center of child
  const edges = dirEdges.map((e) => {
    const pIdx = ordered.indexOf(e.parent);
    const cIdx = ordered.indexOf(e.child);
    return pIdx <= cIdx
      ? { id: e.id, fromTable: e.parent, toTable: e.child, fromCol: e.parentCol, toCol: e.childCol, confidence: e.confidence, source: e.source }
      : { id: e.id, fromTable: e.child,  toTable: e.parent, fromCol: e.childCol,  toCol: e.parentCol, confidence: e.confidence, source: e.source };
  });

  return { positions, edges, svgW, svgH, ordered };
}

// ── SVG Defs (shared) ──────────────────────────────────────────────────────────

function SvgDefs() {
  return (
    <defs>
      <marker id="rg-arrow" markerWidth="9" markerHeight="9" refX="8" refY="3.5" orient="auto">
        <path d="M0,1 L0,6 L8,3.5 z" fill={VIOLET} fillOpacity="0.75" />
      </marker>
      <filter id="rg-glow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor={VIOLET} floodOpacity="0.22" />
      </filter>
      <filter id="rg-shadow" x="-15%" y="-15%" width="130%" height="140%">
        <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor={VIOLET} floodOpacity="0.07" />
      </filter>
    </defs>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function RelationshipGraph({ datasets, relationships, layout = "horizontal" }: Props) {
  const [hoveredTable, setHoveredTable] = useState<string | null>(null);

  const hLayout = useMemo(
    () => layout === "horizontal" ? buildHorizontalLayout(datasets, relationships) : null,
    [datasets, relationships, layout],
  );
  const vLayout = useMemo(
    () => layout === "vertical" ? buildVerticalLayout(datasets, relationships) : null,
    [datasets, relationships, layout],
  );

  // Connected-set for hover highlighting
  const connectedSet = useMemo(() => {
    if (!hoveredTable) return new Set<string>();
    const edges = hLayout?.edges ?? vLayout?.edges ?? [];
    const s = new Set<string>([hoveredTable]);
    edges.forEach((e) => {
      if (e.fromTable === hoveredTable) s.add(e.toTable);
      if (e.toTable   === hoveredTable) s.add(e.fromTable);
    });
    return s;
  }, [hoveredTable, hLayout, vLayout]);

  const nodeOpacity = (name: string) => !hoveredTable ? 1 : connectedSet.has(name) ? 1 : 0.28;
  const edgeOpacity = (from: string, to: string) => !hoveredTable ? 1 : (from === hoveredTable || to === hoveredTable) ? 1 : 0.06;
  const edgeWidth   = (from: string, to: string) => !hoveredTable ? 1.75 : (from === hoveredTable || to === hoveredTable) ? 2.5 : 1.75;

  // ── VERTICAL RENDER ─────────────────────────────────────────────────────────
  if (layout === "vertical") {
    if (!vLayout) {
      return <div className="flex items-center justify-center py-10 text-neutral-400 text-sm">No datasets loaded</div>;
    }

    const { positions, edges, svgW, svgH, ordered } = vLayout;
    const dsMap = new Map(datasets.map((d) => [d.name, d]));
    const cx = V_PD + V_NW / 2; // horizontal center

    return (
      <div className="flex flex-col w-full">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          width="100%"
          preserveAspectRatio="xMidYMin meet"
          style={{ display: "block" }}
        >
          <SvgDefs />

          {/* ── Edges ── */}
          {edges.map((e) => {
            const from = positions.get(e.fromTable);
            const to   = positions.get(e.toTable);
            if (!from || !to) return null;

            const x1 = cx;
            const y1 = from.y + V_NH;       // bottom of source
            const x2 = cx;
            const y2 = to.y - 1;            // top of target (–1 for arrowhead gap)
            const cpY = (y1 + y2) / 2;

            const pathD = `M ${x1} ${y1} C ${x1} ${cpY - 8}, ${x2} ${cpY + 8}, ${x2} ${y2}`;
            const midY  = cpY;
            const op    = edgeOpacity(e.fromTable, e.toTable);
            const sw    = edgeWidth(e.fromTable, e.toTable);

            const label  = `${trunc(e.fromCol, 12)} → ${trunc(e.toCol, 12)}`;
            const labelW = Math.max(80, label.length * 5.6 + 14);
            const dotCol = confColor(e.confidence);

            return (
              <g key={e.id} opacity={op} style={{ transition: "opacity 0.2s" }}>
                <path d={pathD} fill="none" stroke="transparent" strokeWidth="12" />
                <path
                  id={`rg-vp-${e.id}`}
                  d={pathD}
                  fill="none"
                  stroke={VIOLET}
                  strokeWidth={sw}
                  strokeOpacity={op > 0.1 ? 0.45 : 0.15}
                  markerEnd="url(#rg-arrow)"
                  style={{ transition: "stroke-width 0.2s" }}
                />

                {/* Flowing dot */}
                <circle r="3.5" fill={VIOLET} opacity="0.75">
                  <animateMotion dur="1.6s" repeatCount="indefinite" calcMode="linear">
                    <mpath href={`#rg-vp-${e.id}`} />
                  </animateMotion>
                </circle>
                <circle r="2" fill={VIOLET} opacity="0.38">
                  <animateMotion dur="1.6s" begin="-0.28s" repeatCount="indefinite" calcMode="linear">
                    <mpath href={`#rg-vp-${e.id}`} />
                  </animateMotion>
                </circle>

                {/* Confidence dot */}
                <circle cx={cx + 18} cy={midY} r="5.5" fill={dotCol} fillOpacity="0.2" />
                <circle cx={cx + 18} cy={midY} r="3.5" fill={dotCol} fillOpacity="0.9" />
                <circle cx={cx + 18} cy={midY} r="1.5" fill="white" />

                {/* FK label pill (left of centre) */}
                <rect x={cx - 18 - labelW} y={midY - 7.5} width={labelW} height={15} rx={5} fill="white" stroke={VIOLET_MID} strokeWidth="1" />
                <text x={cx - 18 - labelW / 2} y={midY + 4} textAnchor="middle" fontSize="7.5" fontFamily="'Courier New', Courier, monospace" fill="#5b21b6" fontWeight="700" letterSpacing="0.3">
                  {label}
                </text>
              </g>
            );
          })}

          {/* ── Nodes ── */}
          {ordered.map((name) => {
            const ds  = dsMap.get(name);
            const pos = positions.get(name);
            if (!ds || !pos) return null;
            const { x, y } = pos;

            const isHovered   = hoveredTable === name;
            const isConnected = edges.some((e) => e.fromTable === name || e.toTable === name);
            const op          = nodeOpacity(name);

            const borderColor = isHovered ? VIOLET : isConnected ? VIOLET_MID : "#e5e7eb";
            const borderWidth = isHovered ? 2 : isConnected ? 1.5 : 1.2;

            const visibleCols = ds.columns.filter((c) => !c.startsWith("Unnamed"));
            const showCols    = visibleCols.slice(0, 4);
            const extraCols   = visibleCols.length - showCols.length;

            return (
              <g
                key={name}
                opacity={op}
                filter={isHovered ? "url(#rg-glow)" : "url(#rg-shadow)"}
                style={{ cursor: "pointer", transition: "opacity 0.2s" }}
                onMouseEnter={() => setHoveredTable(name)}
                onMouseLeave={() => setHoveredTable(null)}
              >
                {/* Card */}
                <rect x={x} y={y} width={V_NW} height={V_NH} rx={12} fill="white" stroke={borderColor} strokeWidth={borderWidth} style={{ transition: "stroke 0.2s" }} />

                {/* Header stripe */}
                <rect x={x} y={y} width={V_NW} height={V_TH} rx={12} fill={isHovered ? VIOLET : VIOLET_PALE} style={{ transition: "fill 0.2s" }} />
                <rect x={x} y={y + V_TH - 6} width={V_NW} height={6} fill={isHovered ? VIOLET : VIOLET_PALE} style={{ transition: "fill 0.2s" }} />

                {/* Cylinder icon */}
                <ellipse cx={x + 15} cy={y + 12} rx={5.5} ry={2.5} fill={isHovered ? "rgba(255,255,255,0.45)" : VIOLET} fillOpacity={isHovered ? 0.45 : 0.4} />
                <rect x={x + 9.5} y={y + 12} width={11} height={10} fill={isHovered ? "rgba(255,255,255,0.45)" : VIOLET} fillOpacity={isHovered ? 0.3 : 0.28} />
                <ellipse cx={x + 15} cy={y + 22} rx={5.5} ry={2.5} fill={isHovered ? "rgba(255,255,255,0.45)" : VIOLET} fillOpacity={isHovered ? 0.45 : 0.4} />

                {/* Table name */}
                <text x={x + 31} y={y + 19} fontSize="12" fontWeight="800" fontFamily="system-ui, -apple-system, sans-serif" fill={isHovered ? "white" : "#1e1b4b"} style={{ transition: "fill 0.2s" }}>
                  {trunc(name, 22)}
                </text>

                {/* Stats */}
                <text x={x + 10} y={y + 40} fontSize="8.5" fontFamily="system-ui" fill="#9ca3af">
                  {ds.row_count.toLocaleString()} rows · {ds.column_count} cols
                </text>

                {/* Separator */}
                <line x1={x + 10} y1={y + 45} x2={x + V_NW - 10} y2={y + 45} stroke="#f3f4f6" strokeWidth="1" />

                {/* Columns */}
                {showCols.map((col, i) => (
                  <text key={col} x={x + 10} y={y + 57 + i * 12} fontSize="8.5" fontFamily="'Courier New', Courier, monospace" fill="#6b7280">
                    {trunc(col, 32)}
                  </text>
                ))}
                {extraCols > 0 && (
                  <text x={x + 10} y={y + 57 + showCols.length * 12} fontSize="8" fontFamily="system-ui" fill="#d1d5db">
                    +{extraCols} more…
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Legend */}
        {edges.length > 0 && (
          <div className="flex items-center gap-4 px-3 pt-2 pb-1 flex-wrap">
            <div className="flex items-center gap-1.5">
              <svg width="22" height="10">
                <line x1="0" y1="5" x2="14" y2="5" stroke={VIOLET} strokeWidth="1.5" strokeOpacity="0.5" />
                <circle cx="18" cy="5" r="2.5" fill={VIOLET} opacity="0.7" />
              </svg>
              <span className="text-[9px] text-neutral-400 font-semibold">Flow</span>
            </div>
            <span className="text-[9px] font-black uppercase tracking-widest text-neutral-300">Confidence</span>
            {([["#10b981", "High"], ["#f59e0b", "Med"], ["#94a3b8", "Low"]] as [string, string][]).map(([c, l]) => (
              <div key={l} className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
                <span className="text-[9px] text-neutral-400">{l}</span>
              </div>
            ))}
            <span className="text-[9px] text-neutral-300 ml-auto italic">hover to highlight</span>
          </div>
        )}
      </div>
    );
  }

  // ── HORIZONTAL RENDER (unchanged, used in DatasetManager) ───────────────────
  if (!hLayout) {
    return <div className="flex items-center justify-center py-10 text-neutral-400 text-sm">No datasets loaded</div>;
  }

  const { positions, edges, svgW, svgH } = hLayout;
  const noEdges = edges.length === 0;

  return (
    <div className="flex flex-col">
      <div className="overflow-auto rounded-xl bg-[#fafafa] border border-neutral-100">
        <svg width={svgW} height={Math.max(svgH, 140)} viewBox={`0 0 ${svgW} ${Math.max(svgH, 140)}`} style={{ display: "block", minWidth: svgW }}>
          <SvgDefs />

          {edges.map((e) => {
            const from = positions.get(e.fromTable);
            const to   = positions.get(e.toTable);
            if (!from || !to) return null;
            const x1 = from.x + H_NW; const y1 = from.y + H_NH / 2;
            const x2 = to.x - 1;      const y2 = to.y   + H_NH / 2;
            const isForward = from.x < to.x - 1;
            const cpDist    = isForward ? H_CG * 0.52 : 55;
            const pathD     = isForward
              ? `M ${x1} ${y1} C ${x1 + cpDist} ${y1}, ${x2 - cpDist} ${y2}, ${x2} ${y2}`
              : `M ${x1} ${y1} C ${x1 + cpDist} ${y1 - 60}, ${x2 - cpDist} ${y2 - 60}, ${x2} ${y2}`;
            const mx = (x1 + x2) / 2;
            const my = isForward ? (y1 + y2) / 2 : Math.min(y1, y2) - 26;
            const label  = `${trunc(e.fromCol, 10)} → ${trunc(e.toCol, 10)}`;
            const labelW = Math.max(68, label.length * 5.2 + 12);
            const dotCol = confColor(e.confidence);
            const op = edgeOpacity(e.fromTable, e.toTable);
            const sw = edgeWidth(e.fromTable, e.toTable);

            return (
              <g key={e.id} opacity={op} style={{ transition: "opacity 0.2s" }}>
                <path d={pathD} fill="none" stroke="transparent" strokeWidth="12" />
                <path id={`rg-hp-${e.id}`} d={pathD} fill="none" stroke={VIOLET} strokeWidth={sw} strokeOpacity={0.42} markerEnd="url(#rg-arrow)" style={{ transition: "stroke-width 0.2s" }} />
                <circle r="3.5" fill={VIOLET} opacity="0.75">
                  <animateMotion dur="1.8s" repeatCount="indefinite" calcMode="linear"><mpath href={`#rg-hp-${e.id}`} /></animateMotion>
                </circle>
                <circle r="2" fill={VIOLET} opacity="0.35">
                  <animateMotion dur="1.8s" begin="-0.3s" repeatCount="indefinite" calcMode="linear"><mpath href={`#rg-hp-${e.id}`} /></animateMotion>
                </circle>
                <circle cx={mx} cy={my} r="6" fill={dotCol} fillOpacity="0.2" />
                <circle cx={mx} cy={my} r="3.8" fill={dotCol} fillOpacity="0.85" />
                <circle cx={mx} cy={my} r="1.6" fill="white" />
                <rect x={mx - labelW / 2} y={my + 10} width={labelW} height={15} rx={5} fill="white" stroke={VIOLET_MID} strokeWidth="1" />
                <text x={mx} y={my + 20} textAnchor="middle" fontSize="7.5" fontFamily="'Courier New', Courier, monospace" fill="#5b21b6" fontWeight="700" letterSpacing="0.3">{label}</text>
              </g>
            );
          })}

          {datasets.map((ds) => {
            const pos = positions.get(ds.name);
            if (!pos) return null;
            const { x, y } = pos;
            const isHovered   = hoveredTable === ds.name;
            const isConnected = edges.some((e) => e.fromTable === ds.name || e.toTable === ds.name);
            const op          = nodeOpacity(ds.name);
            const visibleCols = ds.columns.filter((c) => !c.startsWith("Unnamed"));
            const showCols    = visibleCols.slice(0, 3);
            const extraCols   = visibleCols.length - showCols.length;
            const borderColor = isHovered ? VIOLET : isConnected ? VIOLET_MID : "#e5e7eb";
            const borderWidth = isHovered ? 2 : isConnected ? 1.5 : 1.2;

            return (
              <g key={ds.name} opacity={op} filter={isHovered ? "url(#rg-glow)" : "url(#rg-shadow)"} style={{ cursor: "pointer", transition: "opacity 0.2s" }} onMouseEnter={() => setHoveredTable(ds.name)} onMouseLeave={() => setHoveredTable(null)}>
                <rect x={x} y={y} width={H_NW} height={H_NH} rx={10} fill="white" stroke={borderColor} strokeWidth={borderWidth} />
                <rect x={x} y={y} width={H_NW} height={H_TH} rx={10} fill={isHovered ? VIOLET : VIOLET_PALE} />
                <rect x={x} y={y + H_TH - 6} width={H_NW} height={6} fill={isHovered ? VIOLET : VIOLET_PALE} />
                <ellipse cx={x + 14} cy={y + 12} rx={5} ry={2.5} fill={isHovered ? "rgba(255,255,255,0.45)" : VIOLET} fillOpacity={isHovered ? 0.45 : 0.38} />
                <rect x={x + 9} y={y + 12} width={10} height={9} fill={isHovered ? "rgba(255,255,255,0.45)" : VIOLET} fillOpacity={isHovered ? 0.32 : 0.28} />
                <ellipse cx={x + 14} cy={y + 21} rx={5} ry={2.5} fill={isHovered ? "rgba(255,255,255,0.45)" : VIOLET} fillOpacity={isHovered ? 0.45 : 0.38} />
                <text x={x + 26} y={y + 19} fontSize="11" fontWeight="800" fontFamily="system-ui, -apple-system, sans-serif" fill={isHovered ? "white" : "#1e1b4b"}>{trunc(ds.name, 16)}</text>
                <text x={x + 9} y={y + 38} fontSize="8.5" fontFamily="system-ui" fill="#9ca3af">{ds.row_count.toLocaleString()} rows · {ds.column_count} cols</text>
                <line x1={x + 9} y1={y + 43} x2={x + H_NW - 9} y2={y + 43} stroke="#f3f4f6" strokeWidth="1" />
                {showCols.map((col, i) => (
                  <text key={col} x={x + 9} y={y + 54 + i * 12} fontSize="8" fontFamily="'Courier New', Courier, monospace" fill="#6b7280">{trunc(col, 23)}</text>
                ))}
                {extraCols > 0 && <text x={x + 9} y={y + 54 + showCols.length * 12} fontSize="7.5" fontFamily="system-ui" fill="#d1d5db">+{extraCols} more</text>}
              </g>
            );
          })}

          {noEdges && datasets.length >= 2 && (
            <text x={svgW / 2} y={Math.max(svgH, 140) - 14} textAnchor="middle" fontSize="11" fontFamily="system-ui" fill="#d1d5db">No relationships detected yet</text>
          )}
        </svg>
      </div>

      {!noEdges && (
        <div className="flex items-center gap-4 px-2 pt-2 pb-1 flex-wrap">
          <span className="text-[9px] font-black uppercase tracking-widest text-neutral-300">Confidence</span>
          {([["#10b981", "High ≥85%"], ["#f59e0b", "Medium ≥65%"], ["#94a3b8", "Low"]] as [string, string][]).map(([c, l]) => (
            <div key={l} className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c }} />
              <span className="text-[9px] text-neutral-400">{l}</span>
            </div>
          ))}
          <span className="text-[9px] text-neutral-300 ml-auto italic">hover to highlight</span>
        </div>
      )}
    </div>
  );
}
