"use client";

import { useMemo, useState } from "react";
import type { DatasetMeta } from "./DatasetManager";
import type { GraphRelationship } from "./RelationshipGraph";

// ── Layout profiles ────────────────────────────────────────────────────────────

export const SCHEMA_LAYOUT = {
  compact: {
    NW: 188, NH: 120, GAP: 80, PD_X: 24, PD_TOP: 52, PD_BOT: 16, TH: 28, COLS: 3, FONT: 11,
  },
  expanded: {
    NW: 256, NH: 158, GAP: 136, PD_X: 48, PD_TOP: 68, PD_BOT: 28, TH: 36, COLS: 5, FONT: 13,
  },
} as const;

type LayoutKey = keyof typeof SCHEMA_LAYOUT;

/** Returns the natural SVG dimensions for a given number of tables. */
export function schemaCanvasSize(n: number, mode: LayoutKey) {
  const L = SCHEMA_LAYOUT[mode];
  return {
    width:  L.PD_X * 2 + n * L.NW + Math.max(0, n - 1) * L.GAP,
    height: L.PD_TOP + L.NH + L.PD_BOT,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function trunc(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}
function confColor(c: number) {
  return c >= 0.85 ? "#10b981" : c >= 0.65 ? "#f59e0b" : "#94a3b8";
}

// ── Topological sort → ordered name array ─────────────────────────────────────

function topoOrder(datasets: DatasetMeta[], rels: GraphRelationship[]): string[] {
  const names = datasets.map((d) => d.name);
  if (!names.length) return [];

  const pairMap = new Map<string, GraphRelationship>();
  rels.forEach((r) => {
    if (!names.includes(r.left_table) || !names.includes(r.right_table)) return;
    const key = [r.left_table, r.right_table].sort().join("\0");
    const prev = pairMap.get(key);
    if (!prev || r.confidence > prev.confidence) pairMap.set(key, r);
  });

  const adj   = new Map<string, string[]>(names.map((n) => [n, []]));
  const inDeg = new Map<string, number>(names.map((n) => [n, 0]));

  pairMap.forEach((r) => {
    const isFk = r.match_type === "table_name_fk" || r.match_type.startsWith("exact_key");
    const [parent, child] = isFk
      ? [r.right_table, r.left_table]
      : [r.left_table,  r.right_table];
    if (names.includes(parent) && names.includes(child)) {
      adj.get(parent)!.push(child);
      inDeg.set(child, (inDeg.get(child) ?? 0) + 1);
    }
  });

  let queue = names.filter((n) => (inDeg.get(n) ?? 0) === 0).sort();
  const result: string[] = [];
  while (queue.length) {
    queue = [...queue].sort();
    const next: string[] = [];
    queue.forEach((n) => {
      result.push(n);
      adj.get(n)!.forEach((c) => {
        inDeg.set(c, inDeg.get(c)! - 1);
        if (inDeg.get(c) === 0) next.push(c);
      });
    });
    queue = next;
  }
  names.filter((n) => !result.includes(n)).sort().forEach((n) => result.push(n));
  return result;
}

// ── Edge builder ───────────────────────────────────────────────────────────────

interface EdgeData {
  id: string;
  from: string; to: string;
  fromCol: string; toCol: string;
  fromIdx: number; toIdx: number;
  confidence: number;
  source: "auto" | "manual";
}

function buildEdges(ordered: string[], rels: GraphRelationship[]): EdgeData[] {
  const pairMap = new Map<string, GraphRelationship>();
  rels.forEach((r) => {
    if (!ordered.includes(r.left_table) || !ordered.includes(r.right_table)) return;
    const key = [r.left_table, r.right_table].sort().join("\0");
    const prev = pairMap.get(key);
    if (!prev || r.confidence > prev.confidence) pairMap.set(key, r);
  });

  return Array.from(pairMap.values()).map((r) => {
    const isFk = r.match_type === "table_name_fk" || r.match_type.startsWith("exact_key");
    let [from, to, fromCol, toCol] = isFk
      ? [r.right_table, r.left_table, r.right_column, r.left_column]
      : [r.left_table,  r.right_table, r.left_column,  r.right_column];

    let fi = ordered.indexOf(from);
    let ti = ordered.indexOf(to);

    if (fi > ti) {
      [from, to, fromCol, toCol, fi, ti] = [to, from, toCol, fromCol, ti, fi];
    }

    return { id: r.id, from, to, fromCol, toCol, fromIdx: fi, toIdx: ti, confidence: r.confidence, source: r.source };
  });
}

// ── Component ──────────────────────────────────────────────────────────────────

export interface SchemaCanvasProps {
  datasets: DatasetMeta[];
  relationships: GraphRelationship[];
  mode?: LayoutKey;
  idPrefix?: string;
  showLabels?: boolean;
  onTableClick?: (name: string) => void;
  /** Per-node drag offsets (canvas-space pixels) */
  nodeOffsets?: Map<string, { dx: number; dy: number }>;
  /** Called when user presses mouse on a node (for drag initiation) */
  onNodeMouseDown?: (name: string, e: React.MouseEvent<SVGGElement>) => void;
}

export default function SchemaCanvas({
  datasets,
  relationships,
  mode = "compact",
  idPrefix = "sc",
  showLabels,
  onTableClick,
  nodeOffsets,
  onNodeMouseDown,
}: SchemaCanvasProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const L = SCHEMA_LAYOUT[mode];
  const showEdgeLabels = showLabels ?? (mode === "expanded");

  const ordered = useMemo(() => topoOrder(datasets, relationships), [datasets, relationships]);
  const edges   = useMemo(() => buildEdges(ordered, relationships),  [ordered,  relationships]);
  const dsMap   = useMemo(() => new Map(datasets.map((d) => [d.name, d])), [datasets]);

  const n = ordered.length;
  const { width: svgW, height: svgH } = schemaCanvasSize(n, mode);

  // X left-edge of node i (base, without offset)
  const nodeX = (i: number) => L.PD_X + i * (L.NW + L.GAP);
  // Vertical centre of all cards (base, without y-offset)
  const yCtr  = L.PD_TOP + L.NH / 2;

  const connected = useMemo(() => {
    if (!hovered) return new Set<string>();
    const s = new Set([hovered]);
    edges.forEach((e) => {
      if (e.from === hovered) s.add(e.to);
      if (e.to   === hovered) s.add(e.from);
    });
    return s;
  }, [hovered, edges]);

  const nodeOp = (name: string) => (!hovered || connected.has(name)) ? 1 : 0.25;
  const edgeOp = (e: EdgeData)  => (!hovered || e.from === hovered || e.to === hovered) ? 1 : 0.05;
  const edgeSW = (e: EdgeData)  => (!hovered || e.from === hovered || e.to === hovered) ? 2  : 1.5;

  if (!n) return null;

  return (
    <svg
      width={svgW}
      height={svgH}
      viewBox={`0 0 ${svgW} ${svgH}`}
      style={{ display: "block", overflow: "visible" }}
      aria-label="Schema diagram"
    >
      <defs>
        <marker id={`${idPrefix}-arr`} markerWidth="9" markerHeight="9" refX="7.5" refY="3.5" orient="auto">
          <path d="M0,0.5 L0,6.5 L8,3.5 z" fill="#7c3aed" fillOpacity="0.85" />
        </marker>
        <filter id={`${idPrefix}-glow`} x="-25%" y="-25%" width="150%" height="150%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#7c3aed" floodOpacity="0.28" />
        </filter>
        <filter id={`${idPrefix}-shadow`} x="-12%" y="-12%" width="124%" height="136%">
          <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000" floodOpacity="0.07" />
        </filter>
      </defs>

      {/* ── EDGES ── */}
      {edges.map((e) => {
        const fromOff = nodeOffsets?.get(e.from) ?? { dx: 0, dy: 0 };
        const toOff   = nodeOffsets?.get(e.to)   ?? { dx: 0, dy: 0 };

        const x1 = nodeX(e.fromIdx) + fromOff.dx + L.NW + 2;
        const x2 = nodeX(e.toIdx)   + toOff.dx   - 2;
        const y1 = yCtr + fromOff.dy;
        const y2 = yCtr + toOff.dy;

        const dist = e.toIdx - e.fromIdx;
        const op   = edgeOp(e);
        const sw   = edgeSW(e);
        const isAct = !!hovered && (e.from === hovered || e.to === hovered);
        const hasYDiff = Math.abs(y1 - y2) > 6;

        let pathD: string;
        let mx: number;
        let my: number;

        if (hasYDiff) {
          // Nodes at different y — S-curve bezier
          const cpX = Math.max(60, (x2 - x1) * 0.45);
          pathD = `M ${x1} ${y1} C ${x1 + cpX} ${y1}, ${x2 - cpX} ${y2}, ${x2} ${y2}`;
          mx = (x1 + x2) / 2;
          my = (y1 + y2) / 2;
        } else {
          const liftPx = dist <= 1 ? 0 : Math.min(10 + 11 * (dist - 1), L.PD_TOP - 14);
          const arcY   = y1 - liftPx;
          const cpX    = dist === 1 ? L.GAP * 0.44 : 58;
          pathD = dist === 1
            ? `M ${x1} ${y1} C ${x1 + cpX} ${y1}, ${x2 - cpX} ${y2}, ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1 + cpX} ${arcY}, ${x2 - cpX} ${arcY}, ${x2} ${y2}`;
          mx = (x1 + x2) / 2;
          my = dist <= 1 ? y1 : arcY;
        }

        const dc    = confColor(e.confidence);
        const label = `${trunc(e.fromCol, 11)} → ${trunc(e.toCol, 11)}`;
        const labelW = label.length * 5.4 + 14;

        return (
          <g key={e.id} opacity={op} style={{ transition: "opacity 0.18s" }}>
            <path d={pathD} fill="none" stroke="transparent" strokeWidth="14" />
            <path
              id={`${idPrefix}-p-${e.id}`}
              d={pathD}
              fill="none"
              stroke="#7c3aed"
              strokeWidth={sw}
              strokeOpacity={isAct ? 0.7 : 0.42}
              markerEnd={`url(#${idPrefix}-arr)`}
              style={{ transition: "stroke-width 0.18s, stroke-opacity 0.18s" }}
            />
            <circle r="3.2" fill="#7c3aed" opacity="0.75">
              <animateMotion dur="1.7s" repeatCount="indefinite" calcMode="linear">
                <mpath href={`#${idPrefix}-p-${e.id}`} />
              </animateMotion>
            </circle>
            <circle r="1.8" fill="#7c3aed" opacity="0.35">
              <animateMotion dur="1.7s" begin="-0.28s" repeatCount="indefinite" calcMode="linear">
                <mpath href={`#${idPrefix}-p-${e.id}`} />
              </animateMotion>
            </circle>
            <circle cx={mx} cy={my} r="5.5" fill={dc} fillOpacity="0.18" />
            <circle cx={mx} cy={my} r="3.5" fill={dc} fillOpacity="0.9" />
            <circle cx={mx} cy={my} r="1.5" fill="white" />
            {showEdgeLabels && (
              <>
                <rect
                  x={mx - labelW / 2}
                  y={my - (hasYDiff ? 13 : dist > 1 ? 19 : 11)}
                  width={labelW}
                  height={14}
                  rx={4}
                  fill="white"
                  stroke="#ddd6fe"
                  strokeWidth="1"
                />
                <text
                  x={mx}
                  y={my - (hasYDiff ? 13 : dist > 1 ? 19 : 11) + 10}
                  textAnchor="middle"
                  fontSize="7.5"
                  fontFamily="'Courier New', Courier, monospace"
                  fill="#5b21b6"
                  fontWeight="700"
                  letterSpacing="0.3"
                >
                  {label}
                </text>
              </>
            )}
          </g>
        );
      })}

      {/* ── NODES ── */}
      {ordered.map((name, i) => {
        const ds  = dsMap.get(name);
        if (!ds) return null;

        const off = nodeOffsets?.get(name) ?? { dx: 0, dy: 0 };
        const nx  = nodeX(i) + off.dx;
        const ny  = L.PD_TOP + off.dy;

        const op    = nodeOp(name);
        const isH   = name === hovered;
        const isCon = edges.some((e) => e.from === name || e.to === name);

        const visCol  = ds.columns.filter((c) => !c.startsWith("Unnamed"));
        const showCol = visCol.slice(0, L.COLS);
        const extra   = visCol.length - showCol.length;

        const strokeC = isH ? "#7c3aed" : isCon ? "#c4b5fd" : "#e5e7eb";
        const strokeW = isH ? 2 : 1.5;

        return (
          <g
            key={name}
            opacity={op}
            filter={isH ? `url(#${idPrefix}-glow)` : `url(#${idPrefix}-shadow)`}
            style={{
              cursor: onNodeMouseDown ? "grab" : (onTableClick ? "pointer" : "default"),
              transition: "opacity 0.18s",
            }}
            onMouseEnter={() => setHovered(name)}
            onMouseLeave={() => setHovered(null)}
            onClick={() => onTableClick?.(name)}
            onMouseDown={(e) => {
              if (onNodeMouseDown) {
                e.stopPropagation();
                onNodeMouseDown(name, e);
              }
            }}
          >
            <rect
              x={nx} y={ny} width={L.NW} height={L.NH} rx={11}
              fill="white"
              stroke={strokeC}
              strokeWidth={strokeW}
              style={{ transition: "stroke 0.18s" }}
            />
            <rect x={nx} y={ny}           width={L.NW} height={L.TH}     rx={11} fill={isH ? "#7c3aed" : "#ede9fe"} style={{ transition: "fill 0.18s" }} />
            <rect x={nx} y={ny + L.TH - 5} width={L.NW} height={5}                fill={isH ? "#7c3aed" : "#ede9fe"} style={{ transition: "fill 0.18s" }} />
            <ellipse cx={nx + 14} cy={ny + 11}    rx={5.2} ry={2.4} fill={isH ? "rgba(255,255,255,0.4)" : "#7c3aed"} fillOpacity={isH ? 0.4 : 0.38} />
            <rect    x={nx +  9} y={ny + 11}      width={10.4} height={9} fill={isH ? "rgba(255,255,255,0.4)" : "#7c3aed"} fillOpacity={isH ? 0.28 : 0.26} />
            <ellipse cx={nx + 14} cy={ny + 20}    rx={5.2} ry={2.4} fill={isH ? "rgba(255,255,255,0.4)" : "#7c3aed"} fillOpacity={isH ? 0.4 : 0.38} />
            <text
              x={nx + 27} y={ny + 18}
              fontSize={L.FONT}
              fontWeight="800"
              fontFamily="system-ui, -apple-system, sans-serif"
              fill={isH ? "white" : "#1e1b4b"}
              style={{ transition: "fill 0.18s" }}
            >
              {trunc(name, mode === "compact" ? 17 : 22)}
            </text>
            <text x={nx + 9} y={ny + L.TH + 13} fontSize="8.5" fontFamily="system-ui" fill="#9ca3af">
              {ds.row_count.toLocaleString()} rows · {ds.column_count} cols
            </text>
            <line x1={nx + 9} y1={ny + L.TH + 17} x2={nx + L.NW - 9} y2={ny + L.TH + 17} stroke="#f3f4f6" strokeWidth="1" />
            {showCol.map((col, ci) => (
              <text
                key={col}
                x={nx + 9}
                y={ny + L.TH + 30 + ci * 12}
                fontSize={mode === "compact" ? 8 : 9}
                fontFamily="'Courier New', Courier, monospace"
                fill="#6b7280"
              >
                {trunc(col, mode === "compact" ? 22 : 28)}
              </text>
            ))}
            {extra > 0 && (
              <text
                x={nx + 9}
                y={ny + L.TH + 30 + showCol.length * 12}
                fontSize="7.5"
                fontFamily="system-ui"
                fill="#c4b5fd"
                fontWeight="600"
              >
                +{extra} more…
              </text>
            )}
          </g>
        );
      })}

      {!edges.length && n >= 2 && (
        <text
          x={svgW / 2}
          y={svgH - 8}
          textAnchor="middle"
          fontSize="10"
          fontFamily="system-ui"
          fill="#e5e7eb"
        >
          No relationships detected — add them with the button above
        </text>
      )}
    </svg>
  );
}
