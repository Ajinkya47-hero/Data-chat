"use client";

import { useState, useEffect } from "react";
import {
  Table2, CheckSquare2, Square, Upload,
  Layers, ChevronRight, Hash, Columns3,
  Link2, AlertCircle, ChevronDown, ChevronUp,
  Pencil, Trash2, Plus, Check, X,
} from "lucide-react";
import { getRelationships, addRelationship, updateRelationship, deleteRelationship } from "@/lib/api";

export interface DatasetMeta {
  name: string;
  row_count: number;
  column_count: number;
  columns: string[];
  size_mb?: number;
}

interface Relationship {
  id: string;
  left_table: string;
  left_column: string;
  right_table: string;
  right_column: string;
  confidence: number;
  match_type: string;
  value_overlap: number;
  source: "auto" | "manual";
}

type RelFormState = {
  left_table: string;
  left_column: string;
  right_table: string;
  right_column: string;
};

const EMPTY_FORM: RelFormState = {
  left_table: "", left_column: "", right_table: "", right_column: "",
};

interface DatasetManagerProps {
  workspaceId: string;
  analysisId: string;
  datasets: DatasetMeta[];
  selectedDatasets: string[];
  primaryDataset: string;
  onSelectionChange: (selected: string[]) => void;
  onSetPrimary: (name: string) => void;
  onUploadMore: () => void;
  onDeleteDataset?: (name: string) => void;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function ColumnPills({ columns }: { columns: string[] }) {
  const max = 4;
  const visible = columns.slice(0, max);
  const rest = columns.length - max;
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {visible.map((col) => (
        <span key={col} className="text-[10px] font-medium bg-neutral-100 text-neutral-500 px-2 py-0.5 rounded-full">
          {col}
        </span>
      ))}
      {rest > 0 && (
        <span className="text-[10px] font-semibold text-neutral-400 px-1 py-0.5">+{rest} more</span>
      )}
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    pct >= 85 ? "bg-emerald-100 text-emerald-700 border-emerald-200" :
    pct >= 65 ? "bg-amber-100 text-amber-700 border-amber-200" :
                "bg-neutral-100 text-neutral-500 border-neutral-200";
  return (
    <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full border ${color}`}>
      {pct}%
    </span>
  );
}

function MatchTypePill({ type, source }: { type: string; source: "auto" | "manual" }) {
  if (source === "manual") {
    return (
      <span className="text-[9px] font-bold text-violet-500 bg-violet-50 px-1.5 py-0.5 rounded-full border border-violet-200">
        manual
      </span>
    );
  }
  const labels: Record<string, string> = {
    exact_key:      "Exact FK",
    table_name_fk:  "Table → PK",
    fuzzy_key:      "Fuzzy FK",
    exact_name:     "Name match",
    manual_edit:    "Edited",
  };
  return (
    <span className="text-[9px] font-bold text-neutral-400 bg-neutral-100 px-1.5 py-0.5 rounded-full">
      {labels[type] ?? type}
    </span>
  );
}

// ── Relationship form (used for both add and edit) ─────────────────────────────

function RelForm({
  form,
  datasets,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  form: RelFormState;
  datasets: DatasetMeta[];
  onChange: (f: RelFormState) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const leftCols = datasets.find((d) => d.name === form.left_table)?.columns ?? [];
  const rightCols = datasets.find((d) => d.name === form.right_table)?.columns ?? [];

  const selectCls =
    "text-[11px] font-semibold bg-white border border-neutral-200 rounded-lg px-2 py-1 text-neutral-700 focus:outline-none focus:border-violet-400 cursor-pointer min-w-0 w-full";

  const isValid =
    form.left_table && form.left_column && form.right_table && form.right_column &&
    form.left_table !== form.right_table;

  return (
    <div className="flex flex-col gap-2 bg-violet-50/50 border border-violet-200 rounded-xl px-3 py-2.5">
      <div className="grid grid-cols-2 gap-2">
        {/* Left side */}
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-violet-500">Left table</span>
          <select
            className={selectCls}
            value={form.left_table}
            onChange={(e) => onChange({ ...form, left_table: e.target.value, left_column: "" })}
          >
            <option value="">Select table…</option>
            {datasets.map((d) => (
              <option key={d.name} value={d.name}>{d.name}</option>
            ))}
          </select>
          <select
            className={selectCls}
            value={form.left_column}
            disabled={!form.left_table}
            onChange={(e) => onChange({ ...form, left_column: e.target.value })}
          >
            <option value="">Select column…</option>
            {leftCols.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>

        {/* Right side */}
        <div className="flex flex-col gap-1">
          <span className="text-[9px] font-black uppercase tracking-widest text-violet-500">Right table</span>
          <select
            className={selectCls}
            value={form.right_table}
            onChange={(e) => onChange({ ...form, right_table: e.target.value, right_column: "" })}
          >
            <option value="">Select table…</option>
            {datasets
              .filter((d) => d.name !== form.left_table)
              .map((d) => (
                <option key={d.name} value={d.name}>{d.name}</option>
              ))}
          </select>
          <select
            className={selectCls}
            value={form.right_column}
            disabled={!form.right_table}
            onChange={(e) => onChange({ ...form, right_column: e.target.value })}
          >
            <option value="">Select column…</option>
            {rightCols.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex items-center gap-1 text-[11px] font-bold text-neutral-500 hover:text-neutral-700 px-2.5 py-1 rounded-lg hover:bg-neutral-100 transition-colors"
        >
          <X className="w-3 h-3" /> Cancel
        </button>
        <button
          onClick={onSave}
          disabled={!isValid || saving}
          className="flex items-center gap-1 text-[11px] font-bold text-white bg-violet-500 hover:bg-violet-600 disabled:opacity-40 disabled:cursor-not-allowed px-2.5 py-1 rounded-lg transition-colors"
        >
          <Check className="w-3 h-3" /> {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ── Relationships panel ────────────────────────────────────────────────────────

function RelationshipsPanel({
  workspaceId,
  analysisId,
  datasets,
}: {
  workspaceId: string;
  analysisId: string;
  datasets: DatasetMeta[];
}) {
  const [rels, setRels] = useState<Relationship[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<RelFormState>(EMPTY_FORM);
  const [savingEdit, setSavingEdit] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<RelFormState>(EMPTY_FORM);
  const [savingAdd, setSavingAdd] = useState(false);

  const datasetCount = datasets.length;

  const fetchRels = () => {
    if (datasetCount < 2) { setRels([]); return; }
    setLoading(true);
    setError(null);
    getRelationships(workspaceId, analysisId)
      .then((res) => setRels(res.data.relationships ?? []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchRels(); }, [workspaceId, analysisId, datasetCount]);

  const startEdit = (r: Relationship) => {
    setEditingId(r.id);
    setEditForm({
      left_table: r.left_table,
      left_column: r.left_column,
      right_table: r.right_table,
      right_column: r.right_column,
    });
    setShowAddForm(false);
  };

  const cancelEdit = () => { setEditingId(null); setEditForm(EMPTY_FORM); };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setSavingEdit(true);
    try {
      await updateRelationship(workspaceId, analysisId, editingId, editForm);
      cancelEdit();
      fetchRels();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async (rel: Relationship) => {
    if (!confirm(`Delete relationship ${rel.left_table}.${rel.left_column} ↔ ${rel.right_table}.${rel.right_column}?`)) return;
    try {
      await deleteRelationship(workspaceId, analysisId, rel.id);
      fetchRels();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleAddSave = async () => {
    setSavingAdd(true);
    try {
      await addRelationship(workspaceId, analysisId, addForm);
      setShowAddForm(false);
      setAddForm(EMPTY_FORM);
      fetchRels();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add");
    } finally {
      setSavingAdd(false);
    }
  };

  if (datasetCount < 2) return null;

  return (
    <div className="shrink-0 border-t border-neutral-100">
      {/* Section header */}
      <div className="flex items-center gap-2 px-5 py-3">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex items-center gap-2 flex-1 hover:opacity-80 transition-opacity"
        >
          <Link2 className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="text-[11px] font-black uppercase tracking-widest text-neutral-600 flex-1 text-left">
            Relationships
          </span>
          {loading ? (
            <span className="text-[10px] text-neutral-400 animate-pulse">detecting…</span>
          ) : (
            <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
              {rels.length} found
            </span>
          )}
          {expanded
            ? <ChevronUp className="w-3 h-3 text-neutral-400" />
            : <ChevronDown className="w-3 h-3 text-neutral-400" />}
        </button>

        {/* Add button */}
        <button
          onClick={() => { setShowAddForm((v) => !v); setEditingId(null); }}
          title="Add relationship"
          className="flex items-center gap-1 text-[10px] font-bold text-violet-600 bg-violet-50 hover:bg-violet-100 px-2 py-1 rounded-lg border border-violet-200 transition-colors shrink-0"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {expanded && (
        <div className="px-4 pb-3 flex flex-col gap-1.5">
          {error && (
            <div className="flex items-center gap-2 text-red-500 text-[11px] px-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              {error}
            </div>
          )}

          {/* ── List view ── */}
            <>
              {!loading && rels.length === 0 && !error && !showAddForm && (
                <p className="text-[11px] text-neutral-400 px-1 pb-1">
                  No relationships detected. Add one manually.
                </p>
              )}

              {/* Relationship rows — scrollable when many entries */}
              <div className="flex flex-col gap-1.5 overflow-y-auto max-h-[260px] pr-0.5 custom-scrollbar">
              {rels.map((r) =>
                editingId === r.id ? (
                  <RelForm
                    key={r.id}
                    form={editForm}
                    datasets={datasets}
                    onChange={setEditForm}
                    onSave={handleSaveEdit}
                    onCancel={cancelEdit}
                    saving={savingEdit}
                  />
                ) : (
                  <div
                    key={r.id}
                    className="flex flex-col gap-1.5 bg-white border border-neutral-100 rounded-xl px-3.5 py-2.5 hover:border-violet-200 hover:bg-violet-50/30 transition-colors group"
                  >
                    {/* Row 1 — endpoints */}
                    <div className="flex items-center gap-2">
                      {/* Left endpoint */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-neutral-400 leading-tight">{r.left_table}</p>
                        <p className="text-[12px] font-black text-neutral-800 font-mono leading-snug break-all">{r.left_column}</p>
                      </div>

                      {/* Connector */}
                      <div className="shrink-0 flex items-center gap-1 px-0.5">
                        <div className="w-3 h-px bg-violet-300 group-hover:bg-violet-400 transition-colors" />
                        <Link2 className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                        <div className="w-3 h-px bg-violet-300 group-hover:bg-violet-400 transition-colors" />
                      </div>

                      {/* Right endpoint */}
                      <div className="flex-1 min-w-0">
                        <p className="text-[10px] font-semibold text-neutral-400 leading-tight">{r.right_table}</p>
                        <p className="text-[12px] font-black text-neutral-800 font-mono leading-snug break-all">{r.right_column}</p>
                      </div>
                    </div>

                    {/* Row 2 — badges + actions */}
                    <div className="flex items-center gap-1.5">
                      <ConfidenceBadge value={r.confidence} />
                      <MatchTypePill type={r.match_type} source={r.source} />
                      <div className="flex-1" />
                      {/* Action buttons — appear on hover */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEdit(r)}
                          title="Edit relationship"
                          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-violet-100 text-neutral-400 hover:text-violet-600 transition-colors"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => handleDelete(r)}
                          title="Delete relationship"
                          className="w-6 h-6 flex items-center justify-center rounded-lg hover:bg-red-50 text-neutral-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              )}

              </div>

              {/* Add form — always fully visible, outside scroll area */}
              {showAddForm && (
                <RelForm
                  form={addForm}
                  datasets={datasets}
                  onChange={setAddForm}
                  onSave={handleAddSave}
                  onCancel={() => { setShowAddForm(false); setAddForm(EMPTY_FORM); }}
                  saving={savingAdd}
                />
              )}

              {rels.length > 0 && !showAddForm && editingId === null && (
                <p className="text-[10px] text-neutral-400 px-1 pt-1">
                  Use in chat:{" "}
                  <span className="font-semibold text-neutral-500">
                    "Join {rels[0].left_table} with {rels[0].right_table}"
                  </span>
                </p>
              )}
            </>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function DatasetManager({
  workspaceId,
  analysisId,
  datasets,
  selectedDatasets,
  primaryDataset,
  onSelectionChange,
  onSetPrimary,
  onUploadMore,
  onDeleteDataset,
}: DatasetManagerProps) {
  const allSelected = datasets.every((d) => selectedDatasets.includes(d.name));

  const toggleAll = () => {
    if (allSelected) {
      onSelectionChange([primaryDataset]);
    } else {
      onSelectionChange(datasets.map((d) => d.name));
    }
  };

  const toggleOne = (name: string) => {
    if (selectedDatasets.includes(name)) {
      if (selectedDatasets.length === 1) return;
      const next = selectedDatasets.filter((n) => n !== name);
      onSelectionChange(next);
      if (name === primaryDataset && next.length > 0) onSetPrimary(next[0]);
    } else {
      onSelectionChange([...selectedDatasets, name]);
    }
  };

  return (
    <div className="flex flex-col h-full">

      {/* ── Header ── */}
      <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-neutral-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-primary/10 flex items-center justify-center">
            <Layers className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-[13px] font-black text-neutral-800 leading-none">Datasets</p>
            <p className="text-[10px] text-neutral-400 mt-0.5">{datasets.length} loaded</p>
          </div>
        </div>
        <button
          onClick={onUploadMore}
          className="flex items-center gap-1.5 text-[11px] font-bold text-primary px-3 py-1.5 rounded-xl border border-primary/20 bg-primary/5 hover:bg-primary/10 transition-colors"
        >
          <Upload className="w-3 h-3" />
          Add Dataset
        </button>
      </div>

      {/* ── Select-all bar ── */}
      <div className="shrink-0 flex items-center gap-3 px-5 py-2.5 border-b border-neutral-100 bg-neutral-50/50">
        <button onClick={toggleAll} className="flex items-center gap-2 group">
          {allSelected
            ? <CheckSquare2 className="w-4 h-4 text-primary" />
            : <Square className="w-4 h-4 text-neutral-300 group-hover:text-neutral-400 transition-colors" />}
          <span className="text-[11px] font-bold text-neutral-500 uppercase tracking-widest">
            {allSelected ? "Deselect all" : "Select all"}
          </span>
        </button>
        <span className="ml-auto text-[11px] font-semibold text-primary">
          {selectedDatasets.length} in analysis
        </span>
      </div>

      {/* ── Dataset list (scrollable) ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-2 min-h-0">
        {datasets.length === 0 && (
          <div className="flex flex-col items-center justify-center h-40 gap-3 text-neutral-400">
            <Table2 className="w-8 h-8 opacity-30" />
            <p className="text-sm font-medium">No datasets uploaded yet</p>
          </div>
        )}

        {datasets.map((ds) => {
          const isSelected = selectedDatasets.includes(ds.name);
          const isPrimary = ds.name === primaryDataset;

          return (
            <div
              key={ds.name}
              className={`rounded-2xl border transition-all ${
                isPrimary
                  ? "border-primary/30 bg-primary/5 shadow-sm shadow-primary/10"
                  : isSelected
                  ? "border-neutral-300 bg-white"
                  : "border-neutral-100 bg-neutral-50/50"
              }`}
            >
              <div className="flex items-start gap-3 p-4 pb-2">
                {/* Checkbox */}
                <button
                  onClick={() => toggleOne(ds.name)}
                  className="mt-0.5 shrink-0"
                  title={isSelected ? "Remove from analysis" : "Add to analysis"}
                >
                  {isSelected
                    ? <CheckSquare2 className="w-4 h-4 text-primary" />
                    : <Square className="w-4 h-4 text-neutral-300 hover:text-neutral-400 transition-colors" />}
                </button>

                {/* Icon */}
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  isPrimary ? "bg-primary text-white" : "bg-neutral-100 text-neutral-400"
                }`}>
                  <Table2 className="w-4 h-4" />
                </div>

                {/* Name + badges */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[13.5px] font-bold text-neutral-800 truncate">{ds.name}</p>
                    {isPrimary && (
                      <span className="text-[9px] font-black uppercase tracking-wider bg-primary text-white px-1.5 py-0.5 rounded-full shrink-0">
                        Preview
                      </span>
                    )}
                    {isSelected && !isPrimary && (
                      <span className="text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded-full shrink-0">
                        In analysis
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="flex items-center gap-1 text-[11px] text-neutral-400 font-medium">
                      <Hash className="w-3 h-3" />{ds.row_count.toLocaleString()} rows
                    </span>
                    <span className="flex items-center gap-1 text-[11px] text-neutral-400 font-medium">
                      <Columns3 className="w-3 h-3" />{ds.column_count} cols
                    </span>
                    {ds.size_mb !== undefined && (
                      <span className="text-[11px] text-neutral-300 font-medium ml-auto">
                        {ds.size_mb < 0.1 ? "<0.1" : ds.size_mb.toFixed(1)} MB
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Column pills */}
              <div className="px-4 pb-3 pl-[4.75rem]">
                <ColumnPills columns={ds.columns} />
              </div>

              {/* Actions */}
              <div className="flex items-center border-t border-neutral-100">
                {isSelected && !isPrimary && (
                  <button
                    onClick={() => onSetPrimary(ds.name)}
                    className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-[11px] font-bold text-neutral-500 hover:text-primary hover:bg-primary/5 transition-colors"
                  >
                    Set as preview dataset
                    <ChevronRight className="w-3 h-3" />
                  </button>
                )}
                {onDeleteDataset && datasets.length > 1 && (
                  <button
                    onClick={() => {
                      if (confirm(`Delete "${ds.name}"? This cannot be undone.`)) {
                        onDeleteDataset(ds.name);
                      }
                    }}
                    title="Delete dataset"
                    className={`flex items-center justify-center gap-1.5 px-4 py-2.5 text-[11px] font-bold text-neutral-400 hover:text-red-500 hover:bg-red-50 transition-colors ${
                      isSelected && !isPrimary ? "border-l border-neutral-100" : "flex-1"
                    }`}
                  >
                    <Trash2 className="w-3 h-3" />
                    Delete
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Relationships panel ── */}
      <RelationshipsPanel workspaceId={workspaceId} analysisId={analysisId} datasets={datasets} />

      {/* ── Footer: active context ── */}
      <div className="shrink-0 px-4 py-3 border-t border-neutral-100 bg-white">
        <div className="bg-neutral-50 rounded-2xl px-4 py-2.5 flex items-center gap-3">
          <div className="flex -space-x-1.5">
            {selectedDatasets.slice(0, 3).map((name) => (
              <div key={name} className="w-6 h-6 rounded-full bg-primary text-white text-[9px] font-black flex items-center justify-center border-2 border-white uppercase">
                {name[0]}
              </div>
            ))}
            {selectedDatasets.length > 3 && (
              <div className="w-6 h-6 rounded-full bg-neutral-300 text-neutral-600 text-[9px] font-black flex items-center justify-center border-2 border-white">
                +{selectedDatasets.length - 3}
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-neutral-700 truncate">{selectedDatasets.join(", ")}</p>
            <p className="text-[10px] text-neutral-400">available in chat</p>
          </div>
        </div>
      </div>
    </div>
  );
}
